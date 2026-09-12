declare const Deno: any;

// João quantity ambiguity guard v1.1 — 12/09/2026
// Incidente real: "Seriam 32 brancos ou 16 de cada cor" chegou depois do CEP.
// O core tratava como conversa genérica e continuava com 64 unidades, podendo cotar/fretar pedido errado.
// Regra estreita: alternativa de distribuição por COR + contexto recente DTF UV + >=2 cores conhecidas.
// Nesse turno: resposta determinística de confirmação, zero tools, zero mutação de slots.
// v1.1: variantes de cor vêm preferencialmente de "N + cor" já confirmado; "contorno preto"
// não vira uma quarta variante e portanto "16 de cada cor" resolve para 48, não 64.
// Resolução curta subsequente (ex.: "16 de cada cor") recebe instrução forte no system para recalcular
// quantidade/produto/frete com os dados já confirmados; não força valores e não inventa preço/frete.

const QAG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const QAG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const QAG_VERSION = 'joao-quantity-ambiguity/v1.1';
const QAG_CONFIG_KEY = 'joao_quantity_color_split_ambiguity_v1_ativo';
const qagBaseFetch = globalThis.fetch.bind(globalThis);
let qagCfgAt = 0;
let qagCfg = false;

const COLORS: Array<{ canon: string; rx: RegExp }> = [
  { canon: 'branco', rx: /\bbranc[oa]s?\b/i },
  { canon: 'preto', rx: /\bpret[oa]s?\b/i },
  { canon: 'dourado', rx: /\bdourad[oa]s?\b/i },
  { canon: 'prateado', rx: /\bpratead[oa]s?\b/i },
  { canon: 'azul', rx: /\bazuis?\b/i },
  { canon: 'verde', rx: /\bverdes?\b/i },
  { canon: 'vermelho', rx: /\bvermelh[oa]s?\b/i },
  { canon: 'amarelo', rx: /\bamarel[oa]s?\b/i },
  { canon: 'rosa', rx: /\brosas?\b/i },
  { canon: 'roxo', rx: /\brox[oa]s?\b/i },
  { canon: 'lilás', rx: /\blil[aá]s\b/i },
  { canon: 'laranja', rx: /\blaranjas?\b/i },
  { canon: 'cinza', rx: /\bcinzas?\b/i },
  { canon: 'bege', rx: /\bbeges?\b/i },
];
const COLOR_WORD = '(branc[oa]s?|pret[oa]s?|dourad[oa]s?|pratead[oa]s?|azuis?|verdes?|vermelh[oa]s?|amarel[oa]s?|rosas?|rox[oa]s?|lil[aá]s|laranjas?|cinzas?|beges?)';

function qagUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function qagBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function qagText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function qagHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function qagDialogue(messages:any[]): Array<{role:string;text:string}> {
  const out:Array<{role:string;text:string}> = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || qagHasToolResult(m.content)) continue;
    const t = qagText(m.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    out.push({ role:String(m.role), text:t });
  }
  return out;
}
function qagLatestInbound(messages:any[]): string {
  const d = qagDialogue(messages);
  for (let i=d.length-1;i>=0;i--) if (d[i].role === 'user') return d[i].text;
  return '';
}
function qagRecentContext(req:any): string {
  const d = qagDialogue(req?.messages || []).slice(-12).map(x => `${x.role}:${x.text}`).join('\n');
  const sys = typeof req?.system === 'string' ? req.system.slice(-6000) : '';
  return `${sys}\n${d}`;
}
function qagCanonColor(label:string): string | null {
  for (const c of COLORS) if (c.rx.test(label)) return c.canon;
  return null;
}
function qagColorsIn(text:string): string[] {
  const hits:Array<{canon:string;idx:number}> = [];
  for (const c of COLORS) {
    const m = c.rx.exec(text);
    if (m && typeof m.index === 'number') hits.push({ canon:c.canon, idx:m.index });
  }
  return [...new Set(hits.sort((a,b)=>a.idx-b.idx).map(x=>x.canon))];
}
function qagCountedColorsIn(text:string): string[] {
  const rx = new RegExp(`\\b\\d{1,4}\\s+${COLOR_WORD}\\b`, 'gi');
  const out:string[] = [];
  for (const m of String(text || '').matchAll(rx)) {
    const canon = qagCanonColor(String(m[1] || ''));
    if (canon && !out.includes(canon)) out.push(canon);
  }
  return out;
}
function qagVariantColors(ctx:string): string[] {
  const counted = qagCountedColorsIn(ctx);
  if (counted.length >= 2) return counted;
  return qagColorsIn(ctx);
}
function qagJoinColors(colors:string[]): string {
  const u = [...new Set(colors)];
  if (u.length <= 1) return u[0] || '';
  if (u.length === 2) return `${u[0]} e ${u[1]}`;
  return `${u.slice(0,-1).join(', ')} e ${u[u.length-1]}`;
}
function qagAmbiguousColorSplit(text:string): {first:number; firstLabel:string; each:number} | null {
  const t = String(text || '').trim();
  const m = t.match(new RegExp(`^\\s*(?:seriam?|ser[aã]o|s[aã]o|ficariam?|ficam?)?\\s*(\\d{1,4})\\s+${COLOR_WORD}\\s+ou\\s+(\\d{1,4})\\s+de\\s+cada\\s+cor\\b[?.!\\s]*$`, 'i'));
  if (!m) return null;
  const first = Number(m[1]);
  const each = Number(m[3]);
  if (!(first > 0) || !(each > 0) || first > 10000 || each > 10000) return null;
  return { first, firstLabel:m[2], each };
}
function qagIsUvContext(ctx:string): boolean {
  return /\bdtf\s*uv\b|\badesivo(?:s)?\b/i.test(ctx);
}
function qagPreviousClarification(messages:any[]): string {
  const d = qagDialogue(messages);
  for (let i=d.length-1;i>=0;i--) {
    if (d[i].role === 'assistant' && /s[oó]\s+pra\s+eu\s+fechar\s+certo/i.test(d[i].text) && /de\s+cada\s+cor/i.test(d[i].text)) return d[i].text;
  }
  return '';
}
function qagResolution(text:string, previous:string): {mode:'each'|'single'; n:number} | null {
  if (!previous) return null;
  let m = String(text || '').trim().match(/^(?:quero\s+)?(\d{1,4})\s+de\s+cada\s+cor[?.!\s]*$/i);
  if (m) return { mode:'each', n:Number(m[1]) };
  m = String(text || '').trim().match(/^(?:quero\s+)?(\d{1,4})\s+(?:branc[oa]s?)(?:\s+no\s+total)?[?.!\s]*$/i);
  if (m) return { mode:'single', n:Number(m[1]) };
  return null;
}
async function qagEnabled(): Promise<boolean> {
  if (Date.now() - qagCfgAt < 15000) return qagCfg;
  qagCfgAt = Date.now();
  try {
    const r = await qagBaseFetch(`${QAG_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.${encodeURIComponent(QAG_CONFIG_KEY)}&limit=1`, {
      headers:{ apikey:QAG_SERVICE, authorization:`Bearer ${QAG_SERVICE}` }, signal:AbortSignal.timeout(1200),
    });
    if (r.ok) {
      const rows = await r.json().catch(()=>[]);
      if (Array.isArray(rows) && rows.length) qagCfg = rows[0]?.valor_bool === true;
    }
  } catch {}
  return qagCfg;
}
async function qagAudit(evento:string, detalhe:any) {
  try {
    await qagBaseFetch(`${QAG_URL}/rest/v1/sistema_logs`, {
      method:'POST',
      headers:{ 'content-type':'application/json', apikey:QAG_SERVICE, authorization:`Bearer ${QAG_SERVICE}`, prefer:'return=minimal' },
      body:JSON.stringify({ agente_slug:'agente-noturno', funcao:'joao-quantity-ambiguity', versao:QAG_VERSION, nivel:'info', categoria:'qualification_runtime', evento, status:'applied', mensagem:evento, detalhe }),
      signal:AbortSignal.timeout(1200),
    });
  } catch {}
}
function qagPatchAnthropic(original:string, message:string): string | null {
  try {
    const body = JSON.parse(original);
    if (!body || typeof body !== 'object') return null;
    body.content = [{ type:'text', text:JSON.stringify({
      responde:true,
      mensagem:message,
      tema:'adesivo_uv',
      encaminhou_venda:false,
      etapa:'orcamento',
    }) }];
    body.stop_reason = 'end_turn';
    body.stop_sequence = null;
    return JSON.stringify(body);
  } catch { return null; }
}
function qagEnrichResolutionRequest(req:any, resolution:{mode:'each'|'single';n:number}, colors:string[]): any {
  const count = resolution.mode === 'each' ? colors.length : 1;
  const total = resolution.n * Math.max(count,1);
  const dist = resolution.mode === 'each'
    ? colors.map(c => `${resolution.n} ${c}`).join(', ')
    : `${resolution.n} branco`;
  const rule = `\n[CORTEX QUANTIDADE RESOLVIDA v1.1]\nO cliente acabou de resolver a ambiguidade de quantidade que voce perguntou no turno anterior. Interpretacao deterministica: ${dist}; total=${total}. Isto SUBSTITUI a quantidade anterior. Preserve medida, produto e CEP ja confirmados. Recalcule o produto com calcular_rendimento_uv usando a medida ja conhecida e quantidade_desejada=${total}. Depois cote o frete com o CEP ja conhecido. Nao reutilize preco/produto anterior se a quantidade mudou. Nao invente preco, frete ou cobertura. Atualize o slot quantidade para uma descricao explicita dessa distribuicao.\n[/CORTEX QUANTIDADE RESOLVIDA]`;
  return { ...req, system:String(req?.system ?? '') + rule };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = qagUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return qagBaseFetch(input, init);
  if (!(await qagEnabled())) return qagBaseFetch(input, init);

  const raw = await qagBody(input, init);
  if (!raw) return qagBaseFetch(input, init);
  let req:any;
  try { req = JSON.parse(raw); } catch { return qagBaseFetch(input, init); }
  if (!Array.isArray(req?.messages) || req?.stream === true) return qagBaseFetch(input, init);

  const inbound = qagLatestInbound(req.messages);
  const ctx = qagRecentContext(req);
  const colors = qagVariantColors(ctx);
  const ambiguous = qagAmbiguousColorSplit(inbound);

  if (ambiguous && qagIsUvContext(ctx) && colors.length >= 2) {
    const colorList = qagJoinColors(colors.slice(0,5));
    const firstLabel = String(ambiguous.firstLabel).toLowerCase();
    const clarification = `Só pra eu fechar certo: você quer ${ambiguous.first} adesivos ${firstLabel} no total ou ${ambiguous.each} de cada cor${colorList ? ` (${colorList})` : ''}?`;

    const res = await qagBaseFetch(input, init);
    if (!res.ok) return res;
    let original:string;
    try { original = await res.clone().text(); } catch { return res; }
    const patched = qagPatchAnthropic(original, clarification);
    if (!patched) return res;
    void qagAudit('color_split_ambiguity_blocked_before_tools', { first:ambiguous.first, each:ambiguous.each, variant_colors:colors.slice(0,5), tools_allowed:false, slots_mutation_allowed:false });
    const headers = new Headers(res.headers); headers.delete('content-length'); headers.set('x-cortex-quantity-ambiguity', QAG_VERSION);
    return new Response(patched, { status:res.status, statusText:res.statusText, headers });
  }

  const previous = qagPreviousClarification(req.messages);
  const resolution = qagResolution(inbound, previous);
  if (resolution && qagIsUvContext(ctx) && colors.length >= 2) {
    const useColors = colors.slice(0,5);
    const enriched = qagEnrichResolutionRequest(req, resolution, useColors);
    void qagAudit('color_split_resolution_enriched', { mode:resolution.mode, n:resolution.n, variant_colors:useColors, total:resolution.n * (resolution.mode === 'each' ? useColors.length : 1) });
    return qagBaseFetch(input, { ...init, body:JSON.stringify(enriched) });
  }

  return qagBaseFetch(input, init);
};
