// Teste de regressão: cache do orchestrator v1.4 × retries "[SISTEMA: ...]" do core.
// Sem dependências. Roda em Node >= 22.6 (type stripping nativo para .ts).
//
//   node retry-cache-key.test.mjs <caminho-do-orchestrator-v1.4.ts> [v15=<caminho-v1.5.ts>]
//
// O módulo sob teste não exporta nada: ele substitui globalThis.fetch. O teste instala um fetch
// stub ANTES do import (vira o joBaseFetch do módulo), conta as chamadas que chegam ao "Anthropic"
// e inspeciona o body enviado. Cada chamada upstream devolve um id único; se duas chamadas do
// wrapper devolvem o mesmo id, houve dedupe (cache).

import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TARGET = process.argv[2];
const V15 = (process.argv.find(a => a.startsWith('v15=')) || '').slice(4);
if (!TARGET) { console.error('uso: node retry-cache-key.test.mjs <orchestrator-v1.4.ts> [v15=<v1.5.ts>]'); process.exit(2); }

globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'stub-key' })[k] } };

const upstream = { anthropic: [], audits: [] };
let upstreamId = 0;
let upstreamDecision = () => ({ responde: true, mensagem: 'ok' });
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/rest/v1/sistema_config')) return new Response(JSON.stringify([{ valor_bool: true }]), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('/rest/v1/sistema_logs')) { try { upstream.audits.push(JSON.parse(init.body)); } catch {} return new Response(null, { status: 201 }); }
  if (url.startsWith('https://api.anthropic.com/v1/messages')) {
    const body = JSON.parse(init.body);
    const id = ++upstreamId;
    upstream.anthropic.push({ id, body });
    const text = JSON.stringify({ ...upstreamDecision(body), _upstream_id: id });
    return new Response(JSON.stringify({ id: `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

if (V15) {
  // v1.5 importa v1.4 por URL raw pinada. Para o teste, reescreve o import para o arquivo local.
  const src = readFileSync(V15, 'utf8').replace(/import\s+"https:\/\/raw\.githubusercontent\.com[^"]*orchestrator-preload-v1\.4\.ts";/, `import "${pathToFileURL(path.resolve(TARGET)).href}";`);
  const tmp = path.join(path.dirname(path.resolve(V15)), '.v1.5-local-import.test-tmp.ts');
  writeFileSync(tmp, src);
  await import(pathToFileURL(tmp).href);
} else {
  await import(pathToFileURL(path.resolve(TARGET)).href);
}
const wrapped = globalThis.fetch;

// ---- helpers -------------------------------------------------------------------------------
const SYSTEM_BASE = 'Você é João. [FICHA: etapa=sondagem; slots={"produto":"dtf_uv","quantidade":10}. NÃO pergunte o preenchido.]';
function body(model, inbound, opts = {}) {
  const messages = [
    { role: 'assistant', content: 'Me passa o tamanho do adesivo?' },
    { role: 'user', content: inbound },
  ];
  if (opts.toolResult) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'calcular_rendimento_uv', input: {} }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: opts.toolResult }] });
  }
  if (opts.nudge) messages.push({ role: 'user', content: opts.nudge });
  return { model, max_tokens: 1100, system: SYSTEM_BASE + (opts.systemExtra || ''), messages, tools: [] };
}
async function call(b) {
  const r = await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json();
  const text = j.content?.[0]?.text ?? '';
  let d = null; try { d = JSON.parse(text); } catch {}
  return { status: r.status, decision: d, upstreamId: d?._upstream_id ?? null };
}
const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); }
function stageOf(sentSystem) { return sentSystem.match(/\[CORTEX JOURNEY v1 stage=([A-Z_]+)[^\]]*source=([A-Z_]+)\]/); }
function lastSentSystem() { return upstream.anthropic[upstream.anthropic.length - 1].body.system; }
const suppressedCount = () => upstream.audits.filter(a => a.evento === 'duplicate_model_call_suppressed').length;

// Nudges REAIS do core (candidato/index.ts @0bd29b65), truncados ao trecho estável.
const NUDGE_PRECO = '[SISTEMA: o cliente PEDIU PRECO e sua resposta nao trouxe valor em R$. Se ele perguntou o valor do METRO, MANDE A TABELA COMPLETA agora, uma faixa por linha. NAO pergunte medida de arte nem quantidade: ele quer a tabela, nao um orcamento. Chame a ferramenta correta e RESPONDA com os precos. Retorne APENAS o JSON.]';
const NUDGE_PIX = '[SISTEMA: o Pix foi prometido e nao foi gerado. Existe autorizacao ATIVA de R$59,90 com operation_id 3c1b7c0e-1d2a-4a0b-9d9c-0f1e2d3c4b5a. Chame gerar_pix AGORA com esse operation_id, copiado EXATAMENTE como esta: e um UUID, e PROIBIDO inventar ou montar um identificador. NAO ofereca outros produtos. Retorne APENAS o JSON.]';
const NUDGE_INVALIDA = (msg) => '[SISTEMA: sua resposta anterior foi invalida. Responda a ultima mensagem do cliente ("' + msg.slice(-120) + '") em 1-2 frases curtas. Se pediu preco, chame a ferramenta e traga o valor em R$. Retorne APENAS o JSON.]';

if (!V15) {
  // T1 — chamada realmente duplicada continua deduplicada.
  { const b = body('claude-t1', 'qual o tamanho do adesivo?');
    const a1 = await call(b); const a2 = await call(b);
    check('T1 original duplicado é deduplicado (mesmo upstream id)', a1.upstreamId === a2.upstreamId, `ids ${a1.upstreamId}/${a2.upstreamId}`); }

  // T2 — original + retry [SISTEMA:] NÃO pode ser deduplicado.
  { const before = suppressedCount();
    const a1 = await call(body('claude-t2', 'qual o valor do metro?'));
    const a2 = await call(body('claude-t2', 'qual o valor do metro?', { nudge: NUDGE_PRECO }));
    check('T2 original + retry de preço NÃO é deduplicado', a1.upstreamId !== a2.upstreamId, `ids ${a1.upstreamId}/${a2.upstreamId}; suppressed+${suppressedCount() - before}`); }

  // T3 — dois tipos diferentes de retry não colidem entre si nem com o original.
  { const a0 = await call(body('claude-t3', 'pix'));
    const a1 = await call(body('claude-t3', 'pix', { nudge: NUDGE_PIX }));
    const a2 = await call(body('claude-t3', 'pix', { nudge: NUDGE_INVALIDA('pix') }));
    const a1b = await call(body('claude-t3', 'pix', { nudge: NUDGE_PIX }));
    check('T3 retry pix ≠ retry inválida ≠ original', new Set([a0.upstreamId, a1.upstreamId, a2.upstreamId]).size === 3, `ids ${a0.upstreamId}/${a1.upstreamId}/${a2.upstreamId}`);
    check('T3b mesmo retry repetido continua deduplicado', a1.upstreamId === a1b.upstreamId, `ids ${a1.upstreamId}/${a1b.upstreamId}`); }

  // T4 — tool_result diferente continua não colidindo.
  { const a1 = await call(body('claude-t4', '6x6 quero 10', { toolResult: '{"ok":true,"total":59.9}' }));
    const a2 = await call(body('claude-t4', '6x6 quero 10', { toolResult: '{"ok":true,"total":79.9}' }));
    check('T4 tool_result diferente não colide', a1.upstreamId !== a2.upstreamId, `ids ${a1.upstreamId}/${a2.upstreamId}`); }

  // T5 — stage/inbound intactos, com e sem nudge (o nudge não pode mudar a jornada).
  const stageCases = [
    ['pix', 'CLOSING'], ['qual o valor', 'QUALIFICATION'], ['quero frete para 13503668', 'LOGISTICS'],
    ['já te passo', 'WAITING'], ['esse valor', 'QUALIFICATION'], ['estão prontas?', 'CONVERSATION'],
    ['quantos fornecedores vocês têm?', 'CONVERSATION'],
  ];
  const stageSnapshot = {};
  for (const [inbound, expected] of stageCases) {
    await call(body('claude-t5-' + expected, inbound));
    const m1 = stageOf(lastSentSystem());
    await call(body('claude-t5-' + expected, inbound, { nudge: NUDGE_INVALIDA(inbound) }));
    const m2 = stageOf(lastSentSystem());
    stageSnapshot[inbound] = { semNudge: m1?.[0], comNudge: m2?.[0] };
    check(`T5 "${inbound}" → stage=${expected} sem nudge`, m1?.[1] === expected, m1?.[0]);
    check(`T5 "${inbound}" → marcador idêntico com nudge`, m1?.[0] === m2?.[0], m2?.[0]);
  }

  // T7 — replay dos casos do relatório: prova SOMENTE que o retry executa de novo.
  const replay = [
    ['esse valor', NUDGE_PRECO],
    ['estão prontas?', NUDGE_INVALIDA('estão prontas?')],
    ['já foram feito tudo isso', NUDGE_INVALIDA('já foram feito tudo isso')],
    ['isso', NUDGE_INVALIDA('isso')],
    ['já pago 1500', NUDGE_INVALIDA('já pago 1500')],
    ['pix', NUDGE_PIX],
  ];
  const replayRows = [];
  for (const [inbound, nudge] of replay) {
    const before = suppressedCount();
    const a1 = await call(body('claude-replay', inbound));
    const a2 = await call(body('claude-replay', inbound, { nudge }));
    const reexecutou = a1.upstreamId !== a2.upstreamId;
    replayRows.push({ inbound, original: a1.upstreamId, retry: a2.upstreamId, retry_reexecutou: reexecutou, suppressed_log: suppressedCount() - before });
    check(`T7 replay "${inbound}": retry executa de novo`, reexecutou, `ids ${a1.upstreamId}/${a2.upstreamId}`);
  }
  console.log('\nREPLAY (retry deve re-executar):'); console.table(replayRows);
  console.log('JOURNEY snapshot (sem/com nudge):'); console.log(JSON.stringify(stageSnapshot, null, 1));
} else {
  // T6 — supplier fallback do v1.5 continua funcionando sobre o v1.4 alterado.
  upstreamDecision = () => ({ responde: false, mensagem: '', tema: 'complexo' });
  const b = body('claude-t6', 'quantos fornecedores vocês têm de camiseta 100% algodão?');
  const a = await call(b);
  check('T6 v1.5 supplier fallback: responde:false vira pergunta de esclarecimento', a.decision?.responde === true && /fornecedores/i.test(a.decision?.mensagem || ''), JSON.stringify(a.decision));
  const audit = upstream.audits.find(x => x.evento === 'supplier_no_silence_fallback_enforced');
  check('T6 audit supplier_no_silence_fallback_enforced emitido', !!audit);
  const m = stageOf(lastSentSystem());
  check('T6 stage CONVERSATION source=CURRENT_SUPPLIER_QUESTION', m?.[1] === 'CONVERSATION' && m?.[2] === 'CURRENT_SUPPLIER_QUESTION', m?.[0]);
}

// ---- relatório --------------------------------------------------------------------------
let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`); }
console.log(`\n${results.length - failed}/${results.length} passaram · upstream anthropic calls=${upstream.anthropic.length} · duplicate_model_call_suppressed=${suppressedCount()}`);
process.exit(failed ? 1 : 0);
