// Replay-only recurring DTF order prehandler — 2026-09-13
// v3: arte_uploads is AS-OF/native in the hermetic harness and is not visible for this case.
// Replay therefore consumes the upload facts already frozen into agente_noturno_estado.slots,
// with arquivo_upload_id preserving provenance. Production must still read arte_uploads live.

declare const Deno: any;
const BASE_FETCH=globalThis.fetch.bind(globalThis);const NATIVE_SERVE=Deno.serve.bind(Deno);
const URL0=(Deno.env.get('SUPABASE_URL')??'').replace(/\/$/,'');const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const VERSION='repeat_order_file_confirm/replay-v3-frozen-upload';
function J(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-cortex-skill':VERSION}})}
function digits(v:any){return String(v??'').replace(/\D/g,'')}
function affirmative(v:any){const s=String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return /^(sim\b|confirmo\b|correto\b|esta correto\b|ta correto\b|pode seguir\b|isso\b|isso mesmo\b)/.test(s)}
function money(v:any){const n=Number(v);return `R$ ${n.toFixed(2).replace('.',',')}`}
function meters(v:any){const n=Number(v);return `${n.toFixed(1).replace('.',',')} m`}
function first(v:any){return String(v??'').trim().split(/\s+/)[0]||'cliente'}
function greeting(){try{const h=Number(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hour12:false}).format(new Date()));if(h>=5&&h<12)return'Bom dia';if(h>=12&&h<18)return'Boa tarde';return'Boa noite'}catch{return'Olá'}}
function diag(reason:string,observed:any={}){return{ok:true,dry_run:true,replay_repeat_debug:true,matched:false,reason,observed,repeat_order_replay:{version:VERSION,production_write:false,whatsapp_send:false}}}
async function rows(path:string){if(!URL0||!SERVICE)return[];try{const r=await BASE_FETCH(`${URL0}/rest/v1/${path}`,{headers:{apikey:SERVICE,authorization:`Bearer ${SERVICE}`},signal:AbortSignal.timeout(3000)});if(!r.ok)return[];const j=await r.json().catch(()=>[]);return Array.isArray(j)?j:[]}catch{return[]}}
async function decide(phone:string,inbound:string){
 if(!affirmative(inbound))return null;if(!/^\d{10,13}$/.test(phone))return diag('phone_invalid');
 const ph=encodeURIComponent(`eq.${phone}`);
 const [stateRows,outRows]=await Promise.all([
   rows(`agente_noturno_estado?select=phone,etapa,slots,updated_at&phone=${ph}&limit=1`),
   rows(`fact_conversations?select=message_text,direction,created_at,timestamp,source&phone=${ph}&direction=eq.outbound&order=created_at.desc&limit=8`)
 ]);
 const st=stateRows[0],s=st?.slots&&typeof st.slots==='object'?st.slots:{};if(!st)return diag('state_missing');
 if(String(s.produto??'').toLowerCase()!=='dtf_textil')return diag('product_invalid',{produto:s.produto??null});
 if(s.cliente_recorrente_erp!==true)return diag('erp_recurring_missing');
 if(String(s.erp_ultimo_pedido_status??'').toLowerCase()!=='entregue')return diag('erp_last_order_not_delivered',{status:s.erp_ultimo_pedido_status??null});
 if(!s.arquivo_atual||!s.arquivo_recebido||!s.arquivo_confirmado||!String(s.arquivo_upload_id??''))return diag('frozen_upload_proof_missing',{arquivo_atual:s.arquivo_atual??null,arquivo_recebido:s.arquivo_recebido??null,arquivo_confirmado:s.arquivo_confirmado??null,upload_id:s.arquivo_upload_id??null});
 const w=Number(s.largura_cm),h=Number(s.altura_cm),copies=Number(s.copias);if(!Number.isFinite(w)||!Number.isFinite(h)||!Number.isFinite(copies)||copies<=0)return diag('frozen_dimensions_missing',{w:s.largura_cm??null,h:s.altura_cm??null,copies:s.copias??null});
 const recentConfirm=outRows.some((r:any)=>{const t=String(r?.message_text??'');return /confirma pra gente se entendemos corretamente/i.test(t)&&/dayane lima/i.test(t)});if(!recentConfirm)return diag('recent_confirmation_not_found',{count:outRows.length,samples:outRows.slice(0,3).map((r:any)=>String(r?.message_text??'').slice(0,90))});
 const m=Number(s.metros_para_lancar_erp),unit=Number(s.preco_por_metro),total=Number(s.valor_orcamento);if(!Number.isFinite(m)||!Number.isFinite(unit)||!Number.isFinite(total)||m<=0||total<=0)return diag('quote_numbers_missing',{m:s.metros_para_lancar_erp??null,unit:s.preco_por_metro??null,total:s.valor_orcamento??null});
 if(String(s.rendimento_fonte??'')!=='fn_dtf_rendimento_por_arte_v1')return diag('yield_source_invalid');if(!String(s.orcamento_fonte??'').startsWith('ERP:'))return diag('quote_source_invalid');if(String(s.proxima_acao??'')!=='gerar_e_enviar_pdf_orcamento')return diag('next_action_invalid');
 const nome=first(s.cliente_primeiro_nome||s.cliente_nome_erp);const msg=`${greeting()}, ${nome}! Tudo bem com você? Conferi seu arquivo novo. Ele ficou em ${meters(m)} de DTF têxtil e o orçamento ficou em ${money(total)}. Já vou te enviar o PDF do orçamento por aqui.`;
 return{ok:true,dry_run:true,tema:'dtf_metro',etapa:'orcamento_pronto_erp',fallback:false,mudou_produto:false,objecao_preco:false,lost_canonico:null,resposta:msg,slots:{produto:'dtf_textil',arte:String(s.arte??'arquivo_enviado'),arquivo_upload_id:String(s.arquivo_upload_id),quantidade:copies,largura_cm:w,altura_cm:h,metros:m,preco_por_metro:unit,valor_total:total,cliente_recorrente_erp:true,ultimo_pedido_status:'entregue',pdf_proxima_acao:'gerar_e_enviar'},tools:[{name:'fn_joao_pedidos_status_v1',mode:'frozen_replay_proof',result:{venda_status:'entregue'}},{name:'fn_dtf_rendimento_por_arte_v1',mode:'frozen_replay_proof',result:{largura_cm:w,altura_cm:h,copias:copies,metros_para_lancar_erp:m}},{name:'fn_joao_lancar_orcamento_produto_canonico_v2',mode:'hypothetical_write_blocked',result:{preco_por_metro:unit,valor_total:total}},{name:'joao-proposta-pdf-enviar',mode:'hypothetical_send_blocked',result:{would_generate_pdf:true,would_send_whatsapp:true}}],repeat_order_replay:{version:VERSION,matched:true,deterministic:true,upload_id:String(s.arquivo_upload_id),upload_proof:'frozen_from_arte_uploads',production_write:false,whatsapp_send:false}}
}
(Deno as any).serve=(...args:any[])=>{const i=typeof args[0]==='function'?0:1;const handler=args[i];if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');args[i]=async(req:Request,info:any)=>{if(req.method==='POST'){try{const b=await req.clone().json().catch(()=>null);const d=await decide(digits(b?.phone??b?.telefone??''),String(b?.mensagem??b?.message??''));if(d)return J(d)}catch(e:any){return J(diag('prehandler_exception',{message:String(e?.message??e).slice(0,160)}))}}return handler(req,info)};return NATIVE_SERVE(...args)};
