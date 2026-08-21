// Testes do montador ERP -> PedidoEnvio.
// Fixtures copiadas de linhas REAIS do ERP ynjsflvdfftcopibzxyo em 21/08/2026.
// Rodar: node --experimental-strip-types --test logistica/frenet/test/montar-envio.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import { OrigemMedida, Veredito } from '../tipos.ts';
import {
  montarEnvio, montarPacotes, enderecoEfetivo,
  type EntradaMontagem, type LinhaItemVenda, type RegraEmbalagem,
} from '../erp/montar-envio.ts';

const EMPRESA = {
  razao_social: 'Skillprint LTDA', nome_fantasia: 'Skillprint Estamparia',
  cnpj: '30248650000111', email: 'contato@skillprint.test', telefone: '1145678900',
  // CEP canonico decidido pelo dono em 21/08/2026.
  cep: '06813-230', logradouro: 'Rua Água Branca', numero: '185',
  complemento: null, bairro: 'Jardim Laila', cidade: 'Embu das Artes', estado: 'SP',
};

const CLIENTE = {
  id: 'c18ca601-ced3-418c-bd3f-0ab17dfa5296', pessoa_id: 'p1',
  cep: '05880-280', logradouro: 'Rua diamante verde', numero: '28',
  complemento: null, bairro: 'Parque Independência', cidade: 'São Paulo',
  estado: 'SP', endereco_entrega: null,
};

const PESSOA = {
  id: 'p1', nome: 'Cliente Real', cpf: '39053344705', cnpj: null,
  telefone: '11988887777', whatsapp: null, email: 'cliente@teste.test',
};

const SERVICO = {
  codigo: '04014', descricao: 'Sedex', transportadora: 'Correios',
  preco_cotado: 32.5, prazo_dias: 3,
  cotado_em: '2026-08-21T12:00:00.000Z', cotacao_ref: 'op-frete-123',
};

/** Venda 30 do ERP: 40 unidades de Baby look 100% algodão. */
const ITEM_VENDA_30: LinhaItemVenda = {
  produto_id: 'prod-baby-look', quantidade: 40,
  produto_nome: 'Baby look 100% algodão', produto_sku: null, unidade_venda: 'unidade',
  peso_bruto_kg: 0.15, altura_cm: 10, largura_cm: 30, comprimento_cm: 40,
  medida_origem: null, // o ERP nao tem esta coluna hoje
};

function entrada(over: Partial<EntradaMontagem> = {}): EntradaMontagem {
  return {
    envio_id: '11111111-1111-4111-8111-111111111111',
    venda: { id: 'v30', numero_venda: '30', status: 'em_producao', total_liquido: 1259.6, endereco_entrega: null },
    cliente: CLIENTE, pessoa: PESSOA, empresa: EMPRESA,
    itens: [ITEM_VENDA_30],
    regras: new Map<string, RegraEmbalagem>(),
    servico: SERVICO,
    solicitado_por: { tipo: 'humano', id: 'alessandro', nome: 'Alessandro' },
    ...over,
  };
}

const REGRA_HIPOTETICA: RegraEmbalagem = {
  produto_id: 'prod-baby-look', pecas_por_volume: 25,
  volume_altura_cm: 40, volume_largura_cm: 40, volume_comprimento_cm: 50,
  tara_kg: 0.2, origem: OrigemMedida.FICHA_FISICA,
};

// ------------------------------------------------------- o caso que importa

test('venda 30 real e RECUSADA: 40 pecas com medida de 1 peca e sem regra de embalagem', () => {
  const r = montarEnvio(entrada());
  assert.equal(r.ok, false);
  if (r.ok) return;
  // A falta de procedencia aparece antes da falta de regra: sao faltas distintas.
  assert.ok(r.bloqueios.some((x) => x.campo.includes('medida_origem')), 'procedencia');
});

test('mesmo com procedencia, 40 pecas sem regra de embalagem continuam recusadas', () => {
  const r = montarEnvio(entrada({
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
  }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  const bloq = r.bloqueios.find((x) => x.campo.includes('regra_de_embalagem'));
  assert.ok(bloq, 'deve apontar a regra de embalagem');
  assert.match(bloq.motivo, /40_unidades/);
  assert.equal(bloq.veredito, Veredito.BLOCKED_FONTE);
});

test('produto sem medida cadastrada e recusado por FONTE, nao por DADOS', () => {
  const r = montarEnvio(entrada({
    itens: [{ ...ITEM_VENDA_30, peso_bruto_kg: null, altura_cm: null, largura_cm: null, comprimento_cm: null }],
  }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  const bloq = r.bloqueios.find((x) => x.campo.includes('medida_do_produto'));
  assert.ok(bloq);
  assert.equal(bloq.veredito, Veredito.BLOCKED_FONTE);
});

test('com procedencia E regra, 40 pecas viram 2 volumes com peso somado + tara', () => {
  const r = montarEnvio(entrada({
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
    regras: new Map([[REGRA_HIPOTETICA.produto_id, REGRA_HIPOTETICA]]),
  }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.envio.pacotes.length, 2, '40 / 25 = 2 volumes');
  // 25 pecas * 0,15 + 0,2 de tara = 3,95 ; 15 pecas * 0,15 + 0,2 = 2,45
  assert.equal(r.envio.pacotes[0].peso_kg, 3.95);
  assert.equal(r.envio.pacotes[1].peso_kg, 2.45);
  // Nenhum volume herda as medidas da peca.
  assert.equal(r.envio.pacotes[0].altura_cm, 40);
});

test('peso do volume nunca e o peso da peca quando a quantidade e maior que 1', () => {
  const pacotes = montarPacotes(
    [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
    new Map([[REGRA_HIPOTETICA.produto_id, REGRA_HIPOTETICA]]),
    [],
  );
  const total = pacotes.reduce((s, p) => s + p.peso_kg, 0);
  assert.ok(total > 0.15 * 40, 'soma dos volumes deve superar o peso liquido das pecas');
});

// ----------------------------------------------------------------- endereco

test('sem override, vale o endereco cadastral do cliente', () => {
  const { fonte, end } = enderecoEfetivo(entrada().venda, CLIENTE);
  assert.equal(fonte, 'pessoa_cliente_dados');
  assert.equal(end.cep, '05880280');
  assert.equal(end.numero, '28');
});

test('override no pedido vence override do cliente e vence cadastro', () => {
  const { fonte, end } = enderecoEfetivo(
    { ...entrada().venda, endereco_entrega: { cep: '06814-210', logradouro: 'Rua Argentina', numero: '204', bairro: 'Jardim dos Moraes', cidade: 'Embu das Artes', estado: 'SP', complemento: '' } },
    { ...CLIENTE, endereco_entrega: { cep: '00000-000', logradouro: 'X', numero: '1', bairro: 'Y', cidade: 'Z', estado: 'SP' } },
  );
  assert.equal(fonte, 'vendas.endereco_entrega');
  assert.equal(end.cep, '06814210');
  assert.equal(end.logradouro, 'Rua Argentina');
});

test('override parcial nao mistura fontes: falta o que faltar nele', () => {
  const r = montarEnvio(entrada({
    venda: { ...entrada().venda, endereco_entrega: { cep: '06814-210', cidade: 'Embu das Artes', estado: 'SP' } },
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
    regras: new Map([[REGRA_HIPOTETICA.produto_id, REGRA_HIPOTETICA]]),
  }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  // Nao pode ter puxado logradouro/numero do cadastro para tapar o buraco.
  assert.ok(r.bloqueios.some((x) => x.campo === 'destinatario.endereco.logradouro'));
  assert.ok(r.bloqueios.some((x) => x.campo === 'destinatario.endereco.numero'));
});

// ----------------------------------------------------------------- remetente

test('remetente sai do perfil_empresa com o CEP canonico 06813-230', () => {
  const r = montarEnvio(entrada({
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
    regras: new Map([[REGRA_HIPOTETICA.produto_id, REGRA_HIPOTETICA]]),
  }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.envio.remetente.endereco.cep, '06813230');
  assert.equal(r.envio.remetente.endereco.logradouro, 'Rua Água Branca');
  assert.equal(r.envio.remetente.documento, '30248650000111');
  assert.equal(r.envio.remetente.tipo_documento, 'CNPJ');
});

// --------------------------------------------------------------- venda 19

test('venda 19 real (sem cliente_id) e recusada com faltas nomeadas', () => {
  const r = montarEnvio(entrada({ cliente: null, pessoa: null }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.bloqueios.some((x) => x.campo === 'pedido.cliente_id'));
  assert.ok(r.bloqueios.some((x) => x.campo === 'destinatario.endereco.cep'));
});

test('venda sem itens e recusada', () => {
  const r = montarEnvio(entrada({ itens: [] }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.bloqueios.some((x) => x.campo === 'itens'));
});

test('sem cotacao escolhida nao ha o que emitir', () => {
  const r = montarEnvio(entrada({
    servico: null,
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.FICHA_FISICA }],
    regras: new Map([[REGRA_HIPOTETICA.produto_id, REGRA_HIPOTETICA]]),
  }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.bloqueios.some((x) => x.campo === 'servico'));
});

test('o montador nunca devolve envio parcial: ok=true implica zero bloqueios', () => {
  const r = montarEnvio(entrada({
    itens: [{ ...ITEM_VENDA_30, medida_origem: OrigemMedida.AFERIDO_NA_EXPEDICAO }],
    regras: new Map([[REGRA_HIPOTETICA.produto_id, { ...REGRA_HIPOTETICA, origem: OrigemMedida.AFERIDO_NA_EXPEDICAO }]]),
  }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.envio.destinatario.endereco.cep);
  assert.ok(r.envio.remetente.endereco.cep);
  assert.ok(r.envio.pacotes.length > 0);
});
