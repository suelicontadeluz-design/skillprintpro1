declare const Deno: any;

// João color split resolution fallback v1 — 12/09/2026
// Complementa o guard v1.1 para casos em que a pergunta de confirmação não foi persistida
// (ex.: replay effect-zero, supersede ou queda de transporte), mas a própria fala ambígua do
// cliente continua no contexto recente. Só atua em DTF UV, com padrão exato de distribuição
// por cor e resposta curta exata "N de cada cor"/"N brancos".

const QRF_VERSION='joao-color-split-resolution-fallback/v1';
const qrfBaseFetch=globalThis.fetch.bind(globalThis);

function qrfUrl(input:RequestInfo|URL):string {
  return typeof input==='string'?input:input instanceof URL?input.href:input.url;
}
async function qrfRaw(input:RequestInfo|URL,init?:RequestInit):Promise<string>{
  if(typeof init?.body==='string') return init.body;
  if(init?.body!=null) return String(init.body);
  if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text();}catch{}}
  return '';
}
function qrfText(content:any):string{
  if(typeof content==='string') return content.trim();
  if(!Array.isArray(content)) return '';
  return content.filter((x:any)=>x?.type==='text').map((x:any)=>String(x?.text??'')).join('\n').trim();
}
function qrfDialogue(messages:any[]):Array<{role:string;text:string}>{
  const out:Array<{role:string;text:string}>=[];
  for(const m of messages||[]){
    if(!m||(m.role!=='user'&&m.role!=='assistant')) continue;
    if(Array.isArray(m.content)&&m.content.some((x:any)=>x?.type==='tool_result')) continue;
    const t=qrfText(m.content); if(!t||/^\s*\[SISTEMA:/i.test(t)) continue;
    out.push({role:String(m.role),text:t});
  }
  return out;
}
const COLOR_WORD='(branc[oa]s?|pret[oa]s?|dourad[oa]s?|pratead[oa]s?|azuis?|verdes?|vermelh[oa]s?|amarel[oa]s?|rosas?|rox[oa]s?|lil[aá]s|laranjas?|cinzas?|beges?)';
const COLOR_MAP:Array<[RegExp,string]>=[
  [/\bbranc[oa]s?\b/i,'branco'],[/\bpret[oa]s?\b/i,'preto'],[/\bdourad[oa]s?\b/i,'dourado'],[/\bpratead[oa]s?\b/i,'prateado'],
  [/\bazuis?\b/i,'azul'],[/\bverdes?\b/i,'verde'],[/\bvermelh[oa]s?\b/i,'vermelho'],[/\bamarel[oa]s?\b/i,'amarelo'],
  [/\brosas?\b/i,'rosa'],[/\brox[oa]s?\b/i,'roxo'],[/\blil[aá]s\b/i,'lilás'],[/\blaranjas?\b/i,'laranja'],[/\bcinzas?\b/i,'cinza'],[/\bbeges?\b/i,'bege']
];
function canonColor(s:string):string|null{for(const [rx,c] of COLOR_MAP) if(rx.test(s)) return c; return null;}
function countedColors(text:string):string[]{
  const rx=new RegExp(`\\b\\d{1,4}\\s+${COLOR_WORD}\\b`,'gi');
  const out:string[]=[];
  for(const m of String(text||'').matchAll(rx)){const c=canonColor(String(m[1]||'')); if(c&&!out.includes(c)) out.push(c);}
  return out;
}
function ambiguous(text:string):boolean{
  return new RegExp(`^\\s*(?:seriam?|ser[aã]o|s[aã]o|ficariam?|ficam?)?\\s*\\d{1,4}\\s+${COLOR_WORD}\\s+ou\\s+\\d{1,4}\\s+de\\s+cada\\s+cor\\b[?.!\\s]*$`,'i').test(String(text||'').trim());
}
function latestUser(d:Array<{role:string;text:string}>):string{for(let i=d.length-1;i>=0;i--) if(d[i].role==='user') return d[i].text; return '';}
function priorAmbiguous(d:Array<{role:string,text:string}>):string|null{
  let skippedLatest=false;
  for(let i=d.length-1;i>=0;i--){
    if(d[i].role!=='user') continue;
    if(!skippedLatest){skippedLatest=true;continue;}
    if(ambiguous(d[i].text)) return d[i].text;
  }
  return null;
}
function resolution(text:string):{mode:'each'|'single';n:number}|null{
  let m=String(text||'').trim().match(/^(?:quero\s+)?(\d{1,4})\s+de\s+cada\s+cor[?.!\s]*$/i);
  if(m) return {mode:'each',n:Number(m[1])};
  m=String(text||'').trim().match(/^(?:quero\s+)?(\d{1,4})\s+branc[oa]s?(?:\s+no\s+total)?[?.!\s]*$/i);
  if(m) return {mode:'single',n:Number(m[1])};
  return null;
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=qrfUrl(input);
  if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return qrfBaseFetch(input,init);
  const raw=await qrfRaw(input,init); if(!raw) return qrfBaseFetch(input,init);
  let req:any; try{req=JSON.parse(raw);}catch{return qrfBaseFetch(input,init);}
  if(!Array.isArray(req?.messages)||req?.stream===true) return qrfBaseFetch(input,init);
  const d=qrfDialogue(req.messages);
  const inbound=latestUser(d);
  const res=resolution(inbound);
  const prior=priorAmbiguous(d);
  if(!res||!prior) return qrfBaseFetch(input,init);
  const ctx=(String(req?.system??'')+'\n'+d.slice(-12).map(x=>x.text).join('\n'));
  if(!/\bdtf\s*uv\b|\badesivo(?:s)?\b/i.test(ctx)) return qrfBaseFetch(input,init);
  const colors=countedColors(ctx);
  if(colors.length<2) return qrfBaseFetch(input,init);
  const useColors=colors.slice(0,5);
  const total=res.mode==='each'?res.n*useColors.length:res.n;
  const dist=res.mode==='each'?useColors.map(c=>`${res.n} ${c}`).join(', '):`${res.n} branco`;
  const rule=`\n[CORTEX RESOLUCAO QUANTIDADE FALLBACK v1]\nA fala atual resolve a alternativa de quantidade por cor feita pelo proprio cliente anteriormente. Interpretacao deterministica: ${dist}; total=${total}. Isto SUBSTITUI a quantidade anterior. Preserve produto, medida e CEP ja confirmados. Recalcule DTF UV com calcular_rendimento_uv usando quantidade_desejada=${total}; depois cote frete com o CEP conhecido. Nao reutilize preco anterior se a quantidade mudou. Nao invente preco/frete/cobertura.\n[/CORTEX RESOLUCAO QUANTIDADE FALLBACK]`;
  req.system=String(req?.system??'')+rule;
  const headers=new Headers(init?.headers||{}); headers.set('x-cortex-color-split-resolution-fallback',QRF_VERSION);
  return qrfBaseFetch(input,{...init,headers,body:JSON.stringify(req)});
};
