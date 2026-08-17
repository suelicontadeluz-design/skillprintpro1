# Executor — loop recorrente controlado

**17/08/2026 · frente `executor-loop-recorrente-controlado` (fechada)**
Chat `claude-executor-loop-20260817` · trilha `governanca`.

---

## 1. Débito do canário: corrigido

`fn_executor_registrar_rodada` ganhou `p_rodada_id` (default `gen_random_uuid()`, compatível com as chamadas antigas). **Uma rodada lógica = um registro.**

| Passo | `rodadas_total` | `repetida` |
|---|---|---|
| R1 — rodada A, 1ª chamada | 1 | false |
| R2 — rodada A, 2ª chamada (portão + desfecho) | **1** | **true** |
| R3 — rodada B, id novo | 2 | false |

A causa raiz era usar a função **mutante** como portão. Criado `fn_executor_pode_prosseguir(slug)` — `STABLE`, read-only — que responde se vale capturar sem contabilizar nada.

## 2. Desenho do loop

```
pg_cron (*/15)  ──► fn_executor_tick()          [SQL puro, sem LLM]
                     ├─ kill switch? → retorna, 0 ms
                     ├─ encerra esperas satisfeitas E auto-encerráveis
                     ├─ watchdog de heartbeat (só observa)
                     └─ fn_executor_proxima_tarefa()   [read-only]
                          ├─ varre as 18 trilhas
                          ├─ AMBIGUA / TODAS_AGUARDANDO / NENHUMA → descarta com motivo
                          ├─ quarentena ou sem fato novo → ESTACIONA, continua
                          └─ devolve a de menor prioridade

                     ▼
              trabalho existe? só então uma sessão Claude precisa acordar
```

## 3. Prova central — frente parada não bloqueia o sistema

Com **trabalho real, sem frente fake**:

- `diego-timeout-fn-contexto-midia-ouro` (frente do canário) → portão `pode=false`, motivo `sem_fato_novo`
- o seletor **estacionou `midia`** e escolheu `erp-seguranca-autorizacao-go-live` (`seguranca`, prioridade 1)
- segunda elegível: `isabela-rodada-incompleta-time-guard` (prioridade 2)

Varredura completa das 18 trilhas, cada descarte com motivo:

| Motivo | Trilhas |
|---|---|
| `AMBIGUIDADE` | 9 |
| `AGUARDA_EXTERNO` | 4 |
| `SEM_TRABALHO` | 2 |
| `SEM_PROGRESSO` | 1 (`midia`) |
| **elegíveis** | **2** |

É o *"manda a próxima"* substituído por SQL determinístico.

## 4. Custo ocioso

**168–183 ms de CPU Postgres por tick. Zero token.** Kill switch desligado devolve em ~0 ms sem tocar em nada.

96 ticks/dia ≈ 18 segundos de CPU por dia — dentro do compute já pago.

## 5. Limites e desligamento

| Limite | Valor |
|---|---|
| `max_frentes_por_rodada` | 1 |
| `max_segundos_por_rodada` | 900 |
| `limite_fraco` | 2 |
| `quarentena` | 24 h |
| `heartbeat_morto_apos` | 30 min |

**Duas camadas independentes de desligamento:** `cron.alter_job(143, active := false)` — já desativado — e `executor_config.habilitado = false` — já desligado. Entregue pronto, **não ligado**.

## 6. Comportamentos

| Situação | Comportamento |
|---|---|
| `SEM_PROGRESSO` | Estaciona a frente, segue para outra trilha, quarentena de 24 h **na tabela do executor, nunca em `frentes`** |
| Espera | Tick encerra **apenas** esperas com predicado **e** `permite_encerramento_automatico`. Bruno e Vera estão travados de propósito |
| `AMBIGUIDADE` | Nunca desempatada pelo executor. Trilha descartada com motivo; continua sendo decisão humana no GPS |
| `RISCO` | Não existe caminho automático para ação fora de política — `allow_*` seguem `false` e o executor não os altera |
| Heartbeat morto | Apenas observa e conta. **Não libera claim à força** |

## 7. O que roda 24/7 sem LLM

Detecção de trabalho, varredura do GPS, avaliação de esperas observáveis, encerramento de esperas autorizadas, quarentena, watchdog de heartbeat, log de ticks.

## 8. O que ainda depende do Claude Code

Todo trabalho de engenharia: ler contexto, decidir implementação, escrever código, testar, interpretar evidência, redigir prova. O tick sabe **que** há trabalho; não sabe fazê-lo.

## 9. Lacuna que permanece

**Supabase não tem caminho comprovado para acordar uma sessão Claude Code.** Não há `ANTHROPIC_API_KEY`, token CCR ou equivalente no ambiente, e a autenticação é OAuth atrás de proxy local — verificado na rodada 2.

Consequência: a camada determinística **detecta** trabalho mas não consegue **disparar** quem o executa. O despertar continua auto-agendado de dentro da plataforma Claude (Routine), com cadência por relógio, não por chegada de trabalho.

Não inventei endpoint nem credencial.

## 10. Rollback

`backup_executor_loop_20260817` guarda a definição anterior de `fn_executor_registrar_rodada`. Reverter: restaurar essa definição e dropar `fn_executor_pode_prosseguir`, `fn_executor_proxima_tarefa`, `fn_executor_tick`, `executor_config`, `executor_ticks`, as colunas `ultima_rodada_id`/`ultima_decisao`, e `cron.unschedule(143)`. Nada em `frentes` foi mutado.
