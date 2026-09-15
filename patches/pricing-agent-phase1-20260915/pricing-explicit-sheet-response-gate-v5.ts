declare const Deno: any;

// PricingAgent Phase 1 response gate v5 — mixed-safe canonical composition — 15/09/2026
// ERP is the only price source. Mixed freight/payment/PDF content is preserved while conflicting
// explicit-sheet price/consolidation claims are removed deterministically.
const P5_BASE_SERVE=Deno.serve.bind(Deno);
const P5_VERSION='pricing-agent-explicit-sheet/v5';
function norm(v:unknown){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function money(v:number){return`R$ ${Number(v).toFixed(2).replace('.',',')}`}
function containsAmount(text:string,amount:number){const t=String(text??'').replace(/\s/g,''),br=Number(amount).toFixed(2).replace('.',','),dot=Number(amount).toFixed(2);return t.includes(`R$${br}`)||t.includes(`R$${dot}`)||t.includes(br)||t.includes(dot)}
function relevantCapacity(text:string,format:'a4'|'a3'){const t=norm(text),f=new RegExp(`\\ba\\s*${format==='a4'?'4':'3'}\\b`).test(t);return f&&/\b(cabe|cabem|capacidade)\b/.test(t)&&!/r\s*\$/i.test(text)&&!/\b(frete|sedex|pac|pix|pagamento)\b/.test(t)}
function mixedTail(chunk:string){const r=/\b(cep|frete|sedex|pac|j\s*&\s*t|j\s+e\s+t|transportadora|entrega|envio|retirada|retirar|pix|pagamento|pagar|chave\s+pix|link\s+de\s+pagamento|proposta|pdf|fechar|fechado)\b/i;const m=r.exec(chunk);return m&&m.index>=0?chunk.slice(m.index).trim():''}
function sanitizeMixed(base:string,order:{format:'a4'|'a3';count:number},total:number){const chunks=String(base??'').split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean);const kept:string[]=[];let hasCanonical=false;for(const c of chunks){const n=norm(c),hasSheet=/\bfolhas?\b/.test(n)||/\bdtf\s*uv\b/.test(n)||/\badesivos?\b/.test(n);const hasFmt=new RegExp(`\\ba\\s*${order.format==='a4'?'4':'3'}\\b`).test(n);const hasMoney=/r\s*\$/i.test(c);const canonical=hasSheet&&hasFmt&&containsAmount(c,total);if(canonical){kept.push(c);hasCanonical=true;continue}const wrongConsolidation=order.format==='a4'&&order.count>1&&(/cab(?:e|em).*\bfolha\s+a\s*3\b/.test(n)||/\b0[,.]5\s*m\b.*\ba\s*3\b/.test(n));const wrongProductPrice=hasMoney&&hasSheet&&(hasFmt||/\ba\s*[34]\b/.test(n))&&!containsAmount(c,total);if(wrongConsolidation||wrongProductPrice){const tail=mixedTail(c);if(tail&&!/r\s*\$\s*(?:39|29)[,.]?(?:00|90)?/i.test(tail))kept.push(tail);continue}kept.push(c)}return{rest:kept.join(' '),hasCanonical}}

(Deno as any).serve=(...args:any[])=>{
  const hi=typeof args[0]==='function'?0:1,handler=args[hi];if(typeof handler!=='function')throw new TypeError('Deno.serve handler missing');
  args[hi]=async(req:Request,info:any)=>{
    const res=await handler(req,info);if(!res.ok)return res;
    const getCtx=(globalThis as any).__joaoPricingCurrentTurnV1,quoteFn=(globalThis as any).__joaoPricingCanonicalQuoteV1;const ctx=typeof getCtx==='function'?getCtx():null;
    if(!ctx?.order||ctx?.explicit_uv!==true||typeof quoteFn!=='function')return res;
    let raw='';try{raw=await res.clone().text()}catch{return res}if(!raw.trim().startsWith('{'))return res;let payload:any;try{payload=JSON.parse(raw.trim())}catch{return res}if(!payload||typeof payload!=='object')return res;
    const q=await quoteFn(ctx.order);const headers=new Headers(res.headers);headers.delete('content-length');headers.set('content-type','application/json; charset=utf-8');headers.set('x-cortex-pricing-agent',P5_VERSION);
    const meta={gate:'ERP_CANONICAL_EXPLICIT_SHEET_QUOTE',current_turn:true,format:ctx.order.format,count:ctx.order.count,dry_run:ctx.dry_run===true,source:'ERP',version:P5_VERSION,mixed_sensitive:ctx.mixed===true,financial_rewrites:Array.isArray(ctx.financial_rewrites)?ctx.financial_rewrites:[]};
    if(!q||q?.canonical!==true||q?.system_of_record!=='ERP'){
      const next={...payload,respondeu:true,resposta:'Não consegui confirmar o preço canônico dessas folhas agora. Não vou informar valor até o ERP responder corretamente.',pricing_agent:{...meta,mode:'FAIL_CLOSED',canonical:false}};headers.set('x-cortex-pricing-agent-mode','fail-closed');return new Response(JSON.stringify(next),{status:res.status,statusText:res.statusText,headers});
    }
    const unit=Number(q.unit_price),total=Number(q.total_price),fmt=String(ctx.order.format).toUpperCase();if(!(unit>0)||!(total>0))return res;
    const line=ctx.order.count===1?`1 folha ${fmt}: ${money(total)}.`:`${ctx.order.count} folhas ${fmt}: ${money(total)} (${money(unit)} cada).`;
    const base=String(payload?.resposta??'').trim();let finalText=line,composition='REPLACED_BASE';
    if(ctx.mixed===true){const s=sanitizeMixed(base,ctx.order,total);finalText=s.hasCanonical?s.rest:[line,s.rest].filter(Boolean).join('\n\n');composition=s.hasCanonical?'MIXED_BASE_CANONICAL':'MIXED_CANONICAL_PRICE_PLUS_PRESERVED_FLOW';}
    else if(base&&relevantCapacity(base,ctx.order.format)){finalText=`${base}\n\n${line}`;composition='CAPACITY_PLUS_CANONICAL_PRICE'}
    else if(base&&containsAmount(base,total)){finalText=base;composition='BASE_ALREADY_CANONICAL_TOTAL'}
    const next={...payload,respondeu:true,resposta:finalText,pricing_agent:{...meta,mode:ctx.mixed===true?'ENFORCE_MIXED_CANONICAL_PRICE':'ENFORCE_EXPLICIT_SHEET',canonical:true,unit_price:unit,total_price:total,pricing_source:q.pricing_source??'produtos.metadata.dtf_uv_pricing_v1',system_of_record:'ERP',composition}};
    headers.set('x-cortex-pricing-agent-mode',ctx.mixed===true?'enforce-mixed':'enforce-explicit-sheet');
    console.log(JSON.stringify({event:'PRICING_AGENT_RESPONSE_ENFORCED',version:P5_VERSION,mixed:ctx.mixed===true,format:ctx.order.format,count:ctx.order.count,total_price:total,composition,financial_rewrites:meta.financial_rewrites.length,dry_run:ctx.dry_run===true}));
    return new Response(JSON.stringify(next),{status:res.status,statusText:res.statusText,headers});
  };
  return P5_BASE_SERVE(...args as any);
};
