# Gate 7C — statement timeout: diagnóstico, causa raiz e prova

Projeto Supabase: `ldrdtaibazplvrbwyrvx`
Medição ao vivo em: 2026-09-05 ~21:32 UTC (18:32 BRT)

## 1. Causa raiz (provada por plano)

Job cron `152` / `cortex_gate7c_auto_arm_recurrent_inbound_v1`, schedule `* * * * *`,
comando `select public.fn_gate7c_auto_arm_recurrent_inbound_v1(15,30,false);`.

A versão da função vigente durante o incidente varria `fact_conversations` (292.974 linhas, 464 MB) com:

```sql
fc.created_at >= clock_timestamp() - make_interval(mins => p_lookback_minutes)
```

`clock_timestamp()` é **VOLATILE**. O planner não pode usar função volátil como
limite de range de índice, então o predicado temporal é rebaixado de `Index Cond`
para `Filter` avaliado linha a linha. Resultado: percorre todo o ramo
`direction='inbound'` do índice (125.251 linhas) para devolver 2.

### Prova A/B do mesmo predicado (EXPLAIN ANALYZE, BUFFERS)

| Variante | Execution Time | Buffers | Rows Removed by Filter |
|---|---|---|---|
| `clock_timestamp()` (VOLATILE) | **19.693,963 ms** | 93.622 | 125.251 |
| `now()` (STABLE) | **0,847 ms** | 10 | 0 |

- VOLATILE: `Index Cond: (direction = 'inbound')` + `Filter: (created_at >= clock_timestamp() - '00:15:00')`
- STABLE:   `Index Cond: ((direction = 'inbound') AND (created_at >= now() - '00:15:00'))`

Ganho: **~23.250x**. Índice usado nos dois casos: `idx_fc_direction_created_at`.

Como o cron dispara a cada 60 s e cada execução levava 20–120 s, as execuções se
sobrepunham e cada uma lia ~270 MB de disco, evictando o buffer cache — o que
explica o dano colateral em statements não relacionados.

## 2. Patch

O patch corretivo **já estava aplicado** quando esta frente começou, pela migration
`20260905162305_gate7c_auto_arm_use_stable_now_for_indexes` (2026-09-05 16:23 UTC),
que trocou `clock_timestamp()` por `now()`. Nenhuma migration adicional foi
necessária: esta frente é diagnóstico, prova e não-regressão.

Varredura do mesmo padrão (`(>=|>|<=|<)\s*clock_timestamp\(\)\s*-`) em todas as
funções de `public`: resta apenas
`fn_gate7c_commercial_bridge_fence_acquire_v1`, que opera sobre
`gate7c_commercial_bridge_fences` (1 linha) — sem risco de escala.

## 3. Antes → depois (produção)

| Janela | Falhas | OK | Tempo médio |
|---|---|---|---|
| 04/09 22:00 → 05/09 11:45 UTC (incidente) | 170 | — | até 113–115 s/h |
| Desde 16:23 UTC (pós-patch) | **0** | **310** | **0,184 s** |

Predicado em produção hoje: `Index Cond: ("timestamp" >= now() - '00:15:00')`,
Execution Time **0,195 ms**.

## 4. Janelas cegas e não-regressão do Gate 7C

Reconstruídas a partir de `cron.job_run_details` na janela 04/09 21:05 → 05/09 10:05 UTC:
5 janelas > 15 min, pior de **38,2 min** (00:29:55 → 01:08:05 UTC = 21:29 → 22:08 BRT).
Confere com o briefing.

Inbounds não cobertos por nenhuma execução bem-sucedida: **38 inbounds / 11 leads**
(superset do 34/10 do briefing; a diferença é definicional de cobertura).

Revalidação dos 11 leads contra o critério atual da função:
**zero elegíveis ao Gate 7C.** Nenhuma venda perdida comprovada.

Nenhum arm foi criado nas últimas 48 h; nenhum fence ativo. Gate segue `7C / PENDING`.
Portanto os 0,184 s **não** são early-return: a query pesada roda de fato.

## 5. Contexto canônico

`contexto_canonico_rpc_erro` vem da edge function `agente-noturno`, que chama
`public.fn_contexto_comercial_do_lead(p_lead_id)` (LANGUAGE sql, STABLE, SECURITY INVOKER).
Por contrato a falha é fail-closed: timeout ⇒ `comportamento='fail_closed'`, sem
fallback para o deal legado.

A RPC **não tem lentidão intrínseca**: medida agora em ~90 ms/lead nos 6 leads que
falharam. Tabelas envolvidas são pequenas e indexadas
(`lead_identificadores` 16k, `crm_deal_snapshot` 11k).

Correlação temporal das 10 ocorrências:
- 8 caem dentro do surto do job 152 (04/09 22:53 → 05/09 11:05 UTC);
- 2 caem dentro de um surto anterior e distinto (02/09 22:25 → 03/09 11:56 UTC)
  que atingiu 9 outros jobs (115, 146, 116, 117, 129, 134, 143, 130, 120) e **não** o 152.

Conclusão: **mesmo sintoma, causa por contenção**. Na segunda janela a causa foi o
job 152. A primeira janela teve causa própria, não investigada nesta frente.

Desde 16:23 UTC: 0 erros de contexto canônico e 0 statement timeouts em qualquer job.

## 6. Revisão hostil — achados abertos

### 6.1 Ponto cego de captura: `"timestamp"` vs `created_at` (NÃO corrigido)

Em 100% dos 26.901 inbounds de 30 dias, `created_at > "timestamp"` (p99 lag 49 s,
máx 1.211 s = 20,2 min). A função filtra a janela por `"timestamp"` com lookback de
15 min. Como um inbound só é visível a partir de `created_at`, ele é capturável
somente se `lag <= 15 min`. Logo **todo inbound com lag > lookback nunca é visto por
nenhum tick** — perda permanente, não atraso.

Em 180 dias esse conjunto contém leads que o critério atual classifica como
**elegíveis** (ex.: `3a6d8372…` 16 compras/ANTECIPAR_RECOMPRA em 01/09;
`9abb20c2…` 18 compras/REATIVAR; `3200410b…` 8 compras/ANTECIPAR_RECOMPRA).

A correção ingênua (janela em `created_at`) é **perigosa**: há backfills, incluindo
um inbound de 2023-11-14 gravado em 2026-03-30 (lag 1.248.392 min), que passariam a
ser tratados como inbound recente e poderiam armar o Gate sobre quem não falou.
Uma correção correta precisa combinar visibilidade (`created_at`) com sanidade de
tempo de negócio, e **altera o conjunto de elegíveis** — fora do escopo desta frente.

### 6.2 Cliff de plano por custo de guardrail (NÃO corrigido)

`fn_gate7c_recurrent_inbound_guardrail_v1` custa **425 ms por chamada** (VOLATILE,
não escreve) e é avaliada por linha candidata — e provavelmente mais de uma vez por
linha, já que a CTE `matched` é inlined e o predicado externo referencia `guardrail`
duas vezes.

Escala medida via dry-run:

| lookback | leads | tempo |
|---|---|---|
| 15 min | 1 | 46 ms |
| 720 min | 32 | 52 ms |
| 1440 min | 46 | **21.589 ms** |

O join a `vw_venda_identidade` custa apenas 59,7 ms em 24 h, então o custo é do
guardrail. Em 15 min o volume atual é de 1–4 leads, com folga grande, mas o
crescimento é linear no nº de candidatos: um pico de campanha reaproxima os 120 s.
Mitigação candidata (não aplicada): `matched as materialized (...)` para eliminar
reavaliações redundantes.

### 6.3 Cron sem guarda de sobreposição (NÃO corrigido)

`* * * * *` sem advisory lock. pg_cron não pula tick quando o anterior ainda roda;
foi essa pilha que transformou uma query lenta em contenção sistêmica que derrubou
o contexto canônico. Com a query em 0,18 s o risco está dormente, não eliminado.

### 6.4 Verificações que passaram

- `prosecdef` inalterado (`fn_gate7c_auto_arm_recurrent_inbound_v1` segue SECURITY DEFINER com `search_path` fixo); nenhuma mudança de privilégio ou RLS foi feita por esta frente.
- Nenhum índice criado ou removido.
- `fn_gate7c_commercial_bridge_arm_check_v1` é read-only — dry-run não tem efeito externo.
- Ordenação do candidato permanece determinística; `distinct on` impede duplicata por lead.
- Nenhum arm foi criado para teste; nenhuma elegibilidade fabricada.
