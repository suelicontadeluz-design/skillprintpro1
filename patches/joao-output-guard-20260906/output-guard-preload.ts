// João customer-output guard preload v1 — 2026-09-06
// Scope is deliberately narrow: only João's customer-facing text transports and the
// text input to joao-tts. Internal alerts emitted by other Edge Functions never pass
// through this wrapper and therefore are not affected.
//
// Load order: auth-preload -> gate7c-preload -> THIS -> pinned João cognition.
// `baseFetch` therefore preserves the existing Gate 7C wrapper underneath us.

const OUTPUT_GUARD_SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const OUTPUT_GUARD_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OUTPUT_GUARD_AGENT = 'agente-noturno';
const baseFetch = globalThis.fetch.bind(globalThis);

type Candidate = { texto: string; phone: string | null; route: 'zapi_text' | 'botconversa_text' | 'joao_tts' };

function outputGuardJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

async function extractCandidate(input: RequestInfo | URL, init?: RequestInit): Promise<Candidate | null> {
  const url = urlOf(input);
  const raw = await bodyText(input, init);
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { return null; }

  // João primary customer text transport.
  if (/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) {
    const texto = String(body?.message ?? '');
    if (!texto) return null;
    return { texto, phone: String(body?.phone ?? '').replace(/\D/g, '') || null, route: 'zapi_text' };
  }

  // João customer-text fallback. GET subscriber lookup is intentionally not intercepted.
  if (/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/[^/]+\/send_message\/?(?:\?|$)/i.test(url)) {
    if (String(body?.type ?? '').toLowerCase() !== 'text') return null;
    const texto = String(body?.value ?? '');
    if (!texto) return null;
    return { texto, phone: null, route: 'botconversa_text' };
  }

  // Voice is presentation only. Guard the canonical text before audio synthesis.
  // If blocked, João's TTS helper falls back to text; that text is then blocked again
  // by one of the two customer transport gates above.
  if (url.includes('/functions/v1/joao-tts')) {
    const texto = String(body?.texto ?? '');
    if (!texto) return null;
    return { texto, phone: null, route: 'joao_tts' };
  }

  return null;
}

async function registerAndEvaluate(c: Candidate): Promise<{ bloquear: boolean; registro: string | null }> {
  const res = await baseFetch(`${OUTPUT_GUARD_SUPABASE_URL}/rest/v1/rpc/fn_saida_guarda_registrar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apikey': OUTPUT_GUARD_SERVICE_KEY,
      'authorization': `Bearer ${OUTPUT_GUARD_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      p_agente_slug: OUTPUT_GUARD_AGENT,
      p_texto: c.texto,
      p_phone: c.phone,
      p_lead_id: null,
      p_turn_id: null,
      p_decision_id: null,
    }),
  });

  if (!res.ok) throw new Error(`output_guard_rpc_${res.status}`);
  const data: any = await res.json();
  return {
    bloquear: data?.bloquear === true,
    registro: data?.registro ? String(data.registro) : null,
  };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const candidate = await extractCandidate(input, init);
  if (!candidate) return baseFetch(input, init);

  try {
    const verdict = await registerAndEvaluate(candidate);
    if (verdict.bloquear) {
      console.warn(JSON.stringify({
        event: 'JOAO_OUTPUT_GUARD_BLOCKED',
        route: candidate.route,
        registro: verdict.registro,
      }));
      // Never echo the blocked text, UUID, or detector details into logs/response.
      return outputGuardJson({ ok: false, error: 'output_guard_blocked' }, 422);
    }
    return baseFetch(input, init);
  } catch (e: any) {
    // Guard availability is part of the customer-send safety boundary. Do not let an
    // unchecked message bypass just because the guard RPC is unavailable.
    console.error(JSON.stringify({
      event: 'JOAO_OUTPUT_GUARD_UNAVAILABLE',
      route: candidate.route,
      error: String(e?.message ?? e).slice(0, 120),
    }));
    return outputGuardJson({ ok: false, error: 'output_guard_unavailable' }, 503);
  }
};
