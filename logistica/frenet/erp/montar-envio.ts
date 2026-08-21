// Montador de PedidoEnvio a partir do ERP.
//
// Decisao do dono, 21/08/2026: a emissao roda como ERP + Agente. O ERP
// (projeto ynjsflvdfftcopibzxyo) e dono dos dados e do estado; o agente
// controlado e fail-closed executa a chamada Frenet. Nao ha ponte
// Cerebro -> ERP a construir: calcular-frete continua no Cerebro so para COTAR.
//
// Este modulo e a unica porta por onde um PedidoEnvio pode nascer. Um agente
// nunca monta payload livremente: ele passa linhas do ERP por aqui e recebe
// ou um envio valido, ou a lista estruturada do que falta.

import {
  Autoridade,
  OrigemMedida,
  Veredito,
  type Bloqueio,
  type Endereco,
  type ItemEnvio,
  type Pacote,
  type Parte,
  type PedidoEnvio,
} from '../tipos.ts';

// ---------------------------------------------------------------- linhas ERP
// Os nomes espelham as colunas reais, para o mapeamento ser conferivel.

export interface LinhaVenda {
  id: string;
  numero_venda: string | null;
  status: string | null;
  total_liquido: number | null;
  /** jsonb: override de entrega no pedido. */
  endereco_entrega: Record<string, unknown> | null;
}

export interface LinhaClienteDados {
  id: string;
  pessoa_id: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  /** jsonb: override de entrega no cliente. */
  endereco_entrega: Record<string, unknown> | null;
}

export interface LinhaPessoa {
  id: string;
  nome: string | null;
  cpf: string | null;
  cnpj: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
}

export interface LinhaPerfilEmpresa {
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

export interface LinhaItemVenda {
  produto_id: string | null;
  quantidade: number | null;
  produto_nome: string | null;
  produto_sku: string | null;
  unidade_venda: string | null;
  peso_bruto_kg: number | null;
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
  /**
   * Procedencia da medida. O ERP NAO tem esta coluna hoje — ver
   * ../sql/0002_erp_logistica_medidas.sql, nao aplicada. Enquanto nao existir,
   * o repositorio deve passar DESCONHECIDA e a emissao fica fechada.
   */
  medida_origem: OrigemMedida | null;
}

/**
 * Regra de embalagem: como N pecas viram M volumes.
 *
 * NAO EXISTE NO ERP HOJE. E o que separa "o produto tem peso" de "sei o peso
 * do volume que vai ser postado". A venda 30 do ERP e o caso didatico: 40
 * unidades de um produto cadastrado com 0,150 kg e 10x30x40 cm — que sao as
 * medidas de UMA peca. 40 pecas nao cabem numa caixa 10x30x40, e o frete
 * cobra o volume, nao a peca.
 */
export interface RegraEmbalagem {
  produto_id: string;
  /** Quantas pecas cabem por volume antes de abrir o proximo. */
  pecas_por_volume: number;
  /** Medidas do volume cheio, ja incluindo a embalagem. */
  volume_altura_cm: number;
  volume_largura_cm: number;
  volume_comprimento_cm: number;
  /** Peso da embalagem vazia, somado ao peso das pecas. */
  tara_kg: number;
  origem: OrigemMedida;
}

export interface EntradaMontagem {
  venda: LinhaVenda;
  cliente: LinhaClienteDados | null;
  pessoa: LinhaPessoa | null;
  empresa: LinhaPerfilEmpresa | null;
  itens: readonly LinhaItemVenda[];
  /** Indexadas por produto_id. Vazio hoje: a tabela nao existe. */
  regras: ReadonlyMap<string, RegraEmbalagem>;
  /** Servico escolhido na cotacao. Sem ele nao ha o que emitir. */
  servico: PedidoEnvio['servico'] | null;
  solicitado_por: PedidoEnvio['solicitado_por'];
  /** uuid estavel do envio; vira o OrderId enviado a Frenet. */
  envio_id: string;
}

export type ResultadoMontagem =
  | { ok: true; envio: PedidoEnvio }
  | { ok: false; bloqueios: Bloqueio[] };

// --------------------------------------------------------------- utilidades

const digitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const limpo = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function b(campo: string, motivo: string, veredito: Veredito = Veredito.BLOCKED_DADOS, extra: Partial<Bloqueio> = {}): Bloqueio {
  return { veredito, campo, motivo, ...extra };
}

/**
 * Endereco efetivo de entrega. Precedencia: override do pedido, depois
 * override do cliente, depois cadastro. Nunca mistura as tres fontes: um
 * override parcial que perdesse o numero viraria etiqueta errada.
 */
export function enderecoEfetivo(
  venda: LinhaVenda,
  cliente: LinhaClienteDados | null,
): { fonte: string; end: Partial<Endereco> } {
  const doJson = (j: Record<string, unknown> | null, fonte: string) => {
    if (!j || Object.keys(j).length === 0) return null;
    return {
      fonte,
      end: {
        cep: digitos(limpo(j.cep)) || undefined,
        logradouro: limpo(j.logradouro) ?? undefined,
        numero: limpo(j.numero) ?? undefined,
        complemento: limpo(j.complemento),
        bairro: limpo(j.bairro) ?? undefined,
        cidade: limpo(j.cidade) ?? undefined,
        uf: (limpo(j.estado) ?? limpo(j.uf) ?? undefined)?.toUpperCase(),
        pais: 'BR' as const,
      },
    };
  };

  return doJson(venda.endereco_entrega, 'vendas.endereco_entrega')
    ?? doJson(cliente?.endereco_entrega ?? null, 'pessoa_cliente_dados.endereco_entrega')
    ?? {
      fonte: 'pessoa_cliente_dados',
      end: {
        cep: digitos(cliente?.cep) || undefined,
        logradouro: limpo(cliente?.logradouro) ?? undefined,
        numero: limpo(cliente?.numero) ?? undefined,
        complemento: limpo(cliente?.complemento),
        bairro: limpo(cliente?.bairro) ?? undefined,
        cidade: limpo(cliente?.cidade) ?? undefined,
        uf: (limpo(cliente?.estado) ?? undefined)?.toUpperCase(),
        pais: 'BR' as const,
      },
    };
}

function completarParte(
  prefixo: string,
  dados: Partial<Parte>,
  end: Partial<Endereco>,
  out: Bloqueio[],
): Parte | null {
  const faltou = (campo: string, motivo = 'ausente') => out.push(b(`${prefixo}.${campo}`, motivo));

  if (!dados.nome) faltou('nome');
  if (!dados.documento) faltou('documento');
  if (!dados.telefone) faltou('telefone');
  if (!dados.email) faltou('email');
  if (!end.cep) faltou('endereco.cep');
  if (!end.logradouro) faltou('endereco.logradouro');
  if (!end.numero) faltou('endereco.numero', 'ausente_numero_nao_pode_ser_deduzido_do_cep');
  if (!end.bairro) faltou('endereco.bairro');
  if (!end.cidade) faltou('endereco.cidade');
  if (!end.uf) faltou('endereco.uf');

  if (!dados.nome || !dados.documento || !dados.telefone || !dados.email
      || !end.cep || !end.logradouro || !end.numero || !end.bairro || !end.cidade || !end.uf) {
    return null;
  }

  return {
    nome: dados.nome,
    documento: dados.documento,
    tipo_documento: dados.tipo_documento ?? (dados.documento.length === 14 ? 'CNPJ' : 'CPF'),
    telefone: dados.telefone,
    email: dados.email,
    endereco: {
      cep: end.cep, logradouro: end.logradouro, numero: end.numero,
      complemento: end.complemento ?? null, bairro: end.bairro,
      cidade: end.cidade, uf: end.uf, pais: 'BR',
    },
  };
}

/**
 * Converte itens em volumes. Fail-closed em tres pontos distintos, porque
 * sao tres faltas diferentes e o operador precisa saber qual e:
 *   1. o produto nao tem medida cadastrada;
 *   2. a medida existe mas nao tem procedencia fisica;
 *   3. existe medida de PECA mas nao existe regra de EMBALAGEM.
 */
export function montarPacotes(
  itens: readonly LinhaItemVenda[],
  regras: ReadonlyMap<string, RegraEmbalagem>,
  out: Bloqueio[],
): Pacote[] {
  const pacotes: Pacote[] = [];

  itens.forEach((it, i) => {
    const rotulo = `itens[${i}]${it.produto_nome ? ` (${it.produto_nome})` : ''}`;
    const qtd = Number(it.quantidade ?? 0);

    if (!Number.isFinite(qtd) || qtd <= 0) {
      out.push(b(`${rotulo}.quantidade`, 'invalida'));
      return;
    }

    const temMedida = it.peso_bruto_kg != null && it.altura_cm != null
      && it.largura_cm != null && it.comprimento_cm != null;
    if (!temMedida) {
      out.push(b(`${rotulo}.medida_do_produto`, 'produto_sem_peso_ou_dimensoes_cadastradas',
        Veredito.BLOCKED_FONTE, { autoridade: Autoridade.AUSENTE, fonte_esperada: 'ERP.public.produtos' }));
      return;
    }

    const origem = it.medida_origem ?? OrigemMedida.DESCONHECIDA;
    if (origem !== OrigemMedida.FICHA_FISICA && origem !== OrigemMedida.AFERIDO_NA_EXPEDICAO) {
      out.push(b(`${rotulo}.medida_origem`, `medida_sem_procedencia_fisica:${origem}`,
        Veredito.BLOCKED_FONTE, { autoridade: Autoridade.AUSENTE, fonte_esperada: 'ERP.public.produtos.medida_origem (coluna nao existe)' }));
      return;
    }

    const regra = it.produto_id ? regras.get(it.produto_id) : undefined;
    if (!regra) {
      // O ponto que separa "produto tem peso" de "sei o peso do volume".
      out.push(b(`${rotulo}.regra_de_embalagem`,
        `sem_regra_para_${qtd}_unidades_a_medida_cadastrada_e_de_uma_peca`,
        Veredito.BLOCKED_FONTE, { autoridade: Autoridade.AUSENTE, fonte_esperada: 'regra de embalagem por produto (nao existe)' }));
      return;
    }

    const volumes = Math.ceil(qtd / regra.pecas_por_volume);
    for (let v = 0; v < volumes; v++) {
      const pecasNesteVolume = Math.min(regra.pecas_por_volume, qtd - v * regra.pecas_por_volume);
      pacotes.push({
        altura_cm: regra.volume_altura_cm,
        largura_cm: regra.volume_largura_cm,
        comprimento_cm: regra.volume_comprimento_cm,
        peso_kg: Number((pecasNesteVolume * Number(it.peso_bruto_kg) + regra.tara_kg).toFixed(3)),
        origem_medida: regra.origem,
      });
    }
  });

  return pacotes;
}

export function montarEnvio(e: EntradaMontagem): ResultadoMontagem {
  const bloqueios: Bloqueio[] = [];

  if (!e.cliente) bloqueios.push(b('pedido.cliente_id', 'venda_sem_cliente_vinculado'));
  if (!e.pessoa) bloqueios.push(b('pedido.pessoa', 'cliente_sem_pessoa_vinculada'));
  if (!e.empresa) bloqueios.push(b('remetente', 'perfil_empresa_ausente'));

  const { end } = enderecoEfetivo(e.venda, e.cliente);
  const destinatario = completarParte('destinatario', {
    nome: limpo(e.pessoa?.nome) ?? undefined,
    documento: digitos(e.pessoa?.cpf ?? e.pessoa?.cnpj) || undefined,
    telefone: digitos(e.pessoa?.telefone ?? e.pessoa?.whatsapp) || undefined,
    email: limpo(e.pessoa?.email) ?? undefined,
  }, end, bloqueios);

  const remetente = completarParte('remetente', {
    nome: limpo(e.empresa?.razao_social) ?? limpo(e.empresa?.nome_fantasia) ?? undefined,
    documento: digitos(e.empresa?.cnpj) || undefined,
    tipo_documento: 'CNPJ',
    telefone: digitos(e.empresa?.telefone) || undefined,
    email: limpo(e.empresa?.email) ?? undefined,
  }, {
    cep: digitos(e.empresa?.cep) || undefined,
    logradouro: limpo(e.empresa?.logradouro) ?? undefined,
    numero: limpo(e.empresa?.numero) ?? undefined,
    complemento: limpo(e.empresa?.complemento),
    bairro: limpo(e.empresa?.bairro) ?? undefined,
    cidade: limpo(e.empresa?.cidade) ?? undefined,
    uf: (limpo(e.empresa?.estado) ?? undefined)?.toUpperCase(),
    pais: 'BR',
  }, bloqueios);

  if (!e.itens.length) bloqueios.push(b('itens', 'venda_sem_itens'));
  const pacotes = montarPacotes(e.itens, e.regras, bloqueios);

  const valor = Number(e.venda.total_liquido ?? 0);
  if (!Number.isFinite(valor) || valor <= 0) bloqueios.push(b('valor_declarado', 'total_liquido_ausente_ou_invalido'));

  if (!e.servico) bloqueios.push(b('servico', 'nenhuma_cotacao_escolhida'));

  if (bloqueios.length > 0 || !destinatario || !remetente || !e.servico) {
    return { ok: false, bloqueios };
  }

  const itens: ItemEnvio[] = e.itens.map((it) => ({
    sku: it.produto_sku ?? it.produto_id ?? 'SEM-SKU',
    descricao: it.produto_nome ?? 'Item',
    quantidade: Number(it.quantidade),
    peso_kg: Number(it.peso_bruto_kg),
    valor_unitario: 0,
    categoria: it.unidade_venda === 'metro_linear' ? 'Tecido' : 'Vestuario',
  }));

  return {
    ok: true,
    envio: {
      envio_id: e.envio_id,
      pedido_id: e.venda.numero_venda ?? e.venda.id,
      pedido_fonte: 'ERP.public.vendas',
      remetente,
      destinatario,
      itens,
      pacotes,
      valor_declarado: valor,
      servico: e.servico,
      solicitado_por: e.solicitado_por,
    },
  };
}
