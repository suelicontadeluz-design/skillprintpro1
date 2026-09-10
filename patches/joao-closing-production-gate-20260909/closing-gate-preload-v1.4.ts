declare const Deno: any;

// João Closing Production Gate v1.4 — 10/09/2026
// v1.4: pergunta informativa explícita sobre fornecedor no turno atual não é engolida por CLOSING antigo.
// Mantém v1.3: explicit defer/decline overrides lexical PIX/payment intent.
// Keeps v1.2 current-turn freshness and evaluator behavior.
const CL_URL=(Deno.env.get('SUPABASE_URL')??'').replace(/\/$/,'');
const CL_SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const clBaseFetch=globalThis.fetch.bind(globalThis);
const CL_VERSION='joao-closing-gate/v1.4';
let clCfgAt=0,clCfg=false;

function clUrl(input:RequestInfo|URL):string{return typeof input==='string'?input:input instanceof URL?input.href:input.url;}
async function clBody(input:RequestInfo|URL,init?:RequestInit):Promise<string>{if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text()}catch{}}return'';}
async function clEnabled():Promise<boolean>{if(Date.now()-clCfgAt<15000)return clCfg;clCfgAt=Date.now();try{const r=await clBaseFetch(`${CL_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_closing_gate_ativo&limit=1`,{headers:{apikey:CL_SERVICE,authorization:`Bearer ${CL_SERVICE}`},signal:AbortSignal.timeout(2500)});const rows=r.ok?await r.json():[];clCfg=Array.isArray(rows)&&rows[0]?.valor_bool===true}catch{clCfg=false}return clCfg;}
function clText(content:any):string{if(typeof content==='string')return content.trim();if(!Array.isArray(content))return'';return content.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim();}
function clHasToolResult(content:any):boolean{return Array.isArray(content)&&content.some((x:any)=>x?.type==='tool_result');}
function clInbound(messages:any[]):string{for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m?.role!=='user'||clHasToolResult(m?.content))continue;const t=clText(m?.content);if(!t||/^\s*\[SISTEMA:/i.test(t))continue;return t}return'';}
function clJourneyStage(system:string):string|null{return String(system||'').match(/\[CORTEX JOURNEY v1 stage=([A-Z_]+)/)?.[1]??null;}
function clLatestInboundIndex(messages:any[]):number{for(let i=messages.length-1;i>=0;i--){const m=messages[i];if(m?.role!=='user'||clHasToolResult(m?.content))continue;const t=clText(m?.content);if(!t||/^\s*\[SISTEMA:/i.test(t))continue;return i}return-1;}
function clToolResultsCurrentTurn(messages:any[]):string[]{const out:string[]=[];const inboundAt=clLatestInboundIndex(messages);if(inboundAt<0)return out;for(let i=inboundAt+1;i<messages.length;i++){const m=messages[i];if(m?.role!=='user'||!Array.isArray(m?.content))continue;for(const x of m.content){if(x?.type!=='tool_result')continue;if(typeof x?.content==='string')out.push(x.content);else if(x?.content!=null){try{out.push(JSON.stringify(x.content))}catch{}}}}return out.slice(-12);}
function clCloseIntent(text:string):boolean{return /\b(pix|cart[aã]o|pagar|pagamento|fech(?:ar|a|amos|ado)|manda(?:r)?\s+(?:o\s+)?pix|gera(?:r)?\s+(?:o\s+)?pix|link\s+de\s+pagamento|vou\s+pagar)\b/i.test(text);}
function clSupplierQuestionDetour(text:string):boolean{
  const t=String(text||'');
  const supplier=/\bforneced(?:or|ores|ora|oras)\b/i.test(t);
  const question=/\?|\b(quantos?|qual|quais|ainda|s[oó]|somente|possui|possuem|tem|t[eê]m|voc[eê]s)\b/i.test(t);
  return supplier&&question;
}
function clPaymentPaused(text:string):{paused:boolean;reason:'DEFER'|'DECLINE'|null}{
  const t=String(text||'');
  const defer=/((n[aã]o|nao)[^.!?]{0,35}(gera|gerar|mande|manda|mandar|envia|enviar)[^.!?]{0,25}(agora|ainda)|s[oó]\s+(n[aã]o|nao)\s+(gera|mande|manda|envia)|((vou|preciso)[^.!?]{0,35}(terminar|finalizar|ver|conferir|confirmar)[^.!?]{0,60}(arte|arquivo|pedido))|(vou\s+pagar|pago|pagamento)[^.!?]{0,30}(depois|mais\s+tarde)|((aguarda|aguarde|espera|espere)[^.!?]{0,35}(pix|pagamento|cobran[cç]a)))/i.test(t);
  if(defer)return{paused:true,reason:'DEFER'};
  const decline=/((n[aã]o|nao)[^.!?]{0,25}(posso|consigo|vou|tenho\s+como)[^.!?]{0,25}(pagar|pagamento))/i.test(t);
  if(decline)return{paused:true,reason:'DECLINE'};
  return{paused:false,reason:null};
}
async function clExplicitSignal(text:string):Promise<boolean>{try{const r=await clBaseFetch(`${CL_URL}/rest/v1/rpc/fn_joao_explicit_close_signal_v2`,{method:'POST',headers:{'content-type':'application/json',apikey:CL_SERVICE,authorization:`Bearer ${CL_SERVICE}`},body:JSON.stringify({p_text:text}),signal:AbortSignal.timeout(2500)});return r.ok?(await r.json())===true:false}catch{return false}}
function clParseJson(s:string):any|null{try{return JSON.parse(s)}catch{return null}}
function clPaymentObject(value:any):any|null{if(!value||typeof value!=='object')return null;if(!Array.isArray(value)){let text='';try{text=JSON.stringify(value)}catch{};if(value.ok===true&&/pix_copia_e_cola|qr_code|checkout_url|payment_id|cobranca|cobrança/i.test(text))return value}for(const v of Array.isArray(value)?value:Object.values(value)){const hit=clPaymentObject(v);if(hit)return hit}return null;}
function clMoney(v:any):number|null{if(typeof v==='number'&&Number.isFinite(v)&&v>=0)return v;if(typeof v!=='string')return null;let s=v.trim().replace(/R\$/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)&&n>=0?n:null;}
function clFirstNumber(obj:any,keys:string[]):number|null{if(!obj||typeof obj!=='object')return null;for(const k of keys){const n=clMoney(obj[k]);if(n!=null)return n}return null;}
function clFirstText(obj:any,keys:string[]):string|null{if(!obj||typeof obj!=='object')return null;for(const k of keys)if(obj[k]!=null&&String(obj[k]).trim())return String(obj[k]).trim();return null;}
async function clEvaluate(snapshot:any):Promise<any|null>{try{const r=await clBaseFetch(`${CL_URL}/rest/v1/rpc/fn_closing_evaluate_v1`,{method:'POST',headers:{'content-type':'application/json',apikey:CL_SERVICE,authorization:`Bearer ${CL_SERVICE}`},body:JSON.stringify({p_snapshot:snapshot,p_as_of:new Date().toISOString()}),signal:AbortSignal.timeout(3000)});return r.ok?await r.json():null}catch{return null}}
async function clAudit(evento:string,detalhe:any){try{await clBaseFetch(`${CL_URL}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:CL_SERVICE,authorization:`Bearer ${CL_SERVICE}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'closing-production-gate',versao:CL_VERSION,nivel:'info',categoria:'skill_runtime',evento,status:'applied',mensagem:detalhe?.closing_status??evento,detalhe:{skill_ref:'closing',authority_granted:true,authority_scope:'cognitive_close_gate',external_authority:false,...detalhe}}),signal:AbortSignal.timeout(2000)})}catch{}}
function clInject(body:any,text:string):string{return String(body.system)+`\n\n[SKILL closing/v1 — PRODUCTION GATE]\n${text}\nA skill pode bloquear avanço cognitivo, mas NÃO cria cobrança, NÃO autoriza preço/frete e NÃO altera estado externo.\n[/SKILL]`;}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=clUrl(input);if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url))return clBaseFetch(input,init);if(!(await clEnabled()))return clBaseFetch(input,init);
  const raw=await clBody(input,init);if(!raw)return clBaseFetch(input,init);let body:any;try{body=JSON.parse(raw)}catch{return clBaseFetch(input,init)};if(typeof body?.system!=='string'||!Array.isArray(body?.messages))return clBaseFetch(input,init);
  const inbound=clInbound(body.messages);if(!inbound)return clBaseFetch(input,init);const journeyStage=clJourneyStage(body.system);if(journeyStage&&journeyStage!=='CLOSING')return clBaseFetch(input,init);
  const paused=clPaymentPaused(inbound);
  const results=clToolResultsCurrentTurn(body.messages),joined=results.join('\n');
  const closeIntent=clCloseIntent(inbound);
  const paymentFailure=/\"ok\"\s*:\s*false/i.test(joined)&&/(pix|cobran[cç]a|pagamento|checkout|payment)/i.test(joined);
  const paymentSuccess=/\"ok\"\s*:\s*true/i.test(joined)&&/(pix_copia_e_cola|qr_code|checkout_url|payment_id)/i.test(joined);

  if(paused.paused){
    const msg=paused.reason==='DEFER'
      ?'CLOSING PAUSED por instrução explícita do cliente. NÃO gere, regenere ou envie Pix/cobrança neste turno. Preserve todos os dados já confirmados, reconheça a pausa e aguarde o próximo comando do cliente.'
      :'CLOSING NOT AUTHORIZED: o cliente indicou que não pode/não vai pagar neste momento. NÃO gere Pix/cobrança. Trate a objeção, alternativa de pagamento ou solicitação atual sem requalificar o pedido.';
    body.system=clInject(body,msg);
    void clAudit('closing_payment_paused_enforced',{closing_status:paused.reason==='DEFER'?'PAYMENT_DEFERRED':'PAYMENT_DECLINED',journey_stage:journeyStage??'NO_MARKER',current_turn_tool_results:results.length,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION'});
  }else if(paymentFailure){
    body.system=clInject(body,'CLOSING BLOCKED: a ferramenta de cobrança falhou ou recusou a operação NESTE TURNO. É PROIBIDO afirmar que o Pix/link foi gerado ou que o pedido foi fechado. Use o erro/ação do tool_result atual para corrigir AGORA; nunca encerre em promessa futura.');
    void clAudit('closing_payment_failure_enforced',{closing_status:'BLOCKED_BY_CURRENT_TURN_TOOL_RESULT',journey_stage:journeyStage??'NO_MARKER',current_turn_tool_results:results.length,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION'});
  }else if(paymentSuccess){
    let pobj:any|null=null;for(let i=results.length-1;i>=0&&!pobj;i--)pobj=clPaymentObject(clParseJson(results[i]));
    const explicit=await clExplicitSignal(inbound),amount=clFirstNumber(pobj,['canonical_charge_amount_brl','transaction_amount','amount_brl','valor_total','total_cobranca','amount','valor']);
    const paymentId=clFirstText(pobj,['canonical_payment_id','payment_id','id']),operationId=clFirstText(pobj,['canonical_operation_id','operation_id']),chargedShipping=clFirstText(pobj,['charged_shipping_service','shipping_service','frete_servico','servico_frete']);
    let evalResult:any|null=null;if(amount!=null)evalResult=await clEvaluate({payment_tool_invoked:true,explicit_customer_signal:explicit,customer_signal_text:inbound,customer_signal_at:new Date().toISOString(),canonical_charge_amount_brl:amount,accepted_proposal_total_brl:null,customer_shipping_signal:null,charged_shipping_service:chargedShipping,canonical_payment_id:paymentId,canonical_operation_id:operationId});
    const status=String(evalResult?.status??'CANONICAL_TOOL_RESULT_CONFIRMED');
    if(['BLOCK_PREMATURE_CLOSE','BLOCK_CLOSE_TERMS_MISMATCH','HOLD_NO_CANONICAL_CHARGE'].includes(status)){
      body.system=clInject(body,`CLOSING BLOCKED pelo evaluator certificado: ${status}. Não confirme fechamento, não envie dado inventado e resolva apenas a condição material indicada antes de avançar.`);
      void clAudit('closing_evaluator_block_enforced',{closing_status:status,journey_stage:journeyStage??'NO_MARKER',current_turn_tool_results:results.length,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION'});
    }else{
      body.system=clInject(body,'CLOSING READY por tool_result canônico DO TURNO ATUAL. Envie somente o PIX/link/código EXATOS retornados pela ferramenta neste turno. Não diga “vou gerar”, não invente URL/código e não repita pergunta já resolvida.');
      void clAudit('closing_canonical_success_enforced',{closing_status:status,journey_stage:journeyStage??'NO_MARKER',current_turn_tool_results:results.length,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION',canonical_payment_id:paymentId});
    }
  }else if(closeIntent){
    body.system=clInject(body,'CLOSING INTENT explícito. Neste MESMO turno execute as ferramentas necessárias. É proibido terminar com “vou gerar/enviar o Pix” ou qualquer promessa futura. Só afirme existência de cobrança depois de tool_result canônico confirmado neste turno.');
    void clAudit('closing_intent_execution_required',{closing_status:'INTENT_DETECTED',journey_stage:journeyStage??'NO_MARKER',current_turn_tool_results:0,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION'});
  }else if(journeyStage==='CLOSING'&&clSupplierQuestionDetour(inbound)){
    void clAudit('closing_current_turn_supplier_detour',{closing_status:'CURRENT_TURN_OVERRIDES_STALE_CLOSING',journey_stage:'CLOSING',current_turn_tool_results:0,effect_class:'NONE'});
    return clBaseFetch(input,init);
  }else if(journeyStage==='CLOSING'){
    body.system=clInject(body,'CLOSING CONTINUATION. O contexto recente já está em fechamento/pagamento. Não reabra produto, quantidade ou frete sem mudança explícita do cliente. Continue a etapa pendente e só confirme cobrança após tool_result canônico do turno atual.');
    void clAudit('closing_continuation_enforced',{closing_status:'CONTINUE_CLOSING_CONTEXT',journey_stage:'CLOSING',current_turn_tool_results:0,inbound:inbound.slice(0,240),effect_class:'HARD_RULE_INJECTION'});
  }else return clBaseFetch(input,init);

  const headers=new Headers(init?.headers??(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined));headers.delete('content-length');
  return clBaseFetch(input,{...(init??{}),headers,body:JSON.stringify(body)});
};
