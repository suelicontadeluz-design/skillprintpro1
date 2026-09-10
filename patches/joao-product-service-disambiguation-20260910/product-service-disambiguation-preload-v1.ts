declare const Deno: any;

// João Product/Service Disambiguation v1 — 10/09/2026
// Caso real +55 85: lead vindo de DTF respondeu "de caneca e camisa" e João inferiu produto pronto.
// Contrato: em contexto recente de DTF, substrato físico sem modalidade explícita NÃO autoriza inferir
// "produto pronto" nem "somente impressão". João deve esclarecer antes de precificar.
// Reusa o kill switch canônico da qualification skill; não cria gate nem autoridade nova.

const PD_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PD_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const pdBaseFetch = globalThis.fetch.bind(globalThis);
const PD_VERSION = 'joao-product-service-disambiguation/v1';
let pdCfgAt = 0;
let pdCfg = false;

function pdUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function pdBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function pdEnabled(): Promise<boolean> {
  if (Date.now() - pdCfgAt < 15000) return pdCfg;
  pdCfgAt = Date.now();
  try {
    const r = await pdBaseFetch(`${PD_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_qualification_gate_ativo&limit=1`, {
      headers: { apikey: PD_SERVICE, authorization: `Bearer ${PD_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    pdCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { pdCfg = false; }
  return pdCfg;
}
function pdNorm(v: string): string {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function pdText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function pdHasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function pdInbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || pdHasToolResult(m?.content)) continue;
    const t = pdText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function pdRecentBeforeInbound(messages: any[]): string {
  const parts: string[] = [];
  let skippedLatestUser = false;
  for (let i = messages.length - 1; i >= 0 && parts.length < 10; i--) {
    const m = messages[i];
    if (!['user','assistant'].includes(String(m?.role ?? '')) || pdHasToolResult(m?.content)) continue;
    const t = pdText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    if (!skippedLatestUser && m?.role === 'user') { skippedLatestUser = true; continue; }
    parts.push(t);
  }
  return parts.reverse().join('\n');
}
function pdExplicitMode(inbound: string): boolean {
  const t = pdNorm(inbound);
  return /\b(dtf\s*uv|dtf\s*(?:textil|textil)|transfer(?:encia)?|adesivos?|folhas?|metros?)\b/.test(t)
    || /\b(?:so|somente|apenas)\s+(?:a\s+)?(?:impressao|estampa|transfer|adesivo)/.test(t)
    || /\b(?:produto|peca|caneca|copo|camisa|camiseta)\s+(?:ja\s+)?(?:pront[oa]s?|personalizad[oa]s?)/.test(t)
    || /\b(?:quero|preciso)\b.{0,30}\b(?:pront[oa]s?|personalizad[oa]s?)\b/.test(t);
}
function pdKinds(inbound: string): { apparel: boolean; drinkware: boolean } {
  const t = pdNorm(inbound);
  return {
    apparel: /\b(camisas?|camisetas?|baby\s*look|oversized|moletons?|polos?)\b/.test(t),
    drinkware: /\b(canecas?|copos?)\b/.test(t),
  };
}
function pdDtfContext(messages: any[]): boolean {
  const t = pdNorm(pdRecentBeforeInbound(messages));
  if (!t) return false;
  return /\bdtf\b|impressao\s+dtf|adesiv.{0,20}(?:copo|caneca)|impressao.{0,20}(?:tecido|textil)/.test(t);
}
function pdClarification(k: { apparel: boolean; drinkware: boolean }): string {
  if (k.apparel && k.drinkware) {
    return 'Perfeito — só pra eu não te passar o preço errado: você quer somente as impressões para aplicar (DTF UV para caneca e DTF têxtil para camisa) ou quer as canecas e camisetas já personalizadas?';
  }
  if (k.drinkware) return 'Só pra eu não te passar o preço errado: você quer o adesivo DTF UV para aplicar na caneca/copo ou quer a peça já personalizada?';
  return 'Só pra eu não te passar o preço errado: você quer a impressão DTF têxtil para aplicar na camisa/camiseta ou quer a peça já personalizada?';
}
async function pdAudit(inbound: string, kinds: any) {
  try {
    await pdBaseFetch(`${PD_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:PD_SERVICE, authorization:`Bearer ${PD_SERVICE}`, prefer:'return=minimal' },
      body: JSON.stringify({
        agente_slug:'agente-noturno', funcao:'product-service-disambiguation', versao:PD_VERSION,
        nivel:'info', categoria:'skill_runtime', evento:'product_service_ambiguity_clarified', status:'applied',
        mensagem:'DTF transfer vs finished product ambiguity',
        detalhe:{ inbound:inbound.slice(0,240), kinds, skill_ref:'qualification', effect_class:'COGNITIVE_GUARD', authority_granted:false, external_authority:false }
      }),
      signal: AbortSignal.timeout(1800),
    });
  } catch {}
}
function pdAnthropic(decision: any): Response {
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({
    id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`, type:'message', role:'assistant',
    model:'cortex-qualification-disambiguation', content:[{type:'text',text}], stop_reason:'end_turn', stop_sequence:null,
    usage:{input_tokens:0,output_tokens:Math.max(1,Math.ceil(text.length/4))}
  }), { status:200, headers:{'content-type':'application/json','x-cortex-product-service-disambiguation':PD_VERSION} });
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pdUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return pdBaseFetch(input, init);
  if (!(await pdEnabled())) return pdBaseFetch(input, init);
  const raw = await pdBody(input, init); if (!raw) return pdBaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return pdBaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return pdBaseFetch(input, init);

  const inbound = pdInbound(body.messages);
  if (!inbound || pdExplicitMode(inbound) || !pdDtfContext(body.messages)) return pdBaseFetch(input, init);
  const kinds = pdKinds(inbound);
  if (!kinds.apparel && !kinds.drinkware) return pdBaseFetch(input, init);

  const decision = {
    responde:true,
    mensagem:pdClarification(kinds),
    tema:'sondagem',
    encaminhou_venda:false,
    etapa:'sondagem',
    slots:{},
  };
  void pdAudit(inbound, kinds);
  return pdAnthropic(decision);
};
