// Catalogo de endpoints Frenet, classificado por EFEITO e nao por nome.
//
// AUDITORIA D/E — 21/08/2026. Limite honesto desta sessao: o egress deste
// ambiente bloqueia docs.frenet.com.br, api.frenet.com.br e frenet.com.br
// (CONNECT tunnel 403). Portanto a coluna `verificado` diz exatamente como
// cada linha foi estabelecida. Nada aqui foi chamado.
//
// Provado por codigo em producao:
//   - shipping/quote (calcular-frete v34 ACTIVE, ezbr 568730ee...)
// Provado pelo SDK oficial FrenetGatewaydeFretes/frenet-php (clonado):
//   - shipping/quote, shipping/info, CEP/Address, tracking/trackinginfo
//   - o SDK oficial NAO tem criacao de pedido nem compra de etiqueta:
//     essa superficie e do produto Whitelabel/Envios, com base e tokens proprios.
// Indicado por indice publico de documentacao (nao lido diretamente daqui):
//   - orders, orders/oneclick, shipments/oneclick, trackorder, webhooks.

import { Efeito } from './tipos.ts';

export const Familia = {
  /** api.frenet.com.br — Gateway de cotacao. Autentica com Token do Cliente. */
  GATEWAY: 'GATEWAY',
  /** Whitelabel/Envios v1 — pedidos e etiquetas. Exige credencial de parceiro. */
  WHITELABEL: 'WHITELABEL',
} as const;
export type Familia = typeof Familia[keyof typeof Familia];

export const Verificacao = {
  /** Confirmado em codigo nosso hoje em producao. */
  PRODUCAO_NOSSA: 'PRODUCAO_NOSSA',
  /** Confirmado no SDK oficial da Frenet. */
  SDK_OFICIAL: 'SDK_OFICIAL',
  /** Somente indice publico de documentacao; nao lido nem chamado nesta sessao. */
  DOC_NAO_LIDA: 'DOC_NAO_LIDA',
} as const;
export type Verificacao = typeof Verificacao[keyof typeof Verificacao];

export interface DescritorEndpoint {
  id: string;
  familia: Familia;
  /** Caminho relativo. A base vem de configuracao, nunca hardcoded para Whitelabel. */
  caminho: string;
  metodo: 'GET' | 'POST';
  efeito: Efeito;
  proposito: string;
  precondicoes: string[];
  verificado: Verificacao;
}

export const ENDPOINTS: readonly DescritorEndpoint[] = Object.freeze([
  {
    id: 'gateway.shipping.quote',
    familia: Familia.GATEWAY,
    caminho: '/shipping/quote',
    metodo: 'POST',
    efeito: Efeito.NENHUM,
    proposito: 'Cotar frete. Devolve ShippingSevicesArray com preco, prazo e ServiceCode.',
    precondicoes: ['header token = Token do Cliente', 'CEP origem e destino', 'ShippingItemArray com peso e dimensoes'],
    verificado: Verificacao.PRODUCAO_NOSSA,
  },
  {
    id: 'gateway.shipping.info',
    familia: Familia.GATEWAY,
    caminho: '/shipping/info',
    metodo: 'GET',
    efeito: Efeito.NENHUM,
    proposito: 'Informacoes da conta/servicos habilitados.',
    precondicoes: ['header token = Token do Cliente'],
    verificado: Verificacao.SDK_OFICIAL,
  },
  {
    id: 'gateway.cep.address',
    familia: Familia.GATEWAY,
    caminho: '/CEP/Address',
    metodo: 'GET',
    efeito: Efeito.NENHUM,
    proposito: 'Resolver endereco a partir do CEP. Completa logradouro/bairro/cidade/UF, nunca o numero.',
    precondicoes: ['header token = Token do Cliente'],
    verificado: Verificacao.SDK_OFICIAL,
  },
  {
    id: 'gateway.tracking.trackinginfo',
    familia: Familia.GATEWAY,
    caminho: '/tracking/trackinginfo',
    metodo: 'POST',
    efeito: Efeito.LEITURA,
    proposito: 'Consultar eventos de rastreio por TrackingNumber (pull).',
    precondicoes: ['header token = Token do Cliente', 'TrackingNumber ja existente'],
    verificado: Verificacao.SDK_OFICIAL,
  },
  {
    id: 'whitelabel.orders.create',
    familia: Familia.WHITELABEL,
    caminho: '/v1/orders',
    metodo: 'POST',
    efeito: Efeito.MUTACAO_SEM_DEBITO,
    proposito: 'Criar pedido na plataforma Frenet. Fica "aguardando pagamento" e depois "aguardando impressao". NAO debita.',
    precondicoes: [
      'credencial de parceiro (FRENET_PARTNER_TOKEN) + credencial do cliente (TOKEN_FRENET)',
      'base URL de producao entregue pela Frenet na homologacao',
      'remetente e destinatario completos',
      'peso e dimensoes reais do volume',
    ],
    verificado: Verificacao.DOC_NAO_LIDA,
  },
  {
    id: 'whitelabel.orders.oneclick',
    familia: Familia.WHITELABEL,
    caminho: '/v1/orders/oneclick',
    metodo: 'POST',
    efeito: Efeito.FINANCEIRO,
    proposito: 'Valida, cria pedido(s), EFETUA O PAGAMENTO e imprime etiqueta em uma unica requisicao.',
    precondicoes: [
      'tudo de whitelabel.orders.create',
      'saldo em carteira Frenet',
      'gate humano explicito: uma requisicao ja compra',
    ],
    verificado: Verificacao.DOC_NAO_LIDA,
  },
  {
    id: 'whitelabel.shipments.oneclick',
    familia: Familia.WHITELABEL,
    caminho: '/v1/shipments/oneclick',
    metodo: 'POST',
    efeito: Efeito.FINANCEIRO,
    proposito: 'Gerar etiqueta no nivel de shipment (modelo Whitelabel completo).',
    precondicoes: ['modelo Whitelabel homologado', 'gestao de sub-contas/merchants na nossa plataforma'],
    verificado: Verificacao.DOC_NAO_LIDA,
  },
  {
    id: 'whitelabel.orders.track',
    familia: Familia.WHITELABEL,
    caminho: '/v1/orders/track',
    metodo: 'GET',
    efeito: Efeito.LEITURA,
    proposito: 'Rastrear pedido ja criado (pull), complemento do webhook.',
    precondicoes: ['OrderId ou ShipmentId existente'],
    verificado: Verificacao.DOC_NAO_LIDA,
  },
]);

const POR_ID = new Map(ENDPOINTS.map((e) => [e.id, e]));

export function endpoint(id: string): DescritorEndpoint {
  const e = POR_ID.get(id);
  if (!e) throw new Error(`endpoint_desconhecido:${id}`);
  return e;
}

/**
 * ESCOLHA DESTA FRENTE.
 *
 * Cotar  -> gateway.shipping.quote (efeito NENHUM).
 * Emitir -> whitelabel.orders.create, e NAO orders/oneclick.
 *
 * Motivo, por efeito e nao por nome: `orders/oneclick` valida, cria, PAGA e
 * imprime numa unica requisicao. Um timeout nele deixa um debito de resultado
 * desconhecido e nao ha ponto de parada entre "existe pedido" e "comprei
 * frete". `orders` separa esses dois fatos: cria o pedido (reversivel, sem
 * debito), deixa em "aguardando pagamento", e o pagamento/impressao acontece
 * num segundo passo observavel. E o unico desenho compativel com o criterio
 * "repeticao da mesma intencao nao compra duas etiquetas" enquanto nao existe
 * reconciliacao provada. `shipments*` e o modelo Whitelabel completo, que
 * pressupoe gerir merchants e carteira de terceiros dentro da nossa
 * plataforma — escopo maior do que esta frente e sem beneficio aqui.
 */
export const ENDPOINT_COTACAO = 'gateway.shipping.quote';
export const ENDPOINT_EMISSAO = 'whitelabel.orders.create';
export const ENDPOINT_PROIBIDO_NESTA_FASE = 'whitelabel.orders.oneclick';
