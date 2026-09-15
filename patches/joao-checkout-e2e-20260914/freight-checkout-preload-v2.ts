declare const Deno: any;

// João freight checkout v2.2 — 14/09/2026
// Does not depend on the model receiving the old freight message in its prompt.
// Named service is resolved from CEP + canonical persisted freight snapshot.
// Subsequent "Pix/sim" resumes from the recent canonical total for that CEP.
// v2.2: only executes on the final decision call identified by the trailing [SISTEMA:] user marker.
const FC2_URL=(Deno.env.get('SUPABASE_URL')??'').replace(/\/$/,'');
const FC2_SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const FC2_VERSION='joao-freight-checkout/v2.2';
const fc2BaseFetch=globalThis.fetch.bind(globalThis);
let fc2CfgAt=0,fc2Cfg=false;
type Ctx={inbound:string;cep:string;service:string|null;wantsPayment:boolean};
function urlOf(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url}
async function rawBody(input:RequestInfo|URL,init?:RequestInit){if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text()}catch{}}return''}
function txt(c:any){if(typeof c==='string')return c.trim();if(!Array.isArray(c))return'';return c.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim()}
function hasTool(c:any){return Array.isArray(c)&&c.some((x:any)=>x?.type==='tool_result')}
function norm(s:any){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function explicitService(s:string):string|null{const hits=new Set<string>(),t=String(s||'');if(/(^|\W)pac(\W|$)/i.test(t))hits.add('PAC');if(/(^|\W)sedex(\W|$)/i.test(t))hits.add('Sedex');if(/j\s*&\s*t|j\s+e\s+t|(^|\W)jt(\W|$)/i.test(t))hits.add('J&T Standard');return hits.size===1?[...hits][0]:null}
function paymentSignal(s:string){return /\b(pix|copia\s*e\s*cola|c[oó]digo\s+pix|gera(?:r|)?|gere|manda(?:r|)?|mande|pagar|pagamento)\b/i.test(s)||/^\s*(sim|pode|fechado|correto|confirmo|confirmado)\s*[!.]?\s*$/i.test(s)}
function money(n:any){return Number(n).toFixed(2).replace('.',',')}
function finalDecisionCall(messages:any[]):boolean{if(!Array.isArray(messages)||!messages.length)return false;const last=messages[messages.length-1];return last?.role==='user'&&/^\s*\[SISTEMA:/i.test(txt(last?.content))}
function dialogue(messages:any[]){const d:{role:string;text:string}[]=[];for(const m of messages||[]){if(!m||!['user','assistant'].includes(m.role)||hasTool(m.content))continue;const t=txt(m.content);if(!t||/^\s*\[SISTEMA:/i.test(t))continue;d.push({role:m.role,text:t})}return d}
function cepFrom(body:any,d:{role:string;text:string}[]):string{
  for(let i=d.length-1;i>=0;i--){const m=d[i].text.match(/\b(\d{5})-?(\d{3})\b/);if(m)return m[1]+m[2]}
  const sys=String(body?.system??'');
  let m=sys.match(/["']?cep["']?\s*[:=]\s*["']?(\d{5})-?(\d{3})/i);if(m)return m[1]+m[2];
  m=sys.match(/CEP[^0-9]{0,30}(\d{5})-?(\d{3})/i);return m?m[1]+m[2]:'';
}
function context(body:any):Ctx|null{
  const d=dialogue(body?.messages||[]);let inbound='';for(let i=d.length-1;i>=0;i--)if(d[i].role==='user'){inbound=d[i].text;break}if(!inbound)return null;
  const cep=cepFrom(body,d);if(!cep)return null;
  const service=explicitService(inbound),wantsPayment=paymentSignal(inbound);
  if(!service&&!wantsPayment)return null;
  return{inbound,cep,service,wantsPayment};
}
async function enabled(){if(Date.now()-fc2CfgAt<15000)return fc2Cfg;fc2CfgAt=Date.now();try{const r=await fc2BaseFetch(`${FC2_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_freight_checkout_v2_ativo&limit=1`,{headers:{apikey:FC2_SERVICE,authorization:`Bearer ${FC2_SERVICE}`},signal:AbortSignal.timeout(1300)});const a=r.ok?await r.json():[];fc2Cfg=Array.isArray(a)&&a[0]?.valor_bool===true}catch{}return fc2Cfg}
async function rpc(name:string,args:any,timeout=5000){const r=await fc2BaseFetch(`${FC2_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',apikey:FC2_SERVICE,authorization:`Bearer ${FC2_SERVICE}`},body:JSON.stringify(args),signal:AbortSignal.timeout(timeout)});const data=await r.json().catch(()=>null);return{ok:r.ok,status:r.status,data}}
async function edge(slug:string,body:any,timeout=15000){const r=await fc2BaseFetch(`${FC2_URL}/functions/v1/${slug}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${FC2_SERVICE}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const data=await r.json().catch(()=>null);return{ok:r.ok,status:r.status,data}}
async function ledger(paymentId:string,leadId:string,qr:string){try{const q=`${FC2_URL}/rest/v1/mp_pix_cobrancas?select=payment_id,status,valor,qr_code,expiracao&payment_id=eq.${encodeURIComponent(paymentId)}&lead_id=eq.${encodeURIComponent(leadId)}&status=eq.pending&limit=1`;const r=await fc2BaseFetch(q,{headers:{apikey:FC2_SERVICE,authorization:`Bearer ${FC2_SERVICE}`},signal:AbortSignal.timeout(1800)});const a=r.ok?await r.json():[];const x=Array.isArray(a)?a[0]:null;return !!x&&String(x.qr_code||'')===qr&&new Date(String(x.expiracao||0))>new Date()}catch{return false}}
async function audit(evento:string,detail:any){try{await fc2BaseFetch(`${FC2_URL}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:FC2_SERVICE,authorization:`Bearer ${FC2_SERVICE}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-freight-checkout',versao:FC2_VERSION,nivel:'info',categoria:'checkout_runtime',evento,status:'applied',mensagem:String(detail?.code??detail?.status??evento),lead_id:detail?.lead_id??null,detalhe:detail}),signal:AbortSignal.timeout(1200)})}catch{}}
function anthropic(body:any,decision:any,extra:Record<string,string>={}){const text=JSON.stringify(decision);return new Response(JSON.stringify({id:`msg_fc2_${crypto.randomUUID().replace(/-/g,'').slice(0,16)}`,type:'message',role:'assistant',model:body?.model||'claude',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:Math.ceil(text.length/4)}}),{status:200,headers:{'content-type':'application/json','x-cortex-freight-checkout':FC2_VERSION,...extra}})}
function totalDecision(ctx:Ctx,res:any,projection:any,pixRequested:boolean){const total=Number(res.total_amount),frete=Number(res.amount??res.freight_amount??0),service=String(res.service??'frete escolhido');const mensagem=pixRequested?`Fechado! Vamos de ${service} por R$ ${money(frete)}. Com o frete, o total fica *R$ ${money(total)}*. Posso gerar o Pix copia e cola nesse valor?`:`Fechado! Vamos de ${service} por R$ ${money(frete)}. Com o frete, o total fica *R$ ${money(total)}*. Você prefere Pix ou cartão?`;return{responde:true,mensagem,tema:pixRequested?'fechamento_pix':'fechamento',encaminhou_venda:false,etapa:'fechamento',slots:{modalidade_logistica:'envio',envio_retirada:'envio',cep:ctx.cep,frete_servico_escolhido:service,frete_valor_escolhido:frete,frete_quote_id:res.quote_id??null,freight_operation_id:res.freight_operation_id??null,pedido_total_operation_id:res.total_operation_id??null,orcamento_id:projection?.orcamento_id??null,pagamento:pixRequested?'pix':null}}}
function pixDecision(ctx:Ctx,res:any,projection:any,pix:any){const qr=String(pix.qr_code),total=Number(pix.valor_total_pedido??res.total_amount),frete=Number(res.amount??res.freight_amount??0),service=String(res.service??'frete escolhido');return{responde:true,mensagem:`Perfeito. Gerei o Pix de *R$ ${money(Number(pix.valor))}* para o pedido de R$ ${money(total)}.\n\n${qr}`,tema:'fechamento_pix',encaminhou_venda:true,etapa:'fechamento',slots:{modalidade_logistica:'envio',envio_retirada:'envio',cep:ctx.cep,frete_servico_escolhido:service,frete_valor_escolhido:frete,frete_quote_id:res.quote_id??null,freight_operation_id:res.freight_operation_id??null,pedido_total_operation_id:res.total_operation_id??null,orcamento_id:projection.orcamento_id,pagamento:'pix',payment_id:pix.payment_id}}}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input);if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)||!(await enabled()))return fc2BaseFetch(input,init);
  const raw=await rawBody(input,init);let body:any;try{body=JSON.parse(raw)}catch{return fc2BaseFetch(input,init)};if(!Array.isArray(body?.messages))return fc2BaseFetch(input,init);
  if(!finalDecisionCall(body.messages))return fc2BaseFetch(input,init);
  const ctx=context(body);if(!ctx)return fc2BaseFetch(input,init);

  let resolved:any=null;
  if(ctx.service){
    const auth=await rpc('fn_joao_authorize_named_freight_choice_v2',{p_cep:ctx.cep,p_service:ctx.service,p_customer_text:ctx.inbound.slice(0,240),p_as_of:new Date().toISOString()},5000);
    if(auth.ok&&['RESOLVED_TOTAL','RESOLVED_TOTAL_REUSED'].includes(String(auth.data?.status??'')))resolved=auth.data;
    else{void audit('freight_named_choice_not_resolved',{status:auth.data?.status??null,http:auth.status,service:ctx.service,cep:ctx.cep});return fc2BaseFetch(input,init)}
  }else{
    const recent=await rpc('fn_joao_recent_checkout_context_v1',{p_cep:ctx.cep,p_as_of:new Date().toISOString()},4000);
    if(recent.ok&&recent.data?.ok===true&&recent.data?.status==='RECENT_CHECKOUT')resolved=recent.data;
    else return fc2BaseFetch(input,init);
  }

  const leadId=String(resolved?.lead_id??''),totalOp=String(resolved?.total_operation_id??'');
  if(!/^[0-9a-f-]{36}$/i.test(leadId)||!/^[0-9a-f-]{36}$/i.test(totalOp))return fc2BaseFetch(input,init);
  const sync=await edge('joao-erp-orcamento-sync',{operation_id:totalOp},18000);
  if(!sync.ok||Number(sync.data?.failed??0)>0){void audit('checkout_erp_sync_hold',{lead_id:leadId,total_operation_id:totalOp,http:sync.status,result:sync.data});return anthropic(body,{responde:true,mensagem:'O frete está escolhido, mas o total ainda não passou pela conferência do ERP. Não vou gerar cobrança antes disso.',tema:'fechamento_pix',encaminhou_venda:false,etapa:'fechamento',slots:{cep:ctx.cep,pagamento:null}})}
  const proj=await rpc('fn_joao_checkout_projection_from_total_v1',{p_total_operation_id:totalOp},5000);
  if(!proj.ok||proj.data?.ok!==true){void audit('checkout_projection_hold',{lead_id:leadId,total_operation_id:totalOp,code:proj.data?.code??`HTTP_${proj.status}`});return anthropic(body,totalDecision(ctx,resolved,null,ctx.wantsPayment))}
  const projection=proj.data;
  if(!ctx.wantsPayment){void audit('freight_choice_total_ready',{lead_id:leadId,total_operation_id:totalOp,orcamento_id:projection.orcamento_id,total:resolved.total_amount});return anthropic(body,totalDecision(ctx,resolved,projection,false))}

  const guard=await rpc('fn_joao_pix_charge_guard_v1',{p_orcamento_id:projection.orcamento_id,p_lead_id:leadId,p_as_of:new Date().toISOString()},5000);
  if(!guard.ok||guard.data?.ok!==true){void audit('pix_waiting_customer_total_acceptance',{lead_id:leadId,total_operation_id:totalOp,orcamento_id:projection.orcamento_id,guard_status:guard.data?.status??`HTTP_${guard.status}`});return anthropic(body,totalDecision(ctx,resolved,projection,true))}
  const contract=await rpc('fn_joao_checkout_confirm_pix_contract_v1',{p_orcamento_id:projection.orcamento_id,p_lead_id:leadId,p_as_of:new Date().toISOString()},5000);
  if(!contract.ok||contract.data?.ok!==true){void audit('pix_contract_hold',{lead_id:leadId,orcamento_id:projection.orcamento_id,code:contract.data?.code??`HTTP_${contract.status}`});return anthropic(body,{responde:true,mensagem:'O total está confirmado, mas a cobrança não foi liberada. Não vou enviar um Pix sem validação.',tema:'fechamento_pix',encaminhou_venda:false,etapa:'fechamento',slots:{cep:ctx.cep,pagamento:'pix',orcamento_id:projection.orcamento_id}})}
  const pix=await edge('mp-pix-criar',{orcamento_id:projection.orcamento_id,lead_id:leadId},22000);
  const qr=String(pix.data?.qr_code??''),paymentId=String(pix.data?.payment_id??'');
  if(!pix.ok||pix.data?.ok!==true||!qr||!paymentId||!(await ledger(paymentId,leadId,qr))){void audit('pix_create_or_ledger_hold',{lead_id:leadId,orcamento_id:projection.orcamento_id,http:pix.status,error:pix.data?.error??null,payment_id:paymentId||null});return anthropic(body,{responde:true,mensagem:'Não consegui confirmar a criação do Pix, então não vou te passar nenhum código sem validação.',tema:'fechamento_pix',encaminhou_venda:false,etapa:'fechamento',slots:{cep:ctx.cep,pagamento:'pix',orcamento_id:projection.orcamento_id}})}
  void audit('pix_created_from_freight_checkout',{lead_id:leadId,total_operation_id:totalOp,orcamento_id:projection.orcamento_id,payment_id:paymentId,valor:pix.data.valor,freight_service:resolved.service});
  return anthropic(body,pixDecision(ctx,resolved,projection,pix.data),{'x-cortex-payment-id':paymentId});
};
