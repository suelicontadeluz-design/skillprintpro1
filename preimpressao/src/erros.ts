// ─── Erros explícitos da pré-impressão ─────────────────────────────────────
// Regra do patch: o motor NUNCA "conserta" silenciosamente. Toda condição que
// impediria uma montagem fisicamente correta vira exceção tipada com código
// estável, para que o chamador não consiga confundir falha com sucesso.

export type CodigoErro =
  // Entrada / medidas
  | 'MEDIDA_AUSENTE'
  | 'MEDIDA_NAO_FINITA'
  | 'MEDIDA_NAO_POSITIVA'
  | 'QUANTIDADE_INVALIDA'
  | 'SHA256_INVALIDO'
  | 'IDENTIDADE_AUSENTE'
  // Mídia / layout
  | 'MIDIA_LARGURA_INVALIDA'
  | 'MIDIA_DPI_INVALIDO'
  | 'MIDIA_COMPRIMENTO_INVALIDO'
  | 'LAYOUT_MARGEM_INVALIDA'
  | 'LAYOUT_ESPACAMENTO_INVALIDO'
  | 'MARGEM_MAIOR_QUE_MIDIA'
  // Montagem
  | 'ARTE_NAO_CABE_NA_LARGURA'
  | 'ARTE_NAO_CABE_NO_COMPRIMENTO'

export class ErroPreImpressao extends Error {
  readonly codigo: CodigoErro
  readonly detalhe: Record<string, unknown>

  constructor(codigo: CodigoErro, mensagem: string, detalhe: Record<string, unknown> = {}) {
    super(`[${codigo}] ${mensagem}`)
    this.name = 'ErroPreImpressao'
    this.codigo = codigo
    this.detalhe = detalhe
  }
}

export function falhar(
  codigo: CodigoErro,
  mensagem: string,
  detalhe: Record<string, unknown> = {},
): never {
  throw new ErroPreImpressao(codigo, mensagem, detalhe)
}
