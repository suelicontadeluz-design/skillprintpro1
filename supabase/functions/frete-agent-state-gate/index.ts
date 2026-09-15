import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function sessionId(leadId: unknown, phone: unknown) {
  const lead = String(leadId ?? "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lead)) return `lead:${lead}`;
  const p = digits(phone);
  return p.length >= 10 && p.length <= 15 ? `phone:${p}` : "";
}
async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`RPC_${name}_HTTP_${r.status}:${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  if (!SERVICE_KEY || !SUPABASE_URL) return response({ ok: false, code: "SERVICE_CONFIGURATION_MISSING" }, 503);

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "transition").toLowerCase();
  const sid = String(body?.session_id ?? "").trim() || sessionId(body?.lead_id, body?.phone);
  if (!sid) return response({ ok: false, code: "SESSION_ID_REQUIRED" }, 400);

  try {
    if (mode === "current") {
      const current = await rpc("fn_joao_shipping_state_current_v1", { p_session_id: sid });
      return response({ ok: true, mode, session_id: sid, current, external_effect: false });
    }
    if (mode === "render") {
      const render = await rpc("fn_joao_shipping_render_v1", { p_session_id: sid });
      return response({ ok: true, mode, session_id: sid, render, external_effect: false });
    }
    if (mode !== "transition") return response({ ok: false, code: "MODE_NOT_ALLOWED" }, 400);

    const expected = Number(body?.expected_version);
    if (!Number.isInteger(expected) || expected < 0) return response({ ok: false, code: "EXPECTED_VERSION_REQUIRED" }, 400);
    const proposal = body?.proposal;
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return response({ ok: false, code: "PROPOSAL_REQUIRED" }, 400);

    const transition = await rpc("fn_joao_shipping_state_apply_v1", {
      p_session_id: sid,
      p_expected_version: expected,
      p_proposal: proposal,
      p_lead_id: body?.lead_id ?? null,
      p_phone: body?.phone ?? null,
      p_source_turn_id: body?.source_turn_id ?? null,
      p_source_replay_case_id: body?.source_replay_case_id ?? null,
      p_is_replay: body?.is_replay === true,
      p_as_of: body?.as_of ?? new Date().toISOString(),
    });

    if (transition?.ok !== true) {
      return response({ ok: false, mode, session_id: sid, transition, external_effect: false }, 409);
    }
    const render = await rpc("fn_joao_shipping_render_v1", { p_session_id: sid });
    return response({ ok: true, mode, session_id: sid, transition, render, external_effect: false });
  } catch (e) {
    console.error(JSON.stringify({ event: "FRETE_AGENT_STATE_GATE_ERROR", detail: String(e).slice(0, 500), session_id: sid }));
    return response({ ok: false, code: "STATE_GATE_INTERNAL_ERROR", detail: String(e).slice(0, 240) }, 500);
  }
});
