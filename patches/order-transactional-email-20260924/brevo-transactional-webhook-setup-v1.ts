import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")??"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const BREVO=Deno.env.get("BREVO_API_KEY")??"";
const BASE="https://api.brevo.com/v3";
const CALLBACK="https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/brevo-transactional-webhook-v1";
const DESC="Skillprint ERP transactional email status v1";
const V="brevo-transactional-webhook-setup/v1";
const db=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});

async function internal(req:Request){
  if((req.headers.get("authorization")??"")===`Bearer ${S}`) return true;
  const t=req.headers.get("x-cron-secret")??req.headers.get("x-cortex-internal-secret")??"";
  if(!t) return false;
  const {data,error}=await db.rpc("fn_edge_cron_auth_ok_v1",{p_token:t});
  return !error&&data===true;
}
async function token(){
  const {data,error}=await db.rpc("fn_brevo_transactional_webhook_token_v1");
  if(error||!data) throw new Error("WEBHOOK_TOKEN_MISSING");
  return String(data);
}
async function br(path:string,method="GET",body?:any){
  const r=await fetch(`${BASE}${path}`,{
    method,
    headers:{"api-key":BREVO,accept:"application/json","content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  });
  const raw=await r.text();
  let data:any=null; try{data=raw?JSON.parse(raw):null}catch{data={raw:raw.slice(0,1200)}}
  return {ok:r.ok,status:r.status,data};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,code:"METHOD_NOT_ALLOWED",version:V},405);
  if(!(await internal(req))) return out({ok:false,code:"UNAUTHORIZED",version:V},401);
  if(!BREVO) return out({ok:false,code:"BREVO_KEY_MISSING",version:V},503);

  const secret=await token();
  const payload={
    description:DESC,
    url:CALLBACK,
    events:["request","delivered","hardBounce","softBounce","blocked","spam","invalid","deferred","click","opened","uniqueOpened","unsubscribed"],
    type:"transactional",
    channel:"email",
    batched:false,
    auth:{type:"bearer",token:secret},
  };

  const list=await br("/webhooks");
  if(!list.ok) return out({ok:false,code:"LIST_FAILED",http_status:list.status,version:V},502);
  const rows=Array.isArray(list.data?.webhooks)?list.data.webhooks:[];
  const existing=rows.find((x:any)=>String(x?.url??"")===CALLBACK||String(x?.description??"")===DESC);

  let result:any;
  if(existing?.id){
    result=await br(`/webhooks/${existing.id}`,"PUT",payload);
    if(!result.ok) {
      await db.from("brevo_transactional_webhook_config_v1").update({
        webhook_id:Number(existing.id),
        status:"update_failed",
        provider_http_status:result.status,
        last_result:result.data??{},
        updated_at:new Date().toISOString(),
      }).eq("singleton",true);
      return out({ok:false,code:"UPDATE_FAILED",http_status:result.status,provider:result.data,existing_id:existing.id,version:V},502);
    }
    await db.from("brevo_transactional_webhook_config_v1").update({
      webhook_id:Number(existing.id),
      status:"active",
      provider_http_status:result.status,
      last_result:{code:"UPDATED"},
      updated_at:new Date().toISOString(),
    }).eq("singleton",true);
    return out({ok:true,code:"UPDATED",webhook_id:existing.id,http_status:result.status,version:V});
  }

  result=await br("/webhooks","POST",payload);
  if(!result.ok) {
    await db.from("brevo_transactional_webhook_config_v1").update({
      status:"create_failed",
      provider_http_status:result.status,
      last_result:result.data??{},
      updated_at:new Date().toISOString(),
    }).eq("singleton",true);
    return out({ok:false,code:"CREATE_FAILED",http_status:result.status,provider:result.data,version:V},502);
  }
  await db.from("brevo_transactional_webhook_config_v1").update({
    webhook_id:Number(result.data?.id??0)||null,
    status:"active",
    provider_http_status:result.status,
    last_result:{code:"CREATED"},
    updated_at:new Date().toISOString(),
  }).eq("singleton",true);
  return out({ok:true,code:"CREATED",webhook_id:result.data?.id??null,http_status:result.status,version:V});
});