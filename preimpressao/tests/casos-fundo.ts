import { removerFundoRgba } from '../src/remover-fundo.ts'
import { grupo, ok, teste } from './harness.ts'

function raster(w: number, h: number, bg: [number, number, number] = [0, 0, 0]) {
  const pixels = new Uint8Array(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    pixels[i] = bg[0]; pixels[i + 1] = bg[1]; pixels[i + 2] = bg[2]; pixels[i + 3] = 255
  }
  return { largura_px: w, altura_px: h, pixels }
}

function pintar(r: ReturnType<typeof raster>, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * r.largura_px + x) * 4
    r.pixels[i] = rgb[0]; r.pixels[i + 1] = rgb[1]; r.pixels[i + 2] = rgb[2]; r.pixels[i + 3] = 255
  }
}

grupo('Remoção de fundo determinística')

teste('remove somente fundo conectado à borda e recorta margem transparente', () => {
  const r = raster(10, 10)
  pintar(r, 3, 2, 7, 8, [255, 40, 20])
  const out = removerFundoRgba(r, { padding_px: 0 })
  ok(out.pixels_transparentes === 76, `esperava 76 transparentes, veio ${out.pixels_transparentes}`)
  ok(out.raster.largura_px === 4 && out.raster.altura_px === 6, `crop ${out.raster.largura_px}x${out.raster.altura_px}`)
  return 'fundo externo removido; conteúdo útil 4x6'
})

teste('não remove bolso interno por padrão', () => {
  const r = raster(9, 9, [255, 255, 255])
  pintar(r, 1, 1, 8, 8, [255, 0, 0])
  pintar(r, 3, 3, 6, 6, [255, 255, 255])
  const out = removerFundoRgba(r, { padding_px: 0, tolerancia_cor: 5 })
  ok(out.pixels_bolsos_removidos === 0, 'bolso interno foi removido sem autorização')
  ok(!out.revisao_recomendada, 'não deveria exigir revisão sem remover bolso')
  return 'modo conservador preserva região interna semelhante ao fundo'
})

teste('modo explícito remove bolso interno e marca revisão', () => {
  const r = raster(9, 9, [255, 255, 255])
  pintar(r, 1, 1, 8, 8, [255, 0, 0])
  pintar(r, 3, 3, 6, 6, [255, 255, 255])
  const out = removerFundoRgba(r, {
    padding_px: 0, tolerancia_cor: 5, remover_bolsos_internos: true, area_min_bolso_px: 4,
  })
  ok(out.pixels_bolsos_removidos === 9, `esperava 9 px, veio ${out.pixels_bolsos_removidos}`)
  ok(out.revisao_recomendada, 'remoção destrutiva interna deveria pedir revisão')
  return 'bolso interno removido com revisão obrigatória'
})

teste('RGB do conteúdo não é reamostrado nem alterado', () => {
  const r = raster(6, 6)
  pintar(r, 1, 1, 5, 5, [7, 33, 99])
  const original = r.pixels.slice()
  const out = removerFundoRgba(r, { padding_px: 0 })
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) {
    const oi = (y * 6 + x) * 4
    const ni = ((y - 1) * 4 + (x - 1)) * 4
    ok(out.raster.pixels[ni] === original[oi], 'R mudou')
    ok(out.raster.pixels[ni + 1] === original[oi + 1], 'G mudou')
    ok(out.raster.pixels[ni + 2] === original[oi + 2], 'B mudou')
  }
  return 'conteúdo preservado byte a byte; só alfa/crop mudam'
})
