// ─── Canonicalização + SHA-256 ─────────────────────────────────────────────
//
// A prova de determinismo e a prova de fidelidade dependem de UMA serialização
// canônica: dois objetos semanticamente iguais precisam produzir exatamente o
// mesmo texto, e portanto exatamente o mesmo hash, em qualquer execução e em
// qualquer ordem de construção.
//
// REGRAS
// 1. Chaves de objeto ordenadas por code unit UTF-16 (String.prototype.sort padrão).
// 2. Arrays preservam a ordem (a ordem de um array É informação).
// 3. `undefined` e funções são rejeitados — silenciá-los esconderia divergência.
// 4. Números:
//      - NaN / Infinity → erro (nunca viram "null" silencioso como no JSON.stringify)
//      - inteiro seguro → String(n)              ex.: 6732
//      - demais         → toExponential(16)      ex.: 4.2857142857142854e+1
//    17 dígitos significativos identificam unicamente qualquer double IEEE-754,
//    portanto a serialização é SEM PERDA: dois números diferentes nunca produzem
//    o mesmo texto. Uma versão anterior usava toFixed(6), que colapsava
//    1.0000001 sobre 1 e permitia colisão de hash entre resultados distintos.
//    Isso também remove a dependência da "representação decimal mais curta" do
//    runtime, a única parte de JSON.stringify que poderia variar de plataforma.
// 5. Strings via JSON.stringify (escape padrão, já determinístico).

import { createHash } from 'node:crypto'

function numeroCanonico(n: number): string {
  if (!Number.isFinite(n)) {
    throw new TypeError(`Número não finito não é canonicalizável: ${String(n)}`)
  }
  if (Object.is(n, -0)) return '0'
  if (Number.isInteger(n) && Math.abs(n) < 1e21) {
    // String() de inteiro abaixo de 1e21 nunca usa notação exponencial.
    return String(n)
  }
  // 1 dígito + 16 casas = 17 significativos → round-trip exato de qualquer double.
  return n.toExponential(16)
}

export function canonicalizar(valor: unknown): string {
  if (valor === null) return 'null'

  const tipo = typeof valor
  if (tipo === 'boolean') return valor ? 'true' : 'false'
  if (tipo === 'number') return numeroCanonico(valor as number)
  if (tipo === 'string') return JSON.stringify(valor)
  if (tipo === 'bigint') return `"${(valor as bigint).toString()}"`

  if (Array.isArray(valor)) {
    return `[${valor.map(canonicalizar).join(',')}]`
  }

  if (tipo === 'object') {
    const obj = valor as Record<string, unknown>
    const chaves = Object.keys(obj).sort()
    const partes: string[] = []
    for (const k of chaves) {
      const v = obj[k]
      if (v === undefined) {
        throw new TypeError(`Chave "${k}" é undefined; canonicalização exige valor explícito.`)
      }
      partes.push(`${JSON.stringify(k)}:${canonicalizar(v)}`)
    }
    return `{${partes.join(',')}}`
  }

  throw new TypeError(`Tipo não canonicalizável: ${tipo}`)
}

export function sha256Hex(dados: string | Uint8Array): string {
  return createHash('sha256').update(dados).digest('hex')
}

/** Hash canônico de uma estrutura: canonicaliza e aplica SHA-256. */
export function hashCanonico(valor: unknown): string {
  return sha256Hex(canonicalizar(valor))
}

const HEX64 = /^[0-9a-f]{64}$/

export function ehSha256Valido(s: unknown): boolean {
  return typeof s === 'string' && HEX64.test(s)
}
