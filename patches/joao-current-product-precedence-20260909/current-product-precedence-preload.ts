declare const Deno: any;

// João Current Product Precedence Guard v1.1 — 09/09/2026
// Incidente Jeff 5521981317423: DTF UV recuperado do histórico contaminou um turno novo de camisa preta.
// Contrato: produto explicitamente citado no turno atual vence produto recuperado do histórico.
// v1.1: aceita plural de camisa/camiseta e grafias canônicas dtf_uv/dtf_textil.
// Esta camada NÃO precifica, NÃO cria produto, NÃO faz frete/pagamento e NÃO inventa capacidade.
// Ela apenas impede que uma resposta/slot carregue uma família antiga quando o cliente mudou explicitamente.
// Kill switch: public.sistema_config.chave = 'joao_current_product_precedence_ativo'.

const CP_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CP_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cpBaseFetch = globalThis.fetch.bind(globalThis);
const CP_VERSION = 'joao-current-product-precedence/v1.1';
let cpCfgAt = 0;
let cpCfg = false;

type Family = 'apparel' | 'dtf_uv' | 'dtf_textil' | 'drinkware' | 'bag';

function cpUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function cpBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function cpEnabled(): Promise<boolean> {
  if (Date.now() - cpCfgAt < 15000) return cpCfg;
  cpCfgAt = Date.now();
  try {
    const r = await cpBaseFetch(`${CP_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_current_product_precedence_ativo&limit=1`, {
      headers: { apikey: CP_SERVICE, authorization: `Bearer ${CP_SERVICE}` }, signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    cpCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { cpCfg = false; }
  return cpCfg;
}
function cpNorm(v: string): string {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function cpText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function cpHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function cpInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || cpHasToolResult(m?.content)) continue;
    const t = cpText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function cpFamily(text: string): Family | null {
  const t = cpNorm(text);
  // Produto físico explícito tem precedência sobre técnica citada na mesma frase.
  if (/\b(camis(?:a|eta)s?|baby\s*look|oversized|moletom|polo)\b/.test(t)) return 'apparel';
  if (/\b(canecas?|copos?)\b/.test(t)) return 'drinkware';
  if (/\b(sacolas?|ecobags?)\b/.test(t)) return 'bag';
  if (/dtf[\s_]*uv|adesiv.*uv/.test(t)) return 'dtf_uv';
  if (/dtf[\s_]*(?:textil|t[eê]xtil)/.test(t)) return 'dtf_textil';
  return null;
}
function cpCanonical(f: Family, inbound: string): string {
  const t = cpNorm(inbound);
  if (f === 'apparel') {
    if (/\bmoletom\b/.test(t)) return 'moletom';
    if (/\bpolo\b/.test(t)) return 'polo';
    if (/baby\s*look/.test(t)) return 'baby_look';
    return 'camiseta';
  }
  if (f === 'drinkware') return /\bcaneca/.test(t) ? 'caneca' : 'copo';
  if (f === 'bag') return /\becobag/.test(t) ? 'ecobag' : 'sacola';
  return f;
}
function cpStripStalePrefix(message: string, family: Family): { text: string; changed: boolean; reason: string | null } {
  let m = String(message || '');
  const before = m;
  if (family !== 'dtf_uv') {
    m = m.replace(/^(\s*(?:boa\s+(?:tarde|noite|dia)[!,.]?\s*)?)entendi:\s*(?:é|e)\s*dtf\s*uv[.!]?\s*/i, '$1');
  }
  if (family !== 'dtf_textil') {
    m = m.replace(/^(\s*(?:boa\s+(?:tarde|noite|dia)[!,.]?\s*)?)entendi:\s*(?:é|e)\s*dtf\s*(?:t[eê]xtil|textil)[.!]?\s*/i, '$1');
  }
  if (family === 'apparel' && /^(?:quantos\s+adesivos|qual\s+quantidade\b)/i.test(m.trim())) {
    m = 'Quantas peças você precisa?';
  }
  if (family === 'dtf_uv' && /^quantas\s+pe[cç]as\b/i.test(m.trim())) {
    m = 'Quantos adesivos você precisa?';
  }
  return { text: m.trim(), changed: m.trim() !== before.trim(), reason: m.trim() !== before.trim() ? 'CURRENT_PRODUCT_OVERRIDES_STALE_OUTPUT' : null };
}
async function cpAudit(detail: any) {
  try {
    await cpBaseFetch(`${CP_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:CP_SERVICE, authorization:`Bearer ${CP_SERVICE}`, prefer:'return=minimal' },
      body: JSON.stringify({ agente_slug:'agente-noturno', funcao:'current-product-precedence', versao:CP_VERSION, nivel:'info', categoria:'skill_runtime', evento:'current_product_precedence_applied', status:'applied', mensagem:detail?.family ?? 'product_switch', detalhe:{ ...detail, skill_ref:'qualification', effect_class:'COGNITIVE_GUARD', authority_granted:false, external_authority:false } }),
      signal: AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = cpUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return cpBaseFetch(input, init);
  if (!(await cpEnabled())) return cpBaseFetch(input, init);
  const raw = await cpBody(input, init); if (!raw) return cpBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return cpBaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return cpBaseFetch(input, init);
  const inbound = cpInbound(body.messages);
  const family = cpFamily(inbound);
  if (!inbound || !family) return cpBaseFetch(input, init);
  const canonical = cpCanonical(family, inbound);

  const response = await cpBaseFetch(input, init);
  if (!response.ok) return response;
  try {
    const payload = await response.clone().json();
    if (!Array.isArray(payload?.content) || payload.content.length !== 1 || payload.content[0]?.type !== 'text' || typeof payload.content[0]?.text !== 'string') return response;
    let decision: any; try { decision = JSON.parse(payload.content[0].text); } catch { return response; }
    if (!decision || typeof decision !== 'object' || typeof decision.mensagem !== 'string') return response;

    const oldProduct = String(decision?.slots?.produto ?? '');
    decision.slots = decision.slots && typeof decision.slots === 'object' ? { ...decision.slots } : {};
    decision.slots.produto = canonical;
    const fixed = cpStripStalePrefix(decision.mensagem, family);
    if (fixed.changed) decision.mensagem = fixed.text;
    const slotChanged = oldProduct !== canonical;
    if (!fixed.changed && !slotChanged) return response;

    payload.content[0].text = JSON.stringify(decision);
    const headers = new Headers(response.headers);
    headers.set('x-cortex-current-product-precedence', CP_VERSION);
    void cpAudit({ family, canonical, old_product: oldProduct || null, inbound: inbound.slice(0,240), message_rewritten: fixed.changed, reason: fixed.reason });
    return new Response(JSON.stringify(payload), { status:response.status, statusText:response.statusText, headers });
  } catch {
    return response;
  }
};