// Candidate helper for agente-exploracao AFTER sanitizarSaidaCliente base sanitization.
// Front: julia-mensagem-duplicada
// Evidence measured 2026-09-06 against fact_conversations:
// - 2026-08-10..2026-09-05: 3,687 Julia outbounds
// - 51 messages contain exact repeated blocks >= 40 chars (49 old + 2 new)
// - 3,582 measured messages without repeated long blocks are not changed by this rule
// - 69 excess repeated blocks would be removed
//
// The 40-char threshold intentionally mirrors the established measurement contract.
// This avoids broadening the fix to tiny repeated fragments/list markers that were never
// part of the defect definition.

export function colapsarBlocosIdenticos(texto: string): string {
  const blocos = String(texto || '')
    .split(/\n[\t ]*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const vistos = new Set<string>();
  const saida: string[] = [];

  for (const bloco of blocos) {
    if (bloco.length >= 40) {
      if (vistos.has(bloco)) continue;
      vistos.add(bloco);
    }
    saida.push(bloco);
  }

  return saida.join('\n\n').trim();
}

// Minimal integration shape in the current monolith:
//   const sanitizarSaidaClienteBase = (t: string): string => <existing exact v14.10.0 chain>;
//   const sanitizarSaidaCliente = (t: string): string =>
//     colapsarBlocosIdenticos(sanitizarSaidaClienteBase(t));
//
// Do NOT publish this helper alone. First materialize/hash the exact ACTIVE
// agente-exploracao v266 source, then apply only the integration above, run the frozen
// historical/sentinel set, and deploy with explicit rollback to the captured ACTIVE source.
