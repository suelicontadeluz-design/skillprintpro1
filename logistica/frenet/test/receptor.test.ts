// Testes do PATCH 0 do receptor frenet-tracking-webhook.
// Rodar: node --experimental-strip-types --test logistica/frenet/test/receptor.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tratar, chaveEvento, resolverEnvioId, comparaSegura,
  type Deps, type Persistencia, type RegistroEvento,
} from '../receptor/patch0.ts';

const TOKEN_NAME = 'X-Frenet-Token';
const TOKEN_VALUE = 'segredo-de-teste-nao-e-de-producao';

function ambiente(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    FRENET_WEBHOOK_TOKEN_NAME: TOKEN_NAME,
    FRENET_WEBHOOK_TOKEN_VALUE: TOKEN_VALUE,
  };
  return (n: string) => (n in over ? over[n] : base[n]);
}

/** Persistencia em memoria + espioes de efeito colateral proibido. */
function memoria() {
  const vistos = new Map<string, RegistroEvento>();
  const persistencia: Persistencia = {
    async registrar(r) {
      if (vistos.has(r.chave_evento)) return false;
      vistos.set(r.chave_evento, r);
      return true;
    },
  };
  return { persistencia, vistos };
}

function req(body: unknown, headers: Record<string, string> = {}, metodo = 'POST'): Request {
  return new Request('https://receptor.test/frenet-tracking-webhook', {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: metodo === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

const EVENTO_OK = {
  OrderId: '11111111-1111-4111-8111-111111111111',
  ShipmentId: 987,
  TrackingNumber: 'AA123456789BR',
  TrackingUrl: 'https://rastreio.test/AA123456789BR',
  TrackingEvents: [{ EventType: 3, EventDescription: 'Em transito', EventDate: '2026-08-21T10:00:00Z' }],
};

// ------------------------------------------------------------ autenticacao

test('autenticado valido -> 200', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.duplicado, false);
  assert.equal(vistos.size, 1);
});

test('sem autenticacao -> 401 e nada persistido', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req(EVENTO_OK), { ler: ambiente(), persistencia });
  assert.equal(r.status, 401);
  assert.equal(vistos.size, 0);
});

test('autenticacao invalida -> 401 e nada persistido', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: 'errado' }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 401);
  assert.equal(vistos.size, 0);
});

test('token com prefixo correto mas tamanho diferente -> 401', async () => {
  const { persistencia } = memoria();
  const r = await tratar(
    req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE.slice(0, -1) }),
    { ler: ambiente(), persistencia },
  );
  assert.equal(r.status, 401);
});

test('segredo ausente no ambiente -> 503, nunca aceita tudo', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(
    req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }),
    { ler: ambiente({ FRENET_WEBHOOK_TOKEN_VALUE: undefined }), persistencia },
  );
  assert.equal(r.status, 503);
  assert.equal(vistos.size, 0);
});

test('metodo diferente de POST -> 405', async () => {
  const { persistencia } = memoria();
  const r = await tratar(req(null, {}, 'GET'), { ler: ambiente(), persistencia });
  assert.equal(r.status, 405);
});

test('comparaSegura e correta nos dois sentidos', () => {
  assert.equal(comparaSegura('abc', 'abc'), true);
  assert.equal(comparaSegura('abc', 'abd'), false);
  assert.equal(comparaSegura('abc', 'ab'), false);
});

// ------------------------------------------------------- validacao estrutural

test('json invalido -> 400 controlado', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req('{nao e json', { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 400);
  assert.equal(vistos.size, 0);
});

test('corpo que nao e objeto -> 400', async () => {
  const { persistencia } = memoria();
  const r = await tratar(req([1, 2, 3], { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 400);
});

test('evento sem nenhum identificador -> 422, nao 200 silencioso', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req({ TrackingEvents: [] }, { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 422);
  assert.equal(vistos.size, 0);
});

// ------------------------------------------------------------------- dedup

test('duplicata e deterministica: segundo POST nao grava de novo', async () => {
  const { persistencia, vistos } = memoria();
  const deps: Deps = { ler: ambiente(), persistencia };
  const a = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), deps);
  const b = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), deps);
  assert.equal((await a.json()).duplicado, false);
  assert.equal((await b.json()).duplicado, true);
  assert.equal(b.status, 200);
  assert.equal(vistos.size, 1);
});

test('evento novo do mesmo envio nao e tratado como duplicata', async () => {
  const { persistencia, vistos } = memoria();
  const deps: Deps = { ler: ambiente(), persistencia };
  await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), deps);
  const outro = {
    ...EVENTO_OK,
    TrackingEvents: [{ EventType: 9, EventDescription: 'Entregue', EventDate: '2026-08-22T14:00:00Z' }],
  };
  await tratar(req(outro, { [TOKEN_NAME]: TOKEN_VALUE }), deps);
  assert.equal(vistos.size, 2);
});

test('chaveEvento e estavel para o mesmo fato', () => {
  assert.equal(chaveEvento(EVENTO_OK), chaveEvento(JSON.parse(JSON.stringify(EVENTO_OK))));
});

// ------------------------------------------------------------ reconciliacao

test('OrderId uuid reconcilia com o nosso envio', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  const body = await r.json();
  assert.equal(body.reconciliado, true);
  assert.equal([...vistos.values()][0].envio_id, EVENTO_OK.OrderId);
});

test('OrderId que e telefone NAO vira vinculo inventado', async () => {
  const { persistencia, vistos } = memoria();
  const r = await tratar(
    req({ ...EVENTO_OK, OrderId: '5511999998888' }, { [TOKEN_NAME]: TOKEN_VALUE }),
    { ler: ambiente(), persistencia },
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.reconciliado, false);
  const reg = [...vistos.values()][0];
  assert.equal(reg.envio_id, null);
  assert.equal(reg.order_id, '5511999998888', 'o dado bruto continua observavel');
});

test('OrderId que e CPF ou email tambem nao reconcilia', () => {
  assert.equal(resolverEnvioId('39053344705'), null);
  assert.equal(resolverEnvioId('cliente@teste.test'), null);
  assert.equal(resolverEnvioId(null), null);
  assert.equal(resolverEnvioId('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
});

test('evento desconhecido fica observavel e NAO reconciliado', async () => {
  const { persistencia, vistos } = memoria();
  await tratar(
    req({ ShipmentId: 42, TrackingNumber: 'ZZ9' }, { [TOKEN_NAME]: TOKEN_VALUE }),
    { ler: ambiente(), persistencia },
  );
  const reg = [...vistos.values()][0];
  assert.equal(reg.reconciliado, false);
  assert.equal(reg.envio_id, null);
  assert.ok(reg.payload_bruto, 'payload bruto preservado');
});

// -------------------------------------------------------------- persistencia

test('falha de persistencia vira 500, nunca 200', async () => {
  const persistencia: Persistencia = { async registrar() { throw new Error('banco fora'); } };
  const r = await tratar(req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }), { ler: ambiente(), persistencia });
  assert.equal(r.status, 500);
});

// ------------------------------------------------- efeitos proibidos (guarda)

test('ZERO WhatsApp e ZERO efeito externo: nenhum fetch acontece', async () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = (async () => { chamadas++; return new Response('{}'); }) as typeof fetch;
  try {
    const { persistencia } = memoria();
    const deps: Deps = { ler: ambiente(), persistencia };
    for (const caso of [
      req(EVENTO_OK, { [TOKEN_NAME]: TOKEN_VALUE }),
      req(EVENTO_OK),
      req(EVENTO_OK, { [TOKEN_NAME]: 'errado' }),
      req('{quebrado', { [TOKEN_NAME]: TOKEN_VALUE }),
      req({ ...EVENTO_OK, OrderId: '5511999998888' }, { [TOKEN_NAME]: TOKEN_VALUE }),
      req({}, { [TOKEN_NAME]: TOKEN_VALUE }),
    ]) {
      await tratar(caso, deps);
    }
    assert.equal(chamadas, 0, 'o receptor nao pode chamar nenhum servico externo');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('o codigo executavel do receptor nao toca BotConversa nem envio de mensagem', async () => {
  const { readFile } = await import('node:fs/promises');
  const bruto = await readFile(new URL('../receptor/patch0.ts', import.meta.url), 'utf8');
  // Remove comentarios: a palavra pode aparecer legitimamente ao documentar
  // o que o receptor NAO faz. O que importa e o codigo executavel.
  const codigo = bruto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const proibido of ['botconversa', 'send_message', 'api-key', 'whatsapp', 'pixel_events']) {
    assert.equal(codigo.toLowerCase().includes(proibido), false, `encontrado no codigo: ${proibido}`);
  }
});
