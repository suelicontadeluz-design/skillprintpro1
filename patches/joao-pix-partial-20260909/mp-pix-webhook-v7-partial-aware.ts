// mp-pix-webhook v7-partial-aware — 09/09/2026
// - provider approval updates the individual payment first
// - cumulative state comes from fn_joao_orcamento_payment_state_v1
// - partial payment: NO Purchase, NO RD WON, NO orcamento=pago
// - settlement payment: one order-level Purchase for full order value, then pago/WON
// - preserves pack delivery path
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth:{persistSession:false,autoRefreshToken:false} });
const VERSION='mp-pix-webhook/v7-partial-aware';
const L=(step:string,detail:any={})=>console.log(JSON.stringify({fn:'mp-pix-webhook',version:VERSION,step,...detail}));
const BOT_BASE='https://backend.botconversa.com.br/api/v1/webhook';
const STAGE_FECHAMENTO='697346abbee8c100131e02a1';

const dispararCapi=(lead_id:string,event_name:string,value?:number,event_id?:string):void=>{
  fetch(`${SUPABASE_URL}/functions/v1/capi-routed`,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},
    body:JSON.stringify({lead_id,event_name,...(value?{value}:{}),...(event_id?{event_id}:{})})
  }).catch(()=>{});
};

async function sendBCMessage(subscriberId:string,message:string):Promise<void>{
  try{await fetch(`${BOT_BASE}/subscriber/${subscriberId}/send_message/`,{method:'POST',headers:{accept:'application/json','content-type':'application/json','API-KEY':BOT_API_KEY},body:JSON.stringify({type:'text',value:`*Julia Bitencourt:*\n${message}`})})}catch{}
}

async function entregarPack(paymentId:string,externalRef:string,mpData:any,valor:number):Promise<void>{
  const semPrefixo=externalRef.slice('pack_'.length); const idx=semPrefixo.indexOf('_');
  const pack_slug=semPrefixo.slice(0,idx); const lead_id=semPrefixo.slice(idx+1);
  L('pack_processando',{paymentId,pack_slug,lead_id,valor});
  await sb.from('mp_pack_cobrancas').update({status:'approved',mp_response:mpData,paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('payment_id',String(paymentId));
  const {data:cob}=await sb.from('mp_pack_cobrancas').select('link_entregue').eq('payment_id',String(paymentId)).maybeSingle();
  if(cob?.link_entregue){L('pack_ja_entregue',{paymentId});return}
  const {data:pack}=await sb.from('julia_packs').select('tema,qtd_artes_label,link_drive').eq('slug',pack_slug).maybeSingle();
  if(!pack){L('pack_nao_encontrado',{pack_slug});return}
  const {data:lm}=await sb.from('leads_marketing').select('fullname').eq('lead_id',lead_id).maybeSingle();
  const nome=(lm?.fullname||'Cliente').split(' ')[0];
  const eventId=`mp_pack_${paymentId}`;
  const {data:jaProc}=await sb.from('pixel_events').select('event_id').eq('lead_id',lead_id).eq('event_name','Purchase').eq('event_id',eventId).maybeSingle();
  if(!jaProc){
    await sb.from('pixel_events').insert({lead_id,event_name:'Purchase',event_time:new Date().toISOString(),event_id:eventId,event_source:'chat',value:valor,currency:'BRL',content_category:`pack_${pack_slug}`});
    dispararCapi(lead_id,'Purchase',valor,eventId);
  }
  const {data:ae}=await sb.from('agente_exploracao_estado').select('subscriber_id').eq('lead_id',lead_id).maybeSingle();
  if(ae?.subscriber_id)await sendBCMessage(ae.subscriber_id,`Pagamento confirmado! ✅\n\nOi ${nome}, aqui está o seu *Pack ${pack.tema}* (${pack.qtd_artes_label} artes prontas pra DTF):\n\n${pack.link_drive}\n\nÉ só acessar e baixar. As artes são suas pra usar e revender. Qualquer dúvida, é só chamar! 🚀`);
  await sb.from('mp_pack_cobrancas').update({link_entregue:true,updated_at:new Date().toISOString()}).eq('payment_id',String(paymentId));
  L('pack_entregue',{paymentId,pack_slug,lead_id});
}

Deno.serve(async(req)=>{
  if(req.method==='GET')return new Response('ok',{status:200});
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  let body:any; try{body=await req.json()}catch{return new Response('ok',{status:200})}
  const paymentId=body?.data?.id; const topic=body?.type||body?.topic;
  L('webhook_recebido',{type:body?.type,action:body?.action,id:paymentId});
  if(!paymentId||!['payment','merchant_order'].includes(topic)){L('ignorado',{reason:'nao_e_pagamento',topic});return new Response('ok',{status:200})}

  const mpRes=await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{headers:{authorization:`Bearer ${MP_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000)});
  if(!mpRes.ok){L('mp_consulta_erro',{status:mpRes.status});return new Response('ok',{status:200})}
  const mpData=await mpRes.json();
  const status=String(mpData?.status||''); const orcamento_id=mpData?.external_reference; const valor=Number(mpData?.transaction_amount||0);
  L('mp_status',{paymentId,status,orcamento_id,valor});

  if(typeof orcamento_id==='string'&&orcamento_id.startsWith('pack_')){
    if(status==='approved')await entregarPack(String(paymentId),orcamento_id,mpData,valor);
    else await sb.from('mp_pack_cobrancas').update({status,mp_response:mpData,updated_at:new Date().toISOString()}).eq('payment_id',String(paymentId));
    return new Response('ok',{status:200});
  }

  const paidAt=status==='approved' ? String(mpData?.date_approved||mpData?.date_last_updated||new Date().toISOString()) : null;
  await sb.from('mp_pix_cobrancas').update({status,mp_response:mpData,paid_at:paidAt,updated_at:new Date().toISOString()}).eq('payment_id',String(paymentId));
  if(status!=='approved'){L('nao_aprovado',{status});return new Response('ok',{status:200})}
  if(!orcamento_id){L('sem_orcamento_id');return new Response('ok',{status:200})}

  const {data:orc}=await sb.from('orcamentos').select('id,lead_id,valor_total,metros,quantidade_copias,deal_id,status').eq('id',orcamento_id).maybeSingle();
  if(!orc?.lead_id){L('orcamento_nao_encontrado',{orcamento_id});return new Response('ok',{status:200})}

  const {data:paymentState,error:stateErr}=await sb.rpc('fn_joao_orcamento_payment_state_v1',{p_orcamento_id:orcamento_id,p_as_of:new Date().toISOString()});
  if(stateErr||!paymentState?.ok){
    L('payment_state_error',{orcamento_id,error:stateErr?.message||null,state:paymentState||null});
    await sb.from('error_log').insert({function_name:'mp-pix-webhook',error_message:'payment_state_unavailable',payload:{payment_id:String(paymentId),orcamento_id,detail:stateErr?.message||paymentState||null}});
    return new Response('ok',{status:200});
  }

  const orderTotal=Number(paymentState.order_total||orc.valor_total||0);
  const paidTotal=Number(paymentState.paid_total_raw||0);
  const balance=Number(paymentState.balance||0);
  const fullyPaid=paymentState.fully_paid===true;
  const lead_id=orc.lead_id;

  if(!fullyPaid){
    // Financial evidence is valid, but the order is NOT settled.
    // Keep the commercial proposal open and do not emit Purchase/WON/post-sale.
    if(orc.status==='pago')await sb.from('orcamentos').update({status:'enviado',updated_at:new Date().toISOString()}).eq('id',orcamento_id);
    L('pagamento_parcial_confirmado',{payment_id:String(paymentId),lead_id,orcamento_id,valor_parcela:valor,total_pago:paidTotal,total_pedido:orderTotal,saldo:balance});
    return new Response('ok',{status:200});
  }

  const {data:lm}=await sb.from('leads_marketing').select('fullname,ph,content_category,utm_source,utm_medium,utm_campaign_id,utm_adset_id,utm_ad_id').eq('lead_id',lead_id).maybeSingle();

  // One conversion per ORDER. Also recognize legacy mp_pix_<payment> Purchase ids so replaying an old full payment does not duplicate analytics.
  const {data:approvedRows}=await sb.from('mp_pix_cobrancas').select('payment_id').eq('orcamento_id',orcamento_id).eq('status','approved');
  const candidateEventIds=[`mp_order_${orcamento_id}`,...(approvedRows||[]).map((x:any)=>`mp_pix_${x.payment_id}`)];
  const {data:existingPurchase}=await sb.from('pixel_events').select('event_id').eq('lead_id',lead_id).eq('event_name','Purchase').in('event_id',candidateEventIds).limit(1).maybeSingle();
  const orderEventId=`mp_order_${orcamento_id}`;
  if(!existingPurchase){
    await sb.from('pixel_events').insert({lead_id,event_name:'Purchase',event_time:new Date().toISOString(),event_id:orderEventId,event_source:'chat',value:orderTotal,currency:'BRL',content_category:lm?.content_category??null,source:lm?.utm_source??null,medium:lm?.utm_medium??null,campaign_id:lm?.utm_campaign_id??null,adset_id:lm?.utm_adset_id??null,ad_id:lm?.utm_ad_id??null});
    dispararCapi(lead_id,'Purchase',orderTotal,orderEventId);
    L('purchase_lancado_order_level',{lead_id,orcamento_id,orderEventId,orderTotal});
  }else L('purchase_ja_existia',{lead_id,orcamento_id,event_id:existingPurchase.event_id});

  await sb.from('orcamentos').update({status:'pago',updated_at:new Date().toISOString()}).eq('id',orcamento_id);

  const dealId=orc.deal_id; let rdWonStatus:number|null=null;
  if(dealId){
    const {data:tokenData}=await sb.from('token_crm').select('token').limit(1).single(); const rdToken=tokenData?.token??'';
    let jaWon=false;
    try{const atual=await fetch(`https://api.rd.services/crm/v2/deals/${dealId}`,{headers:{accept:'application/json',authorization:`Bearer ${rdToken}`},signal:AbortSignal.timeout(12000)});const aj=await atual.json().catch(()=>({}));jaWon=aj?.data?.status==='won'}catch{}
    if(jaWon)L('rd_ja_won',{dealId});
    else{
      const rdRes=await fetch(`https://api.rd.services/crm/v2/deals/${dealId}`,{method:'PUT',headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${rdToken}`},body:JSON.stringify({data:{status:'won',stage_id:STAGE_FECHAMENTO}}),signal:AbortSignal.timeout(15000)});
      rdWonStatus=rdRes.status; L('rd_won',{status:rdRes.status,dealId});
      if(!rdRes.ok){const det=await rdRes.text().catch(()=>'');await sb.from('error_log').insert({function_name:'mp-pix-webhook',error_message:`rd_won_falhou_status_${rdRes.status}`,payload:{deal_id:dealId,orcamento_id,lead_id,order_total:orderTotal,total_pago:paidTotal,resposta:det.slice(0,300)}})}
    }
  }else{
    L('sem_deal_id',{orcamento_id,lead_id});
    await sb.from('error_log').insert({function_name:'mp-pix-webhook',error_message:'pagamento_quitado_sem_deal_id',payload:{orcamento_id,lead_id,order_total:orderTotal,total_pago:paidTotal}});
  }

  await sb.from('agente_exploracao_estado').update({status:'bloqueada_purchase',updated_at:new Date().toISOString()}).eq('lead_id',lead_id);
  L('pedido_quitado',{payment_id:String(paymentId),lead_id,orcamento_id,valor_parcela:valor,total_pago:paidTotal,total_pedido:orderTotal,overpaid:Number(paymentState.overpaid||0),dealId,rd_won:rdWonStatus});
  return new Response('ok',{status:200});
});
