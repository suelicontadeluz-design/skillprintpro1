// ══ REPLAY SENTINELA DO INCIDENTE DTF UV — 20/08/2026 ═══════════════════
// Roda o ARTEFATO REAL da Edge agente-noturno contra um banco e uma rede falsos.
// Nenhuma linha de producao e tocada: nao ha deploy, nao ha Supabase real, nao ha
// Z-API real, nao ha Anthropic real. O roteiro reproduz, passo a passo, o que o
// cliente e o modelo fizeram no incidente.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carregarAgente, requisicao } from './harness/carregar_agente.mjs';
import { criarRoteadorFetch, respostaTexto, respostaTool } from './harness/roteador_fetch.mjs';
import { novoBanco, inbound, conversa, TELEFONE } from './harness/cenario.mjs';

const DECISAO_PERGUNTA_MEDIDA = respostaTexto({
  responde: true, mensagem: 'Me fala a medida do adesivo em centimetros que eu ja te passo o valor.',
  tema: 'dtf_uv', encaminhou_venda: false, etapa: 'sondagem', slots: {},
});

function resultadosDeTool(chamadas) {
  const out = [];
  for (const req of chamadas.anthropic) {
    for (const m of (req.messages || [])) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b?.type === 'tool_result') { try { out.push(JSON.parse(b.content)); } catch { out.push({ _cru: b.content }); } }
      }
    }
  }
  return out;
}
const rpcsChamadas = (db) => db.chamadasRpc.map((c) => c.nome);
const textosEnviados = (chamadas) => chamadas.envios.map((e) => String(e.message || ''));

describe('sentinela: premissa inventada nao vira preco autorizado', () => {
  let handler, db;
  const passos = {};

  before(async () => {
    db = novoBanco();
    const carga = await carregarAgente({ db, fetchFake: async () => { throw new Error('fetch nao instalado'); } });
    handler = carga.handler;
  });

  const rodar = async ({ turnosModelo, corpo }) => {
    const r = criarRoteadorFetch({ turnosModelo });
    globalThis.fetch = r.fetchFake;
    const res = await handler(requisicao(corpo));
    return { r, corpo: JSON.parse(await res.text()) };
  };

  test('1-2. cliente pede valor de adesivo para copo; Joao pergunta o tamanho', async () => {
    db.dados.inbound_fora_horario.push(inbound({ id: 'i1', texto: 'Boa noite, quanto custa adesivo pra copo?' }));
    const { r } = await rodar({
      turnosModelo: [DECISAO_PERGUNTA_MEDIDA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'Boa noite, quanto custa adesivo pra copo?', inbound_id: 'i1' },
    });
    passos.p1 = r;
    assert.ok(!rpcsChamadas(db).includes('fn_precificar_dtf_uv_v2'), 'nao pode precificar sem medida');
  });

  test('3-4. "E para copo americano": o modelo tenta 10x21 e a tool e BLOQUEADA', async () => {
    db.dados.inbound_fora_horario.push(inbound({ id: 'i2', texto: 'E para copo americano' }));
    const antesRpc = rpcsChamadas(db).length;
    const { r } = await rodar({
      // Exatamente o que o modelo fez no incidente: promoveu "10 x 21cm" do SYSTEM a medida real.
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), DECISAO_PERGUNTA_MEDIDA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'E para copo americano', inbound_id: 'i2' },
    });
    const resultados = resultadosDeTool(r.chamadas);
    const bloqueio = resultados.find((x) => x?.erro === 'parametro_sem_proveniencia');

    assert.ok(bloqueio, 'a tool tinha que devolver parametro_sem_proveniencia');
    assert.equal(bloqueio.ferramenta, 'calcular_rendimento_uv');
    // Neste ponto o cliente ainda nao disse medida NEM quantidade: os tres numeros da
    // chamada foram criados pelo modelo a partir da referencia do SYSTEM.
    assert.deepEqual(bloqueio.campos_sem_proveniencia, ['largura_cm', 'altura_cm', 'quantidade_desejada']);
    assert.deepEqual(bloqueio.financial_authorizations, [], 'zero autorizacao financeira');
    assert.match(bloqueio.acao, /[Pp]ergunte ao cliente/, 'a acao instrui perguntar ao cliente');

    const novas = rpcsChamadas(db).slice(antesRpc);
    assert.ok(!novas.includes('fn_precificar_dtf_uv_v2'), 'a RPC de preco NAO pode ser chamada');
    assert.ok(!novas.includes('fn_emitir_operacao_financeira'), 'nenhuma autorizacao financeira emitida');

    const textos = textosEnviados(r.chamadas).join(' | ');
    assert.ok(!/10\s*x\s*21/i.test(textos), 'nao pode verbalizar a medida inventada');
    assert.ok(!/437[.,]75|29[.,]90/.test(textos), 'nao pode produzir preco sobre a premissa inventada');

    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.ok(!/10x21/i.test(JSON.stringify(estado?.slots || {})), 'a medida inventada NAO pode virar memoria operacional');
  });

  test('5. "Seria 50 adesivos" sem medida: continua sem precificar por area', async () => {
    db.dados.inbound_fora_horario.push(inbound({ id: 'i3', texto: 'Seria 50 adesivos' }));
    const antesRpc = rpcsChamadas(db).length;
    const { r } = await rodar({
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), DECISAO_PERGUNTA_MEDIDA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'Seria 50 adesivos', inbound_id: 'i3' },
    });
    const bloqueio = resultadosDeTool(r.chamadas).find((x) => x?.erro === 'parametro_sem_proveniencia');
    assert.ok(bloqueio, 'quantidade com origem nao autoriza medida sem origem');
    // 50 TEM proveniencia (o cliente acabou de dizer); 10 e 21 nao tem.
    assert.deepEqual(bloqueio.campos_sem_proveniencia, ['largura_cm', 'altura_cm']);
    assert.ok(!rpcsChamadas(db).slice(antesRpc).includes('fn_precificar_dtf_uv_v2'));
  });

  test('6-8. apos "Fico no aguardo", a rajada "Ok"+"Obrigada" nao reabre venda e carimba TODOS os IDs', async () => {
    db.dados.fact_conversations.push(conversa({ texto: 'Fico no aguardo do seu retorno!', direction: 'outbound', source: 'joao', minutosAtras: 0 }));
    db.dados.inbound_fora_horario.push(inbound({ id: 'i4', texto: 'Ok', minutosAtras: 1 }));
    db.dados.inbound_fora_horario.push(inbound({ id: 'i5', texto: 'Obrigada', minutosAtras: 0 }));

    const antesRpc = rpcsChamadas(db).length;
    const { r, corpo } = await rodar({
      turnosModelo: [],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'Obrigada', inbound_id: 'i5' },
    });

    assert.equal(r.chamadas.anthropic.length, 0, 'zero chamada ao modelo');
    assert.equal(r.chamadas.envios.length, 0, 'zero mensagem comercial enviada');
    assert.equal(r.chamadas.calcularFrete.length, 0, 'zero retomada de frete');
    assert.equal(corpo.motivo, 'confirmacao_curta_pos_encerramento');
    assert.ok(!rpcsChamadas(db).slice(antesRpc).includes('fn_precificar_dtf_uv_v2'), 'zero ferramenta financeira');

    const lote = db.tabela('inbound_fora_horario').filter((x) => ['i4', 'i5'].includes(x.id));
    assert.equal(lote.length, 2);
    for (const linha of lote) assert.notEqual(linha.status, 'pendente', `inbound ${linha.id} ficou pendente`);
  });

  test('9. sweep posterior nao cria segundo turno fantasma', async () => {
    // O sweep so enxerga linhas com status pendente. Depois da rajada carimbada, nao ha nenhuma.
    const antesRpc = rpcsChamadas(db).length;
    const { r, corpo } = await rodar({ turnosModelo: [], corpo: { _sweep: true } });
    assert.equal(corpo.sweep, true);
    assert.equal(corpo.clientes_na_fila, 0, 'nenhum item do lote sobrou para o sweep');
    assert.equal(corpo.atendidos, 0, 'zero novo turno');
    assert.equal(r.chamadas.anthropic.length, 0);
    assert.equal(rpcsChamadas(db).length, antesRpc);
  });

  test('10. sem CEP informado, calcular_frete e bloqueado ANTES da chamada externa', async () => {
    db.dados.inbound_fora_horario.push(inbound({ id: 'i6', texto: 'quanto fica com entrega?' }));
    const { r } = await rodar({
      turnosModelo: [respostaTool('calcular_frete', { cep_destino: '01310100' }), DECISAO_PERGUNTA_MEDIDA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'quanto fica com entrega?', inbound_id: 'i6' },
    });
    const bloqueio = resultadosDeTool(r.chamadas).find((x) => x?.erro === 'parametro_sem_proveniencia' && x.ferramenta === 'calcular_frete');
    assert.ok(bloqueio, 'CEP com 8 digitos sem origem tinha que ser bloqueado');
    assert.deepEqual(bloqueio.campos_sem_proveniencia, ['cep_destino']);
    assert.equal(r.chamadas.calcularFrete.length, 0, 'a Edge calcular-frete NAO pode ser chamada');
    assert.deepEqual(bloqueio.financial_authorizations, []);
  });
});
