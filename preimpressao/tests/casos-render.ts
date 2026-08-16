// ─── Casos do renderizador determinístico ──────────────────────────────────
// Importado dinamicamente por run.ts para preservar a ordem de execução.

import { montarGangSheet } from '../src/motor-gang-sheet.ts'
import { renderizarGangSheet } from '../src/renderizador.ts'
import { executarPreflight } from '../src/preflight.ts'
import { decodificarPngRgba } from '../src/decodificar-png.ts'
import { lerMetadadosPng } from '../src/metadados-png.ts'
import { sha256Hex } from '../src/canonico.ts'
import { cmParaPx, umParaCm } from '../src/unidades.ts'
import { corromper, gerarPng } from '../testkit/png-sintetico.ts'
import type { EntradaPreflight, ResultadoMontagem } from '../src/tipos.ts'
import type { EntradaRender, MestreRender } from '../src/renderizador.ts'

import { grupo, lancaCodigo, ok, teste } from './harness.ts'

// ── Fixtures ──────────────────────────────────────────────────────────────

const DPI = 300
const MIDIA = { largura_util_cm: 5, dpi: DPI, comprimento_max_cm: 20 }
const LAYOUT = { margem_cm: 0.5, espacamento_cm: 0.3 }

function mestre(id: string, larguraCm: number, alturaCm: number, rot: boolean, qtd: number) {
  const bytes = gerarPng(cmParaPx(larguraCm, DPI), cmParaPx(alturaCm, DPI), { padrao: 'gradiente' })
  return {
    id, larguraCm, alturaCm, rot, qtd,
    bytes,
    sha: sha256Hex(bytes),
  }
}

const A = mestre('A', 1.8, 2.5, false, 2)
const B = mestre('B', 1.2, 1.0, false, 3)
const D = mestre('D', 4.5, 1.0, true, 1)   // só cabe rotacionada

function pecasDe(ms: Array<ReturnType<typeof mestre>>) {
  return ms.map(m => ({
    arte_mestre_id: m.id, versao: 1, sha256: m.sha,
    largura_cm: m.larguraCm, altura_cm: m.alturaCm,
    quantidade: m.qtd, rotacao_permitida: m.rot,
  }))
}

function mestresRender(ms: Array<ReturnType<typeof mestre>>): MestreRender[] {
  return ms.map(m => ({
    arte_mestre_id: m.id, versao: 1, sha256_registrado: m.sha,
    bytes: m.bytes.slice(), largura_cm: m.larguraCm, altura_cm: m.alturaCm,
  }))
}

const CONJUNTO = [A, B, D]
const PLANO: ResultadoMontagem = montarGangSheet({
  midia: { ...MIDIA }, layout: { ...LAYOUT }, pecas: pecasDe(CONJUNTO),
})

function entradaRender(pagina = 1): EntradaRender {
  return {
    plano: PLANO, midia: { ...MIDIA }, layout: { ...LAYOUT },
    mestres: mestresRender(CONJUNTO), pagina,
  }
}

// ── Auxiliares de pixel ───────────────────────────────────────────────────

function regiao(dados: Uint8Array, largura: number, x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let l = 0; l < h; l++) {
    const de = ((y + l) * largura + x) * 4
    out.set(dados.subarray(de, de + w * 4), l * w * 4)
  }
  return out
}

/** Mesma convenção do renderizador: 90° no sentido horário. */
function rotacionar90(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let ys = 0; ys < h; ys++) {
    for (let xs = 0; xs < w; xs++) {
      const xd = h - 1 - ys
      const yd = xs
      const de = (ys * w + xs) * 4
      const para = (yd * h + xd) * 4
      out[para] = rgba[de]; out[para + 1] = rgba[de + 1]
      out[para + 2] = rgba[de + 2]; out[para + 3] = rgba[de + 3]
    }
  }
  return out
}

function rasterDe(png: Uint8Array) {
  const r = decodificarPngRgba(png)
  if (!r.ok || !r.raster) throw new Error(`PNG renderizado ilegível: ${r.erro}`)
  return r.raster
}

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — artefato físico')

teste('produz PNG válido com dimensões e DPI contratados', () => {
  const art = renderizarGangSheet(entradaRender())
  const m = lerMetadadosPng(art.png)
  ok(m.ok && m.metadados !== null, `PNG inválido: ${m.erro}`)
  const md = m.metadados!
  ok(md.largura_px === cmParaPx(MIDIA.largura_util_cm, DPI), `largura ${md.largura_px}`)
  ok(md.largura_px === art.largura_px && md.altura_px === art.altura_px, 'manifesto diverge do arquivo')
  ok(Math.abs(md.dpi_x! - DPI) < 0.05, `DPI ${md.dpi_x}`)
  ok(md.tem_alpha, 'transparência não preservada')
  const compCm = umParaCm(PLANO.paginas[0].comprimento_utilizado_um)
  ok(md.altura_px === cmParaPx(compCm, DPI), `altura ${md.altura_px} vs ${cmParaPx(compCm, DPI)}`)
  return `${md.largura_px}×${md.altura_px} px · ${compCm} cm · DPI ${md.dpi_x!.toFixed(4)} · alfa`
})

teste('dimensão física do arquivo confere com a mídia contratada', () => {
  const art = renderizarGangSheet(entradaRender())
  const largCm = (art.largura_px * 2.54) / DPI
  ok(Math.abs(largCm - MIDIA.largura_util_cm) < 0.01, `largura física ${largCm}`)
  return `${largCm.toFixed(4)} cm ≈ ${MIDIA.largura_util_cm} cm contratados`
})

teste('fundo nasce transparente onde não há arte', () => {
  const art = renderizarGangSheet(entradaRender())
  const r = rasterDe(art.png)
  // canto superior esquerdo está dentro da margem — nunca recebe arte
  const alfaCanto = r.dados[3]
  ok(alfaCanto === 0, `alfa do canto = ${alfaCanto}, esperado 0`)
  let opacos = 0
  for (let p = 3; p < r.dados.length; p += 4) if (r.dados[p] !== 0) opacos++
  const areaArtes = art.itens.reduce((s, i) => s + i.largura_px * i.altura_px, 0)
  ok(opacos === areaArtes, `pixels opacos ${opacos} ≠ área das artes ${areaArtes}`)
  return `${opacos} px opacos = exatamente a área das ${art.itens.length} artes`
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — determinismo')

teste('20 renderizações da mesma entrada = mesmos hashes', () => {
  const raster = new Set<string>()
  const arquivo = new Set<string>()
  const manifesto = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const a = renderizarGangSheet(entradaRender())
    raster.add(a.sha256_raster); arquivo.add(a.sha256_arquivo); manifesto.add(a.manifesto_hash)
  }
  ok(raster.size === 1, `${raster.size} rasters distintos`)
  ok(arquivo.size === 1, `${arquivo.size} arquivos distintos`)
  ok(manifesto.size === 1, `${manifesto.size} manifestos distintos`)
  return `raster ${[...raster][0].slice(0, 16)}… · arquivo ${[...arquivo][0].slice(0, 16)}…`
})

teste('plano remontado do zero produz o mesmo artefato', () => {
  const ref = renderizarGangSheet(entradaRender())
  const planoNovo = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT }, pecas: pecasDe([D, B, A]), // ordem trocada
  })
  const art = renderizarGangSheet({
    plano: planoNovo, midia: { ...MIDIA }, layout: { ...LAYOUT },
    mestres: mestresRender([B, D, A]), pagina: 1, // ordem dos mestres trocada
  })
  ok(art.sha256_raster === ref.sha256_raster, 'raster mudou com a ordem de entrada')
  ok(art.sha256_arquivo === ref.sha256_arquivo, 'arquivo mudou com a ordem de entrada')
  ok(art.manifesto_hash === ref.manifesto_hash, 'manifesto mudou com a ordem de entrada')
  return 'ordem de peças e de mestres é irrelevante'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — fidelidade pixel a pixel')

teste('cópia não rotacionada é byte-idêntica ao mestre', () => {
  const art = renderizarGangSheet(entradaRender())
  const r = rasterDe(art.png)
  const mestreA = rasterDe(A.bytes)
  const itensA = art.itens.filter(i => i.arte_mestre_id === 'A')
  ok(itensA.length === 2, `esperava 2 cópias de A, veio ${itensA.length}`)
  const shaMestre = sha256Hex(mestreA.dados)
  for (const i of itensA) {
    ok(i.rotacao_graus === 0, 'A não deveria rotacionar')
    const recorte = regiao(r.dados, r.largura_px, i.x_px, i.y_px, i.largura_px, i.altura_px)
    ok(sha256Hex(recorte) === shaMestre, `cópia #${i.sequencia} difere do mestre`)
  }
  return `2 cópias · recorte SHA ${shaMestre.slice(0, 16)}… idêntico ao mestre`
})

teste('N cópias derivam do MESMO raster: um único SHA de recorte', () => {
  const art = renderizarGangSheet(entradaRender())
  const r = rasterDe(art.png)
  const shas = new Set(
    art.itens.filter(i => i.arte_mestre_id === 'B')
      .map(i => sha256Hex(regiao(r.dados, r.largura_px, i.x_px, i.y_px, i.largura_px, i.altura_px))),
  )
  ok(shas.size === 1, `${shas.size} rasters distintos entre as cópias de B`)
  return `3 cópias de B · 1 único SHA de pixels · zero regeneração`
})

teste('rotação 90° é permutação exata, sem reamostragem', () => {
  const art = renderizarGangSheet(entradaRender())
  const r = rasterDe(art.png)
  const itemD = art.itens.find(i => i.arte_mestre_id === 'D')!
  ok(itemD.rotacao_graus === 90, `D deveria estar em 90°, veio ${itemD.rotacao_graus}`)
  const mestreD = rasterDe(D.bytes)
  const esperado = rotacionar90(mestreD.dados, mestreD.largura_px, mestreD.altura_px)
  const recorte = regiao(r.dados, r.largura_px, itemD.x_px, itemD.y_px, itemD.largura_px, itemD.altura_px)
  ok(sha256Hex(recorte) === sha256Hex(esperado), 'rotação alterou pixels')
  ok(itemD.largura_px === mestreD.altura_px && itemD.altura_px === mestreD.largura_px,
    'dimensões não foram trocadas')
  // O multiconjunto de pixels tem de ser idêntico: permutação não cria nem perde.
  ok(recorte.length === mestreD.dados.length, 'contagem de bytes mudou na rotação')
  return `${mestreD.largura_px}×${mestreD.altura_px} → ${itemD.largura_px}×${itemD.altura_px}, pixels intactos`
})

teste('itens do manifesto carregam o SHA-256 do mestre aprovado', () => {
  const art = renderizarGangSheet(entradaRender())
  const porId: Record<string, string> = { A: A.sha, B: B.sha, D: D.sha }
  for (const i of art.itens) {
    ok(i.sha256_mestre === porId[i.arte_mestre_id], `#${i.sequencia} com SHA errado`)
  }
  return `${art.itens.length} itens rastreados ao mestre aprovado`
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Pré-flight sobre o ARTEFATO RENDERIZADO')

teste('artefato renderizado passa nas 16 checagens', () => {
  const art = renderizarGangSheet(entradaRender())
  const e: EntradaPreflight = {
    arquivo_producao: art.png,
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    plano: { itens: PLANO.itens, paginas: PLANO.paginas, area_util_pct: PLANO.area_util_pct },
    mestres: CONJUNTO.map(m => ({
      arte_mestre_id: m.id, versao: 1, sha256_registrado: m.sha, bytes: m.bytes.slice(),
      largura_cm: m.larguraCm, altura_cm: m.alturaCm,
      rotacao_permitida: m.rot, quantidade_solicitada: m.qtd,
    })),
    pagina_referencia: 1,
  }
  const r = executarPreflight(e)
  ok(r.checagens.length === 16, `${r.checagens.length} checagens`)
  ok(r.aprovado, `reprovado: ${r.motivos.join(' | ')}`)
  return `16/16 · 3 artes · 6 cópias · 1 rotação · ${art.largura_px}×${art.altura_px} px`
})

teste('artefato renderizado corrompido é reprovado pelo pré-flight', () => {
  const art = renderizarGangSheet(entradaRender())
  const e: EntradaPreflight = {
    arquivo_producao: corromper(art.png, 200),
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    plano: { itens: PLANO.itens, paginas: PLANO.paginas, area_util_pct: PLANO.area_util_pct },
    mestres: CONJUNTO.map(m => ({
      arte_mestre_id: m.id, versao: 1, sha256_registrado: m.sha, bytes: m.bytes.slice(),
      largura_cm: m.larguraCm, altura_cm: m.alturaCm,
      rotacao_permitida: m.rot, quantidade_solicitada: m.qtd,
    })),
  }
  const r = executarPreflight(e)
  ok(!r.aprovado, 'corrupção do artefato passou')
  return 'corrupção pós-render detectada'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — paginação')

teste('múltiplas páginas: cada uma renderiza e passa no pré-flight', () => {
  const pecas = [{
    arte_mestre_id: 'A', versao: 1, sha256: A.sha,
    largura_cm: 1.8, altura_cm: 2.5, quantidade: 12, rotacao_permitida: false,
  }]
  const plano = montarGangSheet({
    midia: { largura_util_cm: 5, dpi: DPI, comprimento_max_cm: 10 },
    layout: { ...LAYOUT }, pecas,
  })
  ok(plano.paginas.length > 1, 'esperava múltiplas páginas')

  const midia = { largura_util_cm: 5, dpi: DPI, comprimento_max_cm: 10 }
  const resumo: string[] = []
  for (const p of plano.paginas) {
    const art = renderizarGangSheet({
      plano, midia, layout: { ...LAYOUT },
      mestres: [{
        arte_mestre_id: 'A', versao: 1, sha256_registrado: A.sha,
        bytes: A.bytes.slice(), largura_cm: 1.8, altura_cm: 2.5,
      }],
      pagina: p.pagina,
    })
    const r = executarPreflight({
      arquivo_producao: art.png, midia, layout: { ...LAYOUT },
      plano: { itens: plano.itens, paginas: plano.paginas, area_util_pct: plano.area_util_pct },
      mestres: [{
        arte_mestre_id: 'A', versao: 1, sha256_registrado: A.sha, bytes: A.bytes.slice(),
        largura_cm: 1.8, altura_cm: 2.5, rotacao_permitida: false,
        quantidade_solicitada: 12,
      }],
      pagina_referencia: p.pagina,
    })
    // C06 é global (12 cópias no plano inteiro); as demais valem por página.
    const geometricas = r.checagens.filter(c => c.codigo !== 'C06_QUANTIDADE')
    ok(geometricas.every(c => c.ok),
      `página ${p.pagina} reprovou: ${geometricas.filter(c => !c.ok).map(c => c.codigo).join(', ')}`)
    resumo.push(`p${p.pagina}:${art.largura_px}×${art.altura_px}`)
  }
  return `${plano.paginas.length} páginas · ${resumo.join(' · ')}`
})

teste('página inexistente = falha explícita', () => {
  lancaCodigo('RENDER_PAGINA_INEXISTENTE', () => renderizarGangSheet(entradaRender(99)))
  return 'não inventa página vazia'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — fail-closed')

teste('mestre não fornecido = RENDER_MESTRE_AUSENTE', () => {
  lancaCodigo('RENDER_MESTRE_AUSENTE', () => renderizarGangSheet({
    ...entradaRender(), mestres: mestresRender([A, B]), // falta D
  }))
  return 'não renderiza buraco no lugar da arte'
})

teste('bytes do mestre trocados após aprovação = RENDER_MESTRE_SHA_DIVERGENTE', () => {
  const ms = mestresRender(CONJUNTO)
  ms[0].bytes = gerarPng(cmParaPx(1.8, DPI), cmParaPx(2.5, DPI), { padrao: 'vazio' })
  lancaCodigo('RENDER_MESTRE_SHA_DIVERGENTE', () => renderizarGangSheet({ ...entradaRender(), mestres: ms }))
  return 'fidelidade verificada ANTES de tocar nos pixels'
})

teste('mestre sem canal alfa = RENDER_MESTRE_SEM_ALPHA', () => {
  const semAlfa = gerarPng(cmParaPx(1.8, DPI), cmParaPx(2.5, DPI), { tipo_cor: 2 })
  const ms = mestresRender(CONJUNTO)
  ms[0] = { ...ms[0], bytes: semAlfa, sha256_registrado: sha256Hex(semAlfa) }
  const plano = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: pecasDe(CONJUNTO).map(p => p.arte_mestre_id === 'A' ? { ...p, sha256: sha256Hex(semAlfa) } : p),
  })
  lancaCodigo('RENDER_MESTRE_SEM_ALPHA', () => renderizarGangSheet({
    ...entradaRender(), plano, mestres: ms,
  }))
  return 'DTF exige transparência; opaco é recusado'
})

teste('pixels do mestre incompatíveis com a medida = RENDER_MESTRE_PX_INCOMPATIVEL', () => {
  // Mestre declarado 1,8×2,5 cm mas gravado com metade dos pixels.
  const errado = gerarPng(107, 148, { padrao: 'gradiente' })
  const shaErrado = sha256Hex(errado)
  const ms = mestresRender(CONJUNTO)
  ms[0] = { ...ms[0], bytes: errado, sha256_registrado: shaErrado }
  const plano = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: pecasDe(CONJUNTO).map(p => p.arte_mestre_id === 'A' ? { ...p, sha256: shaErrado } : p),
  })
  const e = lancaCodigo('RENDER_MESTRE_PX_INCOMPATIVEL', () => renderizarGangSheet({
    ...entradaRender(), plano, mestres: ms,
  }))
  return `${JSON.stringify(e.detalhe.px_arquivo)} ≠ ${JSON.stringify(e.detalhe.px_esperado)} — NÃO redimensiona`
})

teste('mestre ilegível = RENDER_MESTRE_ILEGIVEL', () => {
  const quebrado = corromper(A.bytes, 80)
  const ms = mestresRender(CONJUNTO)
  ms[0] = { ...ms[0], bytes: quebrado, sha256_registrado: sha256Hex(quebrado) }
  const plano = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: pecasDe(CONJUNTO).map(p => p.arte_mestre_id === 'A' ? { ...p, sha256: sha256Hex(quebrado) } : p),
  })
  lancaCodigo('RENDER_MESTRE_ILEGIVEL', () => renderizarGangSheet({
    ...entradaRender(), plano, mestres: ms,
  }))
  return 'arquivo corrompido não vira folha de produção'
})

teste('escala ≠ 1 no plano = RENDER_ESCALA_INVALIDA', () => {
  const plano = structuredClone(PLANO)
  plano.itens[0].escala = 0.5 as unknown as 1
  lancaCodigo('RENDER_ESCALA_INVALIDA', () => renderizarGangSheet({ ...entradaRender(), plano }))
  return 'renderizador não implementa escala'
})

teste('rotação fora de {0,90} = RENDER_ROTACAO_INVALIDA', () => {
  const plano = structuredClone(PLANO)
  plano.itens[0].rotacao_graus = 45 as unknown as 0
  lancaCodigo('RENDER_ROTACAO_INVALIDA', () => renderizarGangSheet({ ...entradaRender(), plano }))
  return 'ângulo arbitrário recusado'
})

teste('rotação só acontece quando registrada no plano', () => {
  const art = renderizarGangSheet(entradaRender())
  for (const i of art.itens) {
    const noPlano = PLANO.itens.find(p => p.sequencia === i.sequencia)!
    ok(i.rotacao_graus === noPlano.rotacao_graus, `#${i.sequencia} rotacionou por conta própria`)
  }
  const rotacionados = art.itens.filter(i => i.rotacao_graus === 90).length
  return `${rotacionados} de ${art.itens.length} rotacionados — exatamente o que o plano manda`
})

teste('item fora da mídia = RENDER_FORA_DA_MIDIA', () => {
  const plano = structuredClone(PLANO)
  plano.itens[0].x_um = 480000
  lancaCodigo('RENDER_FORA_DA_MIDIA', () => renderizarGangSheet({ ...entradaRender(), plano }))
  return 'nada é cortado silenciosamente na borda'
})

teste('sobreposição forçada no plano = RENDER_SOBREPOSICAO', () => {
  const plano = structuredClone(PLANO)
  plano.itens[1].x_um = plano.itens[0].x_um
  plano.itens[1].y_um = plano.itens[0].y_um
  lancaCodigo('RENDER_SOBREPOSICAO', () => renderizarGangSheet({ ...entradaRender(), plano }))
  return 'renderizador não confia no plano: reconfere em pixels'
})

teste('instância que não deriva do mestre = RENDER_MESTRE_SHA_DIVERGENTE', () => {
  const plano = structuredClone(PLANO)
  plano.itens[0].sha256 = B.sha
  lancaCodigo('RENDER_MESTRE_SHA_DIVERGENTE', () => renderizarGangSheet({ ...entradaRender(), plano }))
  return 'regeneração de cópia bloqueada na renderização'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Renderizador — zero IA e zero rede')

teste('nenhuma chamada de rede durante a renderização', () => {
  const originalFetch = globalThis.fetch
  let chamadas = 0
  // @ts-ignore — instrumentação intencional
  globalThis.fetch = () => { chamadas++; throw new Error('rede proibida na renderização') }
  try {
    for (let i = 0; i < 5; i++) renderizarGangSheet(entradaRender())
  } finally {
    // @ts-ignore
    globalThis.fetch = originalFetch
  }
  ok(chamadas === 0, `houve ${chamadas} chamada(s) de rede`)
  return '5 renderizações · 0 chamadas de rede'
})

teste('renderização não consulta relógio nem aleatoriedade', () => {
  const dateNow = Date.now
  const random = Math.random
  let usos = 0
  Date.now = () => { usos++; return 0 }
  Math.random = () => { usos++; return 0 }
  try {
    renderizarGangSheet(entradaRender())
  } finally {
    Date.now = dateNow
    Math.random = random
  }
  ok(usos === 0, `houve ${usos} uso(s) de relógio/aleatoriedade`)
  return 'sem Date.now, sem Math.random'
})
