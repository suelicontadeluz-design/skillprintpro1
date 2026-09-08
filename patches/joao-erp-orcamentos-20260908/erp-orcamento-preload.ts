declare const Deno: any;

// João -> ERP orçamento v1 — 2026-09-08
// Captura somente autorizações financeiras estruturadas já emitidas pelo core.
// Produto cria proposta; total composto atualiza frete/total. Falha do ERP não altera preço/Pix.
const JOE_MAIN_URL = Deno.env.get('SUPABASE_URL')!;
const JOE_MAIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JOE_ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const JOE_ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const joeBaseFetch = globalThis.fetch.bind(globalThis);

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
async function joeSync(row: any): Promise<void> {
  if (!JOE_ERP_KEY || !row) return;
  const kind = String(row.kind ?? '');
  if (kind !== 'produto' && kind !== 'total') return;
  const operationId = String(row.id ?? row.operation_id ?? '');
  const leadId = String(row.lead_id ?? '');
  const amount = Number(row.amount ?? 0);
  if (!/^[0-9a-f-]{36}$/i.test(operationId) || !/^[0-9a-f-]{36}$/i.test(leadId) || !(amount > 0)) return;
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
    return;
  }
  const out = await r.json().catch(() => null);
  console.log(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_SYNC', kind, operation_id: operationId, result: out }));
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
    await joeSync(row);
  } catch (e: any) {
    console.error(JSON.stringify({ event: 'JOAO_ERP_ORCAMENTO_EXCEPTION', error: String(e?.message ?? e).slice(0, 160) }));
  }
  return response;
};
