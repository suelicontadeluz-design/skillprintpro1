// Gate de emissao. EMITIR e operacao financeira e nasce fechada.
//
// O gate nao e um booleano solto: e uma capability. Nenhuma funcao de emissao
// aceita ser chamada sem um objeto GateAberto, e GateAberto so pode ser
// produzido aqui, com autorizacao nomeada e registrada.

import { Efeito } from './tipos.ts';
import { endpoint, ENDPOINT_PROIBIDO_NESTA_FASE } from './endpoints.ts';

const MARCA: unique symbol = Symbol('gate_emissao_frenet');

export interface GateAberto {
  readonly [MARCA]: true;
  readonly endpoint_id: string;
  readonly autorizado_por: string;
  readonly motivo: string;
  readonly aberto_em: string;
  readonly teto_brl: number;
}

export interface PedidoDeAbertura {
  endpoint_id: string;
  /** Nome do humano que autorizou. Agente/LLM nunca preenche isto sozinho. */
  autorizado_por: string;
  motivo: string;
  /** Teto de gasto desta abertura, em BRL. */
  teto_brl: number;
  /**
   * Flag operacional externa. Em toda sessao de desenvolvimento vale false.
   * So vira true por acao humana deliberada no ambiente de execucao.
   */
  liberacao_operacional: boolean;
  agora?: () => string;
}

export class EmissaoBloqueada extends Error {
  constructor(motivo: string) {
    super(`emissao_bloqueada:${motivo}`);
    this.name = 'EmissaoBloqueada';
  }
}

export function abrirGateEmissao(p: PedidoDeAbertura): GateAberto {
  if (p.endpoint_id === ENDPOINT_PROIBIDO_NESTA_FASE) {
    throw new EmissaoBloqueada('oneclick_paga_e_imprime_em_uma_requisicao_proibido_nesta_fase');
  }
  const desc = endpoint(p.endpoint_id);
  if (desc.efeito === Efeito.FINANCEIRO) {
    throw new EmissaoBloqueada(`endpoint_financeiro_sem_gate_de_dinheiro:${p.endpoint_id}`);
  }
  if (!p.liberacao_operacional) throw new EmissaoBloqueada('sem_liberacao_operacional');
  if (!p.autorizado_por?.trim()) throw new EmissaoBloqueada('sem_autor_humano');
  if (!(p.teto_brl > 0)) throw new EmissaoBloqueada('teto_invalido');

  return Object.freeze({
    [MARCA]: true as const,
    endpoint_id: p.endpoint_id,
    autorizado_por: p.autorizado_por,
    motivo: p.motivo,
    aberto_em: p.agora ? p.agora() : new Date().toISOString(),
    teto_brl: p.teto_brl,
  });
}

export function ehGateAberto(x: unknown): x is GateAberto {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[MARCA] === true;
}
