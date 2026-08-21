// Testes do contrato de criacao de etiqueta Frenet.
// Rodar: node --experimental-strip-types --test logistica/frenet/test/contrato.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import { OrigemMedida, Veredito, Efeito, Autoridade, type PedidoEnvio } from '../tipos.ts';
import { validarEmissao, escolherVeredito } from '../validador.ts';
import { fontesQueBloqueiamEmissao, MAPA_FONTES } from '../fontes.ts';
import {
  ENDPOINT_COTACAO, ENDPOINT_EMISSAO, ENDPOINT_PROIBIDO_NESTA_FASE, endpoint,
} from '../endpoints.ts';
import { abrirGateEmissao, ehGateAberto, EmissaoBloqueada } from '../gate.ts';
import {
  chaveIdempotencia, decidirRetry, tuplaCanonica, EstadoTentativa, type Tentativa,
} from '../idempotencia.ts';
import { auditarReceptor, montarContratoWebhook, chaveEventoTracking, ReceptorInapto } from '../webhook.ts';
import { conferirSeparacaoDeCredenciais, provarPresenca } from '../segredos.ts';
import { cotar, montarPayloadCriacao, criarPedido, hashPayload } from '../adapter.ts';

// ------------------------------------------------------------- fixtures

function envioCompleto(): PedidoEnvio {
  const end = (cep: string) => ({
    cep, logradouro: 'Rua Tal', numero: '100', complemento: null,
    bairro: 'Centro', cidade: 'Embu das Artes', uf: 'SP', pais: 'BR' as const,
  });
  return {
    envio_id: '11111111-1111-4111-8111-111111111111',
    pedido_id: 'PED-1',
    pedido_fonte: 'ERP.public.vendas',
    remetente: {
      nome: 'Skillprint', documento: '30248650000111', tipo_documento: 'CNPJ',
      telefone: '11999998888', email: 'exp@skillprint.test', endereco: end('06813230'),
    },
    destinatario: {
      nome: 'Cliente Teste', documento: '39053344705', tipo_documento: 'CPF',
      telefone: '11988887777', email: 'cliente@teste.test', endereco: end('45203011'),
    },
    itens: [{ sku: 'DTF', descricao: 'DTF', quantidade: 1, peso_kg: 0.4, valor_unitario: 120, categoria: 'Tecido' }],
    pacotes: [{ altura_cm: 13, largura_cm: 13, comprimento_cm: 60, peso_kg: 0.4, origem_medida: OrigemMedida.FICHA_FISICA }],
    valor_declarado: 120,
    servico: {
      codigo: '04014', descricao: 'Sedex', transportadora: 'Correios', preco_cotado: 32.5,
      prazo_dias: 3, cotado_em: '2026-08-21T12:00:00.000Z', cotacao_ref: 'op-frete-123',
    },
    solicitado_por: { tipo: 'humano', id: 'alessandro', nome: 'Alessandro' },
  };
}

const ctxPermissivo = {
  tentativas: [] as readonly Tentativa[],
  payload_hash: 'h1',
  emissao_liberada: true,
  webhook_receptor_pronto: true,
};

// ------------------------------------------------------- separacao de efeitos

test('COTAR aponta para endpoint sem efeito', () => {
  assert.equal(endpoint(ENDPOINT_COTACAO).efeito, Efeito.NENHUM);
});

test('EMITIR desta fase NAO e endpoint financeiro', () => {
  assert.equal(endpoint(ENDPOINT_EMISSAO).efeito, Efeito.MUTACAO_SEM_DEBITO);
});

test('oneclick esta catalogado como FINANCEIRO e proibido nesta fase', () => {
  assert.equal(endpoint(ENDPOINT_PROIBIDO_NESTA_FASE).efeito, Efeito.FINANCEIRO);
  assert.throws(
    () => abrirGateEmissao({
      endpoint_id: ENDPOINT_PROIBIDO_NESTA_FASE, autorizado_por: 'Alessandro',
      motivo: 'canario', teto_brl: 100, liberacao_operacional: true,
    }),
    EmissaoBloqueada,
  );
});

test('cotar nunca chega a um endpoint com efeito', async () => {
  let urlChamada = '';
  await cotar(
    { cep_origem: '06813230', cep_destino: '45203011', valor_declarado: 50, itens: [] },
    {
      ler: () => 'segredo-de-teste',
      buscar: async (u) => { urlChamada = u; return new Response(JSON.stringify({ ShippingSevicesArray: [] }), { status: 200 }); },
    },
  );
  assert.equal(urlChamada, 'https://api.frenet.com.br/shipping/quote');
});

// -------------------------------------------------------------- gate

test('gate nasce fechado sem liberacao operacional', () => {
  assert.throws(
    () => abrirGateEmissao({
      endpoint_id: ENDPOINT_EMISSAO, autorizado_por: 'Alessandro',
      motivo: 'canario', teto_brl: 100, liberacao_operacional: false,
    }),
    /sem_liberacao_operacional/,
  );
});

test('gate exige autor humano nomeado', () => {
  assert.throws(
    () => abrirGateEmissao({
      endpoint_id: ENDPOINT_EMISSAO, autorizado_por: '  ',
      motivo: 'x', teto_brl: 10, liberacao_operacional: true,
    }),
    /sem_autor_humano/,
  );
});

test('gate forjado nao passa em ehGateAberto', () => {
  assert.equal(ehGateAberto({ endpoint_id: ENDPOINT_EMISSAO, teto_brl: 999 }), false);
});

test('criarPedido recusa gate forjado antes de qualquer fetch', async () => {
  let chamou = false;
  await assert.rejects(
    () => criarPedido(
      {
        envio: envioCompleto(),
        validacao: { veredito: Veredito.READY, bloqueios: [], chave_idempotencia: 'k', avaliado_em: 'x' },
        webhook: { url: 'https://x.test', token_name: 'X-T', token_value: 'v' },
        gate: { endpoint_id: ENDPOINT_EMISSAO, teto_brl: 999 } as never,
      },
      { buscar: async () => { chamou = true; return new Response('{}'); } },
    ),
    /gate_ausente_ou_forjado/,
  );
  assert.equal(chamou, false, 'nenhuma chamada externa pode ter acontecido');
});

test('criarPedido recusa validacao nao-READY', async () => {
  const gate = abrirGateEmissao({
    endpoint_id: ENDPOINT_EMISSAO, autorizado_por: 'Alessandro',
    motivo: 'canario', teto_brl: 100, liberacao_operacional: true,
  });
  let chamou = false;
  await assert.rejects(
    () => criarPedido(
      {
        envio: envioCompleto(),
        validacao: { veredito: Veredito.BLOCKED_FONTE, bloqueios: [], chave_idempotencia: 'k', avaliado_em: 'x' },
        webhook: { url: 'https://x.test', token_name: 'X-T', token_value: 'v' },
        gate,
      },
      { buscar: async () => { chamou = true; return new Response('{}'); } },
    ),
    /validacao_nao_ready/,
  );
  assert.equal(chamou, false);
});

test('criarPedido recusa preco acima do teto autorizado', async () => {
  const gate = abrirGateEmissao({
    endpoint_id: ENDPOINT_EMISSAO, autorizado_por: 'Alessandro',
    motivo: 'canario', teto_brl: 10, liberacao_operacional: true,
  });
  let chamou = false;
  await assert.rejects(
    () => criarPedido(
      {
        envio: envioCompleto(),
        validacao: { veredito: Veredito.READY, bloqueios: [], chave_idempotencia: 'k', avaliado_em: 'x' },
        webhook: { url: 'https://x.test', token_name: 'X-T', token_value: 'v' },
        gate,
      },
      { buscar: async () => { chamou = true; return new Response('{}'); } },
    ),
    /preco_acima_do_teto_autorizado/,
  );
  assert.equal(chamou, false);
});

// ------------------------------------------------------------ validador

test('estado atual do sistema bloqueia emissao por FONTE', async () => {
  const r = await validarEmissao(envioCompleto(), ctxPermissivo);
  assert.equal(r.veredito, Veredito.BLOCKED_FONTE);
  assert.ok(r.bloqueios.some((b) => b.campo === 'pacote.peso_kg'));
});

test('peso/dimensao de heuristica nunca emite', async () => {
  const e = envioCompleto();
  e.pacotes[0].origem_medida = OrigemMedida.HEURISTICA_CONFIG;
  const r = await validarEmissao(e, ctxPermissivo);
  assert.ok(r.bloqueios.some(
    (b) => b.campo === 'pacotes[0].origem_medida' && b.veredito === Veredito.BLOCKED_FONTE,
  ));
});

test('mapa de fontes hoje bloqueia emissao (fail-closed)', () => {
  const bloq = fontesQueBloqueiamEmissao();
  assert.ok(bloq.length > 0, 'se isto ficar vazio, alguem promoveu fontes sem prova');
  assert.ok(MAPA_FONTES.length >= bloq.length);
});

test('validador nao acusa READY com endereco vazio', async () => {
  const e = envioCompleto();
  e.destinatario.endereco.numero = '';
  const r = await validarEmissao(e, ctxPermissivo);
  assert.ok(r.bloqueios.some((b) => b.campo === 'destinatario.endereco.numero'));
});

test('precedencia de veredito: NEEDS_HUMAN vence tudo', () => {
  assert.equal(
    escolherVeredito([
      { veredito: Veredito.BLOCKED_DADOS, campo: 'a', motivo: 'x' },
      { veredito: Veredito.NEEDS_HUMAN, campo: 'b', motivo: 'y' },
      { veredito: Veredito.BLOCKED_FONTE, campo: 'c', motivo: 'z' },
    ]),
    Veredito.NEEDS_HUMAN,
  );
  assert.equal(escolherVeredito([]), Veredito.READY);
});

test('politica fechada aparece como BLOCKED_POLITICA', async () => {
  const r = await validarEmissao(envioCompleto(), { ...ctxPermissivo, emissao_liberada: false });
  assert.ok(r.bloqueios.some((b) => b.campo === 'politica.emissao'));
});

// --------------------------------------------------------- idempotencia

test('chave e deterministica para o mesmo envio', async () => {
  const a = await chaveIdempotencia(envioCompleto());
  const b = await chaveIdempotencia(envioCompleto());
  assert.equal(a, b);
});

test('trocar servico muda a chave (nao e retry, e outro envio)', async () => {
  const a = await chaveIdempotencia(envioCompleto());
  const e = envioCompleto();
  e.servico.codigo = '04510';
  assert.notEqual(await chaveIdempotencia(e), a);
});

test('trocar peso do pacote muda a chave', async () => {
  const a = await chaveIdempotencia(envioCompleto());
  const e = envioCompleto();
  e.pacotes[0].peso_kg = 0.9;
  assert.notEqual(await chaveIdempotencia(e), a);
});

test('ordem dos pacotes nao muda a chave', async () => {
  const e1 = envioCompleto();
  e1.pacotes = [
    { altura_cm: 10, largura_cm: 10, comprimento_cm: 10, peso_kg: 1, origem_medida: OrigemMedida.FICHA_FISICA },
    { altura_cm: 20, largura_cm: 20, comprimento_cm: 20, peso_kg: 2, origem_medida: OrigemMedida.FICHA_FISICA },
  ];
  const e2 = envioCompleto();
  e2.pacotes = [e1.pacotes[1], e1.pacotes[0]];
  assert.equal(await chaveIdempotencia(e1), await chaveIdempotencia(e2));
});

test('tupla canonica ignora mascara de documento e CEP', () => {
  const a = envioCompleto();
  const b = envioCompleto();
  b.destinatario.documento = '390.533.447-05';
  b.destinatario.endereco.cep = '45203-011';
  assert.equal(tuplaCanonica(a), tuplaCanonica(b));
});

function tent(estado: (typeof EstadoTentativa)[keyof typeof EstadoTentativa], hash = 'h1'): Tentativa {
  return {
    chave_idempotencia: 'k', envio_id: 'e', estado, endpoint_id: ENDPOINT_EMISSAO,
    payload_hash: hash, criado_em: 'x', atualizado_em: 'x',
  };
}

test('retry apos CONCLUIDA reaproveita, nao compra de novo', () => {
  const d = decidirRetry([tent(EstadoTentativa.CONCLUIDA)], 'h1');
  assert.equal(d.pode_prosseguir, false);
  assert.ok(d.reaproveitar);
  assert.equal(d.exige_humano, false);
});

test('retry com tentativa EM_VOO exige humano', () => {
  const d = decidirRetry([tent(EstadoTentativa.EM_VOO)], 'h1');
  assert.equal(d.pode_prosseguir, false);
  assert.equal(d.exige_humano, true);
});

test('timeout (INDETERMINADA) nunca vira retry automatico', () => {
  const d = decidirRetry([tent(EstadoTentativa.INDETERMINADA)], 'h1');
  assert.equal(d.pode_prosseguir, false);
  assert.equal(d.exige_humano, true);
  assert.match(d.motivo, /reconciliar_na_frenet_antes/);
});

test('payload divergente sob a mesma chave e barrado (troca silenciosa)', () => {
  const d = decidirRetry([tent(EstadoTentativa.FALHA_DEFINITIVA, 'hA')], 'hB');
  assert.equal(d.pode_prosseguir, false);
  assert.equal(d.exige_humano, true);
});

test('retry apos falha definitiva com mesmo payload e permitido', () => {
  const d = decidirRetry([tent(EstadoTentativa.FALHA_DEFINITIVA, 'h1')], 'h1');
  assert.equal(d.pode_prosseguir, true);
});

test('validador devolve BLOCKED/NEEDS_HUMAN quando idempotencia barra', async () => {
  const r = await validarEmissao(envioCompleto(), {
    ...ctxPermissivo,
    tentativas: [tent(EstadoTentativa.EM_VOO)],
  });
  assert.equal(r.veredito, Veredito.NEEDS_HUMAN);
});

// -------------------------------------------------------------- webhook

const receptorBom = {
  url: 'https://exemplo.supabase.co/functions/v1/frenet-tracking-webhook',
  autentica_token: true, dedup_operante: true,
  dispara_mensagem_externa: false, persiste_evento_bruto: true,
};

test('receptor sem autenticacao e recusado', () => {
  assert.throws(() => auditarReceptor({ ...receptorBom, autentica_token: false }), ReceptorInapto);
});

test('receptor que dispara WhatsApp e recusado nesta fase', () => {
  assert.throws(() => auditarReceptor({ ...receptorBom, dispara_mensagem_externa: true }), /dispara_mensagem_externa/);
});

test('receptor com dedup inoperante e recusado', () => {
  assert.throws(() => auditarReceptor({ ...receptorBom, dedup_operante: false }), /dedup_inoperante/);
});

test('receptor http (nao https) e recusado', () => {
  assert.throws(() => auditarReceptor({ ...receptorBom, url: 'http://x.test' }), /url_nao_https/);
});

test('contrato de webhook nao inventa segredo quando ausente', () => {
  assert.throws(() => montarContratoWebhook(receptorBom, () => undefined), /segredo_ausente/);
});

test('token de webhook nao pode reutilizar segredo de API', () => {
  const ler = (n: string) => ({
    TOKEN_FRENET: 'cliente', FRENET_PARTNER_TOKEN: 'parceiro',
    FRENET_WEBHOOK_TOKEN_NAME: 'X-Frenet-Token', FRENET_WEBHOOK_TOKEN_VALUE: 'parceiro',
  } as Record<string, string>)[n];
  assert.throws(() => montarContratoWebhook(receptorBom, ler), /reutiliza_segredo_de_api/);
});

test('Partner Token e Token do Cliente nao podem ser o mesmo valor', () => {
  assert.throws(
    () => conferirSeparacaoDeCredenciais((n) => (n === 'TOKEN_FRENET' || n === 'FRENET_PARTNER_TOKEN' ? 'igual' : undefined)),
    /credenciais_colididas/,
  );
});

test('contrato valido monta com segredos distintos', () => {
  const ler = (n: string) => ({
    TOKEN_FRENET: 'c', FRENET_PARTNER_TOKEN: 'p',
    FRENET_WEBHOOK_TOKEN_NAME: 'X-Frenet-Token', FRENET_WEBHOOK_TOKEN_VALUE: 'w',
  } as Record<string, string>)[n];
  const c = montarContratoWebhook(receptorBom, ler);
  assert.equal(c.token_name, 'X-Frenet-Token');
  assert.equal(c.token_value, 'w');
});

test('chave de evento de tracking deduplica o mesmo fato', () => {
  const ev = {
    OrderId: 'o1', ShipmentId: 9, TrackingNumber: 'AA1',
    TrackingEvents: [{ EventType: 9, EventDate: '2026-08-21T10:00:00Z' }],
  };
  assert.equal(chaveEventoTracking(ev, 0), chaveEventoTracking({ ...ev }, 0));
});

// -------------------------------------------------------------- segredos

test('provarPresenca nunca devolve valor', () => {
  const r = provarPresenca(['TOKEN_FRENET'], () => 'super-secreto');
  assert.deepEqual(Object.keys(r[0]).sort(), ['nome', 'presente', 'tamanho']);
  assert.equal(JSON.stringify(r).includes('super-secreto'), false);
});

// -------------------------------------------------------------- payload

test('OrderId enviado a Frenet e o envio_id, nunca telefone/CPF/email', () => {
  const e = envioCompleto();
  const p = montarPayloadCriacao(e, { url: 'https://x.test', token_name: 'X-T', token_value: 'v' });
  assert.equal(p.OrderId, e.envio_id);
  assert.notEqual(p.OrderId, e.destinatario.telefone);
  assert.notEqual(p.OrderId, e.destinatario.documento);
  assert.notEqual(p.OrderId, e.destinatario.email);
});

test('hash do payload redige o segredo do webhook', async () => {
  const e = envioCompleto();
  const h1 = await hashPayload(montarPayloadCriacao(e, { url: 'https://x.test', token_name: 'X-T', token_value: 'segredo-A' }));
  const h2 = await hashPayload(montarPayloadCriacao(e, { url: 'https://x.test', token_name: 'X-T', token_value: 'segredo-B' }));
  assert.equal(h1, h2, 'trocar o segredo nao pode mudar o hash persistido');
});

// ------------------------------------------------ rodada 2: mapa de fontes
// Estes testes travam os achados da auditoria de 21/08/2026 rodada 2. Se
// alguem rebaixar ou promover uma fonte sem refazer a prova, quebram aqui.

test('endereco do destinatario tem fonte canonica provada (correcao da rodada 1)', async () => {
  const { fonteDe } = await import('../fontes.ts');
  const f = fonteDe('destinatario.endereco');
  assert.ok(f);
  assert.equal(f.autoridade, Autoridade.FONTE_CANONICA_PROVADA);
  assert.match(f.fonte, /ERP\.public\.pessoa_cliente_dados/);
});

test('remetente resolvido: CEP canonico 06813-230 aplicado, sem AMBIGUA sobrando', async () => {
  const { fonteDe, MAPA_FONTES: mapa } = await import('../fontes.ts');
  const f = fonteDe('remetente.endereco');
  assert.ok(f);
  assert.equal(f.autoridade, Autoridade.FONTE_CANONICA_PROVADA);
  assert.match(f.evidencia, /06813-230/);
  assert.equal(
    mapa.filter((x) => x.autoridade === Autoridade.AMBIGUA).length, 0,
    'nenhuma fonte pode continuar AMBIGUA depois das decisoes do dono',
  );
});

test('peso e dimensoes continuam AUSENTE: a regra dura nao afrouxou', async () => {
  const { fonteDe } = await import('../fontes.ts');
  for (const campo of ['pacote.peso_kg', 'pacote.dimensoes_cm', 'pacote.regra_de_embalagem']) {
    const f = fonteDe(campo);
    assert.ok(f, campo);
    assert.equal(f.autoridade, Autoridade.AUSENTE, campo);
    assert.equal(f.obrigatorio_para_emitir, true, campo);
  }
});

test('heuristica de embalagem cota mas nunca emite', async () => {
  const { fonteDe } = await import('../fontes.ts');
  const f = fonteDe('pacote.heuristica_dtf');
  assert.ok(f);
  assert.equal(f.autoridade, Autoridade.NAO_AUTORIZADA);
  assert.equal(f.obrigatorio_para_emitir, false);
});

test('somente FONTE_CANONICA_PROVADA libera emissao', async () => {
  const { bloqueia } = await import('../fontes.ts');
  assert.equal(bloqueia(Autoridade.FONTE_CANONICA_PROVADA), false);
  for (const a of [
    Autoridade.FONTE_CANDIDATA, Autoridade.INCOMPLETO, Autoridade.AMBIGUA,
    Autoridade.AUSENTE, Autoridade.AINDA_EM_DESENVOLVIMENTO, Autoridade.NAO_AUTORIZADA,
  ]) {
    assert.equal(bloqueia(a), true, a);
  }
});

test('execucao decidida (ERP + agente) e os segredos no ERP viram o bloqueio nomeado', async () => {
  const { fonteDe } = await import('../fontes.ts');
  const exec = fonteDe('execucao_emissao');
  assert.ok(exec);
  assert.equal(exec.autoridade, Autoridade.FONTE_CANONICA_PROVADA);
  assert.equal(fonteDe('ponte_cerebro_erp'), undefined, 'a ponte deixou de ser um campo: nao ha ponte a construir');

  const cred = fonteDe('credenciais_frenet_no_erp');
  assert.ok(cred);
  assert.equal(cred.autoridade, Autoridade.AUSENTE);
  assert.equal(cred.obrigatorio_para_emitir, true);
});

test('estado logistico existe no ERP e a guarda de idempotencia foi provada no banco', async () => {
  const { fonteDe } = await import('../fontes.ts');
  const f = fonteDe('estado_envio_etiqueta_tracking');
  assert.ok(f);
  assert.equal(f.autoridade, Autoridade.FONTE_CANONICA_PROVADA);
  assert.match(f.fonte, /ERP\.public\.logistica_envio/);
  assert.match(f.evidencia, /ux_tentativa_viva_por_chave/);
});

test('o receptor de webhook continua sem autoridade ate o PATCH 0 ir ao ar', async () => {
  const { fonteDe } = await import('../fontes.ts');
  const f = fonteDe('receptor_webhook_tracking');
  assert.ok(f);
  assert.equal(f.autoridade, Autoridade.NAO_AUTORIZADA);
  assert.match(f.evidencia, /af11c994/);
});

test('placar de fontes bate com a contagem do mapa', async () => {
  const { placarFontes, MAPA_FONTES: mapa } = await import('../fontes.ts');
  const soma = Object.values(placarFontes()).reduce((a, b) => a + b, 0);
  assert.equal(soma, mapa.length);
});
