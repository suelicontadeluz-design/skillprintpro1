import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")??"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const TOKEN=Deno.env.get("FRENET_TOKEN_ENVIO")??"";
const PARTNER=Deno.env.get("FRENET_PARTNER_TOKEN")??"";
const ERP="https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/frenet-logistics-bridge-v1";
const VERSION="frenet-provider-state-reconcile/v1";
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

async function bridge(action:string,args:Record<string,unknown>){
  const token=await bridgeToken();
  const r=await fetch(ERP,{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${token}`},
    body:JSON.stringify({action,args}),
    signal:AbortSignal.timeout(12000),
  });
  const data=await r.json().catch(()=>null);
  if(!r.ok||data?.ok!==true) throw new Error(`ERP_${action}_HTTP_${r.status}`);
  return data?.data??data;
}

function trackingFromUrl(v:unknown){
  const url=String(v??"").trim();
  const m=url.match(/\/([^/?#]+)(?:[?#].*)?$/);
  return m?.[1]??null;
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,code:"METHOD_NOT_ALLOWED",version:VERSION},405);
  if(!(await auth(req))) return out({ok:false,code:"UNAUTHORIZED",version:VERSION},401);
  if(!TOKEN||!PARTNER) return out({ok:false,code:"CREDENTIALS_MISSING",version:VERSION},503);

  const body=await req.json().catch(()=>({}));
  const limit=Math.max(1,Math.min(Number(body?.limit??20),50));

  let targets:any[]=[];
  try{
    const data=await bridge("targets",{p_limit:limit});
    targets=Array.isArray(data)?data:[];
  }catch(e){
    return out({ok:false,code:"TARGET_READ_FAILED",detail:String(e).slice(0,200),version:VERSION},502);
  }

  let reconciled=0,failed=0;
  const items:any[]=[];

  for(const t of targets){
    const shipmentId=String(t?.shipment_id??"").trim();
    if(!shipmentId) continue;
    try{
      const r=await fetch(`https://whitelabel.frenet.com.br/v1/orders/${encodeURIComponent(shipmentId)}`,{
        headers:{Accept:"application/json",token:TOKEN,"x-partner-token":PARTNER},
        signal:AbortSignal.timeout(12000),
      });
      const p=await r.json().catch(()=>null);
      if(!r.ok||!p) throw new Error(`FRENET_HTTP_${r.status}`);

      const trackingUrl=p?.trackingUrl??p?.TrackingUrl??null;
      const tracking=p?.trackingNumber??p?.TrackingNumber??trackingFromUrl(trackingUrl);
      const result=await bridge("tracking",{p_payload:{
        OrderId:p?.orderId??p?.OrderId??t?.order_id??null,
        ShipmentId:p?.shipmentId??p?.ShipmentId??shipmentId,
        ShipmentStatus:p?.shipmentStatus??p?.ShipmentStatus??null,
        TrackingNumber:tracking,
        TrackingUrl:trackingUrl,
        LabelUrl:p?.labelUrl??p?.LabelUrl??null,
        EventType:p?.shipmentStatus??p?.ShipmentStatus??null,
        EventDescription:"Reconciliação periódica de estado Frenet",
      }});
      reconciled++;
      items.push({shipment_id:shipmentId,ok:true,status:p?.shipmentStatus??p?.ShipmentStatus??null,code:result?.code??null});
    }catch(e){
      failed++;
      items.push({shipment_id:shipmentId,ok:false,error:String(e).slice(0,160)});
    }
  }

  return out({ok:true,version:VERSION,targets:targets.length,reconciled,failed,items});
});