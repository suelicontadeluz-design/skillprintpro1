declare const Deno:any;

// João color-split continuation controller v1 — 12/09/2026
// Depois que o cliente resolve uma alternativa de quantidade por cor, preço e frete são sequência
// operacional, não decisão linguística. Se o modelo parar após calcular_rendimento_uv apesar de CEP
// já informado, força calcular_frete. Depois do tool_result de frete, fecha a resposta a partir dos
// resultados canônicos e grava quantidade como a distribuição explicitamente dita pelo cliente.

const QCC_VERSION='joao-color-split-continuation/v1';
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
function toolUses(messages:any[]):Array<{id:string,name:string,input:any,index:number}>{const out:any[]=[];for(let i=0;i<(messages||[]).length;i++){const m=messages[i];if(m?.role!=='assistant'||!Array.isArray(m.content))continue;for(const b of m.content)if(b?.type==='tool_use')out.push({id:String(b.id||''),name:String(b.name||''),input:b.input??{},index:i});}return out;}
function toolResults(messages:any[]):Map<string,any>{const out=new Map<string,any>();for(const m of messages||[]){if(m?.role!=='user'||!Array.isArray(m.content))continue;for(const b of m.content){if(b?.type!=='tool_result')continue;let v:any=b.content;try{if(typeof v==='string')v=JSON.parse(v);else if(Array.isArray(v)){const t=v.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('');v=JSON.parse(t);}}catch{}out.set(String(b.tool_use_id||''),v);}}return out;}
function anthToolUseResponse(req:any,name:string,input:any):Response{const id='toolu_'+crypto.randomUUID().replace(/-/g,'');return new Response(JSON.stringify({id:'msg_'+crypto.randomUUID().replace(/-/g,''),type:'message',role:'assistant',model:req?.model||'replay-controller',content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json','x-cortex-color-split-controller':QCC_VERSION}});}
function brl(v:any):string{const n=Number(v);return Number.isFinite(n)?`R$ ${n.toFixed(2).replace('.',',')}`:'';}
function finalDecisionResponse(req:any,res:{mode:'each'|'single',n:number},colors:string[],cep:string,product:any,freight:any):Response{
  const dd=product?.display_data??{};const total=Number(dd?.quantidade_desejada??(res.mode==='each'?res.n*colors.length:res.n));const precoAuth=(Array.isArray(product?.financial_authorizations)?product.financial_authorizations.find((x:any)=>x?.kind==='produto')?.amount:null);const preco=Number(precoAuth??0);
  const opcoes=Array.isArray(freight?.display_data?.opcoes)?freight.display_data.opcoes:[];
  const qtdDesc=res.mode==='each'?`${res.n} de cada cor (${colors.join(', ')})`:`${res.n} brancos`;
  const partes=opcoes.map((o:any)=>`${o.servico}: ${o.preco}, ${o.prazo}`);
  const mensagem=`Fechando em ${total} adesivos: DTF UV ${brl(preco)}. Frete para ${cep.slice(0,5)}-${cep.slice(5)}: ${partes.join(' | ')}. Qual você prefere?`;
  const decision={responde:true,mensagem,tema:'frete',encaminhou_venda:true,etapa:'fechamento',slots:{produto:'DTF UV',quantidade:qtdDesc,cep,envio_retirada:'envio',modalidade_logistica:'envio'}};
  return new Response(JSON.stringify({id:'msg_'+crypto.randomUUID().replace(/-/g,''),type:'message',role:'assistant',model:req?.model||'replay-controller',content:[{type:'text',text:JSON.stringify(decision)}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}),{status:200,headers:{'content-type':'application/json','x-cortex-color-split-controller':QCC_VERSION}});
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=urlOf(input);if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url))return qccBaseFetch(input,init);
  const raw=await rawBody(input,init);if(!raw)return qccBaseFetch(input,init);let req:any;try{req=JSON.parse(raw);}catch{return qccBaseFetch(input,init);}if(!Array.isArray(req?.messages)||req?.stream===true)return qccBaseFetch(input,init);
  const d=ordinaryDialogue(req.messages);const inbound=latestUser(d);const res=resolution(inbound);if(!res||!priorAmbiguous(d))return qccBaseFetch(input,init);
  const ctx=String(req?.system??'')+'\n'+d.slice(-12).map(x=>x.text).join('\n');if(!/\bdtf\s*uv\b|\badesivo(?:s)?\b/i.test(ctx))return qccBaseFetch(input,init);
  const colors=countedColors(ctx).slice(0,5);if(colors.length<2)return qccBaseFetch(input,init);const cep=lastCep(d);if(!cep)return qccBaseFetch(input,init);
  const uses=toolUses(req.messages);const results=toolResults(req.messages);const prodUses=uses.filter(x=>x.name==='calcular_rendimento_uv');const freightUses=uses.filter(x=>x.name==='calcular_frete');
  const latestProd=prodUses.length?prodUses[prodUses.length-1]:null;const product=latestProd?results.get(latestProd.id):null;const productOk=product?.ok===true;
  const latestFreight=freightUses.length?freightUses[freightUses.length-1]:null;const freight=latestFreight?results.get(latestFreight.id):null;const freightOk=freight?.ok===true&&Array.isArray(freight?.display_data?.opcoes)&&freight.display_data.opcoes.length>0;
  if(productOk&&!latestFreight){
    console.log(JSON.stringify({event:'COLOR_SPLIT_CONTROLLER_FORCE_FREIGHT',version:QCC_VERSION,cep,colors,total:res.mode==='each'?res.n*colors.length:res.n}));
    return anthToolUseResponse(req,'calcular_frete',{cep_destino:cep});
  }
  if(productOk&&freightOk){
    console.log(JSON.stringify({event:'COLOR_SPLIT_CONTROLLER_FINALIZE',version:QCC_VERSION,cep,colors,total:res.mode==='each'?res.n*colors.length:res.n}));
    return finalDecisionResponse(req,res,colors,cep,product,freight);
  }
  return qccBaseFetch(input,init);
};
