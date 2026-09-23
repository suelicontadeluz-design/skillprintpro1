import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  qpAsksQuantity,
  qpContextualQuantityAnswer,
  qpHasExplicitQuantityUnit,
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

// Integration guard: source must use the pure core and a quantity-only extended history.
const sourcePath = new URL('../patches/joao-p0-496-multiart-20260923/candidate-index.ts', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /qpAsksQuantity/);
assert.match(source, /qpContextualQuantityAnswer/);
assert.match(source, /qpHasExplicitQuantityUnit/);
assert.match(source, /evidenciasQuantidadeExplicitas/);
assert.match(source, /\.limit\(64\)/);
assert.match(source, /perguntaQuantidadePendente:\s*qpAsksQuantity/);

// The historical extension is passed only to quantity evidence, not folded into textosCliente.
assert.doesNotMatch(
  source,
  /const\s+textosCliente[^;]*evidenciasQuantidadeExplicitas/,
  'extended quantity evidence must not widen provenance for other critical slots',
);

console.log('PASS P0 #1177 apparel quantity provenance', {
  contextual: ['Acredito que 10', 'umas 30', 'seriam 20'],
  blocked_financial: ['R$ 300', '300 reais', 'posso enviar 300 agora e o restante depois'],
  durable_explicit: ['30 unidades', '20 camisetas'],
});
