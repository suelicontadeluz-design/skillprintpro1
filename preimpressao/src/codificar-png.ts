// ─── Codificador PNG (RGBA 8 bits, com pHYs) ───────────────────────────────
//
// Escreve o arquivo de produção. Sempre RGBA (canal alfa presente por
// construção) e sempre com pHYs, para que o DPI fique gravado no arquivo e
// possa ser conferido de forma independente pelo pré-flight.
//
// DETERMINISMO: nível de compressão fixo e nenhuma variação por execução.
// Ainda assim, a prova forte de determinismo do renderizador é o SHA-256 do
// RASTER (buffer RGBA cru), que não depende da versão do zlib.

import { deflateSync } from 'node:zlib'
import { crc32 } from './metadados-png.ts'

const ASSINATURA = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function be32(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

/** Monta um chunk PNG completo: tamanho + tipo + dados + CRC-32. */
export function montarChunkPng(tipo: string, dados: Uint8Array): Uint8Array {
  const tipoBytes = Uint8Array.from([...tipo].map(c => c.charCodeAt(0)))
  const corpo = new Uint8Array(tipoBytes.length + dados.length)
  corpo.set(tipoBytes, 0)
  corpo.set(dados, tipoBytes.length)
  const crc = crc32(corpo, 0, corpo.length)
  const saida = new Uint8Array(4 + corpo.length + 4)
  saida.set(be32(dados.length), 0)
  saida.set(corpo, 4)
  saida.set(be32(crc), 4 + corpo.length)
  return saida
}

export function concatBytes(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of partes) { out.set(p, off); off += p.length }
  return out
}

/** Pixels por metro a partir do DPI (1 polegada = 0,0254 m). */
export function dpiParaPpm(dpi: number): number {
  return Math.round(dpi / 0.0254)
}

/**
 * Codifica um raster RGBA (4 bytes por pixel, sem padding) em PNG.
 * `raster.length` precisa ser exatamente largura*altura*4.
 */
export function codificarPngRgba(
  raster: Uint8Array,
  larguraPx: number,
  alturaPx: number,
  dpi: number,
): Uint8Array {
  const esperado = larguraPx * alturaPx * 4
  if (raster.length !== esperado) {
    throw new RangeError(`raster com ${raster.length} bytes; esperado ${esperado}`)
  }

  const ihdr = new Uint8Array(13)
  ihdr.set(be32(larguraPx), 0)
  ihdr.set(be32(alturaPx), 4)
  ihdr[8] = 8   // profundidade
  ihdr[9] = 6   // RGBA
  ihdr[10] = 0  // deflate
  ihdr[11] = 0  // filtro adaptativo
  ihdr[12] = 0  // sem entrelaçamento

  const ppm = dpiParaPpm(dpi)
  const phys = new Uint8Array(9)
  phys.set(be32(ppm), 0)
  phys.set(be32(ppm), 4)
  phys[8] = 1 // unidade = metro

  // Scanlines com filtro None (0). Filtro fixo mantém a saída determinística
  // e evita qualquer heurística adaptativa dependente de implementação.
  const bytesLinha = larguraPx * 4
  const cru = new Uint8Array((bytesLinha + 1) * alturaPx)
  for (let y = 0; y < alturaPx; y++) {
    const destino = y * (bytesLinha + 1)
    cru[destino] = 0
    cru.set(raster.subarray(y * bytesLinha, (y + 1) * bytesLinha), destino + 1)
  }

  const idat = new Uint8Array(deflateSync(cru, { level: 9 }))

  return concatBytes([
    ASSINATURA,
    montarChunkPng('IHDR', ihdr),
    montarChunkPng('pHYs', phys),
    montarChunkPng('IDAT', idat),
    montarChunkPng('IEND', new Uint8Array(0)),
  ])
}
