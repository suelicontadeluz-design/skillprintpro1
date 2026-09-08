declare const Deno: any;

// João -> ERP orçamento v3 — 2026-09-08
// ERP é a única fonte comercial de produto/preço. Antes de materializar uma operação de produto,
// consulta o gateway canônico de pricing do ERP, compara com o valor autorizado e grava apenas
// um receipt de evidência no Córtex. Sem preço/produto canônico do ERP, falha fechado.
const JOE_MAIN_URL = Deno.env.get('SUPABASE_URL')!;
const JOE_MAIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JOE_ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const JOE_ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const joeBaseFetch = globalThis.fetch.bind(globalThis);

type JoeSyncResult = {
  attempted: boolean;
  ok: boolean;
  canonical: boolean;
  code?: string;
  status?: number;
  result?: any;
};

function joeUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function joeBody(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  let raw = '';
  if (typeof init?.body === 'string') raw = init.body;
  else if (init?.body != null) raw = String(init.body);
  else if (typeof Request !== 'undefined' && input instanceof Request) {
    try { raw = await input.clone().text(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function joeRow(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}
async function joePhone(leadId: string): Promise<string> {
  if (!leadId) return '';
  const u = `${JOE_MAIN_URL}/rest/v1/agente_noturno_estado?select=phone&lead_id=eq.${encodeURIComponent(leadId)}&order=updated_at.desc&limit=1`;
  const r = await joeBaseFetch(u, { headers: { apikey: JOE_MAIN_KEY, authorization: `Bearer ${JOE_MAIN_KEY}` } });
  if (!r.ok) return '';
  const rows = await r.json().catch(() => []);
  return String(Array.isArray(rows) ? rows[0]?.phone ?? '' : '');
}
async function joeComponentDetails(components: any): Promise<any[]> {
  const xs = Array.isArray(components?.componentes) ? components.componentes : [];
  const ids = xs.map((x: any) => String(x?.operation_id ?? '')).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];
  const filter = encodeURIComponent(`in.(${ids.join(',')})`);
  const u = `${JOE_MAIN_URL}/rest/v1/operacoes_financeiras?id=${filter}&select=id,kind,amount,source_tool,components`;
  const r = await joeBaseFetch(u, { headers: { apikey: JOE_MAIN_KEY, authorization: `Bearer ${JOE_MAIN_KEY}` } });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function joePricingRequest(sourceTool: string, components: any): { request: any; family: string } {
  const tool = String(sourceTool || '').toLowerCase();
  const c = components && typeof components === 'object' ? components : {};
  if (tool === 'orcar_camisetas') {
    return { request: { mode: 'apparel', source_tool: tool, components: c }, family: 'apparel' };
  }
  if (tool === 'calcular_dtf_por_arte' || tool === 'calcular_dtf_metro') {
    return { request: { product_family: 'dtf_textil', source_tool: tool, quantity: Number(c.metros ?? 0) }, family: 'dtf_textil' };
  }
  if (tool === 'calcular_rendimento_uv' || tool === 'calcular_dtf_uv_metro') {
    return { request: { product_family: 'dtf_uv', source_tool: tool, quantity: Number(c.consumo_m ?? c.metros ?? 0) }, family: 'dtf_uv' };
  }
  return { request: { source_tool: tool }, family: '' };
}

async function joeRecordPricingReceipt(args: {
  operationId: string; leadId: string; sourceTool: string; family: string;
  amount: number; request: any; quote: any; erpTotal: number | null; canonical: boolean;
}): Promise<void> {
  try {
    const payload = {
      operation_id: args.operationId,
      lead_id: args.leadId,
      source_tool: args.sourceTool,
      product_family: args.family || null,
      authorized_amount: args.amount,
      erp_total: Number.isFinite(args.erpTotal as number) ? args.erpTotal : null,
      canonical: args.canonical,
      quote_request: args.request,
      erp_quote: args.quote ?? {},
    };
    const r = await joeBaseFetch(`${JOE_MAIN_URL}/rest/v1/rpc/fn_joao_erp_pricing_receipt_record_v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: JOE_MAIN_KEY, authorization: `Bearer ${JOE_MAIN_KEY}` },
      body: JSON.stringify({ p_payload: payload }),
    });
    if (!r.ok) {
      console.error(JSON.stringify({ event: 'JOAO_ERP_PRICING_RECEIPT_FAIL', status: r.status, operation_id: args.operationId }));
      return;
    }
    const out = await r.json().catch(() => null);
    console.log(JSON.stringify({ event: 'JOAO_ERP_PRICING_RECEIPT', operation_id: args.operationId, result: out }));
  } catch (e: any) {
    console.error(JSON.stringify({ event: 'JOAO_ERP_PRICING_RECEIPT_EXCEPTION', operation_id: args.operationId, error: String(e?.message ?? e).slice(0, 160) }));
  }
}

async function joeCanonicalPricing(row: any): Promise<JoeSyncResult> {
  const operationId = String(row?.id ?? row?.operation_id ?? '');
  const leadId = String(row?.lead_id ?? '');
  const sourceTool = String(row?.source_tool ?? '');
  const amount = Number(row?.amount ?? 0);
  const { request, family } = joePricingRequest(sourceTool, row?.components ?? {});

  const r = await joeBaseFetch(`${JOE_ERP_URL}/rest/v1/rpc/fn_cortex_pricing_calculation_v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: JOE_ERP_KEY, authorization: `Bearer ${JOE_ERP_KEY}` },
    body: JSON.stringify({ p_payload: request }),
  });
  if (!r.ok) {
    return { attempted: true, ok: false, canonical: false, code: 'ERP_PRICING_HTTP_FAIL', status: r.status };
  }
  const quote = await r.json().catch(() => null);
  const canonical = !!quote && quote.ok === true && quote.canonical === true && quote.system_of_record === 'ERP';
  const erpTotalRaw = quote?.total_price;
  const erpTotal = erpTotalRaw == null ? null : Number(erpTotalRaw);
  const totalMatch = canonical && Number.isFinite(erpTotal as number) && Math.abs((erpTotal as number) - amount) <= 0.02;

  await joeRecordPricingReceipt({ operationId, leadId, sourceTool, family, amount, request, quote, erpTotal, canonical });

  if (!canonical) {
    return { attempted: true, ok: false, canonical: false, code: String(quote?.code ?? 'ERP_CANONICAL_PRICE_REQUIRED'), result: quote };
  }
  if (!totalMatch) {
    return { attempted: true, ok: false, canonical: true, code: 'ERP_AUTHORIZED_TOTAL_MISMATCH', result: { authorized_amount: amount, erp_total: erpTotal, quote } };
  }
  return { attempted: true, ok: true, canonical: true, code: 'ERP_CANONICAL_PRICE_MATCH', result: quote };
}

async function joeSync(row: any): Promise<JoeSyncResult> {
  if (!row) return { attempted: false, ok: true, canonical: true };
  const kind = String(row.kind ?? '');
  if (kind !== 'produto' && kind !== 'total') return { attempted: false, ok: true, canonical: true };
  if (!JOE_ERP_KEY) return { attempted: true, ok: false, canonical: false, code: 'ERP_KEY_MISSING' };

  const operationId = String(row.id ?? row.operation_id ?? '');
  const leadId = String(row.lead_id ?? '');
  const amount = Number(row.amount ?? 0);
  if (!/^[0-9a-f-]{36}$/i.test(operationId) || !/^[0-9a-f-]{36}$/i.test(leadId) || !(amount > 0)) {
    return { attempted: true, ok: false, canonical: false, code: 'ERP_SYNC_PAYLOAD_INVALID' };
  }

  // Preflight financeiro: preço deve nascer e bater no ERP antes da materialização.
  if (kind === 'produto') {
    const pricing = await joeCanonicalPricing(row);
    if (!pricing.ok) return pricing;
  }

  const phone = await joePhone(leadId);
  const details = kind === 'total' ? await joeComponentDetails(row.components) : [];
  const payload = {
    operation_id: operationId,
    lead_id: leadId,
    phone,
    kind,
    amount,
    source_tool: String(row.source_tool ?? ''),
    components: row.components ?? {},
    component_details: details,
  };
  const call = async () => joeBaseFetch(`${JOE_ERP_URL}/rest/v1/rpc/fn_joao_lancar_orcamento_v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: JOE_ERP_KEY, authorization: `Bearer ${JOE_ERP_KEY}` },
    body: JSON.stringify({ p_payload: payload }),
  });
  let r = await call();
  if (!r.ok && r.status >= 500) { await new Promise(res => setTimeout(res, 180)); r = await call(); }
  if (!r.ok) {
    console.error(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_FAIL', status: r.status, kind, operation_id: operationId }));
    return { attempted: true, ok: false, canonical: false, code: 'ERP_HTTP_FAIL', status: r.status };
  }
  const out = await r.json().catch(() => null);
  const semanticOk = !!out && out.ok === true;
  const canonical = kind === 'produto' ? semanticOk && out.canonical === true : semanticOk;
  if (!semanticOk || !canonical) {
    const code = String(out?.code ?? (kind === 'produto' ? 'ERP_CANONICAL_PRODUCT_REQUIRED' : 'ERP_SYNC_REJECTED'));
    console.error(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_REJECTED', kind, operation_id: operationId, code, result: out }));
    return { attempted: true, ok: false, canonical, code, result: out };
  }
  console.log(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_SYNC', kind, operation_id: operationId, result: out }));
  return { attempted: true, ok: true, canonical, code: String(out?.code ?? 'OK'), result: out };
}

function joeFailClosed(sync: JoeSyncResult): Response {
  return new Response(JSON.stringify({
    error: 'ERP_CANONICAL_PRODUCT_REQUIRED',
    code: sync.code ?? 'ERP_CANONICAL_PRODUCT_REQUIRED',
    canonical: false,
  }), {
    status: 424,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = joeUrl(input);
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isEmit = method === 'POST' && /\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url);
  const isCompose = method === 'POST' && /\/rest\/v1\/rpc\/fn_compor_total(?:\?|$)/i.test(url);
  if (!isEmit && !isCompose) return joeBaseFetch(input, init);

  const req = await joeBody(input, init);
  const response = await joeBaseFetch(input, init);
  if (!response.ok) return response;
  try {
    const data = joeRow(await response.clone().json());
    const row = data && typeof data === 'object' ? { ...data } : {};
    if (!row.lead_id) row.lead_id = req?.p_lead_id;
    if (isEmit) {
      if (!row.kind) row.kind = req?.p_kind;
      if (!row.amount) row.amount = req?.p_amount;
      if (!row.source_tool) row.source_tool = req?.p_source_tool;
      if (!row.components) row.components = req?.p_components;
    }
    const sync = await joeSync(row);
    if (sync.attempted && !sync.ok) return joeFailClosed(sync);
  } catch (e: any) {
    console.error(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_EXCEPTION', error: String(e?.message ?? e).slice(0, 160) }));
    return joeFailClosed({ attempted: true, ok: false, canonical: false, code: 'ERP_SYNC_EXCEPTION' });
  }
  return response;
};
