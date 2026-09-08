import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const VERSION = 'joao-erp-orcamento-sync/v1';
const WORKER = 'joao-erp-orcamento-sync-v1';
const sb = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function authorized(req: Request): Promise<boolean> {
  if ((req.headers.get('authorization') || '') === `Bearer ${SERVICE}`) return true;
  const token = req.headers.get('x-cron-secret') || '';
  if (!token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_edge_cron_auth_ok_v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ p_token: token }),
      signal: AbortSignal.timeout(4000),
    });
    return r.ok && (await r.json().catch(() => false)) === true;
  } catch {
    return false;
  }
}

async function erpRpc(name: string, body: unknown) {
  const r = await fetch(`${ERP_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ERP_KEY, authorization: `Bearer ${ERP_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

async function phoneForLead(leadId: string): Promise<string> {
  const { data } = await sb
    .from('agente_noturno_estado')
    .select('phone')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return String(data?.phone ?? '');
}

async function componentDetails(components: any): Promise<any[]> {
  const parts = Array.isArray(components?.componentes) ? components.componentes : [];
  const ids = parts
    .map((x: any) => String(x?.operation_id ?? ''))
    .filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];

  const { data, error } = await sb
    .from('operacoes_financeiras')
    .select('id,kind,amount,source_tool,components')
    .in('id', ids);
  if (error) throw new Error(`component_details:${error.message}`);
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed', version: VERSION }, 405);
  if (!(await authorized(req))) return json({ ok: false, error: 'unauthorized', version: VERSION }, 401);
  if (!ERP_KEY) return json({ ok: false, error: 'erp_key_missing', version: VERSION }, 503);

  await sb.rpc('fn_joao_orcamento_outbox_recover_v1').catch(() => null);

  const { data: claimed, error: claimError } = await sb.rpc('fn_joao_orcamento_outbox_claim_v1', {
    p_worker: WORKER,
    p_limit: 40,
  });
  if (claimError) return json({ ok: false, error: `claim:${claimError.message}`, version: VERSION }, 500);

  const jobs = Array.isArray(claimed) ? claimed : [];
  let synced = 0;
  let failed = 0;
  const results: any[] = [];

  for (const job of jobs) {
    const operationId = String(job.operation_id ?? '');
    try {
      const { data: op, error: opError } = await sb
        .from('operacoes_financeiras')
        .select('id,lead_id,kind,amount,source_tool,components,created_at')
        .eq('id', operationId)
        .maybeSingle();
      if (opError || !op) throw new Error(`operation_read:${opError?.message ?? 'not_found'}`);

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

      const { data: completed, error: completeError } = await sb.rpc('fn_joao_orcamento_outbox_complete_v1', {
        p_operation_id: op.id,
        p_worker: WORKER,
      });
      if (completeError || completed !== true) throw new Error(`complete:${completeError?.message ?? 'false'}`);

      synced++;
      results.push({ operation_id: op.id, ok: true, code, proposta_id: applied.data?.proposta_id ?? null, numero_proposta: applied.data?.numero_proposta ?? null });
    } catch (e) {
      failed++;
      const message = String((e as Error)?.message ?? e).slice(0,800);
      await sb.rpc('fn_joao_orcamento_outbox_fail_v1', {
        p_operation_id: operationId,
        p_worker: WORKER,
        p_error: message,
      }).catch(() => null);
      results.push({ operation_id: operationId, ok: false, error: message });
    }
  }

  return json({ ok: true, claimed: jobs.length, synced, failed, results, version: VERSION });
});
