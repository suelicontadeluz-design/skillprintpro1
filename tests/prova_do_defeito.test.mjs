// ══ PROVA DE QUE O REPLAY SENTINELA PEGA O DEFEITO ══════════════════════
// Roda EXATAMENTE o mesmo roteiro do incidente contra o artefato v166 ORIGINAL
// preservado como rollback. Aqui os asserts sao invertidos: o comportamento
// defeituoso PRECISA aparecer. Se um dia este arquivo passar a falhar, ou o
// rollback deixou de ser o v166, ou o replay parou de exercitar o defeito.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carregarAgente, requisicao, CAMINHO_V166_ORIGINAL } from './harness/carregar_agente.mjs';
import { criarRoteadorFetch, respostaTexto, respostaTool } from './harness/roteador_fetch.mjs';
import { novoBanco, inbound, conversa, TELEFONE } from './harness/cenario.mjs';

const RESPOSTA = respostaTexto({
  responde: true, mensagem: 'Show! Ja te passo o valor.', tema: 'dtf_uv',
  encaminhou_venda: false, etapa: 'sondagem', slots: { arte: '10x21cm' },
});

async function cenarioV166({ db, turnosModelo, corpo }) {
  const carga = await carregarAgente({ db, caminho: CAMINHO_V166_ORIGINAL, fetchFake: async () => { throw new Error('nao instalado'); } });
  const r = criarRoteadorFetch({ turnosModelo });
  globalThis.fetch = r.fetchFake;
  const res = await carga.handler(requisicao(corpo));
  return { r, saida: JSON.parse(await res.text()) };
}

describe('v166 original: os quatro defeitos reproduzem', () => {
  test('A+B. "E para copo americano" vira preco de 10x21 e persiste como slot', async () => {
    const texto = 'E para copo americano';
    const db = novoBanco({ inbounds: [inbound({ id: 'd1', texto })] });
    await cenarioV166({
      db,
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), RESPOSTA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'd1' },
    });
    const rpc = db.chamadasRpc.find((c) => c.nome === 'fn_precificar_dtf_uv_v2');
    assert.ok(rpc, 'DEFEITO A: a RPC de preco e chamada sobre uma premissa inventada');
    assert.deepEqual(rpc.args.p_payload, { origem: 'rendimento_adesivos', quantidade: 50, largura_cm: 10, altura_cm: 21 });
    assert.ok(db.chamadasRpc.some((c) => c.nome === 'fn_emitir_operacao_financeira' && c.args.p_amount === 437.75),
      'DEFEITO A: autorizacao financeira de R$437,75 emitida sem proveniencia');
    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.equal(estado.slots.arte, '10x21cm', 'DEFEITO B: a medida inventada vira memoria operacional');
  });

  test('C+D. rajada "Ok"+"Obrigada" apos encerramento reabre turno e deixa ID pendente', async () => {
    const db = novoBanco({
      inbounds: [inbound({ id: 'd2a', texto: 'Ok', minutosAtras: 1 }), inbound({ id: 'd2b', texto: 'Obrigada', minutosAtras: 0 })],
    });
    db.dados.fact_conversations.push(conversa({ texto: 'Fico no aguardo do seu retorno!', direction: 'outbound', source: 'joao', minutosAtras: 0 }));
    const { r } = await cenarioV166({
      db, turnosModelo: [RESPOSTA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'Obrigada', inbound_id: 'd2b' },
    });
    assert.ok(r.chamadas.anthropic.length > 0, 'DEFEITO C: a cortesia em rajada reabre o turno comercial');
    const pendentes = db.tabela('inbound_fora_horario').filter((x) => x.status === 'pendente').map((x) => x.id);
    assert.deepEqual(pendentes, ['d2a'], 'DEFEITO D: o outro ID da rajada fica pendente para o sweep');

    const sweep = await cenarioV166({ db, turnosModelo: [RESPOSTA], corpo: { _sweep: true } });
    assert.equal(sweep.saida.atendidos, 1, 'DEFEITO D: o sweep cria um segundo turno fantasma');
  });

  test('E. calcular_frete e chamado com CEP sem proveniencia', async () => {
    const texto = 'quanto fica com entrega?';
    const db = novoBanco({ inbounds: [inbound({ id: 'd3', texto })] });
    const { r } = await cenarioV166({
      db,
      turnosModelo: [respostaTool('calcular_frete', { cep_destino: '01310100' }), RESPOSTA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'd3' },
    });
    assert.equal(r.chamadas.calcularFrete.length, 1, 'DEFEITO E: a Edge externa e chamada sem prova de origem do CEP');
  });
});
