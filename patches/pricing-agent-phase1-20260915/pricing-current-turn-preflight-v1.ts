import { AsyncLocalStorage } from 'node:async_hooks';
declare const Deno: any;

// PricingAgent current-turn context + ERP preflight enrichment v1 — 15/09/2026
// Captures explicit DTF UV sheet intent from the active request.
// Enriches read-only ERP pricing preflight calls so legacy João validation sees the same sheet contract.
const PCP_BASE_SERVE=Deno.serve.bind(Deno);
const PCP_BASE_FETCH=globalThis.fetch.bind(globalThis);
const PCP_ERP_URL=(Deno.env.get('ERP_URL')??'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/,'');
const PCP_ERP_KEY=Deno.env.get('ERP_SERVICE_KEY')??Deno.env.get('ERP_SERVICE_ROLE_KEY')??'';
const PCP_VERSION='pricing-current-turn-preflight/v1';

type Order={format:'a4'|'a3';count:number};
type Ctx={incoming:string;order:Order|null;explicit_uv:boolean;mixed:boolean;dry_run:boolean;financial_rewrites:any[]};
const pcpAls=new AsyncLocalStorage<Ctx>();

function norm(v:unknown){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function countWord(v:string):number|null{const m:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};if(/^\d{1,3}$/.test(v))return Number(v);return m[v]??null}
function parseSheet(text:string):Order|null{const t=norm(text),hits:Order[]=[];const re=/(?:^|\b)(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:x\s*)?(?:folhas?|fls?\.?)[\s:-]*a\s*([34])\b/g;for(const m of t.matchAll(re)){const c=countWord(m[1]);if(c&&c>=1&&c<=100)hits.push({format:m[2]==='4'?'a4':'a3',count:c})}const compact=/(?:^|\b)(\d{1,3})\s*x\s*a\s*([34])\b/g;for(const m of t.matchAll(compact)){const c=Number(m[1]);if(c>=1&&c<=100)hits.push({format:m[2]==='4'?'a4':'a3',count:c})}if(!hits.length)return null;const fs=[...new Set(hits.map(x=>x.format))];if(fs.length!==1)return null;const count=hits.filter(x=>x.format===fs[0]).reduce((s,x)=>s+x.count,0);return count>=1&&count<=100?{format:fs[0] as 'a4'|'a3',count}:null}
function explicitUv(t:string){return/\b(adesivo|adesivos|dtf\s*uv|uv)\b/.test(norm(t))}
function mixed(t:string){const n=norm(t);return/\b(cep|frete|sedex|pac|transportadora|entrega|envio|retirada|retirar|pix|pagamento|pagar|cartao|boleto|proposta|pdf|fechar|fechado)\b/.test(n)||/link\s+de\s+pagamento|chave\s+pix/.test(n)}
async function jsonBody(input:RequestInfo|URL,init?:RequestInit){let s='';if(typeof init?.body==='string')s=init.body;else if(init?.body!=null)s=String(init.body);else if(typeof Request!=='undefined'&&input instanceof Request){try{s=await input.clone().text()}catch{}}try{return s?JSON.parse(s):{}}catch{return{}}}
function urlOf(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url}

(globalThis as any).__joaoPricingCurrentTurnV1=()=>pcpAls.getStore()??null;
(globalThis as any).__joaoPricingCanonicalQuoteV1=async(order:Order)=>{if(!PCP_ERP_KEY)return null;try{const r=await PCP_BASE_FETCH(`${PCP_ERP_URL}/rest/v1/rpc/fn_cortex_pricing_explicit_sheet_quote_v1`,{method:'POST',headers:{'content-type':'application/json',apikey:PCP_ERP_KEY,authorization:`Bearer ${PCP_ERP_KEY}`},body:JSON.stringify({p_format:order.format,p_count:order.count}),signal:AbortSignal.timeout(2500)});const d=await r.json().catch(()=>null);if(!r.ok||d?.ok!==true||d?.canonical!==true||d?.system_of_record!=='ERP')return null;return d}catch{return null}};

// This sits below legacy ERP preflight. When that preflight asks ERP for DTF UV pricing,
// inject the active explicit-sheet contract so authorized amount and ERP total are identical.
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input),method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
  const ctx=pcpAls.getStore();
  if(method==='POST'&&/\/rest\/v1\/rpc\/fn_cortex_pricing_calculation_v1(?:\?|$)/i.test(url)&&ctx?.order&&ctx.explicit_uv){
    const req=await jsonBody(input,init);const p={...(req?.p_payload??{})};const tool=String(p?.source_tool??'').toLowerCase();
    if(String(p?.product_family??'').toLowerCase()==='dtf_uv'&&['calcular_rendimento_uv','calcular_dtf_uv_metro'].includes(tool)){
      const c={...(p?.components??{}),requested_sheet_format:ctx.order.format,requested_sheet_count:ctx.order.count,degrau:ctx.order.format==='a4'?'folha_a4':'folha_a3'};
      const body=JSON.stringify({...req,p_payload:{...p,components:c}});
      return PCP_BASE_FETCH(input,{...init,body});
    }
  }
  return PCP_BASE_FETCH(input,init);
};

(Deno as any).serve=(...args:any[])=>{
  const hi=typeof args[0]==='function'?0:1,handler=args[hi];if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[hi]=async(req:Request,info:any)=>{let body:any=null;try{if(req.method==='POST'&&(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))body=await req.clone().json().catch(()=>null)}catch{}
    const incoming=String(body?.mensagem??body?.message??'').trim(),order=parseSheet(incoming);const ctx:Ctx={incoming,order,explicit_uv:!!order&&explicitUv(incoming),mixed:mixed(incoming),dry_run:body?._dry_run===true,financial_rewrites:[]};
    return await pcpAls.run(ctx,()=>handler(req,info));
  };
  return PCP_BASE_SERVE(...args as any);
};

console.log(JSON.stringify({event:'PRICING_CURRENT_TURN_PREFLIGHT_LOADED',version:PCP_VERSION}));
