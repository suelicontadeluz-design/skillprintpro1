const MAIN_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERSION = "joao-cortex-revision-stage/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function rpc(name: string, body: unknown) {
  const response = await fetch(`${MAIN_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, data };
}

async function internal(req: Request) {
  if (req.headers.get("authorization") === `Bearer ${SERVICE}`) return true;
  const token = req.headers.get("x-cron-secret") ?? "";
  return token !== "" && (await rpc("fn_edge_cron_auth_ok_v1", { p_token: token })).data === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", version: VERSION }, 405);
  if (!(await internal(req))) return json({ ok: false, code: "UNAUTHORIZED", version: VERSION }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, code: "INVALID_JSON", version: VERSION }, 400); }
  const orcamentoId = String(body.orcamento_id ?? "").trim();
  if (!UUID.test(orcamentoId)) return json({ ok: false, code: "ORCAMENTO_ID_INVALID", version: VERSION }, 400);

  const staged = await rpc("fn_cortex_erp_stage_revision_v1", {
    p_orcamento_id: orcamentoId,
    p_change_kind: body.change_kind,
    p_before_snapshot: body.before_snapshot,
    p_after_snapshot: body.after_snapshot,
    p_review_context: body.review_context ?? {},
    p_operations: body.operations ?? [],
  });
  if (!staged.ok) return json({ ok: false, code: "STAGING_RPC_REJECTED", version: VERSION }, 422);
  return json({ ok: staged.data?.success === true, ...staged.data, version: VERSION });
});
