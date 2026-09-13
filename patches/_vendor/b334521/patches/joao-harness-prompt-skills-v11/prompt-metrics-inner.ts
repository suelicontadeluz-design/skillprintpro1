declare const Deno: any;

// Harness-only. Mede a requisição FINAL que chega ao provider depois dos advisors.
// Não guarda conteúdo: emite apenas números para um host impossível. A jaula do replay
// bloqueia a chamada e a própria trilha bloqueios[] vira o canal de telemetria.
const PM_BASE_FETCH = globalThis.fetch.bind(globalThis);
const PM_ADVISOR_MARKER = '[CORTEX SKILL ADVISOR v1]';

function pmUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function pmBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

function pmJsonChars(v: any): number {
  try { return JSON.stringify(v ?? null).length; } catch { return 0; }
}

async function pmEmit(m: Record<string, number | string | boolean>) {
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(m)) q.set(k, String(v));
    await PM_BASE_FETCH(`https://harness-metrics.invalid/prompt?${q.toString()}`, { method: 'GET' });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pmUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) {
    return PM_BASE_FETCH(input, init);
  }

  const raw = await pmBody(input, init);
  let rec: Record<string, number | string | boolean> | null = null;

  if (raw) {
    try {
      const body = JSON.parse(raw);
      const system = typeof body?.system === 'string' ? body.system : JSON.stringify(body?.system ?? '');
      const markerAt = system.indexOf(PM_ADVISOR_MARKER);
      rec = {
        request_chars: raw.length,
        system_chars: system.length,
        system_base_chars: markerAt >= 0 ? markerAt : system.length,
        advisor_added_chars: markerAt >= 0 ? system.length - markerAt : 0,
        messages_chars: pmJsonChars(body?.messages ?? []),
        tools_chars: pmJsonChars(body?.tools ?? []),
        message_count: Array.isArray(body?.messages) ? body.messages.length : 0,
        tool_count: Array.isArray(body?.tools) ? body.tools.length : 0,
        advisor_applied: markerAt >= 0,
        input_tokens: 0,
        output_tokens: 0,
      };
    } catch {
      rec = { parse_error: true };
    }
  }

  const res = await PM_BASE_FETCH(input, init);

  if (rec) {
    try {
      const body: any = await res.clone().json();
      rec.input_tokens = Number(body?.usage?.input_tokens ?? 0);
      rec.output_tokens = Number(body?.usage?.output_tokens ?? 0);
    } catch {}
    await pmEmit(rec);
  }

  return res;
};
