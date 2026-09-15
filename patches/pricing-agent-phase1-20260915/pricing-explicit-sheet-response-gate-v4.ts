declare const Deno: any;

// PricingAgent Phase 1 — explicit DTF UV sheet quote gate v4 — 15/09/2026
// Current-turn only. ERP is the sole pricing source. No business writes.
// Authority requires an explicit UV/adhesive signal in the same customer turn.
// Pure explicit-sheet pricing may ENFORCE. Mixed logistics/payment/PDF/closing stays OBSERVE_ONLY over v295 LKG.

const P4_BASE_SERVE=Deno.serve.bind(Deno);
const P4_BASE_FETCH=globalThis.fetch.bind(globalThis);
const P4_ERP_URL=(Deno.env.get('ERP_URL')??'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/,'');
const P4_ERP_KEY=Deno.env.get('ERP_SERVICE_KEY')??Deno.env.get('ERP_SERVICE_ROLE_KEY')??'';
const P4_VERSION='pricing-agent-explicit-sheet/v4';
type SheetOrder={format:'a4'|'a3';count:number};

function norm(v:unknown){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function countWord(v:string):number|null{const m:Record<string,number>={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};if(/^\d{1,3}$/.test(v))return Number(v);return m[v]??null}
function parseSheet(text:string):SheetOrder|null{
  const t=norm(text),hits:SheetOrder[]=[];
  const explicit=/(?:^|\b)(\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:x\s*)?(?:folhas?|fls?\.?)[\s:-]*a\s*([34])\b/g;
  for(const m of t.matchAll(explicit)){const c=countWord(m[1]);if(c&&c>=1&&c<=100)hits.push({format:m[2]==='4'?'a4':'a3',count:c})}
  const compact=/(?:^|\b)(\d{1,3})\s*x\s*a\s*([34])\b/g;
  for(const m of t.matchAll(compact)){const c=Number(m[1]);if(c>=1&&c<=100)hits.push({format:m[2]==='4'?'a4':'a3',count:c})}
  if(!hits.length)return null;const formats=[...new Set(hits.map(x=>x.format))];if(formats.length!==1)return null;
  const count=hits.filter(x=>x.format===formats[0]).reduce((s,x)=>s+x.count,0);if(count<1||count>100)return null;
  return{format:formats[0] as 'a4'|'a3',count};
}
function explicitUvSignal(incoming:string){return/\b(adesivo|adesivos|dtf\s*uv|uv)\b/.test(norm(incoming))}
function mixedSensitive(incoming:string){const t=norm(incoming);return/\b(cep|frete|sedex|pac|transportadora|entrega|envio|retirada|retirar|pix|pagamento|pagar|cartao|boleto|proposta|pdf|fechar|fechado)\b/.test(t)||/link\s+de\s+pagamento|chave\s+pix/.test(t)}
function money(v:number){return`R$ ${Number(v).toFixed(2).replace('.',',')}`}
function hasMoney(text:string){return/r\s*\$/i.test(String(text??''))}
function hasSheetWord(text:string){return/\bfolhas?\b/i.test(norm(text))}
function relevantCapacity(text:string,format:'a4'|'a3'){const t=norm(text),f=new RegExp(`\\ba\\s*${format==='a4'?'4':'3'}\\b`).test(t);return f&&/\b(cabe|cabem|capacidade)\b/.test(t)&&!hasMoney(text)&&!/\b(frete|sedex|pac|pix|pagamento)\b/.test(t)}
function containsAmount(text:string,amount:number){const t=String(text??'').replace(/\s/g,''),br=Number(amount).toFixed(2).replace('.',','),dot=Number(amount).toFixed(2);return t.includes(`R$${br}`)||t.includes(`R$${dot}`)||t.includes(br)||t.includes(dot)}
async function quote(order:SheetOrder):Promise<any|null>{if(!P4_ERP_KEY)return null;try{const r=await P4_BASE_FETCH(`${P4_ERP_URL}/rest/v1/rpc/fn_cortex_pricing_explicit_sheet_quote_v1`,{method:'POST',headers:{'content-type':'application/json',apikey:P4_ERP_KEY,authorization:`Bearer ${P4_ERP_KEY}`},body:JSON.stringify({p_format:order.format,p_count:order.count}),signal:AbortSignal.timeout(2500)});const d=await r.json().catch(()=>null);if(!r.ok||d?.ok!==true||d?.canonical!==true||d?.system_of_record!=='ERP')return null;const u=Number(d.unit_price),tot=Number(d.total_price);if(!(u>0)||!(tot>0)||Math.abs(tot-u*order.count)>.011)return null;return d}catch{return null}}

(Deno as any).serve=(...args:any[])=>{
  const hi=typeof args[0]==='function'?0:1,handler=args[hi];if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[hi]=async(req:Request,info:any)=>{
    let body:any=null;try{if(req.method==='POST'&&(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))body=await req.clone().json().catch(()=>null)}catch{}
    const res=await handler(req,info);if(!body||!res.ok)return res;
    const incoming=String(body?.mensagem??body?.message??'').trim(),order=parseSheet(incoming);if(!order||!explicitUvSignal(incoming))return res;
    let raw='';try{raw=await res.clone().text()}catch{return res}if(!raw.trim().startsWith('{'))return res;
    let payload:any;try{payload=JSON.parse(raw.trim())}catch{return res}if(!payload||typeof payload!=='object')return res;

    const q=await quote(order),mixed=mixedSensitive(incoming);
    const headers=new Headers(res.headers);headers.delete('content-length');headers.set('content-type','application/json; charset=utf-8');headers.set('x-cortex-pricing-agent',P4_VERSION);
    const meta={gate:'ERP_CANONICAL_EXPLICIT_SHEET_QUOTE',current_turn:true,format:order.format,count:order.count,dry_run:body?._dry_run===true,source:'ERP',version:P4_VERSION,mixed_sensitive:mixed};

    if(mixed){const next={...payload,pricing_agent:{...meta,mode:'OBSERVE_MIXED_V295_LKG',canonical:q?.canonical===true,unit_price:q?.unit_price??null,total_price:q?.total_price??null,pricing_source:q?.pricing_source??null,system_of_record:q?.system_of_record??'ERP'}};headers.set('x-cortex-pricing-agent-mode','observe-mixed');return new Response(JSON.stringify(next),{status:res.status,statusText:res.statusText,headers})}

    if(!q){const next={...payload,respondeu:true,resposta:'Não consegui confirmar o preço canônico dessas folhas agora. Vou manter o orçamento sem valor até o ERP responder corretamente.',pricing_agent:{...meta,mode:'FAIL_CLOSED',canonical:false}};headers.set('x-cortex-pricing-agent-mode','fail-closed');return new Response(JSON.stringify(next),{status:res.status,statusText:res.statusText,headers})}

    const unit=Number(q.unit_price),total=Number(q.total_price),fmt=order.format.toUpperCase();
    const line=order.count===1?`1 folha ${fmt}: ${money(total)}.`:`${order.count} folhas ${fmt}: ${money(total)} (${money(unit)} cada).`;
    const base=String(payload?.resposta??'').trim();let finalText=line,composition='REPLACED_BASE';
    if(base&&relevantCapacity(base,order.format)){finalText=`${base}\n\n${line}`;composition='CAPACITY_PLUS_CANONICAL_PRICE'}
    else if(base&&hasSheetWord(base)&&containsAmount(base,total)){finalText=base;composition='BASE_ALREADY_CANONICAL_TOTAL'}

    const next={...payload,respondeu:true,resposta:finalText,pricing_agent:{...meta,mode:'ENFORCE_EXPLICIT_SHEET',canonical:true,unit_price:unit,total_price:total,pricing_source:q.pricing_source??'produtos.metadata.dtf_uv_pricing_v1',system_of_record:'ERP',composition}};
    headers.set('x-cortex-pricing-agent-mode','enforce-explicit-sheet');
    console.log(JSON.stringify({event:'PRICING_AGENT_EXPLICIT_SHEET_ENFORCED',version:P4_VERSION,format:order.format,count:order.count,unit_price:unit,total_price:total,composition,dry_run:body?._dry_run===true}));
    return new Response(JSON.stringify(next),{status:res.status,statusText:res.statusText,headers});
  };
  return P4_BASE_SERVE(...args as any);
};
