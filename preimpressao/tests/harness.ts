// ─── Micro-harness de testes (sem dependências) ────────────────────────────

import { canonicalizar } from '../src/canonico.ts'
import { ErroPreImpressao } from '../src/erros.ts'

interface Resultado { nome: string; ok: boolean; erro?: string; nota?: string }

export const resultados: Resultado[] = []
let grupoAtual = ''

export function grupo(nome: string): void {
  grupoAtual = nome
  console.log(`\n── ${nome} ${'─'.repeat(Math.max(0, 68 - nome.length))}`)
}

export function teste(nome: string, fn: () => string | void): void {
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

export function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

export function igual(a: unknown, b: unknown, msg: string): void {
  if (canonicalizar(a) !== canonicalizar(b)) {
    throw new Error(`${msg}\n      esperado: ${canonicalizar(b)}\n      recebido: ${canonicalizar(a)}`)
  }
}

export function lancaCodigo(codigo: string, fn: () => unknown): ErroPreImpressao {
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

export function resumo(): void {
  const falhas = resultados.filter(r => !r.ok)
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`TOTAL: ${resultados.length}   PASSARAM: ${resultados.length - falhas.length}   FALHARAM: ${falhas.length}`)
  if (falhas.length > 0) {
    console.log('\nFALHAS:')
    for (const f of falhas) console.log(`  ✗ ${f.nome}\n      ${f.erro}`)
    process.exit(1)
  }
  console.log('Todos os testes passaram.')
}
