declare const Deno: any;

// FreightAgent Phase 1 — current-turn request context v1 — 15/09/2026
// Safety goals:
// - shipping transitions use the request being processed, never DB "latest inbound";
// - overlapping requests for the same phone fail closed;
// - dry-run without an explicit replay session is automatically namespaced under replay:,
//   so test state can never become the current state of a future live lead:/phone: session.

const FCT_BASE_SERVE = Deno.serve.bind(Deno);
const FCT_STORE = new Map<string, Map<string, any>>();

function fctDigits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function fctIncoming(body: any): string {
  return String(body?.mensagem ?? body?.message ?? '').trim();
}

function fctPut(phone: string, token: string, ctx: any) {
  if (!phone) return;
  let perPhone = FCT_STORE.get(phone);
  if (!perPhone) {
    perPhone = new Map<string, any>();
    FCT_STORE.set(phone, perPhone);
  }
  perPhone.set(token, ctx);
}

function fctDelete(phone: string, token: string) {
  if (!phone) return;
  const perPhone = FCT_STORE.get(phone);
  if (!perPhone) return;
  perPhone.delete(token);
  if (perPhone.size === 0) FCT_STORE.delete(phone);
}

(globalThis as any).__joaoFreightCurrentTurnV1 = (phoneLike: unknown) => {
  const phone = fctDigits(phoneLike);
  const perPhone = FCT_STORE.get(phone);
  if (!perPhone || perPhone.size === 0) {
    return { ok: false, code: 'NO_ACTIVE_TURN' };
  }
  if (perPhone.size !== 1) {
    return { ok: false, code: 'AMBIGUOUS_ACTIVE_TURN', active_turns: perPhone.size };
  }
  const ctx = [...perPhone.values()][0];
  return { ok: true, ...ctx };
};

(Deno as any).serve = (...args: any[]) => {
  const handlerIndex = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[handlerIndex];
  if (typeof handler !== 'function') throw new TypeError('Deno.serve handler missing');

  args[handlerIndex] = async (req: Request, info: any) => {
    let body: any = null;
    try {
      if (req.method === 'POST' && (req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
        body = await req.clone().json().catch(() => null);
      }
    } catch {}

    const phone = fctDigits(body?.phone);
    const token = crypto.randomUUID();
    const dryRun = body?._dry_run === true;
    const requestedSession = String(body?._shipping_session_id ?? '').trim() || null;
    const safeSession = requestedSession || (dryRun ? `replay:dryrun:${token}` : null);

    const ctx = {
      token,
      phone,
      incoming: fctIncoming(body),
      inbound_id: String(body?.inbound_id ?? '').trim() || null,
      shipping_session_id: safeSession,
      dry_run: dryRun,
      started_at: new Date().toISOString(),
    };

    if (phone) fctPut(phone, token, ctx);
    try {
      return await handler(req, info);
    } finally {
      if (phone) fctDelete(phone, token);
    }
  };

  return FCT_BASE_SERVE(...args as any);
};
