declare const Deno: any;

// FreightAgent Phase 1 runtime adapter v1.1 — 15/09/2026
// João não é autoridade de CEP/frete. Este adapter opera no boundary de saída:
// 1) ancora CEP e snapshots reais no canonical_session_state;
// 2) expira deterministicamente cotações canônicas após 2h, sem apagar o CEP;
// 3) resolve escolha explícita somente contra quotes persistidos e válidos;
// 4) renderiza shipping exclusivamente do estado canônico;
// 5) impede que texto livre do modelo contradiga preço/CEP persistidos.

const FA_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const FA_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const faBaseFetch = globalThis.fetch.bind(globalThis);
const FA_VERSION = 'freight-agent-phase1-runtime/v1.1-expiry';
const FA_QUOTE_TTL_MS = 2 * 60 * 60 * 1000;
const FA_QUOTE_AGE_MS = FA_QUOTE_TTL_MS;
const faSubscriberPhone = new Map<string,{phone:string;at:number}>();
const FA_TRANSIENT_ZAPI = new Set([408,409,425,429,500,502,503,504]);

function faUrl(input:RequestInfo|URL):string { return typeof input==='string'?input:input instanceof URL?input.href:input.url; }
function faDigits(v:unknown):string { return String(v ?? '').replace(/\D/g,''); }
function faNorm(v:unknown):string { return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }
async function faRaw(input:RequestInfo|URL,init?:RequestInit):Promise<string>{
  if(typeof init?.body==='string') return init.body;
  if(init?.body!=null) return String(init.body);
  if(typeof Request!=='undefined' && input instanceof Request){ try{return await input.clone().text();}catch{} }
  return '';
}
function faRebuild(input:RequestInfo|URL,init:RequestInit|undefined,body:string):[RequestInfo|URL,RequestInit|undefined]{
  if(typeof Request!=='undefined' && input instanceof Request) return [new Request(input,{...init,body}),undefined];
  return [input,{...(init||{}),body}];
}
function faCep(text:string):string|null { const m=String(text||'').match(/\b(\d{5})-?(\d{3})\b/); return m?m[1]+m[2]:null; }
function faShippingIntent(text:string):boolean {
  const t=faNorm(text);
  return /\b(cep|frete|sedex|pac|j\s*&\s*t|j\s+e\s+t|transportadora|entrega|envio|retirada|retirar|correio|correios)\b/.test(t)
    || /^\D*\d{5}-?\d{3}\D*$/.test(String(text||'').trim());
}
function faService(text:string):string|null {
  const t=faNorm(text); const hits:string[]=[];
  if(/(^|\W)sedex(\W|$)/.test(t)) hits.push('Sedex');
  if(/(^|\W)pac(\W|$)/.test(t)) hits.push('PAC');
  if(/j\s*&\s*t|j\s+e\s+t|(^|\W)jt(\W|$)/.test(t)) hits.push('J&T Standard');
  return hits.length===1?hits[0]:null;
}
function faAmounts(text:string):number[]{
  return [...String(text||'').matchAll(/(?:R\$\s*)?([0-9]{1,4}[.,][0-9]{2})/g)]
    .map(m=>Number(m[1].replace(',','.'))).filter(n=>Number.isFinite(n)&&n>0);
}
function faExpiryMs(state:any):number {
  const explicit=Date.parse(String(state?.quote_expires_at??''));
  if(Number.isFinite(explicit)) return explicit;
  const quoted=Date.parse(String(state?.quoted_at??''));
  return Number.isFinite(quoted)?quoted+FA_QUOTE_TTL_MS:0;
}
async function faRpc(name:string,args:any):Promise<any>{
  const r=await faBaseFetch(`${FA_URL}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{'content-type':'application/json',apikey:FA_SERVICE,authorization:`Bearer ${FA_SERVICE}`},
    body:JSON.stringify(args),signal:AbortSignal.timeout(3500),
  });
  if(!r.ok) return null;
  return await r.json().catch(()=>null);
}
async function faLatestInbound(phone:string):Promise<any|null>{
  const p=faDigits(phone); if(p.length<10) return null;
  const u=`${FA_URL}/rest/v1/fact_conversations?select=id,lead_id,phone,message_text,timestamp&phone=eq.${encodeURIComponent(p)}&direction=eq.inbound&order=timestamp.desc&limit=1`;
  try{ const r=await faBaseFetch(u,{headers:{apikey:FA_SERVICE,authorization:`Bearer ${FA_SERVICE}`},signal:AbortSignal.timeout(1800)}); if(!r.ok)return null; const rows=await r.json(); return Array.isArray(rows)?rows[0]??null:null; }catch{return null;}
}
async function faLatestQuote(phone:string):Promise<any|null>{
  const p=faDigits(phone); if(p.length<10) return null;
  const since=new Date(Date.now()-FA_QUOTE_AGE_MS).toISOString();
  const u=`${FA_URL}/rest/v1/joao_freight_quote_snapshots?select=quote_id,lead_id,phone,cep_destino,opcoes,quoted_at,quote_hash,source_tool&phone=eq.${encodeURIComponent(p)}&quoted_at=gte.${encodeURIComponent(since)}&order=quoted_at.desc&limit=1`;
  try{ const r=await faBaseFetch(u,{headers:{apikey:FA_SERVICE,authorization:`Bearer ${FA_SERVICE}`},signal:AbortSignal.timeout(1800)}); if(!r.ok)return null; const rows=await r.json(); return Array.isArray(rows)?rows[0]??null:null; }catch{return null;}
}
function faSession(leadId:unknown,phone:string):string { const lead=String(leadId??'').trim(); return /^[0-9a-f-]{36}$/i.test(lead)?`lead:${lead}`:`phone:${faDigits(phone)}`; }
async function faCurrent(sessionId:string):Promise<any>{ return await faRpc('fn_joao_shipping_state_current_v1',{p_session_id:sessionId}); }
async function faApply(sessionId:string,version:number,proposal:any,leadId:any,phone:string,turnId?:string|null):Promise<any>{
  return await faRpc('fn_joao_shipping_state_apply_v1',{
    p_session_id:sessionId,p_expected_version:version,p_proposal:proposal,p_lead_id:leadId??null,p_phone:phone,
    p_source_turn_id:turnId??null,p_source_replay_case_id:null,p_is_replay:false,p_as_of:new Date().toISOString(),
  });
}
async function faAudit(event:string,detail:any){
  try{await faBaseFetch(`${FA_URL}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:FA_SERVICE,authorization:`Bearer ${FA_SERVICE}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'frete-agent-phase1',versao:FA_VERSION,nivel:'info',categoria:'freight_runtime',evento:event,status:'applied',mensagem:event,detalhe:detail}),signal:AbortSignal.timeout(1200)});}catch{}
}
async function faAdvance(phone:string):Promise<{sessionId:string;current:any;render:any;inbound:any;quote:any}|null>{
  const [inbound,quote]=await Promise.all([faLatestInbound(phone),faLatestQuote(phone)]);
  const leadId=quote?.lead_id ?? inbound?.lead_id ?? null;
  const sessionId=faSession(leadId,phone);
  let current=await faCurrent(sessionId); if(!current?.ok) return null;
  let version=Number(current?.state_version??0);
  let state=current?.shipping_state??{};
  const inboundText=String(inbound?.message_text??'');
  const inboundCep=faCep(inboundText);
  const quoteCep=faDigits(quote?.cep_destino);

  // Expiry is a deterministic state transition. It never erases the ZIP.
  const expiryMs=faExpiryMs(state);
  if((state?.status==='VALID_QUOTE'||state?.status==='QUOTE_SELECTED') && expiryMs>0 && Date.now()>=expiryMs){
    const res=await faApply(sessionId,version,{schema_version:'freight-state-proposal/v1',action:'QUOTE_EXPIRED'},leadId,phone,inbound?.id??null);
    if(res?.ok && res?.code==='STATE_COMMITTED'){
      version=Number(res.state_version); state=res.shipping_state;
      void faAudit('canonical_shipping_quote_expired',{phone_suffix:faDigits(phone).slice(-4),session_id:sessionId,state_version:version,quote_snapshot_id:state?.quote_snapshot_id??null,quote_expires_at:state?.quote_expires_at??null});
    }
  }

  // Customer turn is direct evidence. A newer explicit ZIP may replace the old one and invalidates its quote.
  if(inboundCep && (state?.zip_code!==inboundCep)){
    const res=await faApply(sessionId,version,{schema_version:'freight-state-proposal/v1',action:'ZIP_PROVIDED',zip_code:inboundCep,explicit_customer_change:version>0,source:'CUSTOMER_TURN'},leadId,phone,inbound?.id??null);
    if(res?.ok){ version=Number(res.state_version); state=res.shipping_state; }
  }
  // A persisted quote is also proof of the ZIP used by the freight tool. Seed only when no ZIP exists.
  if(!state?.zip_code && quoteCep.length===8){
    const res=await faApply(sessionId,version,{schema_version:'freight-state-proposal/v1',action:'ZIP_PROVIDED',zip_code:quoteCep,source:'QUOTE_SNAPSHOT'},leadId,phone,inbound?.id??null);
    if(res?.ok){ version=Number(res.state_version); state=res.shipping_state; }
  }
  if(quote?.quote_id && quoteCep.length===8 && state?.zip_code===quoteCep && String(state?.quote_snapshot_id??'')!==String(quote.quote_id)){
    const res=await faApply(sessionId,version,{schema_version:'freight-state-proposal/v1',action:'QUOTE_RECORDED',quote_snapshot_id:quote.quote_id},leadId,phone,inbound?.id??null);
    if(res?.ok){ version=Number(res.state_version); state=res.shipping_state; }
  }

  // Resolve only explicit, unique selection against the persisted canonical quote.
  if(state?.status==='VALID_QUOTE' && Array.isArray(state?.quotes) && inboundText){
    const quotedAt=quote?.quoted_at?Date.parse(quote.quoted_at):0;
    const inboundAt=inbound?.timestamp?Date.parse(inbound.timestamp):0;
    if(!quotedAt || !inboundAt || inboundAt>=quotedAt-1000){
      const service=faService(inboundText);
      const amounts=faAmounts(inboundText);
      let proposal:any=null;
      if(service) proposal={schema_version:'freight-state-proposal/v1',action:'QUOTE_SELECTED',service};
      else {
        const matches=(state.quotes as any[]).filter((o:any)=>amounts.some(n=>Math.abs(Number(o?.preco)-n)<=0.005));
        if(matches.length===1) proposal={schema_version:'freight-state-proposal/v1',action:'QUOTE_SELECTED',price:Number(matches[0].preco)};
      }
      if(proposal){ const res=await faApply(sessionId,version,proposal,leadId,phone,inbound?.id??null); if(res?.ok){version=Number(res.state_version);state=res.shipping_state;} }
    }
  }
  current=await faCurrent(sessionId);
  const render=await faRpc('fn_joao_shipping_render_v1',{p_session_id:sessionId});
  return {sessionId,current,render,inbound,quote};
}
function faOutbound(body:any,url:string):{field:'message'|'value'|'texto';phone:string;text:string;zapi:boolean}|null{
  if(/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) return {field:'message',phone:faDigits(body?.phone),text:String(body?.message??''),zapi:true};
  const bm=url.match(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/([^/]+)\/send_message\/?(?:\?|$)/i);
  if(bm && String(body?.type??'').toLowerCase()==='text'){
    const cached=faSubscriberPhone.get(bm[1]); return {field:'value',phone:cached&&Date.now()-cached.at<10*60*1000?cached.phone:'',text:String(body?.value??''),zapi:false};
  }
  if(url.includes('/functions/v1/joao-tts')) return {field:'texto',phone:faDigits(body?.phone),text:String(body?.texto??''),zapi:false};
  return null;
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=faUrl(input); const method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
  const lookup=url.match(/\/subscriber\/get_by_phone\/([^/?]+)\/?(?:\?|$)/i);
  if(lookup){
    const response=await faBaseFetch(input,init);
    if(response.ok){try{const data=await response.clone().json();const sid=String(data?.id||'');const phone=faDigits(decodeURIComponent(lookup[1]));if(sid&&phone)faSubscriberPhone.set(sid,{phone,at:Date.now()});}catch{}}
    return response;
  }
  if(method!=='POST') return faBaseFetch(input,init);
  const raw=await faRaw(input,init); let body:any=null; try{body=raw?JSON.parse(raw):null;}catch{return faBaseFetch(input,init);} if(!body)return faBaseFetch(input,init);
  const outbound=faOutbound(body,url); let callInput=input; let callInit=init;
  if(outbound?.phone){
    const advanced=await faAdvance(outbound.phone);
    const canonicalText=String(advanced?.render?.text??'').trim();
    const inboundText=String(advanced?.inbound?.message_text??'');
    const shippingTurn=faShippingIntent(inboundText)||faShippingIntent(outbound.text);
    if(shippingTurn && canonicalText){
      body[outbound.field]=outbound.text.trim().startsWith('*João Barros:*')?`*João Barros:*\n${canonicalText}`:canonicalText;
      const rebuilt=faRebuild(input,init,JSON.stringify(body)); callInput=rebuilt[0]; callInit=rebuilt[1];
      void faAudit('canonical_shipping_render_enforced',{
        phone_suffix:outbound.phone.slice(-4),session_id:advanced?.sessionId,state_version:advanced?.current?.state_version,
        status:advanced?.current?.shipping_state?.status,quote_snapshot_id:advanced?.current?.shipping_state?.quote_snapshot_id??null,
        rendered_price:advanced?.render?.expected_rendered_price??null,
      });
    }
  }
  const response=await faBaseFetch(callInput,callInit);
  if(!outbound?.zapi||response.ok||!FA_TRANSIENT_ZAPI.has(response.status)) return response;
  await new Promise(r=>setTimeout(r,300));
  const retry=await faBaseFetch(callInput,callInit);
  void faAudit(retry.ok?'zapi_transient_retry_recovered':'zapi_transient_retry_failed',{phone_suffix:outbound.phone.slice(-4),first_http_status:response.status,retry_http_status:retry.status});
  return retry;
};