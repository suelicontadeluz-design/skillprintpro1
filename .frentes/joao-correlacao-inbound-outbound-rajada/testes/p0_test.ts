// Matriz T1..T10 do P0 joao-correlacao-inbound-outbound-rajada.
// Todo codigo sob teste e fatia LITERAL do index.ts patchado (ver extrair.py).
// Nenhum cliente real e tocado: telefones sinteticos 5500..., transporte stubado.
import { assert, assertEquals, assertFalse } from './assert.ts';
import { db, txt, setLockDisponivel, setInterno, transportar } from './stubs.ts';
import {
  barreiraFinal, formarLoteWebhook, loteDoSweep, carimbarInbound,
  inboundMaisNovoQue, atenderCliente,
} from './alvo_gerado.ts';

const FONE = '5500000000001';                 // sintetico. NUNCA um telefone real.
const T = (ms: number) => new Date(Date.now() - ms).toISOString();

function ctx(ids: any[]) {
  return { tema: 'venda', tools: [], phone_final: FONE.slice(-4), execution_id: 'exec-1', turn_id: 'turn-1', owned_inbound_ids: ids.map(String) };
}
// Turno completo do fluxo principal: barreira -> transporte -> carimbo.
// A ordem e a mesma do index.ts: nada e carimbado antes do envio confirmado.
async function turno(ids: any[] | null, loteMax: string | null, decisionId = 'dec-1') {
  const b = await barreiraFinal({ dryRun: false, phone: FONE, idsParaCarimbar: ids, loteCreatedAtMax: loteMax, decisionId, turnId: 'turn-1', executionId: 'exec-1', contextoDecisao: ctx(ids || []) });
  if (b.bloqueou) return b.retorno;
  transportar(FONE, 'resposta');
  await carimbarInbound(FONE, ids, 'atendido_joao');
  return { ok: true, respondeu: true };
}
const status = (id: string) => db.inbound.find((r) => r.id === id)?.status;

// ── T1 — simples ─────────────────────────────────────────────────────────────
Deno.test('T1 envia A e carimba somente A', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(60000)), txt('Z', '5500000000009', T(1000)));
  const lote = await formarLoteWebhook(FONE, 'A');
  assertEquals(lote.idsDoLote, ['A']);
  const r = await turno(lote.idsDoLote, lote.loteCreatedAtMax);
  assertEquals(r.respondeu, true);
  assertEquals(db.transportes.length, 1);
  assertEquals(status('A'), 'atendido_joao');
  assertEquals(status('Z'), 'pendente');            // outro telefone intocado
});

// ── T2 — rajada antes do debounce ────────────────────────────────────────────
Deno.test('T2 lote A+B, uma resposta, carimbo so pos-envio', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(90000)), txt('B', FONE, T(60000)));
  // O webhook de A cede a vez (debounce_msg_mais_nova, julho): quem forma o lote e B.
  assertEquals((await formarLoteWebhook(FONE, 'A')).skip, 'debounce_msg_mais_nova');
  const lote = await formarLoteWebhook(FONE, 'B');
  assertEquals(lote.idsDoLote, ['A', 'B']);          // owned_inbound_ids = A+B
  assertEquals(lote.loteCreatedAtMax, db.inbound[1].created_at);
  const b = await barreiraFinal({ dryRun: false, phone: FONE, idsParaCarimbar: lote.idsDoLote, loteCreatedAtMax: lote.loteCreatedAtMax, decisionId: 'dec-1', turnId: 'turn-1', executionId: 'exec-1', contextoDecisao: ctx(lote.idsDoLote!) });
  assertFalse(b.bloqueou);
  assertEquals(status('A'), 'pendente');             // antes do envio: nada carimbado
  assertEquals(status('B'), 'pendente');
  transportar(FONE, 'r'); await carimbarInbound(FONE, lote.idsDoLote, 'atendido_joao');
  assertEquals(db.transportes.length, 1);
  assertEquals([status('A'), status('B')], ['atendido_joao', 'atendido_joao']);
});

// ── T3 — CASO P0 ─────────────────────────────────────────────────────────────
Deno.test('T3 B chega com A em voo: suprime, nao carimba nada', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(120000)));
  const lote = await formarLoteWebhook(FONE, 'A');   // lote fechado so com A
  assertEquals(lote.idsDoLote, ['A']);
  db.inbound.push(txt('B', FONE, T(1000)));          // B chega DEPOIS, com A em voo
  const r = await turno(lote.idsDoLote, lote.loteCreatedAtMax);
  assertEquals(r.skip, 'superseded_por_inbound_mais_novo');
  assertEquals(r.superseded, true);
  assertEquals(r.newer_inbound_id, 'B');
  assertEquals(r.owned_inbound_ids, ['A']);
  assertEquals(db.transportes.length, 0);            // nao enviou
  assertEquals(status('A'), 'pendente');             // nao carimbou o lote
  assertEquals(status('B'), 'pendente');             // nem a mensagem nova
  const d = db.decisoes.get('dec-1')!;               // terminal observavel
  assertEquals(d.acao_executada, 'resposta_noturna_superseded_por_inbound_mais_novo');
  assertEquals(d.terminal_operacional, 'nao_executavel');
  assertEquals(d.terminal_fonte, 'freshness_fence');
  assertEquals(d.efeito_externo, false);
  assertEquals(d.contexto.superseded, true);
  assertEquals(d.contexto.skip_reason, 'superseded_por_inbound_mais_novo');
  assertEquals(d.contexto.owned_inbound_ids, ['A']);
  assertEquals(d.contexto.newer_inbound_id, 'B');
  assertEquals(d.turn_id, 'turn-1');
  assertEquals(d.contexto.execution_id, 'exec-1');
});

// ── T4 — recuperacao pelo sweep ──────────────────────────────────────────────
Deno.test('T4 sweep recolhe A+B no mesmo lote e responde uma vez', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(180000)), txt('B', FONE, T(120000)));
  const lotes = await loteDoSweep();                 // query real do sweep
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].ids, ['A', 'B']);
  assertEquals(lotes[0].phone, FONE);
  const r = await turno(lotes[0].ids, lotes[0].loteMax);
  assertEquals(r.respondeu, true);
  assertEquals(db.transportes.length, 1);            // UMA resposta para A+B
  assertEquals([status('A'), status('B')], ['atendido_joao', 'atendido_joao']);
});

Deno.test('T4b sweep so enxerga pendente e ignora ja carimbado', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(180000), 'atendido_joao'), txt('B', FONE, T(120000)));
  const lotes = await loteDoSweep();
  assertEquals(lotes[0].ids, ['B']);
});

// ── T5 — heuristica velha ────────────────────────────────────────────────────
Deno.test('T5 outbound posterior no tempo nao pode atender B sozinho', async () => {
  const fonte = await Deno.readTextFile(new URL('../../../supabase/functions/agente-noturno/index.ts', import.meta.url));
  assertFalse(/jaRespondida/.test(fonte), 'jaRespondida ainda existe no fluxo');
  assertFalse(/'ja_respondida'/.test(fonte), "skip 'ja_respondida' ainda existe");
  // Nenhum carimbo de atendido_joao pode depender de comparacao de timestamp entre
  // outbound e inbound. Varre as linhas que carimbam e prova que nenhuma decide por relogio.
  for (const l of fonte.split('\n')) {
    if (l.includes("'atendido_joao'")) {
      assertFalse(/new Date\([^)]*timestamp[^)]*\)\.getTime\(\)\s*>/.test(l), 'carimbo por relogio: ' + l.trim());
    }
  }
  // Comportamento: B pendente com outbound do turno de A ja gravado depois dela
  // continua exigindo transporte proprio — o carimbo so vem do envio de B.
  db.reset();
  db.inbound.push(txt('B', FONE, T(60000)));
  const lote = await formarLoteWebhook(FONE, 'B');
  assertEquals(lote.idsDoLote, ['B']);
  assertEquals(status('B'), 'pendente');
  await turno(lote.idsDoLote, lote.loteCreatedAtMax);
  assertEquals(db.transportes.length, 1);            // respondeu de fato
  assertEquals(status('B'), 'atendido_joao');
});

// ── T6 — lock ────────────────────────────────────────────────────────────────
Deno.test('T6 lock ocupado: sem envio, sem carimbo, continua recuperavel', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(60000)));
  setLockDisponivel(false);
  setInterno(async () => { throw new Error('nao pode entrar com lock ocupado'); });
  const r = await atenderCliente(FONE, 'Cliente', 'oi', [], [], ['A'], false, null);
  setLockDisponivel(true);
  assertEquals(r.skip, 'lock_ocupado');
  assertEquals(db.transportes.length, 0);
  assertEquals(status('A'), 'pendente');
  const lotes = await loteDoSweep();                 // segue elegivel ao sweep
  assertEquals(lotes[0].ids, ['A']);
});

// ── T7 — concorrencia ────────────────────────────────────────────────────────
Deno.test('T7 duas execucoes: no maximo um transporte, nenhum inbound perdido', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(180000)));
  const loteA = await formarLoteWebhook(FONE, 'A');   // execucao 1 fecha o lote com A
  db.inbound.push(txt('B', FONE, T(60000)));          // B chega durante a execucao 1
  // Execucao 2 (webhook de B) tenta entrar com a execucao 1 em voo: o lock recusa.
  setInterno(async () => { throw new Error('interno nao deve rodar'); });
  db.locks.add(FONE);
  const r2 = await atenderCliente(FONE, 'Cliente', 'oi', [], [], ['A', 'B'], false, null);
  db.locks.delete(FONE);
  assertEquals(r2.skip, 'lock_ocupado');
  // Execucao 1 chega na barreira e ve B: suprime sem carimbar.
  const r1 = await turno(loteA.idsDoLote, loteA.loteCreatedAtMax);
  assertEquals(r1.skip, 'superseded_por_inbound_mais_novo');
  assertEquals(db.transportes.length, 0);
  // Sweep fecha o ciclo com uma unica resposta para A+B.
  const lotes = await loteDoSweep();
  assertEquals(lotes[0].ids, ['A', 'B']);
  await turno(lotes[0].ids, lotes[0].loteMax, 'dec-2');
  assertEquals(db.transportes.length, 1);
  assertEquals([status('A'), status('B')], ['atendido_joao', 'atendido_joao']);
});

Deno.test('T7b reentrega do mesmo inbound ja terminal nao gera segundo transporte', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(60000), 'atendido_joao'));
  const lote = await formarLoteWebhook(FONE, 'A');
  assertEquals(lote.skip, 'inbound_ja_terminal');
  assertEquals(db.transportes.length, 0);
});

// ── T8 — isolamento ──────────────────────────────────────────────────────────
Deno.test('T8 lote A+B carimba A+B; C que chegou depois segue pendente', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(290000)), txt('B', FONE, T(240000)));
  const lote = await formarLoteWebhook(FONE, 'B');
  assertEquals(lote.idsDoLote, ['A', 'B']);
  const r = await turno(lote.idsDoLote, lote.loteCreatedAtMax);   // envio valido do lote
  assertEquals(r.respondeu, true);
  db.inbound.push(txt('C', FONE, T(60000)));                      // C chega depois
  assertEquals([status('A'), status('B'), status('C')], ['atendido_joao', 'atendido_joao', 'pendente']);
  const lotes = await loteDoSweep();                              // C segue recuperavel
  assertEquals(lotes[0].ids, ['C']);
});

Deno.test('T8b carimbo nunca alcanca inbound fora do lote', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(120000)), txt('C', FONE, T(1000)));
  await carimbarInbound(FONE, ['A'], 'atendido_joao');
  assertEquals([status('A'), status('C')], ['atendido_joao', 'pendente']);
});

// ── T9 — telemetria ──────────────────────────────────────────────────────────
Deno.test('T9 contexto preserva turn_id/execution_id e inclui owned_inbound_ids', async () => {
  db.reset();
  db.inbound.push(txt('A', FONE, T(120000)));
  const lote = await formarLoteWebhook(FONE, 'A');
  db.inbound.push(txt('B', FONE, T(1000)));
  await turno(lote.idsDoLote, lote.loteCreatedAtMax);
  const d = db.decisoes.get('dec-1')!;
  for (const k of ['execution_id', 'turn_id', 'owned_inbound_ids', 'newer_inbound_id', 'lote_created_at_max', 'superseded', 'skip_reason']) {
    assert(k in d.contexto, 'faltou ' + k + ' no contexto');
  }
  const l = db.logs.find((x) => x.s === 'superseded_por_inbound_mais_novo')!;
  assertEquals(l.owned_inbound_ids, ['A']);
  assertEquals(l.newer_inbound_id, 'B');
  const fonte = await Deno.readTextFile(new URL('../../../supabase/functions/agente-noturno/index.ts', import.meta.url));
  for (const k of ['joao_envios', 'provider_message_id', 'turn_id: turnId', 'execution_id: executionId']) {
    assert(fonte.includes(k), 'telemetria perdida: ' + k);
  }
});

// ── frescor: regra unica, mesma nos dois pontos ──────────────────────────────
Deno.test('regra de frescor ignora evento sem conteudo e ignora o proprio lote', async () => {
  db.reset();
  const vazio = { id: 'V', phone: FONE, status: 'pendente', created_at: T(1000), body: {} };
  db.inbound.push(txt('A', FONE, T(60000)), vazio as any);
  assertEquals(await inboundMaisNovoQue(FONE, db.inbound[0].created_at, { somentePendentes: true }), null);
  db.inbound.push(txt('B', FONE, T(500)));
  const n = await inboundMaisNovoQue(FONE, db.inbound[0].created_at, { ownedIds: ['A'], somentePendentes: true });
  assertEquals(n?.id, 'B');
  assertEquals(await inboundMaisNovoQue(FONE, db.inbound[0].created_at, { ownedIds: ['A', 'B'], somentePendentes: true }), null);
});
