// ─── Decodificador PNG → raster RGBA ───────────────────────────────────────
//
// Necessário para o renderizador: para compor a folha, é preciso ler os pixels
// reais do mestre. Zero dependências — apenas `node:zlib`.
//
// SUPORTE: profundidade 8 bits, sem entrelaçamento, colorType 0 (cinza),
// 2 (RGB), 4 (cinza+alfa) e 6 (RGBA). Paleta (3) e 16 bits NÃO são suportados
// e falham explicitamente — preferimos recusar a adivinhar.
//
// A saída é sempre RGBA de 4 bytes por pixel. Para colorType sem alfa, o canal
// é preenchido com 255; isso é expansão de formato, não alteração de conteúdo.

import { inflateSync } from 'node:zlib'
import { lerMetadadosPng } from './metadados-png.ts'

export interface RasterRgba {
  largura_px: number
  altura_px: number
  /** largura*altura*4 bytes, ordem R,G,B,A. */
  dados: Uint8Array
  dpi_x: number | null
  dpi_y: number | null
  tem_alpha: boolean
  tipo_cor: number
}

export interface LeituraRaster {
  ok: boolean
  erro: string | null
  raster: RasterRgba | null
}

const CANAIS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

function u32(d: Uint8Array, off: number): number {
  return ((d[off] << 24) | (d[off + 1] << 16) | (d[off + 2] << 8) | d[off + 3]) >>> 0
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodificarPngRgba(bytes: Uint8Array): LeituraRaster {
  const falha = (erro: string): LeituraRaster => ({ ok: false, erro, raster: null })

  // Reaproveita o extrator: ele já valida assinatura, ordem e CRC-32.
  const meta = lerMetadadosPng(bytes)
  if (!meta.ok || !meta.metadados) return falha(meta.erro ?? 'PNG inválido')
  const m = meta.metadados

  if (m.profundidade_bits !== 8) return falha(`profundidade ${m.profundidade_bits} não suportada (só 8)`)
  const canais = CANAIS[m.tipo_cor]
  if (canais === undefined) return falha(`colorType ${m.tipo_cor} não suportado`)

  // Concatena todos os IDAT.
  const pedacos: Uint8Array[] = []
  let off = 8
  let entrelacado = 0
  while (off + 8 <= bytes.length) {
    const tamanho = u32(bytes, off)
    const tipo = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    const dadosInicio = off + 8
    if (tipo === 'IHDR') entrelacado = bytes[dadosInicio + 12]
    if (tipo === 'IDAT') pedacos.push(bytes.subarray(dadosInicio, dadosInicio + tamanho))
    if (tipo === 'IEND') break
    off = dadosInicio + tamanho + 4
  }
  if (entrelacado !== 0) return falha('PNG entrelaçado (Adam7) não suportado')
  if (pedacos.length === 0) return falha('nenhum IDAT encontrado')

  let cru: Uint8Array
  try {
    const juntos = new Uint8Array(pedacos.reduce((s, p) => s + p.length, 0))
    let o = 0
    for (const p of pedacos) { juntos.set(p, o); o += p.length }
    cru = new Uint8Array(inflateSync(juntos))
  } catch (e) {
    return falha(`falha ao inflar IDAT: ${e instanceof Error ? e.message : String(e)}`)
  }

  const w = m.largura_px
  const h = m.altura_px
  const bpp = canais
  const bytesLinha = w * canais
  if (cru.length !== (bytesLinha + 1) * h) {
    return falha(`dados descomprimidos com ${cru.length} bytes; esperado ${(bytesLinha + 1) * h}`)
  }

  // Desfiltragem in-place, linha a linha.
  const plano = new Uint8Array(bytesLinha * h)
  for (let y = 0; y < h; y++) {
    const filtro = cru[y * (bytesLinha + 1)]
    const origem = y * (bytesLinha + 1) + 1
    const destino = y * bytesLinha
    const anterior = destino - bytesLinha

    for (let i = 0; i < bytesLinha; i++) {
      const x = cru[origem + i]
      const a = i >= bpp ? plano[destino + i - bpp] : 0
      const b = y > 0 ? plano[anterior + i] : 0
      const c = (i >= bpp && y > 0) ? plano[anterior + i - bpp] : 0
      let v: number
      switch (filtro) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: v = x + paeth(a, b, c); break
        default: return falha(`filtro ${filtro} inválido na linha ${y}`)
      }
      plano[destino + i] = v & 0xff
    }
  }

  // Expansão para RGBA.
  const rgba = new Uint8Array(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const s = p * canais
    const d = p * 4
    if (m.tipo_cor === 6) {
      rgba[d] = plano[s]; rgba[d + 1] = plano[s + 1]; rgba[d + 2] = plano[s + 2]; rgba[d + 3] = plano[s + 3]
    } else if (m.tipo_cor === 2) {
      rgba[d] = plano[s]; rgba[d + 1] = plano[s + 1]; rgba[d + 2] = plano[s + 2]; rgba[d + 3] = 255
    } else if (m.tipo_cor === 4) {
      rgba[d] = plano[s]; rgba[d + 1] = plano[s]; rgba[d + 2] = plano[s]; rgba[d + 3] = plano[s + 1]
    } else {
      rgba[d] = plano[s]; rgba[d + 1] = plano[s]; rgba[d + 2] = plano[s]; rgba[d + 3] = 255
    }
  }

  return {
    ok: true,
    erro: null,
    raster: {
      largura_px: w,
      altura_px: h,
      dados: rgba,
      dpi_x: m.dpi_x,
      dpi_y: m.dpi_y,
      tem_alpha: m.tipo_cor === 4 || m.tipo_cor === 6,
      tipo_cor: m.tipo_cor,
    },
  }
}
