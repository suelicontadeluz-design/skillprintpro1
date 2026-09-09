// João Production Capability Guard v1.1 — 09/09/2026
// Extensão do guard v1. Mantém todos os bloqueios existentes e fecha a regressão
// observada no caso Jeff: DTF têxtil não pode ser recomendado como técnica para capinha.
// Para capinha pronta, a Skillprint não oferece o serviço; DTF UV só pode ser discutido
// como filme/adesivo para aplicação pelo cliente e depende de superfície rígida.

import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/0ac9fd346460faf5e4a75ef22d59508c132b6d2b/patches/joao-capability-guard-20260908/capability-guard-preload.ts";

declare const Deno: any;
const PC_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const pcBaseFetch = globalThis.fetch.bind(globalThis);
const PC_VERSION = 'joao-capability-guard/v1.1';
let pcCfgAt = 0;
let pcCfg = false;

function pcUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function pcBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function pcEnabled(): Promise<boolean> {
  if (Date.now() - pcCfgAt < 15000) return pcCfg;
  pcCfgAt = Date.now();
  try {
    const r = await pcBaseFetch(`${PC_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_capability_guard_ativo&limit=1`, {
      headers: { apikey: PC_SERVICE, authorization: `Bearer ${PC_SERVICE}` }, signal: AbortSignal.timeout(2000),
    });
    const rows = r.ok ? await r.json() : [];
    pcCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch { pcCfg = false; }
  return pcCfg;
}
function pcNorm(v: string): string {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function pcText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim();
}
function pcHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any)=>x?.type==='tool_result');
}
function pcInbound(messages:any[]): string {
  for (let i=messages.length-1;i>=0;i--) {
    const m=messages[i];
    if (m?.role!=='user' || pcHasToolResult(m?.content)) continue;
    const t=pcText(m?.content);
    if (!t || /^\s*\[SISTEMA:/i.test(t)) continue;
    return t;
  }
  return '';
}
function pcMentionsPhoneCase(text:string): boolean {
  const t=pcNorm(text);
  return /\b(capinha|capa)\s+(?:de\s+)?(?:celular|telefone|smartphone)\b/.test(t)
    || /\bcapinhas\b/.test(t);
}
function pcFilmOnlyIntent(text:string): boolean {
  const t=pcNorm(text);
  return /\b(so|somente|apenas)\s+(?:o\s+)?(?:adesivo|filme|dtf\s*uv)|\b(folha|metro)\s+(?:de\s+)?dtf\s*uv\b|\b(eu|nos)\s+(?:vou|vamos|quero|queremos)\s+aplicar\b|\bpara\s+(?:eu|nos)\s+aplicar\b/.test(t);
}
function pcFinishedOrTechniqueIntent(text:string): boolean {
  const t=pcNorm(text);
  return /\b(fazer|produzir|personalizar|pronta|pronto|produto pronto|servico)\b/.test(t)
    || /\b(outro|qual|algum)\s+(?:tipo\s+de\s+)?(?:estampa|tecnica)\b/.test(t)
    || /\b(dtf\s*(?:textil|textil)|sublimacao|estampa)\b/.test(t);
}
function pcNeedsBlock(text:string): boolean {
  if (!pcMentionsPhoneCase(text)) return false;
  if (pcFilmOnlyIntent(text) && !/dtf\s*(?:textil|textil)/i.test(pcNorm(text))) return false;
  return pcFinishedOrTechniqueIntent(text) || /\bquanto\b|\bpreco\b|\bvalor\b/.test(pcNorm(text));
}
function pcMessage(): string {
  return 'Para capinha de celular pronta, a Skillprint não faz esse serviço. E DTF têxtil não é indicado para capinha — ele é para tecido. Se a ideia for comprar só o DTF UV para você aplicar, aí ele precisa ser usado em superfície rígida; em silicone ou plástico flexível não indicamos. Se quiser seguir pelo DTF UV, me diga se a capinha é rígida.';
}
function pcAnthropic(message:string): Response {
  const decision={responde:true,mensagem:message,tema:'sondagem',encaminhou_venda:false,etapa:'sondagem',slots:{}};
  const text=JSON.stringify(decision);
  return new Response(JSON.stringify({
    id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`,
    type:'message',role:'assistant',model:'cortex-capability-guard',
    content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,
    usage:{input_tokens:0,output_tokens:Math.max(1,Math.ceil(text.length/4))},
  }),{status:200,headers:{'content-type':'application/json','x-cortex-capability-guard':PC_VERSION}});
}
async function pcAudit(inbound:string) {
  try {
    await pcBaseFetch(`${PC_URL}/rest/v1/sistema_logs`,{
      method:'POST',headers:{'content-type':'application/json',apikey:PC_SERVICE,authorization:`Bearer ${PC_SERVICE}`,prefer:'return=minimal'},
      body:JSON.stringify({agente_slug:'agente-noturno',funcao:'production-capability-guard',versao:PC_VERSION,nivel:'info',categoria:'skill_runtime',evento:'phone_case_capability_blocked',status:'applied',mensagem:'phone_case_finished_service_or_invalid_technique',detalhe:{inbound:inbound.slice(0,240),skill_ref:'discovery',strategy_key:'production_capability_validation_v1',effect_class:'MODEL_BYPASS',authority_granted:true,external_authority:false}}),
      signal:AbortSignal.timeout(1800),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url=pcUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return pcBaseFetch(input,init);
  if (!(await pcEnabled())) return pcBaseFetch(input,init);
  const raw=await pcBody(input,init); if(!raw) return pcBaseFetch(input,init);
  let body:any; try{body=JSON.parse(raw);}catch{return pcBaseFetch(input,init);}
  if(!Array.isArray(body?.messages)) return pcBaseFetch(input,init);
  const inbound=pcInbound(body.messages);
  if(!inbound || !pcNeedsBlock(inbound)) return pcBaseFetch(input,init);
  void pcAudit(inbound);
  return pcAnthropic(pcMessage());
};