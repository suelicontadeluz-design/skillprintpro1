import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  qpAsksQuantity,
  qpContextualQuantityAnswer,
  qpHasExplicitQuantityUnit,
  qpQuantityCandidate,
  qpCurrentApparelQuantity,
  qpIsAdjacentQuantityReply,
  qpSelectHistoricalExplicitQuantityEvidence,
} from '../patches/joao-p0-1177-live-v335/quantity-provenance-core-v1.mjs';

assert.equal(qpAsksQuantity('E aí, confirmou a quantidade de camisetas?'), true);
assert.equal(qpAsksQuantity('Quantas camisetas você precisa?'), true);
assert.equal(qpAsksQuantity('Você sabe se vai retirar aqui?'), false);

assert.equal(qpQuantityCandidate('Acredito que 10'), 10);
assert.equal(qpQuantityCandidate('umas 30'), 30);
assert.equal(qpQuantityCandidate('30 unidades'), 30);
assert.equal(qpQuantityCandidate('R$ 300'), null);
assert.equal(qpQuantityCandidate('300 reais'), null);
assert.equal(qpQuantityCandidate('posso enviar 300 agora e o restante depois'), null);
assert.equal(qpQuantityCandidate('arte 30x20'), null);
assert.equal(qpQuantityCandidate('CEP 05813-000'), null);
assert.equal(qpQuantityCandidate('23/09'), null);
assert.equal(qpQuantityCandidate('10 metros'), null);

assert.equal(
  qpCurrentApparelQuantity('camiseta','*João Barros:*\nQuantas camisetas você precisa?','Acredito que 10', true),
  10,
);
assert.equal(qpCurrentApparelQuantity('camiseta','Quantas camisetas você precisa?','10'), null,
  'unverified chronology cannot promote a contextual number');
assert.equal(qpCurrentApparelQuantity('camiseta','Quantas camisetas você precisa?','10', false), null);
assert.equal(qpCurrentApparelQuantity('camiseta','Quantas camisetas você precisa?','10', true), 10);
assert.equal(qpCurrentApparelQuantity('camiseta','Quantas camisetas você precisa?','10 e 20', true), null);

const q='2026-09-23T10:00:00.000Z';
const r='2026-09-23T10:01:00.000Z';
const owned=[{id:'current',created_at:r,phone:'5511999999999',body:{text:{message:'10'}}}];
const adjacent={questionAt:q,currentText:'10',ownedIds:['current'],inboundRows:owned,phone:'5511999999999',
  latestOutboundIsQuestion:true,interveningFactCount:0};
assert.equal(qpIsAdjacentQuantityReply(adjacent), true);
assert.equal(qpIsAdjacentQuantityReply({...adjacent,inboundRows:[
  {id:'other',created_at:'2026-09-23T10:00:30.000Z',phone:'5511999999999',body:{text:{message:'Outra dúvida'}}},...owned]}), false,
  'intermediate customer reply breaks attribution');
assert.equal(qpIsAdjacentQuantityReply({...adjacent,inboundRows:[
  {id:'other',created_at:r,phone:'5511999999999',body:{text:{message:'Oi'}}},...owned]}), false,
  'timestamp ties must fail closed');
assert.equal(qpIsAdjacentQuantityReply({...adjacent,ownedIds:['other','current']}), false,
  'batched replies do not prove adjacency');
assert.equal(qpIsAdjacentQuantityReply({...adjacent,currentText:'20'}), false,
  'text mismatch must not match another message');
assert.equal(qpIsAdjacentQuantityReply({...adjacent,interveningFactCount:1}), false,
  'facts outside the inbox can break adjacency');
assert.equal(qpIsAdjacentQuantityReply({...adjacent,latestOutboundIsQuestion:false}), false);
assert.equal(qpIsAdjacentQuantityReply({...adjacent,inboundRows:[]}), false);
assert.equal(qpIsAdjacentQuantityReply({...adjacent,inboundRows:[{...owned[0],created_at:q}]}), false);
assert.equal(qpCurrentApparelQuantity('dtf_textil','Quantas camisetas você precisa?','10'), null);
assert.equal(qpCurrentApparelQuantity('camiseta','Qual o valor?','R$ 300'), null);

assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['[imagem]','isso','30 unidades']),
  ['30 unidades'],
);
assert.deepEqual(
  qpSelectHistoricalExplicitQuantityEvidence(['na verdade 25','30 unidades']),
  [],
  'newer natural correction must prevent stale explicit quantity resurrection',
);

const dir=new URL('../patches/joao-p0-1177-live-v335/',import.meta.url);
const owner=fs.readFileSync(new URL('candidate-index.ts',dir),'utf8');
const v291=fs.readFileSync(new URL('v291-p0-1177.ts',dir),'utf8');
const v292=fs.readFileSync(new URL('v292.1-p0-1177.ts',dir),'utf8');
const v294=fs.readFileSync(new URL('v294-p0-1177.ts',dir),'utf8');

for (const name of ['quantidadeProdutoMacro','quantidadeApparelScope','perguntaQuantidadePendente','quantidadeAtualCandidata']) {
  const declared = owner.indexOf(`const ${name} =`);
  const consumed = owner.indexOf('const slotsParaProveniencia = {');
  assert.ok(declared >= 0 && declared < consumed, `${name} must be declared before the provenance filter`);
}
assert.match(owner,/qpCurrentApparelQuantity/);
assert.match(owner,/qpSelectHistoricalExplicitQuantityEvidence/);
assert.match(owner,/\.limit\(64\)/);
assert.match(owner,/inbounds\s*=\s*inboundsTodos\.slice\(0,\s*8\)/);
assert.match(owner,/allowContextualQuantity:\s*quantidadeApparelScope/);
assert.doesNotMatch(owner,/validateMultiArtEvidence|aggregateMultiArtPhysicalMeters|JOAO_P0_496_MULTIART/);

assert.match(v291,/import "\.\/candidate-index\.ts";/);
assert.doesNotMatch(v291,/dab2cd850f940c939d3dc132fe8b442f5be111b4\/patches\/joao-slot-proveniencia-escrita\/candidato\/index\.ts/);
assert.match(v292,/import "\.\/v291-p0-1177\.ts";/);
assert.match(v294,/import "\.\/v292\.1-p0-1177\.ts";/);

console.log('PASS joao P0 1177 live-v335 transplant');
