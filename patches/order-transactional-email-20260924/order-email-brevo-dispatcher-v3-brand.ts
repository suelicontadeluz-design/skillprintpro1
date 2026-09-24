import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const U=Deno.env.get("SUPABASE_URL")??"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const BREVO=Deno.env.get("BREVO_API_KEY")??"";
const ERP="https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/order-ready-message-bridge-v1";
const V="order-email-brevo-dispatcher/v3";
const db=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});

function esc(v:unknown){
  return String(v??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function first(v:unknown){const s=String(v??"").trim();return s?s.split(/\s+/)[0]:"cliente"}
function money(v:unknown){const n=Number(v??0);return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function safeUrl(v:unknown){const s=String(v??"").trim();return /^https:\/\//i.test(s)?s:""}

async function auth(req:Request){
  if((req.headers.get("authorization")??"")===`Bearer ${S}`) return true;
  const t=req.headers.get("x-cron-secret")??req.headers.get("x-cortex-internal-secret")??"";
  if(!t) return false;
  const {data,error}=await db.rpc("fn_edge_cron_auth_ok_v1",{p_token:t});
  return !error&&data===true;
}
async function bridgeToken(){
  const {data,error}=await db.rpc("fn_order_ready_erp_bridge_token_v1");
  if(error||!data) throw new Error("ERP_BRIDGE_TOKEN_MISSING");
  return String(data);
}
async function bridge(action:string,args:Record<string,unknown>={}){
  const token=await bridgeToken();
  const r=await fetch(ERP,{
    method:"POST",
    headers:{"content-type":"application/json",authorization:`Bearer ${token}`},
    body:JSON.stringify({action,args}),
    signal:AbortSignal.timeout(15000),
  });
  const raw=await r.text();
  let data:any=null; try{data=raw?JSON.parse(raw):null}catch{data={raw:raw.slice(0,800)}}
  if(!r.ok||data?.ok!==true) throw Object.assign(new Error(`ERP_BRIDGE_${action}_HTTP_${r.status}`),{detail:data});
  return data?.data??data;
}
async function sender(){
  const {data,error}=await db.from("crm_campaign_autonomy_policy")
    .select("email_sender_email,email_sender_name,email_reply_to")
    .eq("agente_slug","agente-campanhas-crm")
    .single();
  if(error||!data?.email_sender_email) throw new Error("SENDER_CONFIG_MISSING");
  return data;
}

function render(event:any){
  const p=event?.payload??{};
  const nome=first(p.customer_name);
  const numero=String(p.sale_number??"").trim();
  const eventType=String(event.event_type??"");
  let subject="";
  let title="";
  let body="";
  let action="";

  if(eventType==="message.order_ready.payment_due"){
    const saldo=money(p?.financial?.saldo_pendente??0);
    subject=`Pedido #${numero} pronto — saldo pendente`;
    title="Seu pedido ficou pronto";
    body=`Olá, ${esc(nome)}. Seu pedido está pronto, mas ainda identificamos um saldo pendente de <strong>${esc(saldo)}</strong>. Assim que o pagamento for identificado, liberamos ${p.shipping_type==="retirada"?"a retirada":"o envio"}.`;
  } else if(eventType==="message.order_ready.release"){
    subject=`Pedido #${numero} pronto`;
    title="Seu pedido está pronto";
    body=p.shipping_type==="retirada"
      ? `Olá, ${esc(nome)}. O pagamento está confirmado e o pedido <strong>#${esc(numero)}</strong> está disponível para retirada.`
      : `Olá, ${esc(nome)}. O pagamento está confirmado e o pedido <strong>#${esc(numero)}</strong> foi liberado para seguir para envio.`;
  } else if(eventType==="message.order_partial.release"){
    const lines=Array.isArray(p.lines)?p.lines:[];
    const list=lines.map((x:any)=>{
      const qty=Number(x?.quantidade??0).toLocaleString("pt-BR",{maximumFractionDigits:3});
      return `<li style="margin:6px 0">${esc(qty)} ${esc(String(x?.unidade??"unidade").replaceAll("_"," "))} — ${esc(x?.produto_nome??"Item")}</li>`;
    }).join("");
    subject=`Parte do pedido #${numero} está pronta`;
    title="Parte do seu pedido ficou pronta";
    body=`Olá, ${esc(nome)}. Liberamos uma parte do pedido <strong>#${esc(numero)}</strong>.<ul>${list}</ul>O restante continua em produção.`;
  } else if(eventType==="message.shipping_label.created"){
    const tracking=String(p.tracking_code??"").trim();
    const carrier=String(p.carrier_name??"").trim();
    const trackingUrl=safeUrl(p.tracking_url);
    subject=`Etiqueta gerada — Pedido #${numero}`;
    title="Etiqueta de envio gerada";
    body=`Olá, ${esc(nome)}. A etiqueta do pedido <strong>#${esc(numero)}</strong> foi gerada.`
      +(carrier?`<br><br>Transportadora: <strong>${esc(carrier)}</strong>`:"")
      +(tracking?`<br>Código de rastreio: <strong>${esc(tracking)}</strong>`:"")
      +`<br><br>O pedido ainda aguarda postagem. Assim que a transportadora confirmar a postagem, avisaremos novamente.`;
    if(trackingUrl) action=`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 6px"><tr><td bgcolor="#9A0525" style="border-radius:10px;border:1px solid #78041D"><a href="${esc(trackingUrl)}" style="display:inline-block;background:#9A0525;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;padding:14px 24px;border-radius:10px;letter-spacing:.1px">Acompanhar rastreio&nbsp;&nbsp;→</a></td></tr></table>`;
  } else if(eventType==="message.order_shipped.tracking"){
    const tracking=String(p.tracking_code??"").trim();
    const carrier=String(p.carrier_name??"").trim();
    const trackingUrl=safeUrl(p.tracking_url);
    subject=`Pedido #${numero} enviado`;
    title="Seu pedido foi enviado";
    body=`Olá, ${esc(nome)}. O pedido <strong>#${esc(numero)}</strong> foi postado e já está a caminho.`
      +(carrier?`<br><br>Transportadora: <strong>${esc(carrier)}</strong>`:"")
      +(tracking?`<br>Código de rastreio: <strong>${esc(tracking)}</strong>`:"");
    if(trackingUrl) action=`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 6px"><tr><td bgcolor="#9A0525" style="border-radius:10px;border:1px solid #78041D"><a href="${esc(trackingUrl)}" style="display:inline-block;background:#9A0525;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;padding:14px 24px;border-radius:10px;letter-spacing:.1px">Acompanhar entrega&nbsp;&nbsp;→</a></td></tr></table>`;
  } else {
    return null;
  }

  const html=`<!doctype html><html><body style="margin:0;padding:0;background:#f6f3f4;font-family:Arial,Helvetica,sans-serif;color:#21181b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3f4"><tr><td align="center" style="padding:34px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px"><tr><td style="padding:0 3px 12px;font-size:12px;color:#7a6b70">Atualização do seu pedido</td></tr><tr><td style="background:#ffffff;border:1px solid #eadde1;border-radius:16px;overflow:hidden"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td height="5" style="height:5px;line-height:5px;background:#9A0525;font-size:0">&nbsp;</td></tr><tr><td align="center" style="background:#ffffff;padding:24px 26px 18px"><img src="https://ynjsflvdfftcopibzxyo.supabase.co/storage/v1/object/public/logos/logo-principal.png" width="190" alt="Skillprint Estamparia" style="display:block;width:190px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none"></td></tr><tr><td style="padding:10px 28px 8px"><div style="display:inline-block;background:#FDF2F5;color:#9A0525;font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px;border:1px solid #F1D5DD">Pedido #${esc(numero)}</div><h1 style="font-size:27px;line-height:1.2;margin:17px 0 12px;color:#26171c;letter-spacing:-.35px">${title}</h1><div style="font-size:16px;line-height:1.68;color:#55484c">${body}</div>${action}</td></tr><tr><td style="padding:20px 28px 24px"><div style="height:1px;background:#f0e3e7;line-height:1px">&nbsp;</div></td></tr><tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.6;color:#7a6b70">Esta é uma atualização automática do seu pedido na Skillprint Estamparia.<br>Se precisar falar com a equipe, responda este e-mail.</td></tr></table></td></tr><tr><td style="padding:14px 4px 0;text-align:center;font-size:11px;color:#9c8e93">Skillprint Estamparia · Pedido #${esc(numero)}</td></tr></table></td></tr></table></body></html>`;

  const text=html
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<li[^>]*>/gi,"• ")
    .replace(/<\/li>/gi,"\n")
    .replace(/<[^>]+>/g,"")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#039;/g,"'");
  return {subject,html,text};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return out({ok:false,code:"METHOD_NOT_ALLOWED",version:V},405);
  if(!(await auth(req))) return out({ok:false,code:"UNAUTHORIZED",version:V},401);
  if(!BREVO) return out({ok:false,code:"BREVO_KEY_MISSING",version:V},503);

  const body=await req.json().catch(()=>({}));
  const mode=String(body?.mode??"DISPATCH").toUpperCase();

  let cfg:any;
  try{cfg=await sender()}catch(e){return out({ok:false,code:"SENDER_CONFIG_MISSING",detail:String(e),version:V},503)}

  if(mode==="PROBE"){
    const r=await fetch("https://api.brevo.com/v3/account",{headers:{"api-key":BREVO,accept:"application/json"},signal:AbortSignal.timeout(12000)});
    return out({ok:r.ok,version:V,brevo_status:r.status,sender:cfg.email_sender_email},r.ok?200:409);
  }
  if(mode!=="DISPATCH") return out({ok:false,code:"MODE_NOT_ALLOWED",version:V},400);

  const worker=`${V}:${crypto.randomUUID()}`;
  let events:any[]=[];
  try{
    const claimed=await bridge("email_claim",{p_worker:worker,p_limit:Math.max(1,Math.min(Number(body?.limit??10),20))});
    events=Array.isArray(claimed)?claimed:[];
  }catch(e){
    return out({ok:false,code:"CLAIM_FAILED",detail:String(e).slice(0,200),version:V},502);
  }

  const summary:any={claimed:events.length,sent:0,failed:0,dead:0,items:[]};

  for(const event of events){
    const to=String(event?.to_email??"").trim().toLowerCase();
    const rendered=render(event);
    if(!rendered||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){
      await bridge("email_fail",{p_event_id:event.id,p_worker:worker,p_error:"INVALID_TRANSACTIONAL_EMAIL_PAYLOAD",p_provider_response:{version:V},p_outcome_unknown:true}).catch(()=>null);
      summary.dead++; summary.items.push({id:event.id,ok:false,code:"INVALID_PAYLOAD"}); continue;
    }

    let r:Response;
    let provider:any={};
    try{
      r=await fetch("https://api.brevo.com/v3/smtp/email",{
        method:"POST",
        headers:{"api-key":BREVO,accept:"application/json","content-type":"application/json"},
        body:JSON.stringify({
          sender:{name:cfg.email_sender_name||"Skillprint Estamparia",email:cfg.email_sender_email},
          replyTo:{name:cfg.email_sender_name||"Skillprint Estamparia",email:cfg.email_reply_to||cfg.email_sender_email},
          to:[{email:to,name:String(event?.payload?.customer_name??"")}],
          subject:rendered.subject,
          htmlContent:rendered.html,
          textContent:rendered.text,
          headers:{"X-Skillprint-Event-Id":String(event.id),"X-Skillprint-Event-Type":String(event.event_type),"X-Mailin-custom":JSON.stringify({event_id:String(event.id),event_type:String(event.event_type)})},
          tags:["skillprint-transacional",String(event.event_type).replace(/[^a-z0-9_-]/gi,"-").slice(0,64)]
        }),
        signal:AbortSignal.timeout(15000),
      });
      const raw=await r.text();
      try{provider=raw?JSON.parse(raw):{}}catch{provider={raw:raw.slice(0,800)}}
    }catch(e){
      await bridge("email_fail",{p_event_id:event.id,p_worker:worker,p_error:`BREVO_OUTCOME_UNKNOWN:${e instanceof Error?e.message:String(e)}`,p_provider_response:{version:V},p_outcome_unknown:true}).catch(()=>null);
      summary.dead++; summary.items.push({id:event.id,ok:false,code:"OUTCOME_UNKNOWN"}); continue;
    }

    if(!r.ok){
      const unknown=r.status===429||r.status>=500;
      await bridge("email_fail",{p_event_id:event.id,p_worker:worker,p_error:`BREVO_HTTP_${r.status}`,p_provider_response:{version:V,http_status:r.status,provider},p_outcome_unknown:false}).catch(()=>null);
      summary.failed++; summary.items.push({id:event.id,ok:false,code:`BREVO_HTTP_${r.status}`}); continue;
    }

    const messageId=String(provider?.messageId??"").trim();
    await bridge("email_complete",{p_event_id:event.id,p_worker:worker,p_provider_message_id:messageId,p_provider_response:{version:V,http_status:r.status,provider:"brevo"}}).catch(()=>null);
    summary.sent++; summary.items.push({id:event.id,ok:true,message_id_present:!!messageId});
  }

  return out({ok:true,version:V,summary});
});