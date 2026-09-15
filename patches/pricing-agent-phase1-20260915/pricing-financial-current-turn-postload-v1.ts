declare const Deno: any;

// PricingAgent current-turn financial canonicalizer v1 — 15/09/2026
// Loaded AFTER v295 so it sits above legacy fetch wrappers.
// It only rewrites explicit DTF UV sheet product operations from the active request.
const PFC_BASE_FETCH=globalThis.fetch.bind(globalThis);
const PFC_VERSION='pricing-financial-current-turn/v1';
function urlOf(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url}
async function bodyOf(input:RequestInfo|URL,init?:RequestInit){let s='';if(typeof init?.body==='string')s=init.body;else if(init?.body!=null)s=String(init.body);else if(typeof Request!=='undefined'&&input instanceof Request){try{s=await input.clone().text()}catch{}}try{return s?JSON.parse(s):{}}catch{return{}}}
function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','x-cortex-pricing-financial':PFC_VERSION}})}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input),method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='POST'||!/\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url))return PFC_BASE_FETCH(input,init);
  const getCtx=(globalThis as any).__joaoPricingCurrentTurnV1;const quoteFn=(globalThis as any).__joaoPricingCanonicalQuoteV1;
  const ctx=typeof getCtx==='function'?getCtx():null;if(!ctx?.order||ctx?.explicit_uv!==true||typeof quoteFn!=='function')return PFC_BASE_FETCH(input,init);
  const req=await bodyOf(input,init);const tool=String(req?.p_source_tool??'').toLowerCase();
  if(String(req?.p_kind??'')!=='produto'||!['calcular_rendimento_uv','calcular_dtf_uv_metro'].includes(tool))return PFC_BASE_FETCH(input,init);
  const q=await quoteFn(ctx.order);if(!q||q?.canonical!==true||q?.system_of_record!=='ERP')return json({error:'ERP_CANONICAL_EXPLICIT_SHEET_QUOTE_REQUIRED',canonical:false},424);
  const total=Number(q.total_price),unit=Number(q.unit_price);if(!(total>0)||!(unit>0))return json({error:'ERP_CANONICAL_EXPLICIT_SHEET_TOTAL_INVALID',canonical:false},424);
  const components={...(req?.p_components??{}),requested_sheet_format:ctx.order.format,requested_sheet_count:ctx.order.count,requested_sheet_source:'current_turn',degrau:ctx.order.format==='a4'?'folha_a4':'folha_a3'};
  const next={...req,p_amount:total,p_components:components};
  try{ctx.financial_rewrites?.push({kind:'produto',source_tool:tool,from_amount:Number(req?.p_amount??0),to_amount:total,format:ctx.order.format,count:ctx.order.count,unit_price:unit,canonical:true})}catch{}
  console.log(JSON.stringify({event:'PRICING_CURRENT_TURN_FINANCIAL_REWRITE',version:PFC_VERSION,source_tool:tool,from_amount:Number(req?.p_amount??0),to_amount:total,format:ctx.order.format,count:ctx.order.count,dry_run:ctx?.dry_run===true}));
  return PFC_BASE_FETCH(input,{...init,body:JSON.stringify(next)});
};
