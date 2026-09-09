declare const Deno: any;

// João Repeat Order History v1 — 09/09/2026
// Context-only advisor. Reads canonical/legacy order history only when current turn asks
// to repeat or consult a previous order. Never creates memory, order, quote or external action.
const RH_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const RH_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const rhBaseFetch = globalThis.fetch.bind(globalThis);
const RH_VERSION = 'joao-repeat-order-history/v1';
let rhCfgAt = 0;
let rhCfg = false;

function rhUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function rhBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function rhText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter((x:any) => x?.type === 'text').map((x:any) => String(x?.text ?? '')).join('\n').trim();
}
function rhHasToolResult(content:any): boolean {
  return Array.isArray(content) && content.some((x:any) => x?.type === 'tool_result');
}
function rhDialogue(messages:any[]): {role:string;text:string}[] {
  const out:{role:string;text:string}[]=[];
  for (const m of messages ?? []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || rhHasToolResult(m.content)) continue;
    const text = rhText(m.content);
    if (!text || /^\s*\[SISTEMA:/i.test(text)) continue;
    out.push({role:String(m.role),text});
  }
  return out;
}
async function rhEnabled(): Promise<boolean> {
  if (Date.now() - rhCfgAt < 15000) return rhCfg;
  rhCfgAt = Date.now();
  try {
    const r = await rhBaseFetch(`${RH_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_repeat_order_history_ativo&limit=1`, {
      headers:{apikey:RH_SERVICE,authorization:`Bearer ${RH_SERVICE}`}, signal:AbortSignal.timeout(1800),
    });
    if (!r.ok) return rhCfg;
    const rows = await r.json();
    rhCfg = Array.isArray(rows) && rows[0]?.valor_bool === true;
  } catch {}
  return rhCfg;
}
function rhStrongIntent(text:string): boolean {
  const t=String(text||'').trim();
  return /\b(?:pedido|compra)\s+(?:passad[oa]|anterior|anteriores)\b/i.test(t)
    || /\b(?:[uú]ltim[oa]|ultimo)\s+(?:pedido|compra)\b/i.test(t)
    || /\b(?:repetir|repete|repetir\s+o|repetir\s+um|refazer)\s+(?:meu\s+|o\s+|um\s+)?pedido\b/i.test(t)
    || /\b(?:s[oó]\s+)?quero\s+repetir\s+(?:meu\s+|o\s+|um\s+)?pedido\b/i.test(t)
    || /\b(?:puxar?|puxa|pegar?|pega|buscar?|busca)\b[^\n]{0,45}\b(?:cadastro|hist[oó]rico|pedido)\b/i.test(t)
    || /\b(?:cadastro|hist[oó]rico)\b[^\n]{0,45}\b(?:pedido|compra|tamanho|cor|modelo|layout)\b/i.test(t)
    || /\b(?:foto|imagem|layout|arte)\b[^\n]{0,55}\b(?:pedido\s+(?:passado|anterior)|[uú]ltimo\s+pedido)\b/i.test(t)
    || /\bqual(?:\s+era)?\s+(?:o\s+)?(?:tamanho|cor|modelo)\b[^\n]{0,55}\b(?:comprei|peguei|pedi|pedido)\b/i.test(t)
    || /\b(?:que|qual)\s+(?:tamanho|cor|modelo)\b[^\n]{0,55}\b(?:eu\s+)?(?:comprei|peguei|pedi)\b/i.test(t);
}
function rhIntent(dialogue:{role:string;text:string}[]): {active:boolean;source:string;inbound:string} {
  const inbound=[...dialogue].reverse().find(x=>x.role==='user')?.text ?? '';
  if (!inbound) return {active:false,source:'NO_INBOUND',inbound:''};
  if (rhStrongIntent(inbound)) return {active:true,source:'CURRENT_STRONG_HISTORY_INTENT',inbound};
  const prior=dialogue.slice(0,-1).slice(-8).map(x=>x.text).join('\n');
  const priorHistory=/\b(?:j[aá]\s+somos\s+cliente|somos\s+cliente|cadastro|pedido\s+(?:passado|anterior)|[uú]ltimo\s+pedido|repetir\s+(?:o\s+|um\s+)?pedido|n[aã]o\s+lembro|g1\s+ou\s+g2)\b/i.test(prior);
  if (priorHistory && /^(?:mesma\s+coisa|mesmo\s+pedido|o\s+mesmo|a\s+mesma|igual|puxar\s+pelo\*?)\s*[.!?]*$/i.test(inbound.trim())) {
    return {active:true,source:'HISTORY_CONTINUATION',inbound};
  }
  if (priorHistory && /\bconsegue\s+confirmar\s+(?:isso\s+)?(?:pra|para)\s+mim/i.test(inbound)) {
    return {active:true,source:'HISTORY_CONFIRMATION',inbound};
  }
  return {active:false,source:'NO_HISTORY_INTENT',inbound};
}
async function rhLookup(inbound:string): Promise<any|null> {
  try {
    const r=await rhBaseFetch(`${RH_URL}/rest/v1/rpc/fn_joao_repeat_order_context_by_inbound_v1`,{
      method:'POST',headers:{'content-type':'application/json',apikey:RH_SERVICE,authorization:`Bearer ${RH_SERVICE}`},
      body:JSON.stringify({p_inbound:inbound,p_window_minutes:30}),signal:AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function rhCompact(x:any): any {
  if (!x || typeof x !== 'object') return null;
  const out:any={
    status:x.status ?? null, confidence:x.confidence ?? null, source:x.source ?? null,
    source_kind:x.source_kind ?? null, confirmed_purchase:x.confirmed_purchase === true,
    occurred_at:x.occurred_at ?? null,
  };
  if (x.sale) out.sale=x.sale;
  if (x.proposal) out.proposal=x.proposal;
  if (x.art_reference) out.art_reference=x.art_reference;
  return out;
}
function rhRule(result:any): string {
  const status=String(result?.status ?? '');
  if (status==='CANONICAL_SALE_FOUND' || status==='LEGACY_WON_ORDER_FOUND' || status==='RD_WON_ORDER_FOUND') {
    let facts=''; try { facts=JSON.stringify(rhCompact(result)).slice(0,6500); } catch {}
    return `\n[CORTEX PEDIDO ANTERIOR v1 status=${status}]\nHistórico COMPROVADO do cliente: ${facts}\nUse estes dados SOMENTE como fatos do pedido anterior. Se o cliente pediu "igual/mesmo/repetir", trate produto/modelo/cor/grade/posições/quantidades comprovados como baseline, exceto onde o cliente alterou algo agora. Responda primeiro qualquer pergunta histórica direta. NÃO pergunte novamente dado já comprovado. PREÇO antigo NÃO é preço atual: para novo orçamento, recalcule no ERP canônico. Frete/CEP antigo não autorizam frete atual. Se art_reference for nulo, NÃO diga que viu ou possui o layout antigo; se existir apenas metadado de layout/arte, não invente arquivo nem imagem.\n[/CORTEX PEDIDO ANTERIOR]`;
  }
  if (status==='CANONICAL_PROPOSAL_ONLY') {
    let facts=''; try { facts=JSON.stringify(rhCompact(result)).slice(0,5000); } catch {}
    return `\n[CORTEX PEDIDO ANTERIOR v1 status=PROPOSTA_APENAS]\nExiste referência de proposta anterior, mas NÃO há prova de compra: ${facts}\nUse somente como referência. Diga que encontrou uma proposta, não um pedido comprado. Confirme de forma focada qualquer dado necessário antes de repetir. Nunca trate preço antigo como preço atual.\n[/CORTEX PEDIDO ANTERIOR]`;
  }
  if (status==='NO_MATERIALIZED_ORDER_HISTORY') {
    return `\n[CORTEX PEDIDO ANTERIOR v1 status=NAO_MATERIALIZADO]\nO cliente está pedindo para consultar/repetir pedido anterior, mas os detalhes do pedido antigo NÃO foram encontrados em fonte materializada disponível. NÃO invente tamanho, cor, modelo, arte, preço ou layout antigo. NÃO diga genericamente que "o sistema não puxa"; diga apenas que não conseguiu confirmar aquele detalhe no histórico disponível. Preserve TODOS os fatos já confirmados na conversa atual e NÃO reinicie produto/quantidade/cor já informados. Se realmente faltar algo para avançar, faça no máximo UMA pergunta específica sobre o único dado não comprovado. Se o cliente enviou imagem/arquivo agora, use-o como evidência atual, não como prova automática do pedido antigo.\n[/CORTEX PEDIDO ANTERIOR]`;
  }
  return '';
}
async function rhAudit(evento:string,result:any,intent:any) {
  try {
    await rhBaseFetch(`${RH_URL}/rest/v1/sistema_logs`,{
      method:'POST',headers:{'content-type':'application/json',apikey:RH_SERVICE,authorization:`Bearer ${RH_SERVICE}`,prefer:'return=minimal'},
      body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-repeat-order-history',versao:RH_VERSION,nivel:'info',categoria:'skill_runtime',evento,status:'applied',mensagem:String(result?.status??evento),lead_id:result?.resolved_lead_id??null,detalhe:{intent_source:intent.source,history_status:result?.status??null,found:result?.found===true,confidence:result?.confidence??null,source:result?.source??null}}),
      signal:AbortSignal.timeout(1500),
    });
  } catch {}
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=rhUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return rhBaseFetch(input,init);
  if (!(await rhEnabled())) return rhBaseFetch(input,init);
  const raw=await rhBody(input,init); if(!raw) return rhBaseFetch(input,init);
  let body:any; try{body=JSON.parse(raw);}catch{return rhBaseFetch(input,init);}
  if(typeof body?.system!=='string'||!Array.isArray(body?.messages)) return rhBaseFetch(input,init);
  const intent=rhIntent(rhDialogue(body.messages));
  if(!intent.active) return rhBaseFetch(input,init);
  const result=await rhLookup(intent.inbound);
  if(!result){void rhAudit('repeat_order_history_lookup_unavailable',{status:'LOOKUP_UNAVAILABLE'},intent);return rhBaseFetch(input,init);}
  if(result?.status==='INBOUND_AMBIGUOUS'||result?.status==='INBOUND_NOT_RESOLVED'){
    void rhAudit('repeat_order_history_identity_unresolved',result,intent);
    return rhBaseFetch(input,init);
  }
  const rule=rhRule(result);
  if(!rule) return rhBaseFetch(input,init);
  body.system=String(body.system)+rule;
  const evento=result?.found===true?'repeat_order_history_injected':'repeat_order_history_not_materialized';
  void rhAudit(evento,result,intent);
  const headers=new Headers(init?.headers??(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined));
  headers.delete('content-length');
  return rhBaseFetch(input,{...(init??{}),headers,body:JSON.stringify(body)});
};
