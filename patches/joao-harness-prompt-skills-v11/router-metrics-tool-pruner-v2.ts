declare const Deno: any;

// Harness-only v2: poda mínima. Quando a família DTF já está provada, remove SOMENTE
// orcar_camisetas (maior schema, 1.898 chars). Produto desconhecido/mudança => 12 tools.
const TP2_BASE_FETCH = globalThis.fetch.bind(globalThis);
function u(input: RequestInfo | URL): string { return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; }
async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) { try { return await input.clone().text(); } catch {} }
  return '';
}
function rebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
function jsonAfter(text: string, marker: string, from = 0): any | null {
  const mi=text.indexOf(marker,from); if(mi<0)return null; const start=text.indexOf('{',mi+marker.length); if(start<0)return null;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){const ch=text[i]; if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;} if(ch==='"'){quoted=true;continue;} if(ch==='{')depth++; else if(ch==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{return null;}}}
  return null;
}
function norm(v:any): string|null { const s=String(v??'').toLowerCase(); if(s.includes('dtf_textil')||/dtf\s*t[eê]xtil/.test(s))return'dtf_textil'; if(s.includes('dtf_uv')||/dtf\s*uv/.test(s))return'dtf_uv'; return null; }
function family(system:string): string|null {
  if(system.includes('[O CLIENTE MUDOU DE ASSUNTO:')) return null;
  const f=system.lastIndexOf('[FICHA:'); if(f>=0){const p=norm(jsonAfter(system,'slots=',f)?.produto); if(p)return p;}
  const o=system.lastIndexOf('[ORIGEM: anúncio "'); if(o>=0){const e=system.indexOf('"',o+'[ORIGEM: anúncio "'.length); const p=norm(e>o?system.slice(o,e+1):system.slice(o,o+180)); if(p)return p;}
  return null;
}
function chars(v:any){try{return JSON.stringify(v??null).length;}catch{return 0;}}
async function emit(path:string,fields:Record<string,string>){try{await TP2_BASE_FETCH(`https://harness-metrics.invalid/${path}?${new URLSearchParams(fields).toString()}`,{method:'GET'});}catch{}}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=u(input); if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) return TP2_BASE_FETCH(input,init);
  const raw=await bodyText(input,init); if(!raw)return TP2_BASE_FETCH(input,init);
  let b:any; try{b=JSON.parse(raw);}catch{return TP2_BASE_FETCH(input,init);}
  if(typeof b?.system!=='string'||!Array.isArray(b?.tools))return TP2_BASE_FETCH(input,init);
  const fam=family(b.system); const before=b.tools;
  const canPrune=fam==='dtf_textil'||fam==='dtf_uv';
  const after=canPrune?before.filter((t:any)=>String(t?.name??'')!=='orcar_camisetas'):before;
  await emit('tool-prune',{version:'v2',family:fam??'unknown',before_count:String(before.length),after_count:String(after.length),before_chars:String(chars(before)),after_chars:String(chars(after))});
  const rb=after.length===before.length?[input,init] as [RequestInfo|URL,RequestInit|undefined]:rebuild(input,init,JSON.stringify({...b,tools:after}));
  const res=await TP2_BASE_FETCH(rb[0],rb[1]);
  await emit('router',{routed:res.headers.get('x-cortex-skill-router')?'1':'0'});
  return res;
};
