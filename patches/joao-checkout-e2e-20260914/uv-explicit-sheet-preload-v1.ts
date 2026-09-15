declare const Deno: any;

// João DTF UV explicit sheet contract v1 — 14/09/2026
// Narrow override: when the customer explicitly asked for N A4 or N A3 sheets,
// preserve that commercial format instead of silently consolidating by consumed meters.
// ERP remains the price authority and validates whether requested sheets have enough capacity.
const UES_MAIN=(Deno.env.get('SUPABASE_URL')??'').replace(/\/$/,'');
const UES_SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const UES_ERP=(Deno.env.get('ERP_URL')??'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/,'');
const UES_ERP_KEY=Deno.env.get('ERP_SERVICE_KEY')??Deno.env.get('ERP_SERVICE_ROLE_KEY')??'';
const UES_VERSION='joao-uv-explicit-sheet/v1';
const uesBaseFetch=globalThis.fetch.bind(globalThis);
let uesCfgAt=0,uesCfg=false;

type Sheet={format:'a4'|'a3';count:number;source:string};
function urlOf(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url}
async function bodyOf(input:RequestInfo|URL,init?:RequestInit){let s='';if(typeof init?.body==='string')s=init.body;else if(init?.body!=null)s=String(init.body);else if(typeof Request!=='undefined'&&input instanceof Request){try{s=await input.clone().text()}catch{}}try{return s?JSON.parse(s):{}}catch{return{}}}
function norm(s:any){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function nword(s:string):number|null{const m:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};if(/^\d+$/.test(s))return Number(s);return m[s]??null}
function parseSheet(text:string):Sheet|null{
  const t=norm(text); const hits:{format:'a4'|'a3';count:number}[]=[];
  const re=/(?:^|\b)(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:x\s*)?(?:sao\s+)?(?:folhas?|fls?\.?)[\s:-]*a\s*([34])\b/g;
  for(const m of t.matchAll(re)){const c=nword(m[1]);if(c&&c>=1&&c<=100)hits.push({format:m[2]==='4'?'a4':'a3',count:c})}
  // Also accept compact "2 A4" / "2x A4" only when A4/A3 is directly attached to the count.
  const compact=/(?:^|\b)(\d{1,3})\s*x?\s*a\s*([34])\b/g;
  for(const m of t.matchAll(compact)){const c=Number(m[1]);if(c>=1&&c<=100&&!hits.some(h=>h.count===c&&h.format===(m[2]==='4'?'a4':'a3')))hits.push({format:m[2]==='4'?'a4':'a3',count:c})}
  if(!hits.length)return null;
  const fmts=[...new Set(hits.map(h=>h.format))]; if(fmts.length!==1)return null;
  const count=hits.filter(h=>h.format===fmts[0]).reduce((a,h)=>a+h.count,0); if(count<1||count>100)return null;
  return{format:fmts[0] as 'a4'|'a3',count,source:text.slice(0,240)};
}
async function enabled(){if(Date.now()-uesCfgAt<15000)return uesCfg;uesCfgAt=Date.now();try{const r=await uesBaseFetch(`${UES_MAIN}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_uv_explicit_sheet_v1_ativo&limit=1`,{headers:{apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`},signal:AbortSignal.timeout(1400)});const x=r.ok?await r.json():[];uesCfg=Array.isArray(x)&&x[0]?.valor_bool===true}catch{}return uesCfg}
async function recentSheet(leadId:string):Promise<Sheet|null>{try{const since=new Date(Date.now()-24*3600e3).toISOString();const q=`${UES_MAIN}/rest/v1/fact_conversations?select=message_text,created_at&lead_id=eq.${encodeURIComponent(leadId)}&direction=eq.inbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=30`;const r=await uesBaseFetch(q,{headers:{apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`},signal:AbortSignal.timeout(1800)});if(!r.ok)return null;const rows=await r.json().catch(()=>[]);for(const row of Array.isArray(rows)?rows:[]){const s=parseSheet(String(row?.message_text??''));if(s)return s}}catch{}return null}
async function phoneForLead(leadId:string){try{const r=await uesBaseFetch(`${UES_MAIN}/rest/v1/agente_noturno_estado?select=phone&lead_id=eq.${encodeURIComponent(leadId)}&order=updated_at.desc&limit=1`,{headers:{apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`},signal:AbortSignal.timeout(1400)});const a=r.ok?await r.json():[];return String(Array.isArray(a)?a[0]?.phone??'':'')}catch{return''}}
async function rpc(base:string,key:string,name:string,payload:any,timeout=5000){const r=await uesBaseFetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',apikey:key,authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});const data=await r.json().catch(()=>null);return{ok:r.ok,status:r.status,data}}
function row(x:any){return Array.isArray(x)?x[0]:x}
async function reusable(leadId:string,tool:string,components:any,amount:number){try{const since=new Date(Date.now()-5*60e3).toISOString();const q=`${UES_MAIN}/rest/v1/operacoes_financeiras?select=*&lead_id=eq.${encodeURIComponent(leadId)}&kind=eq.produto&source_tool=eq.${encodeURIComponent(tool)}&status=eq.ativa&used_at=is.null&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=10`;const r=await uesBaseFetch(q,{headers:{apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`},signal:AbortSignal.timeout(1600)});if(!r.ok)return null;const ops=await r.json().catch(()=>[]);for(const op of Array.isArray(ops)?ops:[]){const c=op?.components??{};if(Math.abs(Number(op?.amount)-amount)>.01)continue;if(String(c.requested_sheet_format??'')!==String(components.requested_sheet_format))continue;if(Number(c.requested_sheet_count)!==Number(components.requested_sheet_count))continue;if(Math.abs(Number(c.consumo_m??0)-Number(components.consumo_m??0))>.0005)continue;const rr=await uesBaseFetch(`${UES_MAIN}/rest/v1/joao_erp_proposal_receipts_v1?select=receipt_id&operation_id=eq.${encodeURIComponent(String(op.id))}&canonical=eq.true&limit=1`,{headers:{apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`},signal:AbortSignal.timeout(1200)});const rec=rr.ok?await rr.json().catch(()=>[]):[];if(Array.isArray(rec)&&rec.length)return op}}catch{}return null}
async function audit(evento:string,detail:any){try{await uesBaseFetch(`${UES_MAIN}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:UES_SERVICE,authorization:`Bearer ${UES_SERVICE}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-uv-explicit-sheet',versao:UES_VERSION,nivel:'info',categoria:'financial_runtime',evento,status:'applied',mensagem:String(detail?.code??evento),lead_id:detail?.lead_id??null,detalhe:detail}),signal:AbortSignal.timeout(1200)})}catch{}}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input),method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='POST'||!/\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url)||!(await enabled()))return uesBaseFetch(input,init);
  const req=await bodyOf(input,init);const tool=String(req?.p_source_tool??'').toLowerCase();
  if(String(req?.p_kind??'')!=='produto'||!['calcular_rendimento_uv','calcular_dtf_uv_metro'].includes(tool))return uesBaseFetch(input,init);
  const leadId=String(req?.p_lead_id??'');if(!/^[0-9a-f-]{36}$/i.test(leadId))return uesBaseFetch(input,init);
  const sheet=await recentSheet(leadId);if(!sheet)return uesBaseFetch(input,init);
  const components={...(req?.p_components??{}),requested_sheet_format:sheet.format,requested_sheet_count:sheet.count,requested_sheet_source:'customer_explicit_recent_inbound',degrau:sheet.format==='a4'?'folha_a4':'folha_a3'};
  const quote=await rpc(UES_ERP,UES_ERP_KEY,'fn_cortex_pricing_calculation_v1',{p_payload:{product_family:'dtf_uv',source_tool:tool,quantity:Number(components.consumo_m??components.metros??0),components}},5000);
  if(!quote.ok||quote.data?.ok!==true||quote.data?.canonical!==true){void audit('uv_explicit_sheet_pricing_rejected',{lead_id:leadId,code:quote.data?.code??`HTTP_${quote.status}`,sheet,components});return new Response(JSON.stringify({error:'ERP_DTF_UV_EXPLICIT_SHEET_REJECTED',code:quote.data?.code??'ERP_PRICING_UNAVAILABLE'}),{status:424,headers:{'content-type':'application/json'}})}
  const amount=Number(quote.data.total_price);if(!(amount>0))return new Response(JSON.stringify({error:'ERP_DTF_UV_EXPLICIT_TOTAL_INVALID'}),{status:424,headers:{'content-type':'application/json'}});
  const reuse=await reusable(leadId,tool,components,amount);if(reuse){void audit('uv_explicit_sheet_operation_reused',{lead_id:leadId,operation_id:reuse.id,amount,sheet});return new Response(JSON.stringify(reuse),{status:200,headers:{'content-type':'application/json','x-cortex-uv-explicit-sheet':UES_VERSION}})}
  const emit=await rpc(UES_MAIN,UES_SERVICE,'fn_emitir_operacao_financeira_explicit_uv_v1',{p_lead_id:leadId,p_amount:amount,p_source_tool:tool,p_components:components,p_ttl_minutos:Number(req?.p_ttl_minutos??30)},5000);
  const op=row(emit.data);if(!emit.ok||!op?.id){void audit('uv_explicit_sheet_emit_failed',{lead_id:leadId,code:`HTTP_${emit.status}`,sheet});return new Response(JSON.stringify({error:'EXPLICIT_UV_EMIT_FAILED'}),{status:424,headers:{'content-type':'application/json'}})}
  const phone=await phoneForLead(leadId);
  const applied=await rpc(UES_ERP,UES_ERP_KEY,'fn_joao_lancar_orcamento_v1',{p_payload:{operation_id:op.id,lead_id:leadId,kind:'produto',amount,source_tool:tool,components,component_details:[],phone}},10000);
  if(!applied.ok||applied.data?.ok!==true||applied.data?.canonical!==true){void audit('uv_explicit_sheet_erp_apply_failed',{lead_id:leadId,operation_id:op.id,code:applied.data?.code??`HTTP_${applied.status}`,sheet});return new Response(JSON.stringify({error:'ERP_EXPLICIT_UV_APPLY_FAILED',code:applied.data?.code??null}),{status:424,headers:{'content-type':'application/json'}})}
  const snap=await rpc(UES_ERP,UES_ERP_KEY,'fn_cortex_proposal_snapshot_v2',{p_operation_id:op.id},6000);
  if(!snap.ok||snap.data?.ok!==true||snap.data?.canonical!==true){return new Response(JSON.stringify({error:'ERP_EXPLICIT_UV_SNAPSHOT_REQUIRED'}),{status:424,headers:{'content-type':'application/json'}})}
  const rec=await rpc(UES_MAIN,UES_SERVICE,'fn_joao_erp_proposal_receipt_record_v1',{p_operation_id:op.id,p_erp_snapshot:snap.data},5000);
  if(!rec.ok||rec.data?.ok!==true){return new Response(JSON.stringify({error:'ERP_EXPLICIT_UV_RECEIPT_REQUIRED'}),{status:424,headers:{'content-type':'application/json'}})}
  void audit('uv_explicit_sheet_applied',{lead_id:leadId,operation_id:op.id,receipt_id:rec.data?.receipt_id??null,proposta_id:applied.data?.proposta_id??null,amount,sheet,consumo_m:components.consumo_m??null});
  return new Response(JSON.stringify(op),{status:200,headers:{'content-type':'application/json','x-cortex-uv-explicit-sheet':UES_VERSION}});
};
