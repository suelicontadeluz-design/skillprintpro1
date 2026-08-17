# Patch mínimo — `provider_id` no agente-conversacao (Bruno) v72

**Status: PREPARADO, NÃO PUBLICADO.** Nenhum deploy foi feito. Autorização vigente:
_"preparar, mas não publicar sem prova prévia, o patch mínimo de provider_id da v72"_.

Frente: `henrique-loop-fechado` (trilha `recuperacao`).
Fonte de origem: Edge Function `agente-conversacao`, projeto `ldrdtaibazplvrbwyrvx`,
**version 72 / ACTIVE**, cabeçalho `agente-conversacao v7.7.4`,
`ezbr_sha256 aa9b59baa24fd79c83005d3a309744359c5322cf099243d41d20d85bb4f98e37`.

## O problema que este patch resolve

O contrato do canário exige quatro sinais para o mesmo `turn_id`, entre eles o **eco do
provedor correlacionado por id**. Hoje isso é impossível:

- `type ResultadoEnvio` **já declara** `provider_id: string | null`;
- `enviar()` inicializa `provider_id: null` no objeto `base`;
- **nenhum** dos três caminhos de retorno o preenche;
- logo `p_envio_provider_id` chega sempre `null` em `fn_registrar_decisao_agente_v2`.

Medido no banco: `envio_provider_id` preenchido em **0 de 1.863** decisões em 45 dias.
Isso não é sinal de que a flag nunca esteve ligada — é sinal de que **o campo nunca teve
como ser preenchido**. A implementação ficou pela metade; o tipo até prevê um
`categoria_erro: 'resposta_invalida'` que nunca é usado.

## Por que uma lista de candidatos e não um campo fixo

A documentação pública do BotConversa está **inacessível deste ambiente** (egress
bloqueado em `ajuda.botconversa.com.br` e `botconversa.gitbook.io`) e **não existe
nenhuma amostra do corpo de resposta persistida no banco** — a v72 lê `corpo` mas nunca
o grava em lugar nenhum.

Fixar `resposta.id` agora seria adivinhação apresentada como fato. O patch, em vez disso:

1. tenta os formatos plausíveis, em ordem de precedência;
2. quando **não** encontra, não inventa — grava as chaves que realmente vieram em
   `contexto.envio_diag`, junto do `http_status`.

Assim, se o formato for um dos previstos, o `provider_id` fecha já na primeira execução.
Se não for, a próxima rodada fecha o campo certo **com amostra real**, em uma linha.
Nos dois casos saímos do escuro sem fabricar evidência.

## O que o patch muda — 5 pontos, todos aditivos

| # | Local | Mudança |
|---|---|---|
| 1 | `type ResultadoEnvio` | acrescenta `provider_diag` (opcional, diagnóstico) |
| 2 | acima de `enviar()` | insere a função pura `extrairProviderId` |
| 3 | `base` em `enviar()` | acrescenta `provider_diag: null` |
| 4 | retornos `aceito` e `rejeitado` | preenche `provider_id` e `provider_diag` |
| 5 | `registrarDecisao` | enriquece `p_contexto` com `envio_diag` |

## Invariantes de segurança — o que o patch NÃO faz

- **Não altera a decisão de envio.** `aceitar` (linha 841) continua sendo
  `envio.estado === 'aceito'`. `estado`, `ok` e `confirmado_por` derivam só do
  `http_status` e não passam pela função nova.
- **Não altera o prompt, o modelo, o retry, o parser nem o fluxo de decisão.**
- **Não toca no Lab.** Continua com zero ocorrência de `lab_` no fonte.
- **É inerte com a flag desligada.** `corpo` só é lido quando
  `BRUNO_ENVIO_OBSERVAVEL_ENABLED=true`; com a flag off, `corpo` é `null`,
  `extrairProviderId` devolve `forma: 'vazio'` e o comportamento é **idêntico ao de hoje**.
  Publicar este patch com a flag desligada é, por construção, um no-op observável.
- **`extrairProviderId` nunca lança.** Toda entrada devolve objeto válido.

## Provas executadas nesta preparação

- **Testes unitários: 20/20 PASS** (`node --test`). Cobrem os 7 formatos que devem render
  id, precedência entre campos, resposta em lista, id cru; o caso de **formato
  desconhecido** (exige `id === null` e as chaves reais devolvidas); 8 entradas hostis
  (null, undefined, vazio, JSON inválido, HTML de erro, corpo truncado em 500 chars);
  valores lixo (`""`, `null`, `true`, `{}`, `"null"`) que não podem virar id; truncagem
  em 200 chars; e um teste que trava a assinatura para impedir que alguém transforme a
  função em decisora de envio.
- **Typecheck: nenhum erro novo.** `tsc --strict` no fonte original e no patcheado produz
  **os mesmos 9 erros**, todos `Cannot find name 'Deno'` / import por URL — artefatos de
  rodar fora do Deno, presentes no original. Só mudam os números de linha.
- **Não executado:** o patch **não foi publicado** e portanto não há prova de efeito
  contra o vivo. Isso é deliberado e está de acordo com a autorização.

## Rollback

O rollback é o redeploy da v72 tal como está hoje, cujo fonte íntegro está preservado em
`bruno_v72.ts` (referência: `ezbr_sha256 aa9b59ba…f98e37`, version 72 ACTIVE).

1. `mcp__Supabase__deploy_edge_function` com o conteúdo de `bruno_v72.ts`,
   `verify_jwt: false` (preservar — a v72 está com `false`).
2. Conferir que a nova version ficou ACTIVE e que o cabeçalho voltou a `v7.7.4`.
3. Nenhuma migration acompanha este patch, então **não há rollback de banco**:
   `contexto` é `jsonb` livre e `envio_provider_id` já existe na tabela.

Rollback alternativo, ainda mais barato: **desligar a flag**. Com
`BRUNO_ENVIO_OBSERVAVEL_ENABLED=false` o patch fica inerte sem precisar de deploy.

## Gates exigidos ANTES de considerar o patch aprovado em produção

1. Deploy publicado e version nova ACTIVE, com `verify_jwt=false` preservado.
2. Com a flag **desligada**: um turno orgânico qualquer continua gravando decisão pelo
   caminho antigo, sem `execucao_sucesso` — prova de que o patch é inerte.
3. Com a flag **ligada**, um turno orgânico com envio aceito:
   `envio_provider_id` **não nulo**, ou `contexto.envio_diag.chaves` preenchido com o
   formato real. Um dos dois **tem** de acontecer; os dois nulos = patch não pegou.
4. `turn_id` preservado e igual em todos os sinais do mesmo turno.
5. Nenhuma regressão: `estado`/`aceitar` continuam derivando do `http_status`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `bruno-v72-provider-id.diff` | diff unificado contra o fonte ACTIVE |
| `extrairProviderId.ts` | função pura, como será inserida (TypeScript) |
| `extrairProviderId.mjs` | gêmeo sem tipos, para os testes rodarem no Node |
| `extrairProviderId.test.mjs` | 20 testes — `node --test` |
