import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FRENET_TOKEN_ENVIO =
  Deno.env.get("FRENET_TOKEN_ENVIO") ??
  Deno.env.get("TOKEN_FRENET_ENVIO") ??
  Deno.env.get("FRENET_WHITELABEL_TOKEN") ??
  "";
const FRENET_PARTNER_TOKEN =
  Deno.env.get("FRENET_PARTNER_TOKEN") ??
  Deno.env.get("PARTNER_TOKEN_FRENET") ??
  Deno.env.get("FRENET_X_PARTNER_TOKEN") ??
  "";
const ERP_BRIDGE_URL = "https://ynjsflvdfftcopibzxyo.supabase.co/functions/v1/frenet-logistics-bridge-v1";
const FRENET_BASE = "https://whitelabel.frenet.com.br";
const FRENET_WEBHOOK_TOKEN_VALUE = Deno.env.get("FRENET_WEBHOOK_TOKEN_VALUE") ?? "";
const WEBHOOK_URL = FRENET_WEBHOOK_TOKEN_VALUE
  ? `https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/frenet-tracking-webhook?token=${encodeURIComponent(FRENET_WEBHOOK_TOKEN_VALUE)}`
  : "https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/frenet-tracking-webhook";
const ONECLICK_ENABLED = String(Deno.env.get("FRENET_ONECLICK_ENABLED") ?? "").toLowerCase() === "true";
const ONECLICK_MAX_BRL = Math.max(1, Number(Deno.env.get("FRENET_ONECLICK_MAX_BRL") ?? 100));
const VERSION = "erp-frenet-orders-dispatcher/v4";
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v ?? ""));

async function auth(req: Request) {
  const direct = req.headers.get("authorization") ?? "";
  if (direct === `Bearer ${SERVICE}`) return true;
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
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw: raw.slice(0, 800) }; }
  if (!r.ok || data?.ok !== true) {
    throw Object.assign(new Error(`ERP_BRIDGE_${action}_HTTP_${r.status}`), { detail: data });
  }
  return data?.data ?? data;
}

async function resolveService(envio: any) {
  const snap = envio?.servico_snapshot ?? {};
  const existing = String(snap?.serviceCode ?? "").trim();
  if (existing) {
    return {
      ok: true,
      service_code: existing,
      service_description: String(snap?.serviceDescription ?? ""),
      carrier: String(snap?.carrier ?? ""),
      price: num(snap?.quotedPrice, 0),
      source: "erp_snapshot",
    };
  }

  const to = envio?.destinatario_snapshot ?? {};
  const quoteRef = uuid(envio?.cotacao_ref) ? String(envio.cotacao_ref) : null;
  const { data, error } = await db.rpc("fn_frenet_resolve_service_for_erp_v1", {
    p_phone: String(to?.cellphone ?? to?.phone ?? ""),
    p_cep: String(snap?.recipientZipCode ?? to?.address?.zipCode ?? ""),
    p_service: String(snap?.serviceDescription ?? ""),
    p_price: num(snap?.quotedPrice, 0) > 0 ? num(snap?.quotedPrice) : null,
    p_quote_id: quoteRef,
  });
  if (error || data?.ok !== true) {
    return { ok: false, code: data?.code ?? "SERVICE_RESOLUTION_FAILED", detail: error?.message ?? data };
  }
  return { ...data, source: "canonical_quote_snapshot" };
}

function buildOrders(envio: any, service: any) {
  const to = envio?.destinatario_snapshot ?? {};
  const addr = to?.address ?? {};
  const packages = Array.isArray(envio?.pacotes_snapshot) ? envio.pacotes_snapshot : [];
  const items = Array.isArray(envio?.itens_snapshot) ? envio.itens_snapshot : [];
  if (!packages.length) throw new Error("PACKAGES_REQUIRED");

  const saleKey = String(envio?.venda_id ?? "").replace(/-/g, "").slice(0, 12);
  const totalValue = Math.max(0.01, num(envio?.valor_declarado, 0.01));

  return packages.map((pkg: any, index: number) => {
    const orderId = `SKILLPRINT-${saleKey}-${String(index + 1).padStart(2, "0")}`;
    const qty = Math.max(0, num(pkg?.contentsQuantity, 0));
    const matching = items.find((i: any) => String(i?.produto_nome ?? "") === String(pkg?.productName ?? ""));
    const packageValue = matching && qty > 0
      ? Math.max(0.01, Number((qty * num(matching?.valor_unitario, 0)).toFixed(2)))
      : Number((totalValue / packages.length).toFixed(2));

    const pedido: any = {
      Order: {
        Id: orderId,
        Value: packageValue,
        Created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        UseFrenetRegistration: true,
        Items: [{ ProductName: String(pkg?.productName ?? "Pedido Skillprint").slice(0, 160) }],
        To: {
          Name: String(to?.name ?? "").trim(),
          Email: String(to?.email ?? "").trim(),
          Phone: digits(to?.phone ?? to?.cellphone),
          Cellphone: digits(to?.cellphone ?? to?.phone),
          Document: digits(to?.document),
          Address: {
            ZipCode: digits(addr?.zipCode),
            Street: String(addr?.street ?? "").trim(),
            AddressNumber: String(addr?.number ?? "S/N").trim() || "S/N",
            AddressComplement: String(addr?.complement ?? "").trim(),
            AddressQuarter: String(addr?.quarter ?? "").trim(),
            City: String(addr?.city ?? "").trim(),
            AddressState: String(addr?.state ?? "").trim().toUpperCase(),
          },
        },
      },
      Volumes: {
        Weight: Math.max(0.05, num(pkg?.weightKg, 0.05)),
        Width: Math.max(1, num(pkg?.widthCm, 1)),
        Height: Math.max(1, num(pkg?.heightCm, 1)),
        Length: Math.max(1, num(pkg?.lengthCm, 1)),
        Price: packageValue,
      },
      Quotation: {
        ShippingServiceCode: String(service?.service_code ?? ""),
        Services: { ProtectionAccepted: true },
      },
      TrackingNotificationUrl: WEBHOOK_URL,
      StatusNotificationUrl: WEBHOOK_URL,
    };
    return pedido;
  });
}

function parseProviderItems(raw: any) {
  const list = Array.isArray(raw?.items)
    ? raw.items
    : Array.isArray(raw?.Items)
      ? raw.Items
      : Array.isArray(raw)
        ? raw
        : raw ? [raw] : [];

  return list.map((item: any) => ({
    order_id: String(item?.orderId ?? item?.OrderId ?? item?.order?.id ?? "").trim() || null,
    shipment_id: String(item?.shipmentId ?? item?.ShipmentId ?? item?.id ?? "").trim() || null,
    shipment_status: item?.shipmentStatus ?? item?.ShipmentStatus ?? null,
    tracking_number: String(item?.trackingNumber ?? item?.TrackingNumber ?? "").trim() || null,
    tracking_url: String(item?.trackingUrl ?? item?.TrackingUrl ?? "").trim() || null,
    label_url: String(item?.labelUrl ?? item?.LabelUrl ?? "").trim() || null,
    errors: Array.isArray(item?.errors) ? item.errors : Array.isArray(item?.Errors) ? item.Errors : [],
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", version: VERSION }, 405);
  if (!(await auth(req))) return json({ ok: false, code: "UNAUTHORIZED", version: VERSION }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "DISPATCH").toUpperCase();
  const configured = !!(FRENET_TOKEN_ENVIO && FRENET_PARTNER_TOKEN);

  if (mode === "PROBE") {
    let bridge = false;
    try {
      const p = await erpBridge("probe", {});
      bridge = p?.ok === true || p?.code === "READY";
    } catch {
      bridge = false;
    }
    if (!configured || !bridge) {
      return json({
        ok: false,
        version: VERSION,
        code: !configured ? "FRENET_ORDER_CREDENTIALS_MISSING" : "ERP_BRIDGE_UNAVAILABLE",
        credentials_configured: configured,
        bridge,
      }, 409);
    }

    try {
      const r = await fetch(`${FRENET_BASE}/v1/wallet`, {
        headers: {
          Accept: "application/json",
          token: FRENET_TOKEN_ENVIO,
          "x-partner-token": FRENET_PARTNER_TOKEN,
        },
        signal: AbortSignal.timeout(15000),
      });
      const raw = await r.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      return json({
        ok: r.ok,
        version: VERSION,
        code: r.ok ? "READY" : "FRENET_AUTH_FAILED",
        credentials_configured: true,
        bridge,
        http_status: r.status,
        wallet_reachable: r.ok,
        balance_available: data ? Number(data?.balance ?? data?.Balance ?? NaN) : null,
        label_limit: data ? Number(data?.labelLimit ?? data?.LabelLimit ?? NaN) : null,
        oneclick_enabled: ONECLICK_ENABLED,
        oneclick_max_brl: ONECLICK_MAX_BRL,
      }, r.ok ? 200 : 409);
    } catch (e) {
      return json({
        ok: false,
        version: VERSION,
        code: "FRENET_PROBE_FAILED",
        detail: e instanceof Error ? e.message : String(e),
      }, 502);
    }
  }

  if (mode === "BUY_EXISTING") {
    if (!ONECLICK_ENABLED) {
      return json({ ok: false, code: "ONECLICK_DISABLED", version: VERSION }, 409);
    }

    const shipmentId = String(body?.shipment_id ?? "").replace(/\D/g, "");
    if (!shipmentId) return json({ ok: false, code: "SHIPMENT_ID_REQUIRED", version: VERSION }, 400);

    let current: any = null;
    try {
      const check = await fetch(`${FRENET_BASE}/v1/orders/${encodeURIComponent(shipmentId)}`, {
        headers: {
          Accept: "application/json",
          token: FRENET_TOKEN_ENVIO,
          "x-partner-token": FRENET_PARTNER_TOKEN,
        },
        signal: AbortSignal.timeout(15000),
      });
      current = await check.json().catch(() => null);
      if (!check.ok || !current) return json({ ok: false, code: "SHIPMENT_LOOKUP_FAILED", http_status: check.status, version: VERSION }, 502);
    } catch (e) {
      return json({ ok: false, code: "SHIPMENT_LOOKUP_FAILED", detail: e instanceof Error ? e.message : String(e), version: VERSION }, 502);
    }

    const expectedPrice = Number(current?.quotation?.platformShippingPrice ?? current?.quotation?.shippingPrice ?? 0);
    if (!(expectedPrice > 0) || expectedPrice > ONECLICK_MAX_BRL) {
      return json({
        ok: false,
        code: "ONECLICK_PRICE_OUT_OF_RANGE",
        shipment_id: shipmentId,
        expected_price: expectedPrice,
        max_brl: ONECLICK_MAX_BRL,
        version: VERSION,
      }, 409);
    }

    let response: Response;
    let provider: any = null;
    try {
      response = await fetch(`${FRENET_BASE}/v1/shipments/oneclick`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-printing-format": "A6",
          token: FRENET_TOKEN_ENVIO,
          "x-partner-token": FRENET_PARTNER_TOKEN,
        },
        body: JSON.stringify([{ shipmentId: Number(shipmentId) }]),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await response.text();
      try { provider = raw ? JSON.parse(raw) : null; } catch { provider = { raw: raw.slice(0, 1500) }; }
    } catch (e) {
      return json({ ok: false, code: "ONECLICK_OUTCOME_UNKNOWN", shipment_id: shipmentId, detail: e instanceof Error ? e.message : String(e), version: VERSION }, 502);
    }

    const items = parseProviderItems(provider);
    const item = items[0] ?? null;
    const providerError = item?.errors?.[0] ?? null;
    const shipmentStatus = Number(item?.shipment_status ?? NaN);
    const paid = response.ok && !providerError && [4, 5, 18].includes(shipmentStatus);

    if (item) {
      await erpBridge("tracking", {
        p_payload: {
          OrderId: item.order_id ?? current?.orderId ?? null,
          ShipmentId: item.shipment_id ?? shipmentId,
          ShipmentStatus: Number.isFinite(shipmentStatus) ? shipmentStatus : null,
          TrackingNumber: item.tracking_number,
          TrackingUrl: item.tracking_url,
          LabelUrl: item.label_url,
          EventType: null,
        },
      }).catch(() => null);
    }

    return json({
      ok: paid,
      code: paid ? "ONECLICK_PAID" : "ONECLICK_NOT_PAID",
      shipment_id: item?.shipment_id ?? shipmentId,
      order_id: item?.order_id ?? current?.orderId ?? null,
      shipment_status: Number.isFinite(shipmentStatus) ? shipmentStatus : null,
      expected_price: expectedPrice,
      label_url: item?.label_url ?? null,
      tracking_url: item?.tracking_url ?? null,
      tracking_number: item?.tracking_number ?? null,
      provider_error: providerError,
      http_status: response.status,
      version: VERSION,
    }, paid ? 200 : 409);
  }

  if (mode === "CANCEL_SHIPMENT") {
    const shipmentId = String(body?.shipment_id ?? "").replace(/\D/g, "");
    if (!shipmentId) return json({ ok: false, code: "SHIPMENT_ID_REQUIRED", version: VERSION }, 400);

    const response = await fetch(`${FRENET_BASE}/v1/shipments/${encodeURIComponent(shipmentId)}/cancel`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        token: FRENET_TOKEN_ENVIO,
        "x-partner-token": FRENET_PARTNER_TOKEN,
      },
      signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    let provider: any = null;
    try { provider = raw ? JSON.parse(raw) : null; } catch { provider = { raw: raw.slice(0, 1000) }; }

    if (response.ok) {
      await erpBridge("tracking", {
        p_payload: {
          ShipmentId: shipmentId,
          ShipmentStatus: 7,
          EventType: 7,
          EventDescription: "Cancelamento solicitado no teste controlado",
        },
      }).catch(() => null);
    }

    return json({
      ok: response.ok,
      code: response.ok ? "SHIPMENT_CANCEL_REQUESTED" : "SHIPMENT_CANCEL_FAILED",
      shipment_id: shipmentId,
      http_status: response.status,
      provider,
      version: VERSION,
    }, response.ok ? 200 : 409);
  }

  if (mode !== "DISPATCH") return json({ ok: false, code: "MODE_NOT_ALLOWED", version: VERSION }, 400);
  if (!configured) return json({ ok: false, code: "FRENET_ORDER_CREDENTIALS_MISSING", version: VERSION }, 503);

  const limit = Math.max(1, Math.min(Number(body?.limit ?? 5), 10));
  const worker = `${VERSION}:${crypto.randomUUID()}`;

  let envios: any[] = [];
  try {
    const claimed = await erpBridge("claim", { p_worker: worker, p_limit: limit });
    envios = Array.isArray(claimed) ? claimed : [];
  } catch (e) {
    return json({ ok: false, code: "CLAIM_FAILED", version: VERSION, detail: e instanceof Error ? e.message : String(e) }, 502);
  }

  const summary: any = { claimed: envios.length, created: 0, failed: 0, unknown: 0, items: [] };

  for (const envio of envios) {
    const service = await resolveService(envio);
    if (service?.ok !== true || !String(service?.service_code ?? "").trim()) {
      const fail = await erpBridge("fail", {
        p_envio_id: envio.envio_id,
        p_worker: worker,
        p_error: `SERVICO_FRENET_NAO_RESOLVIDO:${String(service?.code ?? "UNKNOWN")}`,
        p_provider_response: { version: VERSION, service_resolution: service },
        p_retryable: false,
        p_outcome_unknown: false,
      }).catch(() => null);
      summary.failed++;
      summary.items.push({ envio_id: envio.envio_id, ok: false, code: "SERVICO_FRENET_NAO_RESOLVIDO", result: fail });
      continue;
    }

    let orders: any[];
    try {
      orders = buildOrders(envio, service);
    } catch (e) {
      const fail = await erpBridge("fail", {
        p_envio_id: envio.envio_id,
        p_worker: worker,
        p_error: `PAYLOAD_INVALID:${e instanceof Error ? e.message : String(e)}`,
        p_provider_response: { version: VERSION },
        p_retryable: false,
        p_outcome_unknown: false,
      }).catch(() => null);
      summary.failed++;
      summary.items.push({ envio_id: envio.envio_id, ok: false, code: "PAYLOAD_INVALID", result: fail });
      continue;
    }

    const orderValue = orders.reduce((sum:any, x:any) => sum + Number(x?.Order?.Value ?? 0), 0);
    const useOneclick = ONECLICK_ENABLED && orderValue <= ONECLICK_MAX_BRL;
    let response: Response;
    let provider: any = null;
    try {
      response = await fetch(`${FRENET_BASE}${useOneclick ? "/v1/orders/oneclick" : "/v1/orders"}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          token: FRENET_TOKEN_ENVIO,
          "x-partner-token": FRENET_PARTNER_TOKEN,
        },
        body: JSON.stringify(orders),
        signal: AbortSignal.timeout(20000),
      });
      const rawText = await response.text();
      try { provider = rawText ? JSON.parse(rawText) : null; }
      catch { provider = { raw: rawText.slice(0, 1500) }; }
    } catch (e) {
      await erpBridge("fail", {
        p_envio_id: envio.envio_id,
        p_worker: worker,
        p_error: `FRENET_OUTCOME_UNKNOWN:${e instanceof Error ? e.message : String(e)}`,
        p_provider_response: { version: VERSION, service },
        p_retryable: false,
        p_outcome_unknown: true,
      }).catch(() => null);
      summary.unknown++;
      summary.items.push({ envio_id: envio.envio_id, ok: false, code: "FRENET_OUTCOME_UNKNOWN" });
      continue;
    }

    const providerItems = parseProviderItems(provider);
    const providerErrors = providerItems.flatMap((x: any) => x.errors ?? []);
    const validShipments = providerItems.filter((x: any) => x.order_id || x.shipment_id);
    const statusesOk = !useOneclick || validShipments.every((x:any) => [4,5,18].includes(Number(x.shipment_status)));
    const completeResponse = response.ok
      && providerErrors.length === 0
      && validShipments.length === orders.length
      && statusesOk;

    if (!completeResponse) {
      const partialExternalEffect = validShipments.length > 0;
      const retryable = !partialExternalEffect && response.status >= 500;
      const fail = await erpBridge("fail", {
        p_envio_id: envio.envio_id,
        p_worker: worker,
        p_error: partialExternalEffect
          ? (useOneclick ? "FRENET_ONECLICK_PARTIAL_OR_PAYMENT_FAILURE" : "FRENET_PARTIAL_ORDER_CREATION")
          : `FRENET_HTTP_${response.status}`,
        p_provider_response: {
          version: VERSION,
          http_status: response.status,
          service,
          provider,
          requested_orders: orders.map((x: any) => x?.Order?.Id),
        },
        p_retryable: retryable,
        p_outcome_unknown: partialExternalEffect,
      }).catch(() => null);
      if (partialExternalEffect) summary.unknown++; else summary.failed++;
      summary.items.push({
        envio_id: envio.envio_id,
        ok: false,
        code: partialExternalEffect ? (useOneclick ? "FRENET_ONECLICK_PARTIAL_OR_PAYMENT_FAILURE" : "FRENET_PARTIAL_ORDER_CREATION") : `FRENET_HTTP_${response.status}`,
        result: fail,
      });
      continue;
    }

    const shipments = validShipments.map((x: any, index: number) => ({
      ...x,
      order_id: x.order_id ?? orders[index]?.Order?.Id ?? null,
      service_code: service.service_code,
      service_description: service.service_description,
      carrier: service.carrier,
      posted: [5, 18].includes(Number(x.shipment_status)),
    }));

    const complete = await erpBridge("complete", {
      p_envio_id: envio.envio_id,
      p_worker: worker,
      p_shipments: shipments,
      p_provider_response: {
        version: VERSION,
        http_status: response.status,
        service,
        provider,
      },
    });

    if (useOneclick) {
      for (const s of shipments) {
        await erpBridge("tracking", {
          p_payload: {
            OrderId: s.order_id,
            ShipmentId: s.shipment_id,
            ShipmentStatus: Number(s.shipment_status),
            TrackingNumber: s.tracking_number,
            TrackingUrl: s.tracking_url,
            LabelUrl: s.label_url,
            EventType: null,
          },
        }).catch(() => null);
      }
    }

    summary.created++;
    summary.items.push({
      envio_id: envio.envio_id,
      ok: true,
      mode: useOneclick ? "ONECLICK" : "ORDER_ONLY",
      shipment_count: shipments.length,
      complete,
    });
  }

  return json({ ok: true, version: VERSION, worker, summary });
});