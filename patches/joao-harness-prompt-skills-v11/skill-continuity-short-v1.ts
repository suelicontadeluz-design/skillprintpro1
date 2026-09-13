import { AsyncLocalStorage } from 'node:async_hooks';
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/f4cde198f9a7876145abd21976e279161f9d6869/patches/joao-harness-prompt-skills-v11/skill-quote-table-v2.ts";

declare const Deno: any;

// Harness-only candidate. Production implementation must use request-local phone/inbounds/ultimaMsgJoao
// already loaded by the core, with no extra database read.
const CS_BASE_FETCH = globalThis.fetch.bind(globalThis);
const CS_NATIVE_SERVE = Deno.serve.bind(Deno);
const CS_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const CS_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CS_VERSION = 'skill_continuity_short/v1.2';
const CS_PREFIX = 'toolu_skill_continuity_short_';
type CsStore = { phone: string };
const csAls = new AsyncLocalStorage<CsStore>();

function csUrl(input: RequestInfo | URL): string { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; }
async function csBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> { if (typeof init?.body === 'string') return init.body; if (init?.body != null) return String(init.body); if (typeof Request !== 'undefined' && input instanceof Request) { try { return await input.clone().text(); } catch {} } return ''; }
function csText(content:any): string { if (typeof content === 'string') return content.trim(); if (!Array.isArray(content)) return ''; return content.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim(); }
function csToolResultContent(content:any): boolean { return Array.isArray(content) && content.some((x:any)=>x?.type==='tool_result'); }
function csInbound(messages:any[]): string { for (let i=messages.length-1;i>=0;i--) { const m=messages[i]; if (m?.role!=='user' || csToolResultContent(m?.content)) continue; const t=csText(m?.content); if (!t || /^\s*\[SISTEMA:/i.test(t)) continue; return t; } return ''; }
function csJsonAfter(text:string, marker:string, from=0): any | null { const mi=text.indexOf(marker,from); if(mi<0)return null; const start=text.indexOf('{',mi+marker.length); if(start<0)return null; let depth=0,quoted=false,escaped=false; for(let i=start;i<text.length;i++){const ch=text[i]; if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;} if(ch==='"'){quoted=true;continue;} if(ch==='{')depth++; if(ch==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{return null;}}} return null; }
function csSlots(system:string): any { const f=system.lastIndexOf('[FICHA:'); const s=f>=0?csJsonAfter(system,'slots=',f):null; return s&&typeof s==='object'?s:{}; }
function csShortInt(text:string): number | null { const c=String(text||'').trim(); if(!/^\d{1,4}$/.test(c))return null; const n=Number(c); return Number.isInteger(n)&&n>0?n:null; }
function csDimension(rows:any[]): {largura:number;altura:number}|null { for(const r of rows||[]){ const t=String(r?.message_text||''); const m=t.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:cm)?\b/i); if(!m)continue; const largura=Number(m[1].replace(',','.')),altura=Number(m[2].replace(',','.')); if(largura>0&&altura>0&&largura<=100&&altura<=200)return {largura,altura}; } return null; }
function csOwnResult(messages:any[]): {raw:string,arteAnterior:string}|null { const ids=new Set<string>(); let arteAnterior=''; for(const m of messages){ if(m?.role!=='assistant'||!Array.isArray(m?.content))continue; for(const x of m.content){ if(x?.type==='tool_use'&&String(x?.id||'').startsWith(CS_PREFIX)&&x?.name==='calcular_dtf_por_arte'){ids.add(String(x.id)); arteAnterior=String(x?.input?._arte_anterior||'');} } } if(!ids.size)return null; for(let i=messages.length-1;i>=0;i--){const m=messages[i]; if(m?.role!=='user'||!Array.isArray(m?.content))continue; for(const x of m.content){if(x?.type==='tool_result'&&ids.has(String(x?.tool_use_id||'')))return {raw:typeof x.content==='string'?x.content:JSON.stringify(x.content??{}),arteAnterior};}} return null; }
function csMoney(v:any): string { const n=Number(v); return Number.isFinite(n)?`R$${n.toFixed(2).replace('.',',')}`:''; }
function csFinal(raw:string,arteAnterior:string): any | null { let j:any; try{j=JSON.parse(raw);}catch{return null;} if(j?.ok!==true||!j?.display_data)return null; const d=j.display_data; const cop=Number(d?.copias), metros=Number(d?.metros), pm=Number(d?.preco_por_metro), total=Number(d?.valor_total); if(!Number.isFinite(cop)||!Number.isFinite(metros)||!Number.isFinite(pm)||!Number.isFinite(total))return null; const arteCalc=String(d?.arte||'').trim(); const arteBase=String(arteAnterior||'').trim(); const arte=arteBase&&arteCalc&&!arteBase.includes(arteCalc)?`${arteBase} ${arteCalc}`:(arteCalc||arteBase); let mensagem=`Arte ${arteCalc||arte}: ${cop} cópias usam ${String(metros).replace('.',',')}m a ${csMoney(pm)}/m = *${csMoney(total)}*.`; if(d?.cobrado_minimo===true&&Number(d?.copias_sem_aumentar_valor)>cop){mensagem=`Arte ${arteCalc||arte}: ${cop} cópias ficam no mínimo de ${String(d?.minimo_metros??metros).replace('.',',')}m, total *${csMoney(total)}*. Nesse mesmo valor cabem até ${Number(d.copias_sem_aumentar_valor)} cópias.`;} mensagem += ' Se for entrega, me passa o CEP; se preferir retirada, me avisa.'; return {responde:true,mensagem,tema:'dtf_metro',encaminhou_venda:false,etapa:'orcamento',slots:{produto:'dtf_textil',arte,quantidade:cop}}; }
function csAnthropicText(decision:any): Response { const text=JSON.stringify(decision); const payload={id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`,type:'message',role:'assistant',model:'cortex-skill-continuity-short',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}; return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json','x-cortex-skill':CS_VERSION}}); }
function csAnthropicTool(largura:number,altura:number,copias:number,arteAnterior:string): Response { const id=CS_PREFIX+crypto.randomUUID().replace(/-/g,'').slice(0,18); const payload={id:`msg_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`,type:'message',role:'assistant',model:'cortex-skill-continuity-short',content:[{type:'tool_use',id,name:'calcular_dtf_por_arte',input:{largura_cm:largura,altura_cm:altura,copias,_arte_anterior:arteAnterior}}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}; return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json','x-cortex-skill':CS_VERSION}}); }
async function csMetric(event:string){try{await CS_BASE_FETCH(`https://harness-metrics.invalid/skill-continuity-short?event=${encodeURIComponent(event)}&version=${encodeURIComponent(CS_VERSION)}`,{method:'GET'});}catch{}}
async function csHistory(phone:string): Promise<{inbounds:any[];question:string}|null> {
  if(!CS_URL||!CS_SERVICE||!/^\d{10,13}$/.test(phone))return null;
  const headers={apikey:CS_SERVICE,authorization:`Bearer ${CS_SERVICE}`};
  try{
    const enc=encodeURIComponent(`eq.${phone}`);
    const [ir,or]=await Promise.all([
      CS_BASE_FETCH(`${CS_URL}/rest/v1/fact_conversations?select=message_text,timestamp&phone=${enc}&direction=eq.inbound&order=timestamp.desc&limit=8`,{headers,signal:AbortSignal.timeout(2500)}),
      CS_BASE_FETCH(`${CS_URL}/rest/v1/fact_conversations?select=source,message_text,timestamp&phone=${enc}&direction=eq.outbound&source=eq.joao&order=timestamp.desc&limit=3`,{headers,signal:AbortSignal.timeout(2500)})
    ]);
    if(!ir.ok||!or.ok){await csMetric(`history_http_${ir.status}_${or.status}`);return null;}
    const ins=await ir.json().catch(()=>[]), outs=await or.json().catch(()=>[]);
    const q=Array.isArray(outs)&&outs[0]?.message_text?String(outs[0].message_text):'';
    return {inbounds:Array.isArray(ins)?ins:[],question:q};
  }catch{await csMetric('history_exception');return null;}
}

(Deno as any).serve=(...args:any[])=>{
  const handlerIndex=typeof args[0]==='function'?0:1; const handler=args[handlerIndex];
  if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[handlerIndex]=async(req:Request,info:any)=>{
    let phone='';
    try{if(req.method==='POST'){const b=await req.clone().json().catch(()=>null); phone=String(b?.phone??b?.telefone??'').replace(/\D/g,'');}}catch{}
    return csAls.run({phone},()=>handler(req,info));
  };
  return CS_NATIVE_SERVE(...args);
};

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=csUrl(input);
  if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url))return CS_BASE_FETCH(input,init);
  const raw=await csBody(input,init); if(!raw)return CS_BASE_FETCH(input,init); let body:any; try{body=JSON.parse(raw);}catch{return CS_BASE_FETCH(input,init);} if(typeof body?.system!=='string'||!Array.isArray(body?.messages))return CS_BASE_FETCH(input,init);
  const own=csOwnResult(body.messages); if(own){const d=csFinal(own.raw,own.arteAnterior); if(!d){await csMetric('tool_result_unusable');return CS_BASE_FETCH(input,init);} await csMetric('final_deterministic'); return csAnthropicText(d);}
  const inbound=csInbound(body.messages); const n=csShortInt(inbound); if(!n)return CS_BASE_FETCH(input,init); await csMetric('bare_number_seen');
  const slots=csSlots(body.system); if(String(slots?.produto||'').toLowerCase()!=='dtf_textil'||Number(slots?.quantidade)>0){await csMetric('fail_product_or_quantity');return CS_BASE_FETCH(input,init);}
  const phone=csAls.getStore()?.phone||''; if(!phone){await csMetric('fail_phone_missing');return CS_BASE_FETCH(input,init);}
  const hist=await csHistory(phone); if(!hist){await csMetric('fail_history');return CS_BASE_FETCH(input,init);}
  if(!/(medida|largura|altura)/i.test(hist.question)||!/(quant|c[oó]pias?)/i.test(hist.question)){await csMetric('fail_question_contract');return CS_BASE_FETCH(input,init);}
  const dim=csDimension(hist.inbounds); if(!dim){await csMetric(`no_recent_dimension_rows_${hist.inbounds.length}`);return CS_BASE_FETCH(input,init);}
  await csMetric('tool_request_asof'); return csAnthropicTool(dim.largura,dim.altura,n,String(slots?.arte||''));
};
