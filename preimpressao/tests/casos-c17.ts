// ─── C17 — fidelidade pixel a pixel no pré-flight independente ─────────────
//
// O renderizador aparece aqui apenas como FÁBRICA DE ARTEFATO nos testes.
// O módulo `preflight.ts` continua sem importá-lo — há teste que verifica isso.

import { montarGangSheet } from '../src/motor-gang-sheet.ts'
import { renderizarGangSheet } from '../src/renderizador.ts'
import { executarPreflight } from '../src/preflight.ts'
import { decodificarPngRgba } from '../src/decodificar-png.ts'
import { codificarPngRgba } from '../src/codificar-png.ts'
import { canonicalizar, sha256Hex } from '../src/canonico.ts'
import { lerMetadadosPng } from '../src/metadados-png.ts'
import { cmParaPx, cmParaUm } from '../src/unidades.ts'
import { gerarPng } from '../testkit/png-sintetico.ts'
import type { EntradaPreflight, ResultadoMontagem } from '../src/tipos.ts'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { grupo, ok, teste } from './harness.ts'

// ── Fixtures ──────────────────────────────────────────────────────────────

const DPI = 300
const MIDIA = { largura_util_cm: 5, dpi: DPI, comprimento_max_cm: 20 }
const LAYOUT = { margem_cm: 0.5, espacamento_cm: 0.3 }

function arte(id: string, lCm: number, aCm: number, rot: boolean, qtd: number, semente = 0) {
  const bytes = gerarPng(cmParaPx(lCm, DPI), cmParaPx(aCm, DPI), { padrao: 'gradiente', semente })
  return { id, lCm, aCm, rot, qtd, bytes, sha: sha256Hex(bytes) }
}

const A = arte('A', 1.8, 2.5, false, 2)
const B = arte('B', 1.2, 1.0, false, 3)
const D = arte('D', 4.5, 1.0, true, 1)      // só cabe rotacionada
const CONJUNTO = [A, B, D]

const PLANO: ResultadoMontagem = montarGangSheet({
  midia: { ...MIDIA }, layout: { ...LAYOUT },
  pecas: CONJUNTO.map(m => ({
    arte_mestre_id: m.id, versao: 1, sha256: m.sha,
    largura_cm: m.lCm, altura_cm: m.aCm, quantidade: m.qtd, rotacao_permitida: m.rot,
  })),
})

const ARTEFATO = renderizarGangSheet({
  plano: PLANO, midia: { ...MIDIA }, layout: { ...LAYOUT },
  mestres: CONJUNTO.map(m => ({
    arte_mestre_id: m.id, versao: 1, sha256_registrado: m.sha,
    bytes: m.bytes.slice(), largura_cm: m.lCm, altura_cm: m.aCm,
  })),
  pagina: 1,
})

function base(): EntradaPreflight {
  return {
    arquivo_producao: ARTEFATO.png,
    midia: { ...MIDIA },
    layout: { ...LAYOUT },
    plano: {
      itens: structuredClone(PLANO.itens),
      paginas: structuredClone(PLANO.paginas),
      area_util_pct: PLANO.area_util_pct,
    },
    mestres: CONJUNTO.map(m => ({
      arte_mestre_id: m.id, versao: 1, sha256_registrado: m.sha, bytes: m.bytes.slice(),
      largura_cm: m.lCm, altura_cm: m.aCm, rotacao_permitida: m.rot, quantidade_solicitada: m.qtd,
    })),
    pagina_referencia: 1,
  }
}

function c17(e: EntradaPreflight) {
  const r = executarPreflight(e)
  const c = r.checagens.find(x => x.codigo === 'C17_FIDELIDADE_PIXEL')
  if (!c) throw new Error('C17 não foi executada')
  return { r, c, det: c.detalhe as Record<string, unknown> }
}

function primeiroMotivo(det: Record<string, unknown>): string {
  const d = det.divergencias as Array<Record<string, unknown>> | undefined
  return d && d.length > 0 ? String(d[0].motivo) : '(nenhum)'
}

/** Altera um único byte do artefato e reempacota o PNG. */
function mutarPixel(png: Uint8Array, x: number, y: number, canal: 0 | 1 | 2 | 3, delta = 1): Uint8Array {
  const r = decodificarPngRgba(png)
  if (!r.ok || !r.raster) throw new Error('artefato ilegível no teste')
  const dados = r.raster.dados.slice()
  const i = (y * r.raster.largura_px + x) * 4 + canal
  dados[i] = (dados[i] + delta) & 0xff
  return codificarPngRgba(dados, r.raster.largura_px, r.raster.altura_px, DPI)
}

const ITEM_A1 = ARTEFATO.itens.find(i => i.arte_mestre_id === 'A')!
const ITEM_D = ARTEFATO.itens.find(i => i.arte_mestre_id === 'D')!
const ITENS_B = ARTEFATO.itens.filter(i => i.arte_mestre_id === 'B')

// ══════════════════════════════════════════════════════════════════════════
grupo('C17 — caso feliz')

teste('artefato correto: C17 aprova e o pré-flight fecha 17/17', () => {
  const { r, c, det } = c17(base())
  ok(c.ok, `C17 reprovou: ${JSON.stringify(det).slice(0, 200)}`)
  ok(r.aprovado, `pré-flight reprovado: ${r.motivos.join(' | ')}`)
  ok(det.itens_verificados === 6, `verificou ${det.itens_verificados} itens, esperado 6`)
  return `6 instâncias · 3 artes · 1 rotação 90° · 17/17`
})

teste('C17 é executada e tem código estável', () => {
  const { r } = c17(base())
  ok(r.checagens.length === 17, `${r.checagens.length} checagens`)
  ok(r.checagens[16].codigo === 'C17_FIDELIDADE_PIXEL', 'C17 fora de posição')
  return 'C17_FIDELIDADE_PIXEL presente como 17ª checagem'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('C17 — corrupção de pixel (comparação exata, zero tolerância)')

teste('um único byte RGB alterado reprova', () => {
  const e = base()
  const x = ITEM_A1.x_px + 10
  const y = ITEM_A1.y_px + 10
  e.arquivo_producao = mutarPixel(ARTEFATO.png, x, y, 0, 1) // canal R, delta 1
  const { r, c, det } = c17(e)
  ok(!c.ok, 'alteração de 1 byte passou')
  ok(!r.aprovado, 'pré-flight aprovou artefato corrompido')
  const d = (det.divergencias as Array<Record<string, unknown>>)[0]
  ok(d.motivo === 'PIXEL_DIVERGENTE', `motivo ${d.motivo}`)
  ok(d.canal === 'R', `canal ${d.canal}`)
  ok(d.x_px === x && d.y_px === y, `localizou em ${d.x_px},${d.y_px} em vez de ${x},${y}`)
  return `Δ=1 no canal R em (${x},${y}) → reprovado e localizado`
})

teste('alteração SOMENTE do canal alpha reprova', () => {
  const e = base()
  const x = ITEM_A1.x_px + 5
  const y = ITEM_A1.y_px + 7
  e.arquivo_producao = mutarPixel(ARTEFATO.png, x, y, 3, -1) // canal A
  const { c, det } = c17(e)
  ok(!c.ok, 'alteração de alpha passou')
  const d = (det.divergencias as Array<Record<string, unknown>>)[0]
  ok(d.canal === 'A', `canal ${d.canal}`)
  ok(d.esperado === 255 && d.recebido === 254, `esperado/recebido: ${d.esperado}/${d.recebido}`)
  return `alpha 255→254 em (${x},${y}) → reprovado`
})

teste('cada canal isoladamente reprova (R, G, B, A)', () => {
  const canais: Array<[0 | 1 | 2 | 3, string]> = [[0, 'R'], [1, 'G'], [2, 'B'], [3, 'A']]
  for (const [idx, nome] of canais) {
    const e = base()
    e.arquivo_producao = mutarPixel(ARTEFATO.png, ITEM_A1.x_px + 20, ITEM_A1.y_px + 20, idx, 1)
    const { c, det } = c17(e)
    ok(!c.ok, `canal ${nome} passou`)
    const d = (det.divergencias as Array<Record<string, unknown>>)[0]
    ok(d.canal === nome, `esperava canal ${nome}, veio ${d.canal}`)
  }
  return '4/4 canais detectados individualmente'
})

teste('uma cópia diferente das demais reprova, e é identificada', () => {
  ok(ITENS_B.length === 3, `esperava 3 cópias de B, veio ${ITENS_B.length}`)
  const alvo = ITENS_B[1] // a do meio
  const e = base()
  e.arquivo_producao = mutarPixel(ARTEFATO.png, alvo.x_px + 3, alvo.y_px + 3, 1, 5)
  const { c, det } = c17(e)
  ok(!c.ok, 'cópia divergente passou')
  ok(det.itens_divergentes === 1, `${det.itens_divergentes} itens divergentes, esperado 1`)
  const d = (det.divergencias as Array<Record<string, unknown>>)[0]
  ok(d.sequencia === alvo.sequencia, `apontou #${d.sequencia}, esperado #${alvo.sequencia}`)
  return `2 cópias íntegras, 1 divergente (#${alvo.sequencia}) — isolada corretamente`
})

// ══════════════════════════════════════════════════════════════════════════
grupo('C17 — geometria e identidade')

teste('arte correta na coordenada errada reprova (só C17 pega)', () => {
  const e = base()
  // A#2 vive em x=26000 µm; deslocar para 27000 mantém margem e espaçamento
  // legais, então nenhuma checagem geométrica reclama — só a comparação de pixels.
  const alvo = e.plano.itens.find(i => i.arte_mestre_id === 'A' && i.x_um === cmParaUm(2.6))
  ok(alvo !== undefined, 'não encontrei a segunda cópia de A')
  alvo!.x_um = cmParaUm(2.7)
  const { r, c, det } = c17(e)
  ok(!c.ok, 'deslocamento passou')
  ok(primeiroMotivo(det) === 'PIXEL_DIVERGENTE', `motivo ${primeiroMotivo(det)}`)
  const outras = r.checagens.filter(x => x.codigo !== 'C17_FIDELIDADE_PIXEL')
  ok(outras.every(x => x.ok),
    `outras checagens também reprovaram: ${outras.filter(x => !x.ok).map(x => x.codigo).join(', ')}`)
  return 'deslocamento de 0,1 cm invisível às 16 checagens anteriores — C17 pega'
})

teste('rotação diferente da registrada reprova (dims coerentes)', () => {
  const e = base()
  const alvo = e.plano.itens.find(i => i.arte_mestre_id === 'D')!
  alvo.rotacao_graus = 0
  alvo.largura_final_um = cmParaUm(4.5)
  alvo.altura_final_um = cmParaUm(1.0)
  const { c, det } = c17(e)
  ok(!c.ok, 'rotação trocada passou')
  ok(primeiroMotivo(det) === 'PIXEL_DIVERGENTE', `motivo ${primeiroMotivo(det)}`)
  return 'plano alega 0°, artefato tem 90° → divergência de pixels'
})

teste('rotação trocada com dims inconsistentes reprova por dimensão', () => {
  const e = base()
  e.plano.itens.find(i => i.arte_mestre_id === 'D')!.rotacao_graus = 0
  const { c, det } = c17(e)
  ok(!c.ok, 'inconsistência passou')
  ok(primeiroMotivo(det) === 'DIMENSAO_INCOMPATIVEL', `motivo ${primeiroMotivo(det)}`)
  return 'região do mestre não bate com a medida declarada no plano'
})

teste('região truncada / clipping reprova', () => {
  const e = base()
  e.plano.itens.find(i => i.arte_mestre_id === 'D')!.x_um = cmParaUm(4.5)
  const { c, det } = c17(e)
  ok(!c.ok, 'região fora do artefato passou')
  ok(primeiroMotivo(det) === 'REGIAO_FORA_DO_ARTEFATO', `motivo ${primeiroMotivo(det)}`)
  return 'recorte além da borda não é lido como zero — é reprovado'
})

teste('mestre trocado depois da aprovação reprova em C17 (SHA reconferido aqui)', () => {
  const e = base()
  const m = e.mestres.find(x => x.arte_mestre_id === 'A')!
  m.bytes = gerarPng(cmParaPx(1.8, DPI), cmParaPx(2.5, DPI), { padrao: 'gradiente', semente: 99 })
  const { c, det } = c17(e)
  ok(!c.ok, 'troca de mestre passou')
  ok(primeiroMotivo(det) === 'MESTRE_SHA_DIVERGENTE', `motivo ${primeiroMotivo(det)}`)
  return 'C17 não delega a verificação de SHA para C16'
})

teste('ARTE REGENERADA com metadados idênticos: C16 aprova, só C17 pega', () => {
  const e = base()
  // Mesma dimensão, mesmo DPI, mesmo colorType — pixels diferentes.
  // (O tamanho do arquivo muda porque o deflate depende do conteúdo; o que o
  // cenário exige é que os METADADOS sejam indistinguíveis.)
  const regenerada = gerarPng(cmParaPx(1.8, DPI), cmParaPx(2.5, DPI), { padrao: 'gradiente', semente: 42 })
  const shaNovo = sha256Hex(regenerada)
  const mdOriginal = lerMetadadosPng(A.bytes).metadados!
  const mdRegenerada = lerMetadadosPng(regenerada).metadados!
  ok(mdOriginal.largura_px === mdRegenerada.largura_px &&
     mdOriginal.altura_px === mdRegenerada.altura_px &&
     mdOriginal.dpi_x === mdRegenerada.dpi_x &&
     mdOriginal.tipo_cor === mdRegenerada.tipo_cor,
    'cenário inválido: os metadados diferem, então não é uma regeneração disfarçada')
  ok(shaNovo !== A.sha, 'cenário inválido: os bytes não mudaram')

  // O registro foi atualizado para a arte regenerada (coerente consigo mesmo),
  // mas o ARTEFATO foi materializado a partir da arte anterior.
  const m = e.mestres.find(x => x.arte_mestre_id === 'A')!
  m.bytes = regenerada
  m.sha256_registrado = shaNovo
  for (const it of e.plano.itens) if (it.arte_mestre_id === 'A') it.sha256 = shaNovo

  const { r, c, det } = c17(e)
  const c16 = r.checagens.find(x => x.codigo === 'C16_FIDELIDADE_SHA256')!
  ok(c16.ok, 'C16 deveria aprovar: o registro é coerente consigo mesmo')
  ok(!c.ok, 'C17 deixou passar arte regenerada')
  ok(primeiroMotivo(det) === 'PIXEL_DIVERGENTE', `motivo ${primeiroMotivo(det)}`)
  ok(!r.aprovado, 'pré-flight aprovou artefato com arte regenerada')
  return 'metadados indistinguíveis e SHA coerente — e ainda assim reprovado'
})

teste('mestre não registrado reprova', () => {
  const e = base()
  e.mestres = e.mestres.filter(m => m.arte_mestre_id !== 'D')
  const { c, det } = c17(e)
  ok(!c.ok, 'mestre ausente passou')
  ok(primeiroMotivo(det) === 'MESTRE_NAO_REGISTRADO', `motivo ${primeiroMotivo(det)}`)
  return 'instância sem mestre correspondente não é ignorada'
})

teste('artefato ilegível reprova', () => {
  const e = base()
  e.arquivo_producao = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const { c, det } = c17(e)
  ok(!c.ok, 'artefato ilegível passou')
  ok(primeiroMotivo(det) === 'ARTEFATO_ILEGIVEL', `motivo ${primeiroMotivo(det)}`)
  return 'não há caminho que aprove sem ler os pixels'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('C17 — múltiplas páginas')

teste('cada página é verificada contra o seu próprio artefato', () => {
  const midia = { largura_util_cm: 5, dpi: DPI, comprimento_max_cm: 10 }
  const plano = montarGangSheet({
    midia, layout: { ...LAYOUT },
    pecas: [{
      arte_mestre_id: 'A', versao: 1, sha256: A.sha,
      largura_cm: 1.8, altura_cm: 2.5, quantidade: 12, rotacao_permitida: false,
    }],
  })
  ok(plano.paginas.length > 1, 'esperava múltiplas páginas')

  const notas: string[] = []
  for (const p of plano.paginas) {
    const art = renderizarGangSheet({
      plano, midia, layout: { ...LAYOUT },
      mestres: [{
        arte_mestre_id: 'A', versao: 1, sha256_registrado: A.sha,
        bytes: A.bytes.slice(), largura_cm: 1.8, altura_cm: 2.5,
      }],
      pagina: p.pagina,
    })
    const e: EntradaPreflight = {
      arquivo_producao: art.png, midia, layout: { ...LAYOUT },
      plano: { itens: plano.itens, paginas: plano.paginas, area_util_pct: plano.area_util_pct },
      mestres: [{
        arte_mestre_id: 'A', versao: 1, sha256_registrado: A.sha, bytes: A.bytes.slice(),
        largura_cm: 1.8, altura_cm: 2.5, rotacao_permitida: false, quantidade_solicitada: 12,
      }],
      pagina_referencia: p.pagina,
    }
    const { c, det } = c17(e)
    ok(c.ok, `página ${p.pagina} reprovou: ${JSON.stringify(det).slice(0, 160)}`)
    notas.push(`p${p.pagina}:${det.itens_verificados}`)

    // E a mesma página, corrompida, reprova.
    const alvo = art.itens[0]
    e.arquivo_producao = mutarPixel(art.png, alvo.x_px + 2, alvo.y_px + 2, 2, 3)
    ok(!c17(e).c.ok, `página ${p.pagina} corrompida passou`)
  }
  return `${plano.paginas.length} páginas · itens verificados ${notas.join(' · ')} · corrupção pega em ambas`
})

// ══════════════════════════════════════════════════════════════════════════
grupo('C17 — independência, determinismo e ausência de IA/rede')

teste('preflight.ts não importa o renderizador nem o motor', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const texto = readFileSync(join(aqui, '..', 'src', 'preflight.ts'), 'utf8')
  ok(!/from\s+['"][^'"]*renderizador/.test(texto), 'pré-flight importa o renderizador')
  ok(!/from\s+['"][^'"]*motor-gang-sheet/.test(texto), 'pré-flight importa o motor')
  ok(/C17_FIDELIDADE_PIXEL/.test(texto), 'C17 não está implementada em preflight.ts')
  return 'validador independente do gerador e do renderizador'
})

teste('C17 não usa o hash do renderizador como substituto', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const texto = readFileSync(join(aqui, '..', 'src', 'preflight.ts'), 'utf8')
  ok(!/sha256_raster|manifesto_hash|sha256_arquivo/.test(texto),
    'pré-flight referencia hashes produzidos pelo renderizador')
  // E, de fato, os campos do artefato não entram na entrada do pré-flight.
  const e = base() as unknown as Record<string, unknown>
  ok(!('sha256_raster' in e) && !('manifesto_hash' in e), 'entrada carrega hash do renderizador')
  return 'comparação é feita nos pixels, não em hash de terceiro'
})

teste('10 execuções do pré-flight produzem resultado idêntico', () => {
  const saidas = new Set<string>()
  for (let i = 0; i < 10; i++) {
    const r = executarPreflight(base())
    saidas.add(canonicalizar(r.checagens.map(c => ({ codigo: c.codigo, ok: c.ok }))))
  }
  ok(saidas.size === 1, `${saidas.size} resultados distintos`)
  return '10 execuções · 1 resultado'
})

teste('nenhuma chamada de rede durante o pré-flight', () => {
  const originalFetch = globalThis.fetch
  let chamadas = 0
  // @ts-ignore — instrumentação intencional
  globalThis.fetch = () => { chamadas++; throw new Error('rede proibida no pré-flight') }
  try {
    for (let i = 0; i < 5; i++) executarPreflight(base())
  } finally {
    // @ts-ignore
    globalThis.fetch = originalFetch
  }
  ok(chamadas === 0, `houve ${chamadas} chamada(s) de rede`)
  return '5 execuções · 0 chamadas de rede'
})

teste('pré-flight não consulta relógio nem aleatoriedade', () => {
  const dateNow = Date.now
  const random = Math.random
  let usos = 0
  Date.now = () => { usos++; return 0 }
  Math.random = () => { usos++; return 0 }
  try {
    executarPreflight(base())
  } finally {
    Date.now = dateNow
    Math.random = random
  }
  ok(usos === 0, `houve ${usos} uso(s) de relógio/aleatoriedade`)
  return 'sem Date.now, sem Math.random'
})
