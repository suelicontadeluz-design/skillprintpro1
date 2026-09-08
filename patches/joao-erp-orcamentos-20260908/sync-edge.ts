const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const VERSION = 'joao-erp-orcamento-sync/v3';
const WORKER = 'joao-erp-orcamento-sync-v3';
const MAIN_HEADERS = { 'content-type': 'application/json', apikey: SERVICE, authorization: `Bearer ${SERVICE}` };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function mainRpc(name: string, body: unknown = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: MAIN_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`main_rpc_${name}:${r.status}:${JSON.stringify(data).slice(0,300)}`);
  return data;
}

async function mainRows(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` }, signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`main_read:${r.status}:${JSON.stringify(data).slice(0,300)}`);
  return Array.isArray(data) ? data : [];
}

async function authorized(req: Request): Promise<boolean> {
  if ((req.headers.get('authorization') || '') === `Bearer ${SERVICE}`) return true;
  const token = req.headers.get('x-cron-secret') || '';
  if (!token) return false;
  try { return (await mainRpc('fn_edge_cron_auth_ok_v1', { p_token: token })) === true; }
  catch { return false; }
}

async function erpRpc(name: string, body: unknown) {
  const r = await fetch(`${ERP_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ERP_KEY, authorization: `Bearer ${ERP_KEY}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

async function phoneForLead(leadId: string): Promise<string> {
  const rows = await mainRows(`agente_noturno_estado?select=phone&lead_id=eq.${encodeURIComponent(leadId)}&order=updated_at.desc&limit=1`);
  return String(rows[0]?.phone ?? '');
}

async function componentDetails(components: any): Promise<any[]> {
  const parts = Array.isArray(components?.componentes) ? components.componentes : [];
  const ids = parts.map((x: any) => String(x?.operation_id ?? '')).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];
  return await mainRows(`operacoes_financeiras?select=id,kind,amount,source_tool,components&id=in.(${ids.join(',')})`);
}

async function markFailed(operationId: string, message: string): Promise<void> {
  try { await mainRpc('fn_joao_orcamento_outbox_fail_v1', { p_operation_id: operationId, p_worker: WORKER, p_error: message }); }
  catch {}
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed', version: VERSION }, 405);
  if (!(await authorized(req))) return json({ ok: false, error: 'unauthorized', version: VERSION }, 401);
  if (!ERP_KEY) return json({ ok: false, error: 'erp_key_missing', version: VERSION }, 503);

  try { await mainRpc('fn_joao_orcamento_outbox_recover_v1'); } catch {}

  let jobs: any[] = [];
  try {
    const claim = await mainRpc('fn_joao_orcamento_outbox_claim_v1', { p_worker: WORKER, p_limit: 40 });
    jobs = Array.isArray(claim) ? claim : [];
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0,500), version: VERSION }, 500);
  }

  let synced = 0;
  let failed = 0;
  const results: any[] = [];

  for (const job of jobs) {
    const operationId = String(job.operation_id ?? '');
    try {
      const rows = await mainRows(`operacoes_financeiras?select=id,lead_id,kind,amount,source_tool,components,created_at&id=eq.${encodeURIComponent(operationId)}&limit=1`);
      const op = rows[0];
      if (!op) throw new Error('operation_not_found');

      const phone = await phoneForLead(String(op.lead_id));
      const details = String(op.kind) === 'total' ? await componentDetails(op.components) : [];
      const payload = {
        operation_id: op.id,
        lead_id: op.lead_id,
        kind: op.kind,
        amount: Number(op.amount),
        source_tool: op.source_tool,
        components: op.components ?? {},
        component_details: details,
        phone,
      };

      const applied = await erpRpc('fn_joao_lancar_orcamento_v1', { p_payload: payload });
      const code = String(applied.data?.code ?? '');
      if (!applied.ok || applied.data?.ok !== true || !['CREATED','IDEMPOTENT','UPDATED_TOTAL'].includes(code)) {
        throw new Error(`erp_apply:${applied.status}:${JSON.stringify(applied.data).slice(0,350)}`);
      }

      const completed = await mainRpc('fn_joao_orcamento_outbox_complete_v1', { p_operation_id: op.id, p_worker: WORKER });
      if (completed !== true) throw new Error('complete_false');

      synced++;
      results.push({ operation_id: op.id, ok: true, code, proposta_id: applied.data?.proposta_id ?? null, numero_proposta: applied.data?.numero_proposta ?? null });
    } catch (e) {
      failed++;
      const message = String((e as Error)?.message ?? e).slice(0,800);
      await markFailed(operationId, message);
      results.push({ operation_id: operationId, ok: false, error: message });
    }
  }

  return json({ ok: true, claimed: jobs.length, synced, failed, results, version: VERSION });
});
