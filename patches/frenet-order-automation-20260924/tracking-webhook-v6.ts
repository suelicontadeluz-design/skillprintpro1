// frenet-tracking-webhook v6 — webhook auth header/query + ERP reconciliation ledger
// Frente: logistica-frenet-fonte-canonica
// Autentica por header proprio, persiste ledger append-only e NAO envia mensagem ao cliente.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN_NAME = Deno.env.get('FRENET_WEBHOOK_TOKEN_NAME') ?? '';
const TOKEN_VALUE = Deno.env.get('FRENET_WEBHOOK_TOKEN_VALUE') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}});
const ERP_BRIDGE_URL='https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/frenet-logistics-bridge-v1';

const L=(step:string,d:Record<string,unknown>={})=>console.log(JSON.stringify({fn:'frenet-tracking-webhook',v:6,step,...d}));
const recusar=()=>new Response(JSON.stringify({ok:false}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});
function tokenConfere(req:Request):boolean{
  if(!TOKEN_VALUE) return false;
  const u=new URL(req.url);
  const recebido=(TOKEN_NAME?req.headers.get(TOKEN_NAME):null)||u.searchParams.get('token')||'';
  if(!recebido||recebido.length!==TOKEN_VALUE.length) return false;
  let diff=0; for(let i=0;i<recebido.length;i++) diff|=recebido.charCodeAt(i)^TOKEN_VALUE.charCodeAt(i);
  return diff===0;
}
async function marcador(v:string):Promise<string>{
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf).slice(0,6)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async(req:Request)=>{
  if(!tokenConfere(req)){ L('recusado',{motivo:'auth',metodo:req.method}); return recusar(); }
  if(req.method!=='POST') return new Response(JSON.stringify({ok:false}),{status:405,headers:{'content-type':'application/json','allow':'POST'}});
  let body:unknown;
  try{ body=await req.json(); }catch{ L('recusado',{motivo:'json_invalido'}); return new Response(JSON.stringify({ok:false}),{status:400,headers:{'content-type':'application/json'}}); }
  if(!body||Array.isArray(body)||typeof body!=='object') return new Response(JSON.stringify({ok:false}),{status:400,headers:{'content-type':'application/json'}});
  const b=body as Record<string,unknown>;
  const orderId=typeof b.OrderId==='string'?b.OrderId:null;
  const {data,error}=await sb.rpc('fn_frenet_tracking_registrar',{p_payload:b});
  if(error||!data?.ok){ L('persistencia_falhou',{codigo:error?.code??null}); return new Response(JSON.stringify({ok:false}),{status:500,headers:{'content-type':'application/json'}}); }
  L('persistido',{id:data.id,idempotente:data.idempotente===true,event_type:b.EventType??null,tracking_number:typeof b.TrackingNumber==='string'?b.TrackingNumber:null,shipment_id:typeof b.ShipmentId==='string'?b.ShipmentId:null,order_id_presente:!!orderId,order_id_marcador:orderId?await marcador(orderId):null});

  let erpSync='skipped';
  try{
    const {data:bridgeToken,error:bridgeTokenError}=await sb.rpc('fn_order_ready_erp_bridge_token_v1');
    if(bridgeTokenError||!bridgeToken) throw new Error('bridge_token_missing');
    const erp=await fetch(ERP_BRIDGE_URL,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${String(bridgeToken)}`},
      body:JSON.stringify({action:'tracking',args:{p_payload:b}}),
      signal:AbortSignal.timeout(8000),
    });
    const erpBody=await erp.json().catch(()=>null);
    if(!erp.ok||erpBody?.ok!==true) throw new Error(`erp_bridge_http_${erp.status}`);
    erpSync='ok';
    L('erp_reconciliado',{code:erpBody?.data?.code??null});
  }catch(e){
    erpSync='pending_reconcile';
    L('erp_reconciliacao_pendente',{erro:String(e).slice(0,180)});
  }

  await sb.from('frenet_tracking_eventos').update({
    reconciliacao_status:erpSync==='ok'?'reconciliado':'pendente',
    reconciliado_em:erpSync==='ok'?new Date().toISOString():null,
    reconciliacao_detalhe:{erp_sync:erpSync,bridge:'frenet-logistics-bridge-v1'},
  }).eq('id',data.id);

  // A persistencia local e a fonte de aceite do webhook. Falha transitória no ERP
  // não força retry da Frenet nem duplica o ledger; reconciliamos separadamente.
  return new Response(JSON.stringify({ok:true,idempotente:data.idempotente===true,erp_sync:erpSync}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
});