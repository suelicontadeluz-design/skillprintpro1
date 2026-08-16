// ─── Suíte de testes da pré-impressão ──────────────────────────────────────
// Execução:  node --experimental-strip-types preimpressao/tests/run.ts
// Sem dependências externas. Sem rede. Sem IA.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { montarGangSheet } from '../src/motor-gang-sheet.ts'
import { executarPreflight } from '../src/preflight.ts'
import { ErroPreImpressao } from '../src/erros.ts'
import { canonicalizar, hashCanonico, sha256Hex } from '../src/canonico.ts'
import {
  TOL_PX, TOL_UM,
  cmParaPx, cmParaPxExato, cmParaUm, desvioArredondamentoUm, pxParaCm, umParaCm,
} from '../src/unidades.ts'
import { lerMetadadosPng } from '../src/metadados-png.ts'
import { gerarPng, corromper } from '../testkit/png-sintetico.ts'
import type { EntradaMontagem, EntradaPreflight, ItemGangSheet } from '../src/tipos.ts'

// ── Micro-harness ─────────────────────────────────────────────────────────

interface Resultado { nome: string; ok: boolean; erro?: string; nota?: string }
const resultados: Resultado[] = []
let grupoAtual = ''

function grupo(nome: string): void {
  grupoAtual = nome
  console.log(`\n── ${nome} ${'─'.repeat(Math.max(0, 68 - nome.length))}`)
}

function teste(nome: string, fn: () => string | void): void {
  try {
    const nota = fn()
    resultados.push({ nome: `${grupoAtual} :: ${nome}`, ok: true, nota: nota ?? undefined })
    console.log(`  ✓ ${nome}${nota ? `  — ${nota}` : ''}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    resultados.push({ nome: `${grupoAtual} :: ${nome}`, ok: false, erro: msg })
    console.log(`  ✗ ${nome}\n      ${msg}`)
  }
}

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function igual(a: unknown, b: unknown, msg: string): void {
  if (canonicalizar(a) !== canonicalizar(b)) {
    throw new Error(`${msg}\n      esperado: ${canonicalizar(b)}\n      recebido: ${canonicalizar(a)}`)
  }
}

function lancaCodigo(codigo: string, fn: () => unknown): ErroPreImpressao {
  try {
    fn()
  } catch (e) {
    if (e instanceof ErroPreImpressao) {
      if (e.codigo !== codigo) throw new Error(`esperava código ${codigo}, veio ${e.codigo} (${e.message})`)
      return e
    }
    throw new Error(`esperava ErroPreImpressao(${codigo}), veio ${String(e)}`)
  }
  throw new Error(`esperava ErroPreImpressao(${codigo}), mas nada foi lançado`)
}

// ── Cenário padrão ────────────────────────────────────────────────────────
//
// Mídia pequena de propósito: os testes de arquivo precisam materializar PNGs
// reais. A prova de que a referência DTF 57×100 cm bate em pixels é feita
// aritmeticamente no grupo "Unidades", sem gerar 318 MB de imagem.

const MIDIA = { largura_util_cm: 5, dpi: 300, comprimento_max_cm: 20 }
const LAYOUT = { margem_cm: 0.5, espacamento_cm: 0.3 }

const BYTES_A = gerarPng(cmParaPx(1.8, 300), cmParaPx(2.5, 300))
const SHA_A = sha256Hex(BYTES_A)
const BYTES_B = gerarPng(cmParaPx(1.2, 300), cmParaPx(1.0, 300))
const SHA_B = sha256Hex(BYTES_B)

function entradaPadrao(): EntradaMontagem {
  return {
    midia: { ...MIDIA },
    layout: { ...LAYOUT },
    pecas: [{
      arte_mestre_id: 'A', versao: 1, sha256: SHA_A,
      largura_cm: 1.8, altura_cm: 2.5, quantidade: 3, rotacao_permitida: false,
    }],
  }
}

const PLANO_PADRAO = montarGangSheet(entradaPadrao())

function preflightPadrao(): EntradaPreflight {
  const compCm = umParaCm(PLANO_PADRAO.paginas[0].comprimento_utilizado_um)
  return {
    arquivo_producao: gerarPng(cmParaPx(MIDIA.largura_util_cm, 300), cmParaPx(compCm, 300)),
    midia: { ...MIDIA },
    layout: { ...LAYOUT },
    plano: {
      itens: structuredClone(PLANO_PADRAO.itens),
      paginas: structuredClone(PLANO_PADRAO.paginas),
      area_util_pct: PLANO_PADRAO.area_util_pct,
    },
    mestres: [{
      arte_mestre_id: 'A', versao: 1, sha256_registrado: SHA_A, bytes: BYTES_A.slice(),
      largura_cm: 1.8, altura_cm: 2.5, rotacao_permitida: false, quantidade_solicitada: 3,
    }],
  }
}

function checagem(r: ReturnType<typeof executarPreflight>, codigo: string) {
  const c = r.checagens.find(x => x.codigo === codigo)
  if (!c) throw new Error(`checagem ${codigo} não foi executada`)
  return c
}

/** Confirma que a checagem alvo reprovou. */
function reprova(entrada: EntradaPreflight, codigo: string): string {
  const r = executarPreflight(entrada)
  const c = checagem(r, codigo)
  ok(!c.ok, `${codigo} deveria ter reprovado, mas passou`)
  ok(!r.aprovado, 'pré-flight deveria estar reprovado no geral')
  return `detectado: ${JSON.stringify(c.detalhe).slice(0, 90)}`
}

// ══════════════════════════════════════════════════════════════════════════
grupo('Unidades e tolerância cm ↔ px (documentada)')

teste('57 cm @ 300 DPI → 6732 px, desvio dentro da tolerância', () => {
  const exato = cmParaPxExato(57, 300)
  const px = cmParaPx(57, 300)
  const volta = pxParaCm(px, 300)
  const desvio = desvioArredondamentoUm(57, 300)
  ok(Math.abs(exato - 6732.283464566929) < 1e-9, `exato inesperado: ${exato}`)
  ok(px === 6732, `esperava 6732 px, veio ${px}`)
  ok(desvio <= TOL_UM, `desvio ${desvio} µm excede TOL_UM ${TOL_UM}`)
  return `6732 px = ${volta.toFixed(4)} cm, desvio ${desvio} µm (tol ${TOL_UM} µm)`
})

teste('100 cm @ 300 DPI → 11811 px, desvio dentro da tolerância', () => {
  const px = cmParaPx(100, 300)
  const desvio = desvioArredondamentoUm(100, 300)
  ok(px === 11811, `esperava 11811 px, veio ${px}`)
  ok(desvio <= TOL_UM, `desvio ${desvio} µm excede TOL_UM`)
  return `11811 px = ${pxParaCm(11811, 300).toFixed(4)} cm, desvio ${desvio} µm`
})

teste('tolerâncias são constantes exportadas, não números mágicos', () => {
  ok(TOL_PX === 1 && TOL_UM === 100, 'tolerâncias mudaram sem atualizar a documentação')
  return `TOL_PX=${TOL_PX} px · TOL_UM=${TOL_UM} µm (0,1 mm)`
})

teste('largura da mídia é parâmetro: nenhum 57/60 codificado no motor', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const src = join(aqui, '..', 'src')
  const suspeitos: string[] = []
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.ts')) continue
    const texto = readFileSync(join(src, f), 'utf8')
    const codigo = texto.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n')
    if (/(^|[^\w.])(57|60)(\.\d+)?([^\w]|$)/.test(codigo)) suspeitos.push(f)
  }
  ok(suspeitos.length === 0, `largura física aparece em: ${suspeitos.join(', ')}`)
  return 'nenhuma largura física literal no código de produção'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Determinismo')

teste('mesma entrada executada 100 vezes = mesmo resultado_hash', () => {
  const hashes = new Set<string>()
  const params = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const r = montarGangSheet(entradaPadrao())
    hashes.add(r.resultado_hash)
    params.add(r.parametros_hash)
  }
  ok(hashes.size === 1, `esperava 1 hash distinto, veio ${hashes.size}`)
  ok(params.size === 1, `esperava 1 parametros_hash, veio ${params.size}`)
  return `100 execuções → ${[...hashes][0].slice(0, 16)}…`
})

teste('entrada embaralhada = mesmo resultado_hash e mesmas colocações', () => {
  const base: EntradaMontagem = {
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 2, rotacao_permitida: false },
      { arte_mestre_id: 'B', versao: 2, sha256: SHA_B, largura_cm: 1.2, altura_cm: 1.0, quantidade: 4, rotacao_permitida: false },
      { arte_mestre_id: 'C', versao: 1, sha256: SHA_B, largura_cm: 0.9, altura_cm: 3.1, quantidade: 3, rotacao_permitida: false },
    ],
  }
  const referencia = montarGangSheet(base)

  const permutacoes = [
    [0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1],
  ]
  for (const p of permutacoes) {
    const embaralhada: EntradaMontagem = {
      midia: { ...MIDIA }, layout: { ...LAYOUT },
      pecas: p.map(i => ({ ...base.pecas[i] })),
    }
    const r = montarGangSheet(embaralhada)
    ok(r.resultado_hash === referencia.resultado_hash,
      `permutação ${p.join('')} mudou o hash`)
    igual(r.itens, referencia.itens, `permutação ${p.join('')} mudou as colocações`)
  }
  return `${permutacoes.length} permutações → hash idêntico ${referencia.resultado_hash.slice(0, 16)}…`
})

teste('peças idênticas fundidas: [A×2, A×3] ≡ [A×5]', () => {
  const separada = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 2, rotacao_permitida: false },
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 3, rotacao_permitida: false },
    ],
  })
  const junta = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 5, rotacao_permitida: false },
    ],
  })
  ok(separada.resultado_hash === junta.resultado_hash, 'fusão de peças idênticas não é neutra')
  return `ambas → ${junta.resultado_hash.slice(0, 16)}…`
})

teste('canonicalização é estável sob ordem de chaves', () => {
  const a = { z: 1, a: { y: 2, b: 3 }, m: [3, 1, 2] }
  const b = { a: { b: 3, y: 2 }, m: [3, 1, 2], z: 1 }
  ok(hashCanonico(a) === hashCanonico(b), 'ordem de chaves alterou o hash')
  ok(hashCanonico({ n: 1 }) !== hashCanonico({ n: 1.0000001 }), 'números distintos colidiram')
  return canonicalizar(a)
})

teste('canonicalização rejeita NaN/Infinity/undefined em vez de silenciar', () => {
  let erros = 0
  for (const v of [{ x: NaN }, { x: Infinity }, { x: undefined }]) {
    try { canonicalizar(v) } catch { erros++ }
  }
  ok(erros === 3, `esperava 3 rejeições, veio ${erros}`)
  return 'NaN, Infinity e undefined rejeitados'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Fidelidade — 1 mestre × N cópias')

teste('N cópias carregam um único SHA-256, igual ao do mestre', () => {
  const r = montarGangSheet(entradaPadrao())
  const shas = new Set(r.itens.map(i => i.sha256))
  ok(r.itens.length === 3, `esperava 3 cópias, veio ${r.itens.length}`)
  ok(shas.size === 1, `esperava 1 SHA distinto, veio ${shas.size}`)
  ok([...shas][0] === SHA_A, 'SHA das cópias diverge do mestre')
  return `3 cópias · 1 SHA · ${SHA_A.slice(0, 16)}…`
})

teste('todas as cópias apontam para o mesmo (id, versão)', () => {
  const r = montarGangSheet(entradaPadrao())
  const chaves = new Set(r.itens.map(i => `${i.arte_mestre_id}|${i.versao}`))
  ok(chaves.size === 1, `esperava 1 mestre, veio ${chaves.size}`)
  const indices = r.itens.map(i => i.indice_copia).sort((a, b) => a - b)
  igual(indices, [1, 2, 3], 'índices de cópia inconsistentes')
  return 'cópias 1..3 do mesmo mestre'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Zero IA na montagem')

teste('grafo de imports do código de produção só contém locais + node:crypto', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const src = join(aqui, '..', 'src')
  const permitidos = new Set(['node:crypto'])
  const violacoes: string[] = []
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.ts')) continue
    const texto = readFileSync(join(src, f), 'utf8')
    for (const m of texto.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const esp = m[1]
      if (esp.startsWith('./') || esp.startsWith('../')) continue
      if (!permitidos.has(esp)) violacoes.push(`${f} → ${esp}`)
    }
  }
  ok(violacoes.length === 0, `imports não permitidos: ${violacoes.join(', ')}`)
  return 'apenas módulos locais + node:crypto'
})

teste('nenhum vestígio de rede ou SDK de modelo no código de produção', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const src = join(aqui, '..', 'src')
  const proibido = /\b(fetch|XMLHttpRequest|WebSocket|axios|openai|anthropic|node:http|node:https|https?:\/\/)/i
  const violacoes: string[] = []
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.ts')) continue
    const linhas = readFileSync(join(src, f), 'utf8').split('\n')
    linhas.forEach((l, n) => {
      if (l.trimStart().startsWith('//') || l.trimStart().startsWith('*')) return
      if (proibido.test(l)) violacoes.push(`${f}:${n + 1}`)
    })
  }
  ok(violacoes.length === 0, `vestígios de rede em: ${violacoes.join(', ')}`)
  return 'nenhuma primitiva de rede no caminho de produção'
})

teste('em runtime, a montagem não faz nenhuma chamada de rede', () => {
  const originalFetch = globalThis.fetch
  let chamadas = 0
  // @ts-ignore — substituição intencional para instrumentar
  globalThis.fetch = (...args: unknown[]) => { chamadas++; throw new Error('rede proibida na montagem') }
  try {
    for (let i = 0; i < 10; i++) montarGangSheet(entradaPadrao())
  } finally {
    // @ts-ignore
    globalThis.fetch = originalFetch
  }
  ok(chamadas === 0, `houve ${chamadas} chamada(s) de rede`)
  return '10 montagens · 0 chamadas de rede'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Geometria — sobreposição, deformação, escala')

teste('nenhuma sobreposição entre cópias', () => {
  const r = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 7, rotacao_permitida: false },
      { arte_mestre_id: 'B', versao: 1, sha256: SHA_B, largura_cm: 1.2, altura_cm: 1.0, quantidade: 9, rotacao_permitida: false },
    ],
  })
  let pares = 0
  for (let a = 0; a < r.itens.length; a++) {
    for (let b = a + 1; b < r.itens.length; b++) {
      const A = r.itens[a], B = r.itens[b]
      if (A.pagina !== B.pagina) continue
      pares++
      const ix = Math.min(A.x_um + A.largura_final_um, B.x_um + B.largura_final_um) - Math.max(A.x_um, B.x_um)
      const iy = Math.min(A.y_um + A.altura_final_um, B.y_um + B.altura_final_um) - Math.max(A.y_um, B.y_um)
      ok(!(ix > 0 && iy > 0), `sobreposição entre #${A.sequencia} e #${B.sequencia}`)
    }
  }
  return `${r.itens.length} cópias · ${pares} pares verificados · 0 interseções`
})

teste('nenhuma deformação: medidas idênticas ao mestre e escala 1.0', () => {
  const r = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 4, rotacao_permitida: false },
    ],
  })
  const w = cmParaUm(1.8), h = cmParaUm(2.5)
  for (const i of r.itens) {
    ok(i.escala === 1, `escala != 1 em #${i.sequencia}`)
    ok(i.largura_final_um === w && i.altura_final_um === h,
      `medida alterada em #${i.sequencia}: ${i.largura_final_um}×${i.altura_final_um}`)
  }
  return `4 cópias · todas ${w}×${h} µm · escala 1.0`
})

teste('espaçamento e margem respeitados na saída do motor', () => {
  const r = montarGangSheet(entradaPadrao())
  const margem = cmParaUm(LAYOUT.margem_cm)
  const esp = cmParaUm(LAYOUT.espacamento_cm)
  for (const i of r.itens) {
    ok(i.x_um >= margem && i.y_um >= margem, `#${i.sequencia} invade a margem`)
    ok(i.x_um + i.largura_final_um <= cmParaUm(MIDIA.largura_util_cm) - margem,
      `#${i.sequencia} ultrapassa a margem direita`)
  }
  const p0 = r.paginas[0]
  ok(p0.comprimento_utilizado_um === 63000,
    `comprimento esperado 63000 µm, veio ${p0.comprimento_utilizado_um}`)
  return `comprimento 6,3 cm · margem ${margem} µm · espaçamento ${esp} µm`
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Falhas explícitas — o motor nunca conserta em silêncio')

teste('medida ausente (null) = rejeição MEDIDA_AUSENTE', () => {
  const e = lancaCodigo('MEDIDA_AUSENTE', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: null, altura_cm: 2.5, quantidade: 1, rotacao_permitida: false }],
  }))
  return e.message
})

teste('medida ausente (undefined) = rejeição MEDIDA_AUSENTE', () => {
  lancaCodigo('MEDIDA_AUSENTE', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: undefined, quantidade: 1, rotacao_permitida: false }],
  }))
  return 'altura undefined rejeitada — nada é presumido'
})

teste('medida zero/negativa = rejeição MEDIDA_NAO_POSITIVA', () => {
  lancaCodigo('MEDIDA_NAO_POSITIVA', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 0, altura_cm: 2.5, quantidade: 1, rotacao_permitida: false }],
  }))
  return 'largura 0 rejeitada'
})

teste('arte maior que a mídia = rejeição, JAMAIS redução automática', () => {
  const e = lancaCodigo('ARTE_NAO_CABE_NA_LARGURA', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 10, altura_cm: 2.5, quantidade: 1, rotacao_permitida: false }],
  }))
  ok(e.detalhe.largura_um === 100000, 'detalhe não informa a largura ofensora')
  return `10 cm em 5 cm de mídia → ${e.codigo}`
})

teste('arte mais alta que o comprimento máximo = rejeição', () => {
  lancaCodigo('ARTE_NAO_CABE_NO_COMPRIMENTO', () => montarGangSheet({
    midia: { ...MIDIA, comprimento_max_cm: 4 }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 3.5, quantidade: 1, rotacao_permitida: false }],
  }))
  return 'altura 3,5 cm + margens 1,0 cm > 4 cm → rejeitado'
})

teste('SHA-256 inválido = rejeição', () => {
  lancaCodigo('SHA256_INVALIDO', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: 'nao-e-hash', largura_cm: 1.8, altura_cm: 2.5, quantidade: 1, rotacao_permitida: false }],
  }))
  return 'mestre sem hash válido não entra na montagem'
})

teste('quantidade não inteira/positiva = rejeição', () => {
  lancaCodigo('QUANTIDADE_INVALIDA', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 2.5, rotacao_permitida: false }],
  }))
  return 'quantidade 2,5 rejeitada'
})

teste('margem maior que a mídia = rejeição', () => {
  lancaCodigo('MARGEM_MAIOR_QUE_MIDIA', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { margem_cm: 3, espacamento_cm: 0.3 },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 1, rotacao_permitida: false }],
  }))
  return 'margens 2×3 cm em mídia de 5 cm → rejeitado'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Rotação')

teste('rotação proibida: nunca rotaciona, mesmo que rotacionar resolvesse', () => {
  // 4,5 × 1,0 cm não cabe nos 4,0 cm disponíveis em 0°. Rotacionada caberia.
  const e = lancaCodigo('ARTE_NAO_CABE_NA_LARGURA', () => montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 4.5, altura_cm: 1.0, quantidade: 1, rotacao_permitida: false }],
  }))
  ok(e.detalhe.rotacao_permitida === false, 'detalhe deveria registrar a proibição')
  return 'preferiu falhar a rotacionar sem permissão'
})

teste('rotação permitida: usa 90° só quando 0° não cabe', () => {
  const r = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 4.5, altura_cm: 1.0, quantidade: 1, rotacao_permitida: true }],
  })
  ok(r.itens[0].rotacao_graus === 90, `esperava 90°, veio ${r.itens[0].rotacao_graus}°`)
  ok(r.itens[0].largura_final_um === cmParaUm(1.0) && r.itens[0].altura_final_um === cmParaUm(4.5),
    'dimensões não foram trocadas na rotação')
  return '4,5×1,0 → 90° → 1,0×4,5 (sem deformar)'
})

teste('rotação permitida mas desnecessária: mantém 0°', () => {
  const r = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 2, rotacao_permitida: true }],
  })
  ok(r.itens.every(i => i.rotacao_graus === 0), '0° deveria ser preferida')
  return 'todas em 0° — rotação não é usada por conveniência'
})

teste('ângulos possíveis são exatamente {0, 90}', () => {
  const r = montarGangSheet({
    midia: { ...MIDIA }, layout: { ...LAYOUT },
    pecas: [
      { arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 4.5, altura_cm: 1.0, quantidade: 2, rotacao_permitida: true },
      { arte_mestre_id: 'B', versao: 1, sha256: SHA_B, largura_cm: 1.2, altura_cm: 1.0, quantidade: 2, rotacao_permitida: false },
    ],
  })
  ok(r.itens.every(i => i.rotacao_graus === 0 || i.rotacao_graus === 90), 'ângulo fora de {0,90}')
  return 'nenhum ângulo arbitrário'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Extrator de metadados PNG')

teste('lê largura, altura, DPI e alfa de um PNG real', () => {
  const png = gerarPng(591, 744, { dpi: 300 })
  const r = lerMetadadosPng(png)
  ok(r.ok && r.metadados !== null, `leitura falhou: ${r.erro}`)
  const m = r.metadados!
  ok(m.largura_px === 591 && m.altura_px === 744, `dimensões erradas: ${m.largura_px}×${m.altura_px}`)
  ok(m.tem_alpha, 'alfa não detectado em RGBA')
  ok(m.dpi_x !== null && Math.abs(m.dpi_x - 300) < 0.05, `DPI errado: ${m.dpi_x}`)
  return `591×744 · DPI ${m.dpi_x!.toFixed(4)} · alfa presente`
})

teste('detecta arquivo corrompido pelo CRC-32', () => {
  const r = lerMetadadosPng(corromper(gerarPng(100, 100)))
  ok(!r.ok, 'corrupção passou despercebida')
  return r.erro ?? ''
})

teste('detecta ausência de alfa (RGB puro)', () => {
  const r = lerMetadadosPng(gerarPng(100, 100, { tipo_cor: 2 }))
  ok(r.ok && r.metadados!.tem_alpha === false, 'RGB foi tratado como tendo alfa')
  return 'colorType 2 → sem alfa'
})

teste('detecta ausência de pHYs (DPI desconhecido)', () => {
  const r = lerMetadadosPng(gerarPng(100, 100, { dpi: null }))
  ok(r.ok && r.metadados!.dpi_x === null, 'DPI foi inventado')
  return 'sem pHYs → dpi null, nunca presumido'
})

teste('rejeita entrada que não é PNG', () => {
  const r = lerMetadadosPng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))
  ok(!r.ok, 'lixo foi aceito como PNG')
  return r.erro ?? ''
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Pré-flight — caso feliz')

teste('plano íntegro é aprovado nas 16 checagens', () => {
  const r = executarPreflight(preflightPadrao())
  ok(r.checagens.length === 16, `esperava 16 checagens, veio ${r.checagens.length}`)
  ok(r.aprovado, `reprovado: ${r.motivos.join(' | ')}`)
  return `16/16 aprovadas · área útil ${PLANO_PADRAO.area_util_pct.toFixed(2)}%`
})

teste('pré-flight não importa o motor (independência estrutural)', () => {
  const aqui = dirname(fileURLToPath(import.meta.url))
  const texto = readFileSync(join(aqui, '..', 'src', 'preflight.ts'), 'utf8')
  ok(!/from\s+['"][^'"]*motor-gang-sheet/.test(texto), 'pré-flight importa o motor')
  return 'validador não conhece o gerador'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Pré-flight — cada uma das 16 checagens reprova quando deve')

teste('C01 arquivo inválido', () => {
  const e = preflightPadrao()
  e.arquivo_producao = corromper(e.arquivo_producao)
  return reprova(e, 'C01_INTEGRIDADE_ARQUIVO')
})

teste('C02 dimensão em pixels divergente', () => {
  const e = preflightPadrao()
  e.arquivo_producao = gerarPng(600, 744, { dpi: 300 })
  return reprova(e, 'C02_DIMENSAO_PX')
})

teste('C03 DPI ausente/errado', () => {
  const e = preflightPadrao()
  e.arquivo_producao = gerarPng(591, 744, { dpi: null })
  return reprova(e, 'C03_DPI')
})

teste('C04 dimensão física divergente (px certo, DPI mentindo)', () => {
  const e = preflightPadrao()
  e.arquivo_producao = gerarPng(591, 744, { dpi: 150 })
  const r = executarPreflight(e)
  ok(checagem(r, 'C02_DIMENSAO_PX').ok, 'C02 deveria passar: os pixels estão certos')
  ok(!checagem(r, 'C04_DIMENSAO_FISICA').ok, 'C04 deveria reprovar')
  return 'C02 passa, C04 reprova — derivações independentes'
})

teste('C05 sem transparência', () => {
  const e = preflightPadrao()
  e.arquivo_producao = gerarPng(591, 744, { tipo_cor: 2, dpi: 300 })
  return reprova(e, 'C05_TRANSPARENCIA')
})

teste('C06 quantidade divergente', () => {
  const e = preflightPadrao()
  e.mestres[0].quantidade_solicitada = 5
  return reprova(e, 'C06_QUANTIDADE')
})

teste('C07 escala diferente de 1.0', () => {
  const e = preflightPadrao()
  e.plano.itens[0].escala = 0.9 as unknown as 1
  return reprova(e, 'C07_ESCALA')
})

teste('C08 deformação (proporção alterada)', () => {
  const e = preflightPadrao()
  e.plano.itens[0].largura_final_um = 17000
  return reprova(e, 'C08_PROPORCAO')
})

teste('C09 espaçamento insuficiente', () => {
  const e = preflightPadrao()
  const a = e.plano.itens[0]
  e.plano.itens[1].x_um = a.x_um + a.largura_final_um + 1000 // 0,1 cm < 0,3 cm
  const r = executarPreflight(e)
  ok(!checagem(r, 'C09_ESPACAMENTO').ok, 'C09 deveria reprovar')
  ok(checagem(r, 'C12_SOBREPOSICAO').ok, 'não deveria haver sobreposição neste caso')
  return 'folga 1000 µm < 3000 µm exigidos, sem sobreposição'
})

teste('C10 invasão de margem', () => {
  const e = preflightPadrao()
  e.plano.itens[0].x_um = 0
  return reprova(e, 'C10_MARGEM')
})

teste('C11 clipping na borda da mídia', () => {
  const e = preflightPadrao()
  e.plano.itens[0].x_um = 49000 // 49000 + 18000 = 67000 > 50000
  return reprova(e, 'C11_CLIPPING')
})

teste('C12 sobreposição', () => {
  const e = preflightPadrao()
  e.plano.itens[1].x_um = e.plano.itens[0].x_um
  e.plano.itens[1].y_um = e.plano.itens[0].y_um
  return reprova(e, 'C12_SOBREPOSICAO')
})

teste('C13 rotação não permitida', () => {
  const e = preflightPadrao()
  e.plano.itens[0].rotacao_graus = 90
  return reprova(e, 'C13_ROTACAO')
})

teste('C14 comprimento acima do máximo', () => {
  const e = preflightPadrao()
  e.midia.comprimento_max_cm = 5 // página usa 6,3 cm
  return reprova(e, 'C14_COMPRIMENTO')
})

teste('C15 área útil declarada divergente', () => {
  const e = preflightPadrao()
  e.plano.area_util_pct = 99
  return reprova(e, 'C15_AREA_UTIL')
})

teste('C16 bytes do mestre alterados após a aprovação', () => {
  const e = preflightPadrao()
  // O SHA registrado continua o da aprovação; os bytes no storage mudaram.
  e.mestres[0].bytes = gerarPng(cmParaPx(1.8, 300), cmParaPx(2.5, 300), { dpi: 301 })
  const r = executarPreflight(e)
  const c = checagem(r, 'C16_FIDELIDADE_SHA256')
  ok(!c.ok, 'troca de arquivo do mestre passou despercebida')
  ok(!r.aprovado, 'pré-flight deveria reprovar')
  return 'troca silenciosa de arquivo detectada criptograficamente'
})

teste('C16 cópia que não deriva do mestre (regeneração)', () => {
  const e = preflightPadrao()
  e.plano.itens[2].sha256 = SHA_B // uma cópia regenerada
  const r = executarPreflight(e)
  ok(!checagem(r, 'C16_FIDELIDADE_SHA256').ok, 'regeneração de cópia passou')
  return 'cópia com SHA distinto = regeneração detectada'
})

teste('estado "aprovado" não é aceito como prova: só o hash conta', () => {
  const e = preflightPadrao()
  // Simula o registro dizendo "aprovado" enquanto os bytes mudaram.
  const bytesTrocados = gerarPng(cmParaPx(1.8, 300), cmParaPx(2.5, 300), { dpi: 302 })
  e.mestres[0].bytes = bytesTrocados
  ok(sha256Hex(bytesTrocados) !== SHA_A, 'cenário inválido: os bytes não mudaram')
  const r = executarPreflight(e)
  ok(!r.aprovado, 'pré-flight confiou no estado em vez do hash')
  return 'reprovado apesar de "aprovado" no registro'
})

// ══════════════════════════════════════════════════════════════════════════
grupo('Paginação e área')

teste('excedente quebra em páginas respeitando o comprimento máximo', () => {
  const r = montarGangSheet({
    midia: { largura_util_cm: 5, dpi: 300, comprimento_max_cm: 10 },
    layout: { ...LAYOUT },
    pecas: [{ arte_mestre_id: 'A', versao: 1, sha256: SHA_A, largura_cm: 1.8, altura_cm: 2.5, quantidade: 12, rotacao_permitida: false }],
  })
  ok(r.paginas.length > 1, 'esperava mais de uma página')
  for (const p of r.paginas) {
    ok(p.comprimento_utilizado_um <= cmParaUm(10), `página ${p.pagina} excede o máximo`)
  }
  const total = r.paginas.reduce((s, p) => s + p.itens_count, 0)
  ok(total === 12, `esperava 12 itens, veio ${total}`)
  return `${r.paginas.length} páginas · 12 cópias · máx ${Math.max(...r.paginas.map(p => p.comprimento_utilizado_um))} µm`
})

teste('área útil é coerente com a soma das peças', () => {
  const r = montarGangSheet(entradaPadrao())
  const areaPecas = r.itens.reduce((s, i) => s + i.largura_final_um * i.altura_final_um, 0)
  const areaMidia = cmParaUm(MIDIA.largura_util_cm) * r.paginas[0].comprimento_utilizado_um
  const esperado = (areaPecas / areaMidia) * 100
  ok(Math.abs(r.area_util_pct - esperado) < 1e-9, `área divergente: ${r.area_util_pct} vs ${esperado}`)
  return `${r.area_util_pct.toFixed(4)}%`
})

// ══════════════════════════════════════════════════════════════════════════

const falhas = resultados.filter(r => !r.ok)
console.log(`\n${'═'.repeat(72)}`)
console.log(`TOTAL: ${resultados.length}   PASSARAM: ${resultados.length - falhas.length}   FALHARAM: ${falhas.length}`)
if (falhas.length > 0) {
  console.log('\nFALHAS:')
  for (const f of falhas) console.log(`  ✗ ${f.nome}\n      ${f.erro}`)
  process.exit(1)
}
console.log('Todos os testes passaram.')
