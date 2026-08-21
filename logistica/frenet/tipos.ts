// Frente canonica: agente-logistica-criar-etiqueta (trilha erp)
// Contrato de tipos para criacao de etiqueta Frenet.
//
// REGRA ESTRUTURAL: nenhum payload Frenet nasce de texto livre de LLM ou de
// entrada de operador. Todo payload e derivado destes tipos, que so podem ser
// preenchidos a partir de fonte canonica classificada em `fontes.ts`.

/** Efeito externo de um endpoint. Governa o que cada estado pode chamar. */
export const Efeito = {
  /** Nenhuma mutacao e nenhum debito. Consulta pura. */
  NENHUM: 'NENHUM',
  /** Leitura de estado ja existente na Frenet (ex.: rastrear pedido). */
  LEITURA: 'LEITURA',
  /** Cria pedido/envio na Frenet, sem debitar. Reversivel via cancelamento. */
  MUTACAO_SEM_DEBITO: 'MUTACAO_SEM_DEBITO',
  /** Compra frete / debita carteira / imprime etiqueta. Irreversivel. */
  FINANCEIRO: 'FINANCEIRO',
} as const;
export type Efeito = typeof Efeito[keyof typeof Efeito];

/** Estados distintos exigidos pela frente. Cotar nunca compra. */
export const Estado = {
  COTAR: 'COTAR',
  VALIDAR_EMISSAO: 'VALIDAR_EMISSAO',
  EMITIR: 'EMITIR',
} as const;
export type Estado = typeof Estado[keyof typeof Estado];

/** Resultado de VALIDAR_EMISSAO. Nenhum destes tem efeito financeiro. */
export const Veredito = {
  READY: 'READY',
  BLOCKED_DADOS: 'BLOCKED_DADOS',
  BLOCKED_FONTE: 'BLOCKED_FONTE',
  BLOCKED_POLITICA: 'BLOCKED_POLITICA',
  BLOCKED_IDEMPOTENCIA: 'BLOCKED_IDEMPOTENCIA',
  NEEDS_HUMAN: 'NEEDS_HUMAN',
} as const;
export type Veredito = typeof Veredito[keyof typeof Veredito];

/** Classificacao de autoridade de uma fonte de dado. */
export const Autoridade = {
  /** Localizada, preenchida e vinculavel ao pedido correto. Unica que emite. */
  FONTE_CANONICA_PROVADA: 'FONTE_CANONICA_PROVADA',
  /** Existe, mas cobertura ou vinculo com o pedido ainda nao provados. */
  FONTE_CANDIDATA: 'FONTE_CANDIDATA',
  /** Fonte certa, preenchimento parcial. */
  INCOMPLETO: 'INCOMPLETO',
  /** Duas fontes vivas divergem. Escolher e decisao de negocio, nao de codigo. */
  AMBIGUA: 'AMBIGUA',
  /** Nao existe em nenhuma fonte conhecida. */
  AUSENTE: 'AUSENTE',
  AINDA_EM_DESENVOLVIMENTO: 'AINDA_EM_DESENVOLVIMENTO',
  /** Existe e e legitima para cotar, mas nao pode sustentar emissao. */
  NAO_AUTORIZADA: 'NAO_AUTORIZADA',
} as const;
export type Autoridade = typeof Autoridade[keyof typeof Autoridade];

export interface Endereco {
  cep: string;          // 8 digitos, sem mascara
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;           // 2 letras
  pais: 'BR';
}

export interface Parte {
  nome: string;
  documento: string;        // CPF (11) ou CNPJ (14), somente digitos
  tipo_documento: 'CPF' | 'CNPJ';
  telefone: string;         // somente digitos, com DDD
  email: string;
  endereco: Endereco;
}

export interface ItemEnvio {
  sku: string;
  descricao: string;
  quantidade: number;
  /** Peso unitario em kg. Nunca inferido: vem de fonte fisica declarada. */
  peso_kg: number;
  valor_unitario: number;
  categoria: string;
}

/**
 * Pacote fisico realmente despachado. Distinto do item:
 * o que a transportadora cobra e o volume, nao a peca.
 */
export interface Pacote {
  altura_cm: number;
  largura_cm: number;
  comprimento_cm: number;
  peso_kg: number;
  /** Como estes numeros foram obtidos. Heuristica nao emite. */
  origem_medida: OrigemMedida;
}

export const OrigemMedida = {
  /** Medido/declarado por humano na ficha fisica do produto ou da embalagem. */
  FICHA_FISICA: 'FICHA_FISICA',
  /** Pesado/medido no ato da expedicao. */
  AFERIDO_NA_EXPEDICAO: 'AFERIDO_NA_EXPEDICAO',
  /** Derivado de regra (ex.: frete_config.embalagem). Serve para COTAR, nunca para EMITIR. */
  HEURISTICA_CONFIG: 'HEURISTICA_CONFIG',
  /** Sem procedencia. Nunca aceito. */
  DESCONHECIDA: 'DESCONHECIDA',
} as const;
export type OrigemMedida = typeof OrigemMedida[keyof typeof OrigemMedida];

export interface ServicoEscolhido {
  /** Codigo do servico como devolvido pela cotacao Frenet. */
  codigo: string;
  descricao: string;
  transportadora: string;
  preco_cotado: number;
  prazo_dias: number;
  /** Momento da cotacao que originou esta escolha. */
  cotado_em: string;      // ISO-8601
  /** Id da operacao de cotacao persistida (rastreabilidade custo x etiqueta). */
  cotacao_ref: string;
}

/**
 * Unidade canonica desta frente. Um envio pertence a exatamente um pedido.
 * `envio_id` e o OrderId enviado a Frenet — nunca telefone, CPF ou email.
 */
export interface PedidoEnvio {
  envio_id: string;         // uuid v4 nosso, estavel por pedido+destino+pacote
  pedido_id: string;        // id canonico do pedido no ERP/Cerebro
  pedido_fonte: string;     // qual sistema/tabela e a autoridade do pedido
  remetente: Parte;
  destinatario: Parte;
  itens: ItemEnvio[];
  pacotes: Pacote[];
  valor_declarado: number;
  servico: ServicoEscolhido;
  /** Quem pediu a emissao (agente/usuario). Auditavel. */
  solicitado_por: Autor;
}

export interface Autor {
  tipo: 'humano' | 'agente';
  id: string;
  nome: string;
}

/** Motivo estruturado de bloqueio. Nunca texto livre solto. */
export interface Bloqueio {
  veredito: Veredito;
  campo: string;
  motivo: string;
  fonte_esperada?: string;
  autoridade?: Autoridade;
}

export interface ResultadoValidacao {
  veredito: Veredito;
  /** READY exige lista vazia. Fail-closed. */
  bloqueios: Bloqueio[];
  /** Chave de idempotencia derivada, presente mesmo quando bloqueado. */
  chave_idempotencia: string | null;
  avaliado_em: string;
}
