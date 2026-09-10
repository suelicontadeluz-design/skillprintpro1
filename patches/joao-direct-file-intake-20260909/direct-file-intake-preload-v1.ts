declare const Deno: any;

// João Direct File Intake v1 — 09/09/2026
// Context-only. Usa o inventário já materializado em arte_uploads pelo pipeline de arquivos.
// Não baixa arquivo, não cria memória, não calcula preço e não executa ação comercial.
const DF_URL=(Deno.env.get('SUPABASE_URL')??'').replace(/\/$/,'');
const DF_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const DF_VERSION='joao-direct-file-intake/v1';
const dfBaseFetch=globalThis.fetch.bind(globalThis);
let cfgAt=0,cfg=false;

function target(input:RequestInfo|URL):string{try{return typeof input==='string'?input:input instanceof URL?input.href:input.url}catch{return''}}
async function bodyText(input:RequestInfo|URL,init?:RequestInit):Promise<string>{if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text()}catch{}}return''}
async function enabled():Promise<boolean>{
  if(Date.now()-cfgAt<15000)return cfg; cfgAt=Date.now();
  try{const r=await dfBaseFetch(`${DF_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.joao_direct_file_intake_ativo&limit=1`,{headers:{apikey:DF_KEY,authorization:`Bearer ${DF_KEY}`},signal:AbortSignal.timeout(1800)});if(!r.ok)return cfg;const rows=await r.json();cfg=Array.isArray(rows)&&rows[0]?.valor_bool===true}catch{}
  return cfg;
}
function zipFacts(system:string):Array<{count:number;names:string[];ignored:number}>{
  const out:Array<{count:number;names:string[];ignored:number}>=[];
  const rx=/ZIP_VALIDADO:\s*(\d+)\s+arquivo\(s\) de arte;\s*itens=([^;\n]*);\s*ignorados=(\d+)/gi;
  let m:RegExpExecArray|null;
  while((m=rx.exec(system))!==null&&out.length<10){out.push({count:Number(m[1]),names:String(m[2]||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20),ignored:Number(m[3])||0});}
  return out;
}
async function audit(evento:string,detail:any){try{await dfBaseFetch(`${DF_URL}/rest/v1/sistema_logs`,{method:'POST',headers:{'content-type':'application/json',apikey:DF_KEY,authorization:`Bearer ${DF_KEY}`,prefer:'return=minimal'},body:JSON.stringify({agente_slug:'agente-noturno',funcao:'joao-direct-file-intake',versao:DF_VERSION,nivel:'info',categoria:'skill_runtime',evento,status:'applied',mensagem:evento,detalhe:detail}),signal:AbortSignal.timeout(1500)})}catch{}}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=target(input);
  if(!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)||!(await enabled()))return dfBaseFetch(input,init);
  const raw=await bodyText(input,init);if(!raw)return dfBaseFetch(input,init);
  let body:any;try{body=JSON.parse(raw)}catch{return dfBaseFetch(input,init)}
  if(typeof body?.system!=='string')return dfBaseFetch(input,init);
  const facts=zipFacts(body.system);if(!facts.length)return dfBaseFetch(input,init);

  const compact=facts.map((z,i)=>({zip:i+1,arquivos_internos:z.count,nomes:z.names,ignorados:z.ignored}));
  body.system+=`\n\n[CORTEX ARQUIVO DIRETO v1]\nHá ZIP(s) já descompactado(s) e inventariado(s) pelo pipeline: ${JSON.stringify(compact)}\nUm ZIP é CONTÊINER, não uma única arte. Ao contar, diferencie ANEXOS recebidos de ARQUIVOS INTERNOS. Ex.: diga \"recebi 1 ZIP contendo 5 arquivos\"; não diga apenas \"recebi 1 arquivo\" nem some o ZIP como se fosse uma sexta arte. Use nomes internos comprovados.\nNão conclua por nome de arquivo que DPI, transparência, fundo, medida física ou qualidade foram validados. Dimensões em pixels, quando existirem em outra evidência, também não provam DPI ou tamanho físico sozinhas. Não execute nem abra recursivamente ZIP/RAR/7z que esteja dentro de outro arquivo compactado.\nSe algum item foi ignorado, informe apenas se isso for relevante para a solicitação e peça no máximo uma correção específica. Arquivo/inventário não autoriza preço, quantidade, frete ou pagamento.\n[/CORTEX ARQUIVO DIRETO]`;
  void audit('direct_file_zip_context_injected',{zip_count:facts.length,internal_files:facts.reduce((a,z)=>a+z.count,0),ignored:facts.reduce((a,z)=>a+z.ignored,0),authority_granted:false,effect_class:'CONTEXT_ONLY'});
  const headers=new Headers(init?.headers??(typeof Request!=='undefined'&&input instanceof Request?input.headers:undefined));headers.delete('content-length');
  return dfBaseFetch(input,{...(init??{}),headers,body:JSON.stringify(body)});
};
