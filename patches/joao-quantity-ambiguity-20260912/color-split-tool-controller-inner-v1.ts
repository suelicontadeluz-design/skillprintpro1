declare const Deno:any;

// João color-split inner controller v1 — 12/09/2026
// Deve ser importado IMEDIATAMENTE ANTES do color-split ambiguity guard.
// Os wrappers externos (guard/fallback) marcam no system que a ambiguidade foi resolvida.
// Aqui a sequência vira determinística: quantidade corrigida -> rendimento UV -> frete -> resposta.

const QTI_VERSION='joao-color-split-inner-controller/v1';
const qtiBaseFetch=globalThis.fetch.bind(globalThis);

function urlOf(input:RequestInfo|URL):string{return typeof input==='string'?input:input instanceof URL?input.href:input.url;}
async function rawBody(input:RequestInfo|URL,init?:RequestInit):Promise<string>{if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text();}catch{}}return '';}
function textOf(c:any):string{if(typeof c==='string')return c.trim();if(!Array.isArray(c))return '';return c.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim();}
function dialogue(messages:any[]):Array<{role:string,text:string}>{const out:Array<{role:string,text:string}>=[];for(const m of messages||[]){if(!m||(m.role!=='user'&&m.role!=='assistant'))continue;if(Array.isArray(m.content)&&m.content.some((x:any)=>x?.type==='tool_result'))continue;const t=textOf(m.content);if(t)out.push({role:String(m.role),text:t});}return out;}
function lastCep(d:Array<{role:string,text:string}>):string|null{for(let i=d.length-1;i>=0;i--){if(d[i].role!=='user')continue;const a=[...d[i].text.matchAll(/\b(\d{5})-?(\d{3})\b/g)];if(a.length){const m=a[a.length-1];return m[1]+m[2];}}return null;}
function measureFrom(text:string):{largura_cm:number,altura_cm:number}|null{const a=[...String(text||'').matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*x\s*(\d{1,3}(?:[.,]\d+)?)\s*cm\b/gi)];if(a.length){const m=a[a.length-1],x=Number(m[1].replace(',','.')),y=Number(m[2].replace(',','.'));if(x>0&&y>0)return{largura_cm:x,altura_cm:y};}const m=String(text||'').match(/\b(\d{1,3}(?:[.,]\d+)?)\s*cm\s+de\s+largura\s+por\s+(\d{1,3}(?:[.,]\d+)?)\s*cm\s+de\s+altura\b/i);if(m){const x=Number(m[1].replace(',','.')),y=Number(m[2].replace(',','.'));if(x>0&&y>0)return{largura_cm:x,altura_cm:y};}return null;}
function knownMeasure(d:Array<{role:string,text:string}>,system:string){for(let i=d.length-1;i>=0;i--){const m=measureFrom(d[i].text);if(m)return m;}return measureFrom(system);}
function markerTotal(system:string):number|null{let m=system.match(/\[CORTEX QUANTIDADE RESOLVIDA v1\.1\][\s\S]*?total=(\d{1,5})/i);if(!m)m=system.match(/\[CORTEX RESOLUCAO QUANTIDADE FALLBACK v1\][\s\S]*?total=(\d{1,5})/i);const n=Number(m?.[1]||0);return n>0?n:null;}
function markerDistribution(system:string):string|null{const m=system.match(/Interpretacao deterministica:\s*([^;\n]+);\s*total=/i);return m?m[1].trim():null;}
function uses(messages:any[]):Array<{id:string,name:string,index:number}>{const out:any[]=[];for(let i=0;i<(messages||[]).length;i++){const m=messages[i];if(m?.role!=='assistant'||!Array.isArray(m.content))continue;for(const b of m.content)if(b?.type==='tool_use')out.push({id:String(b.id||''),name:String(b.name||''),index:i});}return out;}
function resultRaw(messages:any[],id:string,after:number):string|null{for(let i=after+1;i<(messages||[]).length;i++){const m=messages[i];if(m?.role!=='user'||!Array.isArray(m.content))continue;for(const b of m.content){if(b?.type!=='tool_result'||String(b.tool_use_id||'')!==id)continue;const c=b.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('');try{return JSON.stringify(c);}catch{return String(c??'');}}}return null;}
function parse(raw:string|null):any{if(!raw)return null;let v:any=raw;for(let i=0;i<4;i++){if(typeof v!=='string')break;try{v=JSON.parse(v);}catch{break;}}return v;}
function failed(raw:string|null,p:any):boolean{if(!raw)return true;if(p&&typeof p==='object'&&(p.ok===false||p.erro||p.error))return true;return /"ok"\s*:\s*false|"erro"\s*:|"error"\s*:/i.test(raw);}
function toolResponse(req:any,name:string,input:any):Response{const id='toolu_'+crypto.randomUUID().replace(/-/g,'');return new Response(JSON.stringify({id:'msg_'+crypto.randomUUID().replace(/-/g,''),type:'message',role:'assistant',model:req?.model||'controller',content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json','x-cortex-color-split-inner':QTI_VERSION}});}
function productAmount(p:any):number|null{const a=Array.isArray(p?.financial_authorizations)?p.financial_authorizations.find((x:any)=>x?.kind==='produto')?.amount:null;const n=Number(a);if(Number.isFinite(n)&&n>0)return n;const cents=Number(Array.isArray(p?.precos_verbalizaveis)?p.precos_verbalizaveis.find((x:any)=>x?.tipo==='preco_total')?.centavos:0);return cents>0?cents/100:null;}
function money(n:number):string{return `R$ ${n.toFixed(2).replace('.',',')}`;}
function finalResponse(req:any,total:number,dist:string,cep:string,product:any,freight:any):Response|null{const amount=productAmount(product);const opcoes=Array.isArray(freight?.display_data?.opcoes)?freight.display_data.opcoes:null;if(!amount||!opcoes?.length)return null;const opts=opcoes.map((o:any)=>`${o.servico}: ${o.preco}, ${o.prazo}`).join(' | ');const mensagem=`Fechando em ${total} adesivos: DTF UV ${money(amount)}. Frete para ${cep.slice(0,5)}-${cep.slice(5)}: ${opts}. Qual você prefere?`;const decision={responde:true,mensagem,tema:'frete',encaminhou_venda:true,etapa:'fechamento',slots:{produto:'DTF UV',quantidade:`${total} adesivos (${dist})`,cep,envio_retirada:'envio',modalidade_logistica:'envio'}};return new Response(JSON.stringify({id:'msg_'+crypto.randomUUID().replace(/-/g,''),type:'message',role:'assistant',model:req?.model||'controller',content:[{type:'text',text:JSON.stringify(decision)}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json','x-cortex-color-split-inner':QTI_VERSION}});}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const u=urlOf(input);if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(u))return qtiBaseFetch(input,init);
  const raw=await rawBody(input,init);if(!raw)return qtiBaseFetch(input,init);let req:any;try{req=JSON.parse(raw);}catch{return qtiBaseFetch(input,init);}if(!Array.isArray(req?.messages)||req?.stream===true)return qtiBaseFetch(input,init);
  const system=String(req?.system||'');const total=markerTotal(system);if(!total)return qtiBaseFetch(input,init);const dist=markerDistribution(system)||`${total}`;const d=dialogue(req.messages);const cep=lastCep(d);const measure=knownMeasure(d,system);if(!cep||!measure)return qtiBaseFetch(input,init);
  const us=uses(req.messages);const pu=us.filter(x=>x.name==='calcular_rendimento_uv');const fu=us.filter(x=>x.name==='calcular_frete');
  if(!pu.length)return toolResponse(req,'calcular_rendimento_uv',{largura_cm:measure.largura_cm,altura_cm:measure.altura_cm,quantidade_desejada:total});
  const pUse=pu[pu.length-1];const pRaw=resultRaw(req.messages,pUse.id,pUse.index);const p=parse(pRaw);if(failed(pRaw,p))return qtiBaseFetch(input,init);
  if(!fu.length)return toolResponse(req,'calcular_frete',{cep_destino:cep});
  const fUse=fu[fu.length-1];const fRaw=resultRaw(req.messages,fUse.id,fUse.index);const f=parse(fRaw);if(failed(fRaw,f))return qtiBaseFetch(input,init);
  const fin=finalResponse(req,total,dist,cep,p,f);return fin||qtiBaseFetch(input,init);
};
