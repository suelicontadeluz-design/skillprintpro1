# Isabela (agente-objecoes) — baseline ACTIVE ancorado por HASH

## Por que não há `index.ts` aqui

Havia. Foi **removido em 2026-08-30 por incidente de privacidade**: a fonte
ACTIVE da Isabela contém, em **código executável** (não em comentário), um
telefone pessoal — `const PHONE_ADMIN = '<telefone real>'`.

Este repositório é **público**. Diferente do caso do João, onde toda a PII
estava em comentário e pôde ser trocada por valores sintéticos sem tocar em
comportamento, aqui o literal é lido pelo código para decidir para quem vão as
notificações administrativas: sanitizá-lo mudaria comportamento, e mantê-lo
publicaria um telefone pessoal.

Como **nenhum runtime importa este arquivo** — a Isabela é publicada pela
própria plataforma Supabase, e não por `raw.githubusercontent.com` como o
João — removê-lo não quebra nada. A identidade do baseline é preservada pelos
hashes abaixo, e a fonte de verdade do rollback é a plataforma.

## Identidade do baseline (inalterada)

| | |
|---|---|
| Edge slug | `agente-objecoes` |
| Edge version | **70** |
| Versão lógica | `agente-objecoes-v5.6.1` (o cabeçalho ainda diz v5.6.0; a v70 é o hotfix) |
| `ezbr_sha256` da v70 | `de32d2aa237c82fc6ce3e08dbcf757694143c9053253606131f35de6b0210fb1` |
| sha256 do `index.ts` que estava aqui | `ebe6394ed52f95ace15f6785dacf51a64667446ca2dd041b2236ee16625465f5` |

Para recuperar a fonte: `get_edge_function(<project>, 'agente-objecoes')`.
Ela é o rollback real e sempre foi.

## Dívida registrada (não corrigida aqui)

**DIVIDA_PII_ISABELA** — `PHONE_ADMIN` é um telefone pessoal *hardcoded* em
código de produção. A correção adequada é lê-lo de secret
(`Deno.env.get('PHONE_ADMIN')`), o que exige deploy e portanto governança; não
cabia nesta rodada, que é read-only quanto a produção. Enquanto não for feito,
qualquer cópia dessa fonte para um repositório público republica o telefone.

## Candidato v5.7.0

Continua **inexistente**. O patch citado no laudo da rodada 3 nunca foi
persistido em Git, banco ou Storage — sem commit SHA e sem hash, não tem
identidade, e reconstruí-lo de memória é proibido. O próximo v5.7.0 deve nascer
já ancorado nos hashes acima, com a disciplina: editar → testar → commit →
hash → só então laudo.

Contrato esperado dele (do laudo r3, para conferência): `execContext`
(mode/dryRun/replayCaseId/asOf/origemExecucao/allowEffects/
allowExternalTransport/allowStateMutation); replay não varre fila; leitores
respeitam `as_of`; bloqueio de `lead_objections`, `crm_tasks`,
`agente_aprovacoes`, pós-venda, telemetria e BotConversa; ações hipotéticas na
resposta.
