// Asserts minimos locais: jsr.io/deno.land nao sao alcancaveis neste ambiente.
export function assert(c: unknown, m = 'assert falhou'): asserts c { if (!c) throw new Error(m); }
export function assertFalse(c: unknown, m = 'assertFalse falhou') { if (c) throw new Error(m); }
export function assertEquals(a: unknown, b: unknown, m?: string) {
  const sa = JSON.stringify(a), sb2 = JSON.stringify(b);
  if (sa !== sb2) throw new Error((m ? m + ': ' : '') + `esperado ${sb2}, veio ${sa}`);
}
