// Replay-only recurring DTF order prehandler — 2026-09-13
// Purpose: prove intended flow BEFORE production changes.
// v2 adds explicit diagnostics for every precondition; no silent fallthrough on affirmative replay.

declare const Deno: any;

const RO_BASE_FETCH = globalThis.fetch.bind(globalThis);
const RO_NATIVE_SERVE = Deno.serve.bind(Deno);
const RO_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const RO_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RO_VERSION = 'repeat_order_file_confirm/replay-v2-diagnostic';

function roJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json','cache-control':'no-store','x-cortex-skill':RO_VERSION}});
}
function digits(v: unknown){return String(v??'').replace(/\D/g,'');}
function money(v: unknown){const n=Number(v);return Number.isFinite(n)?`R$ ${n.toFixed(2).replace('.',',')}`:'';}
function meters(v: unknown){const n=Number(v);return Number.isFinite(n)?`${n.toFixed(1).replace('.',',')} m`:'';}
function affirmative(v: unknown){const s=String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return /^(sim\b|confirmo\b|correto\b|esta correto\b|ta correto\b|pode seguir\b|isso\b|isso mesmo\b)/.test(s);}
function firstName(v: unknown){return String(v??'').trim().split(/\s+/)[0]||'cliente';}
function greeting(){try{const h=Number(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hour12:false}).format(new Date()));if(h>=5&&h<12)return 'Bom dia';if(h>=12&&h<18)return 'Boa tarde';return 'Boa noite';}catch{return 'Olá';}}
function diag(reason:string,observed:any={}){return {ok:true,dry_run:true,replay_repeat_debug:true,matched:false,reason,observed,repeat_order_replay:{version:RO_VERSION,production_write:false,whatsapp_send:false}};}

async function getRows(path:string):Promise<any[]>{
  if(!RO_URL||!RO_SERVICE)return [];
  try{
    const r=await RO_BASE_FETCH(`${RO_URL}/rest/v1/${path}`,{headers:{apikey:RO_SERVICE,authorization:`Bearer ${RO_SERVICE}`},signal:AbortSignal.timeout(3000)});
    if(!r.ok)return [];
    const j=await r.json().catch(()=>[]);return Array.isArray(j)?j:[];
  }catch{return [];}
}

async function repeatDecision(phone:string,inbound:string):Promise<any|null>{
  if(!affirmative(inbound))return null;
  if(!/^\d{10,13}$/.test(phone))return diag('phone_invalid',{phone_length:phone.length});

  const ph=encodeURIComponent(`eq.${phone}`);
  const [stateRows,uploadRows,outRows]=await Promise.all([
    getRows(`agente_noturno_estado?select=phone,etapa,slots,updated_at&phone=${ph}&limit=1`),
    getRows(`arte_uploads?select=id,created_at,arquivos,total_arquivos,phone&phone=${ph}&order=created_at.desc&limit=1`),
    getRows(`fact_conversations?select=message_text,direction,created_at,timestamp,source&phone=${ph}&direction=eq.outbound&order=created_at.desc&limit=8`),
  ]);

  const st=stateRows[0];
  const slots=st?.slots&&typeof st.slots==='object'?st.slots:{};
  if(!st)return diag('state_missing',{state_count:stateRows.length});
  if(String(slots?.produto??'').toLowerCase()!=='dtf_textil')return diag('product_not_dtf_textil',{produto:slots?.produto??null});
  if(slots?.cliente_recorrente_erp!==true)return diag('erp_recurring_flag_missing',{value:slots?.cliente_recorrente_erp??null,slot_keys:Object.keys(slots).sort()});
  if(String(slots?.erp_ultimo_pedido_status??'').toLowerCase()!=='entregue')return diag('erp_last_order_not_delivered',{status:slots?.erp_ultimo_pedido_status??null});

  const upload=uploadRows[0];
  if(!upload)return diag('upload_missing',{upload_count:uploadRows.length});
  if(String(upload.id??'')!==String(slots?.arquivo_upload_id??''))return diag('upload_id_mismatch',{upload_id:upload.id??null,slot_upload_id:slots?.arquivo_upload_id??null});

  const file=Array.isArray(upload?.arquivos)?upload.arquivos[0]:null;
  if(!file)return diag('file_missing_in_upload',{arquivos_is_array:Array.isArray(upload?.arquivos),total_arquivos:upload?.total_arquivos??null});
  const analysis=file?.analise??{};
  const w=Number(analysis?.width_cm),h=Number(analysis?.height_cm),copies=Number(analysis?.copies??file?.quantidade??slots?.copias);
  if(!Number.isFinite(w)||!Number.isFinite(h)||!Number.isFinite(copies)||copies<=0)return diag('file_dimensions_missing',{width_cm:analysis?.width_cm??null,height_cm:analysis?.height_cm??null,copies:analysis?.copies??file?.quantidade??null,analysis_keys:Object.keys(analysis).sort()});

  const sw=Number(slots?.largura_cm),sh=Number(slots?.altura_cm);
  if(!Number.isFinite(sw)||!Number.isFinite(sh))return diag('slot_dimensions_missing',{largura_cm:slots?.largura_cm??null,altura_cm:slots?.altura_cm??null});
  if(Math.abs(sw-w)>0.02||Math.abs(sh-h)>0.02)return diag('dimension_mismatch',{file_width_cm:w,file_height_cm:h,slot_width_cm:sw,slot_height_cm:sh});

  const recentConfirm=outRows.some((r:any)=>{const t=String(r?.message_text??'');return /confirma pra gente se entendemos corretamente/i.test(t)&&/dayane lima/i.test(t);});
  if(!recentConfirm)return diag('recent_confirmation_not_found',{outbound_count:outRows.length,outbound_samples:outRows.slice(0,3).map((r:any)=>String(r?.message_text??'').slice(0,90))});

  const m=Number(slots?.metros_para_lancar_erp),unit=Number(slots?.preco_por_metro),total=Number(slots?.valor_orcamento);
  if(!Number.isFinite(m)||!Number.isFinite(unit)||!Number.isFinite(total)||m<=0||total<=0)return diag('quote_numbers_missing',{metros:slots?.metros_para_lancar_erp??null,unit:slots?.preco_por_metro??null,total:slots?.valor_orcamento??null});
  if(String(slots?.rendimento_fonte??'')!=='fn_dtf_rendimento_por_arte_v1')return diag('yield_source_invalid',{source:slots?.rendimento_fonte??null});
  if(!String(slots?.orcamento_fonte??'').startsWith('ERP:'))return diag('quote_source_invalid',{source:slots?.orcamento_fonte??null});
  if(String(slots?.proxima_acao??'')!=='gerar_e_enviar_pdf_orcamento')return diag('next_action_invalid',{action:slots?.proxima_acao??null});

  const nome=firstName(slots?.cliente_primeiro_nome||slots?.cliente_nome_erp);
  const msg=`${greeting()}, ${nome}! Tudo bem com você? Conferi o seu arquivo novo: ele ficou em ${meters(m)} de DTF têxtil. O orçamento ficou em ${money(total)}. Já vou te enviar o PDF do orçamento por aqui.`;
  return {
    ok:true,dry_run:true,tema:'dtf_metro',etapa:'orcamento_pronto_erp',fallback:false,mudou_produto:false,objecao_preco:false,lost_canonico:null,resposta:msg,
    slots:{produto:'dtf_textil',arte:String(file?.nome_original??file?.nome??slots?.arte??'arquivo_enviado'),quantidade:copies,metros:m,preco_por_metro:unit,valor_total:total,cliente_recorrente_erp:true,ultimo_pedido_status:'entregue',pdf_proxima_acao:'gerar_e_enviar'},
    tools:[
      {name:'fn_joao_pedidos_status_v1',mode:'frozen_replay_proof',result:{venda_status:'entregue'}},
      {name:'fn_dtf_rendimento_por_arte_v1',mode:'frozen_replay_proof',result:{largura_cm:w,altura_cm:h,copias:copies,metros_para_lancar_erp:m}},
      {name:'fn_joao_lancar_orcamento_produto_canonico_v2',mode:'hypothetical_write_blocked',result:{preco_por_metro:unit,valor_total:total}},
      {name:'joao-proposta-pdf-enviar',mode:'hypothetical_send_blocked',result:{would_generate_pdf:true,would_send_whatsapp:true}}
    ],
    repeat_order_replay:{version:RO_VERSION,matched:true,deterministic:true,upload_id:upload.id,production_write:false,whatsapp_send:false}
  };
}

(Deno as any).serve=(...args:any[])=>{
  const handlerIndex=typeof args[0]==='function'?0:1;const handler=args[handlerIndex];if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[handlerIndex]=async(req:Request,info:any)=>{
    if(req.method==='POST'){
      try{const b=await req.clone().json().catch(()=>null);const phone=digits(b?.phone??b?.telefone??'');const inbound=String(b?.mensagem??b?.message??'');const decision=await repeatDecision(phone,inbound);if(decision)return roJson(decision,200);}catch(e:any){return roJson(diag('prehandler_exception',{message:String(e?.message??e).slice(0,160)}),200);}
    }
    return handler(req,info);
  };
  return RO_NATIVE_SERVE(...args);
};
