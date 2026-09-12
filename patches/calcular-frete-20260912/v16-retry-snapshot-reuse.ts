// calcular-frete v16 — 12/09/2026
// Correção estreita para retry/supersede do João em DTF UV.
// Antes do guard v15, reutiliza SOMENTE um snapshot de frete fresco, sale-backed e do mesmo pedido/CEP/consumo.
// Se qualquer prova divergir, não afrouxa nada: cai integralmente no v15 existente.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const V16_SB_URL = Deno.env.get('SUPABASE_URL')!;
const V16_SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const V16_CRON_SECRET_SHA256 = '6aa7bec30538035f4fe659bdb8e12bb8966bc51703702eda43c6f3b3e94b2f8c';
const V16_CONFIG_KEY = 'joao_freight_retry_snapshot_reuse_v1_ativo';
const V16_MAX_SNAPSHOT_AGE_MS = 20 * 60 * 1000;
const v16sb = createClient(V16_SB_URL, V16_SB_KEY);
let v16CfgAt = 0;
let v16Cfg = false;

function v16json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function v16norm(s: any): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function v16cep(s: any): string { return String(s ?? '').replace(/\D/g, ''); }
function v16isUvProduct(s: any): boolean {
  const n = v16norm(s).replace(/-/g, '_');
  return /dtf[_\s]*uv|adesivo[_\s]*uv/.test(n);
}
function v16itemsAreUv(items: any[]): boolean {
  return Array.isArray(items) && items.length > 0 && items.every((i: any) =>
    String(i?.produto_id ?? '') === 'd48addf9-2b53-482f-8f28-1dfc7ea7c123' || /dtf\s*uv/i.test(String(i?.descricao ?? ''))
  );
}
function v16uvConsumption(items: any[]): number | null {
  if (!Array.isArray(items) || !items.length) return null;
  let total = 0;
  for (const i of items) {
    const n = Number(i?.uv_consumo_m);
    if (!Number.isFinite(n) || n <= 0) return null;
    total += n;
  }
  return Number(total.toFixed(4));
}
function v16money(n: any): string {
  const v = Number(n);
  return Number.isFinite(v) ? `R$${v.toFixed(2).replace('.', ',')}` : '';
}
function v16deadline(o: any): string {
  if (o?.prazo_formatado) return String(o.prazo_formatado);
  const d = Number(o?.prazo_dias);
  return Number.isFinite(d) ? `${d} dia${d === 1 ? '' : 's'} uteis` : '';
}
async function v16sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function v16authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${V16_SB_KEY}`) return true;
  const cron = req.headers.get('x-cron-secret') || '';
  if (!cron) return false;
  try { return (await v16sha256(cron)) === V16_CRON_SECRET_SHA256; } catch { return false; }
}
async function v16enabled(): Promise<boolean> {
  if (Date.now() - v16CfgAt < 15000) return v16Cfg;
  v16CfgAt = Date.now();
  try {
    const { data, error } = await v16sb.from('sistema_config')
      .select('valor_bool').eq('chave', V16_CONFIG_KEY).limit(1);
    if (!error && Array.isArray(data) && data.length) v16Cfg = data[0]?.valor_bool === true;
  } catch {}
  return v16Cfg;
}
async function v16stateByCep(cep: string): Promise<{ leadId: string; product: string } | null> {
  const { data, error } = await v16sb.from('agente_noturno_estado')
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
async function v16latestReceipt(leadId: string): Promise<any | null> {
  const { data, error } = await v16sb.from('joao_erp_proposal_receipts_v1')
    .select('receipt_id,operation_id,lead_id,proposta_id,numero_proposta,proposal_total_brl,created_at,canonical,snapshot')
    .eq('lead_id', leadId).eq('canonical', true)
    .order('created_at', { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return data[0];
}
async function v16freshReusableSnapshot(leadId: string, cep: string, metros: number, receipt: any): Promise<any | null> {
  const since = new Date(Date.now() - V16_MAX_SNAPSHOT_AGE_MS).toISOString();
  const { data, error } = await v16sb.from('joao_freight_quote_snapshots')
    .select('quote_id,lead_id,phone,cep_destino,metros,opcoes,source_tool,source_evidence,quoted_at,quote_document,shipment_kind,quantidade_logistica,unidade_logistica,peso_kg,caixa_cm,valor_declarado_brl')
    .eq('lead_id', leadId)
    .eq('cep_destino', cep)
    .eq('shipment_kind', 'dtf_uv')
    .gte('quoted_at', since)
    .order('quoted_at', { ascending: false })
    .limit(20);
  if (error || !data?.length) return null;

  const receiptItems = Array.isArray(receipt?.snapshot?.items) ? receipt.snapshot.items : [];
  const receiptMeters = v16uvConsumption(receiptItems);
  if (!v16itemsAreUv(receiptItems) || !receiptMeters || Math.abs(receiptMeters - metros) > 0.005) return null;

  for (const row of data) {
    const q = Number(row?.quantidade_logistica ?? row?.metros ?? 0);
    if (!Number.isFinite(q) || Math.abs(q - metros) > 0.005) continue;
    if (!Array.isArray(row?.opcoes) || row.opcoes.length === 0) continue;

    const ev = row?.source_evidence ?? {};
    const sameProposal = String(ev?.proposta_id ?? '') === String(receipt?.proposta_id ?? '');
    const sameNumber = Number(ev?.numero_proposta) === Number(receipt?.numero_proposta);
    const snapValue = Number(ev?.valor_venda_brl ?? row?.valor_declarado_brl);
    const receiptValue = Number(receipt?.proposal_total_brl);
    const sameValue = Number.isFinite(snapValue) && Number.isFinite(receiptValue) && Math.abs(snapValue - receiptValue) < 0.01;
    const sameShipment = String(ev?.shipment_kind ?? row?.shipment_kind ?? '') === 'dtf_uv';
    const sameEvidenceQty = Number.isFinite(Number(ev?.quantity_value)) ? Math.abs(Number(ev.quantity_value) - metros) <= 0.005 : true;

    if (sameProposal && sameNumber && sameValue && sameShipment && sameEvidenceQty) return row;
  }
  return null;
}
async function v16audit(detail: any) {
  try {
    await v16sb.from('sistema_logs').insert({
      agente_slug: 'calcular-frete',
      funcao: 'joao-freight-retry-snapshot-reuse',
      versao: 'calcular-frete/v16',
      nivel: 'info',
      categoria: 'freight_runtime',
      evento: 'fresh_sale_backed_snapshot_reused',
      status: 'applied',
      mensagem: 'same_order_same_cep_same_consumption',
      detalhe: detail,
    });
  } catch {}
}
async function v16guard(req: Request): Promise<Response | null> {
  if (req.method !== 'POST') return null;
  if (!(await v16authorized(req))) return null;
  if (!(await v16enabled())) return null;

  let body: any;
  try { body = await req.clone().json(); } catch { return null; }
  const cep = v16cep(body?.cep_destino);
  const metros = Number(body?.metros ?? 0);
  if (cep.length !== 8 || !Number.isFinite(metros) || metros <= 0) return null;

  const state = await v16stateByCep(cep);
  if (!state || !v16isUvProduct(state.product)) return null;

  const receipt = await v16latestReceipt(state.leadId);
  if (!receipt) return null;

  const snapshot = await v16freshReusableSnapshot(state.leadId, cep, metros, receipt);
  if (!snapshot) return null;

  const opcoes = snapshot.opcoes as any[];
  const linhas = opcoes.map((o: any) => {
    const preco = o?.preco_formatado || v16money(o?.preco);
    const prazo = v16deadline(o);
    return `${o?.servico || o?.transportadora || 'Frete'} - ${preco}${prazo ? ` - ${prazo}` : ''}`;
  });
  const ev = snapshot.source_evidence ?? {};
  const caixa = String(snapshot.caixa_cm ?? ev?.freight_box_cm ?? '');
  const caixaFmt = caixa && /cm$/i.test(caixa) ? caixa : (caixa ? `${caixa}cm` : null);

  void v16audit({
    lead_id: state.leadId,
    cep_suffix: cep.slice(-3),
    quote_id: snapshot.quote_id,
    original_quoted_at: snapshot.quoted_at,
    proposta_id: receipt.proposta_id,
    numero_proposta: receipt.numero_proposta,
    metros,
    options_count: opcoes.length,
  });

  return v16json({
    ok: true,
    cep_origem: '06813230',
    cep_destino: cep,
    shipment_kind: 'dtf_uv',
    quantidade_logistica: Number(snapshot.quantidade_logistica ?? metros),
    unidade_logistica: snapshot.unidade_logistica ?? 'metros',
    valor_declarado: Number(snapshot.valor_declarado_brl ?? receipt.proposal_total_brl),
    valor_declarado_source: 'proposal_total_brl',
    proposta: {
      id: receipt.proposta_id,
      numero: receipt.numero_proposta,
      receipt_id: ev?.proposal_receipt_id ?? receipt.receipt_id,
      latest_receipt_id: receipt.receipt_id,
    },
    embalagem: {
      caixa: caixaFmt,
      peso_kg: Number(snapshot.peso_kg ?? ev?.freight_weight_kg ?? 0) || null,
      regra_peso: ev?.freight_weight_rule ?? null,
      cubagem_estimada: ev?.cubage_estimated === true,
    },
    opcoes,
    quote_snapshot_id: snapshot.quote_id,
    quote_snapshot_status: 'REUSED_FRESH',
    retry_snapshot_reused: true,
    retry_reuse_reason: 'same_order_same_cep_same_consumption',
    original_quoted_at: snapshot.quoted_at,
    regra_saida: 'OBRIGATORIO: mostrar TODAS as opcoes retornadas para este CEP, cada uma com servico + valor + prazo. Snapshot fresco e sale-backed reutilizado; NAO diga que o CEP esta sem cobertura.',
    resposta_cliente_pronta: `CEP ${cep}:\n${linhas.join('\n')}`,
  });
}

// Wrapper externo ao v15: se não houver snapshot reaproveitável, o comportamento anterior fica 100% intacto.
const v16Deno: any = Deno as any;
const v16OriginalServe = v16Deno.serve.bind(Deno);
v16Deno.serve = (arg1: any, arg2?: any) => {
  if (typeof arg1 === 'function') {
    const handler = arg1;
    return v16OriginalServe(async (req: Request, info: any) => {
      const reused = await v16guard(req);
      if (reused) return reused;
      return handler(req, info);
    });
  }
  const options = arg1;
  const handler = arg2;
  return v16OriginalServe(options, async (req: Request, info: any) => {
    const reused = await v16guard(req);
    if (reused) return reused;
    return handler(req, info);
  });
};

await import('https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/a39391f920e467fc331be44739da5de9c14ab2f5/patches/calcular-frete-20260910/v15-current-order-context-guard.ts');
