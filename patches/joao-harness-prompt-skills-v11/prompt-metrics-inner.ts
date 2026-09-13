declare const Deno: any;

// Harness-only. Mede a requisição FINAL que chega ao provider depois dos advisors.
// Não guarda conteúdo do prompt/schema: emite só contagens, nome+tamanho de tools
// e booleanos estruturais de continuidade (nunca texto bruto do cliente/system).
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
function pmText(v: any): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(pmText).join('\n');
  if (v && typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    return Object.values(v).map(pmText).join('\n');
  }
  return '';
}
function pmIsToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function pmInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || pmIsToolResult(m?.content)) continue;
    const t = pmText(m?.content).trim();
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
async function pmEmit(path: string, m: Record<string, number | string | boolean>) {
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(m)) q.set(k, String(v));
    await PM_BASE_FETCH(`https://harness-metrics.invalid/${path}?${q.toString()}`, { method: 'GET' });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pmUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return PM_BASE_FETCH(input, init);

  const raw = await pmBody(input, init);
  let rec: Record<string, number | string | boolean> | null = null;
  let toolMetrics: Array<{ name: string; chars: number }> = [];

  if (raw) {
    try {
      const body = JSON.parse(raw);
      const system = typeof body?.system === 'string' ? body.system : JSON.stringify(body?.system ?? '');
      const markerAt = system.indexOf(PM_ADVISOR_MARKER);
      const tools = Array.isArray(body?.tools) ? body.tools : [];
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const inbound = pmInbound(messages);
      const bareNumber = /^\s*\d{1,4}\s*$/.test(inbound);
      const dimension = /^\s*\d{1,3}(?:[.,]\d+)?\s*[x×]\s*\d{1,3}(?:[.,]\d+)?\s*(?:cm)?\s*$/i.test(inbound);
      toolMetrics = tools.map((t: any) => ({ name: String(t?.name ?? ''), chars: pmJsonChars(t) }));
      rec = {
        request_chars: raw.length,
        system_chars: system.length,
        system_base_chars: markerAt >= 0 ? markerAt : system.length,
        advisor_added_chars: markerAt >= 0 ? system.length - markerAt : 0,
        messages_chars: pmJsonChars(messages),
        tools_chars: pmJsonChars(tools),
        message_count: messages.length,
        tool_count: tools.length,
        advisor_applied: markerAt >= 0,
        input_tokens: 0,
        output_tokens: 0,
        inbound_bare_number: bareNumber,
        inbound_dimension: dimension,
        system_has_30x40: /30\s*[x×]\s*40/i.test(system),
        system_has_quantity_question: /(quantas?\s+(?:c[oó]pias|unidades|pe[cç]as)|quantidade)/i.test(system),
        system_has_dimension_question: /(medida|largura|altura).{0,80}(?:cm|cent[ií]metr)/is.test(system),
        system_has_dtf_textil: /dtf\s*t[eê]xtil/i.test(system),
        system_has_banda: /\bbanda\b/i.test(system),
      };
    } catch { rec = { parse_error: true }; }
  }

  const res = await PM_BASE_FETCH(input, init);

  if (rec) {
    try {
      const body: any = await res.clone().json();
      rec.input_tokens = Number(body?.usage?.input_tokens ?? 0);
      rec.output_tokens = Number(body?.usage?.output_tokens ?? 0);
    } catch {}
    await pmEmit('prompt', rec);
    for (const t of toolMetrics) await pmEmit('tool', { name: t.name, chars: t.chars });
  }
  return res;
};
