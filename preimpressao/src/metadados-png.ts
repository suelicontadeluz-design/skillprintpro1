// ─── Extrator de metadados PNG ─────────────────────────────────────────────
//
// Lê do ARQUIVO os fatos que o pré-flight precisa provar, sem confiar em
// nenhuma declaração externa:
//   • largura e altura em pixels (IHDR)
//   • DPI real (chunk pHYs, quando a unidade é metro)
//   • presença de canal alfa (colorType 4/6, ou chunk tRNS)
//   • integridade estrutural (assinatura, ordem dos chunks, CRC-32 de cada chunk)
//
// Não decodifica pixels: as 16 checagens são metadados + geometria + hash.
// Zero dependências externas.

export interface MetadadosPng {
  largura_px: number
  altura_px: number
  profundidade_bits: number
  tipo_cor: number
  /** DPI horizontal/vertical derivado de pHYs; null quando o chunk não existe. */
  dpi_x: number | null
  dpi_y: number | null
  tem_alpha: boolean
  tem_phys: boolean
  chunks: string[]
}

export interface LeituraPng {
  ok: boolean
  erro: string | null
  metadados: MetadadosPng | null
}

const ASSINATURA = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// ── CRC-32 (polinômio PNG/zlib 0xEDB88320) ────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(dados: Uint8Array, inicio: number, fim: number): number {
  let c = 0xffffffff
  for (let i = inicio; i < fim; i++) {
    c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function u32(d: Uint8Array, off: number): number {
  return ((d[off] << 24) | (d[off + 1] << 16) | (d[off + 2] << 8) | d[off + 3]) >>> 0
}

/** Metros → polegadas: 1 px/m × 0,0254 m/pol = DPI. */
function pixelsPorMetroParaDpi(ppm: number): number {
  return ppm * 0.0254
}

export function lerMetadadosPng(bytes: Uint8Array): LeituraPng {
  const falha = (erro: string): LeituraPng => ({ ok: false, erro, metadados: null })

  if (!(bytes instanceof Uint8Array)) return falha('entrada não é Uint8Array')
  if (bytes.length < ASSINATURA.length + 12) return falha('arquivo curto demais para ser PNG')

  for (let i = 0; i < ASSINATURA.length; i++) {
    if (bytes[i] !== ASSINATURA[i]) return falha('assinatura PNG inválida')
  }

  let off = ASSINATURA.length
  let largura = 0
  let altura = 0
  let profundidade = 0
  let tipoCor = -1
  let dpiX: number | null = null
  let dpiY: number | null = null
  let temPhys = false
  let temTrns = false
  let viuIhdr = false
  let viuIend = false
  const chunks: string[] = []

  while (off < bytes.length) {
    if (off + 8 > bytes.length) return falha('cabeçalho de chunk truncado')
    const tamanho = u32(bytes, off)
    if (tamanho > 0x7fffffff) return falha('tamanho de chunk inválido')

    const tipoInicio = off + 4
    const dadosInicio = off + 8
    const dadosFim = dadosInicio + tamanho
    const crcFim = dadosFim + 4
    if (crcFim > bytes.length) return falha('chunk truncado')

    const tipo = String.fromCharCode(
      bytes[tipoInicio], bytes[tipoInicio + 1], bytes[tipoInicio + 2], bytes[tipoInicio + 3],
    )

    // CRC cobre tipo + dados (não cobre o campo de tamanho).
    const crcEsperado = u32(bytes, dadosFim)
    const crcReal = crc32(bytes, tipoInicio, dadosFim)
    if (crcEsperado !== crcReal) {
      return falha(`CRC inválido no chunk ${tipo}`)
    }

    chunks.push(tipo)

    if (tipo === 'IHDR') {
      if (viuIhdr) return falha('IHDR duplicado')
      if (chunks.length !== 1) return falha('IHDR não é o primeiro chunk')
      if (tamanho !== 13) return falha('IHDR com tamanho inválido')
      viuIhdr = true
      largura = u32(bytes, dadosInicio)
      altura = u32(bytes, dadosInicio + 4)
      profundidade = bytes[dadosInicio + 8]
      tipoCor = bytes[dadosInicio + 9]
      if (largura === 0 || altura === 0) return falha('dimensão zero no IHDR')
    } else if (!viuIhdr) {
      return falha(`chunk ${tipo} antes do IHDR`)
    } else if (tipo === 'pHYs') {
      if (tamanho !== 9) return falha('pHYs com tamanho inválido')
      const ppuX = u32(bytes, dadosInicio)
      const ppuY = u32(bytes, dadosInicio + 4)
      const unidade = bytes[dadosInicio + 8]
      temPhys = true
      if (unidade === 1) {
        dpiX = pixelsPorMetroParaDpi(ppuX)
        dpiY = pixelsPorMetroParaDpi(ppuY)
      }
    } else if (tipo === 'tRNS') {
      temTrns = true
    } else if (tipo === 'IEND') {
      viuIend = true
      off = crcFim
      break
    }

    off = crcFim
  }

  if (!viuIhdr) return falha('IHDR ausente')
  if (!viuIend) return falha('IEND ausente')

  // colorType 4 = cinza+alfa, 6 = RGBA. tRNS dá transparência em paleta/cor-chave.
  const temAlpha = tipoCor === 4 || tipoCor === 6 || temTrns

  return {
    ok: true,
    erro: null,
    metadados: {
      largura_px: largura,
      altura_px: altura,
      profundidade_bits: profundidade,
      tipo_cor: tipoCor,
      dpi_x: dpiX,
      dpi_y: dpiY,
      tem_alpha: temAlpha,
      tem_phys: temPhys,
      chunks,
    },
  }
}
