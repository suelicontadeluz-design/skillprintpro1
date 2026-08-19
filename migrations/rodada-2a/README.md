# Rodada 2A — fechamento estrutural, sem efeito externo

Data: 19/08/2026 · Projeto Supabase `ldrdtaibazplvrbwyrvx`

## Migrations aplicadas (na ordem)

| version | nome | efeito |
|---|---|---|
| 20260819185558 | `r2a_fase1_separar_impacto_atribuido_de_proposto` | `impacto_total_atribuido` passa a exigir conversão; nova coluna `impacto_proposto_nao_confirmado` |
| 20260819185958 | `r2a_fase2_identidade_objeto_decisao` | `+objeto_tipo`, `+objeto_id`, índice, `fn_registrar_decisao_agente` com 2 params opcionais |
| 20260819190028 | `r2a_fase2_backfill_objeto_campanha` | 198 decisões recebem identidade de campanha |
| 20260819190208 | `r2a_fase3_vincular_observacoes_campanha` | `fn_r2a_vincular_observacoes_campanha` (dry-run por padrão) |
| 20260819190358 | `r2a_fase4_elegibilidade_por_grao` | caminho A (lead) OU caminho B (objeto + efeito externo) |
| 20260819190658 | `r2a_fase5_metas_camila_dora_tiago` | Camila, Dora e Tiago passam a ser medidos; status `sem_execucao` |
| 20260819190840 | `r2a_fase7_instrumento_reuso_aprendizado` | `fn_agente_registrar_uso_aprendizado` |

## Edge Functions

| função | antes | depois | rollback |
|---|---|---|---|
| `agente-insights` | v58 / `agente-insights-v2.6.0` | v59 / `agente-insights-v2.7.0` | redeploy de `baseline/edge/agente-insights/index.ts` |

As outras quatro edge functions no escopo **não foram alteradas**.

## Rollback

`ROLLBACK.sql` desfaz tudo na ordem inversa. Os `\i` referenciam os arquivos de
`baseline/sql/`, que são o DDL canônico capturado antes da rodada.

Nenhuma linha de produção é destruída: o rollback apenas esvazia as colunas novas
e restaura as definições anteriores de view e função.
