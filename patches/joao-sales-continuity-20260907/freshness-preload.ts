import { AsyncLocalStorage } from "node:async_hooks";

// Joao stale-turn suppression v1 — 2026-09-07
// Organic sentinel: Max 5522998617849. At 00:48:38 a newer inbound clarified
// "uma folha de cada"; at 00:48:40 the older turn still sent its now-obsolete
// quantity question. Locks serialize work but do not invalidate an already-running turn.
// This guard establishes the exact customer inbound visible at request start and,
// immediately before customer-facing transport, suppresses the outbound if a newer
// real Z-API inbound exists. It never guesses: if the request text does not match the
// latest persisted inbound at start, the guard disables itself for that turn.

const FR_URL = Deno.env.get('SUPABASE_URL')!;
const FR_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const frBaseFetch = globalThis.fetch.bind(globalThis);
const frPreviousServe = Deno.serve.bind(Deno);
const frAls = new AsyncLocalStorage<{phone:string;baseTs:string;baseText:string}>();

function frDigits(v:unknown){return String(v??'').replace(/\D/g,'');}
function frNorm(v:unknown){return String(v??'').trim().replace(/\s+/g,' ');}
function frUrl(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url;}

async function frLatestInbound(phone:string):Promise<{timestamp:string;message_text:string}|null>{
  const d=frDigits(phone); if(d.length<10)return null; const suffix=d.slice(-8);
  try{
    const u=`${FR_URL}/rest/v1/fact_conversations?select=timestamp,message_text&phone=like.*${encodeURIComponent(suffix)}&direction=eq.inbound&source=eq.zapi&order=timestamp.desc&limit=1`;
    const r=await frBaseFetch(u,{headers:{apikey:FR_SERVICE,authorization:`Bearer ${FR_SERVICE}`}});
    if(!r.ok)return null; const rows=await r.json().catch(()=>[]);
    const x=Array.isArray(rows)?rows[0]:null;
    return x?.timestamp?{timestamp:String(x.timestamp),message_text:String(x.message_text??'')}:null;
  }catch{return null;}
}

async function frLog(phone:string,ctx:any,latest:any,text:string){
  try{
    await frBaseFetch(`${FR_URL}/rest/v1/error_log`,{method:'POST',headers:{'content-type':'application/json',apikey:FR_SERVICE,authorization:`Bearer ${FR_SERVICE}`,Prefer:'return=minimal'},body:JSON.stringify({function_name:'agente-noturno',error_message:'stale_turn_outbound_suppressed',payload:{phone_final:frDigits(phone).slice(-4),base_ts:ctx?.baseTs??null,latest_ts:latest?.timestamp??null,base_text:String(ctx?.baseText??'').slice(0,180),latest_text:String(latest?.message_text??'').slice(0,180),suppressed_text:String(text??'').slice(0,500)}})});
  }catch{}
}

function frSyntheticSuccess(){return new Response(JSON.stringify({ok:true,success:true,messageId:'stale-turn-suppressed',stale_suppressed:true}),{status:200,headers:{'content-type':'application/json'}});}

(Deno as any).serve=(...args:any[])=>{
  const idx=typeof args[0]==='function'?0:1; const handler=args[idx];
  if(typeof handler!=='function')return(frPreviousServe as any)(...args);
  args[idx]=async(req:Request,info:any)=>{
    if(req.method!=='POST')return handler(req,info);
    let body:any=null; try{body=await req.clone().json();}catch{return handler(req,info);}
    if(!body||body._sweep===true||String(body?._direct_message??'').trim())return handler(req,info);
    const phone=frDigits(body?.phone), message=frNorm(body?.mensagem);
    if(phone.length<10||!message)return handler(req,info);
    const base=await frLatestInbound(phone);
    if(!base||frNorm(base.message_text)!==message)return handler(req,info);
    return frAls.run({phone,baseTs:base.timestamp,baseText:base.message_text},()=>handler(req,info));
  };
  return(frPreviousServe as any)(...args);
};

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const ctx=frAls.getStore();
  if(!ctx)return frBaseFetch(input,init);
  const url=frUrl(input); let text=''; let customerTransport=false;
  try{
    const raw=typeof init?.body==='string'?init.body:(typeof Request!=='undefined'&&input instanceof Request?await input.clone().text():'');
    const body=raw?JSON.parse(raw):null;
    if(/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)){customerTransport=true;text=String(body?.message??'');}
    else if(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/[^/]+\/send_message\/?(?:\?|$)/i.test(url)&&String(body?.type??'').toLowerCase()==='text'){customerTransport=true;text=String(body?.value??'');}
    else if(url.includes('/functions/v1/joao-tts')){customerTransport=true;text=String(body?.texto??'');}
  }catch{}
  if(!customerTransport)return frBaseFetch(input,init);

  const latest=await frLatestInbound(ctx.phone);
  if(latest&&Date.parse(latest.timestamp)>Date.parse(ctx.baseTs)){
    await frLog(ctx.phone,ctx,latest,text);
    console.warn(JSON.stringify({event:'JOAO_STALE_TURN_SUPPRESSED',phone_final:ctx.phone.slice(-4),base_ts:ctx.baseTs,latest_ts:latest.timestamp}));
    return frSyntheticSuccess();
  }
  return frBaseFetch(input,init);
};
