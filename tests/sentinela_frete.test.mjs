// ══ REPLAY SENTINELA DE FRETE ═══════════════════════════════════════════
// Suplemento da Issue #3. Cotar nao e escolher; produto, frete e total nao trocam de
// significado; CEP confirmado nao se perde nem se pergunta de novo; cotacao valida nao
// e recalculada. Roda contra o artefato real, sem tocar em nada externo.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carregarAgente, requisicao } from './harness/carregar_agente.mjs';
import { criarRoteadorFetch, respostaTexto, respostaTool } from './harness/roteador_fetch.mjs';
import { novoBanco, inbound, TELEFONE } from './harness/cenario.mjs';

const CEP = '45203011';
const FRETE_CANONICO = [
  { servico: 'PAC', preco: 31.96, preco_formatado: 'R$31,96', prazo_formatado: '6 dias' },
  { servico: 'SEDEX', preco: 70.07, preco_formatado: 'R$70,07', prazo_formatado: '2 dias' },
];

const texto = (mensagem, slots = {}) => respostaTexto({
  responde: true, mensagem, tema: 'frete', encaminhou_venda: false, etapa: 'orcamento', slots,
});

function resultadosDeTool(chamadas) {
  const out = [];
  for (const req of chamadas.anthropic) {
    for (const m of (req.messages || [])) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) if (b?.type === 'tool_result') { try { out.push(JSON.parse(b.content)); } catch { out.push({ _cru: b.content }); } }
    }
  }
  return out;
}
const erros = (db) => db.tabela('error_log').map((e) => e.error_message);

describe('sentinela de frete: cotacao, escolha e significado do dinheiro', () => {
  let handler, db;

  before(async () => {
    db = novoBanco();
    const carga = await carregarAgente({ db, fetchFake: async () => { throw new Error('fetch nao instalado') } });
    handler = carga.handler;
  });

  const rodar = async ({ turnosModelo, mensagem, id }) => {
    db.dados.inbound_fora_horario.push(inbound({ id, texto: mensagem }));
    const r = criarRoteadorFetch({ turnosModelo, opcoesFrete: FRETE_CANONICO });
    globalThis.fetch = r.fetchFake;
    const res = await handler(requisicao({ phone: TELEFONE, chat_name: 'Cliente Teste', mensagem, inbound_id: id }));
    return { r, saida: JSON.parse(await res.text()) };
  };
  const estado = () => db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);

  test('1-2. pedido + CEP: cota PAC e Sedex, persiste CEP e cotacao, NAO escolhe modalidade', async () => {
    const { r } = await rodar({
      id: 'f1',
      mensagem: 'Quero 30 adesivos de 5x7cm, meu CEP e 45203-011',
      turnosModelo: [
        respostaTool('calcular_rendimento_uv', { largura_cm: 5, altura_cm: 7, quantidade_desejada: 30 }, 'tu-uv'),
        respostaTool('calcular_frete', { cep_destino: CEP }, 'tu-frete'),
        texto('Fechado! Os 30 adesivos de 5x7cm ficam em R$40,37. Pelos Correios: PAC R$31,96 em 6 dias, ou Sedex R$70,07 em 2 dias. Qual voce prefere?',
              { produto: 'dtf_uv', arte: '5x7cm', quantidade: 30, cep: '45203-011' }),
      ],
    });

    const resFrete = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.cep === CEP);
    assert.ok(resFrete && resFrete.ok === true, 'a cotacao tinha que sair');

    // cotar != escolher
    assert.equal(resFrete.display_data.escolha_do_cliente, null);
    assert.ok(!('servico_recomendado' in resFrete.display_data), 'sem pre-selecao de servico');
    assert.equal(resFrete.display_data.cotacao_reutilizada, false);

    // PAC e Sedex com proveniencia PROPRIA
    assert.equal(resFrete.financial_authorizations.length, 2);
    const porTipo = Object.fromEntries(resFrete.financial_authorizations.map((a) => [a.components.tipo_semantico, a]));
    assert.equal(porTipo.frete_pac.amount, 31.96);
    assert.equal(porTipo.frete_sedex.amount, 70.07);
    assert.notEqual(porTipo.frete_pac.operation_id, porTipo.frete_sedex.operation_id);
    for (const o of resFrete.display_data.opcoes) assert.ok(o.operation_id, `opcao ${o.servico} sem operation_id`);

    // CEP persistido e carimbado
    const s = estado().slots;
    assert.equal(s.cep, CEP);
    assert.equal(s._prov.cep, 'inbound_cliente');

    // cotacao persistida como estado canonico
    const cot = s._cotacao_frete;
    assert.ok(cot, 'a cotacao tinha que ficar persistida');
    assert.equal(cot.cep, CEP);
    assert.ok(cot.fingerprint && cot.criado_em, 'cotacao precisa de fingerprint e timestamp');
    assert.equal(cot.proveniencia.cep, 'inbound_cliente');
    assert.equal(cot.composicao.produto_centavos, 4037, 'a composicao guarda o subtotal do produto');
    assert.deepEqual(cot.opcoes.map((o) => o.tipo).sort(), ['frete_pac', 'frete_sedex']);

    // nenhuma modalidade escolhida automaticamente
    assert.equal(s.envio_retirada, undefined);
    assert.equal(s.servico_frete, undefined);

    assert.equal(r.chamadas.envios.length, 1, 'a resposta com produto + as duas opcoes tinha que passar');
  });

  test('3. cliente responde "PAC": escolha registrada, ZERO nova cotacao, total 72,33', async () => {
    const { r } = await rodar({
      id: 'f2',
      mensagem: 'PAC',
      turnosModelo: [
        respostaTool('calcular_frete', { cep_destino: CEP }, 'tu-frete2'),
        texto('Perfeito, fechamos no PAC. O produto fica R$40,37 e o PAC R$31,96, entao o total fica R$72,33. Confirma pra eu seguir?',
              { envio_retirada: 'PAC' }),
      ],
    });

    assert.equal(r.chamadas.calcularFrete.length, 0, 'ZERO nova chamada externa de frete');
    const resFrete = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.cep === CEP);
    assert.equal(resFrete.display_data.cotacao_reutilizada, true, 'a cotacao veio do estado canonico');
    assert.equal(resFrete.display_data.opcoes.find((o) => o.tipo === 'frete_pac').preco, 'R$31,96');

    const s = estado().slots;
    assert.equal(s.envio_retirada, 'PAC', 'a escolha do cliente fica registrada');
    assert.equal(s._prov.envio_retirada, 'inbound_cliente');
    assert.equal(s.cep, CEP);
    assert.ok(s._cotacao_frete, 'a cotacao continua vigente');

    const enviada = r.chamadas.envios.map((e) => e.message).join(' ');
    assert.match(enviada, /R\$72,33/, 'o total correto tem que sair');
    assert.match(enviada, /R\$40,37/);
    assert.match(enviada, /R\$31,96/);
    assert.ok(!/PAC\s+(ficou|fica|saiu por)\s+R\$40,37/i.test(enviada), 'nunca "PAC ficou R$40,37"');
  });

  test('4. turno seguinte sem mudanca: CEP e cotacao continuam, zero novo frete', async () => {
    const antes = JSON.stringify(estado().slots._cotacao_frete);
    const { r } = await rodar({
      id: 'f3',
      mensagem: 'quanto tempo demora a producao?',
      turnosModelo: [texto('A producao leva de 2 a 3 dias uteis depois da confirmacao do pagamento.', {})],
    });
    assert.equal(r.chamadas.calcularFrete.length, 0);
    const s = estado().slots;
    assert.equal(s.cep, CEP);
    assert.equal(JSON.stringify(s._cotacao_frete), antes, 'a cotacao nao pode mudar sozinha');
    assert.equal(s.envio_retirada, 'PAC');
  });

  test('5. decisao.slots.cep=null NAO apaga o CEP confirmado', async () => {
    const { saida } = await rodar({
      id: 'f4',
      mensagem: 'obrigado pela atencao, e a arte fica pronta quando?',
      turnosModelo: [texto('A arte fica pronta em ate 1 dia util depois da aprovacao.',
                           { cep: null, arte: null, quantidade: null, envio_retirada: null })],
    });
    assert.equal(saida.ok, true);
    const s = estado().slots;
    assert.equal(s.cep, CEP, 'null significa SEM ATUALIZACAO, nunca delecao');
    assert.equal(s._prov.cep, 'inbound_cliente', 'o carimbo de origem sobrevive');
    assert.equal(s.arte, '5x7cm');
    assert.equal(s.quantidade, 30);
    assert.equal(s.envio_retirada, 'PAC');
    assert.ok(s._cotacao_frete, 'a cotacao nao pode cair junto');
  });

  test('6. "PAC ficou R$40,37" e bloqueado: produto nao autoriza frete', async () => {
    const antesEnvios = [];
    const { r } = await rodar({
      id: 'f5',
      mensagem: 'me confirma o valor do PAC',
      turnosModelo: [texto('O PAC ficou R$40,37 e chega em 6 dias.', {})],
    });
    assert.ok(erros(db).includes('guardrail_proveniencia_semantica'), 'a guarda semantica tinha que acusar');
    const enviada = r.chamadas.envios.map((e) => e.message).join(' ');
    assert.ok(!/PAC ficou R\$40,37/i.test(enviada), 'a frase nao pode chegar ao cliente');
  });

  test('7. "Total R$31,96" e bloqueado: frete nao autoriza total', async () => {
    const { r } = await rodar({
      id: 'f6',
      mensagem: 'e o total, quanto fica?',
      turnosModelo: [texto('O total fica R$31,96 com tudo incluso.', {})],
    });
    assert.ok(erros(db).filter((e) => e === 'guardrail_proveniencia_semantica').length >= 2, 'a guarda tinha que acusar de novo');
    const enviada = r.chamadas.envios.map((e) => e.message).join(' ');
    assert.ok(!/[Tt]otal fica R\$31,96/.test(enviada), 'frete apresentado como total nao pode sair');
  });

  test('8. mudanca real do pedido invalida a cotacao e libera novo calculo', async () => {
    const { r } = await rodar({
      id: 'f7',
      mensagem: 'na verdade quero 60 adesivos de 5x7cm',
      turnosModelo: [
        respostaTool('calcular_rendimento_uv', { largura_cm: 5, altura_cm: 7, quantidade_desejada: 60 }, 'tu-uv2'),
        respostaTool('calcular_frete', { cep_destino: CEP }, 'tu-frete3'),
        texto('Atualizei! Os 60 adesivos ficam em R$78,40. Pelos Correios: PAC R$31,96 em 6 dias, ou Sedex R$70,07 em 2 dias.',
              { quantidade: 60 }),
      ],
    });
    assert.equal(r.chamadas.calcularFrete.length, 1, 'composicao mudou: a cotacao tem que ser refeita');
    const cot = estado().slots._cotacao_frete;
    assert.equal(cot.composicao.produto_centavos, 7840, 'a cotacao passa a refletir o novo pedido');
  });

  test('9. CEP novo informado pelo cliente invalida a cotacao anterior', async () => {
    const { r } = await rodar({
      id: 'f8',
      mensagem: 'mudei de endereco, meu cep agora e 01310-100',
      turnosModelo: [
        respostaTool('calcular_frete', { cep_destino: '01310100' }, 'tu-frete4'),
        texto('Anotei o novo endereco. Pelos Correios: PAC R$31,96 em 6 dias, ou Sedex R$70,07 em 2 dias.', { cep: '01310-100' }),
      ],
    });
    assert.equal(r.chamadas.calcularFrete.length, 1, 'CEP mudou: cotacao antiga invalidada');
    assert.equal(r.chamadas.calcularFrete[0].cep_destino, '01310100');
    const s = estado().slots;
    assert.equal(s.cep, '01310100');
    assert.equal(s._cotacao_frete.cep, '01310100');
  });
});
