declare const Deno: any;

// FreightAgent Phase 1 response gate v1.4 — current-turn safe integration — 15/09/2026
// - advances/classifies from the active request before trusting the base response;
// - supports short state-aware continuations such as "Poderia ser 20,76";
// - can recover a silent João base response when shipping state is unambiguous;
// - uses the canonical DB renderer instead of duplicating render rules;
// - production mixed product/pricing/checkout turns are observed only in this canary.

const FRG14_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const FRG14_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const frg14BaseFetch = globalThis.fetch.bind(globalThis);
const frg14BaseServe = Deno.serve.bind(Deno);
const FRG14_VERSION = 'freight-agent-phase1-response-gate/v1.4-current-turn-r3';

function frg14Digits(v: unknown): string { return String(v ?? '').replace(/\D/g, ''); }
function frg14Norm(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function frg14ShippingIntent(text: string): boolean {
  const fn = (globalThis as any).__joaoFreightShippingIntentV1;
  if (typeof fn === 'function') {
    try { return fn(text) === true; } catch {}
  }
  const t = frg14Norm(text);
  return /\b(cep|frete|sedex|pac|j\s*&\s*t|j\s+e\s+t|transportadora|entrega|envio|retirada|retirar|correio|correios)\b/.test(t)
    || /^\D*\d{5}-?\d{3}\D*$/.test(String(text || '').trim());
}
function frg14MixedSensitive(text: string): boolean {
  const fn = (globalThis as any).__joaoFreightMixedSensitiveIntentV1;
  if (typeof fn === 'function') {
    try { return fn(text) === true; } catch {}
  }
  const t = frg14Norm(text);
  return /\b(pix|pagamento|pagar|cobranca|cobrar|link de pagamento|fechar|fechado|total|proposta|orcamento|pedido|preco|valor|quantidade|peca|pecas|unidade|unidades|a3|a4|folha|folhas|adesivo|adesivos|camiseta|camisetas|polo|dtf|silk|serigrafia|estampa|estampas|arte|artes)\b/.test(t)
    || /\d+(?:[,.]\d+)?\s*[x×]\s*\d+(?:[,.]\d+)?/.test(t);
}
async function frg14LeadForPhone(phone: string): Promise<string | null> {
  const p = frg14Digits(phone);
  if (p.length < 10) return null;
  try {
    const q = `${FRG14_URL}/rest/v1/agente_noturno_estado?select=lead_id&phone=eq.${encodeURIComponent(p)}&order=updated_at.desc&limit=1`;
    const r = await frg14BaseFetch(q, { headers: { apikey: FRG14_SERVICE, authorization: `Bearer ${FRG14_SERVICE}` }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const id = String(rows?.[0]?.lead_id ?? '');
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}
async function frg14Current(sessionId: string): Promise<any | null> {
  try {
    const q = `${FRG14_URL}/rest/v1/vw_canonical_session_state_current_v1?select=session_id,state_version,shipping_state,shipping_state_hash,created_at&session_id=eq.${encodeURIComponent(sessionId)}&limit=1`;
    const r = await frg14BaseFetch(q, { headers: { apikey: FRG14_SERVICE, authorization: `Bearer ${FRG14_SERVICE}` }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] ?? null : null;
  } catch { return null; }
}
async function frg14Render(sessionId: string): Promise<any | null> {
  try {
    const r = await frg14BaseFetch(`${FRG14_URL}/rest/v1/rpc/fn_joao_shipping_render_v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: FRG14_SERVICE, authorization: `Bearer ${FRG14_SERVICE}` },
      body: JSON.stringify({ p_session_id: sessionId }),
      signal: AbortSignal.timeout(1800),
    });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch { return null; }
}
async function frg14Audit(event: string, detail: any) {
  try {
    await frg14BaseFetch(`${FRG14_URL}/rest/v1/sistema_logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: FRG14_SERVICE, authorization: `Bearer ${FRG14_SERVICE}`, prefer: 'return=minimal' },
      body: JSON.stringify({ agente_slug: 'agente-noturno', funcao: 'frete-agent-phase1-response-gate', versao: FRG14_VERSION, nivel: 'info', categoria: 'freight_runtime', evento: event, status: 'observed', mensagem: event, detalhe: detail }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {}
}

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== 'function') throw new TypeError('Deno.serve handler missing');

  args[handlerIndex] = async (req: Request, info: any) => {
    let reqBody: any = null;
    try {
      if (req.method === 'POST' && (req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        reqBody = await req.clone().json().catch(() => null);
      }
    } catch {}

    const res = await handler(req, info);
    if (!reqBody || !res.ok) return res;

    let raw = '';
    try { raw = await res.clone().text(); } catch { return res; }
    if (!raw.trim().startsWith('{')) return res;

    let payload: any;
    try { payload = JSON.parse(raw.trim()); } catch { return res; }
    if (!payload || typeof payload !== 'object') return res;

    const baseResponse = typeof payload.resposta === 'string' ? payload.resposta : '';
    const incoming = String(reqBody?.mensagem ?? reqBody?.message ?? '');
    const explicitSession = String(reqBody?._shipping_session_id ?? '').trim();
    const phone = frg14Digits(reqBody?.phone);

    // The request-scoped runtime is the primary classifier. This is intentionally
    // called even when the base João returned silence, so canonical state can recover
    // an unambiguous shipping continuation.
    let advanced: any = null;
    const advanceFn = (globalThis as any).__joaoFreightAdvanceCurrentTurnV1;
    if (phone && typeof advanceFn === 'function') {
      try { advanced = await advanceFn(phone); } catch {}
    }

    const shippingRelevant = Boolean(explicitSession) || advanced?.ok === true || frg14ShippingIntent(incoming) || frg14ShippingIntent(baseResponse);
    if (!shippingRelevant) return res;

    const leadId = explicitSession ? '' : await frg14LeadForPhone(phone);
    const sessionId = String(advanced?.sessionId ?? explicitSession ?? (leadId ? `lead:${leadId}` : (phone ? `phone:${phone}` : ''))).trim();
    if (!sessionId) return res;

    const current = advanced?.current ?? await frg14Current(sessionId);
    if (!current?.shipping_state) return res;
    const render = advanced?.render ?? await frg14Render(sessionId);
    const canonicalText = String(render?.text ?? '').trim();
    if (!canonicalText) return res;

    const status = String(current.shipping_state?.status ?? 'EMPTY');
    const explicitStateDriven = Boolean(explicitSession) && ['ZIP_PROVIDED', 'VALID_QUOTE', 'QUOTE_SELECTED', 'EXPIRED_QUOTE'].includes(status);
    const mixedSensitive = !explicitStateDriven && frg14MixedSensitive(incoming);
    const enforce = explicitStateDriven || !mixedSensitive;

    const freightMeta = {
      gate: 'CANONICAL_SESSION_STATE',
      mode: enforce ? 'ENFORCE' : 'OBSERVE_MIXED_V294_LKG',
      session_id: sessionId,
      state_version: current.state_version,
      shipping_state_hash: current.shipping_state_hash,
      status,
      expected_rendered_price: render?.expected_rendered_price ?? null,
      must_not_ask_zip: render?.must_not_ask_zip === true,
      current_turn: true,
      base_was_silent: !baseResponse,
    };

    const next = { ...payload, freight_phase1: freightMeta };
    if (enforce) {
      next.respondeu = true;
      next.resposta = canonicalText;
    }

    const text = JSON.stringify(next);
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('x-cortex-freight-phase1-response-gate', FRG14_VERSION);
    headers.set('x-cortex-freight-phase1-mode', enforce ? 'enforce' : 'observe-mixed');

    void frg14Audit(enforce ? 'canonical_handler_response_enforced' : 'mixed_handler_response_observed', {
      session_id: sessionId,
      state_version: current.state_version,
      status,
      expected_rendered_price: render?.expected_rendered_price ?? null,
      dry_run: reqBody?._dry_run === true,
      mixed_sensitive: mixedSensitive,
      current_turn: true,
      base_was_silent: !baseResponse,
    });

    return new Response(text, { status: res.status, statusText: res.statusText, headers });
  };

  return frg14BaseServe(...args as any);
};
