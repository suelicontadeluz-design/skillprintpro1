import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")??"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const ERP="https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/frenet-logistics-bridge-v1";
const VERSION="frenet-erp-reconcile/v1";
const db=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});

async function auth(req:Request){
  if((req.headers.get("authorization")??"")===`Bearer ${S}`) return true;
  const t=req.headers.get("x-cron-secret")??"";
  if(!t) return false;
  const {data,error}=await db.rpc("fn_edge_cron_auth_ok_v1",{p_token:t});
  return !error&&data===true;
}

async function bridgeToken(){
  const {data,error}=await db.rpc("fn_order_ready_erp_bridge_token_v1");
  if(error||!data) throw new Error("bridge_token_missing");
  return String(data);
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,code:"METHOD_NOT_ALLOWED",version:VERSION},405);
  if(!(await auth(req))) return out({ok:false,code:"UNAUTHORIZED",version:VERSION},401);

  const token=await bridgeToken().catch(()=>null);
  if(!token) return out({ok:false,code:"BRIDGE_TOKEN_MISSING",version:VERSION},503);

  const {data:rows,error}=await db.from("frenet_tracking_eventos")
    .select("id,payload,evento_hash,recebido_em")
    .eq("reconciliacao_status","pendente")
    .order("recebido_em",{ascending:true})
    .limit(20);

  if(error) return out({ok:false,code:"READ_FAILED",detail:error.message,version:VERSION},500);

  let reconciled=0,unmatched=0,failed=0;
  for(const row of rows??[]){
    try{
      const r=await fetch(ERP,{
        method:"POST",
        headers:{"content-type":"application/json",authorization:`Bearer ${token}`},
        body:JSON.stringify({action:"tracking",args:{p_payload:row.payload}}),
        signal:AbortSignal.timeout(8000),
      });
      const b=await r.json().catch(()=>null);
      const code=String(b?.data?.code??b?.code??"");
      if(r.ok&&b?.ok===true&&code==="RECONCILED"){
        reconciled++;
        await db.from("frenet_tracking_eventos").update({
          reconciliacao_status:"reconciliado",
          reconciliado_em:new Date().toISOString(),
          reconciliacao_detalhe:{bridge:"frenet-logistics-bridge-v1",code},
        }).eq("id",row.id);
      }else if(r.ok&&b?.ok===true&&code==="UNMATCHED"){
        unmatched++;
        await db.from("frenet_tracking_eventos").update({
          reconciliacao_detalhe:{bridge:"frenet-logistics-bridge-v1",code,last_attempt_at:new Date().toISOString()},
        }).eq("id",row.id);
      }else{
        failed++;
        await db.from("frenet_tracking_eventos").update({
          reconciliacao_detalhe:{bridge:"frenet-logistics-bridge-v1",code,http_status:r.status,last_attempt_at:new Date().toISOString()},
        }).eq("id",row.id);
      }
    }catch(e){
      failed++;
      await db.from("frenet_tracking_eventos").update({
        reconciliacao_detalhe:{bridge:"frenet-logistics-bridge-v1",error:String(e).slice(0,200),last_attempt_at:new Date().toISOString()},
      }).eq("id",row.id);
    }
  }

  return out({ok:true,version:VERSION,read:(rows??[]).length,reconciled,unmatched,failed});
});