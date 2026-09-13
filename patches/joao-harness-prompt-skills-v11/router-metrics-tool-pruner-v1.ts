declare const Deno: any;

// Experimento harness-only: mantém a sonda externa do Router e poda SOMENTE tools
// incompatíveis quando a família do produto já está provada no contexto dinâmico.
// Produto indeterminado ou mudança explícita de assunto => mantém todas as tools.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/2c87962721f53fd919f8b964c4ee5b6ce9296049/patches/joao-harness-prompt-skills-v11/router-metrics-outer.ts";

const TP_BASE_FETCH = globalThis.fetch.bind(globalThis);

function tpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function tpBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}
function tpRebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
function tpJsonAfter(text: string, marker: string, from = 0): any | null {
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
function tpNormProduct(v: any): string | null {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('dtf_textil') || /dtf\s*t[eê]xtil/.test(s)) return 'dtf_textil';
  if (s.includes('dtf_uv') || /dtf\s*uv/.test(s)) return 'dtf_uv';
  return null;
}
function tpFamily(system: string): string | null {
  // Mudança explícita de produto: deixa o modelo com catálogo completo nesta v1.
  if (system.includes('[O CLIENTE MUDOU DE ASSUNTO:')) return null;

  const fichaAt = system.lastIndexOf('[FICHA:');
  if (fichaAt >= 0) {
    const slots = tpJsonAfter(system, 'slots=', fichaAt);
    const p = tpNormProduct(slots?.produto);
    if (p) return p;
  }

  // Só lê o bloco DINÂMICO de origem; não varre o SYSTEM estático.
  const origemAt = system.lastIndexOf('[ORIGEM: anúncio "');
  if (origemAt >= 0) {
    const fim = system.indexOf('"', origemAt + '[ORIGEM: anúncio "'.length);
    const origem = fim > origemAt ? system.slice(origemAt, fim + 1) : system.slice(origemAt, origemAt + 180);
    const p = tpNormProduct(origem);
    if (p) return p;
  }
  return null;
}
function tpChars(v: any): number { try { return JSON.stringify(v ?? null).length; } catch { return 0; } }
async function tpEmit(family: string | null, before: any[], after: any[]) {
  try {
    const q = new URLSearchParams({
      family: family ?? 'unknown',
      before_count: String(before.length), after_count: String(after.length),
      before_chars: String(tpChars(before)), after_chars: String(tpChars(after)),
    });
    await TP_BASE_FETCH(`https://harness-metrics.invalid/tool-prune?${q.toString()}`, { method: 'GET' });
  } catch {}
}

const REMOVE: Record<string, Set<string>> = {
  dtf_textil: new Set(['orcar_camisetas','calcular_rendimento_uv','calcular_dtf_uv_metro','calcular_copo','consultar_modelos']),
  dtf_uv: new Set(['orcar_camisetas','calcular_dtf_metro','calcular_dtf_por_arte','calcular_copo','consultar_modelos']),
};

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = tpUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return TP_BASE_FETCH(input, init);

  const raw = await tpBody(input, init);
  if (!raw) return TP_BASE_FETCH(input, init);
  let body: any;
  try { body = JSON.parse(raw); } catch { return TP_BASE_FETCH(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.tools)) return TP_BASE_FETCH(input, init);

  const family = tpFamily(body.system);
  const before = body.tools;
  const remove = family ? REMOVE[family] : null;
  const after = remove ? before.filter((t: any) => !remove.has(String(t?.name ?? ''))) : before;
  await tpEmit(family, before, after);
  if (after.length === before.length) return TP_BASE_FETCH(input, init);

  body.tools = after;
  const rebuilt = tpRebuild(input, init, JSON.stringify(body));
  return TP_BASE_FETCH(rebuilt[0], rebuilt[1]);
};
