import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SHADOW_URL = process.env.FREIGHT_PHASE1_SHADOW_URL || '';
const CRON_SECRET = process.env.INTERNAL_EDGE_CRON_SECRET || '';

function requireDb() {
  assert.ok(URL, 'SUPABASE_URL is required');
  assert.ok(KEY, 'SUPABASE_SERVICE_ROLE_KEY is required');
}
async function rpc(name, args) {
  requireDb();
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  assert.equal(res.ok, true, `${name} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function rows(path) {
  requireDb();
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
  });
  const data = await res.json().catch(() => null);
  assert.equal(res.ok, true, `GET ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
function proposal(action, extra = {}) {
  return { schema_version: 'freight-state-proposal/v1', action, ...extra };
}
async function apply(sessionId, expectedVersion, p, extra = {}) {
  return rpc('fn_joao_shipping_state_apply_v1', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_proposal: p,
    p_lead_id: extra.leadId ?? null,
    p_phone: extra.phone ?? null,
    p_source_turn_id: null,
    p_source_replay_case_id: extra.replayCaseId ?? null,
    p_is_replay: true,
    p_as_of: new Date().toISOString(),
  });
}
async function current(sessionId) {
  return rpc('fn_joao_shipping_state_current_v1', { p_session_id: sessionId });
}
async function render(sessionId) {
  return rpc('fn_joao_shipping_render_v1', { p_session_id: sessionId });
}
function extractPrice(text) {
  const m = String(text).match(/R\$\s*([0-9.]+,[0-9]{2})/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}
function asksZip(text) {
  return /(qual|me passa|informe|manda|passe|passa)[^.!?\n]{0,70}cep/i.test(String(text));
}

// Prompt-pruning gate: shipping may exist in comments/adapter files, but never in João's injected system blocks.
test('Prompt gate: João orchestrator injects no shipping authority', async () => {
  const source = await readFile(new URL('../patches/joao-skill-orchestrator-20260915/orchestrator-preload-v1.6-no-shipping.ts', import.meta.url), 'utf8');
  const injected = [...source.matchAll(/body\.system\s*\+=\s*`([\s\S]*?)`;/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(injected, /\b(?:cep|frete|sedex|pac|transportadora|calcular_frete|LOGISTICS)\b/i);
  const keep = source.match(/const keep\s*=\s*\[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(keep, /cep|envio_retirada|modalidade_logistica/i);

  const candidate = await readFile(new URL('../patches/agente-noturno-index-20260915/v294-freight-agent-phase1-candidate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(candidate, /joao-freight-comparison-20260909/);
  assert.doesNotMatch(candidate, /joao-freight-choice-context-20260912/);
});

test('Metric 1: canonical ZIP survives process/model context loss', async () => {
  const sessionId = `replay:${randomUUID()}:zip-retention`;
  const first = await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '06800000', source: 'REPLAY' }));
  assert.equal(first.code, 'STATE_COMMITTED');

  // A fresh HTTP/RPC read has no worker-memory dependency.
  const afterRestartEquivalent = await current(sessionId);
  assert.equal(afterRestartEquivalent.shipping_state.zip_code, '06800000');
  assert.equal(afterRestartEquivalent.state_version, 1);
});

test('Metric 4 + Metric 3: historical quote renders exactly DB price and never re-asks ZIP', async () => {
  const quoteRows = await rows('joao_freight_quote_snapshots?select=quote_id,lead_id,phone,cep_destino,opcoes&phone=eq.5511979979637&cep_destino=eq.04328055&order=quoted_at.desc&limit=1');
  assert.equal(quoteRows.length, 1, 'historical quote 04328055 missing');
  const q = quoteRows[0];
  const sessionId = `replay:${randomUUID()}:historical-zip-loss`;

  const z = await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '04328055', source: 'HISTORICAL_REPLAY' }), { leadId: q.lead_id, phone: q.phone });
  assert.equal(z.code, 'STATE_COMMITTED');
  const qr = await apply(sessionId, 1, proposal('QUOTE_RECORDED', { quote_snapshot_id: q.quote_id }), { leadId: q.lead_id, phone: q.phone });
  assert.equal(qr.code, 'STATE_COMMITTED');

  const canonical = await current(sessionId);
  const rendered = await render(sessionId);
  const persistedPrice = Number(canonical.shipping_state.quotes[0].preco);
  const renderedPrice = extractPrice(rendered.text);

  assert.equal(renderedPrice, persistedPrice, 'Metric 4 DB/render divergence');
  assert.equal(asksZip(rendered.text), false, 'Metric 3 ZIP re-asked despite canonical ZIP');
  assert.equal(rendered.must_not_ask_zip, true);
});

test('Historical selection by price resolves exactly one canonical quote', async () => {
  const quoteRows = await rows('joao_freight_quote_snapshots?select=quote_id,lead_id,phone,cep_destino,opcoes&cep_destino=eq.35430225&order=quoted_at.desc&limit=1');
  assert.equal(quoteRows.length, 1);
  const q = quoteRows[0];
  assert.ok(q.opcoes.some((o) => Number(o.preco) === 20.76));
  const sessionId = `replay:${randomUUID()}:selection-20-76`;

  await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '35430225' }), { leadId: q.lead_id, phone: q.phone });
  await apply(sessionId, 1, proposal('QUOTE_RECORDED', { quote_snapshot_id: q.quote_id }), { leadId: q.lead_id, phone: q.phone });
  const selected = await apply(sessionId, 2, proposal('QUOTE_SELECTED', { price: 20.76 }), { leadId: q.lead_id, phone: q.phone });
  assert.equal(selected.code, 'STATE_COMMITTED');
  assert.equal(Number(selected.shipping_state.selected_quote.preco), 20.76);
  const rendered = await render(sessionId);
  assert.equal(extractPrice(rendered.text), 20.76);
});

test('State machine: stale worker and silent ZIP replacement are fail-closed', async () => {
  const sessionId = `replay:${randomUUID()}:concurrency`;
  await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '06800000' }));

  const stale = await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '04751050' }));
  assert.equal(stale.code, 'STATE_VERSION_CONFLICT');

  const silent = await apply(sessionId, 1, proposal('ZIP_PROVIDED', { zip_code: '04751050' }));
  assert.equal(silent.code, 'ZIP_CHANGE_REQUIRES_EXPLICIT_CUSTOMER');
  const c = await current(sessionId);
  assert.equal(c.shipping_state.zip_code, '06800000');
});

test('State machine: selection without VALID_QUOTE is blocked', async () => {
  const sessionId = `replay:${randomUUID()}:select-without-quote`;
  await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: '06800000' }));
  const result = await apply(sessionId, 1, proposal('QUOTE_SELECTED', { service: 'Sedex' }));
  assert.equal(result.code, 'VALID_QUOTE_REQUIRED');
});

test('Full shadow pipeline: canonical state wins over model text', { skip: !(SHADOW_URL && CRON_SECRET) }, async () => {
  const quoteRows = await rows('joao_freight_quote_snapshots?select=quote_id,lead_id,phone,cep_destino,opcoes&phone=eq.5511979979637&cep_destino=eq.04328055&order=quoted_at.desc&limit=1');
  const q = quoteRows[0];
  const sessionId = `shadow-replay:${randomUUID()}`;
  await apply(sessionId, 0, proposal('ZIP_PROVIDED', { zip_code: q.cep_destino, source: 'HISTORICAL_REPLAY' }), { leadId: q.lead_id, phone: q.phone });
  await apply(sessionId, 1, proposal('QUOTE_RECORDED', { quote_snapshot_id: q.quote_id }), { leadId: q.lead_id, phone: q.phone });

  const res = await fetch(SHADOW_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify({ phone: q.phone, chat_name: 'Replay Phase 1', mensagem: 'Qual o frete?', _dry_run: true, _shipping_session_id: sessionId }),
  });
  const body = await res.json();
  assert.equal(res.ok, true);
  assert.equal(body.freight_phase1?.gate, 'CANONICAL_SESSION_STATE');
  assert.equal(body.freight_phase1?.status, 'VALID_QUOTE');
  assert.equal(extractPrice(body.resposta), Number(q.opcoes[0].preco));
  assert.equal(asksZip(body.resposta), false);
});
