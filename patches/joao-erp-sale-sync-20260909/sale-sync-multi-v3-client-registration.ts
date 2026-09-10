import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U=Deno.env.get('SUPABASE_URL')!, S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP=Deno.env.get('ERP_URL')??'https://ynjsflvdfftcopibzxyo.supabase.co';
const EK=Deno.env.get('ERP_SERVICE_KEY')??Deno.env.get('ERP_SERVICE_ROLE_KEY')??'';
const BOT_KEY=Deno.env.get('API-KEY')??Deno.env.get('BOTCONVERSA_API_KEY')??'';
const BC='https://backend.botconversa.com.br/api/v1/webhook';
const REG_FLOW=8482541; // cadastro_cliente_2026
const REG_ACTION='joao_postsale_registration_2026_v1';
const V='joao-erp-sale-sync-multi/v3-client-registration';
const sb=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digits=(v:any)=>String(v??'').replace(/\D/g,'');

async function auth(req:Request){if((req.headers.get('authorization')||'')===`Bearer ${S}`)return true;const t=req.headers.get('x-cron-secret')||'';if(!t)return false;try{const r=await fetch(`${U}/rest/v1/rpc/fn_edge_cron_auth_ok_v1`,{method:'POST',headers:{'content-type':'application/json',apikey:S,authorization:`Bearer ${S}`},body:JSON.stringify({p_token:t})});return r.ok&&(await r.json())===true}catch{return false}}
async function erp(fn:string,b:any,ms=20000){const r=await fetch(`${ERP}/rest/v1/rpc/${fn}`,{method:'POST',headers:{'content-type':'application/json',apikey:EK,authorization:`Bearer ${EK}`},body:JSON.stringify(b),signal:AbortSignal.timeout(ms)});return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)}}
async function event(payment_id:string,event_type:string,code:string,payload:any={}){await sb.from('joao_erp_sale_sync_events_v1').insert({payment_id,event_type,code,payload:{...payload,sync_version:V}})}
async function state(payment_id:string,row:any){await sb.from('joao_erp_sale_sync_v1').upsert({payment_id,...row,updated_at:new Date().toISOString()},{onConflict:'payment_id'})}

function phoneVariants(raw:string){const c=digits(raw),o=new Set<string>();if(c)o.add(c);if((c.length===10||c.length===11)&&!c.startsWith('55'))o.add(`55${c}`);if(c.length===12&&c.startsWith('55')){const d=c.slice(2,4),n=c.slice(4);if(/^[6-9]/.test(n))o.add(`55${d}9${n}`)}if(c.length===13&&c.startsWith('55')){const d=c.slice(2,4),n=c.slice(4);if(n.startsWith('9'))o.add(`55${d}${n.slice(1)}`)}return [...o]}

async function cortexCustomer(lead_id:string,phone:string){
  const {data:rows,error}=await sb.from('pessoas')
    .select('id,nome,tipo_pessoa,cpf,cnpj,email,telefone,whatsapp,cep,logradouro,numero,complemento,bairro,cidade,estado,ativo,metadata')
    .eq('ativo',true).contains('metadata',{lead_id}).limit(2);
  if(error)return {ready:false,code:'CORTEX_PERSON_READ_ERROR',error:error.message};
  if((rows||[]).length!==1)return {ready:false,code:(rows||[]).length>1?'CORTEX_PERSON_AMBIGUOUS':'CORTEX_PERSON_NOT_FOUND'};
  const p:any=rows![0],doc=digits(p.cnpj||p.cpf),ph=digits(p.whatsapp||p.telefone||phone),nome=String(p.nome||'').trim();
  const missing:string[]=[];if(!nome)missing.push('nome');if(!(doc.length===11||doc.length===14))missing.push('cpf_cnpj_valido');if(ph.length<10)missing.push('telefone');
  if(missing.length)return {ready:false,code:'CORTEX_PERSON_INCOMPLETE',missing,pessoa_id:p.id};
  return {ready:true,pessoa_id:p.id,payload:{nome,nome_razaoSocial:nome,cpf_cnpj:doc,tipo_pessoa:doc.length===14?'juridica':'fisica',email:p.email||null,phone:ph,telefone:ph,whatsapp:ph,cep:digits(p.cep).slice(0,8)||null,logradouro:p.logradouro||null,numero:p.numero||null,complemento:p.complemento||null,bairro:p.bairro||null,cidade:p.cidade||null,uf:p.estado||null,_origem:'cortex_pessoa_canonica'}};
}

async function rebind(totalOp:string,clienteId:string,pid:string,apply=true){
  if(!UUID.test(totalOp)||!UUID.test(clienteId))return {ok:false,code:'REBIND_INPUT_INVALID'};
  const r=await erp('fn_joao_rebind_cliente_operacao_v1',{p_total_operation_id:totalOp,p_cliente_id:clienteId,p_payment_id:pid,p_apply:apply});
  return r.ok?r.data:{ok:false,code:`REBIND_HTTP_${r.status}`,detail:r.data};
}

async function ensureErpClient(cand:any,pid:string,totalOp:string){
  let rr=await erp('fn_joao_resolver_cliente_v1',{p_phone:cand.phone});
  if(rr.ok&&rr.data?.ok&&rr.data?.cliente_id){
    const rb=UUID.test(totalOp)?await rebind(totalOp,String(rr.data.cliente_id),pid,true):null;
    return {ok:true,source:'erp_existing',cliente_id:String(rr.data.cliente_id),rebind:rb};
  }
  if(!(rr.ok&&rr.data?.code==='CLIENT_NOT_FOUND'))return {ok:false,code:String(rr.data?.code||`ERP_CLIENT_HTTP_${rr.status}`),source:'erp_resolver'};

  const cp=await cortexCustomer(String(cand.lead_id),String(cand.phone));
  if(!cp.ready)return {ok:false,code:cp.code,source:'cortex_person',detail:cp};

  const reg=await erp('fn_joao_cadastrar_cliente_fallback_v1',{p_phone:cand.phone,p_payload:cp.payload,p_form_automatico_falhou:true});
  if(!reg.ok||!reg.data?.ok)return {ok:false,code:String(reg.data?.code||reg.data?.error||`ERP_REGISTER_HTTP_${reg.status}`),source:'erp_register',detail:reg.data};
  let clienteId=String(reg.data?.cliente_id||'');
  if(!UUID.test(clienteId)){
    rr=await erp('fn_joao_resolver_cliente_v1',{p_phone:cand.phone});
    if(rr.ok&&rr.data?.ok&&rr.data?.cliente_id)clienteId=String(rr.data.cliente_id);
  }
  if(!UUID.test(clienteId))return {ok:false,code:'ERP_CLIENT_CREATED_BUT_NOT_RESOLVED',source:'erp_register'};
  const rb=UUID.test(totalOp)?await rebind(totalOp,clienteId,pid,true):null;
  return {ok:true,source:reg.data?.action==='created'?'cortex_person_created_in_erp':'cortex_person_existing_in_erp',cliente_id:clienteId,pessoa_id:cp.pessoa_id,rebind:rb};
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
  let claimId=existing?.id||null;
  const now=new Date().toISOString();
  if(claimId){const {error}=await sb.from('integration_dispatches').update({status:'pending',claimed_at:now,sent_at:null,http_status:null,last_error:null,updated_at:now}).eq('id',claimId);if(error)return {ok:false,code:'CLAIM_UPDATE_ERROR',error:error.message}}
  else {const {data,error}=await sb.from('integration_dispatches').insert({action:REG_ACTION,entity_id:pid,status:'pending'}).select('id').single();if(error)return {ok:false,code:error.code==='23505'?'CLAIM_RACE':'CLAIM_INSERT_ERROR',error:error.message};claimId=data.id}

  const sid=await subscriberId(leadId,phone);
  if(!sid){await sb.from('integration_dispatches').update({status:'failed',last_error:'subscriber_not_found',updated_at:new Date().toISOString()}).eq('id',claimId);return {ok:false,code:'SUBSCRIBER_NOT_FOUND'}};
  if(!BOT_KEY){await sb.from('integration_dispatches').update({status:'failed',last_error:'bot_key_missing',updated_at:new Date().toISOString()}).eq('id',claimId);return {ok:false,code:'BOT_KEY_MISSING'}};
  try{
    const r=await fetch(`${BC}/subscriber/${sid}/send_flow/`,{method:'POST',headers:{'content-type':'application/json','API-KEY':BOT_KEY},body:JSON.stringify({flow:REG_FLOW}),signal:AbortSignal.timeout(15000)});
    const txt=(await r.text().catch(()=>'' )).slice(0,300),ok=r.ok;
    await sb.from('integration_dispatches').update({status:ok?'sent':'failed',sent_at:ok?new Date().toISOString():null,http_status:r.status,last_error:ok?null:`http_${r.status}:${txt}`,updated_at:new Date().toISOString()}).eq('id',claimId);
    return {ok,skipped:false,status:r.status,flow_id:REG_FLOW,subscriber_id:sid,error:ok?null:`http_${r.status}`};
  }catch(e:any){await sb.from('integration_dispatches').update({status:'failed',last_error:String(e?.message||e).slice(0,300),updated_at:new Date().toISOString()}).eq('id',claimId);return {ok:false,code:'SEND_EXCEPTION',error:String(e?.message||e).slice(0,160)}}
}

async function localCustomer(lead_id:string,phone:string){const c=await cortexCustomer(lead_id,phone);return c.ready?c.payload:null}

Deno.serve(async req=>{
 if(!(await auth(req)))return out({ok:false,error:'unauthorized',version:V},401);if(req.method!=='POST')return out({ok:false,error:'method_not_allowed',version:V},405);if(!EK)return out({ok:false,error:'erp_key_missing',version:V},503);
 const {data:cfg}=await sb.from('joao_erp_sale_sync_config_v1').select('active,enabled_after').eq('id',true).maybeSingle();if(!cfg?.active)return out({ok:true,active:false,version:V});
 const {data:pays,error}=await sb.from('mp_pix_cobrancas').select('payment_id,lead_id,paid_at,valor,status').eq('status','approved').not('paid_at','is',null).gte('paid_at',cfg.enabled_after).order('paid_at',{ascending:true}).limit(10);if(error)return out({ok:false,error:'payments_read_failed',version:V},500);
 let processed=0,synced=0,held=0,errors=0,canonical=0,legacy=0,clientPending=0,registrationSent=0,clientsResolved=0;
 for(const p of pays||[]){const pid=String(p.payment_id);const {data:prev}=await sb.from('joao_erp_sale_sync_v1').select('status,attempts').eq('payment_id',pid).maybeSingle();if(prev?.status==='SYNCED')continue;
  const {data:cand,error:ce}=await sb.rpc('fn_joao_erp_sale_candidate_v1',{p_payment_id:pid});if(ce||!cand?.ready)continue;processed++;const attempts=Number(prev?.attempts||0)+1;
  const totalOp=String(cand?.proof?.total_operation_id||'').trim();

  // Caminho principal: proposta canonica. Cliente e uma dependencia reconciliavel,
  // mas pagamento/OP nao ficam bloqueados esperando formulario.
  if(UUID.test(totalOp)){
    const client=await ensureErpClient(cand,pid,totalOp);
    let registration:any=null;
    if(client.ok){clientsResolved++;await event(pid,'CLIENT_RESOLVED','CLIENT_RESOLVED',{source:client.source,cliente_id:client.cliente_id,rebind:client.rebind||null})}
    else {registration=await dispatchRegistration(pid,String(cand.lead_id),String(cand.phone));if(registration?.ok&&!registration?.skipped){registrationSent++;await event(pid,'REGISTRATION_DISPATCHED','CADASTRO_CLIENTE_2026_SENT',{flow_id:REG_FLOW})}else if(!registration?.ok)await event(pid,'REGISTRATION_HOLD','CADASTRO_CLIENTE_2026_NOT_SENT',{client,registration})}

    const rr=await erp('fn_joao_converter_proposta_paga_v1',{p_total_operation_id:totalOp,p_payment_id:pid,p_payment_status:'approved',p_paid_at:cand.paid_at,p_payment_total:Number(cand.total),p_proof:{...(cand.proof||{}),candidate_schema:cand.schema_version||null,lead_id:cand.lead_id||null}},40000);
    const sale=rr.data;
    if(rr.ok&&sale?.ok){
      if(client.ok&&client.cliente_id)await rebind(totalOp,String(client.cliente_id),pid,true);
      const op=sale?.op||{},opOk=op?.ok===true,baseCode=String(sale.code||'CANONICAL_SALE_SYNCED');
      const finalStatus=opOk?(client.ok?'SYNCED':'SYNCED_PENDING_CLIENT'):'ERROR';
      const finalCode=opOk?(client.ok?baseCode:'SALE_PAYMENT_AND_OP_SYNCED_CLIENT_PENDING'):`OP_${String(op?.code||'NOT_CREATED')}`;
      await state(pid,{lead_id:cand.lead_id,status:finalStatus,attempts,last_code:finalCode,candidate:cand,result:{sale,op,route:'canonical_proposal',client,registration},erp_venda_id:sale.venda_id||null,erp_numero_venda:sale.numero_venda||null,erp_op_id:op?.op_id||null,erp_numero_op:op?.numero_op||null,last_attempt_at:new Date().toISOString(),synced_at:opOk?new Date().toISOString():null,op_synced_at:opOk?new Date().toISOString():null});
      await event(pid,finalStatus,finalCode,{route:'canonical_proposal',proposta_id:sale.proposta_id||null,numero_proposta:sale.numero_proposta||null,venda_id:sale.venda_id||null,numero_venda:sale.numero_venda||null,op_id:op?.op_id||null,numero_op:op?.numero_op||null,total:cand.total,client_source:client.source||null,registration:registration?{ok:registration.ok,skipped:registration.skipped||false,reason:registration.reason||null}:null});
      if(opOk&&client.ok)synced++;else if(opOk){clientPending++;}else errors++;canonical++;continue;
    }
    const c=String(sale?.code||`CANONICAL_HTTP_${rr.status}`);
    if(c!=='ERP_TOTAL_OPERATION_NOT_LINKED'){await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:c,candidate:cand,result:{route:'canonical_proposal',erp:sale||{http:rr.status}},last_attempt_at:new Date().toISOString()});await event(pid,'HOLD',c,{route:'canonical_proposal',erp:sale||{http:rr.status}});held++;canonical++;continue}
  }

  // Fallback legado preservado; aqui cliente continua fail-closed.
  const src=Array.isArray(cand.items)?cand.items:[];const needsMulti=src.length>1||src.some((x:any)=>x.family==='camisetas');if(!needsMulti)continue;legacy++;
  const items:any[]=[];let fail:any=null;
  for(const x of src){if(x.family==='dtf_textil'||x.family==='dtf_uv'){const r=await erp('fn_joao_resolver_dtf_item_v1',{p_family:x.family,p_quantidade:x.quantity,p_expected_amount:x.amount});if(!r.ok||!r.data?.ok){fail=r.data||{code:`DTF_HTTP_${r.status}`};break}items.push(r.data.item)}else if(x.family==='camisetas'){const r=await erp('fn_joao_resolver_camisetas_v1',{p_components:x.components,p_expected_amount:x.amount},30000);if(!r.ok||!r.data?.ok){fail=r.data||{code:`SHIRT_HTTP_${r.status}`};break}items.push(...r.data.items)}else{fail={code:'FAMILY_UNSUPPORTED',family:x.family};break}}
  if(fail||!items.length){const code=String(fail?.code||'ITEM_RESOLUTION_FAILED');await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:code,candidate:cand,result:fail,last_attempt_at:new Date().toISOString()});await event(pid,'HOLD',code,fail||{});held++;continue}
  const sum=items.reduce((a:number,x:any)=>a+Number(x.quantidade)*Number(x.valor_unitario),0);if(Math.abs(Math.round(sum*100)/100-Number(cand.valor_produtos))>.01){await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:'ERP_ITEMS_TOTAL_DIVERGENCE',candidate:cand,result:{sum,expected:cand.valor_produtos},last_attempt_at:new Date().toISOString()});await event(pid,'HOLD','ERP_ITEMS_TOTAL_DIVERGENCE',{sum,expected:cand.valor_produtos});held++;continue}
  const legacyClient=await ensureErpClient(cand,pid,totalOp);
  if(!legacyClient.ok){const registration=await dispatchRegistration(pid,String(cand.lead_id),String(cand.phone));await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:'CLIENT_REQUIRED',candidate:cand,result:{client:legacyClient,registration},last_attempt_at:new Date().toISOString()});await event(pid,'HOLD','CLIENT_REQUIRED',{client:legacyClient,registration});held++;continue}
  let cr=await erp('fn_joao_resolver_cliente_v1',{p_phone:cand.phone});const cliente=cr.data;if(!cr.ok||!cliente?.ok){await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:'CLIENT_REQUIRED',candidate:cand,result:cliente,last_attempt_at:new Date().toISOString()});await event(pid,'HOLD','CLIENT_REQUIRED',cliente||{});held++;continue}
  let endereco:any=null;if(cand.tipo_envio==='entrega'){endereco=cliente.endereco||null;const cep=digits(endereco?.cep);if(!endereco||cep!==String(cand.cep_destino)||!endereco.logradouro||!endereco.numero||!endereco.bairro||!endereco.cidade){await state(pid,{lead_id:cand.lead_id,status:'HOLD',attempts,last_code:'DELIVERY_ADDRESS_MISMATCH_OR_MISSING',candidate:cand,last_attempt_at:new Date().toISOString()});await event(pid,'HOLD','DELIVERY_ADDRESS_MISMATCH_OR_MISSING',{erp_cep:cep,candidate_cep:cand.cep_destino});held++;continue}}
  const sr=await erp('fn_joao_registrar_venda_recebida_v2',{p_phone:cand.phone,p_payment_id:pid,p_payment_status:'approved',p_paid_at:cand.paid_at,p_itens:items,p_valor_frete:cand.valor_frete,p_total:cand.total,p_tipo_envio:cand.tipo_envio,p_servico_frete:cand.servico_frete||null,p_cep_destino:cand.cep_destino||null,p_endereco_entrega:endereco,p_proof:cand.proof||{}},30000);const sale=sr.data;if(!sr.ok||!sale?.ok){const code=String(sale?.code||`SALE_HTTP_${sr.status}`);await state(pid,{lead_id:cand.lead_id,status:'ERROR',attempts,last_code:code,candidate:cand,result:sale,last_attempt_at:new Date().toISOString()});await event(pid,'ERROR',code,sale||{});errors++;continue}
  const or=await erp('fn_joao_gerar_op_venda_v1',{p_venda_id:sale.venda_id,p_payment_id:pid},30000);const op=or.data;if(!or.ok||!op?.ok){const code=String(op?.code||`OP_HTTP_${or.status}`);await state(pid,{lead_id:cand.lead_id,status:'ERROR',attempts,last_code:`OP_${code}`,candidate:cand,result:{sale,op},erp_venda_id:sale.venda_id,erp_numero_venda:sale.numero_venda,last_attempt_at:new Date().toISOString()});await event(pid,'ERROR',`OP_${code}`,{sale,op});errors++;continue}
  await state(pid,{lead_id:cand.lead_id,status:'SYNCED',attempts,last_code:String(op.code||'SYNCED'),candidate:cand,result:{sale,op,route:'legacy_multi',client:legacyClient},erp_venda_id:sale.venda_id,erp_numero_venda:sale.numero_venda,erp_op_id:op.op_id,erp_numero_op:op.numero_op,last_attempt_at:new Date().toISOString(),synced_at:new Date().toISOString(),op_synced_at:new Date().toISOString()});await event(pid,'SYNCED',String(op.code||'SYNCED'),{route:'legacy_multi',venda_id:sale.venda_id,numero_venda:sale.numero_venda,op_id:op.op_id,numero_op:op.numero_op,item_count:items.length,total:cand.total});synced++;
 }
 return out({ok:true,active:true,processed,synced,held,errors,canonical,legacy,client_pending:clientPending,registration_sent:registrationSent,clients_resolved:clientsResolved,version:V});
});
