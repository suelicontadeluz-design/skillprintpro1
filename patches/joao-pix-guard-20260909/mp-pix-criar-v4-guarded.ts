// mp-pix-criar v4-guarded — 09/09/2026
// - hard preflight via fn_joao_pix_charge_guard_v1
// - canonical 50% shirt deposit comes from guard
// - requires customer-visible total + charge amount (when partial) + acceptance
// - if customer explicitly reports broken/expired PIX, cancels pending MP payment before replacement
// - fresh idempotency key per persisted attempt; retries before persistence remain idempotent
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth:{persistSession:false,autoRefreshToken:false} });
const VERSION = 'mp-pix-criar/v4-guarded';
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/mp-pix-webhook`;
const json = (x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json'}});
const L=(step:string,detail:any={})=>console.log(JSON.stringify({fn:'mp-pix-criar',version:VERSION,step,...detail}));
const round2=(n:any)=>Math.round((Number(n)+Number.EPSILON)*100)/100;

function sincronizarRD(orcamento_id:string):void {
  fetch(`${SUPABASE_URL}/functions/v1/rd-deal-sync`,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},body:JSON.stringify({orcamento_id})
  }).catch(()=>{});
}

async function mpGet(paymentId:string){
  const r=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,{
    headers:{authorization:`Bearer ${MP_ACCESS_TOKEN}`},signal:AbortSignal.timeout(12000)
  });
  return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};
}

async function cancelPending(paymentId:string){
  const r=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,{
    method:'PUT',
    headers:{'content-type':'application/json',authorization:`Bearer ${MP_ACCESS_TOKEN}`,'X-Idempotency-Key':`skillprint-pix-cancel-${paymentId}-v4`},
    body:JSON.stringify({status:'cancelled'}),signal:AbortSignal.timeout(15000)
  });
  const data=await r.json().catch(()=>null);
  if(r.ok){
    await sb.from('mp_pix_cobrancas').update({status:'cancelled',mp_response:data,updated_at:new Date().toISOString()}).eq('payment_id',paymentId);
    return {ok:true,status:'cancelled',provider:data};
  }
  // Provider may have transitioned meanwhile. Never replace an approved payment.
  const current=await mpGet(paymentId);
  const st=String(current.data?.status||'');
  if(st==='approved') return {ok:false,status:'approved',code:'PAYMENT_ALREADY_APPROVED',provider:current.data};
  if(['cancelled','canceled','rejected','expired'].includes(st)){
    await sb.from('mp_pix_cobrancas').update({status:st==='canceled'?'cancelled':st,mp_response:current.data,updated_at:new Date().toISOString()}).eq('payment_id',paymentId);
    return {ok:true,status:st,provider:current.data};
  }
  return {ok:false,status:st||`http_${r.status}`,code:'PAYMENT_CANCEL_FAILED',provider:data||current.data};
}

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({ok:false,error:'method_not_allowed',version:VERSION},405);
  if((req.headers.get('authorization')||'')!==`Bearer ${SUPABASE_SERVICE_KEY}`) return json({ok:false,error:'unauthorized',version:VERSION},401);
  let body:any={}; try{body=await req.json()}catch{return json({ok:false,error:'bad_json',version:VERSION},400)}
  const orcamento_id=String(body?.orcamento_id||'').trim();
  const lead_id=String(body?.lead_id||'').trim();
  const dry_run=body?.dry_run===true;
  if(!orcamento_id||!lead_id) return json({ok:false,error:'orcamento_id_e_lead_id_obrigatorios',version:VERSION},400);

  const {data:guard,error:guardErr}=await sb.rpc('fn_joao_pix_charge_guard_v1',{p_orcamento_id:orcamento_id,p_lead_id:lead_id,p_as_of:new Date().toISOString()});
  if(guardErr){L('guard_error',{orcamento_id,error:guardErr.message});return json({ok:false,error:'pix_preflight_unavailable',version:VERSION},503)}
  if(!guard?.ok){
    L('guard_hold',{orcamento_id,lead_id,status:guard?.status,expected_charge:guard?.expected_charge,regenerate_requested:guard?.regenerate_requested});
    return json({ok:false,error:'pix_preflight_hold',guard,version:VERSION},409);
  }

  const {data:orc}=await sb.from('orcamentos').select('id,lead_id,produto,valor_total,valor_cobranca,observacao_pagamento,metros,quantidade_copias,status').eq('id',orcamento_id).eq('lead_id',lead_id).maybeSingle();
  if(!orc) return json({ok:false,error:'orcamento_nao_encontrado',version:VERSION},404);
  const valorPedido=round2(guard.order_total);
  const valorPix=round2(guard.expected_charge);
  if(!(valorPedido>0&&valorPix>0&&valorPix<=valorPedido+0.01)) return json({ok:false,error:'guard_amount_invalid',guard,version:VERSION},409);
  const ehParcial=valorPix<valorPedido-0.01;

  const {data:lm}=await sb.from('leads_marketing').select('fullname,em').eq('lead_id',lead_id).maybeSingle();
  const nome=lm?.fullname||'Cliente';
  const email=lm?.em||`lead.${lead_id.slice(0,8)}@skillprint.app`;

  const {data:pending}=await sb.from('mp_pix_cobrancas').select('payment_id,qr_code,checkout_url,expiracao,status,valor').eq('orcamento_id',orcamento_id).eq('status','pending').order('created_at',{ascending:false}).limit(1).maybeSingle();
  const pendingValid=!!(pending?.payment_id&&pending?.qr_code&&new Date(pending.expiracao)>new Date());
  const pendingAmountMatch=pendingValid&&Math.abs(round2(pending.valor)-valorPix)<=0.01;
  const mustReplace=!!pending?.payment_id && (!!guard.regenerate_requested || !pendingAmountMatch || !pendingValid);

  if(dry_run){
    return json({ok:true,dry_run:true,version:VERSION,guard,valor_total_pedido:valorPedido,valor_cobranca:valorPix,cobranca_parcial:ehParcial,pending:pending||null,would_reuse:pendingAmountMatch&&!guard.regenerate_requested,would_replace:mustReplace,would_create:!pendingAmountMatch||!!guard.regenerate_requested});
  }

  if(pendingAmountMatch&&!guard.regenerate_requested){
    L('reaproveitado',{payment_id:pending.payment_id,valor:pending.valor});
    sincronizarRD(orcamento_id);
    return json({ok:true,reaproveitado:true,payment_id:pending.payment_id,qr_code:pending.qr_code,checkout_url:pending.checkout_url,expiracao:pending.expiracao,valor:round2(pending.valor),valor_total_pedido:valorPedido,cobranca_parcial:ehParcial,version:VERSION});
  }

  let regeneratedFrom:string|null=null;
  if(mustReplace&&pending?.payment_id){
    const cancelled=await cancelPending(String(pending.payment_id));
    L('pending_replace',{payment_id:pending.payment_id,cancelled:cancelled.ok,status:cancelled.status,code:cancelled.code||null});
    if(!cancelled.ok) return json({ok:false,error:cancelled.code||'pix_anterior_nao_cancelado',payment_id:pending.payment_id,provider_status:cancelled.status,version:VERSION},409);
    regeneratedFrom=String(pending.payment_id);
  }

  // Persist the canonical charge intent on the budget for auditability.
  const patch:any={valor_cobranca:valorPix,updated_at:new Date().toISOString()};
  if(ehParcial&&!orc.observacao_pagamento) patch.observacao_pagamento=guard.deposit_pct?`${guard.deposit_pct}% de sinal conforme politica canonica de camisetas`:'cobranca parcial validada pelo preflight';
  await sb.from('orcamentos').update(patch).eq('id',orcamento_id);

  const {count}=await sb.from('mp_pix_cobrancas').select('payment_id',{count:'exact',head:true}).eq('orcamento_id',orcamento_id);
  const attempt=Number(count||0)+1;
  const amountKey=valorPix.toFixed(2);
  const idem=`skillprint-pix-${orcamento_id}-${amountKey}-a${attempt}`;
  const expiracao=new Date(Date.now()+24*60*60*1000).toISOString();
  const descricao=ehParcial?`Skillprint - entrada de ${valorPix.toFixed(2)} (pedido ${valorPedido.toFixed(2)})`:`Skillprint - pedido ${valorPedido.toFixed(2)}`;

  L('criando_pix',{orcamento_id,valor_pix:valorPix,valor_pedido:valorPedido,attempt,regenerated_from:regeneratedFrom});
  const pixRes=await fetch('https://api.mercadopago.com/v1/payments',{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${MP_ACCESS_TOKEN}`,'X-Idempotency-Key':idem},
    body:JSON.stringify({transaction_amount:valorPix,description:descricao,payment_method_id:'pix',date_of_expiration:expiracao,external_reference:orcamento_id,payer:{email,first_name:nome.split(' ')[0],last_name:nome.split(' ').slice(1).join(' ')||'Cliente'},notification_url:WEBHOOK_URL}),
    signal:AbortSignal.timeout(20000)
  });
  const pixData=await pixRes.json().catch(()=>null);
  if(!pixRes.ok||!pixData?.id){L('pix_create_failed',{status:pixRes.status,detail:pixData});return json({ok:false,error:'falha_ao_criar_pix',detail:pixData,version:VERSION},502)}
  const payment_id=String(pixData.id);
  const qr_code=pixData.point_of_interaction?.transaction_data?.qr_code??null;
  const qr_code_base64=pixData.point_of_interaction?.transaction_data?.qr_code_base64??null;

  let checkout_url:string|null=null, preference_id:string|null=null;
  try{
    const prefRes=await fetch('https://api.mercadopago.com/checkout/preferences',{
      method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${MP_ACCESS_TOKEN}`,'X-Idempotency-Key':`skillprint-pref-${orcamento_id}-${amountKey}-a${attempt}`},
      body:JSON.stringify({items:[{id:orcamento_id,title:descricao,description:'Skillprint Estamparia',quantity:1,currency_id:'BRL',unit_price:valorPix}],payer:{name:nome.split(' ')[0],surname:nome.split(' ').slice(1).join(' ')||'Cliente',email},payment_methods:{excluded_payment_types:[{id:'ticket'}],installments:3},external_reference:orcamento_id,notification_url:WEBHOOK_URL,expires:true,expiration_date_to:expiracao}),signal:AbortSignal.timeout(15000)
    });
    const prefData=await prefRes.json().catch(()=>null);
    if(prefRes.ok&&prefData?.id){preference_id=String(prefData.id);checkout_url=prefData.init_point||null}else L('preference_failed',{status:prefRes.status,detail:prefData});
  }catch(e:any){L('preference_exception',{error:String(e?.message||e).slice(0,200)})}

  await sb.from('mp_pix_cobrancas').upsert({payment_id,orcamento_id,lead_id,valor:valorPix,status:'pending',qr_code,qr_code_base64,expiracao,checkout_url,preference_id,updated_at:new Date().toISOString(),mp_response:pixData},{onConflict:'payment_id'});
  sincronizarRD(orcamento_id);
  L('cobranca_criada',{payment_id,orcamento_id,valor_pix:valorPix,valor_pedido:valorPedido,parcial:ehParcial,attempt,regenerated_from:regeneratedFrom});
  return json({ok:true,payment_id,qr_code,qr_code_base64,checkout_url,preference_id,expiracao,valor:valorPix,valor_total_pedido:valorPedido,cobranca_parcial:ehParcial,regenerated_from:regeneratedFrom,attempt,version:VERSION});
});
