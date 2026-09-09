declare const Deno: any;
const OG_URL = Deno.env.get('SUPABASE_URL')!;
const OG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OG_AGENT = 'agente-noturno';
const OG_VERSION = 'joao-output-guard/v3-human-takeover';
const ogBaseFetch = globalThis.fetch.bind(globalThis);
const ogSidPhone = new Map<string, { phone: string; at: number }>();

function ogUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function ogRaw(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function ogJson(x: any, s = 200) {
  return new Response(JSON.stringify(x), { status: s, headers: { 'content-type': 'application/json' } });
}
function ogDigits(v: any) { return String(v ?? '').replace(/\D/g, ''); }

async function ogRpc(fn: string, body: any) {
  const r = await ogBaseFetch(`${OG_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: OG_SERVICE, authorization: `Bearer ${OG_SERVICE}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2500),
  });
  if (!r.ok) throw new Error(`${fn}_${r.status}`);
  return await r.json();
}

async function ogAudit(evento: string, status: string, detalhe: any) {
  try {
    await ogBaseFetch(`${OG_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: OG_SERVICE,
        authorization: `Bearer ${OG_SERVICE}`,
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        agente_slug: OG_AGENT,
        funcao: 'joao-output-guard',
        versao: OG_VERSION,
        nivel: status === 'blocked' ? 'warn' : 'info',
        categoria: 'output_guard',
        evento,
        status,
        mensagem: detalhe?.motivo ?? evento,
        detalhe,
      }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}

async function ogObserveSubscriber(input: RequestInfo | URL, init?: RequestInit) {
  const url = ogUrl(input);
  const m = url.match(/\/subscriber\/get_by_phone\/([^/?]+)\/?(?:\?|$)/i);
  if (!m) return null;
  const resp = await ogBaseFetch(input, init);
  if (resp.ok) {
    try {
      const d = await resp.clone().json();
      const sid = String(d?.id || '');
      const phone = ogDigits(decodeURIComponent(m[1]));
      if (sid && phone) ogSidPhone.set(sid, { phone, at: Date.now() });
    } catch {}
  }
  return resp;
}

async function ogPhoneBySubscriber(sid: string): Promise<string | null> {
  const hit = ogSidPhone.get(sid);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.phone;
  try {
    const r = await ogBaseFetch(`${OG_URL}/rest/v1/lead_identificadores?select=telefone&contact_botconversa_id=eq.${encodeURIComponent(sid)}&limit=1`, {
      headers: { apikey: OG_SERVICE, authorization: `Bearer ${OG_SERVICE}` },
      signal: AbortSignal.timeout(1800),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const phone = ogDigits(Array.isArray(rows) ? rows[0]?.telefone : '');
    if (phone) {
      ogSidPhone.set(sid, { phone, at: Date.now() });
      return phone;
    }
  } catch {}
  return null;
}

function ogMentionedService(text: string, service: string) {
  if (service === 'J&T') return /j\s*&\s*t/i.test(text);
  return new RegExp(`\\b${service}\\b`, 'i').test(text);
}
function ogServiceKey(name: string) {
  const n = String(name || '').toUpperCase();
  if (n.includes('J&T')) return 'J&T';
  if (n.includes('SEDEX')) return 'SEDEX';
  if (n.includes('PAC')) return 'PAC';
  return '';
}

async function ogAugmentFreight(text: string, phone: string | null) {
  if (!/R\$\s*\d/i.test(text) || !/(\bPAC\b|\bSEDEX\b|j\s*&\s*t)/i.test(text)) return text;
  let det: any;
  try { det = await ogRpc('fn_saida_freight_completeness_detectar_v1', { p_agente_slug: OG_AGENT, p_texto: text }); }
  catch { return text; }
  if (det?.bloquear !== true || !phone) return text;
  let snap: any;
  try { snap = await ogRpc('fn_joao_freight_latest_by_phone_v1', { p_phone: phone }); }
  catch { return text; }
  if (!snap?.ok || !Array.isArray(snap?.opcoes)) return text;
  const missing = new Set((det?.missing_services || []).map((x: any) => String(x).toUpperCase()));
  const parts: string[] = [];
  for (const o of snap.opcoes) {
    const key = ogServiceKey(o?.servico);
    if (!key) continue;
    const miss = missing.has(key.toUpperCase()) || (key === 'J&T' && missing.has('J&T'));
    if (!miss && !ogMentionedService(text, key)) continue;
    const prazo = String(o?.prazo_formatado || '').trim() || `${o?.prazo_dias} dia${Number(o?.prazo_dias) === 1 ? '' : 's'} úteis`;
    if (prazo && ogMentionedService(text, key)) parts.push(`${o.servico}: ${prazo}`);
  }
  if (!parts.length) return text;
  return `${text}\n\nPrazos desta cotação: ${parts.join(' | ')}.`;
}

async function ogGuard(text: string, phone: string | null) {
  const d = await ogRpc('fn_saida_guarda_registrar', {
    p_agente_slug: OG_AGENT,
    p_texto: text,
    p_phone: phone,
    p_lead_id: null,
    p_turn_id: null,
    p_decision_id: null,
  });
  return { bloquear: d?.bloquear === true, registro: d?.registro ? String(d.registro) : null };
}

async function ogHumanTakeover(phone: string | null) {
  if (!phone) return { bloquear: false, motivo: 'phone_unavailable' };
  const d = await ogRpc('fn_joao_human_takeover_output_guard_v1', { p_phone: phone, p_window_minutes: 480 });
  return {
    bloquear: d?.bloquear === true,
    motivo: String(d?.motivo ?? 'unknown'),
    human_at: d?.human_at ?? null,
    signature: d?.signature ?? null,
  };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const observed = await ogObserveSubscriber(input, init);
  if (observed) return observed;

  const url = ogUrl(input);
  const raw = await ogRaw(input, init);
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; }
  catch { return ogBaseFetch(input, init); }

  let route = '';
  let text = '';
  let phone: string | null = null;
  let outboundToCustomer = false;

  const zapi = url.match(/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-([a-z0-9-]+)(?:\?|$)/i);
  if (zapi) {
    route = `zapi_${String(zapi[1]).toLowerCase()}`;
    outboundToCustomer = true;
    phone = ogDigits(body?.phone) || null;
    if (String(zapi[1]).toLowerCase() === 'text') text = String(body?.message ?? '');
  } else {
    const bc = url.match(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/([^/]+)\/send_message\/?(?:\?|$)/i);
    if (bc) {
      route = `botconversa_${String(body?.type ?? 'message').toLowerCase()}`;
      outboundToCustomer = true;
      phone = await ogPhoneBySubscriber(bc[1]);
      if (String(body?.type ?? '').toLowerCase() === 'text') text = String(body?.value ?? '');
    } else if (url.includes('/functions/v1/joao-tts')) {
      route = 'joao_tts';
      text = String(body?.texto ?? '');
    }
  }

  if (!route) return ogBaseFetch(input, init);

  try {
    if (outboundToCustomer) {
      if (!phone) {
        await ogAudit('human_takeover_guard_phone_unavailable', 'blocked', { route, motivo: 'phone_unavailable_fail_closed' });
        console.warn(JSON.stringify({ event: 'JOAO_HUMAN_TAKEOVER_PHONE_UNAVAILABLE', route }));
        return ogJson({ ok: false, error: 'human_takeover_guard_phone_unavailable' }, 503);
      }
      const human = await ogHumanTakeover(phone);
      if (human.bloquear) {
        await ogAudit('human_takeover_output_blocked', 'blocked', {
          route,
          motivo: human.motivo,
          human_at: human.human_at,
          signature: human.signature,
        });
        console.warn(JSON.stringify({ event: 'JOAO_HUMAN_TAKEOVER_BLOCKED', route, motivo: human.motivo }));
        return ogJson({ ok: false, error: 'human_takeover_active' }, 409);
      }
    }

    if (!text) return ogBaseFetch(input, init);

    const repaired = route === 'joao_tts' ? text : await ogAugmentFreight(text, phone);
    if (route === 'zapi_text') body.message = repaired;
    else if (route === 'botconversa_text') body.value = repaired;
    else body.texto = repaired;

    const verdict = await ogGuard(repaired, phone);
    if (verdict.bloquear) {
      console.warn(JSON.stringify({ event: 'JOAO_OUTPUT_GUARD_BLOCKED', route, registro: verdict.registro }));
      return ogJson({ ok: false, error: 'output_guard_blocked' }, 422);
    }

    const nextInit = { ...(init || {}), body: JSON.stringify(body) };
    return ogBaseFetch(input, nextInit);
  } catch (e: any) {
    console.error(JSON.stringify({ event: 'JOAO_OUTPUT_GUARD_UNAVAILABLE', route, error: String(e?.message ?? e).slice(0, 120) }));
    return ogJson({ ok: false, error: 'output_guard_unavailable' }, 503);
  }
};
