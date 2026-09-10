declare const Deno: any;

// João Qualification Production Gate v1.5 — 10/09/2026
// v1.5: reconhece correio/correios como intenção logística do turno atual ao faltar CEP.
// Baseada em falhas orgânicas do dia:
// - não transforma rejeição, suporte, histórico/layout ou dúvida informativa em nova sondagem;
// - consulta de preço de tabela (metro/A3/A4/unidade) não exige quantidade só para responder informação;
// - recupera produto/quantidade explícitos das mensagens recentes do próprio cliente quando a FICHA ficou atrás;
// - preserva precedência CLOSING > WAITING > LOGISTICS > QUALIFICATION e o parser de CEP da v1.3.
// Sem autoridade de preço, frete, cobrança ou efeito externo.

const QG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const QG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const qgBaseFetch = globalThis.fetch.bind(globalThis);
const QG_VERSION = 'joao-qualification-gate/v1.5';
let qgCfgAt = 0;
let qgCfg = false;

function qgUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function qgBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function qgEnabled(): Promise<boolean> {
  if (Date.now() - qgCfgAt < 15000) return qgCfg;
  qgCfgAt = Date.now();
  try {
    const r = await qgBaseFetch(`${QG_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_qualification_gate_ativo&limit=1`, {
      headers: { apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}` }, signal: AbortSignal.timeout(2500),
    });
    const rows = r.ok ? await r.json() : [];
    qgCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { qgCfg = false; }
  return qgCfg;
}
function qgText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function qgHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function qgInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || qgHasToolResult(m?.content)) continue;
    const t = qgText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function qgJourneyStage(system: string): string {
  const matches = [...String(system || '').matchAll(/\[CORTEX JOURNEY v1 stage=([A-Z_]+)/g)];
  return matches.length ? String(matches[matches.length - 1][1]) : 'UNKNOWN';
}
function qgJsonValueAfter(text: string, marker: string, from = 0): any | null {
  const mi = text.indexOf(marker, from); if (mi < 0) return null;
  let start = -1;
  for (let i = mi + marker.length; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') { start = i; break; }
    if (!/\s|=/.test(text[i])) break;
  }
  if (start < 0) return null;
  const opener = text[start]; const closer = opener === '{' ? '}' : ']';
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
function qgQuestion(system: string): string {
  const tag = '[VOCÊ ACABOU DE PERGUNTAR:'; const i = system.lastIndexOf(tag); if (i < 0) return '';
  const e = system.indexOf('O CLIENTE RESPONDEU:', i); if (e < 0) return '';
  return system.slice(i + tag.length, e).replace(/^\s*["“]|["”]\s*$/g, '').trim();
}
function qgShortInt(text: string): number | null {
  const c = String(text || '').trim();
  if (!c || c.length > 80 || /\d\s*[x×]\s*\d/i.test(c) || /\d+[,.]\d+/.test(c) || /\b\d{8}\b/.test(c)) return null;
  const m = c.match(/(?:^|\D)(\d{1,5})(?:\D|$)/); if (!m) return null;
  const n = Number(m[1]); return Number.isInteger(n) && n > 0 ? n : null;
}
function qgExplicitQuantity(text: string): number | null {
  const c = String(text || '');
  const m = c.match(/\b(\d{1,5})\s*(?:c[oó]pias?|unidades?|pe[cç]as?|adesivos?|camisetas?|camisas?|moletons?|folhas?|metros?|sacolas?|ecobags?|capinhas?|artes?|arquivos?)\b/i);
  if (m) {
    const n = Number(m[1]); if (Number.isInteger(n) && n > 0) return n;
  }
  if (/\b(?:um|uma)\s+(?:adesivo|camiseta|camisa|moletom|sacola|ecobag|capinha|c[oó]pia|unidade|pe[cç]a|folha|metro)\b/i.test(c)) return 1;
  return null;
}
function qgMultiQuantityEvidence(text: string): boolean {
  let c = String(text || '').toLowerCase();
  c = c.replace(/\b\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?(?:\s*(?:cm|mm|m))?/gi, ' ');
  c = c.replace(/\b\d+[,.]\d+\s*(?:cm|mm|m)?\b/gi, ' ');
  const nums = [...c.matchAll(/\b\d{1,5}\b/g)].map(x => Number(x[0])).filter(n => n > 0 && n < 100000);
  if (nums.length < 2) return false;
  return /\b(menor|maior|outros?|cada|c[oó]pias?|unidades?|pe[cç]as?|adesivos?|artes?|tamanhos?|modelos?)\b/i.test(c);
}
function qgFamilyText(text: string): string | null {
  const t = String(text || '').toLowerCase();
  if (/dtf\s*uv|adesiv.*uv/.test(t)) return 'dtf_uv';
  if (/dtf\s*(?:textil|t[eê]xtil)/.test(t)) return 'dtf_textil';
  if (/\bdtf\b/.test(t) && /tecido|algod[aã]o|camiset|sacola|ecobag|moletom|polo/.test(t)) return 'dtf_textil';
  if (/camiset|baby\s*look|oversized|moletom|polo/.test(t)) return 'apparel';
  if (/caneca|copo/.test(t)) return 'drinkware';
  if (/sacola|ecobag/.test(t)) return 'bag';
  return null;
}
function qgFamilySlots(slots: any): string | null { return qgFamilyText(String(slots?.produto ?? '')); }
function qgCanonicalProduct(fam: string, text: string): string {
  if (fam === 'dtf_uv') return 'dtf_uv';
  if (fam === 'dtf_textil') return 'dtf_textil';
  if (fam === 'apparel') {
    const t = String(text || '').toLowerCase();
    if (/moletom/.test(t)) return 'moletom'; if (/polo/.test(t)) return 'polo'; if (/baby\s*look/.test(t)) return 'baby_look';
    return 'camiseta';
  }
  if (fam === 'drinkware') return /caneca/i.test(text) ? 'caneca' : 'copo';
  if (fam === 'bag') return /ecobag/i.test(text) ? 'ecobag' : 'sacola';
  return fam;
}
function qgRecentProduct(messages: any[]): { fam: string; product: string; text: string; index: number } | null {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0 && seen < 12; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || qgHasToolResult(m?.content)) continue;
    const t = qgText(m?.content); if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    seen++;
    const fam = qgFamilyText(t);
    if (fam) return { fam, product: qgCanonicalProduct(fam, t), text: t, index: i };
  }
  return null;
}
function qgRecentQuantity(messages: any[], fromIndex: number): number | null {
  const start = Math.max(0, fromIndex);
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || qgHasToolResult(m?.content)) continue;
    const t = qgText(m?.content); if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    const explicit = qgExplicitQuantity(t); if (explicit) return explicit;
    const short = qgShortInt(t);
    if (short) {
      for (let j = i - 1; j >= Math.max(start, i - 3); j--) {
        if (messages[j]?.role !== 'assistant') continue;
        const q = qgText(messages[j]?.content);
        if (/\b(quant|quantas|quantos|c[oó]pias?|unidades?|pe[cç]as?|adesivos?|camisetas?)\b/i.test(q)) return short;
      }
    }
  }
  return null;
}
function qgShippingProof(text: string): string | null {
  if (/\b(retir|buscar|busco|vou buscar)\w*/i.test(text)) return 'retirada';
  if (/\b(motoboy|moto)\b/i.test(text)) return 'motoboy';
  if (/\b(envio|enviar|receber|entrega|correios|transportadora)\b/i.test(text)) return 'envio';
  return null;
}
function qgCepProof(text: string): string | null {
  const t = String(text || '');
  const labeled = t.match(/\bcep\b[^0-9]{0,12}(\d{2})[.\s-]?(\d{3})[.\s-]?(\d{3})\b/i);
  if (labeled) return `${labeled[1]}${labeled[2]}${labeled[3]}`;
  const standard = t.match(/\b(\d{5})[-.\s]?(\d{3})\b/);
  if (standard) return `${standard[1]}${standard[2]}`;
  const grouped = t.match(/\b(\d{2})[.\s-](\d{3})[.\s-](\d{3})\b/);
  if (grouped) return `${grouped[1]}${grouped[2]}${grouped[3]}`;
  return null;
}
function qgBuildContext(system: string, inbound: string, messages: any[]): { slots: any; evalSlots: any; invalidations: any[]; switched: boolean; multiQty: boolean; recoveredProduct: boolean; recoveredQuantity: boolean } {
  const f = system.lastIndexOf('[FICHA:');
  const s0 = f >= 0 ? qgJsonValueAfter(system, 'slots=', f) : null;
  const inv0 = f >= 0 ? qgJsonValueAfter(system, 'invalidations=', f) : null;
  const s = s0 && typeof s0 === 'object' && !Array.isArray(s0) ? { ...s0 } : {};
  let invalidations = Array.isArray(inv0) ? inv0.filter((x: any) => x && typeof x === 'object') : [];
  const q = qgQuestion(system).toLowerCase();
  const inboundFam = qgFamilyText(inbound);
  let slotFam = qgFamilySlots(s);
  const recent = qgRecentProduct(messages);
  let recoveredProduct = false, recoveredQuantity = false;

  const switched = !!(inboundFam && slotFam && inboundFam !== slotFam);
  if (inboundFam && (!slotFam || switched)) {
    s.produto = qgCanonicalProduct(inboundFam, inbound);
    slotFam = inboundFam;
    if (switched) { delete s.quantidade; delete s.cep; delete s.cep_confirmado_para_envio; delete s.envio_retirada; delete s.modalidade_logistica; }
  } else if (!slotFam && recent) {
    s.produto = recent.product;
    slotFam = recent.fam;
    recoveredProduct = true;
  }

  const explicitQty = qgExplicitQuantity(inbound);
  const multiQty = qgMultiQuantityEvidence(inbound);
  if (!(Number(s.quantidade) > 0)) {
    if (explicitQty) s.quantidade = explicitQty;
    else if (/quant|c[oó]pia|unidade|pe[cç]a|quantas|quantos/.test(q)) {
      const n = qgShortInt(inbound); if (n) s.quantidade = n;
    }
    if (!(Number(s.quantidade) > 0) && recent && (!inboundFam || recent.fam === inboundFam)) {
      const n = qgRecentQuantity(messages, recent.index);
      if (n) { s.quantidade = n; recoveredQuantity = true; }
    }
  }

  const inboundCep = qgCepProof(inbound);
  const cepProven = !!inboundCep;
  if (!s.cep && (q.includes('cep') || /\bcep\b/i.test(inbound)) && inboundCep) s.cep = inboundCep;
  const shipping = qgShippingProof(inbound);
  if (!s.envio_retirada && /(retirada|retirar|envio|receber|buscar|motoboy)/.test(q) && shipping) s.envio_retirada = shipping;

  invalidations = invalidations.filter((x: any) => {
    const slot = String(x?.slot ?? '');
    if (slot === 'produto' && (inboundFam || recoveredProduct)) return false;
    if (slot === 'quantidade' && (explicitQty || multiQty || recoveredQuantity)) return false;
    if ((slot === 'cep' || slot === 'cep_confirmado_para_envio') && cepProven) return false;
    if ((slot === 'envio_retirada' || slot === 'modalidade_logistica') && shipping) return false;
    return true;
  });
  const evalSlots = { ...s };
  if (!(Number(evalSlots.quantidade) > 0) && multiQty) evalSlots.quantidade = 1;
  return { slots: s, evalSlots, invalidations, switched, multiQty, recoveredProduct, recoveredQuantity };
}
async function qgEval(snapshot: any): Promise<any | null> {
  try {
    const r = await qgBaseFetch(`${QG_URL}/rest/v1/rpc/fn_qualification_evaluate_v2`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}` },
      body: JSON.stringify({ p_snapshot: snapshot, p_as_of: new Date().toISOString() }), signal: AbortSignal.timeout(3000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
function qgNonQuoteTurn(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /valor\s+ficou\s+acima|acima\s+do\s+que.{0,80}esper|agrade[cç]o.{0,80}aten[cç][aã]o|deixa\s+pra\s+l[aá]|n[aã]o\s+tenho\s+interesse|ficou\s+caro/.test(t)
    || /site.{0,30}fora\s+do\s+ar|fora\s+do\s+ar|meus\s+pontos|com\s+os\s+pontos|\blogin\b|\bcadastro\b|hist[oó]rico|pedido\s+passado|foto\s+do\s+layout|ver\s+o\s+layout|puxar\s+pelo|consegue\s+confirmar\s+pra\s+mim|n[aã]o\s+lembro\s+agora/.test(t)
    || /voc[eê]s\s+fazem\s+direto|posso\s+comprar.{0,40}adesivo|pode\s+comprar.{0,40}adesivo|fazer\s+aqui\s+em\s+casa|como\s+funciona|como\s+preciso\s+mandar|imagens?.{0,30}(soltas?|pdf)|arquivos?.{0,30}(soltos?|pdf)/.test(t);
}
function qgCatalogPriceInquiry(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /(?:pre[cç]o|valor|quanto[^\n]{0,20})[^\n]{0,50}(?:metro|folha\s*a[34]|por\s+unidade)/.test(t)
    || /(?:metro|folha\s*a[34]|por\s+unidade)[^\n]{0,50}(?:pre[cç]o|valor|quanto)/.test(t);
}
function qgCommercialIntent(text: string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|cot(?:ar|e)|pre[cç]o|valor|quanto|total|calcula|calcular|frete|cep|envio|entrega|retirada|prazo|pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado))\b/i.test(text);
}
function qgStrongCommercialIntent(text: string): boolean {
  return /\b(or[cç]amento|or[cç]ar|cota[cç][aã]o|cot(?:ar|e)|quanto\s+(?:fica|custa|sai|sairia|t[aá])|qual\s+(?:o\s+)?valor|pre[cç]o|valor\s+por|calcula|calcular|frete|cep|prazo)\b/i.test(text);
}
function qgShouldEnforce(status: string, inbound: string, journeyStage: string): { enforce: boolean; reason: string } {
  if (journeyStage === 'CLOSING') return { enforce: false, reason: 'PRECEDENCE_CLOSING' };
  if (journeyStage === 'WAITING') return { enforce: false, reason: 'PRECEDENCE_WAITING' };
  if (qgNonQuoteTurn(inbound)) return { enforce: false, reason: 'NON_QUOTE_CURRENT_TURN' };
  if (status === 'HOLD_MISSING_QUANTITY' && qgCatalogPriceInquiry(inbound)) return { enforce: false, reason: 'CATALOG_PRICE_WITHOUT_QUANTITY' };
  if (status === 'HOLD_MISSING_CEP_FOR_SHIPPING') {
    const shippingNow = /\b(frete|cep|envio|entrega|correio|correios|sedex|pac|motoboy|transportadora)\b/i.test(inbound);
    return { enforce: shippingNow && (journeyStage === 'LOGISTICS' || journeyStage === 'QUALIFICATION' || journeyStage === 'UNKNOWN'), reason: shippingNow ? 'SHIPPING_CURRENT_TURN' : 'NO_SHIPPING_CURRENT_TURN' };
  }
  if (!qgCommercialIntent(inbound)) return { enforce: false, reason: 'NO_COMMERCIAL_INTENT_CURRENT_TURN' };
  if (journeyStage === 'QUALIFICATION' || journeyStage === 'LOGISTICS' || journeyStage === 'UNKNOWN') return { enforce: true, reason: 'COMMERCIAL_STAGE' };
  return { enforce: qgStrongCommercialIntent(inbound), reason: qgStrongCommercialIntent(inbound) ? 'STRONG_COMMERCIAL_INTENT' : 'CONVERSATION_NOT_STRONG_ENOUGH' };
}
function qgDecision(status: string, slots: any): any | null {
  const fam = qgFamilySlots(slots);
  if (status === 'HOLD_PRODUCT_CONFLICT' || status === 'HOLD_TOPIC_SHIFT_REQUALIFY') return { responde: true, mensagem: 'Só pra eu não misturar com o pedido anterior: qual produto você quer orçar agora?', tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  if (status === 'HOLD_MISSING_PRODUCT') return { responde: true, mensagem: 'Qual produto você quer orçar?', tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  if (status === 'HOLD_MISSING_QUANTITY') {
    const msg = fam === 'apparel' ? 'Quantas peças você precisa?' : fam === 'dtf_textil' ? 'Quantas cópias dessa arte você precisa?' : fam === 'dtf_uv' ? 'Quantos adesivos você precisa?' : 'Qual quantidade você precisa?';
    return { responde: true, mensagem: msg, tema: 'sondagem', encaminhou_venda: false, etapa: 'sondagem', slots };
  }
  if (status === 'HOLD_MISSING_CEP_FOR_SHIPPING') return { responde: true, mensagem: 'Me passa o CEP de entrega que eu calculo as opções de frete.', tema: 'frete', encaminhou_venda: false, etapa: 'orcamento', slots };
  return null;
}
function qgAnthropic(decision: any): Response {
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({ id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, type: 'message', role: 'assistant', model: 'cortex-qualification-gate', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: Math.max(1, Math.ceil(text.length / 4)) } }), { status: 200, headers: { 'content-type': 'application/json', 'x-cortex-qualification-gate': QG_VERSION } });
}
async function qgAudit(evento: string, status: string, inbound: string, ctx: any, extra: any = {}) {
  try {
    await qgBaseFetch(`${QG_URL}/rest/v1/sistema_logs`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: QG_SERVICE, authorization: `Bearer ${QG_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'qualification-production-gate', versao: QG_VERSION, nivel: 'info', categoria: 'skill_runtime', evento, status: 'applied', mensagem: status, detalhe: { skill_ref: 'qualification', qualification_status: status, authority_granted: evento === 'qualification_hold_enforced', authority_scope: 'cognitive_pre_quote_gate', external_authority: false, effect_class: evento === 'qualification_hold_enforced' ? 'MODEL_BYPASS' : 'NONE', inbound: inbound.slice(0, 240), product_switched: !!ctx?.switched, multi_quantity_evidence: !!ctx?.multiQty, recovered_product: !!ctx?.recoveredProduct, recovered_quantity: !!ctx?.recoveredQuantity, ...extra } }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = qgUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return qgBaseFetch(input, init);
  if (!(await qgEnabled())) return qgBaseFetch(input, init);
  const raw = await qgBody(input, init); if (!raw) return qgBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return qgBaseFetch(input, init); }
  if (typeof body?.system !== 'string' || !Array.isArray(body?.messages)) return qgBaseFetch(input, init);

  const inbound = qgInbound(body.messages); if (!inbound) return qgBaseFetch(input, init);
  const journeyStage = qgJourneyStage(body.system);
  if (journeyStage === 'CLOSING' || journeyStage === 'WAITING') {
    void qgAudit('qualification_suppressed_by_precedence', journeyStage === 'CLOSING' ? 'SUPPRESSED_BY_CLOSING' : 'SUPPRESSED_BY_WAITING', inbound, {}, { journey_stage: journeyStage, precedence_winner: journeyStage.toLowerCase() });
    return qgBaseFetch(input, init);
  }

  const ctx = qgBuildContext(body.system, inbound, body.messages);
  const q = await qgEval({ source: `${QG_VERSION}:premodel`, slots_after: ctx.evalSlots, invalidations: ctx.invalidations, produto_macro: String(ctx.evalSlots?.produto ?? ''), cep_disponivel: /^\d{8}$/.test(String(ctx.evalSlots?.cep ?? '').replace(/\D/g, '')), latest_inbound_message: inbound, source_temporality: 'PRE_MODEL_CURRENT_TURN', quantity_evidence_mode: ctx.multiQty ? 'MULTI_LINE_ITEMS' : 'SINGLE_OR_SLOT' });
  const status = String(q?.status ?? '');

  if (journeyStage === 'LOGISTICS' && ['HOLD_MISSING_PRODUCT','HOLD_MISSING_QUANTITY','HOLD_PRODUCT_CONFLICT','HOLD_TOPIC_SHIFT_REQUALIFY'].includes(status)) {
    void qgAudit('qualification_suppressed_by_precedence', status, inbound, ctx, { journey_stage: journeyStage, precedence_winner: 'logistics' });
    return qgBaseFetch(input, init);
  }

  const decision = qgDecision(status, ctx.slots);
  const gate = qgShouldEnforce(status, inbound, journeyStage);
  if (decision && gate.enforce) {
    void qgAudit('qualification_hold_enforced', status, inbound, ctx, { journey_stage: journeyStage, enforce_reason: gate.reason });
    return qgAnthropic(decision);
  }
  if (status.startsWith('HOLD_')) {
    void qgAudit('qualification_hold_deferred', status, inbound, ctx, { journey_stage: journeyStage, defer_reason: gate.reason });
  }
  return qgBaseFetch(input, init);
};
