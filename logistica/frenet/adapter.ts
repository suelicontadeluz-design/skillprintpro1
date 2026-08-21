// Adapter Frenet. Preparado, sem efeito nesta fase.
//
// Duas garantias estruturais:
//   1. `cotar` so aceita endpoint com Efeito.NENHUM. Cotacao nao compra.
//   2. `criarPedido` exige GateAberto e ResultadoValidacao READY. Sem os dois,
//      a funcao nem monta payload.
//
// O payload nunca vem de texto livre: e derivado de PedidoEnvio ja validado.

import {
  Efeito,
  Veredito,
  type PedidoEnvio,
  type ResultadoValidacao,
} from './tipos.ts';
import { ENDPOINT_COTACAO, ENDPOINT_EMISSAO, endpoint } from './endpoints.ts';
import { ehGateAberto, EmissaoBloqueada, type GateAberto } from './gate.ts';
import {
  NOME_BASE_WHITELABEL,
  NOME_TOKEN_CLIENTE,
  NOME_TOKEN_PARCEIRO,
  conferirSeparacaoDeCredenciais,
  exigirSegredo,
  leitorAmbiente,
  type LeitorSegredo,
} from './segredos.ts';
import type { ContratoWebhook } from './webhook.ts';
import { sha256Hex } from './idempotencia.ts';

export const BASE_GATEWAY = 'https://api.frenet.com.br';

export type Buscador = (url: string, init: RequestInit) => Promise<Response>;

export interface OpcoesAdapter {
  ler?: LeitorSegredo;
  buscar?: Buscador;
  timeout_ms?: number;
}

// ---------------------------------------------------------------- COTACAO

export interface PedidoCotacao {
  cep_origem: string;
  cep_destino: string;
  valor_declarado: number;
  itens: Array<{
    altura_cm: number;
    largura_cm: number;
    comprimento_cm: number;
    peso_kg: number;
    quantidade: number;
    sku: string;
    categoria: string;
  }>;
}

export interface OpcaoFrete {
  codigo: string;
  descricao: string;
  transportadora: string;
  preco: number;
  prazo_dias: number;
}

function montarPayloadCotacao(p: PedidoCotacao) {
  return {
    SellerCEP: p.cep_origem.replace(/\D/g, ''),
    RecipientCEP: p.cep_destino.replace(/\D/g, ''),
    ShipmentInvoiceValue: p.valor_declarado,
    RecipientCountry: 'BR',
    ShippingItemArray: p.itens.map((i) => ({
      Height: i.altura_cm,
      Width: i.largura_cm,
      Length: i.comprimento_cm,
      Weight: i.peso_kg,
      Quantity: i.quantidade,
      SKU: i.sku,
      Category: i.categoria,
    })),
  };
}

/**
 * COTAR. Efeito NENHUM, garantido por assercao antes da chamada.
 * Usa o mesmo Token do Cliente ja em uso hoje por calcular-frete v34.
 */
export async function cotar(p: PedidoCotacao, opts: OpcoesAdapter = {}): Promise<OpcaoFrete[]> {
  const desc = endpoint(ENDPOINT_COTACAO);
  if (desc.efeito !== Efeito.NENHUM) {
    throw new Error(`cotacao_apontada_para_endpoint_com_efeito:${desc.efeito}`);
  }
  const ler = opts.ler ?? leitorAmbiente;
  const buscar = opts.buscar ?? ((u, i) => fetch(u, i));

  const res = await buscar(`${BASE_GATEWAY}${desc.caminho}`, {
    method: desc.metodo,
    headers: { 'Content-Type': 'application/json', token: exigirSegredo(NOME_TOKEN_CLIENTE, ler) },
    body: JSON.stringify(montarPayloadCotacao(p)),
  });
  if (!res.ok) throw new Error(`frenet_cotacao_http_${res.status}`);

  const data = await res.json() as {
    ShippingSevicesArray?: unknown[];
    ShippingServiceArray?: unknown[];
  };
  const lista = (data.ShippingSevicesArray ?? data.ShippingServiceArray ?? []) as Array<Record<string, unknown>>;

  return lista
    .filter((s) => !s.Error)
    .map((s) => ({
      codigo: String(s.ServiceCode ?? ''),
      descricao: String(s.ServiceDescription ?? ''),
      transportadora: String(s.Carrier ?? ''),
      preco: Number.parseFloat(String(s.ShippingPrice ?? 'NaN')),
      prazo_dias: Number.parseInt(String(s.DeliveryTime ?? ''), 10),
    }))
    .filter((o) => Number.isFinite(o.preco));
}

// ---------------------------------------------------------------- EMISSAO

export interface PayloadCriacaoPedido {
  OrderNumber: string;
  /** OrderId enviado a Frenet = nosso envio_id. Nunca telefone, CPF ou email. */
  OrderId: string;
  ShippingServiceCode: string;
  ShipmentInvoiceValue: number;
  Sender: PartePayload;
  Recipient: PartePayload;
  ShippingItemArray: Array<Record<string, unknown>>;
  Webhook: { Url: string; TokenName: string; TokenValue: string };
}

interface PartePayload {
  Name: string;
  Document: string;
  Phone: string;
  Email: string;
  Address: {
    PostalCode: string;
    Street: string;
    Number: string;
    Complement: string;
    District: string;
    City: string;
    State: string;
    Country: 'BR';
  };
}

function parteParaPayload(p: PedidoEnvio['destinatario']): PartePayload {
  return {
    Name: p.nome,
    Document: p.documento.replace(/\D/g, ''),
    Phone: p.telefone.replace(/\D/g, ''),
    Email: p.email,
    Address: {
      PostalCode: p.endereco.cep.replace(/\D/g, ''),
      Street: p.endereco.logradouro,
      Number: p.endereco.numero,
      Complement: p.endereco.complemento ?? '',
      District: p.endereco.bairro,
      City: p.endereco.cidade,
      State: p.endereco.uf,
      Country: 'BR',
    },
  };
}

/**
 * Monta o payload de criacao. Publico de proposito: o dry-run precisa
 * inspecionar exatamente o que sairia, sem nada sair.
 */
export function montarPayloadCriacao(envio: PedidoEnvio, webhook: ContratoWebhook): PayloadCriacaoPedido {
  return {
    OrderNumber: envio.pedido_id,
    OrderId: envio.envio_id,
    ShippingServiceCode: envio.servico.codigo,
    ShipmentInvoiceValue: envio.valor_declarado,
    Sender: parteParaPayload(envio.remetente),
    Recipient: parteParaPayload(envio.destinatario),
    ShippingItemArray: envio.pacotes.map((pk, i) => ({
      Height: pk.altura_cm,
      Width: pk.largura_cm,
      Length: pk.comprimento_cm,
      Weight: pk.peso_kg,
      Quantity: 1,
      SKU: envio.itens[i]?.sku ?? envio.itens[0]?.sku ?? envio.pedido_id,
      Category: envio.itens[i]?.categoria ?? envio.itens[0]?.categoria ?? 'Diversos',
    })),
    Webhook: { Url: webhook.url, TokenName: webhook.token_name, TokenValue: webhook.token_value },
  };
}

/** Hash do payload com o segredo do webhook removido. Seguro para persistir. */
export async function hashPayload(p: PayloadCriacaoPedido): Promise<string> {
  const seguro = { ...p, Webhook: { ...p.Webhook, TokenValue: '[REDIGIDO]' } };
  return sha256Hex(JSON.stringify(seguro));
}

export interface ResultadoCriacao {
  http_status: number;
  frenet_order_id: string | null;
  frenet_shipment_id: string | null;
  tracking_number: string | null;
  custo_real: number | null;
  servico_real: string | null;
  bruto: unknown;
}

export interface EntradaCriacao {
  envio: PedidoEnvio;
  validacao: ResultadoValidacao;
  webhook: ContratoWebhook;
  gate: GateAberto;
}

/**
 * EMITIR (criacao de pedido, sem debito). Nao e chamada em desenvolvimento:
 * `abrirGateEmissao` exige liberacao operacional humana, indisponivel aqui.
 */
export async function criarPedido(e: EntradaCriacao, opts: OpcoesAdapter = {}): Promise<ResultadoCriacao> {
  if (!ehGateAberto(e.gate)) throw new EmissaoBloqueada('gate_ausente_ou_forjado');
  if (e.gate.endpoint_id !== ENDPOINT_EMISSAO) throw new EmissaoBloqueada('gate_para_outro_endpoint');
  if (e.validacao.veredito !== Veredito.READY) {
    throw new EmissaoBloqueada(`validacao_nao_ready:${e.validacao.veredito}`);
  }
  if (!e.validacao.chave_idempotencia) throw new EmissaoBloqueada('sem_chave_de_idempotencia');
  if (e.envio.servico.preco_cotado > e.gate.teto_brl) throw new EmissaoBloqueada('preco_acima_do_teto_autorizado');

  const ler = opts.ler ?? leitorAmbiente;
  conferirSeparacaoDeCredenciais(ler);

  const desc = endpoint(ENDPOINT_EMISSAO);
  if (desc.efeito === Efeito.FINANCEIRO) throw new EmissaoBloqueada('endpoint_financeiro_nesta_fase');

  // Base do Whitelabel vem de configuracao. Nao ha URL de producao adivinhada
  // aqui: a Frenet entrega base e tokens de producao na homologacao.
  const base = exigirSegredo(NOME_BASE_WHITELABEL, ler).replace(/\/+$/, '');
  const buscar = opts.buscar ?? ((u, i) => fetch(u, i));

  const res = await buscar(`${base}${desc.caminho}`, {
    method: desc.metodo,
    headers: {
      'Content-Type': 'application/json',
      token: exigirSegredo(NOME_TOKEN_CLIENTE, ler),
      partnerToken: exigirSegredo(NOME_TOKEN_PARCEIRO, ler),
      'Idempotency-Key': e.validacao.chave_idempotencia,
    },
    body: JSON.stringify(montarPayloadCriacao(e.envio, e.webhook)),
  });

  const bruto = await res.json().catch(() => null) as Record<string, unknown> | null;
  return {
    http_status: res.status,
    frenet_order_id: bruto?.OrderId != null ? String(bruto.OrderId) : null,
    frenet_shipment_id: bruto?.ShipmentId != null ? String(bruto.ShipmentId) : null,
    tracking_number: bruto?.TrackingNumber != null ? String(bruto.TrackingNumber) : null,
    custo_real: Number.isFinite(Number(bruto?.ShippingPrice)) ? Number(bruto?.ShippingPrice) : null,
    servico_real: bruto?.ServiceCode != null ? String(bruto.ServiceCode) : null,
    bruto,
  };
}
