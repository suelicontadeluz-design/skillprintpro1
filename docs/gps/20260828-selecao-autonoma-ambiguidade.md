# Selecao autonoma do Worker — remocao de ambiguidade estrutural (2026-08-28)

Escopo: trilhas `conversao_joao` e `governanca`. `funil` entra apenas como regressao.

Regra do exercicio: completar a informacao necessaria para a escolha deterministica,
**sem** enfraquecer o gate fail-closed e **sem** inventar prioridade comercial.

## PASSO 0 — o que ja existia (nada novo foi criado)

O mecanismo de desempate ja estava completo. Nada foi adicionado ao schema:

| Estrutura | Papel | Situacao |
|---|---|---|
| `gps_frente_precedencia` | precedencia intra-trilha | reutilizada (1 linha inserida) |
| `vw_gps_rota_vigente` / `gps_rota_decisao` | rota humana, precede o desempate automatico | intacta |
| `vw_gps_precedencia_lacunas` | ja apontava a lacuna exata | intacta |
| `vw_gps_ambiguidade_causa` | ja classificava a causa do empate | intacta |
| `fn_gps_proxima` | gate fail-closed | **nao alterada** |

`fn_gps_proxima` so resolve empate quando **todas** as empatadas tem precedencia ativa
**e** o minimo e unico. Cobertura parcial mantem `AMBIGUA`. Esse comportamento foi preservado.

## Diagnostico

### governanca — ANTES

- 5 candidatas empatadas em prioridade 3, todas acionaveis.
- 4 cobertas por decisao do dono (`decisao_dono_precedencia_governanca_2026-08-20`):
  crons=7, claim=8, regra-fato=10, qualidade-contexto=11.
- 1 **sem** precedencia: `cerebro-shadow-v2-observador-passivo`.
- `cobertura_precedencia = {todas_cobertas: false, com_precedencia: 4, empatadas: 5}`
  -> `AMBIGUA` / `NAO_RESOLVIDO`. Fail-closed correto.

**Causa:** a decisao do dono de 2026-08-20 enumerou "posicao N de **5**" para as 5 frentes
P3 entao existentes. `cerebro-shadow-v2-observador-passivo` foi criada em **2026-08-24**,
depois da decisao. Nao foi omitida pelo dono — nao existia.

### conversao_joao — ANTES

- 3 candidatas empatadas em prioridade 1 (P0), todas acionaveis:
  `joao-dtf-textil-jeans-compatibilidade`, `joao-egresso-identificador-financeiro-interno`,
  `joao-parametro-financeiro-sem-proveniencia`.
- `com_precedencia = 0`. A trilha inteira tem **zero** linhas em `gps_frente_precedencia`.

## Respostas A–E

| | governanca | conversao_joao |
|---|---|---|
| **A.** precedencia declarada mas incompleta? | **SIM** — 4 de 5 cobertas | NAO — 0 de 3 |
| **B.** regra equivalente em outra tabela/funcao nao considerada? | **SIM** — a regra `gps_extensao_conservadora_politica_v1_2026-08-20`, ja registrada e ja aplicada em `identidade/contrato-autoria-corpus` | NAO |
| **C.** dependencia estrutural que derive a ordem? | NAO — `depende_de` vazio entre as 5 | **NAO — e aqui esta a armadilha**, ver abaixo |
| **D.** historico explicito do dono/Worker? | **SIM** — a decisao de 2026-08-20, que ja define a vencedora | NAO — `gps_decisoes_humanas` 0, `gps_decisoes_autonomas` 0, `gps_rota_decisao` 0, `gps_frente_precedencia` 0 |
| **E.** falta decisao? | NAO | **SIM** |

### A armadilha descartada em conversao_joao

`vw_gps_ambiguidade_causa` reporta `sinal_dag = DAG_DISTINGUE` e
`venceria_por_dag = joao-parametro-financeiro-sem-proveniencia` (`max_desbloqueia = 3`).

Esse sinal **nao foi usado**, e a razao e decisiva. Medindo quem de fato declara
`depende_de` sobre cada candidata:

- `joao-parametro-financeiro-sem-proveniencia` e pre-requisito de 3 frentes abertas:
  `aprendizados-teto-descarte-total`, `contrato-orcamento-contexto-aprendizado`
  (ambas da trilha `aprendizado`) e `joao-preco-guarda-cega-produto`.
- **Nenhuma delas e uma das outras duas candidatas empatadas.**

Ou seja: o DAG prova que ela e um **gargalo**, nao que ela **precede as suas duas
concorrentes**. Usar isso para desempatar seria exatamente inferir prioridade porque
"parece mais importante" — proibido. `vw_gps_ambiguidade_causa` ja classifica esse caso
como `SINAL_UNICO_NAO_VALIDADO`, e a classificacao esta certa.

Tambem descartados como evidencia:
- `gps_ficha_decisao_conversao_joao` — status `RECOMENDACAO_PARA_DECISAO_DO_DONO`
  (recomendacao, nao decisao) e **nao cobre nenhuma das 3 candidatas atuais**.
- `gps_autoridade_frente` — define o que o Worker pode fazer *dentro* de uma frente
  (mandato de autoridade), nao ordem *entre* frentes.

## Matriz de empate

### governanca (empate de 5 em P3)

| A | B | razao do empate | evidencia A antes de B | evidencia B antes de A | deterministico? | origem da regra |
|---|---|---|---|---|---|---|
| crons-sucesso-sem-efeito | claim-recusa-sem-observabilidade | mesma prioridade 3 | dono, "posicao 1 de 5" | — | **SIM** | `decisao_dono_precedencia_governanca_2026-08-20` |
| crons-sucesso-sem-efeito | regra-fato-versus-interpretacao | mesma prioridade 3 | dono, 1 de 5 vs 4 de 5 | — | **SIM** | idem |
| crons-sucesso-sem-efeito | qualidade-contexto-frentes-continua | mesma prioridade 3 | dono, 1 de 5 vs 5 de 5 | — | **SIM** | idem |
| crons-sucesso-sem-efeito | cerebro-shadow-v2-observador-passivo | mesma prioridade 3 | B criada em 24/08, **depois** da decisao de 20/08 que ordenou o bloco; regra ja registrada manda encaixar novas frentes APOS o bloco decidido | nenhuma | **SIM** | `gps_extensao_conservadora_politica_v1_2026-08-20` (precedente: `identidade/contrato-autoria-corpus`) |

### conversao_joao (empate de 3 em P0)

| A | B | razao do empate | evidencia A antes de B | evidencia B antes de A | deterministico? | origem |
|---|---|---|---|---|---|---|
| joao-dtf-textil-jeans-compatibilidade | joao-egresso-identificador-financeiro-interno | P0, sem precedencia, sem dependencia mutua | nenhuma | nenhuma | **NAO** | — |
| joao-dtf-textil-jeans-compatibilidade | joao-parametro-financeiro-sem-proveniencia | idem | nenhuma | apenas gargalo (DAG), **nao** precedencia sobre esta | **NAO** | — |
| joao-egresso-identificador-financeiro-interno | joao-parametro-financeiro-sem-proveniencia | idem | nenhuma | idem | **NAO** | — |

## Mudanca aplicada

**Uma unica linha**, em `db/migrations/20260828_gps_precedencia_cerebro_shadow_v2.sql`.
Nenhuma funcao, view, tabela ou trigger foi criada ou alterada.

Prova de nao-arbitrariedade: a vencedora resultante e `crons-sucesso-sem-efeito`, que e a
propria "posicao 1 de 5" do dono. O resultado e **invariante** a qualquer valor > 11 —
testado em transacao revertida com 12 e com 999, mesma vencedora. O valor 12 nao carrega
juizo sobre a frente nova.

Rollback: `DELETE FROM public.gps_frente_precedencia WHERE frente_slug = 'cerebro-shadow-v2-observador-passivo';`

## DEPOIS

| trilha | situacao | desempate | frente escolhida | cobertura |
|---|---|---|---|---|
| governanca | `UNICA` | `PRECEDENCIA_INTRA_TRILHA` | **crons-sucesso-sem-efeito** | 5/5 |
| funil | `UNICA` | `PRECEDENCIA_INTRA_TRILHA` | **handoff-tem-validade** (inalterado) | 2/2 |
| conversao_joao | `AMBIGUA` | `NAO_RESOLVIDO` | — (fail-closed correto) | 0/3 |

## Simulacao do encadeamento do Worker (transacao revertida)

Executada em `governanca`, tudo com `ROLLBACK`:

| passo | resultado |
|---|---|
| 1. `fn_gps_proxima('governanca')` | `UNICA` -> `crons-sucesso-sem-efeito` |
| 2. `fn_frente_claim_v2` | `claim_criado` |
| 3. GPS durante o claim | `NENHUMA` (trilha corretamente ocupada) |
| 4. criterios PASS -> gate | `PRONTA_PARA_FECHAR`, `pode_fechar = true`, 11/11 |
| 5. `fn_frente_finalizar_chat` | `ok = true` |
| 6. claims ativos na trilha | **0** (lease liberado) |
| 7. `fn_gps_proxima('governanca')` | `UNICA` -> **claim-recusa-sem-observabilidade** (precedencia 8 = "posicao 2 de 5" do dono) |

O Worker fecha uma frente e chega sozinho a proxima, sem Alessandro.

Verificacao pos-rollback: `crons-sucesso-sem-efeito` segue `em_andamento`,
0 claims ativos, 0 eventos de criterio com evidencia `SIMULACAO%` persistidos.

O gate tambem foi observado **recusando** corretamente durante a simulacao:
com o criterio 2 real em `FAIL`, `fn_frente_finalizar_chat` devolveu
`criterio_estruturado_incompleto`; com claim_token errado, `chat_nao_possui_claim_ativo`.

## Decisao humana que continua faltando (unica)

**Trilha `conversao_joao`: a ordem relativa entre as 3 frentes P0 acionaveis.**

Nao e derivavel porque, simultaneamente:
1. a trilha nao tem **nenhuma** precedencia registrada — nao ha bloco decidido ao qual
   ancorar a extensao conservadora que resolveu `governanca`;
2. as 3 tem `depende_de = []` entre si — nenhuma dependencia tecnica as ordena;
3. nao ha rota humana, decisao humana nem decisao autonoma registrada para nenhuma das 3;
4. o unico artefato existente (`gps_ficha_decisao_conversao_joao`) e uma recomendacao
   nao decidida e cobre outras 6 frentes, nenhuma delas entre as 3 candidatas.

Informacao minima que destrava: **a ordem relativa das 3**, ou uma rota humana
(`gps_rota_decisao`) apontando uma delas. Qualquer uma das duas resolve.
