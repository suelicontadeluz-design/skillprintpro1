export type RasterRgba = {
  largura_px: number
  altura_px: number
  pixels: Uint8Array
}

export type OpcoesRemocaoFundo = {
  tolerancia_cor?: number
  remover_bolsos_internos?: boolean
  area_min_bolso_px?: number
  recortar_transparencia?: boolean
  padding_px?: number
}

export type ResultadoRemocaoFundo = {
  versao: 'remover_fundo_v1'
  raster: RasterRgba
  fundo_rgb: [number, number, number]
  crop: { x: number; y: number; largura_px: number; altura_px: number }
  pixels_transparentes: number
  pixels_bolsos_removidos: number
  revisao_recomendada: boolean
}

function validar(r: RasterRgba) {
  if (!Number.isInteger(r.largura_px) || r.largura_px <= 0) throw new Error('LARGURA_INVALIDA')
  if (!Number.isInteger(r.altura_px) || r.altura_px <= 0) throw new Error('ALTURA_INVALIDA')
  if (!(r.pixels instanceof Uint8Array) || r.pixels.length !== r.largura_px * r.altura_px * 4) {
    throw new Error('RASTER_RGBA_INVALIDO')
  }
}

function mediana(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

function estimarFundo(r: RasterRgba): [number, number, number] {
  const { largura_px: w, altura_px: h, pixels } = r
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  const passo = Math.max(1, Math.floor(Math.min(w, h) / 256))
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    rs.push(pixels[i]); gs.push(pixels[i + 1]); bs.push(pixels[i + 2])
  }
  for (let x = 0; x < w; x += passo) { push(x, 0); if (h > 1) push(x, h - 1) }
  for (let y = passo; y < h - 1; y += passo) { push(0, y); if (w > 1) push(w - 1, y) }
  return [mediana(rs), mediana(gs), mediana(bs)]
}

export function removerFundoRgba(r: RasterRgba, op: OpcoesRemocaoFundo = {}): ResultadoRemocaoFundo {
  validar(r)
  const w = r.largura_px, h = r.altura_px
  const tolerancia = Math.max(0, Math.min(255, Math.round(op.tolerancia_cor ?? 28)))
  const removerBolsos = op.remover_bolsos_internos === true
  const minBolso = Math.max(1, Math.round(op.area_min_bolso_px ?? Math.max(16, w * h * 0.00015)))
  const recortar = op.recortar_transparencia !== false
  const padding = Math.max(0, Math.round(op.padding_px ?? 2))
  const fundo = estimarFundo(r)
  const src = r.pixels
  const n = w * h
  const candidato = new Uint8Array(n)
  const removido = new Uint8Array(n)

  const dist = (p: number) => {
    const i = p * 4
    return Math.max(Math.abs(src[i] - fundo[0]), Math.abs(src[i + 1] - fundo[1]), Math.abs(src[i + 2] - fundo[2]))
  }
  for (let p = 0; p < n; p++) if (dist(p) <= tolerancia) candidato[p] = 1

  const fila = new Int32Array(n)
  let q0 = 0, q1 = 0
  const entra = (p: number) => {
    if (candidato[p] && !removido[p]) { removido[p] = 1; fila[q1++] = p }
  }
  for (let x = 0; x < w; x++) { entra(x); if (h > 1) entra((h - 1) * w + x) }
  for (let y = 1; y < h - 1; y++) { entra(y * w); if (w > 1) entra(y * w + (w - 1)) }
  while (q0 < q1) {
    const p = fila[q0++], x = p % w, y = Math.floor(p / w)
    if (x > 0) entra(p - 1); if (x + 1 < w) entra(p + 1)
    if (y > 0) entra(p - w); if (y + 1 < h) entra(p + w)
  }

  let bolsosRemovidos = 0
  if (removerBolsos) {
    const visto = removido.slice()
    const comp = new Int32Array(n)
    for (let seed = 0; seed < n; seed++) {
      if (!candidato[seed] || visto[seed]) continue
      let a = 0, b = 0
      comp[b++] = seed; visto[seed] = 1
      while (a < b) {
        const p = comp[a++], x = p % w, y = Math.floor(p / w)
        const add = (z: number) => {
          if (candidato[z] && !visto[z]) { visto[z] = 1; comp[b++] = z }
        }
        if (x > 0) add(p - 1); if (x + 1 < w) add(p + 1)
        if (y > 0) add(p - w); if (y + 1 < h) add(p + w)
      }
      if (b >= minBolso) {
        for (let k = 0; k < b; k++) removido[comp[k]] = 1
        bolsosRemovidos += b
      }
    }
  }

  const out = src.slice()
  let transparentes = 0
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (removido[p]) { out[i + 3] = 0; transparentes++ }
    if (out[i + 3] > 0) {
      const x = p % w, y = Math.floor(p / w)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }

  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1
  if (recortar && maxX >= 0) {
    x0 = Math.max(0, minX - padding); y0 = Math.max(0, minY - padding)
    x1 = Math.min(w - 1, maxX + padding); y1 = Math.min(h - 1, maxY + padding)
  }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const crop = new Uint8Array(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    const srcIni = ((y0 + y) * w + x0) * 4
    crop.set(out.subarray(srcIni, srcIni + cw * 4), y * cw * 4)
  }

  return {
    versao: 'remover_fundo_v1',
    raster: { largura_px: cw, altura_px: ch, pixels: crop },
    fundo_rgb: fundo,
    crop: { x: x0, y: y0, largura_px: cw, altura_px: ch },
    pixels_transparentes: transparentes,
    pixels_bolsos_removidos: bolsosRemovidos,
    revisao_recomendada: bolsosRemovidos > 0,
  }
}
