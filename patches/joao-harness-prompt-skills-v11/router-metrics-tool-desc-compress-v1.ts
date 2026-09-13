declare const Deno: any;

// Harness-only. Mantem as 12 tools e seus input_schema intactos.
// Quando o produto ja esta provado como DTF, encurta APENAS a descricao de
// orcar_camisetas. Mudanca explicita de assunto ou produto desconhecido => no-op.
// Tambem preserva a telemetria externa do Router.
const TC_BASE_FETCH = globalThis.fetch.bind(globalThis);

function tcUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function tcBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}
function tcRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
function tcJsonAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  const start = text.indexOf('{', mi + marker.length); if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function tcNormProduct(v: any): 'dtf_textil' | 'dtf_uv' | null {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('dtf_textil') || /dtf\s*t[eê]xtil/.test(s)) return 'dtf_textil';
  if (s.includes('dtf_uv') || /dtf\s*uv/.test(s)) return 'dtf_uv';
  return null;
}
function tcFamily(system: string): 'dtf_textil' | 'dtf_uv' | null {
  if (system.includes('[O CLIENTE MUDOU DE ASSUNTO:')) return null;
  const fichaAt = system.lastIndexOf('[FICHA:');
  if (fichaAt >= 0) {
    const slots = tcJsonAfter(system, 'slots=', fichaAt);
    const p = tcNormProduct(slots?.produto);
    if (p) return p;
  }
  const origemAt = system.lastIndexOf('[ORIGEM: anúncio "');
  if (origemAt >= 0) {
    const fim = system.indexOf('"', origemAt + '[ORIGEM: anúncio "'.length);
    const origem = fim > origemAt ? system.slice(origemAt, fim + 1) : system.slice(origemAt, origemAt + 180);
    return tcNormProduct(origem);
  }
  return null;
}
function tcChars(v: any): number { try { return JSON.stringify(v ?? null).length; } catch { return 0; } }
async function tcEmit(path: string, values: Record<string, string | number | boolean>) {
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) q.set(k, String(v));
    await TC_BASE_FETCH(`https://harness-metrics.invalid/${path}?${q.toString()}`, { method: 'GET' });
  } catch {}
}

const COMPACT_CAMISETA = 'Orca camisetas/vestuario personalizado quando o cliente quer comprar as pecas. Nao use para DTF textil, DTF UV, copos ou packs. Preserve os campos do input_schema.';

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = tcUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return TC_BASE_FETCH(input, init);

  const raw = await tcBody(input, init);
  let useInput = input, useInit = init;
  let family: string | null = null;
  let changed = false;
  let beforeChars = 0, afterChars = 0;

  if (raw) {
    try {
      const body = JSON.parse(raw);
      if (typeof body?.system === 'string' && Array.isArray(body?.tools)) {
        family = tcFamily(body.system);
        beforeChars = tcChars(body.tools);
        if (family) {
          const tools = body.tools.map((t: any) => {
            if (String(t?.name ?? '') !== 'orcar_camisetas') return t;
            changed = true;
            return { ...t, description: COMPACT_CAMISETA };
          });
          body.tools = tools;
          afterChars = tcChars(tools);
          if (changed) [useInput, useInit] = tcRebuild(input, init, JSON.stringify(body));
        } else afterChars = beforeChars;
      }
    } catch {}
  }

  await tcEmit('tool-desc-compress', { family: family ?? 'unknown', changed, before_chars: beforeChars, after_chars: afterChars });
  const res = await TC_BASE_FETCH(useInput, useInit);
  await tcEmit('router', { routed: !!res.headers.get('x-cortex-skill-router') });
  return res;
};
