declare const Deno: any;

// João Order Grade Confirmation v1 — 10/09/2026
// Skill estreita e sem efeito externo:
// - reconhece lista/grade de camisetas em linguagem humana;
// - obriga normalização MODELO -> TECIDO -> COR -> TAMANHO -> QTD;
// - recalcula o total e pede confirmação imediatamente abaixo da lista;
// - após confirmação explícita, apenas sinaliza prontidão sem inventar handoff.
// Não toca preço, Pix, cadastro, proposta, frete, prazo ou produção.

const OGC_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const OGC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ogcBaseFetch = globalThis.fetch.bind(globalThis);
const OGC_VERSION = 'joao-order-grade-confirmation/v1';
let ogcCfgAt = 0;
let ogcCfg = false;

function ogcUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function ogcBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function ogcText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function ogcHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function ogcDialogue(messages:any[]): {role:string;text:string}[] {
  const out:{role:string;text:string}[]=[];
  for (const m of messages ?? []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || ogcHasToolResult(m.content)) continue;
    const text=ogcText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({role:String(m.role),text});
  }
  return out;
}
async function ogcEnabled(): Promise<boolean> {
  if (Date.now()-ogcCfgAt < 15000) return ogcCfg;
  ogcCfgAt=Date.now();
  try {
    const r=await ogcBaseFetch(`${OGC_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_order_grade_confirmation_ativo&limit=1`,{
      headers:{apikey:OGC_SERVICE,authorization:`Bearer ${OGC_SERVICE}`},signal:AbortSignal.timeout(1800),
    });
    if (!r.ok) return ogcCfg;
    const rows=await r.json();
    ogcCfg=Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch {}
  return ogcCfg;
}
function ogcLooksLikeShirtContext(text:string): boolean {
  return /\b(camiset(?:a|as)|camisa(?:s)?|baby\s*look|polo|oversi(?:ze|zed)|infantil|uniforme(?:s)?)\b/i.test(text);
}
function ogcHasSizeSignal(text:string): boolean {
  return /(?:^|[\s,:;\-–—])(pp|p|m|g|gg|xg|g1|g2|g3|g4|ex|xp|tam(?:anho)?\s*(?:2|4|6|8|10|12|14|16)|(?:2|4|6|8|10|12|14|16))(?:\s|$|[,;:\-–—])/im.test(text);
}
function ogcHasQtySignal(text:string): boolean {
  return /\b\d+\s*(?:un(?:id(?:ades?)?)?|pe[cç]as?|camiset(?:a|as)|camisa(?:s)?)\b/i.test(text)
    || /(?:^|\n)\s*(?:pp|p|m|g|gg|xg|g1|g2|g3|g4|ex|xp|\d{1,2})\s*[-:—–]?\s*\d+/im.test(text)
    || /(?:^|\n)\s*\d+\s*(?:[-x:]\s*)?(?:pp|p|m|g|gg|xg|g1|g2|g3|g4|ex|xp)\b/im.test(text)
    || /\b(?:pp|p|m|g|gg|xg|g1|g2|g3|g4|ex|xp)\b[^\n]{0,30}\b\d+\b/i.test(text);
}
function ogcHasColorOrModelSignal(text:string): boolean {
  return /\b(preta?s?|branca?s?|azul(?:\s+marinho|\s+royal)?|vermelha?s?|amarela?s?|verde(?:\s+musgo|\s+bandeira)?|bord[oô]|marsala|bege|off[-\s]?white|cinza|marrom|roxa?s?|b[aá]sica?s?|comum|padr[aã]o|baby\s*look|polo|oversi(?:ze|zed)|infantil)\b/i.test(text);
}
function ogcPriorListRequest(dialogue:{role:string;text:string}[]): boolean {
  const prior=dialogue.slice(0,-1).slice(-6).map(x=>x.text).join('\n');
  return /\b(lista|grade|tamanhos?|cores?)\b/i.test(prior) && ogcLooksLikeShirtContext(prior);
}
function ogcListIntent(dialogue:{role:string;text:string}[]): {active:boolean;source:string;inbound:string} {
  const inbound=[...dialogue].reverse().find(x=>x.role==='user')?.text ?? '';
  if (!inbound) return {active:false,source:'NO_INBOUND',inbound:''};
  const hasSize=ogcHasSizeSignal(inbound);
  const hasQty=ogcHasQtySignal(inbound);
  const hasDescriptor=ogcHasColorOrModelSignal(inbound);
  const lineRich=(inbound.match(/\n/g)?.length ?? 0) >= 2;
  if (hasSize && hasQty && (hasDescriptor || ogcPriorListRequest(dialogue)) && (lineRich || inbound.length>=24)) {
    return {active:true,source:'CURRENT_GRADE_LIST',inbound};
  }
  return {active:false,source:'NO_GRADE_LIST',inbound};
}
function ogcExplicitYes(text:string): boolean {
  const t=String(text||'').trim().toLowerCase();
  return /^(?:sim|s|isso|isso mesmo|cert[oao]|tudo certo|correto|confirmo|confirmado|pode seguir|perfeito|ok|okay|blz|beleza)[.!\s]*$/i.test(t);
}
function ogcConfirmationIntent(dialogue:{role:string;text:string}[]): {active:boolean;source:string;inbound:string} {
  const inbound=[...dialogue].reverse().find(x=>x.role==='user')?.text ?? '';
  if (!ogcExplicitYes(inbound)) return {active:false,source:'NO_EXPLICIT_CONFIRMATION',inbound};
  const lastAssistant=[...dialogue].reverse().find(x=>x.role==='assistant')?.text ?? '';
  const asked=/confirma\s+se\s+(?:eu|n[oó]s|a\s+gente)?\s*(?:entendi|entendemos|peguei)[^\n]{0,90}(?:pedido|lista|grade)|(?:pedido|lista|grade)[^\n]{0,90}\bconfirma\b/i.test(lastAssistant);
  const looksNormalized=ogcLooksLikeShirtContext(lastAssistant) && ogcHasSizeSignal(lastAssistant) && /\btotal\s*:?\s*\d+/i.test(lastAssistant);
  if (asked && looksNormalized) return {active:true,source:'EXPLICIT_GRADE_CONFIRMATION',inbound};
  return {active:false,source:'CONFIRMATION_WITHOUT_GRADE_PROMPT',inbound};
}
function ogcListRule(): string {
  return `\n[CORTEX ORDER GRADE CONFIRMATION v1 mode=NORMALIZE effect=NONE]\nVocê está usando a skill order_grade_confirmation. Escopo EXCLUSIVO: organizar e confirmar a lista/grade de camisetas do pedido.\n\nREGRAS OBRIGATÓRIAS:\n1. Extraia somente fatos que o cliente escreveu ou que já estejam inequivocamente confirmados no contexto atual. NUNCA invente modelo, tecido, cor, tamanho ou quantidade.\n2. Estruture sempre nesta hierarquia: MODELO → TECIDO → COR → TAMANHO → QUANTIDADE. O tecido deve aparecer no mesmo cabeçalho do modelo, por exemplo: **CAMISETA BÁSICA — 100% ALGODÃO**. Se o tecido não estiver comprovado, não escreva 100% algodão por suposição; pergunte apenas esse ponto se ele for necessário.\n3. Dentro de cada modelo/tecido, use a COR como subcategoria e abaixo dela liste TAMANHO - QUANTIDADE. Consolide linhas equivalentes e preserve modelos distintos como baby look, básica, infantil, polo, oversized etc.\n4. Recalcule o TOTAL pelas linhas. Se houver total esperado do pedido no contexto, compare. Se der diferente, mostre a divergência e peça somente a correção necessária. Não aceite um total digitado que contradiga a soma.\n5. Se houver dado realmente ambíguo, não assuma. Faça no máximo uma pergunta focalizada por vez. Não volte para preço, Pix, frete, prazo, arte ou orçamento.\n6. Se a lista estiver consistente, entregue a lista organizada e imediatamente abaixo escreva uma pergunta curta de confirmação, preferencialmente: **Confirma se entendemos o seu pedido corretamente?**\n7. Nesta etapa ready_for_handoff é FALSO. Somente confirmação explícita do cliente em turno posterior pode torná-lo verdadeiro.\n8. Esta skill é NO_EFFECT: não altera ERP, pagamento, cadastro, proposta, produção nem executa handoff.\n[/CORTEX ORDER GRADE CONFIRMATION]`;
}
function ogcConfirmedRule(): string {
  return `\n[CORTEX ORDER GRADE CONFIRMATION v1 mode=CONFIRMED effect=NONE]\nO cliente acabou de confirmar explicitamente a lista/grade normalizada apresentada no turno anterior. Considere a grade CONFIRMADA e não a reabra nem peça tamanhos/cores novamente sem correção explícita do cliente.\nSemântica da skill: status=CONFIRMED; ready_for_handoff=true.\nIMPORTANTE: isto é apenas prontidão. NÃO invente execução de handoff, cadastro, produção ou qualquer efeito. Se o fluxo determinístico disponível no runtime indicar que cadastro/cliente está regular e expuser a ação autorizada de handoff, use o mecanismo existente. Se houver pendência determinística de cadastro, aguarde/resolva esse fluxo primeiro. Nunca diga que a Helen assumiu se o handoff real não tiver sido executado/comprovado.\nNão reabra preço, Pix, frete, prazo ou orçamento nesta resposta.\n[/CORTEX ORDER GRADE CONFIRMATION]`;
}
async function ogcAudit(evento:string, detail:any) {
  try {
    await ogcBaseFetch(`${OGC_URL}/rest/v1/sistema_logs`,{
      method:'POST',headers:{'content-type':'application/json',apikey:OGC_SERVICE,authorization:`Bearer ${OGC_SERVICE}`,prefer:'return=minimal'},
      body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-order-grade-confirmation',versao:OGC_VERSION,nivel:'info',categoria:'skill_runtime',evento,status:'applied',mensagem:String(detail?.source??evento),detalhe:{...detail,effect_zero:true,authority_granted:false,executable:false}}),
      signal:AbortSignal.timeout(1500),
    });
  } catch {}
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=ogcUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return ogcBaseFetch(input,init);
  if (!(await ogcEnabled())) return ogcBaseFetch(input,init);
  const raw=await ogcBody(input,init); if(!raw) return ogcBaseFetch(input,init);
  let body:any; try{body=JSON.parse(raw);}catch{return ogcBaseFetch(input,init);}
  if(typeof body?.system!=='string'||!Array.isArray(body?.messages)) return ogcBaseFetch(input,init);

  const dialogue=ogcDialogue(body.messages);
  const confirmation=ogcConfirmationIntent(dialogue);
  const list=confirmation.active ? {active:false,source:'PRECEDENCE_CONFIRMATION',inbound:confirmation.inbound} : ogcListIntent(dialogue);
  if (!confirmation.active && !list.active) return ogcBaseFetch(input,init);

  const mode=confirmation.active?'CONFIRMED':'NORMALIZE';
  body.system=String(body.system)+(confirmation.active?ogcConfirmedRule():ogcListRule());
  void ogcAudit('order_grade_confirmation_injected',{mode,source:confirmation.active?confirmation.source:list.source,inbound:(confirmation.active?confirmation.inbound:list.inbound).slice(0,700)});
  const headers=new Headers(init?.headers??(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined));
  headers.delete('content-length');
  return ogcBaseFetch(input,{...(init??{}),headers,body:JSON.stringify(body)});
};
