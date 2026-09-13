// Provas das entregas E1 e E3 — 13/09/2026
// Rodar:  node --experimental-strip-types --test patches/joao-replay-hermetico-v288/testes/
//
// O teste que o aceite cobra explicitamente está em
// "E1 — regra dura: produto_macro sem fonte ⇒ INCONCLUSIVE, nunca PASS".

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FONTES_PRODUTO,
  GUARDS_INTERRUPTORES,
  aplicarRegraProduto,
  classificarProveniencia,
  lerCandidatoSlots,
  lerGuard,
  observarExecucao,
  type EntradaObservacao,
  type Veredito,
} from '../observabilidade-v10.ts';

const PALCO_BASE = {
  agente_noturno_estado: [{ phone: '5511999999999', etapa: 'qualificacao', slots: {}, updated_at: '2026-08-29T18:00:00Z' }],
  pixel_events: [],
  leads_marketing: [],
  catalogo_produtos: [],
};

function entrada(p: Partial<EntradaObservacao> = {}): EntradaObservacao {
  return {
    mensagem_cliente: '',
    palco_estado: PALCO_BASE,
    resposta_json: null,
    textos_modelo: [],
    escritas_estado_tentadas: [],
    model_calls: 0,
    ...p,
  };
}

// ─────────────────────────── E1 — regra dura ───────────────────────────

test('E1 — regra dura: produto_macro sem fonte ⇒ INCONCLUSIVE, nunca PASS', () => {
  // Todos os vereditos-base que hoje produziriam PASS.
  for (const [base, passBase] of [['MELHOROU', true], ['EQUIVALENTE', true]] as Array<[Veredito, boolean]>) {
    const r = aplicarRegraProduto(base, passBase, { produto_macro: 'dtf_textil', fonte: 'nenhuma' });
    assert.equal(r.veredito, 'INCONCLUSIVE', `base=${base} deveria virar INCONCLUSIVE`);
    assert.equal(r.pass, false, `base=${base} não pode passar`);
    assert.equal(r.regra_aplicada, 'produto_macro_sem_fonte');
  }
});

test('E1 — regra dura: fonte ausente/vazia/fora do vocabulário também é INCONCLUSIVE', () => {
  for (const fonte of ['', null, undefined, 'chute', 'inventada'] as any[]) {
    const r = aplicarRegraProduto('MELHOROU', true, { produto_macro: 'dtf_uv', fonte });
    assert.equal(r.veredito, 'INCONCLUSIVE', `fonte=${String(fonte)}`);
    assert.equal(r.pass, false);
  }
});

test('E1 — regra dura: com fonte identificável o veredito-base é preservado', () => {
  for (const fonte of FONTES_PRODUTO.filter((f) => f !== 'nenhuma')) {
    const r = aplicarRegraProduto('MELHOROU', true, { produto_macro: 'dtf_textil', fonte });
    assert.equal(r.veredito, 'MELHOROU', `fonte=${fonte} não deveria bloquear`);
    assert.equal(r.pass, true);
    assert.equal(r.regra_aplicada, 'nenhuma');
  }
});

test('E1 — regra dura: sem produto_macro a regra não se aplica', () => {
  const r = aplicarRegraProduto('EQUIVALENTE', true, { produto_macro: null, fonte: 'nenhuma' });
  assert.equal(r.veredito, 'EQUIVALENTE');
  assert.equal(r.pass, true);
});

test('E1 — regra dura: INCONCLUSIVE nunca vira PASS mesmo se o chamador insistir', () => {
  const r = aplicarRegraProduto('MELHOROU', true, { produto_macro: 'camiseta', fonte: 'nenhuma' });
  assert.equal(r.pass, false);
  // E o veredito não está no conjunto que o comparador trata como aprovado.
  assert.ok(!['MELHOROU', 'EQUIVALENTE'].includes(r.veredito));
});

// ─────────────────────────── E1 — slots e proveniência ───────────────────────────

test('E1 — candidato_slots sai da escrita tentada no estado (o fim do turno)', () => {
  const e = entrada({
    escritas_estado_tentadas: [{ phone: '5511999999999', slots: { produto: 'dtf_textil', quantidade: 10 } }],
    resposta_json: { slots: { produto: 'dtf_uv' } },
  });
  const s = lerCandidatoSlots(e);
  assert.equal(s.produto, 'dtf_textil');
  assert.equal(s.origem_leitura, 'escrita_estado_tentada');
  assert.equal(s.produto_macro, 'dtf_textil');
  assert.equal(s.macro_origem, 'igual_ao_produto');
});

test('E1 — candidato_slots cai para a resposta do handler quando não há escrita', () => {
  const s = lerCandidatoSlots(entrada({ resposta_json: { slots: { produto: 'dtf_uv', produto_macro: 'dtf_uv' } } }));
  assert.equal(s.origem_leitura, 'resposta_handler');
  assert.equal(s.macro_origem, 'explicito');
});

test('E1 — candidato_slots cai para o palco quando o turno não mexeu em nada', () => {
  const palco = { ...PALCO_BASE, agente_noturno_estado: [{ slots: { produto: 'camiseta_basica' } }] };
  const s = lerCandidatoSlots(entrada({ palco_estado: palco }));
  assert.equal(s.origem_leitura, 'palco_estado_anterior');
  assert.equal(s.produto, 'camiseta_basica');
  // `camiseta_basica` NÃO é slug de macro conhecido: o harness não inventa macro.
  assert.equal(s.produto_macro, null);
  assert.equal(s.macro_origem, 'ausente');
});

test('E1 — proveniência: estado_anterior vence quando o valor já estava no palco', () => {
  const palco = { ...PALCO_BASE, agente_noturno_estado: [{ slots: { produto: 'dtf_textil' } }] };
  const e = entrada({ palco_estado: palco, mensagem_cliente: 'quero dtf textil', textos_modelo: ['dtf textil'] });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.equal(p.fonte, 'estado_anterior');
  assert.ok(p.fonte_detalhe?.includes('dtf_textil'));
});

test('E1 — proveniência: mensagem_cliente vence catálogo, anúncio e modelo', () => {
  const palco = {
    agente_noturno_estado: [{ slots: {} }],
    pixel_events: [{ familia_slug: 'dtf_uv' }],
    catalogo_produtos: [{ slug: 'dtf_uv' }],
    leads_marketing: [],
  };
  const e = entrada({
    palco_estado: palco,
    mensagem_cliente: 'preciso de DTF UV para adesivo',
    resposta_json: { slots: { produto: 'dtf_uv' } },
    textos_modelo: ['vou cotar seu dtf uv'],
  });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.equal(p.fonte, 'mensagem_cliente');
  // as demais evidências continuam registradas, só não ganham
  const achadas = p.evidencias.filter((x) => x.encontrada).map((x) => x.fonte);
  assert.deepEqual(achadas.sort(), ['anuncio', 'canonico', 'mensagem_cliente', 'modelo']);
});

test('E1 — proveniência: anúncio vence catálogo', () => {
  const palco = {
    agente_noturno_estado: [{ slots: {} }],
    pixel_events: [{ product_type: 'dtf_textil' }],
    catalogo_produtos: [{ slug: 'dtf_textil' }],
    leads_marketing: [],
  };
  const e = entrada({ palco_estado: palco, resposta_json: { slots: { produto: 'dtf_textil' } } });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.equal(p.fonte, 'anuncio');
  assert.equal(p.fonte_detalhe, 'pixel_events.product_type=dtf_textil');
});

test('E1 — proveniência: modelo só leva o crédito sem evidência externa', () => {
  const e = entrada({
    palco_estado: { agente_noturno_estado: [{ slots: {} }], pixel_events: [], catalogo_produtos: [], leads_marketing: [] },
    mensagem_cliente: 'quanto custa?',
    resposta_json: { slots: { produto: 'dtf_uv' } },
    textos_modelo: ['entendi, você quer DTF UV'],
    model_calls: 1,
  });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.equal(p.fonte, 'modelo');
});

test('E1 — proveniência: sem nenhuma evidência a fonte é `nenhuma` e macro_sem_fonte sobe', () => {
  const e = entrada({
    palco_estado: { agente_noturno_estado: [{ slots: {} }], pixel_events: [], catalogo_produtos: [], leads_marketing: [] },
    mensagem_cliente: 'oi',
    resposta_json: { slots: { produto: 'dtf_textil' } },
  });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.equal(p.fonte, 'nenhuma');
  assert.equal(p.macro_sem_fonte, true);
  // e o veredito derivado tem de ser INCONCLUSIVE
  assert.equal(aplicarRegraProduto('EQUIVALENTE', true, p).veredito, 'INCONCLUSIVE');
});

test('E1 — fonte registrada está sempre no vocabulário fechado', () => {
  const e = entrada({ resposta_json: { slots: { produto: 'dtf_uv' } }, textos_modelo: ['dtf uv'] });
  const p = classificarProveniencia(e, lerCandidatoSlots(e));
  assert.ok(FONTES_PRODUTO.includes(p.fonte));
  for (const ev of p.evidencias) assert.ok(FONTES_PRODUTO.includes(ev.fonte));
});

test('E1 — promovido vs apenas conhecido', () => {
  const comEscrita = entrada({
    escritas_estado_tentadas: [{ slots: { produto: 'dtf_textil' } }],
    mensagem_cliente: 'dtf textil',
  });
  const p1 = classificarProveniencia(comEscrita, lerCandidatoSlots(comEscrita));
  assert.equal(p1.promovido, true);
  assert.equal(p1.conhecimento, 'promovido_ao_estado');

  const semEscrita = entrada({ resposta_json: { slots: { produto: 'dtf_textil' } }, mensagem_cliente: 'dtf textil' });
  const p2 = classificarProveniencia(semEscrita, lerCandidatoSlots(semEscrita));
  assert.equal(p2.promovido, false);
  assert.equal(p2.conhecimento, 'apenas_conhecido');
});

// ─────────────────────────── E3 — guard × modelo ───────────────────────────

test('E3 — guard_interruptor só aceita o vocabulário fechado', () => {
  for (const g of GUARDS_INTERRUPTORES) {
    assert.equal(lerGuard({ ok: true, skip: g }), g);
  }
  assert.equal(lerGuard({ ok: true, skip: 'qualquer_outra_coisa' }), null);
  assert.equal(lerGuard({ ok: true }), null);
  assert.equal(lerGuard(null), null);
});

test('E3 — os 3 desfechos de custo zero do baseline viram guard_interruptor', () => {
  const casos: Array<[any, string]> = [
    [{ ok: true, skip: 'cliente_comprador' }, 'cliente_comprador'],
    [{ ok: true, skip: 'agente_pausado', respondeu: false }, 'agente_pausado'],
    [{ ok: true, skip: 'sem_conteudo' }, 'sem_conteudo'],
  ];
  for (const [json, esperado] of casos) {
    const o = observarExecucao(entrada({ resposta_json: json, model_calls: 0 }));
    assert.equal(o.guard_interruptor, esperado);
    assert.equal(o.chegou_ao_modelo, false);
    assert.equal(o.model_call_count, 0);
  }
});

test('E3 — chegou_ao_modelo e model_call_count vêm das chamadas reais', () => {
  const o = observarExecucao(entrada({ resposta_json: { responde: true, slots: {} }, model_calls: 3 }));
  assert.equal(o.chegou_ao_modelo, true);
  assert.equal(o.model_call_count, 3);
  assert.equal(o.guard_interruptor, null);
  assert.deepEqual(o.inconsistencias, []);
});

test('E3 — guard com chamada ao modelo é marcado como incoerência, não escondido', () => {
  const o = observarExecucao(entrada({ resposta_json: { skip: 'agente_pausado' }, model_calls: 1 }));
  assert.equal(o.guard_interruptor, 'agente_pausado');
  assert.equal(o.chegou_ao_modelo, true);
  assert.ok(o.inconsistencias.includes('guard_agente_pausado_com_1_chamadas_ao_modelo'));
});

test('E3 — nem guard nem modelo também é incoerência registrada', () => {
  const o = observarExecucao(entrada({ resposta_json: { responde: true }, model_calls: 0 }));
  assert.ok(o.inconsistencias.includes('sem_guard_e_sem_chamada_ao_modelo'));
});

// ─────────────────────────── composição ───────────────────────────

test('observarExecucao devolve tudo que o aceite cobra, num objeto só', () => {
  const e = entrada({
    mensagem_cliente: 'quero dtf textil, 10 peças',
    escritas_estado_tentadas: [{ slots: { produto: 'dtf_textil', quantidade: 10 } }],
    resposta_json: { responde: true, slots: { produto: 'dtf_textil' } },
    model_calls: 2,
  });
  const o = observarExecucao(e);
  assert.equal(o.candidato_slots.produto, 'dtf_textil');
  assert.equal(o.candidato_slots.produto_macro, 'dtf_textil');
  assert.equal(o.proveniencia.fonte, 'mensagem_cliente');
  assert.equal(o.proveniencia.promovido, true);
  assert.equal(o.chegou_ao_modelo, true);
  assert.equal(o.model_call_count, 2);
  assert.equal(o.guard_interruptor, null);
  assert.equal(aplicarRegraProduto('MELHOROU', true, o.proveniencia).veredito, 'MELHOROU');
});
