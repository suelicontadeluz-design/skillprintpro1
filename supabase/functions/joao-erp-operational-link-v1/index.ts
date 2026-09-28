const MAIN_URL = Deno.env.get("SUPABASE_URL")!;
const MAIN_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ERP_URL = Deno.env.get("ERP_URL") ?? "https://ynjsflvdfftcopibzxyo.supabase.co";
const ERP_SERVICE = Deno.env.get("ERP_SERVICE_KEY") ?? Deno.env.get("ERP_SERVICE_ROLE_KEY") ?? "";
const VERSION = "joao-erp-operational-link/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function mainRpc(name: string, body: unknown) {
  const response = await fetch(`${MAIN_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: MAIN_SERVICE,
      authorization: `Bearer ${MAIN_SERVICE}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

async function isInternal(req: Request) {
  if (req.headers.get("authorization") === `Bearer ${MAIN_SERVICE}`) return true;
  const cronToken = req.headers.get("x-cron-secret") ?? "";
  if (!cronToken) return false;
  return (await mainRpc("fn_edge_cron_auth_ok_v1", { p_token: cronToken })) === true;
}

async function erpSaleExists(vendasId: string) {
  const response = await fetch(
    `${ERP_URL}/rest/v1/vendas?select=id,status&id=eq.${encodeURIComponent(vendasId)}&limit=2`,
    {
      headers: { apikey: ERP_SERVICE, authorization: `Bearer ${ERP_SERVICE}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`erp_read_${response.status}`);
  return Array.isArray(data) ? data : [];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", version: VERSION }, 405);
  if (!(await isInternal(req))) return json({ ok: false, code: "UNAUTHORIZED", version: VERSION }, 401);
  if (!ERP_SERVICE) return json({ ok: false, code: "ERP_CREDENTIAL_MISSING", version: VERSION }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, code: "INVALID_JSON", version: VERSION }, 400); }

  const orcamentoId = String(body.orcamento_id ?? "").trim();
  const vendasId = String(body.vendas_id ?? "").trim();
  if (!UUID.test(orcamentoId)) return json({ ok: false, code: "ORCAMENTO_ID_INVALID", version: VERSION }, 400);
  if (!UUID.test(vendasId)) return json({ ok: false, code: "ERP_VENDAS_ID_INVALID", version: VERSION }, 400);

  let sales: Array<{ id?: string; status?: string }>;
  try { sales = await erpSaleExists(vendasId); }
  catch { return json({ ok: false, code: "ERP_VALIDATION_UNAVAILABLE", version: VERSION }, 503); }

  if (sales.length !== 1 || sales[0]?.id !== vendasId) {
    return json({ ok: false, code: "ERP_ORDER_NOT_FOUND", version: VERSION }, 404);
  }
  if (sales[0]?.status === "cancelada") {
    return json({ ok: false, code: "ERP_ORDER_NOT_LINKABLE", version: VERSION }, 409);
  }

  const response = await fetch(`${MAIN_URL}/rest/v1/rpc/fn_vincular_orcamento_operacional_v1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: MAIN_SERVICE,
      authorization: `Bearer ${MAIN_SERVICE}`,
    },
    body: JSON.stringify({ p_orcamento_id: orcamentoId, p_vendas_id: vendasId }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return json({ ok: false, code: "MAIN_WRITER_UNAVAILABLE", version: VERSION }, 503);

  return json({ ok: result?.success === true, ...result, version: VERSION });
});
