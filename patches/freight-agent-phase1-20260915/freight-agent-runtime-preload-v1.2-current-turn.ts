declare const Deno: any;

// FreightAgent Phase 1 runtime v1.2 — current-turn safe integration — 15/09/2026
// Narrow integration policy:
// - shipping transitions use the active request context, never DB "latest inbound";
// - canonical state is authoritative for ZIP/quote/selection/expiry;
// - price-only short continuations can resolve an existing quote;
// - product/pricing/checkout mixed turns are observed but not rewritten in this canary;
// - pure shipping turns may be rendered canonically at the final outbound boundary;
// - missing/ambiguous request context fails closed.

const FA12_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const FA12_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const fa12BaseFetch = globalThis.fetch.bind(globalThis);
const FA12_VERSION = 'freight-agent-phase1-runtime/v1.2-current-turn-r2';
const FA12_QUOTE_TTL_MS = 2 * 60 * 60 * 1000;
const FA12_TRANSIENT_ZAPI = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const fa12SubscriberPhone = new Map<string, { phone: string; at: number }>();

function fa12Digits(v: unknown): string { return String(v ?? '').replace(/\D/g, ''); }
function fa12Norm(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function fa12Url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function fa12Raw(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch {}
  }
  return '';
}
function fa12Rebuild(input: RequestInfo | URL, init: RequestInit | undefined, body: string): [RequestInfo | URL, RequestInit | undefined] {
  if (typeof Request !== 'undefined' && input instanceof Request) return [new Request(input, { ...init, body }), undefined];
  return [input, { ...(init || {}), body }];
}
function fa12Cep(text: string): string | null {
  const m = String(text || '').match(/\b(\d{5})-?(\d{3})\b/);
  return m ? m[1] + m[2] : null;
}
function fa12ShippingIntent(text: string): boolean {
  const t = fa12Norm(text);
  return /\b(cep|frete|sedex|pac|j\s*&\s*t|j\s+e\s+t|transportadora|entrega|envio|retirada|retirar|correio|correios)\b/.test(t)
    || /^\D*\d{5}-?\d{3}\D*$/.test(String(text || '').trim());
}
function fa12MixedSensitiveIntent(text: string): boolean {
  const t = fa12Norm(text);
  return /\b(pix|pagamento|pagar|cobranca|cobrar|link de pagamento|fechar|fechado|total|proposta|orcamento|pedido|preco|valor|quantidade|peca|pecas|unidade|unidades|a3|a4|folha|folhas|adesivo|adesivos|camiseta|camisetas|polo|dtf|silk|serigrafia|estampa|estampas|arte|artes)\b/.test(t)
    || /\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?/.test(t);
}
function fa12Service(text: string): string | null {
  const t = fa12Norm(text);
  const hits: string[] = [];
  if (/(^|\W)sedex(\W|$)/.test(t)) hits.push('Sedex');
  if (/(^|\W)pac(\W|$)/.test(t)) hits.push('PAC');
  if (/j\s*&\s*t|j\s+e\s+t|(^|\W)jt(\W|$)/.test(t)) hits.push('J&T Standard');
  return hits.length === 1 ? hits[0] : null;
}
function fa12Amounts(text: string): number[] {
  return [...String(text || '').matchAll(/(?:R\$\s*)?([0-9]{1,4}[.,][0-9]{2})/g)]
    .map(m => Number(m[1].replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0);
}
function fa12Uuid(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
function fa12CurrentTurn(phone: string): any {
  try {
    const fn = (globalThis as any).__joaoFreightCurrentTurnV1;
    if (typeof fn !== 'function') return { ok: false, code: 'CURRENT_TURN_PROVIDER_MISSING' };
    return fn(phone);
  } catch {
    return { ok: false, code: 'CURRENT_TURN_PROVIDER_ERROR' };
  }
}
async function fa12Rpc(name: string, args: any): Promise<any> {
  const r = await fa12BaseFetch(`${FA12_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: FA12_SERVICE, authorization: `Bearer ${FA12_SERVICE}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(3500),
  });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}
async function fa12LeadForPhone(phone: string): Promise<string | null> {
  const p = fa12Digits(phone);
  if (p.length < 10) return null;
  try {
    const u = `${FA12_URL}/rest/v1/agente_noturno_estado?select=lead_id&phone=eq.${encodeURIComponent(p)}&order=updated_at.desc&limit=1`;
    const r = await fa12BaseFetch(u, { headers: { apikey: FA12_SERVICE, authorization: `Bearer ${FA12_SERVICE}` }, signal: AbortSignal.timeout(1600) });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const id = String(rows?.[0]?.lead_id ?? '');
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}
async function fa12LatestQuote(phone: string): Promise<any | null> {
  const p = fa12Digits(phone);
  if (p.length < 10) return null;
  const since = new Date(Date.now() - FA12_QUOTE_TTL_MS).toISOString();
  const u = `${FA12_URL}/rest/v1/joao_freight_quote_snapshots?select=quote_id,lead_id,phone,cep_destino,opcoes,quoted_at,quote_hash,source_tool&phone=eq.${encodeURIComponent(p)}&quoted_at=gte.${encodeURIComponent(since)}&order=quoted_at.desc&limit=1`;
  try {
    const r = await fa12BaseFetch(u, { headers: { apikey: FA12_SERVICE, authorization: `Bearer ${FA12_SERVICE}` }, signal: AbortSignal.timeout(1800) });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] ?? null : null;
  } catch { return null; }
}
function fa12Session(explicitSession: string | null, leadId: unknown, phone: string): string {
  if (explicitSession) return explicitSession;
  const lead = String(leadId ?? '').trim();
  return /^[0-9a-f-]{36}$/i.test(lead) ? `lead:${lead}` : `phone:${fa12Digits(phone)}`;
}
async function fa12Current(sessionId: string): Promise<any> {
  return await fa12Rpc('fn_joao_shipping_state_current_v1', { p_session_id: sessionId });
}
async function fa12Apply(sessionId: string, version: number, proposal: any, leadId: any, phone: string, turn: any): Promise<any> {
  const replay = turn?.dry_run === true || Boolean(turn?.shipping_session_id);
  return await fa12Rpc('fn_joao_shipping_state_apply_v1', {
    p_session_id: sessionId,
    p_expected_version: version,
    p_proposal: proposal,
    p_lead_id: leadId ?? null,
    p_phone: phone,
    p_source_turn_id: fa12Uuid(turn?.inbound_id),
    p_source_replay_case_id: null,
    p_is_replay: replay,
    p_as_of: new Date().toISOString(),
  });
}
async function fa12Audit(event: string, detail: any) {
  try {
    await fa12BaseFetch(`${FA12_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: FA12_SERVICE, authorization: `Bearer ${FA12_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'frete-agent-phase1', versao: FA12_VERSION, nivel: 'info', categoria: 'freight_runtime', evento: event, status: 'observed', mensagem: event, detalhe: detail }),
      signal: AbortSignal.timeout(1200),
    });
  } catch {}
}

async function fa12Advance(phoneLike: unknown): Promise<any> {
  const phone = fa12Digits(phoneLike);
  const turn = fa12CurrentTurn(phone);
  if (!turn?.ok) {
    void fa12Audit('current_turn_context_unavailable', { phone_suffix: phone.slice(-4), code: turn?.code ?? 'UNKNOWN' });
    return { ok: false, code: turn?.code ?? 'CURRENT_TURN_UNAVAILABLE' };
  }

  const incoming = String(turn.incoming ?? '');
  const quote = await fa12LatestQuote(phone);
  const leadId = quote?.lead_id ?? await fa12LeadForPhone(phone);
  const sessionId = fa12Session(turn.shipping_session_id, leadId, phone);
  let current = await fa12Current(sessionId);
  if (!current?.ok) return { ok: false, code: 'CURRENT_STATE_UNAVAILABLE', sessionId, turn };

  let version = Number(current?.state_version ?? 0);
  let state = current?.shipping_state ?? {};
  let changed = false;

  const serviceIntent = fa12Service(incoming);
  const amountsIntent = fa12Amounts(incoming);
  const priceMatches = state?.status === 'VALID_QUOTE' && Array.isArray(state?.quotes)
    ? (state.quotes as any[]).filter((o: any) => amountsIntent.some(n => Math.abs(Number(o?.preco) - n) <= 0.005))
    : [];
  const shortPriceContinuation = incoming.trim().length <= 120 && !fa12MixedSensitiveIntent(incoming) && priceMatches.length === 1;
  const shippingRelevant = Boolean(turn.shipping_session_id) || fa12ShippingIntent(incoming) || Boolean(serviceIntent) || shortPriceContinuation;
  if (!shippingRelevant) return { ok: false, code: 'CURRENT_TURN_NOT_SHIPPING', sessionId, turn, current };

  const expiryMs = Date.parse(String(state?.quote_expires_at ?? ''));
  if ((state?.status === 'VALID_QUOTE' || state?.status === 'QUOTE_SELECTED') && Number.isFinite(expiryMs) && Date.now() >= expiryMs) {
    const res = await fa12Apply(sessionId, version, { schema_version: 'freight-state-proposal/v1', action: 'QUOTE_EXPIRED' }, leadId, phone, turn);
    if (res?.ok && res?.code === 'STATE_COMMITTED') {
      version = Number(res.state_version); state = res.shipping_state; changed = true;
    }
  }

  const inboundCep = fa12Cep(incoming);
  if (inboundCep && state?.zip_code !== inboundCep) {
    const res = await fa12Apply(sessionId, version, {
      schema_version: 'freight-state-proposal/v1', action: 'ZIP_PROVIDED', zip_code: inboundCep,
      explicit_customer_change: Boolean(state?.zip_code), source: 'CURRENT_REQUEST_TURN',
    }, leadId, phone, turn);
    if (res?.ok) { version = Number(res.state_version); state = res.shipping_state; changed = true; }
  }

  const quoteCep = fa12Digits(quote?.cep_destino);
  if (!state?.zip_code && quoteCep.length === 8) {
    const res = await fa12Apply(sessionId, version, {
      schema_version: 'freight-state-proposal/v1', action: 'ZIP_PROVIDED', zip_code: quoteCep, source: 'QUOTE_SNAPSHOT',
    }, leadId, phone, turn);
    if (res?.ok) { version = Number(res.state_version); state = res.shipping_state; changed = true; }
  }

  if (quote?.quote_id && quoteCep.length === 8 && state?.zip_code === quoteCep && String(state?.quote_snapshot_id ?? '') !== String(quote.quote_id)) {
    const res = await fa12Apply(sessionId, version, {
      schema_version: 'freight-state-proposal/v1', action: 'QUOTE_RECORDED', quote_snapshot_id: quote.quote_id,
    }, leadId, phone, turn);
    if (res?.ok) { version = Number(res.state_version); state = res.shipping_state; changed = true; }
  }

  if (state?.status === 'VALID_QUOTE' && Array.isArray(state?.quotes) && incoming) {
    const quotedAt = quote?.quoted_at ? Date.parse(String(quote.quoted_at)) : 0;
    const turnAt = Date.parse(String(turn.started_at ?? ''));
    // A selection may only resolve against a quote that already existed when this customer turn began.
    if (!quotedAt || !turnAt || quotedAt <= turnAt + 1000) {
      const service = fa12Service(incoming);
      const amounts = fa12Amounts(incoming);
      let proposal: any = null;
      if (service) proposal = { schema_version: 'freight-state-proposal/v1', action: 'QUOTE_SELECTED', service };
      else if (incoming.trim().length <= 120 && !fa12MixedSensitiveIntent(incoming)) {
        const matches = (state.quotes as any[]).filter((o: any) => amounts.some(n => Math.abs(Number(o?.preco) - n) <= 0.005));
        if (matches.length === 1) proposal = { schema_version: 'freight-state-proposal/v1', action: 'QUOTE_SELECTED', price: Number(matches[0].preco) };
      }
      if (proposal) {
        const res = await fa12Apply(sessionId, version, proposal, leadId, phone, turn);
        if (res?.ok) { version = Number(res.state_version); state = res.shipping_state; changed = true; }
      }
    }
  }

  current = await fa12Current(sessionId);
  const render = await fa12Rpc('fn_joao_shipping_render_v1', { p_session_id: sessionId });
  return {
    ok: true,
    sessionId,
    current,
    render,
    quote,
    turn,
    changed,
    mixed_sensitive: fa12MixedSensitiveIntent(incoming),
  };
}

(globalThis as any).__joaoFreightAdvanceCurrentTurnV1 = fa12Advance;
(globalThis as any).__joaoFreightShippingIntentV1 = fa12ShippingIntent;
(globalThis as any).__joaoFreightMixedSensitiveIntentV1 = fa12MixedSensitiveIntent;

function fa12Outbound(body: any, url: string): { field: 'message' | 'value' | 'texto'; phone: string; text: string; zapi: boolean } | null {
  if (/^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-text(?:\?|$)/i.test(url)) {
    return { field: 'message', phone: fa12Digits(body?.phone), text: String(body?.message ?? ''), zapi: true };
  }
  const bm = url.match(/^https:\/\/backend\.botconversa\.com\.br\/api\/v1\/webhook\/subscriber\/([^/]+)\/send_message\/?(?:\?|$)/i);
  if (bm && String(body?.type ?? '').toLowerCase() === 'text') {
    const cached = fa12SubscriberPhone.get(bm[1]);
    return { field: 'value', phone: cached && Date.now() - cached.at < 10 * 60 * 1000 ? cached.phone : '', text: String(body?.value ?? ''), zapi: false };
  }
  if (url.includes('/functions/v1/joao-tts')) {
    return { field: 'texto', phone: fa12Digits(body?.phone), text: String(body?.texto ?? ''), zapi: false };
  }
  return null;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = fa12Url(input);
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();

  const lookup = url.match(/\/subscriber\/get_by_phone\/([^/?]+)\/?(?:\?|$)/i);
  if (lookup) {
    const response = await fa12BaseFetch(input, init);
    if (response.ok) {
      try {
        const data = await response.clone().json();
        const sid = String(data?.id || '');
        const phone = fa12Digits(decodeURIComponent(lookup[1]));
        if (sid && phone) fa12SubscriberPhone.set(sid, { phone, at: Date.now() });
      } catch {}
    }
    return response;
  }

  if (method !== 'POST') return fa12BaseFetch(input, init);
  const raw = await fa12Raw(input, init);
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { return fa12BaseFetch(input, init); }
  if (!body) return fa12BaseFetch(input, init);

  const outbound = fa12Outbound(body, url);
  let callInput = input;
  let callInit = init;

  if (outbound?.phone) {
    const advanced = await fa12Advance(outbound.phone);
    const canonicalText = String(advanced?.render?.text ?? '').trim();
    if (advanced?.ok && canonicalText) {
      if (advanced.mixed_sensitive) {
        // First integration canary: mixed commercial/checkout turns stay on exact v294 LKG.
        void fa12Audit('mixed_turn_observed_not_rewritten', {
          phone_suffix: outbound.phone.slice(-4), session_id: advanced.sessionId,
          state_version: advanced?.current?.state_version, status: advanced?.current?.shipping_state?.status,
          expected_rendered_price: advanced?.render?.expected_rendered_price ?? null,
        });
      } else {
        body[outbound.field] = outbound.text.trim().startsWith('*João Barros:*') ? `*João Barros:*\n${canonicalText}` : canonicalText;
        const rebuilt = fa12Rebuild(input, init, JSON.stringify(body));
        callInput = rebuilt[0]; callInit = rebuilt[1];
        void fa12Audit('canonical_shipping_render_enforced', {
          phone_suffix: outbound.phone.slice(-4), session_id: advanced.sessionId,
          state_version: advanced?.current?.state_version, status: advanced?.current?.shipping_state?.status,
          quote_snapshot_id: advanced?.current?.shipping_state?.quote_snapshot_id ?? null,
          rendered_price: advanced?.render?.expected_rendered_price ?? null,
        });
      }
    }
  }

  const response = await fa12BaseFetch(callInput, callInit);
  if (!outbound?.zapi || response.ok || !FA12_TRANSIENT_ZAPI.has(response.status)) return response;

  await new Promise(r => setTimeout(r, 300));
  const retry = await fa12BaseFetch(callInput, callInit);
  void fa12Audit(retry.ok ? 'zapi_transient_retry_recovered' : 'zapi_transient_retry_failed', {
    phone_suffix: outbound.phone.slice(-4), first_http_status: response.status, retry_http_status: retry.status,
  });
  return retry;
};
