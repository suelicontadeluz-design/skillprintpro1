// ─── Gerador de PNG sintético (só para testes) ─────────────────────────────
// Produz PNGs reais e válidos — assinatura, IHDR, pHYs, IDAT deflatado e IEND,
// com CRC-32 correto em cada chunk. Usa apenas `node:zlib`, builtin.
//
// Não faz parte do caminho de produção. Existe para que o pré-flight seja
// testado contra ARQUIVOS DE VERDADE, e não contra metadados fabricados.

import { deflateSync } from 'node:zlib'
import { crc32 } from '../src/metadados-png.ts'

const ASSINATURA = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function be32(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

function chunk(tipo: string, dados: Uint8Array): Uint8Array {
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

function concat(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of partes) { out.set(p, off); off += p.length }
  return out
}

export interface OpcoesPng {
  /** 6 = RGBA (com alfa), 2 = RGB (sem alfa). Padrão 6. */
  tipo_cor?: 6 | 2
  /** Quando null, o chunk pHYs não é gravado. */
  dpi?: number | null
}

export function gerarPng(larguraPx: number, alturaPx: number, opcoes: OpcoesPng = {}): Uint8Array {
  const tipoCor = opcoes.tipo_cor ?? 6
  const dpi = opcoes.dpi === undefined ? 300 : opcoes.dpi
  const canais = tipoCor === 6 ? 4 : 3

  const ihdr = new Uint8Array(13)
  ihdr.set(be32(larguraPx), 0)
  ihdr.set(be32(alturaPx), 4)
  ihdr[8] = 8         // profundidade de bits
  ihdr[9] = tipoCor
  ihdr[10] = 0        // compressão deflate
  ihdr[11] = 0        // filtro adaptativo
  ihdr[12] = 0        // sem entrelaçamento

  const partes: Uint8Array[] = [ASSINATURA, chunk('IHDR', ihdr)]

  if (dpi !== null) {
    // pHYs guarda pixels por metro (inteiro). 1 pol = 0,0254 m.
    const ppm = Math.round(dpi / 0.0254)
    const phys = new Uint8Array(9)
    phys.set(be32(ppm), 0)
    phys.set(be32(ppm), 4)
    phys[8] = 1 // unidade = metro
    partes.push(chunk('pHYs', phys))
  }

  // Scanlines cruas: 1 byte de filtro (0 = None) + largura*canais bytes.
  // Conteúdo totalmente transparente quando RGBA — é o fundo esperado do DTF.
  const bytesPorLinha = 1 + larguraPx * canais
  const cru = new Uint8Array(bytesPorLinha * alturaPx)
  // Zeros já representam filtro None + pixels (0,0,0,0). Nada mais a escrever.

  partes.push(chunk('IDAT', new Uint8Array(deflateSync(cru))))
  partes.push(chunk('IEND', new Uint8Array(0)))

  return concat(partes)
}

/** Corrompe um byte no payload do IDAT, mantendo o tamanho — quebra o CRC. */
export function corromper(png: Uint8Array, deslocamento = 70): Uint8Array {
  const copia = png.slice()
  const i = Math.min(deslocamento, copia.length - 1)
  copia[i] = copia[i] ^ 0xff
  return copia
}
