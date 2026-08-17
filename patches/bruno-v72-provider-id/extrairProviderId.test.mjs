// Testes da função pura extrairProviderId. Rodar com: node --test
// Sem dependência externa: node:test + node:assert, direto no Node 22.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairProviderId } from './extrairProviderId.mjs';

// --- 1. Formatos que DEVEM render id -----------------------------------------

test('id no topo', () => {
  const r = extrairProviderId('{"id":"abc-123"}');
  assert.equal(r.id, 'abc-123');
  assert.equal(r.origem, 'id');
  assert.equal(r.forma, 'objeto');
});

test('id numerico vira string', () => {
  const r = extrairProviderId('{"id":987654}');
  assert.equal(r.id, '987654');
  assert.equal(r.origem, 'id');
});

test('message_id quando nao ha id', () => {
  const r = extrairProviderId('{"status":"ok","message_id":"m-77"}');
  assert.equal(r.id, 'm-77');
  assert.equal(r.origem, 'message_id');
});

test('aninhado em data', () => {
  const r = extrairProviderId('{"data":{"id":"d-1"}}');
  assert.equal(r.id, 'd-1');
  assert.equal(r.origem, 'data.id');
});

test('resposta em lista usa o primeiro elemento', () => {
  const r = extrairProviderId('[{"id":"l-1"},{"id":"l-2"}]');
  assert.equal(r.id, 'l-1');
  assert.equal(r.forma, 'array');
});

test('id cru sem envelope', () => {
  const r = extrairProviderId('"cru-42"');
  assert.equal(r.id, 'cru-42');
  assert.equal(r.origem, 'raiz_escalar');
});

test('precedencia: id ganha de message_id', () => {
  const r = extrairProviderId('{"message_id":"perdedor","id":"vencedor"}');
  assert.equal(r.id, 'vencedor');
});

// --- 2. O caso que mais importa: formato DESCONHECIDO -------------------------
// Não pode inventar id, e tem de entregar diagnóstico utilizável.

test('formato desconhecido devolve null E as chaves reais', () => {
  const r = extrairProviderId('{"ticket":"t-9","enviado":true,"fila":3}');
  assert.equal(r.id, null, 'NAO pode inventar id');
  assert.equal(r.origem, null);
  assert.deepEqual(r.chaves, ['ticket', 'enviado', 'fila']);
  assert.equal(r.forma, 'objeto');
});

test('chaves sao limitadas a 20 para nao inflar o contexto', () => {
  const obj = {};
  for (let i = 0; i < 50; i++) obj[`k${i}`] = i;
  const r = extrairProviderId(JSON.stringify(obj));
  assert.equal(r.chaves.length, 20);
});

// --- 3. Entradas hostis: nunca lançar ----------------------------------------

for (const [nome, entrada, forma] of [
  ['null', null, 'vazio'],
  ['undefined', undefined, 'vazio'],
  ['string vazia', '', 'vazio'],
  ['so espaco', '   ', 'vazio'],
  ['json invalido', '{quebrado', 'nao_json'],
  ['html de erro', '<html>502</html>', 'nao_json'],
  ['corpo truncado em 500 chars', '{"id":"abc", "texto":"' + 'x'.repeat(600), 'nao_json'],
  ['literal null', 'null', 'vazio'],
]) {
  test(`nao lanca: ${nome}`, () => {
    const r = extrairProviderId(entrada);
    assert.equal(r.id, null);
    assert.equal(r.forma, forma);
  });
}

test('valores lixo nao viram id', () => {
  for (const corpo of ['{"id":""}', '{"id":"   "}', '{"id":null}', '{"id":true}', '{"id":{}}', '{"id":[]}', '{"id":"null"}']) {
    assert.equal(extrairProviderId(corpo).id, null, `deveria rejeitar: ${corpo}`);
  }
});

test('id gigante e truncado em 200', () => {
  const r = extrairProviderId(JSON.stringify({ id: 'y'.repeat(500) }));
  assert.equal(r.id.length, 200);
});

// --- 4. Invariante de seguranca ----------------------------------------------
// A função não tem como influenciar a decisão de envio: ela só devolve dados.
// Este teste trava a assinatura para que ninguém a transforme em decisor depois.

test('nunca devolve campo que pareca decisao de envio', () => {
  const r = extrairProviderId('{"id":"x","estado":"rejeitado","ok":false}');
  assert.deepEqual(Object.keys(r).sort(), ['chaves', 'forma', 'id', 'origem']);
  assert.equal(r.id, 'x');
});
