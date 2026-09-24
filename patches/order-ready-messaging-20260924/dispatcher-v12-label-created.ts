import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";
const ERP_BRIDGE_URL = "https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/order-ready-message-bridge-v1";
const VERSION = "order-ready-zapi-dispatcher/v12";
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function digits(v: unknown) { return String(v ?? "").replace(/\D/g, ""); }
function normalizePhone(v: unknown) {
  let p = digits(v);
  if (p.length === 10 || p.length === 11) p = "55" + p;
  return p;
}
function money(v: unknown) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function firstName(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s.split(/\s+/)[0] : "cliente";
}
async function auth(req: Request) {
  const direct = req.headers.get("authorization") ?? "";
  if (direct === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;
  const token = req.headers.get("x-cron-secret") ?? req.headers.get("x-cortex-internal-secret") ?? "";
  if (!token) return false;
  const { data, error } = await db.rpc("fn_edge_cron_auth_ok_v1", { p_token: token });
  return !error && data === true;
}
async function bridgeToken() {
  const { data, error } = await db.rpc("fn_order_ready_erp_bridge_token_v1");
  if (error || !data) throw new Error("ERP_BRIDGE_TOKEN_MISSING");
  return String(data);
}
async function erpBridge(action: string, args: Record<string, unknown> = {}) {
  const token = await bridgeToken();
  const r = await fetch(ERP_BRIDGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, args }),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await r.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw: raw.slice(0, 500) }; }
  if (!r.ok || data?.ok !== true) throw Object.assign(new Error(`ERP_BRIDGE_${action}_HTTP_${r.status}`), { detail: data });
  return data?.data ?? data;
}
function buildMessage(event: any) {
  const p = event?.payload ?? {};
  const nome = firstName(p.customer_name);
  const numero = String(p.sale_number ?? "").trim();
  const pedido = numero ? `pedido #${numero}` : "pedido";
  const shipping = String(p.shipping_type ?? "");
  const saldo = p?.financial?.saldo_pendente ?? 0;

  if (event.event_type === "message.order_ready.payment_due") {
    if (shipping === "retirada") {
      return `*João Barros:*\n${nome}, seu pedido ficou pronto. Identificamos um saldo pendente de *${money(saldo)}*. Assim que o pagamento for identificado, liberamos a retirada.`;
    }
    return `*João Barros:*\n${nome}, seu pedido ficou pronto. Identificamos um saldo pendente de *${money(saldo)}*. Assim que o pagamento for identificado, liberamos o envio.`;
  }
  if (event.event_type === "message.order_partial.release") {
    const rawLines = Array.isArray(p.lines) ? p.lines : [];
    const fmtQty = (v: unknown) => {
      const n = Number(v ?? 0);
      return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    };
    const fmtUnit = (v: unknown) => String(v ?? "unidade").replace(/_/g, " ");
    const fmtAttrs = (v: unknown) => {
      if (!v || typeof v !== "object" || Array.isArray(v)) return "";
      const parts = Object.entries(v as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`);
      return parts.length ? ` (${parts.join(" · ")})` : "";
    };
    const linhas = rawLines
      .map((line: any) => `• ${fmtQty(line?.quantidade)} ${fmtUnit(line?.unidade)} — ${String(line?.produto_nome ?? "Item")}${fmtAttrs(line?.atributos)}`)
      .join("\n");
    return `*João Barros:*\n${nome}, uma parte do seu pedido ficou pronta:\n\n${linhas}\n\nO restante continua em produção. Fale com a gente para combinar a retirada.`;
  }

  if (event.event_type === "message.shipping_label.created") {
    const tracking = String(p.tracking_code ?? "").trim();
    const carrierRaw = String(p.carrier_name ?? "").trim();
    const carrier = /correios/i.test(carrierRaw) || /empresa brasileira de correios/i.test(carrierRaw) ? "Correios" : carrierRaw;
    const carrierLine = carrier ? `\nTransportadora: ${carrier}` : "";
    const trackingLine = tracking ? `\n\n*Código de rastreio: ${tracking}*` : "";
    return `*João Barros:*\n${nome}, a etiqueta do seu pedido foi gerada.${carrierLine}${trackingLine}\n\nO pedido ainda aguarda postagem. Assim que for postado, eu te aviso.\n\n*Pedido N° ${numero}*`;
  }

  if (event.event_type === "message.order_shipped.tracking") {
    const tracking = String(p.tracking_code ?? "").trim();
    const carrierRaw = String(p.carrier_name ?? "").trim();
    const carrier = /correios/i.test(carrierRaw) || /empresa brasileira de correios/i.test(carrierRaw) ? "Correios" : carrierRaw;
    const carrierLine = carrier ? `\nTransportadora: ${carrier}` : "";
    const trackingLine = tracking ? `\n\n*Código de rastreio: ${tracking}*` : "";
    return `*João Barros:*\n${nome}, seu pedido foi enviado.${carrierLine}${trackingLine}\n\n*Pedido N° ${numero}*`;
  }

  if (event.event_type === "message.order_ready.release") {
    if (shipping === "retirada") {
      return `*João Barros:*\n${nome}, seu pedido ficou pronto e o pagamento está confirmado. Ele está disponível para retirada. Informe o número do pedido para retirá-lo.\n\n*Pedido N° ${numero}*`;
    }
    return `*João Barros:*\n${nome}, seu pedido ficou pronto e o pagamento está confirmado. Ele está liberado para seguir para envio.\n\n*Pedido N° ${numero}*`;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", version: VERSION }, 405);
  if (!(await auth(req))) return json({ ok: false, error: "unauthorized", version: VERSION }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "DISPATCH").toUpperCase();

  if (mode === "PROBE") {
    const env = { zapi: !!(ZAPI_INSTANCE_ID && ZAPI_TOKEN && ZAPI_CLIENT_TOKEN) };
    let bridge = false;
    try {
      const p = await erpBridge("probe", {});
      bridge = p?.ok === true || p?.code === "READY";
    } catch {
      bridge = false;
    }
    if (!env.zapi || !bridge) return json({ ok: false, version: VERSION, env, bridge }, 409);
    try {
      const r = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(ZAPI_TOKEN)}/status`, {
        headers: { "Client-Token": ZAPI_CLIENT_TOKEN },
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json().catch(() => ({}));
      return json({ ok: r.ok && data?.connected === true, version: VERSION, env, bridge, connected: data?.connected === true, smartphone_connected: data?.smartphoneConnected === true, http_status: r.status }, r.ok && data?.connected === true ? 200 : 409);
    } catch (e) {
      return json({ ok: false, version: VERSION, env, bridge, error: "zapi_probe_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  const limit = Math.max(1, Math.min(Number(body?.limit ?? 10), 20));
  const worker = `${VERSION}:${crypto.randomUUID()}`;
  let events: any[] = [];
  try {
    const claimed = await erpBridge("claim", { p_worker: worker, p_limit: limit });
    events = Array.isArray(claimed) ? claimed : [];
  } catch (e) {
    return json({ ok: false, version: VERSION, error: "claim_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }

  const summary: any = { claimed: events.length, sent: 0, failed: 0, dead: 0, items: [] };

  for (const event of events) {
    const message = buildMessage(event);
    const phone = normalizePhone(event?.payload?.phone);

    if (!message || event.event_type === "message.order_ready.review_required") {
      const fail = await erpBridge("fail", {
        p_event_id: event.id,
        p_worker: worker,
        p_error: "MANUAL_FINANCIAL_REVIEW_REQUIRED",
        p_provider_response: { version: VERSION },
        p_outcome_unknown: true,
      }).catch(() => null);
      summary.dead++;
      summary.items.push({ id: event.id, ok: false, code: "MANUAL_FINANCIAL_REVIEW_REQUIRED", result: fail });
      continue;
    }

    if (!/^55\d{10,11}$/.test(phone)) {
      const fail = await erpBridge("fail", {
        p_event_id: event.id,
        p_worker: worker,
        p_error: "INVALID_PHONE",
        p_provider_response: { version: VERSION, phone_suffix: phone.slice(-4) },
        p_outcome_unknown: true,
      }).catch(() => null);
      summary.dead++;
      summary.items.push({ id: event.id, ok: false, code: "INVALID_PHONE", result: fail });
      continue;
    }

    let response: Response;
    let provider: any = {};
    try {
      response = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(ZAPI_TOKEN)}/send-text`, {
        method: "POST",
        headers: { "content-type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN },
        body: JSON.stringify({ phone, message }),
        signal: AbortSignal.timeout(15000),
      });
      const raw = await response.text();
      try { provider = raw ? JSON.parse(raw) : {}; } catch { provider = { raw: raw.slice(0, 500) }; }
    } catch (e) {
      await erpBridge("fail", {
        p_event_id: event.id,
        p_worker: worker,
        p_error: `ZAPI_OUTCOME_UNKNOWN:${e instanceof Error ? e.message : String(e)}`,
        p_provider_response: { version: VERSION },
        p_outcome_unknown: true,
      }).catch(() => null);
      summary.dead++;
      summary.items.push({ id: event.id, ok: false, code: "ZAPI_OUTCOME_UNKNOWN" });
      continue;
    }

    const providerId = provider?.messageId ?? provider?.zaapId ?? provider?.id ?? null;
    if (!response.ok || !providerId) {
      const unknown = response.ok && !providerId;
      const fail = await erpBridge("fail", {
        p_event_id: event.id,
        p_worker: worker,
        p_error: unknown ? "ZAPI_2XX_NO_PROVIDER_ID" : `ZAPI_HTTP_${response.status}`,
        p_provider_response: { version: VERSION, http_status: response.status, provider },
        p_outcome_unknown: unknown,
      }).catch(() => null);
      if (unknown) summary.dead++; else summary.failed++;
      summary.items.push({ id: event.id, ok: false, code: unknown ? "ZAPI_2XX_NO_PROVIDER_ID" : `ZAPI_HTTP_${response.status}`, result: fail });
      continue;
    }

    const complete = await erpBridge("complete", {
      p_event_id: event.id,
      p_worker: worker,
      p_provider_message_id: String(providerId),
      p_provider_response: { version: VERSION, http_status: response.status, provider },
    });
    summary.sent++;
    summary.items.push({ id: event.id, ok: true, provider_message_id: String(providerId), complete });
  }

  return json({ ok: true, version: VERSION, worker, summary });
});
