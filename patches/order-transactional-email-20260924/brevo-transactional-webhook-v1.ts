import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")??"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ERP="https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/order-ready-message-bridge-v1";
const V="brevo-transactional-webhook/v1";
const db=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});

async function authorized(req:Request){
  const auth=req.headers.get("authorization")??"";
  const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token) return false;
  const {data,error}=await db.rpc("fn_brevo_transactional_webhook_auth_v1",{p_token:token});
  return !error&&data===true;
}

async function bridgeToken(){
  const {data,error}=await db.rpc("fn_order_ready_erp_bridge_token_v1");
  if(error||!data) throw new Error("ERP_BRIDGE_TOKEN_MISSING");
  return String(data);
}
async function erpBridge(payload:any){
  const token=await bridgeToken();
  const r=await fetch(ERP,{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${token}`},
    body:JSON.stringify({action:"email_reconcile",args:{p_payload:payload}}),
    signal:AbortSignal.timeout(15000),
  });
  const raw=await r.text();
  let data:any=null; try{data=raw?JSON.parse(raw):null}catch{data={raw:raw.slice(0,800)}}
  if(!r.ok||data?.ok!==true) throw Object.assign(new Error(`ERP_HTTP_${r.status}`),{detail:data});
  return data?.data??data;
}

function normalizeEvent(v:unknown){
  const s=String(v??"").trim().toLowerCase();
  const map:Record<string,string>={
    hardbounce:"hard_bounce",
    softbounce:"soft_bounce",
    uniqueopened:"unique_opened",
    invalid:"invalid",
    invalid_email:"invalid",
    request:"request",
    sent:"request",
  };
  return map[s]??s;
}

async function processOne(payload:any){
  const eventType=normalizeEvent(payload?.event);
  const messageId=String(payload?.["message-id"]??payload?.messageId??"").trim()||null;
  const email=String(payload?.email??"").trim().toLowerCase()||null;
  const subject=String(payload?.subject??"").trim()||null;
  const providerEventId=payload?.id!==undefined&&payload?.id!==null?String(payload.id):null;
  const normalized={...payload,event:eventType};

  let rowId:string|null=null;
  const {data:inserted,error:insertErr}=await db
    .from("brevo_transactional_webhook_events_v1")
    .insert({
      provider_event_id:providerEventId,
      provider_message_id:messageId,
      event_type:eventType||"unknown",
      recipient_email:email,
      subject,
      payload:normalized,
      reconciliation_status:"pending",
    })
    .select("id")
    .maybeSingle();

  if(insertErr){
    if((insertErr as any)?.code!=="23505") throw insertErr;
    const {data:existing}=await db
      .from("brevo_transactional_webhook_events_v1")
      .select("id")
      .eq("provider_message_id",messageId)
      .eq("event_type",eventType||"unknown")
      .order("received_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    rowId=existing?.id??null;
  } else {
    rowId=inserted?.id??null;
  }

  let result:any;
  try{
    result=await erpBridge(normalized);
    const matched=result?.ok===true&&result?.code==="RECONCILED";
    if(rowId){
      await db.from("brevo_transactional_webhook_events_v1").update({
        reconciliation_status:matched?"reconciled":"unmatched",
        reconciliation_detail:result??{},
        reconciled_at:new Date().toISOString(),
      }).eq("id",rowId);
    }
    return {ok:true,event:eventType,message_id_present:!!messageId,reconcile_code:result?.code??null};
  }catch(e){
    if(rowId){
      await db.from("brevo_transactional_webhook_events_v1").update({
        reconciliation_status:"failed",
        reconciliation_detail:{error:e instanceof Error?e.message:String(e)},
      }).eq("id",rowId);
    }
    throw e;
  }
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,code:"METHOD_NOT_ALLOWED",version:V},405);
  if(!(await authorized(req))) return out({ok:false,code:"UNAUTHORIZED",version:V},401);

  const body=await req.json().catch(()=>null);
  if(!body) return out({ok:false,code:"INVALID_JSON",version:V},400);

  const events=Array.isArray(body)?body:[body];
  const results:any[]=[];
  for(const e of events){
    try{results.push(await processOne(e))}
    catch(err){results.push({ok:false,error:err instanceof Error?err.message:String(err)})}
  }

  const failures=results.filter(x=>x.ok!==true).length;
  return out({ok:failures===0,version:V,count:results.length,failures,results},200);
});