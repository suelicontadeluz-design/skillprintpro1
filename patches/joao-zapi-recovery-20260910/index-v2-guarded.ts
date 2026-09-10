import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: any;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ZAPI_INSTANCE_ID = Deno.env.get('ZAPI_INSTANCE_ID') ?? '';
const ZAPI_TOKEN = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT_TOKEN = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';
const VERSION = 'joao-zapi-recovery/v2-guarded';
const sb = createClient(SUPABASE_URL, SERVICE);

function json(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
function phone(v:any){return String(v??'').replace(/\D/g,'')}
function uuidOrNull(v:any){const s=String(v??'').trim();return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)?s:null}
async function auth(req:Request){
  const a=req.headers.get('authorization')||'';
  if(a===`Bearer ${SERVICE}`) return true;
  const s=req.headers.get('x-cron-secret')||'';
  if(!s) return false;
  try{const {data,error}=await sb.rpc('fn_edge_cron_auth_ok_v1',{p_token:s});return !error&&data===true}catch{return false}
}
async function deterministicUuid(key:string):Promise<string>{
  const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
  const b=d.slice(0,16); b[6]=(b[6]&0x0f)|0x50; b[8]=(b[8]&0x3f)|0x80;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
async function existing(executionId:string){
  const {data}=await sb.from('joao_envios').select('*').eq('execution_id',executionId).eq('ordinal',1).limit(1).maybeSingle();
  return data||null;
}

async function humanGuard(p:string){
  try{
    const {data,error}=await sb.rpc('fn_joao_human_takeover_output_guard_v1',{p_phone:p,p_window_minutes:480});
    if(error) return {ok:false,status:503,error:'human_takeover_guard_unavailable',detail:error.message};
    if(data?.bloquear===true) return {ok:false,status:409,error:'human_takeover_active',guard:data};
    return {ok:true,status:200,guard:data};
  }catch(e:any){return {ok:false,status:503,error:'human_takeover_guard_unavailable',detail:String(e?.message||e).slice(0,180)}}
}

async function outputGuard(p:string,message:string,leadId:string|null,decisionId:string|null){
  try{
    const {data,error}=await sb.rpc('fn_saida_guarda_registrar',{
      p_agente_slug:'agente-noturno',p_texto:message,p_phone:p,p_lead_id:leadId,
      p_turn_id:null,p_decision_id:decisionId
    });
    if(error) return {ok:false,status:503,error:'output_guard_unavailable',detail:error.message};
    if(data?.bloquear===true) return {ok:false,status:422,error:'output_guard_blocked',guard:data};
    return {ok:true,status:200,guard:data};
  }catch(e:any){return {ok:false,status:503,error:'output_guard_unavailable',detail:String(e?.message||e).slice(0,180)}}
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST') return json({ok:false,error:'method_not_allowed'},405);
  if(!(await auth(req))) return json({ok:false,error:'unauthorized'},401);
  let body:any={}; try{body=await req.json()}catch{return json({ok:false,error:'invalid_json'},400)}
  const mode=String(body?.mode||'SEND').toUpperCase();
  if(mode==='PROBE'){
    if(!(ZAPI_INSTANCE_ID&&ZAPI_TOKEN&&ZAPI_CLIENT_TOKEN)) return json({ok:false,error:'zapi_credentials_missing',version:VERSION},409);
    try{
      const r=await fetch(`https://api.z-api.io/instances/${encodeURIComponent(ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(ZAPI_TOKEN)}/status`,{headers:{'Client-Token':ZAPI_CLIENT_TOKEN},signal:AbortSignal.timeout(15000)});
      const raw=await r.text(); let data:any=null; try{data=raw?JSON.parse(raw):null}catch{}
      return json({ok:r.ok&&data?.connected===true,version:VERSION,http_status:r.status,connected:data?.connected===true,smartphone_connected:data?.smartphoneConnected===true,provider_body:data},r.ok&&data?.connected===true?200:409);
    }catch(e:any){return json({ok:false,error:'zapi_probe_failed',detail:String(e?.message||e).slice(0,180),version:VERSION},502)}
  }

  const p=phone(body?.phone);
  if(mode==='GUARD_PROBE'){
    if(!/^55\d{10,11}$/.test(p)) return json({ok:false,error:'phone_required',version:VERSION},400);
    const guard=await humanGuard(p);
    return json({ok:guard.ok,version:VERSION,effect_state:'NONE',guard},guard.ok?200:guard.status);
  }

  if(mode==='FULL_GUARD_PROBE'){
    const message=String(body?.message||'').trim();
    const leadId=uuidOrNull(body?.lead_id); const decisionId=uuidOrNull(body?.decision_id);
    if(!/^55\d{10,11}$/.test(p)||!message) return json({ok:false,error:'phone_message_required',version:VERSION,effect_state:'NONE'},400);
    const human=await humanGuard(p);
    if(!human.ok) return json({ok:false,version:VERSION,effect_state:'NONE',guard_stage:'human_takeover',error:human.error,guard:human.guard??null},human.status);
    const out=await outputGuard(p,message,leadId,decisionId);
    if(!out.ok) return json({ok:false,version:VERSION,effect_state:'NONE',guard_stage:'output_guard',error:out.error,guard:out.guard??null},out.status);
    return json({ok:true,version:VERSION,effect_state:'NONE',guard_stage:'pass',human_guard:human.guard??null,output_guard:out.guard??null},200);
  }

  const message=String(body?.message||'').trim(); const key=String(body?.idempotency_key||'').trim();
  const leadId=uuidOrNull(body?.lead_id); const decisionId=uuidOrNull(body?.decision_id);
  if(!/^55\d{10,11}$/.test(p)||!message||!key) return json({ok:false,error:'phone_message_idempotency_required'},400);
  if(!(ZAPI_INSTANCE_ID&&ZAPI_TOKEN&&ZAPI_CLIENT_TOKEN)) return json({ok:false,error:'zapi_credentials_missing'},409);
  const executionId=await deterministicUuid(`joao-zapi-recovery:${p}:${key}`);
  const prior=await existing(executionId);
  if(prior) return json({ok:['aceito_provider','callback_provider_ok'].includes(String(prior.status)),idempotent:true,retry_suppressed:true,version:VERSION,execution_id:executionId,prior});

  // Defesa em profundidade: recovery nunca pode transformar uma decisao de policy em efeito externo.
  // Repete exatamente os dois guards do transporte canonico do Joao, imediatamente antes da Z-API.
  const human=await humanGuard(p);
  if(!human.ok) return json({ok:false,version:VERSION,execution_id:executionId,effect_state:'NONE',retry_suppressed:true,policy_terminal:human.status===409,error:human.error,guard:human.guard??null},human.status);
  const out=await outputGuard(p,message,leadId,decisionId);
  if(!out.ok) return json({ok:false,version:VERSION,execution_id:executionId,effect_state:'NONE',retry_suppressed:true,policy_terminal:out.status===422,error:out.error,guard:out.guard??null},out.status);

  const {error:insErr}=await sb.from('joao_envios').insert({decision_id:decisionId,execution_id:executionId,ordinal:1,tipo:'mensagem_ditada',provider:'zapi',phone:p,status:'preparado',modalidade:'texto',provider_response:{version:VERSION,idempotency_key:key,guarded:true}});
  if(insErr){const raced=await existing(executionId);return json({ok:!!raced&&['aceito_provider','callback_provider_ok'].includes(String(raced.status)),idempotent:true,retry_suppressed:true,execution_id:executionId,prior:raced,error:raced?null:insErr.message},raced?200:409)}

  let r:Response; let raw=''; let data:any={};
  try{
    r=await fetch(`https://api.z-api.io/instances/${encodeURIComponent(ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(ZAPI_TOKEN)}/send-text`,{
      method:'POST',headers:{'content-type':'application/json','Client-Token':ZAPI_CLIENT_TOKEN},body:JSON.stringify({phone:p,message}),signal:AbortSignal.timeout(15000)
    });
    raw=await r.text(); try{data=raw?JSON.parse(raw):{}}catch{data={raw:raw.slice(0,500)}}
  }catch(e:any){
    await sb.from('joao_envios').update({status:'incerto',error_message:`zapi_exception:${String(e?.message||e).slice(0,160)}`,provider_response:{version:VERSION,idempotency_key:key,guarded:true}}).eq('execution_id',executionId).eq('ordinal',1);
    return json({ok:false,version:VERSION,execution_id:executionId,effect_state:'UNKNOWN',retry_suppressed:true,error:'zapi_outcome_unknown'},502);
  }
  const messageId=data?.messageId?String(data.messageId):null; const zaapId=data?.zaapId?String(data.zaapId):null; const providerId=messageId||zaapId||(data?.id?String(data.id):null);
  if(r.ok&&providerId){
    const now=new Date().toISOString();
    await sb.from('joao_envios').update({provider_message_id:messageId||providerId,provider_zaap_id:zaapId,http_status:r.status,status:'aceito_provider',provider_response:data,error_message:null,provider_accepted_at:now}).eq('execution_id',executionId).eq('ordinal',1);
    await sb.from('fact_conversations').insert({lead_id:leadId,phone:p,direction:'outbound',message_text:message,message_type:'text',timestamp:now,source:VERSION,raw_payload:{execution_id:executionId,message_id:messageId||providerId,zaap_id:zaapId,idempotency_key:key,decision_id:decisionId,guarded:true}});
    return json({ok:true,version:VERSION,execution_id:executionId,provider:'zapi',http_status:r.status,message_id:messageId||providerId,zaap_id:zaapId,effect_state:'CONFIRMED'});
  }
  const state=r.ok?'incerto':'rejeitado_provider';
  await sb.from('joao_envios').update({provider_message_id:messageId,provider_zaap_id:zaapId,http_status:r.status,status:state,provider_response:data,error_message:r.ok?'http_2xx_sem_id_provider':`zapi_http_${r.status}`}).eq('execution_id',executionId).eq('ordinal',1);
  return json({ok:false,version:VERSION,execution_id:executionId,provider:'zapi',http_status:r.status,provider_body:data,effect_state:r.ok?'UNKNOWN':'NONE',retry_suppressed:r.ok},r.ok?502:409);
});
