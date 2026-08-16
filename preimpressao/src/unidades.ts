// ─── Conversão cm ↔ px ↔ µm e tolerâncias DOCUMENTADAS ─────────────────────
//
// POR QUE MICRÔMETROS
// O motor não faz aritmética de empacotamento em ponto flutuante. Toda medida
// de entrada é convertida uma única vez para micrômetros inteiros (µm) e todo
// o empacotamento (posições, somas, comparações, sobreposição, espaçamento) é
// aritmética inteira. Isso elimina qualquer acúmulo de erro e torna o
// determinismo bit-a-bit uma propriedade estrutural, não uma esperança.
//
// 1 cm = 10.000 µm  →  resolução de 0,0001 cm = 1 µm.
// A 300 DPI, 1 px = 84,67 µm. A grade em µm é ~85× mais fina que o pixel,
// portanto nenhuma decisão geométrica é perdida no arredondamento.
//
// TOLERÂNCIAS (todas explícitas, nenhuma implícita)
//
// TOL_PX = 1 px
//   cm→px exige arredondamento. Um único arredondamento erra no máximo 0,5 px.
//   Comparar dois valores arredondados de forma independente pode acumular até
//   1 px. Portanto 1 px é a menor tolerância honesta para comparar dimensão de
//   arquivo contra dimensão calculada. Nada além disso é aceito.
//
// TOL_UM = 100 µm = 0,01 cm = 0,1 mm
//   Tolerância geométrica. 0,1 mm está abaixo do registro mecânico de qualquer
//   impressora DTF e abaixo da precisão de corte do filme.
//
// TOL_PROPORCAO = 1e-6 (relativo)
//   Proporção largura/altura. Como a escala é fixa em 1.0 e a rotação é apenas
//   0°/90°, a proporção deveria ser idêntica; a folga existe só para absorver o
//   erro de representação da divisão em ponto flutuante.
//
// EXEMPLO DE REFERÊNCIA (DTF Têxtil, 300 DPI)
//   57 cm  → 57/2,54*300      = 6732,283464566929 px → arredonda para 6732 px
//   6732 px → 6732*2,54/300   = 56,9976 cm
//   desvio                     = 0,0024 cm = 24 µm  (dentro de TOL_UM = 100 µm)
//  100 cm  → 11811,023622047243 px → 11811 px → 99,9998 cm (desvio 2 µm)
//
// O desvio existe e é declarado. Ele NÃO é escondido e NÃO é "corrigido"
// esticando a arte.

export const CM_POR_POLEGADA = 2.54
export const UM_POR_CM = 10_000

export const TOL_PX = 1
export const TOL_UM = 100
export const TOL_PROPORCAO = 1e-6

function exigirFinito(valor: number, rotulo: string): void {
  if (!Number.isFinite(valor)) {
    throw new RangeError(`${rotulo} precisa ser um número finito. Recebido: ${String(valor)}`)
  }
}

/** cm → µm inteiro. Única fronteira entre ponto flutuante e o núcleo inteiro. */
export function cmParaUm(cm: number): number {
  exigirFinito(cm, 'cm')
  return Math.round(cm * UM_POR_CM)
}

/** µm inteiro → cm. Usado só para apresentação/relatório. */
export function umParaCm(um: number): number {
  exigirFinito(um, 'um')
  return um / UM_POR_CM
}

/** cm → px em valor real, sem arredondar. Serve para expor o desvio. */
export function cmParaPxExato(cm: number, dpi: number): number {
  exigirFinito(cm, 'cm')
  exigirFinito(dpi, 'dpi')
  return (cm / CM_POR_POLEGADA) * dpi
}

/** cm → px inteiro (arredondamento para o inteiro mais próximo). */
export function cmParaPx(cm: number, dpi: number): number {
  return Math.round(cmParaPxExato(cm, dpi))
}

/** px → cm. */
export function pxParaCm(px: number, dpi: number): number {
  exigirFinito(px, 'px')
  exigirFinito(dpi, 'dpi')
  if (dpi <= 0) throw new RangeError(`dpi precisa ser positivo. Recebido: ${dpi}`)
  return (px * CM_POR_POLEGADA) / dpi
}

/** µm → px inteiro. */
export function umParaPx(um: number, dpi: number): number {
  return cmParaPx(umParaCm(um), dpi)
}

/** Desvio, em µm, entre uma medida em cm e sua ida-e-volta por pixels. */
export function desvioArredondamentoUm(cm: number, dpi: number): number {
  const ida = cmParaPx(cm, dpi)
  const volta = pxParaCm(ida, dpi)
  return Math.abs(cmParaUm(cm) - cmParaUm(volta))
}
