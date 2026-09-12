declare const Deno: any;

// João DTF UV financial operation idempotency v1 — 12/09/2026
// Fecha o loop real: supersede/retry não pode emitir N operações financeiras idênticas
// antes de calcular o frete. Reutiliza apenas operação PRODUTO UV ativa, recente, não usada,
// semanticamente idêntica e já comprovada por receipt ERP canônico.
// Qualquer divergência => não interfere e deixa o caminho anterior executar normalmente.

const UVI_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const UVI_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const UVI_VERSION = 'joao-uv-operation-idempotency/v1';
const UVI_CONFIG_KEY = 'joao_uv_financial_op_idempotency_v1_ativo';
const UVI_LOOKBACK_MS = 5 * 60 * 1000;
const uviBaseFetch = globalThis.fetch.bind(globalThis);
let uviCfgAt = 0;
let uviCfg = false;

function uviUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function uviBody(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  let raw = '';
  if (typeof init?.body === 'string') raw = init.body;
  else if (init?.body != null) raw = String(init.body);
  else if (typeof Request !== 'undefined' && input instanceof Request) {
    try { raw = await input.clone().text(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function uviNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function uviNorm(v: any): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function uviConsumption(c: any): number | null {
  return uviNum(c?.consumo_m ?? c?.metros);
}
function uviSameOptional(a: any, b: any): boolean {
  const aa = a == null || String(a).trim() === '' ? null : uviNorm(a);
  const bb = b == null || String(b).trim() === '' ? null : uviNorm(b);
  if (aa === null || bb === null) return true;
  return aa === bb;
}
function uviSemanticMatch(existing: any, req: any): boolean {
  const ec = existing?.components ?? {};
  const rc = req?.p_components ?? {};
  const ea = uviNum(existing?.amount);
  const ra = uviNum(req?.p_amount);
  const em = uviConsumption(ec);
  const rm = uviConsumption(rc);
  if (ea == null || ra == null || Math.abs(ea - ra) > 0.01) return false;
  if (em == null || rm == null || em <= 0 || rm <= 0 || Math.abs(em - rm) > 0.0005) return false;

  const eq = uviNum(ec?.quantidade);
  const rq = uviNum(rc?.quantidade);
  if (eq != null && rq != null && Math.abs(eq - rq) > 0.0001) return false;
  if (!uviSameOptional(ec?.adesivo_cm, rc?.adesivo_cm)) return false;
  if (!uviSameOptional(ec?.degrau, rc?.degrau)) return false;
  return true;
}
function uviReceiptConsumption(snapshot: any): number | null {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  if (!items.length) return null;
  let total = 0;
  for (const item of items) {
    const isUv = String(item?.produto_id ?? '') === 'd48addf9-2b53-482f-8f28-1dfc7ea7c123' || /dtf\s*uv/i.test(String(item?.descricao ?? ''));
    const m = uviNum(item?.uv_consumo_m);
    if (!isUv || m == null || m <= 0) return null;
    total += m;
  }
  return Number(total.toFixed(4));
}
async function uviEnabled(): Promise<boolean> {
  if (Date.now() - uviCfgAt < 15000) return uviCfg;
  uviCfgAt = Date.now();
  try {
    const r = await uviBaseFetch(`${UVI_URL}/rest/v1/sistema_config?select=valor_bool&chave=eq.${encodeURIComponent(UVI_CONFIG_KEY)}&limit=1`, {
      headers: { apikey: UVI_SERVICE, authorization: `Bearer ${UVI_SERVICE}` },
      signal: AbortSignal.timeout(1200),
    });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows.length) uviCfg = rows[0]?.valor_bool === true;
    }
  } catch {}
  return uviCfg;
}
async function uviCanonicalReceipt(operationId: string, expectedAmount: number, expectedMeters: number): Promise<any | null> {
  const q = `${UVI_URL}/rest/v1/joao_erp_proposal_receipts_v1?select=receipt_id,operation_id,proposal_total_brl,canonical,snapshot,created_at&operation_id=eq.${encodeURIComponent(operationId)}&canonical=eq.true&order=created_at.desc&limit=1`;
  try {
    const r = await uviBaseFetch(q, {
      headers: { apikey: UVI_SERVICE, authorization: `Bearer ${UVI_SERVICE}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const receipt = Array.isArray(rows) ? rows[0] : null;
    if (!receipt) return null;
    const total = uviNum(receipt?.proposal_total_brl);
    const meters = uviReceiptConsumption(receipt?.snapshot);
    if (total == null || Math.abs(total - expectedAmount) > 0.01) return null;
    if (meters == null || Math.abs(meters - expectedMeters) > 0.0005) return null;
    return receipt;
  } catch { return null; }
}
async function uviFindReusable(req: any): Promise<{ operation: any; receipt: any } | null> {
  const leadId = String(req?.p_lead_id ?? '');
  const amount = uviNum(req?.p_amount);
  const meters = uviConsumption(req?.p_components ?? {});
  if (!/^[0-9a-f-]{36}$/i.test(leadId) || amount == null || amount <= 0 || meters == null || meters <= 0) return null;

  const since = new Date(Date.now() - UVI_LOOKBACK_MS).toISOString();
  const q = `${UVI_URL}/rest/v1/operacoes_financeiras?select=*&lead_id=eq.${encodeURIComponent(leadId)}&kind=eq.produto&status=eq.ativa&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&created_at=gte.${encodeURIComponent(since)}&source_tool=in.(calcular_rendimento_uv,calcular_dtf_uv_metro)&order=created_at.desc&limit=20`;
  try {
    const r = await uviBaseFetch(q, {
      headers: { apikey: UVI_SERVICE, authorization: `Bearer ${UVI_SERVICE}` },
      signal: AbortSignal.timeout(1700),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    for (const op of (Array.isArray(rows) ? rows : [])) {
      if (!uviSemanticMatch(op, req)) continue;
      const receipt = await uviCanonicalReceipt(String(op.id), amount, meters);
      if (receipt) return { operation: op, receipt };
    }
  } catch {}
  return null;
}
async function uviAudit(reused: { operation: any; receipt: any }, req: any) {
  try {
    await uviBaseFetch(`${UVI_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: UVI_SERVICE, authorization: `Bearer ${UVI_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({
        agente_slug: 'agente-noturno',
        funcao: 'joao-uv-operation-idempotency',
        versao: UVI_VERSION,
        nivel: 'info',
        categoria: 'financial_runtime',
        evento: 'uv_financial_operation_reused',
        status: 'applied',
        mensagem: 'retry_sem_nova_operacao',
        lead_id: String(req?.p_lead_id ?? ''),
        detalhe: {
          operation_id: reused.operation?.id ?? null,
          receipt_id: reused.receipt?.receipt_id ?? null,
          source_tool: req?.p_source_tool ?? null,
          amount: req?.p_amount ?? null,
          consumo_m: uviConsumption(req?.p_components ?? {}),
          created_at: reused.operation?.created_at ?? null,
        },
      }),
      signal: AbortSignal.timeout(1200),
    });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = uviUrl(input);
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isEmit = method === 'POST' && /\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url);
  if (!isEmit || !(await uviEnabled())) return uviBaseFetch(input, init);

  const req = await uviBody(input, init);
  const sourceTool = String(req?.p_source_tool ?? '').toLowerCase();
  if (String(req?.p_kind ?? '') !== 'produto' || !['calcular_rendimento_uv', 'calcular_dtf_uv_metro'].includes(sourceTool)) {
    return uviBaseFetch(input, init);
  }

  const reused = await uviFindReusable(req);
  if (!reused) return uviBaseFetch(input, init);

  void uviAudit(reused, req);
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-cortex-uv-operation-idempotency': UVI_VERSION,
  });
  return new Response(JSON.stringify(reused.operation), { status: 200, headers });
};
