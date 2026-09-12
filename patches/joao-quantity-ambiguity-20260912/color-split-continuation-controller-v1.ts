declare const Deno:any;

// João color-split continuation controller v1.3 — 12/09/2026
// Resolve a alternativa de quantidade por cor como fluxo determinístico:
// quantidade corrigida -> calcular_rendimento_uv -> calcular_frete com CEP já conhecido -> mensagem final.
// O modelo não escolhe quantidade nem decide se deve cotar frete; fica apenas na camada de linguagem.

const QCC_VERSION='joao-color-split-continuation/v1.3';
const qccBaseFetch=globalThis.fetch.bind(globalThis);
const COLOR_WORD='(branc[oa]s?|pret[oa]s?|dourad[oa]s?|pratead[oa]s?|azuis?|verdes?|vermelh[oa]s?|amarel[oa]s?|rosas?|rox[oa]s?|lil[aá]s|laranjas?|cinzas?|beges?)';
const COLOR_MAP:Array<[RegExp,string]>=[
  [/\bbranc[oa]s?\b/i,'branco'],[/\bpret[oa]s?\b/i,'preto'],[/\bdourad[oa]s?\b/i,'dourado'],[/\bpratead[oa]s?\b/i,'prateado'],
  [/\bazuis?\b/i,'azul'],[/\bverdes?\b/i,'verde'],[/\bvermelh[oa]s?\b/i,'vermelho'],[/\bamarel[oa]s?\b/i,'amarelo'],
  [/\brosas?\b/i,'rosa'],[/\brox[oa]s?\b/i,'roxo'],[/\blil[aá]s\b/i,'lilás'],[/\blaranjas?\b/i,'laranja'],[/\bcinzas?\b/i,'cinza'],[/\bbeges?\b/i,'bege']
];
function urlOf(input:RequestInfo|URL):string{return typeof input==='string'?input:input instanceof URL?input.href:input.url;}
async function rawBody(input:RequestInfo|URL,init?:RequestInit):Promise<string>{if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text();}catch{}}return '';}
function textOf(content:any):string{if(typeof content==='string')return content.trim();if(!Array.isArray(content))return '';return content.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim();}
function ordinaryDialogue(messages:any[]):Array<{role:string,text:string}>{const out:Array<{role:string,text:string}>=[];for(const m of messages||[]){if(!m||(m.role!=='user'&&m.role!=='assistant'))continue;if(Array.isArray(m.content)&&m.content.some((x:any)=>x?.type==='tool_result'))continue;const t=textOf(m.content);if(!t||/^\s*\[SISTEMA:/i.test(t))continue;out.push({role:String(m.role),text:t});}return out;}
function latestUser(d:Array<{role:string,text:string}>):string{for(let i=d.length-1;i>=0;i--)if(d[i].role==='user')return d[i].text;return '';}
function ambiguous(text:string):boolean{return new RegExp(`^\\s*(?:seriam?|ser[aã]o|s[aã]o|ficariam?|ficam?)?\\s*\\d{1,4}\\s+${COLOR_WORD}\\s+ou\\s+\\d{1,4}\\s+de\\s+cada\\s+cor\\b[?.!\\s]*$`,'i').test(String(text||'').trim());}
function priorAmbiguous(d:Array<{role:string,text:string}>):string|null{let skipped=false;for(let i=d.length-1;i>=0;i--){if(d[i].role!=='user')continue;if(!skipped){skipped=true;continue;}if(ambiguous(d[i].text))return d[i].text;}return null;}
function resolution(text:string):{mode:'each'|'single',n:number}|null{let m=String(text||'').trim().match(/^(?:quero\s+)?(\d{1,4})\s+de\s+cada\s+cor[?.!\s]*$/i);if(m)return{mode:'each',n:Number(m[1])};m=String(text||'').trim().match(/^(?:quero\s+)?(\d{1,4})\s+branc[oa]s?(?:\s+no\s+total)?[?.!\s]*$/i);if(m)return{mode:'single',n:Number(m[1])};return null;}
function canonColor(s:string):string|null{for(const[rx,c]of COLOR_MAP)if(rx.test(s))return c;return null;}
function countedColors(text:string):string[]{const rx=new RegExp(`\\b\\d{1,4}\\s+${COLOR_WORD}\\b`,'gi');const out:string[]=[];for(const m of String(text||'').matchAll(rx)){const c=canonColor(String(m[1]||''));if(c&&!out.includes(c))out.push(c);}return out;}
function lastCep(d:Array<{role:string,text:string}>):string|null{for(let i=d.length-1;i>=0;i--){if(d[i].role!=='user')continue;const all=[...d[i].text.matchAll(/\b(\d{5})-?(\d{3})\b/g)];if(all.length){const m=all[all.length-1];return m[1]+m[2];}}return null;}
function measureFrom(text:string):{largura_cm:number,altura_cm:number}|null{
  const ms=[...String(text||'').matchAll(/\b(\d{1,3}(?:[.,]\d+)?)\s*x\s*(\d{1,3}(?:[.,]\d+)?)\s*cm\b/gi)];
  if(ms.length){const m=ms[ms.length-1];const a=Number(m[1].replace(',','.'));const b=Number(m[2].replace(',','.'));if(a>0&&b>0)return{largura_cm:a,altura_cm:b};}
  const m=String(text||'').match(/\b(\d{1,3}(?:[.,]\d+)?)\s*cm\s+de\s+largura\s+por\s+(\d{1,3}(?:[.,]\d+)?)\s*cm\s+de\s+altura\b/i);
  if(m){const a=Number(m[1].replace(',','.'));const b=Number(m[2].replace(',','.'));if(a>0&&b>0)return{largura_cm:a,altura_cm:b};}
  return null;
}
function measureKnown(d:Array<{role:string,text:string}>,system:string):{largura_cm:number,altura_cm:number}|null{for(let i=d.length-1;i>=0;i--){const m=measureFrom(d[i].text);if(m)return m;}return measureFrom(system);}
function toolUses(messages:any[]):Array<{id:string,name:string,input:any,index:number}>{const out:any[]=[];for(let i=0;i<(messages||[]).length;i++){const m=messages[i];if(m?.role!=='assistant'||!Array.isArray(m.content))continue;for(const b of m.content)if(b?.type==='tool_use')out.push({id:String(b.id||''),name:String(b.name||''),input:b.input??{},index:i});}return out;}
function toolResultRaw(messages:any[],toolUseId:string,afterIndex=-1):string|null{for(let i=Math.max(0,afterIndex+1);i<(messages||[]).length;i++){const m=messages[i];if(m?.role!=='user'||!Array.isArray(m.content))continue;for(const b of m.content){if(b?.type!=='tool_result')continue;if(toolUseId&&String(b.tool_use_id||'')!==toolUseId)continue;const c=b.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('');try{return JSON.stringify(c);}catch{return String(c??'');}}}return null;}
function normalizeResult(raw:string|null):any{if(!raw)return null;let v:any=raw;for(let i=0;i<3;i++){if(typeof v!=='string')break;try{v=JSON.parse(v);}catch{break;}}if(v&&typeof v==='object'&&v.content&&typeof v.content==='string'){try{return JSON.parse(v.content);}catch{}}return v;}
function explicitFailure(raw:string|null,parsed:any):boolean{if(parsed&&typeof parsed==='object'&&(parsed.ok===false||parsed.erro||parsed.error))return true;return /"ok"\s*:\s*false|"erro"\s*:|"error"\s*:|autorizacao_nao_emitida|preco_indisponivel/i.test(String(raw||''));}
function resultCompleted(raw:string|null,parsed:any):boolean{return !!raw&&!explicitFailure(raw,parsed);}
function anthToolUseResponse(req:any,name:string,input:any):Response{const id='toolu_'+crypto.randomUUID().replace(/-/g,'');return new Response(JSON.stringify({id:'msg_'+crypto.randomUUID().replace(/-/g,''),type:'message',role:'assistant',model:req?.model||'replay-controller',content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json','x-cortex-color-split-controller':QCC_VERSION}});}
function productAmount(product:any):number|null{const a=Array.isArray(product?.financial_authorizations)?product.financial_authorizations.find((x:any)=>x?.kind==='produto')?.amount:null;const n=Number(a);if(Number.isFinite(n)&&n>0)return n;const pv=Array.isArray(product?.precos_verbalizaveis)?product.precos_verbalizaveis.find((x:any)=>x?.tipo==='preco_total')?.centavos:null;const c=Number(pv);return Number.isFinite(c)&&c>0?c/100:null;}
function amountMentioned(text:string,amount:number):boolean{const a=amount.toFixed(2).replace('.',',');const b=amount.toFixed(2);return text.includes(a)||text.includes(b);}
async function patchFinalModelResponse(response:Response,res:{mode:'each'|'single',n:number},colors:string[],cep:string,product:any):Promise<Response>{
  if(!response.ok)return response;let body:any;try{body=await response.clone().json();}catch{return response;}if(!body||!Array.isArray(body.content))return response;
  const qtdTotal=res.mode==='each'?res.n*colors.length:res.n;const qtdDesc=res.mode==='each'?`${qtdTotal} adesivos (${res.n} de cada cor: ${colors.join(', ')})`:`${res.n} adesivos brancos`;
  const amount=productAmount(product);let changed=false;
  body.content=body.content.map((b:any)=>{if(b?.type!=='text'||typeof b.text!=='string')return b;let d:any;try{d=JSON.parse(b.text);}catch{return b;}if(!d||typeof d!=='object')return b;d.slots={...(d.slots||{}),produto:'DTF UV',quantidade:qtdDesc,cep,envio_retirada:'envio',modalidade_logistica:'envio'};d.tema='frete';d.etapa='fechamento';d.encaminhou_venda=true;const msg=String(d.mensagem||'');if(amount&&!amountMentioned(msg,amount))d.mensagem=`Fechando em ${qtdTotal} adesivos: DTF UV R$ ${amount.toFixed(2).replace('.',',')}. ${msg}`.trim();changed=true;return{...b,text:JSON.stringify(d)};});
  if(!changed)return response;const h=new Headers(response.headers);h.delete('content-length');h.set('content-type','application/json');h.set('x-cortex-color-split-controller',QCC_VERSION);return new Response(JSON.stringify(body),{status:response.status,statusText:response.statusText,headers:h});
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input);if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url))return qccBaseFetch(input,init);
  const raw=await rawBody(input,init);if(!raw)return qccBaseFetch(input,init);let req:any;try{req=JSON.parse(raw);}catch{return qccBaseFetch(input,init);}if(!Array.isArray(req?.messages)||req?.stream===true)return qccBaseFetch(input,init);
  const d=ordinaryDialogue(req.messages);const inbound=latestUser(d);const res=resolution(inbound);if(!res||!priorAmbiguous(d))return qccBaseFetch(input,init);
  const system=String(req?.system??'');const ctx=system+'\n'+d.slice(-12).map(x=>x.text).join('\n');if(!/\bdtf\s*uv\b|\badesivo(?:s)?\b/i.test(ctx))return qccBaseFetch(input,init);
  const colors=countedColors(ctx).slice(0,5);if(colors.length<2)return qccBaseFetch(input,init);const cep=lastCep(d);if(!cep)return qccBaseFetch(input,init);const measure=measureKnown(d,system);if(!measure)return qccBaseFetch(input,init);
  const targetTotal=res.mode==='each'?res.n*colors.length:res.n;
  const uses=toolUses(req.messages);const prodUses=uses.filter(x=>x.name==='calcular_rendimento_uv');const freightUses=uses.filter(x=>x.name==='calcular_frete');
  if(!prodUses.length){
    return anthToolUseResponse(req,'calcular_rendimento_uv',{largura_cm:measure.largura_cm,altura_cm:measure.altura_cm,quantidade_desejada:targetTotal});
  }
  const latestProd=prodUses[prodUses.length-1];const productRaw=toolResultRaw(req.messages,latestProd.id,latestProd.index);const product=normalizeResult(productRaw);const productDone=resultCompleted(productRaw,product);
  const latestFreight=freightUses.length?freightUses[freightUses.length-1]:null;const freightRaw=latestFreight?toolResultRaw(req.messages,latestFreight.id,latestFreight.index):null;const freight=normalizeResult(freightRaw);const freightDone=!!latestFreight&&resultCompleted(freightRaw,freight);
  if(productDone&&!latestFreight){return anthToolUseResponse(req,'calcular_frete',{cep_destino:cep});}
  if(productDone&&freightDone){const modelResponse=await qccBaseFetch(input,init);return await patchFinalModelResponse(modelResponse,res,colors,cep,product);}
  return qccBaseFetch(input,init);
};
