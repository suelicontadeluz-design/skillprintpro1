declare const Deno: any;

// Joao budget semantic preload v2 — 2026-09-06
// B2 + provenance-based modality guard of ingest-produtos-rd-semantica.
// Scope: only fn_consumir_operacao_financeira -> INSERT public.orcamentos inside gerar_pix.
// Does not change amount, payment, customer text, price, or financial authorization.

const B2_SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const B2_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const b2BaseFetch = globalThis.fetch.bind(globalThis);

const B2_METER_TOOLS = new Set([
  'calcular_dtf_metro',
  'calcular_dtf_por_arte',
  'calcular_dtf_uv_metro',
  'calcular_rendimento_uv',
]);
const B2_TTL_MS = 5 * 60 * 1000;

type B2Consumed = { operationId: string; leadId: string; sourceTool: string; components: any; consumedAt: number };
type B2Semantic = { porMetro: boolean; metros: number | null; precoPorMetro: number | null; origem: string };
const b2LastByLead = new Map<string, B2Consumed>();

function b2UrlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function b2BodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}
function b2PositiveNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function b2Prune(): void {
  const cutoff = Date.now() - B2_TTL_MS;
  for (const [lead, item] of b2LastByLead.entries()) if (item.consumedAt < cutoff) b2LastByLead.delete(lead);
  if (b2LastByLead.size <= 100) return;
  const oldest = [...b2LastByLead.entries()].sort((a, b) => a[1].consumedAt - b[1].consumedAt);
  for (const [lead] of oldest.slice(0, b2LastByLead.size - 100)) b2LastByLead.delete(lead);
}
function b2DirectSemantic(sourceTool: string, components: any): B2Semantic {
  const c = components && typeof components === 'object' ? components : {};
  const metros = b2PositiveNumber(c.metros) ?? b2PositiveNumber(c.consumo_m);
  const precoPorMetro = b2PositiveNumber(c.preco_por_metro);

  // Proveniencia estruturada vence o nome da ferramenta. Isso cobre fontes heterogeneas
  // (ex.: preco_de_ficha pode ser folha/pack/peca OU DTF por metro) sem ler texto livre.
  if (metros !== null) {
    return { porMetro: true, metros, precoPorMetro, origem: `components:${sourceTool || 'desconhecida'}` };
  }

  // Ferramentas canonicamente metricas continuam fail-closed se a medida deveria existir
  // mas nao veio: modalidade=metro, medida=NULL. Nunca fabricar 0 nem inferir de amount/texto.
  if (B2_METER_TOOLS.has(sourceTool)) {
    return { porMetro: true, metros: null, precoPorMetro, origem: `meter_tool_sem_medida:${sourceTool}` };
  }

  return { porMetro: false, metros: null, precoPorMetro: null, origem: sourceTool || 'desconhecida' };
}
async function b2LoadProductOperations(components: any): Promise<any[]> {
  const lista = Array.isArray(components?.componentes) ? components.componentes : [];
  const ids = lista
    .filter((x: any) => String(x?.kind || '') === 'produto')
    .map((x: any) => String(x?.operation_id || '').trim())
    .filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];
  const filter = encodeURIComponent(`in.(${ids.join(',')})`);
  const url = `${B2_SUPABASE_URL}/rest/v1/operacoes_financeiras?id=${filter}&select=id,kind,source_tool,components`;
  const res = await b2BaseFetch(url, {
    method: 'GET',
    headers: { apikey: B2_SERVICE_KEY, authorization: `Bearer ${B2_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`b2_componentes_http_${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
async function b2Semantic(meta: B2Consumed): Promise<B2Semantic> {
  if (meta.sourceTool !== 'fn_compor_total') return b2DirectSemantic(meta.sourceTool, meta.components);
  const produtos = await b2LoadProductOperations(meta.components);
  if (!produtos.length) return { porMetro: false, metros: null, precoPorMetro: null, origem: 'fn_compor_total_sem_produto_resolvido' };
  const semanticas = produtos.map((p: any) => b2DirectSemantic(String(p?.source_tool || ''), p?.components));
  const porMetro = semanticas.filter(s => s.porMetro);
  const foraMetro = semanticas.filter(s => !s.porMetro);
  if (!porMetro.length || foraMetro.length) {
    return { porMetro: porMetro.length > 0, metros: null, precoPorMetro: null, origem: foraMetro.length ? 'fn_compor_total_modalidade_mista' : 'fn_compor_total_nao_metro' };
  }
  const medidas = porMetro.map(s => s.metros);
  const metros = medidas.every(v => v !== null)
    ? Math.round((medidas as number[]).reduce((a, b) => a + b, 0) * 1000) / 1000
    : null;
  const precos = porMetro.map(s => s.precoPorMetro).filter((v): v is number => v !== null);
  const unicos = [...new Set(precos.map(v => Math.round(v * 10000) / 10000))];
  const precoPorMetro = precos.length === porMetro.length && unicos.length === 1 ? unicos[0] : null;
  return { porMetro: true, metros, precoPorMetro, origem: 'fn_compor_total_produtos_metro' };
}
function b2Rebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
async function b2CaptureConsume(input: RequestInfo | URL, init: RequestInit | undefined, response: Response): Promise<void> {
  if (!response.ok) return;
  const raw = await b2BodyText(input, init);
  let req: any;
  try { req = raw ? JSON.parse(raw) : null; } catch { return; }
  const operationId = String(req?.p_operation_id || '').trim();
  const leadId = String(req?.p_lead_id || '').trim();
  if (!operationId || !leadId) return;
  let data: any;
  try { data = await response.clone().json(); } catch { return; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.amount === null || row.amount === undefined) return;
  b2Prune();
  b2LastByLead.set(leadId, { operationId, leadId, sourceTool: String(row.source_tool || ''), components: row.components ?? null, consumedAt: Date.now() });
}
async function b2RewriteOrcamentos(input: RequestInfo | URL, init?: RequestInit): Promise<[RequestInfo | URL, RequestInit | undefined] | null> {
  const raw = await b2BodyText(input, init);
  let body: any;
  try { body = raw ? JSON.parse(raw) : null; } catch { return null; }
  if (!body) return null;
  const rows = Array.isArray(body) ? body : [body];
  let changed = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const hasHardcodedZero = Number(row.metros) === 0 || Number(row.preco_por_metro) === 0;
    if (!hasHardcodedZero) continue;
    const leadId = String(row.lead_id || '').trim();
    const meta = leadId ? b2LastByLead.get(leadId) : undefined;
    row.metros = null;
    row.preco_por_metro = null;
    changed = true;
    if (!meta || Date.now() - meta.consumedAt > B2_TTL_MS) continue;
    try {
      const sem = await b2Semantic(meta);
      if (sem.porMetro) {
        row.metros = sem.metros;
        row.preco_por_metro = sem.precoPorMetro;
      }
      console.log(JSON.stringify({ event: 'JOAO_ORCAMENTO_COMPONENTS_B2', source_tool: meta.sourceTool, origem: sem.origem, metros_preenchidos: row.metros !== null, preco_por_metro_preenchido: row.preco_por_metro !== null }));
    } catch (e: any) {
      console.error(JSON.stringify({ event: 'JOAO_ORCAMENTO_COMPONENTS_B2_RESOLVE_FAIL', error: String(e?.message ?? e).slice(0, 120) }));
    } finally {
      b2LastByLead.delete(leadId);
    }
  }
  if (!changed) return null;
  return b2Rebuild(input, init, JSON.stringify(Array.isArray(body) ? rows : rows[0]));
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = b2UrlOf(input);
  if (/\/rest\/v1\/rpc\/fn_consumir_operacao_financeira(?:\?|$)/i.test(url)) {
    const response = await b2BaseFetch(input, init);
    try { await b2CaptureConsume(input, init, response); } catch {}
    return response;
  }
  if (/\/rest\/v1\/orcamentos(?:\?|$)/i.test(url)) {
    const rewritten = await b2RewriteOrcamentos(input, init);
    if (rewritten) return b2BaseFetch(rewritten[0], rewritten[1]);
  }
  return b2BaseFetch(input, init);
};
