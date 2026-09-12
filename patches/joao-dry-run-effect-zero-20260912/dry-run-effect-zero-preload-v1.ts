import { AsyncLocalStorage } from 'node:async_hooks';

declare const Deno: any;

// João dry-run effect-zero v1 — 12/09/2026
// Problema provado: _dry_run=true ainda executava tools e chegou a emitir operação financeira real.
// Este preload cria contexto assíncrono por request. Em dry-run:
// 1) nenhuma escrita de negócio chega a Córtex/ERP/provedores;
// 2) emissão financeira/proposta ERP são simuladas em memória;
// 3) calcular-frete DTF UV chama somente a cotação read-only da Frenet e NÃO grava snapshot;
// 4) qualquer mutação não explicitamente simulada falha fechada.
// Produção normal (sem _dry_run) é byte-semanticamente passthrough.

const DRZ_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const DRZ_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const DRZ_ERP_URL = (Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/, '');
const DRZ_FRENET_TOKEN = Deno.env.get('TOKEN_FRENET') ?? '';
const DRZ_FRENET_URL = 'http://api.frenet.com.br/shipping/quote';
const DRZ_CONFIG_KEY = 'joao_dry_run_effect_zero_v1_ativo';
const DRZ_VERSION = 'joao-dry-run-effect-zero/v1';
const drzNativeFetch = globalThis.fetch.bind(globalThis);
const drzNativeServe = Deno.serve.bind(Deno);

let drzCfgAt = 0;
let drzCfg = false;

type DryStore = {
  dryRun: true;
  syntheticOps: Map<string, any>;
  syntheticReceipts: Map<string, any>;
  latestProductOperationId: string | null;
  blocked: string[];
};
const drzAls = new AsyncLocalStorage<DryStore>();

function drzUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function drzRawBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
async function drzJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  const raw = await drzRawBody(input, init);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function drzJson(body:any, status=200, extra:Record<string,string>={}) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{ 'content-type':'application/json; charset=utf-8', 'x-cortex-dry-run':DRZ_VERSION, ...extra },
  });
}
function drzMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
}
async function drzEnabled(): Promise<boolean> {
  if (Date.now() - drzCfgAt < 15000) return drzCfg;
  drzCfgAt = Date.now();
  try {
    const r = await drzNativeFetch(`${DRZ_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.${encodeURIComponent(DRZ_CONFIG_KEY)}&limit=1`, {
      headers:{ apikey:DRZ_SERVICE, authorization:`Bearer ${DRZ_SERVICE}` },
      signal:AbortSignal.timeout(1200),
    });
    if (r.ok) {
      const rows = await r.json().catch(()=>[]);
      if (Array.isArray(rows) && rows.length) drzCfg = rows[0]?.valor_bool === true;
    }
  } catch {}
  return drzCfg;
}
function drzSyntheticOperation(req:any): any {
  const now = new Date();
  const id = crypto.randomUUID();
  return {
    id,
    operation_id:id,
    lead_id:req?.p_lead_id ?? null,
    kind:req?.p_kind ?? 'produto',
    amount:Number(req?.p_amount ?? 0),
    currency:req?.p_currency ?? 'BRL',
    source_tool:req?.p_source_tool ?? 'dry_run',
    components:req?.p_components ?? {},
    status:'ativa',
    created_at:now.toISOString(),
    expires_at:new Date(now.getTime()+30*60*1000).toISOString(),
    used_at:null,
    dry_run:true,
    synthetic:true,
  };
}
function drzSyntheticProposal(op:any): any {
  const proposalId = crypto.randomUUID();
  const c = op?.components ?? {};
  const item = {
    produto_id:'d48addf9-2b53-482f-8f28-1dfc7ea7c123',
    descricao:'DTF UV',
    quantidade:Number(c?.quantidade ?? 1),
    uv_consumo_m:Number(c?.consumo_m ?? c?.metros ?? 0),
    valor_total:Number(op?.amount ?? 0),
  };
  return {
    ok:true,
    canonical:true,
    system_of_record:'ERP',
    code:'DRY_RUN_SYNTHETIC_PROPOSAL',
    proposta_id:proposalId,
    numero_proposta:-1,
    proposal_total_brl:Number(op?.amount ?? 0),
    total:Number(op?.amount ?? 0),
    operation_id:op?.id,
    items:[item],
    snapshot:{ items:[item] },
    dry_run:true,
    synthetic:true,
  };
}
function drzAllowedCarrier(s:any): boolean {
  if (s?.Error) return false;
  const carrier=String(s?.Carrier ?? '').toLowerCase();
  const desc=String(s?.ServiceDescription ?? '').toLowerCase();
  const code=String(s?.ServiceCode ?? '').toUpperCase();
  return (carrier==='correios' && (desc.includes('sedex') || desc.includes('pac'))) || code==='JTE_INT' || carrier.includes('j&t') || desc.includes('j&t');
}
async function drzFreightQuote(body:any, store:DryStore): Promise<Response> {
  const cep=String(body?.cep_destino ?? '').replace(/\D/g,'');
  if (cep.length!==8) return drzJson({ok:false,error:'cep_destino_invalido',dry_run:true},400);
  const opId=store.latestProductOperationId;
  const op=opId ? store.syntheticOps.get(opId) : null;
  if (!op) return drzJson({ok:false,error:'dry_run_sem_operacao_produto_sintetica',dry_run:true},409);
  const c=op?.components ?? {};
  const consumo=Number(c?.consumo_m ?? c?.metros ?? 0);
  if (!(consumo>0) || consumo>10) return drzJson({ok:false,error:'dry_run_consumo_uv_invalido',dry_run:true},409);
  if (!DRZ_FRENET_TOKEN) return drzJson({ok:false,error:'dry_run_frenet_token_ausente',dry_run:true},503);
  const payload={
    SellerCEP:'06813230',
    RecipientCEP:cep,
    ShipmentInvoiceValue:Number(op.amount),
    ShippingItemArray:[{ Height:13, Length:30, Width:13, Weight:1, Quantity:1 }],
  };
  let data:any;
  try {
    const r=await drzNativeFetch(DRZ_FRENET_URL,{
      method:'POST',
      headers:{'content-type':'application/json',token:DRZ_FRENET_TOKEN},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(12000),
    });
    data=await r.json().catch(()=>null);
    if (!r.ok || !data) return drzJson({ok:false,error:'dry_run_frenet_http_fail',http:r.status,dry_run:true},502);
  } catch (e:any) {
    return drzJson({ok:false,error:'dry_run_frenet_exception',detail:String(e?.message ?? e).slice(0,120),dry_run:true},502);
  }
  const raw=Array.isArray(data?.ShippingSevicesArray) ? data.ShippingSevicesArray : Array.isArray(data?.ShippingServicesArray) ? data.ShippingServicesArray : [];
  const opcoes=raw.filter(drzAllowedCarrier).map((s:any)=>({
    transportadora:s.Carrier || (String(s.ServiceCode||'').toUpperCase()==='JTE_INT'?'J&T Express':null),
    servico:s.ServiceDescription,
    codigo:s.ServiceCode,
    preco:parseFloat(s.ShippingPrice),
    prazo_dias:parseInt(s.DeliveryTime),
    preco_formatado:`R$${parseFloat(s.ShippingPrice).toFixed(2).replace('.',',')}`,
    prazo_formatado:`${s.DeliveryTime} dia${String(s.DeliveryTime)==='1'?'':'s'} uteis`,
  })).filter((x:any)=>Number.isFinite(x.preco)).sort((a:any,b:any)=>a.preco-b.preco);
  return drzJson({
    ok:opcoes.length>0,
    cep_origem:'06813230',
    cep_destino:cep,
    shipment_kind:'dtf_uv',
    quantidade_logistica:consumo,
    unidade_logistica:'metros',
    valor_declarado_brl:Number(op.amount),
    opcoes,
    linhas:opcoes.map((x:any)=>`${x.servico} - ${x.preco_formatado} - ${x.prazo_formatado}`),
    quote_snapshot_id:null,
    dry_run:true,
    synthetic:true,
    persistence:false,
  },200);
}
function drzIsSafeReadOnlyRpc(url:string): boolean {
  return /\/rest\/v1\/rpc\/(?:fn_precificar_dtf_uv_v2|fn_dtf_uv_capacidade_folha|fn_valor_e_legitimo|fn_resolver_modalidade_logistica|fn_edge_cron_auth_ok_v1)(?:\?|$)/i.test(url);
}
function drzBlocked(label:string, store:DryStore): Response {
  store.blocked.push(label);
  console.log(JSON.stringify({event:'JOAO_DRY_RUN_WRITE_BLOCKED',version:DRZ_VERSION,target:label}));
  return drzJson({ok:false,error:'dry_run_effect_zero_write_blocked',target:label,dry_run:true},409);
}

globalThis.fetch = async (input:RequestInfo|URL, init?:RequestInit):Promise<Response> => {
  const store=drzAls.getStore();
  if (!store?.dryRun) return drzNativeFetch(input,init);
  const url=drzUrl(input);
  const method=drzMethod(input,init);

  // Model calls are allowed: they spend tokens but do not mutate business state.
  if (/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url) || /^https:\/\/api\.openai\.com\//i.test(url)) {
    return drzNativeFetch(input,init);
  }

  // Synthetic financial operation: never reaches DB/ERP.
  if (method==='POST' && /\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url)) {
    const req=await drzJsonBody(input,init);
    const op=drzSyntheticOperation(req);
    store.syntheticOps.set(op.id,op);
    if (String(op.kind)==='produto') store.latestProductOperationId=op.id;
    return drzJson(op,200,{'x-cortex-dry-run-synthetic':'financial-operation'});
  }

  // Synthetic ERP proposal snapshot for the in-memory operation.
  if (method==='POST' && /\/rest\/v1\/rpc\/fn_cortex_proposal_snapshot_v1(?:\?|$)/i.test(url)) {
    const req=await drzJsonBody(input,init);
    const op=store.syntheticOps.get(String(req?.p_operation_id ?? ''));
    if (!op) return drzBlocked('erp.fn_cortex_proposal_snapshot_v1:unknown_operation',store);
    const proposal=drzSyntheticProposal(op);
    return drzJson(proposal,200,{'x-cortex-dry-run-synthetic':'erp-proposal'});
  }

  // Synthetic receipt record: append-only in memory only.
  if (method==='POST' && /\/rest\/v1\/rpc\/fn_joao_erp_proposal_receipt_record_v1(?:\?|$)/i.test(url)) {
    const req=await drzJsonBody(input,init);
    const opId=String(req?.p_operation_id ?? '');
    const op=store.syntheticOps.get(opId);
    if (!op) return drzBlocked('cortex.fn_joao_erp_proposal_receipt_record_v1:unknown_operation',store);
    const receipt={
      ok:true,code:'DRY_RUN_SYNTHETIC_RECEIPT',status:'RECORDED',receipt_id:crypto.randomUUID(),operation_id:opId,
      proposal_total_brl:Number(op.amount),canonical:true,dry_run:true,synthetic:true,
      snapshot:req?.p_erp_snapshot ?? drzSyntheticProposal(op),
    };
    store.syntheticReceipts.set(opId,receipt);
    return drzJson(receipt,200,{'x-cortex-dry-run-synthetic':'proposal-receipt'});
  }

  // Read of a synthetic receipt/operation by downstream guardrails.
  if (method==='GET' && /\/rest\/v1\/joao_erp_proposal_receipts_v1(?:\?|$)/i.test(url)) {
    for (const [opId,r] of store.syntheticReceipts) {
      if (url.includes(`operation_id=eq.${encodeURIComponent(opId)}`) || url.includes(`operation_id=eq.${opId}`)) return drzJson([r]);
    }
    return drzNativeFetch(input,init);
  }
  if (method==='GET' && /\/rest\/v1\/operacoes_financeiras(?:\?|$)/i.test(url)) {
    for (const [opId,op] of store.syntheticOps) {
      if (url.includes(`id=eq.${encodeURIComponent(opId)}`) || url.includes(`id=eq.${opId}`)) return drzJson([op]);
    }
    return drzNativeFetch(input,init);
  }

  // Freight is simulated against Frenet read-only, without snapshot/authorization writes.
  if (method==='POST' && /\/functions\/v1\/calcular-frete(?:\?|$)/i.test(url)) {
    return drzFreightQuote(await drzJsonBody(input,init),store);
  }

  // Safe canonical read-only RPCs continue to execute.
  if (method==='POST' && drzIsSafeReadOnlyRpc(url)) return drzNativeFetch(input,init);

  // Reads are allowed. Every other mutation is fail-closed.
  if (method==='GET' || method==='HEAD') return drzNativeFetch(input,init);
  if (url.startsWith(DRZ_URL) || url.startsWith(DRZ_ERP_URL) || /backend\.botconversa\.com\.br|api\.z-api\.io|mercadopago|api\.mercadopago\.com/i.test(url)) {
    return drzBlocked(`${method} ${new URL(url).pathname}`,store);
  }

  // Unknown external POST/PUT/PATCH/DELETE is blocked too. Quote-only Frenet is reached only via drzFreightQuote/nativeFetch above.
  if (!['GET','HEAD'].includes(method)) return drzBlocked(`${method} external:${new URL(url).hostname}`,store);
  return drzNativeFetch(input,init);
};

(Deno as any).serve = (...args:any[]) => {
  const handlerIndex=typeof args[0]==='function' ? 0 : 1;
  const handler=args[handlerIndex];
  if (typeof handler!=='function') throw new TypeError('Deno.serve handler missing');
  args[handlerIndex]=async (req:Request, info:any) => {
    let requested=false;
    try {
      if (req.method==='POST' && (req.headers.get('content-type')||'').toLowerCase().includes('application/json')) {
        const body=await req.clone().json().catch(()=>null);
        requested=body?._dry_run===true;
      }
    } catch {}
    if (!requested || !(await drzEnabled())) return handler(req,info);
    const store:DryStore={dryRun:true,syntheticOps:new Map(),syntheticReceipts:new Map(),latestProductOperationId:null,blocked:[]};
    return await drzAls.run(store,async()=>{
      const res=await handler(req,info);
      const headers=new Headers(res.headers);
      headers.set('x-cortex-dry-run-effect-zero',DRZ_VERSION);
      headers.set('x-cortex-dry-run-blocked-count',String(store.blocked.length));
      headers.delete('content-length');
      return new Response(res.body,{status:res.status,statusText:res.statusText,headers});
    });
  };
  return drzNativeServe(...args as any);
};
