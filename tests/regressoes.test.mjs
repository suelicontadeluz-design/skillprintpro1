// ══ REGRESSOES SAUDAVEIS ════════════════════════════════════════════════
// Provam que o gate de proveniencia nao quebrou o caminho legitimo: com origem
// autorizada, tudo continua funcionando exatamente como antes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { carregarAgente, requisicao } from './harness/carregar_agente.mjs';
import { criarRoteadorFetch, respostaTexto, respostaTool } from './harness/roteador_fetch.mjs';
import { novoBanco, inbound, conversa, TELEFONE, LEAD } from './harness/cenario.mjs';

const RESPOSTA_GENERICA = respostaTexto({
  responde: true, mensagem: 'Fechado! Te passo os detalhes agora.',
  tema: 'dtf_uv', encaminhou_venda: false, etapa: 'sondagem', slots: {},
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

async function cenario({ db, turnosModelo, corpo }) {
  const carga = await carregarAgente({ db, fetchFake: async () => { throw new Error('nao instalado'); } });
  const r = criarRoteadorFetch({ turnosModelo });
  globalThis.fetch = r.fetchFake;
  const res = await carga.handler(requisicao(corpo));
  return { r, saida: JSON.parse(await res.text()), db };
}

describe('regressoes saudaveis', () => {
  test('R1. medida e quantidade ditas pelo cliente: calcular_rendimento_uv continua funcionando', async () => {
    const texto = 'quero 50 adesivos de 10x21cm';
    const db = novoBanco({ inbounds: [inbound({ id: 'r1', texto })] });
    const { r } = await cenario({
      db,
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r1' },
    });
    const res = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.produto === 'dtf_uv');
    assert.ok(res, 'a tool tinha que executar');
    assert.equal(res.ok, true);
    assert.equal(res.display_data.adesivo_cm, '10x21');
    assert.equal(res.display_data.consumo_m, 5.15, 'os metros vem da RPC, nao de calculo local');
    assert.equal(res.financial_authorizations.length, 1);
    assert.equal(res.financial_authorizations[0].amount, 437.75, 'o preco oficial continua vindo da RPC');

    const rpc = db.chamadasRpc.find((c) => c.nome === 'fn_precificar_dtf_uv_v2');
    assert.ok(rpc, 'fn_precificar_dtf_uv_v2 continua sendo a fonte do preco');
    assert.deepEqual(rpc.args.p_payload, { origem: 'rendimento_adesivos', quantidade: 50, largura_cm: 10, altura_cm: 21 });
    assert.ok(db.chamadasRpc.some((c) => c.nome === 'fn_emitir_operacao_financeira'), 'autorizacao financeira continua sendo emitida');
  });

  test('R2. CEP dito pelo cliente: calcular_frete continua funcionando', async () => {
    const texto = 'meu cep e 01310-100, quanto fica o frete?';
    const db = novoBanco({ inbounds: [inbound({ id: 'r2', texto })] });
    const { r } = await cenario({
      db,
      turnosModelo: [respostaTool('calcular_frete', { cep_destino: '01310100' }), RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r2' },
    });
    assert.equal(r.chamadas.calcularFrete.length, 1, 'a Edge calcular-frete deve ser chamada');
    assert.equal(r.chamadas.calcularFrete[0].cep_destino, '01310100');
    const res = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.cep === '01310100');
    assert.ok(res && res.ok === true);
    assert.equal(res.financial_authorizations.length, 1);
    assert.equal(res.financial_authorizations[0].kind, 'frete');
  });

  test('R3. medida vinda de arquivo/bloco canonico do lead continua permitida', async () => {
    const texto = 'quero 50 adesivos dessa arte que te mandei';
    const db = novoBanco({ inbounds: [inbound({ id: 'r3', texto })] });
    db.dados.arte_uploads.push({
      id: 'up1', lead_id: LEAD, descricao: 'Arquivo enviado via WhatsApp: arte-copo.pdf',
      arquivos: [{ nome: 'arte-copo.pdf' }], total_arquivos: 1,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      dimensoes: { largura_cm: 10, altura_cm: 21 },
      arquivo_tamanho_bytes: 1048576, arquivo_mime_type: 'application/pdf', storage_sync_status: 'done',
    });
    const { r } = await cenario({
      db,
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r3' },
    });
    const res = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.produto === 'dtf_uv');
    assert.ok(res && res.ok === true, 'bloco canonico e origem autorizada');
    assert.equal(res.financial_authorizations[0].amount, 437.75);
  });

  test('R4. "Ok" em venda ativa SEM encerramento anterior nao vira despedida', async () => {
    const db = novoBanco({ inbounds: [inbound({ id: 'r4', texto: 'Ok' })] });
    db.dados.fact_conversations.push(conversa({ texto: 'Consigo sim! Voce prefere 50 ou 100 adesivos?', direction: 'outbound', source: 'joao', minutosAtras: 0 }));
    const { r, saida } = await cenario({
      db, turnosModelo: [RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'Ok', inbound_id: 'r4' },
    });
    assert.ok(r.chamadas.anthropic.length > 0, 'o turno comercial precisa continuar');
    assert.notEqual(saida.motivo, 'confirmacao_curta_pos_encerramento');
    assert.notEqual(saida.motivo, 'cortesia_pos_despedida');
  });

  test('R5. rajada "Obrigado" + "quero 100 unidades" nao pode ser descartada como cortesia', async () => {
    const db = novoBanco({
      inbounds: [
        inbound({ id: 'r5a', texto: 'Obrigado', minutosAtras: 1 }),
        inbound({ id: 'r5b', texto: 'quero 100 unidades', minutosAtras: 0 }),
      ],
    });
    db.dados.fact_conversations.push(conversa({ texto: 'Fico no aguardo!', direction: 'outbound', source: 'joao', minutosAtras: 0 }));
    const { r, saida } = await cenario({
      db, turnosModelo: [RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: 'quero 100 unidades', inbound_id: 'r5b' },
    });
    assert.ok(r.chamadas.anthropic.length > 0, 'conteudo comercial real na rajada tem que abrir turno');
    assert.notEqual(saida.motivo, 'confirmacao_curta_pos_encerramento');
    // e todos os IDs do lote continuam carimbados no mesmo turno (P0-D)
    for (const id of ['r5a', 'r5b']) {
      const linha = db.tabela('inbound_fora_horario').find((x) => x.id === id);
      assert.notEqual(linha.status, 'pendente', `inbound ${id} ficou pendente`);
    }
  });

  test('R6a. slot protegido inferido pelo modelo NAO persiste', async () => {
    const texto = 'E para copo americano';
    const db = novoBanco({ inbounds: [inbound({ id: 'r6a', texto })] });
    await cenario({
      db,
      turnosModelo: [respostaTexto({
        responde: true, mensagem: 'Uma arte de 10x21cm sai por um bom preco.', tema: 'dtf_uv',
        encaminhou_venda: false, etapa: 'sondagem', slots: { arte: '10x21cm', quantidade: 50, cep: '01310100' },
      })],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r6a' },
    });
    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.ok(estado, 'o estado continua sendo salvo');
    assert.equal(estado.slots.arte, undefined, 'arte inferida nao pode virar memoria');
    assert.equal(estado.slots.quantidade, undefined, 'quantidade inferida nao pode virar memoria');
    assert.equal(estado.slots.cep, undefined, 'CEP inferido nao pode virar memoria');
    assert.ok(db.tabela('error_log').some((e) => e.error_message === 'slot_protegido_sem_proveniencia'), 'a recusa fica registrada');
  });

  test('R6b. slot protegido dito pelo cliente persiste e fica carimbado', async () => {
    const texto = 'quero 50 adesivos de 10x21cm, meu cep e 01310-100';
    const db = novoBanco({ inbounds: [inbound({ id: 'r6b', texto })] });
    await cenario({
      db,
      turnosModelo: [respostaTexto({
        responde: true, mensagem: 'Perfeito, ja calculo pra voce.', tema: 'dtf_uv',
        encaminhou_venda: false, etapa: 'sondagem', slots: { arte: '10x21cm', quantidade: 50, cep: '01310100' },
      })],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r6b' },
    });
    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.equal(estado.slots.arte, '10x21cm');
    assert.equal(estado.slots.quantidade, 50);
    assert.equal(estado.slots.cep, '01310100');
    assert.deepEqual(estado.slots._prov, { arte: 'inbound_cliente', quantidade: 'inbound_cliente', cep: 'inbound_cliente' });
  });

  test('R6c. slot ja validado sobrevive ao turno seguinte sem o cliente repetir o dado', async () => {
    const texto = 'e quanto tempo demora?';
    const db = novoBanco({
      inbounds: [inbound({ id: 'r6c', texto })],
      estado: { phone: TELEFONE, lead_id: LEAD, etapa: 'sondagem', updated_at: new Date().toISOString(),
                slots: { arte: '10x21cm', quantidade: 50, _prov: { arte: 'inbound_cliente', quantidade: 'inbound_cliente' } } },
    });
    const { r } = await cenario({
      db,
      turnosModelo: [respostaTool('calcular_rendimento_uv', { largura_cm: 10, altura_cm: 21, quantidade_desejada: 50 }), RESPOSTA_GENERICA],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r6c' },
    });
    const res = resultadosDeTool(r.chamadas).find((x) => x?.display_data?.produto === 'dtf_uv');
    assert.ok(res && res.ok === true, 'slot_validado e origem autorizada');
    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.equal(estado.slots.arte, '10x21cm', 'slot legitimo ja confirmado e preservado');
  });

  test('R6d. slot legitimo anterior NAO e sobrescrito por inferencia do modelo', async () => {
    const texto = 'e quanto tempo demora?';
    const db = novoBanco({
      inbounds: [inbound({ id: 'r6d', texto })],
      estado: { phone: TELEFONE, lead_id: LEAD, etapa: 'sondagem', updated_at: new Date().toISOString(),
                slots: { arte: '10x21cm', _prov: { arte: 'inbound_cliente' } } },
    });
    await cenario({
      db,
      turnosModelo: [respostaTexto({ responde: true, mensagem: 'Certo!', tema: 'dtf_uv', encaminhou_venda: false, etapa: 'sondagem', slots: { arte: '30x40cm' } })],
      corpo: { phone: TELEFONE, chat_name: 'Cliente Teste', mensagem: texto, inbound_id: 'r6d' },
    });
    const estado = db.tabela('agente_noturno_estado').find((e) => e.phone === TELEFONE);
    assert.equal(estado.slots.arte, '10x21cm', 'o valor validado do cliente prevalece sobre a inferencia');
    assert.equal(estado.slots._prov.arte, 'inbound_cliente');
  });
});
