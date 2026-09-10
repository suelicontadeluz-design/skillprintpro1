// calcular-frete v15 — 10/09/2026
// Guard preventivo sobre o v14: DTF UV so cota quando o contexto atual, a operacao financeira
// e o receipt ERP canonico apontam para o MESMO pedido/consumo. Nao altera cubagem nem Frenet.
// Se houver alternativas, receipt stale ou troca de produto, falha fechado antes da cotacao.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const V15_SB_URL = Deno.env.get('SUPABASE_URL')!;
const V15_SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const V15_CRON_SECRET_SHA256 = '6aa7bec30538035f4fe659bdb8e12bb8966bc51703702eda43c6f3b3e94b2f8c';
const v15sb = createClient(V15_SB_URL, V15_SB_KEY);

function v15json(body: any, status = 409) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function v15norm(s: any): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function v15cep(s: any): string { return String(s ?? '').replace(/\D/g, ''); }
function v15isUvProduct(s: any): boolean {
  const n = v15norm(s).replace(/-/g, '_');
  return /dtf[_\s]*uv|adesivo[_\s]*uv/.test(n);
}
function v15itemsAreUv(items: any[]): boolean {
  return Array.isArray(items) && items.length > 0 && items.every((i: any) =>
    String(i?.produto_id ?? '') === 'd48addf9-2b53-482f-8f28-1dfc7ea7c123' || /dtf\s*uv/i.test(String(i?.descricao ?? ''))
  );
}
function v15uvConsumption(items: any[]): number | null {
  if (!Array.isArray(items) || !items.length) return null;
  let total = 0;
  for (const i of items) {
    const n = Number(i?.uv_consumo_m);
    if (!Number.isFinite(n) || n <= 0) return null;
    total += n;
  }
  return Number(total.toFixed(4));
}
async function v15sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function v15authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${V15_SB_KEY}`) return true;
  const cron = req.headers.get('x-cron-secret') || '';
  if (!cron) return false;
  try { return (await v15sha256(cron)) === V15_CRON_SECRET_SHA256; } catch { return false; }
}

async function v15stateByCep(cep: string): Promise<{ leadId: string; product: string } | null> {
  const { data, error } = await v15sb.from('agente_noturno_estado')
    .select('lead_id,slots,updated_at')
    .contains('slots', { cep })
    .not('lead_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error || !data?.length) return null;
  const leadIds = [...new Set(data.map((r: any) => String(r.lead_id)).filter(Boolean))];
  if (leadIds.length !== 1) return null;
  const row: any = data.find((r: any) => String(r.lead_id) === leadIds[0]);
  return { leadId: leadIds[0], product: String(row?.slots?.produto ?? '') };
}

async function v15latestReceipt(leadId: string): Promise<any | null> {
  const { data, error } = await v15sb.from('joao_erp_proposal_receipts_v1')
    .select('receipt_id,operation_id,lead_id,proposta_id,numero_proposta,proposal_total_brl,created_at,canonical,snapshot')
    .eq('lead_id', leadId).eq('canonical', true)
    .order('created_at', { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return data[0];
}

async function v15eligibleUvOperations(leadId: string, metros: number): Promise<any[]> {
  const { data, error } = await v15sb.from('operacoes_financeiras')
    .select('id,lead_id,kind,source_tool,components,status,created_at,expires_at,used_at')
    .eq('lead_id', leadId)
    .eq('kind', 'produto')
    .in('source_tool', ['calcular_rendimento_uv', 'calcular_dtf_uv_metro'])
    .eq('status', 'ativa')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return [];
  const all = data || [];
  if (!(metosFinitePositive(metros))) return all;
  return all.filter((r: any) => {
    const c = Number(r?.components?.consumo_m ?? r?.components?.metros);
    return Number.isFinite(c) && Math.abs(c - metros) <= 0.005;
  });
}
function metosFinitePositive(n: number): boolean { return Number.isFinite(n) && n > 0; }

async function v15receiptForOperation(operationId: string): Promise<any | null> {
  const { data, error } = await v15sb.from('joao_erp_proposal_receipts_v1')
    .select('receipt_id,operation_id,lead_id,proposta_id,numero_proposta,proposal_total_brl,created_at,canonical,snapshot')
    .eq('operation_id', operationId).eq('canonical', true).limit(2);
  if (error || !data?.length || data.length !== 1) return null;
  return data[0];
}

async function v15guard(req: Request): Promise<Response | null> {
  if (req.method !== 'POST') return null;
  if (!(await v15authorized(req))) return null; // v14 devolve o 401 canonico.

  let body: any;
  try { body = await req.clone().json(); } catch { return null; } // v14 devolve invalid_json.
  const cep = v15cep(body?.cep_destino);
  if (cep.length !== 8) return null; // validacao canonica continua no v14.

  const state = await v15stateByCep(cep);
  const metros = Number(body?.metros ?? 0);
  const latest = state?.leadId ? await v15latestReceipt(state.leadId) : null;
  const latestItems = Array.isArray(latest?.snapshot?.items) ? latest.snapshot.items : [];

  // Nunca reutilizar receipt UV quando o estado comercial atual ja aponta para outro produto.
  if (latest && v15itemsAreUv(latestItems) && (!state || !v15isUvProduct(state.product))) {
    return v15json({
      ok: false,
      error: 'freight_receipt_context_mismatch',
      acao: 'O produto atual diverge do receipt UV. Confirme o produto/pedido antes de calcular o frete.'
    });
  }

  // O guard estrito so entra quando o estado atual diz DTF UV. Demais produtos seguem exatamente o v14.
  if (!state || !v15isUvProduct(state.product)) return null;

  if (!metosFinitePositive(metros)) {
    return v15json({
      ok: false,
      error: 'dtf_uv_operacao_nao_selecionada',
      acao: 'Informe o consumo em metros do pedido UV escolhido antes de calcular o frete.'
    });
  }

  const candidates = await v15eligibleUvOperations(state.leadId, metros);
  if (candidates.length !== 1) {
    return v15json({
      ok: false,
      error: candidates.length ? 'dtf_uv_operacao_ambigua' : 'dtf_uv_operacao_elegivel_ausente',
      candidatos: candidates.length,
      consumo_m: metros,
      acao: 'Confirme qual quantidade/opcao UV o cliente escolheu e recalcule. Nao escolha entre alternativas.'
    });
  }

  const op = candidates[0];
  const receipt = await v15receiptForOperation(String(op.id));
  if (!receipt) {
    return v15json({
      ok: false,
      error: 'dtf_uv_receipt_operacao_ausente',
      operation_id: op.id,
      acao: 'A operacao UV ainda nao tem proposta ERP canonica comprovada. Nao cotar frete ate o receipt existir.'
    });
  }

  const items = Array.isArray(receipt?.snapshot?.items) ? receipt.snapshot.items : [];
  const canonicalMeters = v15uvConsumption(items);
  if (!v15itemsAreUv(items) || !canonicalMeters || Math.abs(canonicalMeters - metros) > 0.005) {
    return v15json({
      ok: false,
      error: 'dtf_uv_receipt_consumo_divergente',
      operation_id: op.id,
      consumo_informado_m: metros,
      consumo_receipt_m: canonicalMeters,
      acao: 'Receipt e consumo UV divergem. Reconciliar antes de cotar.'
    });
  }

  // O v14 escolhe o receipt mais recente do lead. Exigir que ele seja exatamente o selecionado evita stale reuse.
  if (!latest || String(latest.operation_id) !== String(op.id)) {
    return v15json({
      ok: false,
      error: 'dtf_uv_latest_receipt_divergente',
      operation_id_selecionada: op.id,
      operation_id_latest_receipt: latest?.operation_id ?? null,
      acao: 'O receipt mais recente do lead nao e o pedido UV selecionado. Nao reutilizar receipt antigo.'
    });
  }

  return null;
}

// Envolve o handler do v14 sem duplicar a logica de CEP, Frenet, cubagem e snapshot.
const v15Deno: any = Deno as any;
const v15OriginalServe = v15Deno.serve.bind(Deno);
v15Deno.serve = (arg1: any, arg2?: any) => {
  if (typeof arg1 === 'function') {
    const handler = arg1;
    return v15OriginalServe(async (req: Request, info: any) => {
      const blocked = await v15guard(req);
      if (blocked) return blocked;
      return handler(req, info);
    });
  }
  const options = arg1;
  const handler = arg2;
  return v15OriginalServe(options, async (req: Request, info: any) => {
    const blocked = await v15guard(req);
    if (blocked) return blocked;
    return handler(req, info);
  });
};

await import('https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/ac2c028e704ae5425ecb14368b721c899ec6462a/patches/calcular-frete-20260910/v14-dtf-uv-homologated.ts');
