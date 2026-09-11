declare const Deno: any;

// João Product/Service Disambiguation v4 — 11/09/2026
// Corrige caso orgânico: após perguntar "DTF têxtil para aplicar na camiseta ou peça pronta?",
// o cliente respondeu "Para aplicar em camisetas.". A v3 voltou a perguntar; a guarda de
// repetição caiu no fallback, que herdou o contexto antigo de DTF UV e respondeu UV/28cm.
//
// Mudança mínima e determinística:
// - intenção explícita de aplicar/estampar/imprimir/passar EM vestuário => DTF têxtil;
// - não dispara se houver também copo/caneca no mesmo inbound (permanece ambíguo);
// - grava slots.produto=dtf_textil no próprio envelope da decisão;
// - não usa anúncio/contexto anterior para sobrepor a evidência explícita do cliente.

const PD4_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PD4_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const pd4BaseFetch = globalThis.fetch.bind(globalThis);
const PD4_VERSION = 'joao-product-service-disambiguation/v4-apparel-apply';
let pd4CfgAt = 0;
let pd4Cfg = false;

function pd4Url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function pd4Body(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function pd4Enabled(): Promise<boolean> {
  if (Date.now() - pd4CfgAt < 15000) return pd4Cfg;
  pd4CfgAt = Date.now();
  try {
    const r = await pd4BaseFetch(`${PD4_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_qualification_gate_ativo&limit=1`, {
      headers: { apikey: PD4_SERVICE, authorization: `Bearer ${PD4_SERVICE}` },
      signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    pd4Cfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { pd4Cfg = false; }
  return pd4Cfg;
}
function pd4Norm(v: string): string {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function pd4Text(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x: any) => x?.type === 'text').map((x: any) => String(x?.text ?? '')).join('\n').trim();
}
function pd4HasToolResult(content: any): boolean {
  return Array.isArray(content) && content.some((x: any) => x?.type === 'tool_result');
}
function pd4Inbound(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' || pd4HasToolResult(m?.content)) continue;
    const t = pd4Text(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function pd4Kinds(inbound: string): { apparel: boolean; drinkware: boolean } {
  const t = pd4Norm(inbound);
  return {
    apparel: /\b(camisas?|camisetas?|baby\s*look|oversized|moletons?|polos?|regatas?|uniformes?)\b/.test(t),
    drinkware: /\b(canecas?|copos?|garrafas?)\b/.test(t),
  };
}
function pd4ExplicitApparelApply(inbound: string): boolean {
  const t = pd4Norm(inbound);
  const apparel = '(?:camisas?|camisetas?|baby\\s*look|oversized|moletons?|polos?|regatas?|uniformes?)';
  return new RegExp(`\\b(?:passar|aplicar|estampar|imprimir)\\b.{0,40}\\b(?:em|no|na|nos|nas|para|pra)\\s+(?:(?:o|a|os|as)\\s+)?${apparel}\\b`).test(t)
    || new RegExp(`\\b(?:para|pra)\\s+(?:passar|aplicar|estampar|imprimir)\\b.{0,40}\\b(?:em|no|na|nos|nas)\\s+(?:(?:o|a|os|as)\\s+)?${apparel}\\b`).test(t);
}
async function pd4Audit(inbound: string) {
  try {
    await pd4BaseFetch(`${PD4_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey:PD4_SERVICE, authorization:`Bearer ${PD4_SERVICE}`, prefer:'return=minimal' },
      body: JSON.stringify({
        agente_slug:'agente-noturno', funcao:'product-service-disambiguation', versao:PD4_VERSION,
        nivel:'info', categoria:'skill_runtime', evento:'explicit_textile_application_resolved', status:'applied',
        mensagem:'Explicit apparel application resolved as DTF textile',
        detalhe:{ inbound:inbound.slice(0,240), resolved_product:'dtf_textil', source:'latest_inbound_explicit', effect_class:'COGNITIVE_GUARD' }
      }),
      signal: AbortSignal.timeout(1800),
    });
  } catch {}
}
function pd4Anthropic(decision: any): Response {
  const text = JSON.stringify(decision);
  return new Response(JSON.stringify({
    id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`, type:'message', role:'assistant',
    model:'cortex-product-resolution', content:[{type:'text',text}], stop_reason:'end_turn', stop_sequence:null,
    usage:{input_tokens:0,output_tokens:Math.max(1,Math.ceil(text.length/4))}
  }), { status:200, headers:{'content-type':'application/json','x-cortex-product-service-disambiguation':PD4_VERSION} });
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = pd4Url(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return pd4BaseFetch(input, init);
  if (!(await pd4Enabled())) return pd4BaseFetch(input, init);
  const raw = await pd4Body(input, init); if (!raw) return pd4BaseFetch(input, init);
  let body: any; try { body = JSON.parse(raw); } catch { return pd4BaseFetch(input, init); }
  if (!Array.isArray(body?.messages)) return pd4BaseFetch(input, init);

  const inbound = pd4Inbound(body.messages);
  if (!inbound || !pd4ExplicitApparelApply(inbound)) return pd4BaseFetch(input, init);
  const kinds = pd4Kinds(inbound);
  if (!kinds.apparel || kinds.drinkware) return pd4BaseFetch(input, init);

  const decision = {
    responde:true,
    mensagem:'Perfeito, então é DTF têxtil para aplicar nas camisetas. Qual é o tamanho da estampa em centímetros e quantas cópias você precisa?',
    tema:'dtf_metro',
    encaminhou_venda:false,
    etapa:'sondagem',
    slots:{ produto:'dtf_textil' },
  };
  void pd4Audit(inbound);
  return pd4Anthropic(decision);
};
