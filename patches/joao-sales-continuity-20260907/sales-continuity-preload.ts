// Joao sales continuity hotfix v1 — 2026-09-07
// Organic sentinel: 5522998617849 (Max). Fixes three failure families without changing pricing/payment logic:
// 1) explicit reply "quero que envie" was missed by core logistics regex;
// 2) a failed freight quote could be verbalized as unsupported "Correios sem cobertura";
// 3) after shipping was chosen, the agent could regress to pickup/motoboy or promise a future callback.
// Also constrains DTF UV durability wording and the known wrong 7-10d deadline if it ever escapes upstream.

const SC_URL = Deno.env.get('SUPABASE_URL')!;
const SC_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const scBaseFetch = globalThis.fetch.bind(globalThis);
const scPreviousServe = Deno.serve.bind(Deno);
const scSidPhone = new Map<string,{phone:string,at:number}>();

function scUrl(input:RequestInfo|URL){return typeof input==='string'?input:input instanceof URL?input.href:input.url;}
function scDigits(v:unknown){return String(v??'').replace(/\D/g,'');}
function scNorm(v:unknown){return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
async function scRaw(input:RequestInfo|URL,init?:RequestInit){if(typeof init?.body==='string')return init.body;if(init?.body!=null)return String(init.body);if(typeof Request!=='undefined'&&input instanceof Request){try{return await input.clone().text();}catch{}}return'';}
function scResponse(body:any,status=200,headers?:HeadersInit){return new Response(JSON.stringify(body),{status,headers:headers??{'content-type':'application/json'}});}
function scRebuild(input:RequestInfo|URL,init:RequestInit|undefined,body:string):[RequestInfo|URL,RequestInit|undefined]{if(typeof Request!=='undefined'&&input instanceof Request)return[new Request(input,{...init,body}),undefined];return[input,{...(init||{}),body}];}

function scExplicitShippingReply(text:string):boolean{
  const t=scNorm(text).trim().replace(/[.!?]+$/,'').trim();
  if(/^(quero|prefiro)\s+(que\s+)?(envie|enviem|envia|enviar|mande|mandem|mandar)(\s+pra\s+mim|\s+para\s+mim)?$/.test(t))return true;
  if(/^(quero|prefiro)\s+(o\s+)?envio$/.test(t))return true;
  if(/^(pode|pode ser)\s+(envio|enviar|que\s+envie)$/.test(t))return true;
  return false;
}
function scAskedLogisticsChoice(text:string):boolean{
  const t=scNorm(text);
  return /(retir|buscar|pegar).{0,90}(envi|frete|receb)|(?:envi|frete|receb).{0,90}(retir|buscar|pegar)/.test(t);
}
function scUnsafeFreightDiagnosis(text:string):boolean{
  const t=scNorm(text);
  return /correios?.{0,30}(?:nao\s+tem|sem)\s+cobertura|regiao\s+de\s+dificil\s+acesso|cep\s+(?:esta\s+)?(?:incompleto|invalido|errado)|nao\s+(?:atende|entrega).{0,25}(?:esse|este)\s+cep/.test(t);
}
function scAsyncCallbackPromise(text:string):boolean{
  const t=scNorm(text);
  return /\b(?:volto|retorno|te\s+chamo|falo\s+com\s+voce)\b[\s\S]{0,40}\b(?:em\s+)?(?:meia|uma|duas|tres|\d{1,3})\s*(?:minutos?|horas?)\b/.test(t);
}
function scPickupOrMotoboyOffer(text:string):boolean{
  const t=scNorm(text);
  return /\b(?:voce|vc)\b.{0,30}\b(?:vem|vai|consegue|quer|prefere)\b.{0,30}\b(?:buscar|retirar)\b|\b(?:quer|prefere|pode\s+ser)\b.{0,25}\b(?:motoboy|moto\s*boy|retirada)\b|\b(?:retirada|motoboy)\b\s+ou\s+/.test(t);
}
function scAsksModalityAgain(text:string):boolean{
  const t=scNorm(text);
  return /\b(?:retirada|retirar|buscar)\b.{0,80}\b(?:envio|enviar)\b|\b(?:envio|enviar)\b.{0,80}\b(?:retirada|retirar|buscar)\b/.test(t);
}
function scUnsafeUVDurability(text:string):boolean{
  const t=scNorm(text);
  if(!/(dtf\s*uv|adesivo)/.test(t))return false;
  return /lava[-\s]?lou[cç]a|lava\s+na\s+maquina|(?:lava|lavar).{0,35}\bnao\s+sai\b|\bdescola\s+facil\b|\bnunca\s+sai\b/.test(t);
}
function scWrongUVDays(text:string):boolean{return /\b7\s*(?:a|-)\s*10\s+dias?\s+uteis\b/i.test(scNorm(text));}
function scSafeFreightFailure():string{return '*João Barros:*\nA cotação automática não retornou uma opção para esse CEP agora. Se você tiver outro CEP de entrega, me passa que eu tento por ele; o restante do seu pedido continua preservado.';}
function scSafeShippingContinuation():string{return '*João Barros:*\nFica envio mesmo. Se quiser usar outro endereço, me passa o novo CEP e eu recalculo o frete sem mexer no restante do pedido.';}
function scSafeUvDurability():string{return '*João Barros:*\nSim. Em vidro e outras superfícies rígidas, o DTF UV é resistente à água quando aplicado corretamente; limpe e seque bem a superfície antes de colar. A durabilidade varia conforme uso e lavagem, então prefiro não prometer que “não sai” em qualquer condição.';}

async function scRpc(name:string,body:any):Promise<any>{
  const r=await scBaseFetch(`${SC_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',apikey:SC_SERVICE,authorization:`Bearer ${SC_SERVICE}`},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`${name}_${r.status}`);
  return await r.json().catch(()=>null);
}
async function scReadState(phone:string):Promise<any>{
  const d=scDigits(phone); if(d.length<10)return null;
  const r=await scBaseFetch(`${SC_URL}/rest/v1/agente_noturno_estado?select=slots&phone=eq.${encodeURIComponent(d)}&limit=1`,{headers:{apikey:SC_SERVICE,authorization:`Bearer ${SC_SERVICE}`}});
  if(!r.ok)return null; const rows=await r.json().catch(()=>[]); return Array.isArray(rows)?rows[0]?.slots??null:null;
}
async function scRecentOutboundAskedChoice(phone:string):Promise<boolean>{
  const d=scDigits(phone); if(d.length<10)return false; const suffix=d.slice(-8);
  const since=new Date(Date.now()-30*60*1000).toISOString();
  const u=`${SC_URL}/rest/v1/fact_conversations?select=message_text,timestamp&phone=like.*${encodeURIComponent(suffix)}&direction=eq.outbound&timestamp=gte.${encodeURIComponent(since)}&order=timestamp.desc&limit=6`;
  const r=await scBaseFetch(u,{headers:{apikey:SC_SERVICE,authorization:`Bearer ${SC_SERVICE}`}}); if(!r.ok)return false;
  const rows=await r.json().catch(()=>[]); return Array.isArray(rows)&&rows.some((x:any)=>scAskedLogisticsChoice(String(x?.message_text??'')));
}
async function scFixState(phone:string,modalidade:'envio'|'retirada'|'motoboy',cep:string|null,evidence:string){
  try{return await scRpc('fn_joao_logistica_estado_fix_v1',{p_phone:scDigits(phone),p_modalidade:modalidade,p_cep:cep?scDigits(cep):null,p_evidence:evidence});}catch{return null;}
}
async function scPhoneByCep(cep:string):Promise<string|null>{
  const c=scDigits(cep); if(c.length!==8)return null; const since=new Date(Date.now()-60*60*1000).toISOString();
  const u=`${SC_URL}/rest/v1/fact_conversations?select=phone,message_text,timestamp&direction=eq.inbound&timestamp=gte.${encodeURIComponent(since)}&order=timestamp.desc&limit=100`;
  const r=await scBaseFetch(u,{headers:{apikey:SC_SERVICE,authorization:`Bearer ${SC_SERVICE}`}}); if(!r.ok)return null;
  const rows=await r.json().catch(()=>[]); if(!Array.isArray(rows))return null;
  for(const row of rows){if(scDigits(row?.message_text).includes(c)){const p=scDigits(row?.phone);if(p.length>=10)return p;}}
  return null;
}

// Resolve the grammar hole before the core handler reads its saved logistics state.
(Deno as any).serve=(...args:any[])=>{
  const idx=typeof args[0]==='function'?0:1; const handler=args[idx];
  if(typeof handler!=='function')return(scPreviousServe as any)(...args);
  args[idx]=async(req:Request,info:any)=>{
    if(req.method==='POST'){
      try{
        const body=await req.clone().json(); const msg=String(body?.mensagem??''); const phone=scDigits(body?.phone);
        if(body?._sweep!==true&&!String(body?._direct_message??'').trim()&&phone.length>=10&&scExplicitShippingReply(msg)){
          if(await scRecentOutboundAskedChoice(phone))await scFixState(phone,'envio',null,`explicit_shipping_reply:${msg.slice(0,80)}`);
        }
      }catch{}
    }
    return handler(req,info);
  };
  return(scPreviousServe as any)(...args);
};

// Constrain failed freight results and repair customer-facing regressions before existing guards/transports.
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=scUrl(input); const method=String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();

  if(method==='POST'&&url.includes('/functions/v1/calcular-frete')){
    const raw=await scRaw(input,init); let reqBody:any={}; try{reqBody=raw?JSON.parse(raw):{};}catch{}
    const resp=await scBaseFetch(input,init); let data:any=null; try{data=await resp.clone().json();}catch{return resp;}
    const cep=scDigits(reqBody?.cep_destino); const phone=cep.length===8?await scPhoneByCep(cep):null;
    if(phone)await scFixState(phone,'envio',cep,'calcular_frete_invoked');
    if(data?.ok===true)return resp;
    const safe={...(data||{}),ok:false,modalidade_logistica:'envio',cep_confirmado:cep.length===8,
      acao:'A cotacao automatica nao retornou uma opcao para este CEP agora. NAO conclua que o CEP e invalido/incompleto, que a regiao e de dificil acesso ou que os Correios nao tem cobertura. NAO peca o mesmo CEP novamente e NAO ofereca retirada/motoboy. Preserve produto, quantidade e valor ja combinados. Ofereca tentar OUTRO CEP/endereco de entrega ou encaminhar a cotacao para verificacao humana.',
      nao_inferir:['correios_sem_cobertura','regiao_dificil','cep_invalido_sem_prova']};
    return scResponse(safe,resp.status,{'content-type':'application/json'});
  }

  // Observe BotConversa subscriber lookup so we can recover phone for its outbound route.
  const sm=url.match(/\/subscriber\/get_by_phone\/([^/?]+)\/?(?:\?|$)/i);
  if(sm){const resp=await scBaseFetch(input,init);if(resp.ok){try{const d=await resp.clone().json();const sid=String(d?.id||'');const phone=scDigits(decodeURIComponent(sm[1]));if(sid&&phone)scSidPhone.set(sid,{phone,at:Date.now()});}catch{}}return resp;}

  const raw=await scRaw(input,init); let body:any=null; try{body=raw?JSON.parse(raw):null;}catch{return scBaseFetch(input,init);}
  let field:'message'|'value'|'texto'|null=null; let phone=''; let text='';
  if(/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)){field='message';phone=scDigits(body?.phone);text=String(body?.message??'');}
  else{const bm=url.match(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/([^/]+)\/send_message\/?(?:\?|$)/i);if(bm&&String(body?.type??'').toLowerCase()==='text'){field='value';text=String(body?.value??'');const h=scSidPhone.get(bm[1]);if(h&&Date.now()-h.at<10*60*1000)phone=h.phone;}else if(url.includes('/functions/v1/joao-tts')){field='texto';text=String(body?.texto??'');}}
  if(!field||!text)return scBaseFetch(input,init);

  let rewritten=text; let reason='';
  try{
    const slots=phone?await scReadState(phone):null; const shipping=String(slots?.modalidade_logistica??'')==='envio'; const prod=scNorm(slots?.produto??'');
    const freightContext=/frete|cep|correios|transportadora|cotacao|entrega|envio/i.test(scNorm(text));
    if(scUnsafeFreightDiagnosis(text)||(freightContext&&scAsyncCallbackPromise(text))){rewritten=scSafeFreightFailure();reason='freight_failure_or_async_promise';}
    else if(shipping&&(scAsksModalityAgain(text)||scPickupOrMotoboyOffer(text))){
      const kept=text.split(/(?<=[.!?])\s+|\n+/).filter((p:string)=>p.trim()&&!scAsksModalityAgain(p)&&!scPickupOrMotoboyOffer(p)).join(' ').trim();
      rewritten=kept?`${kept}\n\nFica envio mesmo. Se quiser usar outro endereço, me passa o novo CEP e eu recalculo o frete sem mexer no restante do pedido.`:scSafeShippingContinuation();
      reason='shipping_state_regression';
    }
    else if((/dtf|uv/.test(prod)||/dtf\s*uv/i.test(scNorm(text)))&&scUnsafeUVDurability(text)){rewritten=scSafeUvDurability();reason='uv_absolute_claim';}
    else if((/dtf|uv|adesiv/.test(prod))&&scWrongUVDays(text)){rewritten=text.replace(/\b(?:o\s+)?prazo\s+(?:padrao\s+)?(?:e\s+)?de\s+7\s*(?:a|-)\s*10\s+dias?\s+uteis[^.!?]*[.!]?/ig,'O prazo de produção do DTF UV é de 1 dia útil após a aprovação do layout; depois soma o prazo da transportadora a partir da postagem.');reason='uv_deadline_mismatch';}
  }catch{}
  if(rewritten!==text){body[field]=rewritten;console.warn(JSON.stringify({event:'JOAO_SALES_CONTINUITY_REWRITE',reason,phone_final:phone.slice(-4)}));const rebuilt=scRebuild(input,init,JSON.stringify(body));return scBaseFetch(rebuilt[0],rebuilt[1]);}
  return scBaseFetch(input,init);
};
