// Idempotencia de emissao de etiqueta.
//
// Invariante: retry NUNCA pode comprar segunda etiqueta, criar segundo
// shipment, trocar servico em silencio nem trocar custo em silencio.
//
// Desenho: a chave e deterministica sobre o que define economicamente o
// envio. Se qualquer parte mudar, a chave muda e isso e um envio DIFERENTE,
// que precisa de decisao explicita — nunca de um retry silencioso.

import type { PedidoEnvio, Pacote } from './tipos.ts';

/** Estados de uma tentativa. Persistidos antes e depois do efeito externo. */
export const EstadoTentativa = {
  /** Persistida antes de tocar a Frenet. Se o processo morrer aqui, sabemos que pode ter saido. */
  EM_VOO: 'EM_VOO',
  /** Resposta da Frenet recebida e interpretada com sucesso. */
  CONCLUIDA: 'CONCLUIDA',
  /** A Frenet respondeu erro definitivo. Seguro tentar de novo apos corrigir. */
  FALHA_DEFINITIVA: 'FALHA_DEFINITIVA',
  /** Timeout / rede / 5xx: pode ou nao ter criado pedido la. NUNCA retry automatico. */
  INDETERMINADA: 'INDETERMINADA',
} as const;
export type EstadoTentativa = typeof EstadoTentativa[keyof typeof EstadoTentativa];

export interface Tentativa {
  chave_idempotencia: string;
  envio_id: string;
  estado: EstadoTentativa;
  endpoint_id: string;
  /** Hash do payload efetivamente enviado. Detecta troca silenciosa. */
  payload_hash: string;
  /** Preenchidos so depois do efeito externo. */
  frenet_order_id?: string | null;
  frenet_shipment_id?: string | null;
  tracking_number?: string | null;
  custo_real?: number | null;
  servico_real?: string | null;
  http_status?: number | null;
  erro?: string | null;
  criado_em: string;
  atualizado_em: string;
}

function normalizarDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

function pacoteCanonico(p: Pacote): string {
  // Arredonda para evitar que ruido de ponto flutuante gere chave nova.
  const n = (x: number) => x.toFixed(3);
  return [n(p.comprimento_cm), n(p.largura_cm), n(p.altura_cm), n(p.peso_kg)].join('x');
}

/**
 * Tupla canonica. Ordem fixa, sem depender de ordem de chave de objeto.
 * Inclui servico e valor declarado de proposito: trocar servico ou valor
 * segurado e outro envio, nao um retry.
 */
export function tuplaCanonica(envio: PedidoEnvio): string {
  const d = envio.destinatario;
  const pacotes = envio.pacotes.map(pacoteCanonico).sort().join('|');
  return [
    'v1',
    envio.pedido_fonte,
    envio.pedido_id,
    normalizarDigitos(d.documento),
    normalizarDigitos(d.endereco.cep),
    d.endereco.numero.trim().toLowerCase(),
    (d.endereco.complemento ?? '').trim().toLowerCase(),
    envio.servico.codigo,
    envio.valor_declarado.toFixed(2),
    pacotes,
  ].join('~');
}

/** SHA-256 hex. Usa WebCrypto (disponivel em Deno, Node 18+ e edge runtimes). */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function chaveIdempotencia(envio: PedidoEnvio): Promise<string> {
  return `frenet-etq-${await sha256Hex(tuplaCanonica(envio))}`;
}

export interface DecisaoIdempotencia {
  pode_prosseguir: boolean;
  motivo: string;
  /** Quando ja existe resultado, devolvemos o de antes em vez de repetir o efeito. */
  reaproveitar?: Tentativa;
  exige_humano: boolean;
}

/**
 * Decide o que fazer diante das tentativas ja registradas para a mesma chave.
 * Fail-closed: qualquer duvida sobre o que aconteceu la fora exige humano.
 */
export function decidirRetry(
  tentativas: readonly Tentativa[],
  payloadHashAtual: string,
): DecisaoIdempotencia {
  if (tentativas.length === 0) {
    return { pode_prosseguir: true, motivo: 'primeira_tentativa', exige_humano: false };
  }

  const concluida = tentativas.find((t) => t.estado === EstadoTentativa.CONCLUIDA);
  if (concluida) {
    return {
      pode_prosseguir: false,
      motivo: 'etiqueta_ja_emitida_para_esta_chave',
      reaproveitar: concluida,
      exige_humano: false,
    };
  }

  const emVoo = tentativas.find((t) => t.estado === EstadoTentativa.EM_VOO);
  if (emVoo) {
    return {
      pode_prosseguir: false,
      motivo: 'tentativa_em_voo_resultado_desconhecido',
      exige_humano: true,
    };
  }

  const indeterminada = tentativas.find((t) => t.estado === EstadoTentativa.INDETERMINADA);
  if (indeterminada) {
    return {
      pode_prosseguir: false,
      motivo: 'tentativa_anterior_indeterminada_reconciliar_na_frenet_antes',
      exige_humano: true,
    };
  }

  // So restam falhas definitivas. Repetir e seguro apenas se o payload for o mesmo:
  // payload diferente sob a mesma chave significa que algo fora da tupla mudou
  // (peso aferido, item, remetente) — isso e troca silenciosa e nao pode passar.
  const divergente = tentativas.find(
    (t) => t.estado === EstadoTentativa.FALHA_DEFINITIVA && t.payload_hash !== payloadHashAtual,
  );
  if (divergente) {
    return {
      pode_prosseguir: false,
      motivo: 'payload_divergente_sob_mesma_chave',
      exige_humano: true,
    };
  }

  return { pode_prosseguir: true, motivo: 'retry_apos_falha_definitiva', exige_humano: false };
}
