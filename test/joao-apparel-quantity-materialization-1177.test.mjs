import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  qpAsksQuantity,
  qpContextualQuantityAnswer,
  qpCurrentApparelQuantity,
  qpHasExplicitQuantityUnit,
  qpQuantityCandidate,
  qpRemoveQuantityQuestion,
  qpSelectHistoricalExplicitQuantityEvidence,
} from '../patches/joao-p0-496-multiart-20260923/quantity-provenance-core-v1.mjs';

// P0 #1177 — contextual Q&A must survive natural wording.
assert.equal(qpAsksQuantity('E aí, confirmou a quantidade de camisetas?'), true);
assert.equal(qpAsksQuantity('Quantas camisetas você precisa?'), true);
assert.equal(qpAsksQuantity('Me confirma a quantidade, por favor?'), true);
assert.equal(qpAsksQuantity('Conseguiu definir a quantidade?'), true);

// Generic conversational verbs are intentionally insufficient.
assert.equal(qpAsksQuantity('Você sabe se vai retirar aqui?'), false);
assert.equal(qpAsksQuantity('Vamos fechar o pedido?'), false);

assert.equal(qpContextualQuantityAnswer(10, 'Acredito que 10'), true);
assert.equal(qpContextualQuantityAnswer(30, 'umas 30'), true);
assert.equal(qpContextualQuantityAnswer(20, 'seriam 20'), true);
assert.equal(qpContextualQuantityAnswer(30, '30'), true);

// Financial/remittance regression sentinels: must never become quantity.
assert.equal(qpContextualQuantityAnswer(300, 'R$ 300'), false);
assert.equal(qpContextualQuantityAnswer(300, '300 reais'), false);
assert.equal(qpContextualQuantityAnswer(300, 'posso enviar 300 agora e o restante depois'), false);
assert.equal(qpContextualQuantityAnswer(300, 'paguei 300 no pix'), false);
assert.equal(qpContextualQuantityAnswer(30, '30,00'), false);

// Other numeric domains must not be promoted as contextual quantity.
assert.equal(qpContextualQuantityAnswer(30, 'arte 30x20'), false);
assert.equal(qpContextualQuantityAnswer(58130, 'CEP 05813-000'), false);
assert.equal(qpContextualQuantityAnswer(23, '23/09'), false);

assert.equal(qpHasExplicitQuantityUnit('30 unidades'), true);
assert.equal(qpHasExplicitQuantityUnit('20 camisetas'), true);
assert.equal(qpHasExplicitQuantityUnit('5 peças'), true);
assert.equal(qpHasExplicitQuantityUnit('R$ 300'), false);
assert.equal(qpHasExplicitQuantityUnit('Acredito que 10'), false);
assert.equal(qpHasExplicitQuantityUnit('10 metros'), false);

assert.equal(qpQuantityCandidate('Acredito que 10'), 10);
assert.equal(qpQuantityCandidate('30 camisetas'), 30);
assert.equal(qpQuantityCandidate('30 camisetas, pago no Pix'), 30);
assert.equal(qpQuantityCandidate('10 metros'), null);
assert.equal(qpQuantityCandidate('R$ 300'), null);
assert.equal(qpQuantityCandidate('posso enviar 300 agora e o restante depois'), null);
assert.equal(qpQuantityCandidate('99999 camisetas'), 99999);
assert.equal(qpQuantityCandidate('100000 camisetas'), null);

// Runtime gating is executable, not only source-presence checked.
assert.equal(
  qpCurrentApparelQuantity('camiseta', 'Quantas camisetas você precisa?', 'Acredito que 10'),
  10,
);
assert.equal(
  qpCurrentApparelQuantity('dtf_textil', 'Quantas unidades você precisa?', 'Acredito que 10'),
  null,
);
assert.equal(qpCurrentApparelQuantity('camiseta', 'Perfeito.', '30 camisetas'), 30);
assert.equal(qpCurrentApparelQuantity('camiseta', 'Quantas camisetas?', 'R$ 300'), null);

// History is newest-first: explicit newest wins; natural correction invalidates older
// explicit evidence so "30 unidades" cannot resurrect after "na verdade 25".
assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['20 camisetas', '30 unidades']),
  ['20 camisetas'],
);
assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['na verdade 25', '30 unidades']),
  [],
);
assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['ok', '30 unidades', '20 unidades']),
  ['30 unidades'],
);
assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['R$ 300', '30 unidades']),
  ['30 unidades'],
);

assert.equal(
  qpRemoveQuantityQuestion('Perfeito. E aí, confirmou a quantidade de camisetas?'),
  'Perfeito.',
);

// Integration guard: source must use the pure core and a quantity-only extended history.
const sourcePath = new URL('../patches/joao-p0-496-multiart-20260923/candidate-index.ts', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /qpAsksQuantity/);
assert.match(source, /qpContextualQuantityAnswer/);
assert.match(source, /qpHasExplicitQuantityUnit/);
assert.match(source, /evidenciasQuantidadeExplicitas/);
assert.match(source, /\.limit\(64\)/);
assert.match(source, /inbounds\s*=\s*inboundsTodos\.slice\(0,\s*8\)/);
assert.match(source, /qpSelectHistoricalExplicitQuantityEvidence/);
assert.match(source, /order\('timestamp',\s*\{\s*ascending:\s*false\s*\}\)\.limit\(64\)/);
assert.match(source, /perguntaQuantidadePendente:\s*qpAsksQuantity/);
assert.match(source, /allowContextualQuantity:\s*quantidadeApparelScope/);
assert.match(source, /const\s+perguntaQuantidadePendente\s*=\s*qpAsksQuantity/);
assert.match(source, /const\s+quantidadeAtualCandidata\s*=\s*qpCurrentApparelQuantity/);
assert.match(source, /quantidadeAtualCandidata\s*!==\s*null\s*\?\s*\{\s*quantidade:\s*quantidadeAtualCandidata\s*\}/);
assert.match(source, /normalizarProdutoMacro\(slotsParaProveniencia\.produto[\s\S]*?===\s*'camiseta'/);

// The historical extension is passed only to quantity evidence, not folded into textosCliente.
assert.doesNotMatch(
  source,
  /const\s+textosCliente[^;]*evidenciasQuantidadeExplicitas/,
  'extended quantity evidence must not widen provenance for other critical slots',
);
assert.match(
  source,
  /a\.allowContextualQuantity\s*===\s*true[\s\S]*?a\.evidenciasQuantidadeExplicitas/,
  'durable evidence must be gated to apparel scope',
);

console.log('PASS P0 #1177 apparel quantity provenance', {
  contextual: ['Acredito que 10', 'umas 30', 'seriam 20'],
  blocked_financial: ['R$ 300', '300 reais', 'posso enviar 300 agora e o restante depois'],
  durable_explicit: ['30 unidades', '20 camisetas'],
});
