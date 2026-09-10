// comprovante-pix-worker v7-manual-erp — 09/09/2026
// Preserva v6 partial-aware e adiciona: banco recebedor, recebedor e sync ERP de quitacao manual unica.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY=Deno.env.get('ANTHROPIC_API_KEY')!;
const ZAPI_INSTANCE=Deno.env.get('ZAPI_INSTANCE_ID')!;
const ZAPI_TOKEN=Deno.env.get('ZAPI_TOKEN')!;
const ZAPI_CLIENT_TOKEN=Deno.env.get('ZAPI_CLIENT_TOKEN')!;
const PHONE_ADMIN='5511939490508';
const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const VERSION='v7-manual-erp';
const L=(step:string,d:any={})=>console.log(JSON.stringify({fn:'comprovante-pix-worker',v:VERSION,step,...d}));
const brl=(v:number)=>`R$${Number(v||0).toFixed(2).replace('.',',')}`;
const round2=(v:any)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

function callerAuthorized(req:Request){return (req.headers.get('authorization')||'')===`Bearer ${SUPABASE_SERVICE_KEY}`}
async function notificarAdmin(msg:string){try{await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,{method:'POST',headers:{'content-type':'application/json','Client-Token':ZAPI_CLIENT_TOKEN},body:JSON.stringify({phone:PHONE_ADMIN,message:msg}),signal:AbortSignal.timeout(12000)})}catch{}}
async function callInternal(slug:string,body:any){try{await fetch(`${SUPABASE_URL}/functions/v1/${slug}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)})}catch{}}
async function callInternalResult(slug:string,body:any,ms=40000){try{const r=await fetch(`${SUPABASE_URL}/functions/v1/${slug}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${SUPABASE_SERVICE_KEY}`},body:JSON.stringify(body),signal:AbortSignal.timeout(ms)});return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)}}catch(e:any){return {ok:false,status:0,data:{error:String(e?.message||e)}}}}
async function sha256Text(v:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}

async function enfileirarJoaoPix(args:{eventKey:string;leadId:string;phone:string|null;subscriberId:string|null;orcamentoId:string;resultado:'CONFIRMADO'|'DIVERGENTE';valorPago:number;valorOrcamento:number;confianca:string;sourceEvidence:any}){
  try{
    const {data,error}=await sb.rpc('fn_cortex_pix_joao_bridge_enqueue_v1',{
      p_event_key:args.eventKey,p_lead_id:args.leadId,p_phone:args.phone,p_subscriber_id:args.subscriberId,
      p_orcamento_id:args.orcamentoId,p_resultado:args.resultado,p_valor_pago:args.valorPago,p_valor_orcamento:args.valorOrcamento,
      p_confianca:args.confianca,p_source_evidence:args.sourceEvidence??{}
    });
    if(error)return {ok:false,status:'RPC_ERROR',error:error.message};
    return data??{ok:false,status:'EMPTY_RPC_RESULT'};
  }catch(e:any){return {ok:false,status:'EXCEPTION',error:String(e?.message||e)}}
}

async function analisarArquivo(fileUrl:string,mimeType:string,isPdf:boolean):Promise<{eh_comprovante:boolean;valor:number|null;confianca:string;file_size:number;receiving_bank:string|null;recipient_name:string|null;bank_confidence:string}>{
  try{
    const res=await fetch(fileUrl,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw new Error(`download_${res.status}`);
    const buffer=await res.arrayBuffer();const uint8=new Uint8Array(buffer);const fileSize=uint8.byteLength;
    let binary='';for(let i=0;i<uint8.length;i+=8192)binary+=String.fromCharCode(...uint8.subarray(i,i+8192));const base64=btoa(binary);
    const contentBlock=isPdf?{type:'document',source:{type:'base64',media_type:'application/pdf',data:base64}}:{type:'image',source:{type:'base64',media_type:mimeType,data:base64}};
    const prompt=`Analise este arquivo e responda APENAS em JSON no formato:
{"eh_comprovante":true/false,"valor":131.13 ou null,"confianca":"alta/media/baixa","receiving_bank":"Itau/Mercado Pago/Bradesco/C6 Bank" ou null,"recipient_name":"nome do RECEBEDOR" ou null,"bank_confidence":"alta/media/baixa","motivo":"texto curto"}
Regras:
- eh_comprovante=true somente para comprovante de pagamento Pix/TED/transferencia/boleto pago.
- valor = valor efetivamente pago.
- receiving_bank = instituicao financeira da CONTA RECEBEDORA/DESTINO. NUNCA use o banco do pagador/remetente. Se o banco recebedor nao estiver explicitamente legivel, null.
- recipient_name = nome/razao social do RECEBEDOR/DESTINATARIO, nunca do pagador. Se nao estiver legivel, null.
- bank_confidence=alta somente quando a instituicao do recebedor estiver explicitamente identificada no comprovante; caso contrario media/baixa.
- confianca avalia se o arquivo e comprovante e se o valor foi lido corretamente.
Nao inclua nada alem do JSON.`;
    const apiRes=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:230,messages:[{role:'user',content:[contentBlock,{type:'text',text:prompt}]}]}),signal:AbortSignal.timeout(30000)});
    const data=await apiRes.json();const texto=data?.content?.[0]?.text?.trim()??'{}';L('claude_analise',{texto:texto.slice(0,320)});
    const parsed=JSON.parse(texto.replace(/```json|```/g,'').trim());const valor=parsed.valor?parseFloat(String(parsed.valor).replace(',','.')):null;
    return {eh_comprovante:!!parsed.eh_comprovante,valor:valor&&!isNaN(valor)?valor:null,confianca:parsed.confianca||'baixa',file_size:fileSize,receiving_bank:parsed.receiving_bank?String(parsed.receiving_bank):null,recipient_name:parsed.recipient_name?String(parsed.recipient_name):null,bank_confidence:parsed.bank_confidence||'baixa'};
  }catch(e:any){L('analise_erro',{error:String(e?.message||e)});return {eh_comprovante:false,valor:null,confianca:'baixa',file_size:0,receiving_bank:null,recipient_name:null,bank_confidence:'baixa'}}
}

async function fallbackDocumentoNaoPix(args:{leadId:string;phone:string|null;fileUrl:string;mimeType:string;nome:string|null;fileSize:number}){
  try{
    const since=new Date(Date.now()-20*60*1000).toISOString();
    const {data:rows,error}=await sb.from('fact_conversations').select('id,raw_payload,timestamp').eq('lead_id',args.leadId).eq('direction','inbound').eq('message_type','document').gte('timestamp',since).order('timestamp',{ascending:false}).limit(20);
    if(error)return {ok:false,status:'FACT_LOOKUP_ERROR',error:error.message};
    const evidence=(rows||[]).find((r:any)=>r?.raw_payload?.document?.documentUrl===args.fileUrl);
    if(!evidence)return {ok:true,status:'NOT_DOCUMENT_EVIDENCE',routed:false};
    const doc=evidence.raw_payload?.document||{};const fileName=String(doc.fileName||doc.title||'arquivo').replace(/[^a-zA-Z0-9._\-\s]/g,'_');
    const mimeType=String(doc.mimeType||args.mimeType||'application/octet-stream');const caption=String(doc.caption||'');const payloadSize=Number(doc.fileLength||doc.size||0)||0;const fileSize=args.fileSize>0?args.fileSize:payloadSize;
    const {data:recentUploads}=await sb.from('arte_uploads').select('id,file_urls_origem').eq('lead_id',args.leadId).gte('created_at',new Date(Date.now()-24*60*60*1000).toISOString()).order('created_at',{ascending:false}).limit(50);
    const duplicate=(recentUploads||[]).find((r:any)=>Array.isArray(r.file_urls_origem)&&r.file_urls_origem.includes(args.fileUrl));if(duplicate)return {ok:true,status:'DOCUMENT_ALREADY_ROUTED',routed:false,arte_upload_id:duplicate.id};
    const {data:lead}=await sb.from('leads_marketing').select('fullname,content_category').eq('lead_id',args.leadId).maybeSingle();
    const {data:ident}=await sb.from('lead_identificadores').select('deal_rdstation_id').eq('lead_id',args.leadId).maybeSingle();
    const categoria=lead?.content_category||null;const textoBusca=`${fileName} ${caption}`.toLowerCase();
    const ehPalavraBloqueada=/\b(comprovante|pix|pagamento|boleto|recibo|transfer[eê]ncia|nota fiscal|cnh|rg)\b/i.test(textoBusca);
    const tamanhoMinimo=fileSize>=100*1024;
    const mimesAceitos=new Set(['application/pdf','image/png','image/jpeg','image/jpg','image/tiff','image/vnd.adobe.photoshop','application/postscript','application/illustrator','application/cdr','application/x-cdr','application/coreldraw','application/vnd.corel-draw','image/x-eps','application/eps','image/svg+xml']);
    const mimeAceito=mimesAceitos.has(mimeType);const ehDtfCategoria=categoria==='impressao_dtf_textil'||categoria==='impressao_dtf_uv';const ehDtfNoNome=/\bdtf\b/i.test(fileName);
    let onedriveEligible=false,motivoDecisao='';
    if(ehPalavraBloqueada)motivoDecisao='1.bloqueado_palavra_chave';else if(!tamanhoMinimo)motivoDecisao='2.bloqueado_tamanho_pequeno';else if(!mimeAceito)motivoDecisao='3.bloqueado_mime_nao_arte';else{onedriveEligible=true;motivoDecisao=ehDtfCategoria?'4.aprovado_dtf_categoria':(ehDtfNoNome?'4.5.aprovado_dtf_no_nome':'5.aprovado_arte_cliente')}
    const pedidoId=ident?.deal_rdstation_id||`lead_${args.leadId}`;const descricao=caption?`${caption} | Arquivo: ${fileName}`:`Arquivo enviado via WhatsApp: ${fileName}`;
    const {data:inserted,error:insErr}=await sb.from('arte_uploads').insert({lead_id:args.leadId,pedido_id:pedidoId,phone:args.phone,nome:lead?.fullname||args.nome||'Cliente',descricao,arquivos:[],total_arquivos:0,file_urls_origem:[args.fileUrl],arquivo_mime_type:mimeType,arquivo_tamanho_bytes:fileSize,storage_sync_status:'pending',onedrive_sync_status:onedriveEligible?'pendente':'bloqueado',onedrive_eligible:onedriveEligible}).select('id').single();
    if(insErr||!inserted?.id)return {ok:false,status:'ARTE_UPLOAD_INSERT_ERROR',error:insErr?.message||'missing_id'};
    void callInternal('arte-upload-worker',{arte_upload_id:inserted.id,copias_da_legenda:null,file_name:fileName.replace(/\s+/g,'_'),mime_type:mimeType});
    return {ok:true,status:'ROUTED_TO_DOCUMENT_FLOW',routed:true,arte_upload_id:inserted.id,onedrive_eligible:onedriveEligible,motivo:motivoDecisao,fact_conversation_id:evidence.id};
  }catch(e:any){return {ok:false,status:'DOCUMENT_FALLBACK_EXCEPTION',error:String(e?.message||e)}}
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  if(!callerAuthorized(req))return new Response(JSON.stringify({ok:false,error:'unauthorized'}),{status:401,headers:{'content-type':'application/json'}});
  let body:any;try{body=await req.json()}catch{return new Response(JSON.stringify({error:'invalid json'}),{status:400,headers:{'content-type':'application/json'}})}
  const {lead_id,phone,subscriber_id,image_url,image_mime_type,nome,is_pdf}=body;
  if(!lead_id||!image_url)return new Response(JSON.stringify({error:'lead_id e image_url obrigatorios'}),{status:400,headers:{'content-type':'application/json'}});
  const mimeType=image_mime_type||'image/jpeg';const isPdf=is_pdf===true||mimeType==='application/pdf';L('start',{lead_id,phone,isPdf,mimeType});

  const {data:orc}=await sb.from('orcamentos').select('id,valor_total,deal_id,status').eq('lead_id',lead_id).in('status',['enviado','rascunho']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(!orc)return new Response(JSON.stringify({ok:true,skip:'sem_orcamento',handled:false,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});

  const analise=await analisarArquivo(image_url,mimeType,isPdf);
  const {eh_comprovante,valor:valorPagoRaw,confianca,file_size:fileSize,receiving_bank,recipient_name,bank_confidence}=analise;
  if(!eh_comprovante||valorPagoRaw===null){
    const reason=eh_comprovante?'valor_nao_encontrado':'nao_e_comprovante';
    const documentFallback=!eh_comprovante?await fallbackDocumentoNaoPix({leadId:lead_id,phone:phone??null,fileUrl:image_url,mimeType,nome:nome??null,fileSize}):{ok:true,status:'NOT_APPLICABLE_RECEIPT_WITHOUT_VALUE',routed:false};
    return new Response(JSON.stringify({ok:true,skip:reason,handled:false,confianca,document_fallback:documentFallback,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});
  }

  const valorPago=round2(valorPagoRaw);const valorOrcamento=round2(orc.valor_total);const fingerprint=await sha256Text(`${lead_id}|${orc.id}|${image_url}`);
  const eventKey=`pix-receipt:${orc.id}:${fingerprint.slice(0,40)}`;
  const {data:stateBefore,error:stateErr}=await sb.rpc('fn_joao_orcamento_payment_state_v1',{p_orcamento_id:orc.id,p_as_of:new Date().toISOString()});
  if(stateErr||!stateBefore?.ok)return new Response(JSON.stringify({ok:false,error:'payment_state_unavailable',detail:stateErr?.message||stateBefore,worker_version:VERSION}),{status:503,headers:{'content-type':'application/json'}});
  const paidBefore=round2(stateBefore.paid_total_raw);const saldoAntes=round2(stateBefore.balance);
  if(stateBefore.fully_paid===true||saldoAntes<=0)return new Response(JSON.stringify({ok:true,handled:false,skip:'pedido_ja_quitado',payment_state:stateBefore,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});

  const since24=new Date(Date.now()-24*60*60*1000).toISOString();
  const {data:providerDup}=await sb.from('mp_pix_cobrancas').select('payment_id,valor,paid_at').eq('orcamento_id',orc.id).eq('status','approved').gte('paid_at',since24).gte('valor',valorPago-0.01).lte('valor',valorPago+0.01).order('paid_at',{ascending:false}).limit(1).maybeSingle();
  if(providerDup){L('receipt_matches_provider_payment',{eventKey,payment_id:providerDup.payment_id,valorPago});return new Response(JSON.stringify({ok:true,handled:true,confirmado:true,duplicate_provider_payment:true,payment_id:providerDup.payment_id,valorPago,payment_state:stateBefore,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}})}

  const TOLERANCIA=1.00;const aplicavel=valorPago>0&&valorPago<=saldoAntes+TOLERANCIA;
  const resultado:'CONFIRMADO'|'DIVERGENTE'=aplicavel?'CONFIRMADO':'DIVERGENTE';
  const diferencaSaldo=round2(Math.abs(valorPago-saldoAntes));
  L('comparacao_saldo',{eventKey,valorPago,valorOrcamento,paidBefore,saldoAntes,aplicavel,resultado,confianca,receiving_bank,bank_confidence});

  const joaoBridge=await enfileirarJoaoPix({eventKey,leadId:lead_id,phone:phone??null,subscriberId:subscriber_id??null,orcamentoId:orc.id,resultado,valorPago,valorOrcamento,confianca,sourceEvidence:{edge_function:'comprovante-pix-worker/v7-manual-erp',mime_type:mimeType,is_pdf:isPdf,deal_id:orc.deal_id??null,worker_status_before:orc.status,file_fingerprint:fingerprint,paid_before:paidBefore,balance_before:saldoAntes,receiving_bank,recipient_name,bank_confidence}});
  L('joao_bridge',{eventKey,joaoBridge});

  if(joaoBridge?.status==='DUPLICATE'){
    let erpSync:any=null;
    if(resultado==='CONFIRMADO'&&joaoBridge?.event_id)erpSync=await callInternalResult('joao-erp-manual-settlement-sync',{event_id:joaoBridge.event_id});
    return new Response(JSON.stringify({ok:true,handled:true,duplicate:true,confirmado:resultado==='CONFIRMADO',valorPago,joao_bridge:joaoBridge,erp_sync:erpSync,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});
  }

  const persisted=['ENQUEUED','SUPPRESSED'].includes(String(joaoBridge?.status||''));
  if(resultado==='CONFIRMADO'&&!persisted){await notificarAdmin(`*Falha ao registrar comprovante Pix*\n\nCliente: ${nome||'Cliente'} (${phone})\nValor identificado: ${brl(valorPago)}\nOrçamento: ${brl(valorOrcamento)}\nSaldo antes: ${brl(saldoAntes)}\nBridge: ${joaoBridge?.status||'desconhecido'}\n\nPagamento NÃO foi aplicado automaticamente.`);return new Response(JSON.stringify({ok:false,handled:true,confirmado:false,error:'payment_evidence_not_persisted',joao_bridge:joaoBridge,worker_version:VERSION}),{status:503,headers:{'content-type':'application/json'}})}

  const nomeCliente=nome||'Cliente';
  if(resultado==='DIVERGENTE'){
    const bridgeNote=joaoBridge?.status==='ENQUEUED'?'Joao recebeu a divergencia canonica via Cortex.':`Atendimento automatico nao enfileirado: ${joaoBridge?.status||'desconhecido'}.`;
    await notificarAdmin(`*Comprovante Pix com divergência*\n\nCliente: ${nomeCliente} (${phone})\nValor no comprovante: ${brl(valorPago)}\nTotal do pedido: ${brl(valorOrcamento)}\nJá pago antes: ${brl(paidBefore)}\nSaldo esperado: ${brl(saldoAntes)}\nDiferença para o saldo: ${brl(diferencaSaldo)}\n\nVerificar manualmente. ${bridgeNote}`);
    return new Response(JSON.stringify({ok:true,handled:true,confirmado:false,valorPago,valorOrcamento,totalPagoAntes:paidBefore,saldoAntes,diferencaSaldo,confianca,joao_bridge:joaoBridge,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});
  }

  const {data:stateAfter,error:afterErr}=await sb.rpc('fn_joao_orcamento_payment_state_v1',{p_orcamento_id:orc.id,p_as_of:new Date().toISOString()});
  if(afterErr||!stateAfter?.ok)return new Response(JSON.stringify({ok:false,error:'payment_state_after_unavailable',detail:afterErr?.message||stateAfter,worker_version:VERSION}),{status:503,headers:{'content-type':'application/json'}});
  const totalPago=round2(stateAfter.paid_total_raw);const saldoDepois=round2(stateAfter.balance);const quitado=stateAfter.fully_paid===true;
  let erpSync:any=null;
  if(quitado&&joaoBridge?.event_id)erpSync=await callInternalResult('joao-erp-manual-settlement-sync',{event_id:joaoBridge.event_id});

  if(quitado){
    await sb.from('orcamentos').update({status:'pago',updated_at:new Date().toISOString()}).eq('id',orc.id);
    const {data:leadData}=await sb.from('leads_marketing').select('utm_source,utm_medium,utm_campaign_id,utm_adset_id,utm_ad_id,content_category').eq('lead_id',lead_id).maybeSingle();
    const purchaseEventId=`mp_order_${orc.id}`;const legacyId=`purchase_julia_${String(phone??'').replace(/\D/g,'')}_${orc.id}`;
    const {data:existePe}=await sb.from('pixel_events').select('id,event_id').eq('lead_id',lead_id).eq('event_name','Purchase').in('event_id',[purchaseEventId,legacyId]).limit(1).maybeSingle();
    if(!existePe){await sb.from('pixel_events').insert({lead_id,event_name:'Purchase',event_time:new Date().toISOString(),event_id:purchaseEventId,event_source:'chat',source:leadData?.utm_source??null,medium:leadData?.utm_medium??null,campaign_id:leadData?.utm_campaign_id??null,adset_id:leadData?.utm_adset_id??null,ad_id:leadData?.utm_ad_id??null,content_category:leadData?.content_category??'impressao_dtf_textil',value:valorOrcamento,currency:'BRL'});void callInternal('capi-routed',{lead_id,event_name:'Purchase',value:valorOrcamento,event_id:purchaseEventId})}
    await sb.from('agente_exploracao_estado').update({status:'bloqueada_purchase',updated_at:new Date().toISOString()}).eq('lead_id',lead_id);
    const erpMsg=erpSync?.ok?'ERP sincronizado.':`ERP: ${erpSync?.data?.code||erpSync?.data?.status||erpSync?.status||'pendente/hold'}.`;
    await notificarAdmin(`*Pagamento Pix confirmado — pedido quitado*\n\nCliente: ${nomeCliente}\nTelefone: ${phone}\nParcela confirmada: ${brl(valorPago)}\nTotal pago: ${brl(totalPago)}\nPedido: ${brl(valorOrcamento)}\nSaldo: ${brl(0)}\nBanco recebedor: ${receiving_bank||'não identificado'}\n${orc.deal_id?`Deal RD: ${orc.deal_id}`:''}\n\n${erpMsg} Produção depende da aprovação do layout.`);
  }else{
    await notificarAdmin(`*Pagamento Pix parcial confirmado*\n\nCliente: ${nomeCliente}\nTelefone: ${phone}\nParcela confirmada: ${brl(valorPago)}\nTotal pago: ${brl(totalPago)}\nPedido: ${brl(valorOrcamento)}\nSaldo restante: ${brl(saldoDepois)}\n${orc.deal_id?`Deal RD: ${orc.deal_id}`:''}\n\nPedido NÃO está quitado. João recebeu o resultado canônico via Cortex.`);
  }

  return new Response(JSON.stringify({ok:true,handled:true,confirmado:true,parcial:!quitado,quitado,valorPago,valorOrcamento,totalPago,saldo:saldoDepois,confianca,receiving_bank,recipient_name,bank_confidence,joao_bridge:joaoBridge,payment_state:stateAfter,erp_sync:erpSync,worker_version:VERSION}),{status:200,headers:{'content-type':'application/json'}});
});