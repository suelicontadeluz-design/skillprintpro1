declare const Deno: any;

// FreightAgent Phase 1 final-response gate — 15/09/2026
// Deve ser importado DEPOIS do dry-run preload e ANTES do core que chama Deno.serve.
// Garante que o JSON devolvido pelo pipeline/replay usa o mesmo shipping_state canônico
// usado no boundary externo. Não escreve estado; somente lê a versão persistida.

const FRG_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const FRG_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const frgBaseFetch = globalThis.fetch.bind(globalThis);
const frgBaseServe = Deno.serve.bind(Deno);
const FRG_VERSION = 'freight-agent-phase1-response-gate/v1.2';

function frgDigits(v:unknown):string { return String(v ?? '').replace(/\D/g,''); }
function frgNorm(v:unknown):string { return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }
function frgShippingIntent(text:string):boolean {
  const t=frgNorm(text);
  return /\b(cep|frete|sedex|pac|j\s*&\s*t|j\s+e\s+t|transportadora|entrega|envio|retirada|retirar|correio|correios)\b/.test(t)
    || /^\D*\d{5}-?\d{3}\D*$/.test(String(text||'').trim());
}
function frgMoney(v:unknown):string { const n=Number(v); return Number.isFinite(n)?`R$ ${n.toFixed(2).replace('.',',')}`:''; }
function frgRender(state:any):{text:string;price:number|null;must_not_ask_zip:boolean} {
  const status=String(state?.status ?? 'EMPTY');
  const zip=frgDigits(state?.zip_code);
  if(status==='QUOTE_SELECTED' && state?.selected_quote){
    const o=state.selected_quote; const d=Number(o?.prazo_dias); const price=Number(o?.preco);
    return {text:`Frete ${String(o?.servico||'').trim()}: ${frgMoney(price)}${Number.isFinite(d)?` — ${d} ${d===1?'dia útil':'dias úteis'}`:''}`,price:Number.isFinite(price)?price:null,must_not_ask_zip:zip.length===8};
  }
  if(status==='VALID_QUOTE' && Array.isArray(state?.quotes) && state.quotes.length){
    const lines=state.quotes.map((o:any)=>{const d=Number(o?.prazo_dias);return `• ${String(o?.servico||o?.transportadora||'Frete').trim()}: ${frgMoney(o?.preco)}${Number.isFinite(d)?` — ${d} ${d===1?'dia útil':'dias úteis'}`:''}`;});
    const first=Number(state.quotes[0]?.preco);
    return {text:`Para o CEP ${zip.slice(0,5)}-${zip.slice(5)}, tenho estas opções de frete:\n${lines.join('\n')}\nQual você prefere?`,price:Number.isFinite(first)?first:null,must_not_ask_zip:true};
  }
  if(status==='EXPIRED_QUOTE' && zip.length===8){
    return {text:`A cotação anterior expirou, mas seu CEP ${zip.slice(0,5)}-${zip.slice(5)} continua salvo. Preciso atualizar os valores antes de te passar o frete.`,price:null,must_not_ask_zip:true};
  }
  if(status==='ZIP_PROVIDED' && zip.length===8){
    return {text:`Já tenho seu CEP ${zip.slice(0,5)}-${zip.slice(5)}.`,price:null,must_not_ask_zip:true};
  }
  return {text:'',price:null,must_not_ask_zip:false};
}
async function frgLeadForPhone(phone:string):Promise<string|null>{
  const p=frgDigits(phone); if(p.length<10)return null;
  try{
    const q=`${FRG_URL}/rest/v1/agente_noturno_estado?select=lead_id&phone=eq.${encodeURIComponent(p)}&order=updated_at.desc&limit=1`;
    const r=await frgBaseFetch(q,{headers:{apikey:FRG_SERVICE,authorization:`Bearer ${FRG_SERVICE}`},signal:AbortSignal.timeout(1500)});
    if(!r.ok)return null; const rows=await r.json().catch(()=>[]); const id=String(rows?.[0]?.lead_id??''); return /^[0-9a-f-]{36}$/i.test(id)?id:null;
  }catch{return null;}
}
async function frgCurrent(sessionId:string):Promise<any|null>{
  try{
    const q=`${FRG_URL}/rest/v1/vw_canonical_session_state_current_v1?select=session_id,state_version,shipping_state,shipping_state_hash,created_at&session_id=eq.${encodeURIComponent(sessionId)}&limit=1`;
    const r=await frgBaseFetch(q,{headers:{apikey:FRG_SERVICE,authorization:`Bearer ${FRG_SERVICE}`},signal:AbortSignal.timeout(1500)});
    if(!r.ok)return null; const rows=await r.json().catch(()=>[]); return Array.isArray(rows)?rows[0]??null:null;
  }catch{return null;}
}
async function frgAudit(event:string,detail:any){
  try{await frgBaseFetch(`${FRG_URL}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:FRG_SERVICE,authorization:`Bearer ${FRG_SERVICE}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'frete-agent-phase1-response-gate',versao:FRG_VERSION,nivel:'info',categoria:'freight_runtime',evento:event,status:'observed',mensagem:event,detalhe:detail}),signal:AbortSignal.timeout(1000)});}catch{}
}

(Deno as any).serve=(...args:any[])=>{
  const handlerIndex=typeof args[0]==='function'?0:1;
  const handler=args[handlerIndex];
  if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[handlerIndex]=async(req:Request,info:any)=>{
    let reqBody:any=null;
    try{if(req.method==='POST'&&(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))reqBody=await req.clone().json().catch(()=>null);}catch{}
    const res=await handler(req,info);
    if(!reqBody||!res.ok)return res;

    // O core legado devolve JSON com content-type text/plain em alguns dry-runs.
    // O gate valida o corpo, não confia no header legado.
    let raw='';
    try{raw=await res.clone().text();}catch{return res;}
    const trimmed=raw.trim();
    if(!trimmed.startsWith('{'))return res;
    let payload:any; try{payload=JSON.parse(trimmed);}catch{return res;}
    if(!payload||typeof payload!=='object'||typeof payload.resposta!=='string')return res;
    const incoming=String(reqBody?.mensagem??reqBody?.message??'');
    if(!frgShippingIntent(incoming)&&!frgShippingIntent(payload.resposta))return res;

    const explicitSession=String(reqBody?._shipping_session_id??'').trim();
    const phone=frgDigits(reqBody?.phone);
    const leadId=explicitSession?'':await frgLeadForPhone(phone);
    const sessionId=explicitSession || (leadId?`lead:${leadId}`:(phone?`phone:${phone}`:''));
    if(!sessionId)return res;
    const current=await frgCurrent(sessionId); if(!current?.shipping_state)return res;
    const rendered=frgRender(current.shipping_state); if(!rendered.text)return res;

    const next={...payload,resposta:rendered.text,freight_phase1:{gate:'CANONICAL_SESSION_STATE',session_id:sessionId,state_version:current.state_version,shipping_state_hash:current.shipping_state_hash,status:current.shipping_state?.status,expected_rendered_price:rendered.price,must_not_ask_zip:rendered.must_not_ask_zip}};
    const text=JSON.stringify(next); const headers=new Headers(res.headers); headers.delete('content-length'); headers.set('content-type','application/json; charset=utf-8'); headers.set('x-cortex-freight-phase1-response-gate',FRG_VERSION);
    void frgAudit('canonical_handler_response_enforced',{session_id:sessionId,state_version:current.state_version,status:current.shipping_state?.status,expected_rendered_price:rendered.price,dry_run:reqBody?._dry_run===true});
    return new Response(text,{status:res.status,statusText:res.statusText,headers});
  };
  return frgBaseServe(...args as any);
};
