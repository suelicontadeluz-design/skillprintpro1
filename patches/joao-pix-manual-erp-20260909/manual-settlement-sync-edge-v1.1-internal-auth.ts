import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U=Deno.env.get('SUPABASE_URL')!;
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP=Deno.env.get('ERP_URL')??'https://ynjsflvdfftcopibzxyo.supabase.co';
const EK=Deno.env.get('ERP_SERVICE_KEY')??Deno.env.get('ERP_SERVICE_ROLE_KEY')??'';
const BOT_KEY=Deno.env.get('API-KEY')??Deno.env.get('BOTCONVERSA_API_KEY')??'';
const BC='https://backend.botconversa.com.br/api/v1/webhook';
const REG_FLOW=8482541;
const REG_ACTION='joao_postsale_registration_2026_v1';
const STAGE_FECHAMENTO='697346abbee8c100131e02a1';
const V='joao-erp-manual-settlement-sync/v1.1-internal-auth';
const sb=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json'}});
const digits=(v:any)=>String(v??'').replace(/\D/g,'');

async function authorized(req:Request){
  const bearer=req.headers.get('authorization')||'';
  if(bearer===`Bearer ${S}`)return true;
  const cron=req.headers.get('x-cron-secret')||'';
  if(!cron)return false;
  try{
    const r=await fetch(`${U}/rest/v1/rpc/fn_edge_cron_auth_ok_v1`,{method:'POST',headers:{'content-type':'application/json',apikey:S,authorization:`Bearer ${S}`},body:JSON.stringify({p_token:cron}),signal:AbortSignal.timeout(3000)});
    return r.ok&&(await r.json())===true;
  }catch{return false}
}

async function erp(fn:string,b:any,ms=30000){const r=await fetch(`${ERP}/rest/v1/rpc/${fn}`,{method:'POST',headers:{'content-type':'application/json',apikey:EK,authorization:`Bearer ${EK}`},body:JSON.stringify(b),signal:AbortSignal.timeout(ms)});return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)}}
async function event(pid:string,eventType:string,code:string,payload:any={}){await sb.from('joao_erp_sale_sync_events_v1').insert({payment_id:pid,event_type:eventType,code,payload:{...payload,sync_version:V}})}
async function state(pid:string,row:any){await sb.from('joao_erp_sale_sync_v1').upsert({payment_id:pid,...row,updated_at:new Date().toISOString()},{onConflict:'payment_id'})}

function phoneVariants(raw:string){const c=digits(raw),o=new Set<string>();if(c)o.add(c);if((c.length===10||c.length===11)&&!c.startsWith('55'))o.add(`55${c}`);if(c.length===12&&c.startsWith('55')){const d=c.slice(2,4),n=c.slice(4);if(/^[6-9]/.test(n))o.add(`55${d}9${n}`)}if(c.length===13&&c.startsWith('55')){const d=c.slice(2,4),n=c.slice(4);if(n.startsWith('9'))o.add(`55${d}${n.slice(1)}`)}return [...o]}

async function cortexCustomer(leadId:string,phone:string){
  const {data:rows,error}=await sb.from('pessoas').select('id,nome,tipo_pessoa,cpf,cnpj,email,telefone,whatsapp,cep,logradouro,numero,complemento,bairro,cidade,estado,ativo,metadata').eq('ativo',true).contains('metadata',{lead_id:leadId}).limit(2);
  if(error)return {ready:false,code:'CORTEX_PERSON_READ_ERROR',error:error.message};
  if((rows||[]).length!==1)return {ready:false,code:(rows||[]).length>1?'CORTEX_PERSON_AMBIGUOUS':'CORTEX_PERSON_NOT_FOUND'};
  const p:any=rows![0],doc=digits(p.cnpj||p.cpf),ph=digits(p.whatsapp||p.telefone||phone),nome=String(p.nome||'').trim();
  const missing:string[]=[];if(!nome)missing.push('nome');if(!(doc.length===11||doc.length===14))missing.push('cpf_cnpj_valido');if(ph.length<10)missing.push('telefone');
  if(missing.length)return {ready:false,code:'CORTEX_PERSON_INCOMPLETE',missing,pessoa_id:p.id};
  return {ready:true,pessoa_id:p.id,payload:{nome,nome_razaoSocial:nome,cpf_cnpj:doc,tipo_pessoa:doc.length===14?'juridica':'fisica',email:p.email||null,phone:ph,telefone:ph,whatsapp:ph,cep:digits(p.cep).slice(0,8)||null,logradouro:p.logradouro||null,numero:p.numero||null,complemento:p.complemento||null,bairro:p.bairro||null,cidade:p.cidade||null,uf:p.estado||null,_origem:'cortex_pessoa_canonica'}};
}

async function subscriberId(leadId:string,phone:string){
  const {data:i}=await sb.from('lead_identificadores').select('contact_botconversa_id').eq('lead_id',leadId).maybeSingle();
  if(i?.contact_botconversa_id)return String(i.contact_botconversa_id);
  if(!BOT_KEY)return null;
  for(const ph of phoneVariants(phone)){try{const r=await fetch(`${BC}/subscriber/get_by_phone/${ph}/`,{headers:{accept:'application/json','API-KEY':BOT_KEY},signal:AbortSignal.timeout(10000)});if(!r.ok)continue;const j=await r.json().catch(()=>null);if(j?.id)return String(j.id)}catch{}}
  return null;
}

async function dispatchRegistration(pid:string,leadId:string,phone:string){
  const {data:existing}=await sb.from('integration_dispatches').select('id,status').eq('action',REG_ACTION).eq('entity_id',pid).maybeSingle();
  if(existing?.status==='sent')return {ok:true,skipped:true,reason:'already_sent'};
  if(existing?.status==='pending')return {ok:true,skipped:true,reason:'in_flight'};
  let claimId=existing?.id||null;const now=new Date().toISOString();
  if(claimId){const {error}=await sb.from('integration_dispatches').update({status:'pending',claimed_at:now,sent_at:null,http_status:null,last_error:null,updated_at:now}).eq('id',claimId);if(error)return {ok:false,code:'CLAIM_UPDATE_ERROR',error:error.message}}
  else{const {data,error}=await sb.from('integration_dispatches').insert({action:REG_ACTION,entity_id:pid,status:'pending'}).select('id').single();if(error)return {ok:false,code:error.code==='23505'?'CLAIM_RACE':'CLAIM_INSERT_ERROR',error:error.message};claimId=data.id}
  const sid=await subscriberId(leadId,phone);if(!sid){await sb.from('integration_dispatches').update({status:'failed',last_error:'subscriber_not_found',updated_at:new Date().toISOString()}).eq('id',claimId);return {ok:false,code:'SUBSCRIBER_NOT_FOUND'}};
  if(!BOT_KEY)return {ok:false,code:'BOT_KEY_MISSING'};
  try{const r=await fetch(`${BC}/subscriber/${sid}/send_flow/`,{method:'POST',headers:{'content-type':'application/json','API-KEY':BOT_KEY},body:JSON.stringify({flow:REG_FLOW}),signal:AbortSignal.timeout(15000)});const txt=(await r.text().catch(()=>'' )).slice(0,300),ok=r.ok;await sb.from('integration_dispatches').update({status:ok?'sent':'failed',sent_at:ok?new Date().toISOString():null,http_status:r.status,last_error:ok?null:`http_${r.status}:${txt}`,updated_at:new Date().toISOString()}).eq('id',claimId);return {ok,skipped:false,status:r.status,flow_id:REG_FLOW,error:ok?null:`http_${r.status}`}}catch(e:any){await sb.from('integration_dispatches').update({status:'failed',last_error:String(e?.message||e).slice(0,300),updated_at:new Date().toISOString()}).eq('id',claimId);return {ok:false,code:'SEND_EXCEPTION',error:String(e?.message||e).slice(0,160)}}
}

async function ensureErpClient(leadId:string,phone:string,pid:string){
  let rr=await erp('fn_joao_resolver_cliente_v1',{p_phone:phone});
  if(rr.ok&&rr.data?.ok&&rr.data?.cliente_id)return {ok:true,source:'erp_existing',cliente_id:String(rr.data.cliente_id)};
  if(!(rr.ok&&rr.data?.code==='CLIENT_NOT_FOUND'))return {ok:false,code:String(rr.data?.code||`ERP_CLIENT_HTTP_${rr.status}`),source:'erp_resolver'};
  const cp=await cortexCustomer(leadId,phone);
  if(!cp.ready){const registration=await dispatchRegistration(pid,leadId,phone);return {ok:false,code:cp.code,source:'cortex_person',detail:cp,registration}}
  const reg=await erp('fn_joao_cadastrar_cliente_fallback_v1',{p_phone:phone,p_payload:cp.payload,p_form_automatico_falhou:true});
  if(!reg.ok||!reg.data?.ok)return {ok:false,code:String(reg.data?.code||reg.data?.error||`ERP_REGISTER_HTTP_${reg.status}`),source:'erp_register',detail:reg.data};
  let clienteId=String(reg.data?.cliente_id||'');
  if(!clienteId){rr=await erp('fn_joao_resolver_cliente_v1',{p_phone:phone});if(rr.ok&&rr.data?.ok&&rr.data?.cliente_id)clienteId=String(rr.data.cliente_id)}
  if(!clienteId)return {ok:false,code:'ERP_CLIENT_CREATED_BUT_NOT_RESOLVED',source:'erp_register'};
  return {ok:true,source:reg.data?.action==='created'?'cortex_person_created_in_erp':'cortex_person_existing_in_erp',cliente_id:clienteId,pessoa_id:cp.pessoa_id};
}

async function markWon(dealId:string){
  const {data:t}=await sb.from('token_crm').select('token').limit(1).single();const token=t?.token||'';if(!token)return {ok:false,code:'RD_TOKEN_MISSING'};
  try{const cur=await fetch(`https://api.rd.services/crm/v2/deals/${dealId}`,{headers:{accept:'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});const cj=await cur.json().catch(()=>({}));if(cj?.data?.status==='won')return {ok:true,already_won:true};const r=await fetch(`https://api.rd.services/crm/v2/deals/${dealId}`,{method:'PUT',headers:{accept:'application/json','content-type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({data:{status:'won',stage_id:STAGE_FECHAMENTO}}),signal:AbortSignal.timeout(15000)});return {ok:r.ok,status:r.status,detail:r.ok?null:(await r.text().catch(()=>'' )).slice(0,300)}}catch(e:any){return {ok:false,code:'RD_EXCEPTION',error:String(e?.message||e).slice(0,180)}}
}

Deno.serve(async req=>{
  if(req.method!=='POST')return out({ok:false,error:'method_not_allowed',version:V},405);
  if(!(await authorized(req)))return out({ok:false,error:'unauthorized',version:V},401);
  if(!EK)return out({ok:false,error:'erp_key_missing',version:V},503);
  let body:any={};try{body=await req.json()}catch{return out({ok:false,error:'bad_json',version:V},400)}
  const eventId=String(body?.event_id||'').trim();if(!eventId)return out({ok:false,error:'event_id_required',version:V},400);

  const {data:cand,error:ce}=await sb.rpc('fn_joao_erp_manual_settlement_candidate_v1',{p_event_id:eventId});
  if(ce)return out({ok:false,error:'candidate_rpc_error',detail:ce.message,version:V},500);
  const pid=String(cand?.external_payment_id||`receipt:${eventId}`);
  const {data:prev}=await sb.from('joao_erp_sale_sync_v1').select('status,attempts').eq('payment_id',pid).maybeSingle();
  if(prev?.status==='SYNCED')return out({ok:true,status:'ALREADY_SYNCED',payment_id:pid,version:V});
  const attempts=Number(prev?.attempts||0)+1;
  if(!cand?.ready){const code=String(cand?.code||'MANUAL_CANDIDATE_HOLD');await state(pid,{lead_id:cand?.lead_id||null,status:'HOLD',attempts,last_code:code,candidate:cand,last_attempt_at:new Date().toISOString()});await event(pid,'HOLD',code,{route:'manual_receipt',candidate:cand});return out({ok:true,status:'HOLD',code,candidate:cand,version:V});}

  const {data:lm}=await sb.from('leads_marketing').select('ph').eq('lead_id',cand.lead_id).maybeSingle();const phone=digits(lm?.ph);if(phone.length<10){const code='PHONE_REQUIRED';await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:code,candidate:cand,last_attempt_at:new Date().toISOString()});return out({ok:true,status:'HOLD',code,version:V});}
  const client=await ensureErpClient(String(cand.lead_id),phone,pid);
  if(!client.ok){const code=String(client.code||'CLIENT_REQUIRED');await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:code,candidate:cand,result:{client},last_attempt_at:new Date().toISOString()});await event(pid,'HOLD',code,{route:'manual_receipt',client});return out({ok:true,status:'HOLD',code,client,version:V});}

  const rr=await erp('fn_joao_converter_proposta_quitada_manual_v1',{p_proposta_id:cand.proposta_id,p_external_payment_id:pid,p_paid_at:cand.paid_at,p_payment_total:Number(cand.order_total),p_receiving_bank:cand.receiving_bank,p_proof:{payment_source:'validated_receipt',proposal_receipt_canonical:true,proposal_receipt_id:cand.proposal_receipt_id,cliente_id:client.cliente_id,candidate_schema:cand.schema_version,event_id:eventId,source_evidence:cand.source_evidence}},40000);
  const sale=rr.data;
  if(!rr.ok||!sale?.ok){const code=String(sale?.code||`ERP_HTTP_${rr.status}`);await state(pid,{lead_id:cand.lead_id,status:'ERROR',attempts,last_code:code,candidate:cand,result:{sale,client},last_attempt_at:new Date().toISOString()});await event(pid,'ERROR',code,{route:'manual_receipt',sale,client});return out({ok:false,status:'ERROR',code,sale,version:V},500);}

  const op=sale?.op||{},opOk=op?.ok===true;const finalStatus=opOk?'SYNCED':'ERROR';const finalCode=opOk?String(sale.code||'MANUAL_SALE_SYNCED'):`OP_${String(op?.code||'NOT_CREATED')}`;
  const {data:o}=await sb.from('orcamentos').select('deal_id').eq('id',cand.orcamento_id).maybeSingle();const won=o?.deal_id?await markWon(String(o.deal_id)):{ok:false,code:'NO_DEAL_ID'};
  await state(pid,{lead_id:cand.lead_id,status:finalStatus,attempts,last_code:finalCode,candidate:cand,result:{sale,op,route:'manual_receipt',client,rd_won:won},erp_venda_id:sale.venda_id||null,erp_numero_venda:sale.numero_venda||null,erp_op_id:op?.op_id||null,erp_numero_op:op?.numero_op||null,last_attempt_at:new Date().toISOString(),synced_at:opOk?new Date().toISOString():null,op_synced_at:opOk?new Date().toISOString():null});
  await event(pid,finalStatus,finalCode,{route:'manual_receipt',proposta_id:sale.proposta_id||null,venda_id:sale.venda_id||null,numero_venda:sale.numero_venda||null,op_id:op?.op_id||null,numero_op:op?.numero_op||null,total:cand.order_total,receiving_bank:cand.receiving_bank,client_source:client.source,rd_won:won});
  return out({ok:opOk,status:finalStatus,code:finalCode,payment_id:pid,sale,client,rd_won:won,version:V},opOk?200:500);
});