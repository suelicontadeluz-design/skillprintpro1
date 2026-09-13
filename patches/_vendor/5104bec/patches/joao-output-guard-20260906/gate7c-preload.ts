// Gate 7C Commercial Execution Bridge preload v1.
// João cognition/source remains the exact static production pin imported by index.ts.
// This module only hardens lock failure, routes the private prompt manifesto write through
// the public audited RPC, and intercepts an explicitly ARMED lead's valid PIX send.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WRAPPER_VERSION = 'gate7c-bridge-wrapper/v1';
const COGNITION_AGENT_VERSION = 'agente-noturno-v4.37.4';
const SOURCE_PIN = '5a533d7ff8ccf5ed5eb258dff9221f4b6c3104c6';

const originalFetch = globalThis.fetch.bind(globalThis);
const locallyFencedUntil = new Map<string, number>();

function normalizePhone(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function uncertainNoFallback(reason: string): Response {
  return jsonResponse({ bridge_state: 'incerto_fail_closed', reason }, 200);
}

async function rpc(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await originalFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${name}:${res.status}:${String(text).slice(0,300)}`);
  return data;
}

async function maybeRoutePromptManifesto(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/rest/v1/prompt_manifesto_joao')) return null;

  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const headers = new Headers(request?.headers || undefined);
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => headers.set(k, v));
  }
  const profile = String(headers.get('content-profile') || headers.get('accept-profile') || '').toLowerCase();
  const method = String(init?.method || request?.method || 'GET').toUpperCase();
  if (profile !== 'auditoria' || method !== 'POST') return null;

  let bodyText = '';
  if (typeof init?.body === 'string') bodyText = init.body;
  else if (init?.body != null) bodyText = String(init.body);
  else if (request) bodyText = await request.clone().text();

  let parsed: any;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; }
  catch { return jsonResponse({ message: 'prompt_manifesto_invalid_json' }, 400); }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    return jsonResponse({ message: 'prompt_manifesto_expected_single_row' }, 400);
  }

  try {
    await rpc('fn_log_prompt_manifesto_joao', { p_row: rows[0] });
  } catch (e: any) {
    return jsonResponse({ message: String(e?.message || e).slice(0,300) }, 500);
  }

  const prefer = String(headers.get('prefer') || '').toLowerCase();
  if (prefer.includes('return=representation')) {
    return new Response(JSON.stringify(rows), {
      status: 201,
      headers: { 'content-type': 'application/json', 'content-profile': 'auditoria' }
    });
  }
  return new Response(null, { status: 201 });
}

function extractValidPixPayload(message: string): string | null {
  if (!message || message.length > 1000) return null;
  const start = message.indexOf('000201');
  if (start < 0) return null;
  let pos = start;
  let first = true;
  let payload = '';
  while (pos + 4 <= message.length && pos - start <= 600) {
    const id = message.slice(pos, pos + 2);
    const lenText = message.slice(pos + 2, pos + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenText)) return null;
    const len = Number(lenText);
    const valueStart = pos + 4;
    const valueEnd = valueStart + len;
    if (valueEnd > message.length) return null;
    const value = message.slice(valueStart, valueEnd);
    if (first) {
      if (!(id === '00' && len === 2 && value === '01')) return null;
      first = false;
    }
    if (id === '63') {
      if (len !== 4 || !/^[0-9A-Fa-f]{4}$/.test(value)) return null;
      payload = message.slice(start, valueEnd);
      if (!payload.toUpperCase().includes('BR.GOV.BCB.PIX')) return null;
      const crcInput = message.slice(start, valueStart);
      let crc = 0xFFFF;
      const bytes = new TextEncoder().encode(crcInput);
      for (const b of bytes) {
        crc ^= (b << 8);
        for (let i = 0; i < 8; i++) {
          crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
        }
      }
      const expected = crc.toString(16).toUpperCase().padStart(4, '0');
      return value.toUpperCase() === expected ? payload : null;
    }
    pos = valueEnd;
  }
  return null;
}

function localFenceActive(phone: string): boolean {
  const k = normalizePhone(phone);
  const until = locallyFencedUntil.get(k) || 0;
  if (until <= Date.now()) {
    locallyFencedUntil.delete(k);
    return false;
  }
  return true;
}

function markLocalFence(phone: string): void {
  locallyFencedUntil.set(normalizePhone(phone), Date.now() + 35 * 60_000);
}

function clearLocalFence(phone: string): void {
  locallyFencedUntil.delete(normalizePhone(phone));
}

async function maybeInterceptPix(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) return null;

  let payload: any = {};
  try { payload = JSON.parse(String(init?.body || '{}')); } catch {}
  const phone = normalizePhone(payload?.phone);
  const message = String(payload?.message || '');
  if (!phone) return uncertainNoFallback('gate7c_phone_missing');

  if (localFenceActive(phone)) {
    return uncertainNoFallback('gate7c_fence_active_legacy_send_suppressed');
  }

  const pix = extractValidPixPayload(message);
  if (!pix) return null;

  let state: any;
  try {
    state = await rpc('fn_gate7c_commercial_bridge_session_for_phone_v1', { p_phone: phone });
  } catch (e: any) {
    return uncertainNoFallback(`gate7c_state_lookup_failed:${String(e?.message || e).slice(0,120)}`);
  }

  if (state?.status === 'NOT_ARMED') return null;
  if (state?.status === 'FENCE_ACTIVE') {
    markLocalFence(phone);
    return uncertainNoFallback('gate7c_existing_fence_suppressed_legacy_send');
  }
  if (state?.status !== 'ACTIVE_SESSION' || !state?.session_id) {
    return uncertainNoFallback(`gate7c_armed_without_owned_session:${String(state?.status || 'unknown')}`);
  }

  let prepared: any;
  try {
    prepared = await rpc('fn_gate7c_commercial_bridge_intercept_prepare_v1', {
      p_session_id: state.session_id,
      p_message: message,
      p_cognition_agent_version: COGNITION_AGENT_VERSION,
      p_wrapper_version: WRAPPER_VERSION,
      p_source_pin: SOURCE_PIN,
      p_created_by: 'worker_A'
    });
  } catch (e: any) {
    return uncertainNoFallback(`gate7c_intercept_prepare_failed:${String(e?.message || e).slice(0,120)}`);
  }

  if (prepared?.status !== 'INTERCEPT_PREPARED_EXECUTABLE' || !prepared?.execution_id || !prepared?.fence_id) {
    return uncertainNoFallback('gate7c_intercept_not_executable');
  }
  markLocalFence(phone);

  let queued: any;
  try {
    queued = await rpc('fn_gate7c_commercial_bridge_send_v1', {
      p_execution_id: prepared.execution_id,
      p_message: message,
      p_created_by: 'worker_A'
    });
  } catch (e: any) {
    return uncertainNoFallback(`gate7c_queue_ambiguous:${String(e?.message || e).slice(0,120)}`);
  }

  if (!['QUEUED_FOR_EXISTING_ZAPI_EXECUTOR','QUEUE_CACHED'].includes(String(queued?.status || '')) || !queued?.queue_item_id) {
    return uncertainNoFallback(`gate7c_queue_not_ready:${String(queued?.status || 'unknown')}`);
  }

  let execRes: Response;
  let execBody: any = null;
  try {
    execRes = await originalFetch(`${SUPABASE_URL}/functions/v1/whatsapp-executor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        _gate7c_execution_id: prepared.execution_id,
        _gate7c_queue_item_id: queued.queue_item_id
      })
    });
    const txt = await execRes.text();
    try { execBody = txt ? JSON.parse(txt) : null; } catch { execBody = { raw: txt }; }
  } catch (e: any) {
    return uncertainNoFallback(`gate7c_executor_ambiguous:${String(e?.message || e).slice(0,120)}`);
  }

  const targetResult = Array.isArray(execBody?.resultados)
    ? execBody.resultados.find((x: any) => String(x?.id) === String(queued.queue_item_id))
    : null;
  const definitelySent = execRes.ok && execBody?.gate7c_targeted === true && Number(execBody?.enviados || 0) === 1 && targetResult?.ok === true;

  if (!definitelySent) {
    try {
      if (prepared?.fence_owner_token) {
        await rpc('fn_gate7c_commercial_bridge_fence_release_v1', {
          p_fence_id: prepared.fence_id,
          p_owner_token: prepared.fence_owner_token,
          p_reason: `abort_executor_no_send:${String(targetResult?.motivo || execBody?.error || 'unknown').slice(0,100)}`,
          p_created_by: 'worker_A'
        });
        clearLocalFence(phone);
      }
    } catch {}
    return uncertainNoFallback('gate7c_executor_definitive_no_send');
  }

  let reconciliation: any = null;
  for (let i = 0; i < 6; i++) {
    try {
      reconciliation = await rpc('fn_gate7c_commercial_bridge_reconcile_v1', { p_execution_id: prepared.execution_id });
      if (reconciliation?.status === 'PASS' && reconciliation?.message_id) break;
    } catch {}
    await new Promise(r => setTimeout(r,700));
  }

  const actualMessageId = reconciliation?.message_id ? String(reconciliation.message_id) : null;
  if (actualMessageId) {
    return jsonResponse({ messageId: actualMessageId, bridgeExecutionId: prepared.execution_id, bridge: 'gate7c_commercial_bridge_v1' }, 200);
  }

  return jsonResponse({
    id: `cortex-exec:${prepared.execution_id}`,
    bridgeExecutionId: prepared.execution_id,
    bridge: 'gate7c_commercial_bridge_v1',
    providerMessageIdPendingReconciliation: true
  }, 200);
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  const manifestoRouted = await maybeRoutePromptManifesto(input, init);
  if (manifestoRouted) return manifestoRouted;

  if (url.includes('/rest/v1/rpc/fn_joao_adquirir_lock')) {
    try {
      const r = await originalFetch(input, init);
      if (!r.ok) return jsonResponse(false,200);
      return r;
    } catch {
      return jsonResponse(false,200);
    }
  }

  const intercepted = await maybeInterceptPix(input, init);
  if (intercepted) return intercepted;
  return originalFetch(input, init);
};
