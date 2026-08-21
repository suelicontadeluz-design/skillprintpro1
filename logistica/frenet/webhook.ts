// Contrato do webhook de tracking, para ser enviado na criacao do pedido.
//
// Fatos que este arquivo assume, vindos da operacao (nao verificaveis deste
// ambiente, cujo egress bloqueia frenet.com.br):
//   - a URL de callback e os campos TOKEN_NAME/TOKEN_VALUE sao informados a
//     Frenet no momento da criacao do pedido/etiqueta via API;
//   - a Frenet devolve TOKEN_NAME como header e TOKEN_VALUE como valor em
//     cada chamada de webhook;
//   - o payload de tracking traz OrderId, ShipmentId, TrackingNumber,
//     TrackingUrl e TrackingEvents.
//
// Por isso o contrato e montado a partir de configuracao, e a construcao
// falha fechada quando qualquer peca esta ausente. Nenhum segredo fake e
// gerado aqui: se FRENET_WEBHOOK_TOKEN_VALUE nao existir, isto lanca.

import {
  NOME_WEBHOOK_TOKEN_NAME,
  NOME_WEBHOOK_TOKEN_VALUE,
  conferirSeparacaoDeCredenciais,
  exigirSegredo,
  type LeitorSegredo,
  leitorAmbiente,
} from './segredos.ts';

export interface ContratoWebhook {
  /** URL publica do receptor. Vai no corpo da criacao do pedido. */
  url: string;
  /** Nome do header que a Frenet devolvera. */
  token_name: string;
  /** Valor do header. NUNCA logar, NUNCA devolver em resposta. */
  token_value: string;
}

export interface RequisitosReceptor {
  url: string;
  /** O receptor verifica TOKEN_NAME/TOKEN_VALUE antes de qualquer efeito? */
  autentica_token: boolean;
  /** O receptor e idempotente por (OrderId, ShipmentId, TrackingNumber, EventType, data)? */
  dedup_operante: boolean;
  /** O receptor dispara mensagem ao cliente? Nesta fase deve ser false. */
  dispara_mensagem_externa: boolean;
  /** Persiste evento bruto antes de qualquer interpretacao? */
  persiste_evento_bruto: boolean;
}

export class ReceptorInapto extends Error {
  readonly faltas: string[];
  constructor(faltas: string[]) {
    super(`receptor_de_webhook_inapto:${faltas.join(',')}`);
    this.name = 'ReceptorInapto';
    this.faltas = faltas;
  }
}

/**
 * Auditoria do receptor. So um receptor aprovado pode ter sua URL enviada a
 * Frenet — informar um receptor inapto na criacao do pedido e o que
 * transformaria a primeira etiqueta real em WhatsApp indevido ao cliente.
 */
export function auditarReceptor(r: RequisitosReceptor): void {
  const faltas: string[] = [];
  if (!/^https:\/\//.test(r.url ?? '')) faltas.push('url_nao_https');
  if (!r.autentica_token) faltas.push('sem_autenticacao_de_token');
  if (!r.dedup_operante) faltas.push('dedup_inoperante');
  if (r.dispara_mensagem_externa) faltas.push('dispara_mensagem_externa_nesta_fase');
  if (!r.persiste_evento_bruto) faltas.push('nao_persiste_evento_bruto');
  if (faltas.length) throw new ReceptorInapto(faltas);
}

export function montarContratoWebhook(
  receptor: RequisitosReceptor,
  ler: LeitorSegredo = leitorAmbiente,
): ContratoWebhook {
  auditarReceptor(receptor);
  conferirSeparacaoDeCredenciais(ler);
  return {
    url: receptor.url,
    token_name: exigirSegredo(NOME_WEBHOOK_TOKEN_NAME, ler),
    token_value: exigirSegredo(NOME_WEBHOOK_TOKEN_VALUE, ler),
  };
}

/** Representacao segura para log/relatorio: prova o contrato sem expor valor. */
export function descreverContrato(c: ContratoWebhook): Record<string, unknown> {
  return { url: c.url, token_name: c.token_name, token_value: '[REDIGIDO]', token_value_len: c.token_value.length };
}

/** Payload de tracking que o receptor deve aceitar. Campos documentados pela Frenet. */
export interface EventoTrackingFrenet {
  OrderId?: string;
  ShipmentId?: number;
  TrackingNumber?: string;
  TrackingUrl?: string;
  TrackingEvents?: Array<{
    EventType?: number | string;
    EventDescription?: string;
    EventDate?: string;
    EventLocation?: string;
  }>;
}

/**
 * Chave de deduplicacao do evento. Distinta da chave de idempotencia de
 * emissao: aqui o objetivo e nao reprocessar o mesmo fato logistico.
 */
export function chaveEventoTracking(e: EventoTrackingFrenet, indice: number): string {
  const ev = e.TrackingEvents?.[indice];
  return [
    'trk',
    e.OrderId ?? '',
    String(e.ShipmentId ?? ''),
    e.TrackingNumber ?? '',
    String(ev?.EventType ?? ''),
    ev?.EventDate ?? '',
  ].join('~');
}
