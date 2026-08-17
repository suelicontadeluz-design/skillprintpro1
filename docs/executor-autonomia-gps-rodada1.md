<title>Executor GPS — Rodada 1</title>

# Executor / Autonomia guiada pelo GPS — Entrega da 1ª rodada (READ-ONLY)

**Data:** 17/08/2026 · **Fase:** investigação, zero implementação · **Escopo:** camada executor/autonomia. O GPS não foi alterado.

> **Veredito: `PATCH_PEQUENO`** — com 1 item de contrato a escalar para a sessão do GPS (custódia do `claim_token`), que **não bloqueia o canário**.

---

## 0. Onde as coisas realmente estão

O repositório `skillprintpro1` está praticamente vazio (1 commit, app Next.js, sem `AGENTS.md`). **O GPS e toda a arquitetura de agentes vivem no projeto Supabase `ldrdtaibazplvrbwyrvx`**, não no projeto `jjigrdmtanyxrzmkelvz` citado no README.

`AGENTS.md` não existe em disco nem no histórico git deste repositório. O que existe é o **protocolo canônico devolvido por `fn_contexto_codex_frentes()`** (10 regras: PRE-FLIGHT, CLAIM, EXCLUSIVIDADE, HEARTBEAT, RECONCILIAR, POST-FLIGHT, BAIXA, ESCOPO, TRILHA, ONDA). Tratei esse protocolo como o contrato vigente. **Se existe um `AGENTS.md` em outro lugar, ele precisa ser apontado antes de qualquer implementação** — auditei o executor contra o protocolo do banco, não contra um arquivo que não localizei.

---

## 1. Arquitetura atual encontrada

| Camada | Objetos | Estado |
|---|---|---|
| **GPS (decisão)** | `fn_gps_proxima(trilha)`, `fn_gps_panorama()`, `vw_frentes_elegiveis`, `vw_esperas_abertas`, `vw_gps_rota_vigente`, `gps_rota_decisao` | Completo e coerente |
| **Governança (execução)** | `fn_frente_claim`, `fn_frente_heartbeat`, `fn_frente_finalizar_chat`, `frentes_claims`, `frentes_claims_segredo`, `fn_frente_log_claim` | Completo, com autenticação por token sha256 |
| **Estado** | `frentes` (226 linhas), `frentes_espera`, `frentes_historico`, `frentes_trilhas` | Completo |
| **Agendamento** | `pg_cron` (~100 jobs ativos) + `pg_net` → 267 Edge Functions | Padrão maduro e comprovado |
| **Runner de IA para dev** | `go_ai_dev_runs/iterations/proposals/cost_ledger/config`, `go_ai_provider_circuit`, `go_ai_claim_run()` | **Protótipo dormente** |
| **Autonomia** | `autonomia_niveis` (0–5), `autonomia_regras`, `org_autonomia_*`, `agentes.nivel_autonomia_atual` | Existe, mas **fora de escopo** (ver §3) |

**Estado vivo do GPS agora:** 18 trilhas ativas · 3 `UNICA` · 9 `AMBIGUA` · 4 `TODAS_AGUARDANDO` · 2 `NENHUMA` · 1 claim ativo · 10 esperas abertas (7 delas `decisao_humana`).

**Descoberta central:** *nenhum* dos ~100 jobs de cron toca o GPS. Existem trilhos completos e um motor de decisão completo — **falta exatamente a ponte entre os dois.**

---

## 2. Mecanismos existentes reutilizáveis

Reaproveitáveis sem criar nada novo:

1. **`pg_cron` + `pg_net` + Edge Function** — padrão provado em ~100 jobs. É o "worker barato" que a missão pede; já existe.
2. **`fn_gps_proxima` / `fn_gps_panorama`** — decisão determinística, `STABLE`, **186 ms** medidos para varrer as 18 trilhas. Isto é o "consultar GPS" da iteração, sem LLM.
3. **Ciclo de claim completo** — claim → token → heartbeat → finalizar, com expiração de lease, exclusividade por trilha e log em `frentes_historico`. O executor **não precisa de governança nova**; precisa obedecer a existente.
4. **`go_ai_dev_*`** — a peça mais valiosa e mais subestimada. Já traz, prontos:
   - `monthly_budget_brl` / `max_run_budget_brl` com **reserva de orçamento antes de rodar** (`go_ai_claim_run` marca `budget_blocked`);
   - `go_ai_dev_cost_ledger` (tokens in/out, custo, provider, modelo);
   - `max_rounds` / `max_tool_calls` (limite de trabalho por rodada);
   - `enabled` (**kill switch**) e `mode='observe'` (**dry-run**);
   - `allow_*_patch` / `allow_production_write` (política de efeito externo);
   - `go_ai_provider_circuit` (circuit breaker);
   - `go_ai_dev_proposals` com `patch`, `tests`, `rollback_plan`, `risk_analysis`.
   - Modelos já configurados são baratos: `gpt-5-mini` / `claude-haiku-4-5`.
5. **Sinal de progresso já existe:** `frentes_historico` grava `{"proximo_passo_alterado": true}` por trigger. É a base verificável do anti-loop (§8).

**Refutação tentada, resultado honesto:** tentei matar a necessidade de executor novo. `go_ai_dev_*` chega perto — é literalmente um executor de dev com orçamento. Mas: 7 runs, todos `trigger_type='manual'`, todos de 25/07/2026, 0 iterações, `mode='observe'`, `require_human_approval=true`, e **nenhuma coluna liga um run a uma frente ou a um claim** (`source_agent_slug`/`source_command_id` apontam para `agente_comando_fila`). É chassi sem transmissão: reutilizável, não aproveitável como está.

---

## 3. Autoridade / autonomia já existente

Existe uma escala madura (`autonomia_niveis` 0–5, de "Observador" a "Autônomo"), 61 regras em `org_autonomia_regras`, e um agente dedicado a avaliar promoções (André / `agente-autonomia`, nível 0 — só propõe).

**Mas ela não cobre o executor.** Duas evidências:

- A escala é chaveada por `agente_slug` e todos os 23 agentes são de runtime comercial/marketing/infra. Não há agente de frentes de desenvolvimento.
- O próprio protocolo do GPS declara o escopo: *"governanca de chats de desenvolvimento, nao agentes comerciais em runtime"*.

**Conclusão:** a política de autonomia do executor **não existe** e precisa ser escrita. Ela não deve ser enxertada em `autonomia_niveis` — misturar governança de agente comercial com governança de execução de frentes confunde dois domínios que o sistema separou de propósito.

---

## 4. O que realmente falta

Só quatro coisas, e nenhuma é grande:

1. **A ponte GPS → claim.** Nada chama `fn_gps_proxima` automaticamente.
2. **Custódia do `claim_token`.** `fn_frente_claim` devolve o token **uma única vez**; `frentes_claims_segredo` guarda só o hash, e o comentário da tabela é explícito: *"O token puro NUNCA e gravado"*. Um humano guarda no contexto do chat. Um executor que morre entre invocações **perde o token e não consegue mais dar heartbeat nem finalizar** — a frente fica travada até a lease expirar. → **item de contrato, §15.**
3. **Vocabulário de parada.** Não existe enum nem tabela com os 8 motivos canônicos.
4. **Anti-loop.** Não existe contador de tentativas sem progresso. O risco é medido, não teórico (§8).

Tudo o mais — agendamento, orçamento, kill switch, dry-run, circuit breaker, evidência, log — já existe.

---

## 5. Desenho mínimo do executor

Três peças. Nenhuma delas altera o GPS.

```
pg_cron (1×/15min)                    ← barato, determinístico
   └─ fn_executor_tick()              ← SQL puro, ~200ms, SEM LLM
        ├─ lê fn_gps_panorama()
        ├─ aplica política (§7) + anti-loop (§8)
        ├─ nada acionável? → grava tick SEM_TRABALHO e RETORNA. Custo LLM: zero.
        └─ há trabalho? → pg_net.http_post → edge function `executor-frente`
                              ├─ 1. fn_frente_claim  → guarda token EM MEMÓRIA
                              ├─ 2. heartbeat durante o trabalho
                              ├─ 3. executa SOMENTE o proximo_passo autorizado
                              ├─ 4. registra evidência objetiva + PASS/FAIL/AGUARDANDO
                              ├─ 5. fn_frente_finalizar_chat (libera claim)
                              └─ 6. retorna motivo de parada estruturado
```

**Tabelas novas: duas, mínimas.**

- `executor_ticks` — um registro por tick: `situacao_gps`, `motivo_parada`, `frente_escolhida`, `iniciou_llm` (bool), `custo_brl`. É o que torna o custo auditável e o anti-loop verificável.
- `executor_tentativas` — `(frente_slug, checkpoint_hash, tentativas, ultimo_progresso_em)`. Base do anti-loop.

**Reuso:** `go_ai_dev_runs` + `go_ai_dev_cost_ledger` + `go_ai_dev_config` recebem uma coluna `frente_slug` e passam a ser o ledger do executor. Não se cria orçamento, ledger nem circuit breaker novos.

---

## 6. Política de parada

Toda interrupção grava um dos 8 motivos em `executor_ticks.motivo_parada`:

| Motivo | Condição objetiva |
|---|---|
| `SEM_TRABALHO` | panorama sem `UNICA`/`ROTA_ESCOLHIDA` em nenhuma trilha |
| `AGUARDA_EXTERNO` | trilha em `TODAS_AGUARDANDO` (espera aberta em `frentes_espera`) |
| `AMBIGUIDADE` | `AMBIGUA` sem rota vigente — **estaciona a trilha, tenta a próxima** |
| `RISCO` | ação fora de `allow_*` de `go_ai_dev_config` |
| `SEM_PROGRESSO` | anti-loop disparou (§8) |
| `ERRO_TECNICO` | exceção, timeout, `go_ai_provider_circuit` aberto |
| `CONTRATO_GPS_INSUFICIENTE` | falta fato estruturado; **não altera o GPS**, emite relatório |
| `DECISAO_PROPRIETARIO` | **último recurso** — ver §7 |

**Regra dura:** `DECISAO_PROPRIETARIO` só é gravável se nenhum dos outros 7 explicar a parada. Sugiro impor isso por `CHECK`/trigger, não por convenção — caso contrário vira o balde de incerteza que a missão proíbe.

**Bloqueio local nunca para o desenvolvimento:** o tick itera as 18 trilhas. `AMBIGUIDADE` ou `AGUARDA_EXTERNO` numa trilha estaciona **aquela** trilha e continua. Só quando as 18 estacionam o tick devolve `SEM_TRABALHO`.

---

## 7. Política de autonomia

O executor age sozinho quando **todas** valem: rota determinada · `elegivel=true` · `acionavel=true` · claim obtido legitimamente · ação coberta abaixo · evidência objetiva disponível.

| Classe | Autonomia | Fundamento |
|---|---|---|
| Leitura, consulta SQL, auditoria, medição | **Total** | Reversível, sem efeito externo |
| Reconferir critério de aceite com evidência | **Total** | É verificação, não mudança |
| Registrar evidência, `onde_paramos`, `proximo_passo` | **Total** | Já é o post-flight do protocolo |
| Fechar frente com `criterio_aceite` comprovado | **Total** | O gate já é imposto por `fn_frente_finalizar_chat` |
| Migration reversível com rollback escrito | Total **se** `allow_schema_patch=true` | Controlado por config, não por pessoa |
| Deploy de edge function | Total **se** `allow_edge_function_patch=true` | idem |
| Escrita em produção / efeito externo irreversível | **Bloqueado** → `RISCO` | `allow_production_write=false` |
| Mudança de objetivo, escopo estratégico, compromisso financeiro, aceitação de risco excepcional, credencial não delegada | **`DECISAO_PROPRIETARIO`** | Exige autoridade de dono |

O ponto essencial: **a política é dado em `go_ai_dev_config`, não julgamento do executor.** Insegurança do executor resolve-se por classificação e parada, nunca por pergunta ao Alessandro.

---

## 8. Mecanismo anti-loop

> **CORREÇÃO (rodada 2).** A primeira versão desta seção dizia *"550 claims para 48 baixas — 77% terminaram em `postflight_em_andamento`"*. Esse número media **fechamento**, não **progresso**, e convidava à leitura errada de que 77% eram churn. Frente longa avança dezenas de vezes antes de fechar; isso é trabalho legítimo. A medição correta está abaixo.

**Medição correta de progresso.** Para cada claim dos últimos 14 dias, verifiquei se houve entre a captura e a liberação um evento `estado_alterado` ou um `atualizada` com `proximo_passo_alterado`:

| | |
|---|---|
| Claims em 14 dias | 555 |
| **Com progresso real** | **466 (84%)** |
| Sem progresso detectável | 89 (16%) |

**O churn é 16%, não 77%.** Ressalva do próprio indicador: uma sessão que investiga e confirma "continua quebrado" faz trabalho real sem alterar campo nenhum, então 16% é **teto**, não prova.

**E a causa não é espera não registrada.** Das 8 frentes com ≥3 claims sem progresso, **7 nunca tiveram espera alguma**:

| Frente | Claims | Sem progresso | Já teve espera? |
|---|---|---|---|
| `microloops-23-agentes` | 68 | 30 | **não** |
| `joao-contexto-comercial-canonico` | 20 | 15 | **não** |
| `isabela-classificacao-posvenda-regex` | 19 | 7 | **não** |
| `mapeamento-funil-cerebro` | 27 | 3 | sim |

Portanto **espera estruturada não teria evitado a maior parte deste churn**. `microloops-23-agentes` — 68 claims, 30 sem progresso, zero espera — é problema de granularidade ou de escopo da frente, e pertence à sessão do GPS como investigação própria.

**O anti-loop continua necessário**, por outro motivo: 89 claims improdutivos em 14 dias saíram de humanos, em ritmo humano. Um executor automático opera em velocidade de máquina e sem cansaço — a mesma taxa aplicada a um tick horário produz um padrão muito pior. O mecanismo abaixo é preventivo, não corretivo de um número histórico.

**Progresso verificável (definição proposta):** houve progresso desde o último claim se **qualquer** destes mudou:

1. `frentes.estado`; 2. novo evento `atualizada` com `{"proximo_passo_alterado": true}` em `frentes_historico`; 3. `frentes.evidencia` mudou; 4. espera aberta ou encerrada em `frentes_espera`.

**Checkpoint** = `sha256(estado ‖ proximo_passo ‖ criterio_aceite ‖ evidencia)`.

**Regra:** mesma frente + mesmo checkpoint por **2 tentativas** → `SEM_PROGRESSO` e **quarentena da frente por 24 h** (o tick pula a frente; a frente **não** é bloqueada no GPS — a quarentena vive em `executor_tentativas`, não em `frentes`). Reexecução sem nova evidência é proibida por construção: o tick compara o hash antes de gastar um claim.

Isto cobre os 7 casos pedidos: mesma frente sem progresso, mesmo checkpoint, mesma decisão, mesma falha, claim/release repetitivo (o claim nem chega a ser pedido), reexecução sem evidência, e polling inútil (o tick que não acha trabalho não invoca LLM).

---

## 9. Estratégia para manter Alessandro fora do loop

| Situação que hoje viraria pergunta | Resolução automática |
|---|---|
| "Qual a próxima frente?" | `fn_gps_proxima` — determinístico |
| "Posso fechar?" | `criterio_aceite` + evidência; o gate é `fn_frente_finalizar_chat` |
| "Posso liberar o claim?" | Post-flight é obrigatório pelo protocolo |
| "Posso continuar?" | Coberto pela tabela §7 |
| "Qual implementação escolher?" | Escopo da frente + `proximo_passo`; se genuinamente indeterminado → `AMBIGUIDADE`, estaciona, vai para outra trilha |
| "Aprova este teste / correção rotineira?" | Classe "Total" em §7 |
| Executor inseguro | Classifica e para. **Nunca pergunta.** |

**O ponto de atenção honesto.** Hoje **9 das 18 trilhas estão `AMBIGUA` e `gps_rota_decisao` está vazia (0 linhas)**. O único desempate previsto é decisão humana explícita. Se o executor passar a pedir rota para as 9 trilhas ambíguas, ele troca *"Alessandro, manda a próxima"* por *"Alessandro, escolhe a rota"* — exatamente o que a missão proíbe.

**Recomendação:** o executor **ignora trilhas `AMBIGUA`** e opera apenas `UNICA` e `ROTA_ESCOLHIDA`. Registra `AMBIGUIDADE` e segue. Isso lhe dá 3 trilhas hoje sem colocar ninguém no caminho feliz. Reduzir ambiguidade é evolução do GPS — **outra sessão, outro dono.** Não é o executor que resolve, e certamente não inventando desempate.

---

## 10. Canário proposto

**Frente: `diego-timeout-fn-contexto-midia-ouro`** · trilha `midia` · prioridade 1 · `UNICA` · `precisa_deploy=false` · `tipo_frente=execucao`.

Por que é o canário certo:

- O `proximo_passo` é **reconferência READ-ONLY**: verificar 4 critérios sobre execuções orgânicas dos crons 131 e 80.
- **A evidência já existe e é objetiva.** Verifiquei `cron.job_run_details`: job 131 e job 80 rodaram `succeeded` em 14, 15 e 16/08 (131 falhou em 13/08). O critério de aceite exige execução natural sem timeout — isso é conferível por SQL, sem interpretar prosa.
- A data-gatilho do `proximo_passo` ("em 14/08 após 10:00 UTC") **já passou** — o trabalho está genuinamente maduro, não é espera disfarçada.
- Nada a implantar, nada a escrever em produção, totalmente reversível.

Descartei as outras duas `UNICA`: `erp-seguranca-autorizacao-go-live` aguarda evento orgânico futuro (espera não registrada — ver §15), e `isabela-rodada-incompleta-time-guard` declara `BLOQUEIO LOGICO` e `precisa_deploy=true`.

**Escopo do canário — uma iteração e para:**
`fn_gps_proxima('midia')` → claim real → heartbeat real → conferir os 4 critérios contra `cron.job_run_details` → registrar evidência real com veredito PASS/FAIL/AGUARDANDO → `fn_frente_finalizar_chat` real → nova consulta ao GPS → **encerra**.

Sem recorrência global. Sem cron habilitado. **O canário não vira daemon** — o `pg_cron` só é criado depois que a iteração completa for provada, e já nasce com `active=false`.

---

## 11. Riscos e rollback

| Risco | Mitigação | Rollback |
|---|---|---|
| Executor captura frentes em loop | Anti-loop §8 + `executor_tentativas` | `UPDATE go_ai_dev_config SET enabled=false` |
| Claim órfão (executor morre com claim) | TTL curto (15 min) no canário; lease expira sozinha | `fn_frente_claim` já expira e loga `claim_expirado` |
| Token perdido → frente travada | TTL curto; §15 resolve no durável | Esperar expiração (comportamento já existente) |
| Executor fecha frente sem prova | `fn_frente_finalizar_chat` **já exige** `criterio_aceite` + `evidencia` | Reabrir a frente; histórico é append-only |
| Custo descontrolado | `monthly_budget_brl` reservado **antes** de rodar | `enabled=false` |
| Inconsistência GPS × claim | Parada segura obrigatória: divergência → `ERRO_TECNICO`, sem escrita | — |
| Concorrência com chats humanos | Exclusividade por trilha já imposta por índice único parcial | — |
| Executor "conserta" o GPS sozinho | Proibido por política; só emite `CONTRATO_GPS_INSUFICIENTE` | — |

**Kill switch:** `go_ai_dev_config.enabled=false` **e** `cron.alter_job(active=false)` — dois níveis independentes.
**Dry-run:** `mode='observe'` já existe; o canário roda com ele até a última etapa.

---

## 12. Comparação de alternativas por custo operacional

Preços Anthropic (1P, por MTok): **Opus 5 $5 / $25** · **Sonnet 5 $3 / $15** ($2/$10 até 31/08/2026) · **Haiku 4.5 $1 / $5**. Cache: escrita 1,25× (TTL 5 min) ou 2× (1 h); **leitura 0,1×**.

Baseline de comparação: tick a cada 15 min = 96/dia ≈ 2.880/mês.

| Arquitetura | Como decide "há trabalho?" | Custo/mês (ordem de grandeza) |
|---|---|---|
| **A1 — LLM no loop, contexto ingênuo** | Agente acorda e carrega `fn_contexto_codex_frentes()` (**600 mil caracteres ≈ 150k tokens**) | **≈ US$ 2.000+** |
| **A2 — LLM no loop, contexto enxuto** | Agente acorda com panorama (~2k) + system/tools (~10k) | **≈ US$ 245** |
| **A3 — A2 com prompt caching** | idem, prefixo estável em cache (0,1×) | **≈ US$ 90** |
| **B — cron + SQL decide, LLM sob demanda** ✅ | `fn_gps_panorama()` em SQL, 186 ms | **≈ US$ 0 ocioso** + custo do trabalho real |
| **C — Haiku como triador** | Haiku classifica o panorama | ≈ US$ 9 + custo do trabalho — **e é desnecessário** |

**Sobre C:** rejeito. `fn_gps_proxima` **já devolve** `UNICA`/`AMBIGUA`/`NENHUMA`/`TODAS_AGUARDANDO` de forma determinística em 186 ms. Pôr um LLM para reclassificar o que o SQL já classificou adiciona custo, latência e um modo de falha novo (o modelo discordar do GPS) sem adicionar informação. **Modelo menor não é a resposta; nenhum modelo é a resposta nesta etapa.**

**Sobre A1:** é o cenário mais provável se alguém implementar "o jeito óbvio", porque `fn_contexto_codex_frentes()` é a função de contexto natural — e ela devolve 594 mil caracteres só no array `fila`. Vale registrar explicitamente: **o executor nunca deve carregar essa função para decidir se há trabalho.**

---

## 13. Estimativa de consumo de LLM

**Ocioso (arquitetura B):** 2.880 ticks/mês × 186 ms de CPU Postgres ≈ **9 minutos de CPU/mês**, incluídos no compute do Supabase. **Zero token.** `SEM_TRABALHO`, `TODAS_AGUARDANDO` e esperas longas custam literalmente nada.

**Trabalhando:** por iteração real, com Opus 5 e cache no prefixo estável — ~60k tokens de entrada (majoritariamente cacheados) + ~15k de saída ≈ **US$ 0,40–0,70/iteração**.

| Volume real | Custo/mês |
|---|---|
| 2 iterações/dia | ≈ US$ 25–42 |
| 6 iterações/dia | ≈ US$ 72–126 |
| 12 iterações/dia | ≈ US$ 144–252 |

A propriedade que importa: **o custo é proporcional ao trabalho entregue, não ao tempo decorrido.** Em A2/A3 o custo é o mesmo num dia em que 18 trilhas estão paradas e num dia em que 6 frentes fecham.

O teto já é enforçado: `go_ai_dev_config.monthly_budget_brl` (hoje R$ 20,00) é **reservado antes** de cada run por `go_ai_claim_run`, que marca `budget_blocked` se estourar. Esse valor precisa ser revisto pelo Alessandro conforme o volume desejado — **é decisão de dono (compromisso financeiro), não do executor.**

---

## 14. Recomendação: a arquitetura mais barata que preserva segurança

**Arquitetura B.**

```
pg_cron (barato) → fn_executor_tick() em SQL (determinístico, 186ms)
                 → só invoca LLM quando existe trabalho acionável de verdade
```

Três razões, nesta ordem:

1. **Custo:** elimina de US$ 90 a US$ 2.000/mês gastos apenas para descobrir que não há trabalho. O executor dorme de graça.
2. **Segurança:** o gate continua sendo `fn_frente_claim`. O tick em SQL não pode contornar governança porque não tem como — ele só lê e decide se chama alguém.
3. **Reuso:** é o mesmo padrão `cron → pg_net → edge function` que já roda ~100 vezes no sistema. Não é arquitetura paralela; é o 101º job.

O trabalho novo é pequeno: 2 tabelas (`executor_ticks`, `executor_tentativas`), 1 função SQL (`fn_executor_tick`), 1 edge function (`executor-frente`), 1 coluna `frente_slug` em `go_ai_dev_runs`, 1 job de cron nascendo desligado.

---

## 15. Contrato necessário do GPS (para a outra sessão decidir)

**Não alterei nada. Reporto para quem é dono do GPS.**

### Item 1 — Custódia do `claim_token` para agente não-conversacional *(bloqueia o executor durável; não bloqueia o canário)*

- **Fato faltante:** não há forma prevista de um agente sem memória de conversa reter o `claim_token` entre invocações.
- **Por que o executor precisa:** `fn_frente_claim` devolve `claim_token` uma única vez e `fn_frente_heartbeat`/`fn_frente_finalizar_chat` o exigem. Uma edge function que morre entre invocações perde o token e não consegue nem renovar nem finalizar — a frente fica travada até a lease expirar.
- **Caso concreto:** executor captura `diego-timeout-fn-contexto-midia-ouro` às 10:00, a invocação atinge timeout às 10:02. Às 10:15 o próximo tick vê a frente ocupada por ele mesmo, sem poder agir. A frente fica indisponível até a expiração.
- **Tensão real:** guardar o token puro numa tabela do executor contradiz o comentário de `frentes_claims_segredo` (*"O token puro NUNCA e gravado"*). Não faço isso por conta própria.
- **Menor alteração possível (sugestão, não decisão):** permitir que `fn_frente_claim` aceite um `p_chat_id` estável de executor e reemita/revalide o token para o **mesmo** `chat_id` — mantendo o hash como fonte de verdade e sem enfraquecer a autenticação contra terceiros. Alternativa: `Vault` do Supabase como custódia, mantendo a regra "não grava em tabela comum".
- **Contorno no canário:** uma única invocação, token em memória, TTL 15 min. **Não depende desta decisão.**

### Item 2 — Frentes `acionavel=true` cujo próximo passo é, de fato, esperar

- **Fato:** `erp-seguranca-autorizacao-go-live` está `UNICA`/`acionavel`, mas seu `proximo_passo` diz *"Aguardar a próxima execução real de edge posterior a 16/08 02:07 UTC"*. Não há espera registrada em `frentes_espera`.
- **Por que importa:** o executor capturaria a frente, não teria o que fazer e a liberaria — o padrão exato de churn medido em §8. E ele **não pode** inferir a espera lendo prosa: `frentes_espera` proíbe explicitamente backfill *"por prosa, regex ou LLM"*.
- **Diagnóstico:** o **contrato é suficiente** — `frentes_espera` com `tipo='evento_organico'` já modela isso perfeitamente. O que falta é **registro**, não mecanismo.
- **Menor alteração:** o dono da frente registra a espera. Nenhuma mudança de schema. Enquanto não for registrada, o executor a trata via anti-loop (§8), que a colocará em quarentena após 2 tentativas sem progresso — degradação segura, mas desperdiça 2 claims.

---

## Regra final observada

Nada foi implementado. O GPS não foi redesenhado. Nenhuma autoridade nova foi criada. Alessandro não está no caminho feliz — aparece uma vez, para revisar o teto de orçamento mensal, que é decisão de dono por definição.

**Aguardo autorização para executar o canário da §10.**
