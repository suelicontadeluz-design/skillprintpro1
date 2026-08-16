// ─── Contratos da pré-impressão ────────────────────────────────────────────
// Só tipos. Nenhum valor em runtime, nenhuma dependência.

// ── Entrada do motor ──────────────────────────────────────────────────────

/**
 * Especificação física da mídia.
 *
 * `largura_util_cm` é SEMPRE parâmetro de entrada. No ERP ela virá de
 * `maquinas.largura_impressao_cm` (Impressora DTF Têxtil I3200 = 57;
 * DTF UV I1600 = 28,9). O motor não conhece esses números e não tem default:
 * nenhuma largura está codificada em lugar nenhum deste pacote.
 */
export interface EspecMidia {
  largura_util_cm: number
  dpi: number
  /** Comprimento máximo por página/faixa. `null` = sem limite (página única). */
  comprimento_max_cm: number | null
}

export interface EspecLayout {
  /** Margem externa aplicada nos quatro lados. */
  margem_cm: number
  /** Espaçamento mínimo entre quaisquer duas artes. */
  espacamento_cm: number
}

export interface PecaEntrada {
  arte_mestre_id: string
  versao: number
  /** SHA-256 hex (64 chars) do arquivo da arte mestre aprovada. */
  sha256: string
  /** Medida física real. Nula/ausente = rejeição. Nunca presumida. */
  largura_cm: number | null | undefined
  altura_cm: number | null | undefined
  quantidade: number
  /** Rotação 90° só é considerada quando isto é explicitamente true. */
  rotacao_permitida: boolean
}

export interface EntradaMontagem {
  midia: EspecMidia
  layout: EspecLayout
  pecas: PecaEntrada[]
}

// ── Saída do motor ────────────────────────────────────────────────────────

export interface PecaNormalizada {
  arte_mestre_id: string
  versao: number
  sha256: string
  largura_um: number
  altura_um: number
  quantidade: number
  rotacao_permitida: boolean
}

export interface ItemGangSheet {
  /** Ordem global determinística de colocação, 1-based. */
  sequencia: number
  arte_mestre_id: string
  versao: number
  sha256: string
  /** Índice da cópia dentro da peça, 1-based. */
  indice_copia: number
  x_um: number
  y_um: number
  largura_final_um: number
  altura_final_um: number
  rotacao_graus: 0 | 90
  /** Sempre exatamente 1. O motor não redimensiona. */
  escala: 1
  /** Faixa (shelf) global, 1-based. */
  faixa: number
  pagina: number
}

export interface PaginaGangSheet {
  pagina: number
  comprimento_utilizado_um: number
  area_util_pct: number
  itens_count: number
}

export interface ResultadoMontagem {
  entrada_normalizada: {
    midia: { largura_util_um: number; dpi: number; comprimento_max_um: number | null }
    layout: { margem_um: number; espacamento_um: number }
    pecas: PecaNormalizada[]
  }
  itens: ItemGangSheet[]
  paginas: PaginaGangSheet[]
  comprimento_total_utilizado_um: number
  area_util_pct: number
  /** SHA-256 canônico da entrada normalizada. */
  parametros_hash: string
  /** SHA-256 canônico de (parametros_hash + colocações + páginas). */
  resultado_hash: string
}

// ── Pré-flight ────────────────────────────────────────────────────────────

export interface MestreRegistrado {
  arte_mestre_id: string
  versao: number
  /** SHA-256 que ficou registrado no momento da aprovação. */
  sha256_registrado: string
  /** Bytes do arquivo mestre lidos AGORA, no momento da validação. */
  bytes: Uint8Array
  largura_cm: number
  altura_cm: number
  rotacao_permitida: boolean
  quantidade_solicitada: number
}

/**
 * O plano é tratado como ALEGAÇÃO, não como verdade. O pré-flight recebe isto
 * de fora e reconfere tudo contra o arquivo e contra os mestres registrados.
 */
export interface PlanoAlegado {
  itens: ItemGangSheet[]
  paginas: PaginaGangSheet[]
  area_util_pct: number
}

export interface EntradaPreflight {
  arquivo_producao: Uint8Array
  midia: EspecMidia
  layout: EspecLayout
  plano: PlanoAlegado
  mestres: MestreRegistrado[]
  /** Página que o arquivo de produção representa. Padrão 1. */
  pagina_referencia?: number
}

export type CodigoChecagem =
  | 'C01_INTEGRIDADE_ARQUIVO'
  | 'C02_DIMENSAO_PX'
  | 'C03_DPI'
  | 'C04_DIMENSAO_FISICA'
  | 'C05_TRANSPARENCIA'
  | 'C06_QUANTIDADE'
  | 'C07_ESCALA'
  | 'C08_PROPORCAO'
  | 'C09_ESPACAMENTO'
  | 'C10_MARGEM'
  | 'C11_CLIPPING'
  | 'C12_SOBREPOSICAO'
  | 'C13_ROTACAO'
  | 'C14_COMPRIMENTO'
  | 'C15_AREA_UTIL'
  | 'C16_FIDELIDADE_SHA256'
  | 'C17_FIDELIDADE_PIXEL'

/**
 * Motivos estáveis de reprovação da C17. São contrato: podem ser persistidos e
 * comparados. Nunca renomear sem versionar.
 */
export type MotivoC17 =
  | 'ARTEFATO_ILEGIVEL'
  | 'MESTRE_NAO_REGISTRADO'
  | 'MESTRE_ILEGIVEL'
  | 'MESTRE_SHA_DIVERGENTE'
  | 'ROTACAO_INVALIDA'
  | 'DIMENSAO_INCOMPATIVEL'
  | 'REGIAO_FORA_DO_ARTEFATO'
  | 'PIXEL_DIVERGENTE'

export interface Checagem {
  codigo: CodigoChecagem
  descricao: string
  ok: boolean
  detalhe: Record<string, unknown>
}

export interface ResultadoPreflight {
  aprovado: boolean
  checagens: Checagem[]
  motivos: string[]
}
