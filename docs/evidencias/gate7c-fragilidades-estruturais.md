# Gate 7C — fragilidades estruturais: inbound tardio, sobreposição de cron e cliff de plano

Projeto Supabase: `ldrdtaibazplvrbwyrvx`
Medição ao vivo em 2026-09-05, 21:47 → 22:00 UTC.

Escopo desta rodada: fechar, se tecnicamente possível, as três fragilidades
remanescentes. O incidente de `clock_timestamp()` não foi reaberto.

Resultado: **2 de 3 fechadas**. A terceira exige decisão comercial e foi parada
com evidência, conforme instruído.

---

## 1. Inbound tardio — NÃO CORRIGIDO (exige decisão comercial)

### Medição (inbound, 180 dias, 125.259 linhas, zero `timestamp` nulo)

`created_at > "timestamp"` em 100% das linhas.

| p50 | p95 | p99 | p99.9 | máx |
|---|---|---|---|---|
| 2,3 s | 14,8 s | 79,8 s | 3.516,4 s | 74.903.551 s |

Lag > 15 min: 272 · lag > 1 h: 124 · lag > 1 dia: 1.

Restringindo ao universo que o Gate 7C considera (`lead_id` e `phone` não nulos):
**92 linhas**, classificadas por densidade de ingestão no minuto:

| tipo | linhas | leads | faixa de lag |
|---|---|---|---|
| BACKFILL_LOTE (≥5 linhas tardias no mesmo minuto) | 70 | 18 | 15,1 – 88,6 min |
| ATRASO_OPERACIONAL (isolado) | 21 | 12 | 16,0 – 97,6 min |
| BACKFILL_ANTIGO | 1 | 1 | 1.248.392,5 min |

### Por que não é fechável sem decisão comercial

Dois bloqueios, ambos medidos:

1. **As faixas de lag se sobrepõem.** Backfill em lote vai de 15,1 a 88,6 min;
   atraso operacional real vai de 16,0 a 97,6 min. Não existe limiar de idade
   de evento que separe os dois conjuntos.
2. **Não há sinal de proveniência.** `source = 'zapi'` em 100% das linhas dos
   três tipos. A tabela não carrega marca de replay/backfill.

A única separação encontrada foi densidade de ingestão (≥5 linhas tardias no
mesmo minuto), que é heurística sobre o processo de ingestão, não propriedade
da mensagem — não serve como garantia.

Além disso, a regra atual, como implementada, exclui esses eventos por
construção: um inbound só é visível a partir de `created_at`, e nesse instante
sua idade já é `lag`; se `lag > lookback`, não existe tick algum em que ele
esteja simultaneamente visível e dentro da janela. Recuperá-los **é alargar a
regra**, não corrigir o mecanismo.

### O que falta decidir (não decidido aqui)

Qual a idade máxima de mensagem que ainda conta como conversa viva para armar
o Gate. Hoje esse valor está implicitamente acoplado ao lookback de 15 min.
Enquanto não houver essa definição — ou uma marca de proveniência na ingestão —
qualquer correção admite backfill como conversa recente ou continua perdendo
atraso legítimo.

Impacto de continuar como está: leads que o critério atual classificaria como
elegíveis seguem podendo desaparecer (ex.: `3a6d8372…`, 16 compras,
ANTECIPAR_RECOMPRA, 01/09).

---

## 2. Sobreposição do cron — CORRIGIDO

Migration `20260905214711_gate7c_auto_arm_no_overlap_advisory_xact_lock`
(aplicada 2026-09-05 21:47:11 UTC).

`pg_try_advisory_xact_lock(hashtextextended('gate7c-auto-arm-recurrent-inbound-v1', 0))`
= `-3609162911661594235`, tomado após a validação de parâmetros e antes de
qualquer leitura pesada. Sem colisão com as 20 chaves advisory já usadas no
projeto. Liberado automaticamente no fim da transação, inclusive em exceção ou
morte do backend: sem tabela nova, sem limpeza manual.

Segunda execução retorna `SKIPPED_ALREADY_RUNNING` com `external_effect=false`
— saída limpa, não é erro.

### Prova de concorrência real

Job cron temporário (jobid 165, dry-run, reportando status via `raise exception`)
executando em backend separado:

| horário | job | duração | resultado |
|---|---|---|---|
| 21:50:00.186 | 152 | 0,143 s | execução normal (pegou o lock) |
| 21:50:00.195 | 165 | 0,025 s | `SKIPPED_ALREADY_RUNNING` |
| 21:51:00 | 152 e 165 | 0,021 / 0,009 s | ambos `SKIPPED` (lock retido por sessão externa) |
| 21:53:00.149 | 152 | 0,134 s | execução normal |
| 21:53:00.184 | 165 | 0,003 s | `SKIPPED_ALREADY_RUNNING` |

Os pares 21:50 e 21:53 são **sobreposição real de produção**, não simulada: o
165 disparou 9 ms e 34 ms depois do 152 e foi corretamente barrado.

Sem deadlock. O job 152 não registrou status de erro em nenhum caso. Zero arms
criados. Zero advisory locks vazados após o teste. Job temporário removido.

---

## 3. Cliff de plano — CORRIGIDO (a causa suposta estava errada)

### Correção do diagnóstico anterior

A rodada anterior atribuiu o cliff ao `fn_gate7c_recurrent_inbound_guardrail_v1`
(425 ms/chamada). **Isso estava errado.** Medido isoladamente, o guardrail custa
156 ms, dos quais 126 ms são a `fn_tiago_guardrail_whatsapp_v2` aninhada — e o
custo não escala com o número de candidatos.

### Causa real

`EXPLAIN (ANALYZE, BUFFERS)` da consulta completa em lookback 1440:

```
GroupAggregate (actual time=1.319..13170.052 rows=6733 loops=1)
  -> Index Only Scan using ix_fc_lead_dir_ts on fact_conversations
     (rows=284418) (actual time=0.020..13114.586)
```

13,1 s de 14,5 s numa agregação de toda a `fact_conversations` dentro de
`vw_mapa_pessoa_v2`, materializada para os 16.410 leads a fim de produzir 1 linha.
Não é N+1 — é plan flip, e o custo não é proporcional ao número de candidatos.

A raiz do custo por linha: `Heap Fetches: 2280` de 3.083 linhas. A
`fact_conversations` (292.974 linhas, 464 MB) **nunca havia passado por vacuum**
(`last_vacuum` e `last_autovacuum` nulos), então a visibility map estava vazia e
todo Index Only Scan degenerava em acesso ao heap.

### Patch

`VACUUM (ANALYZE) public.fact_conversations` — 6,9 s. Sem alteração de dado,
regra, privilégio ou resultado de consulta.

Executado via job cron pontual porque a ferramenta MCP envolve as chamadas em
bloco transacional e VACUUM não roda dentro de transação. Job removido em seguida.

### Antes → depois

| medição | antes | depois |
|---|---|---|
| `vw_mapa_pessoa_v2` para 1 lead | 1.886 ms | **61 ms** |
| função, lookback 15 min (produção) | 46 ms | **29 ms** |
| função, lookback 720 min | 52 ms | **26 ms** |
| função, lookback 1440 min | 21.589 ms | **240 ms** |
| Heap Fetches no scan de `fact_conversations` | 2.280 / 3.083 | **0–1** |

Stress em cardinalidade maior (consulta de candidatos direta, o limite de
1..1440 da função impede via dry-run):

| lookback | leads | tempo |
|---|---|---|
| 1.440 (1 dia) | 48 | 233 ms |
| 5.760 (4 dias) | 286 | 253 ms |
| 10.080 (7 dias) | 448 | 218 ms |
| 20.160 (14 dias) | 802 | 269 ms |
| 43.200 (30 dias) | ~1.800 | 1.160 ms |

Curva suave até 30 dias de janela. Em produção (15 min) a margem contra o
`statement_timeout` de 120 s é de ~4.000x.

### Durabilidade

Migration `20260905220118_fact_conversations_autovacuum_insert_cadence_for_visibility_map`:
`autovacuum_vacuum_insert_scale_factor = 0.02`.

Com os defaults (threshold 1000, scale 0.2) o autovacuum por inserção só
dispararia a cada ~59.600 inserções; a ~2.111 inserções/dia isso é uma vez por
mês, e a visibility map degradaria progressivamente, devolvendo o cliff. Com
0.02 o gatilho cai para ~6.900 inserções (~3 dias).

---

## 4. Não-regressão semântica

O SQL de seleção de candidatos **não mudou um byte**. MD5 do bloco
`with recent_inbound … limit 1;` extraído do texto armazenado das migrations:

| migration | hash | tamanho |
|---|---|---|
| `20260905154315` (penúltima) | `63a6869da551cb1b1d7818a04e3b1fdc` | 3.427 |
| `20260905162305` (vigente antes desta rodada) | `ec5c818ac8422604cfdb319783235742` | 4.228 |
| `20260905214711` (esta rodada) | `ec5c818ac8422604cfdb319783235742` | 4.228 |
| função em produção agora | `ec5c818ac8422604cfdb319783235742` | 4.228 |

A comparação é não-circular (usa o texto gravado da migration anterior, não o
que escrevi) e o hash é discriminante — detecta a diferença da penúltima versão.

A única mudança de comportamento é o novo caminho `SKIPPED_ALREADY_RUNNING`.
VACUUM e ANALYZE afetam escolha de plano, nunca conjunto de resultados.

---

## 5. Revisão hostil

| tentativa | resultado |
|---|---|
| atraso de ingestão > 15 min | **ainda perde** — item 1, não corrigido |
| atraso de 1 h | ainda perde (124 linhas em 180 dias) |
| backfill de meses/anos | corretamente rejeitado pela regra atual (janela em `"timestamp"`) |
| dois ticks simultâneos | barrado; provado com sobreposição real de produção |
| exceção durante o lock | xact lock liberado no abort; o job de teste levantava exceção a cada tick e os ticks seguintes rodaram normalmente |
| processo morto | xact lock liberado na morte do backend (garantia do Postgres) |
| retry no minuto seguinte | skip não é erro; o tick seguinte executa normalmente (21:53:00) |
| deadlock com fence/arm | o arm usa chave distinta (`gate7c-commercial-bridge-arm:<tenant>`) e só esta função usa a chave nova — não há ciclo de espera |
| `NULL` em `timestamp` | zero linhas nulas em 180 dias; o predicado de range já exclui NULL |
| múltiplos inbounds do mesmo lead | `distinct on (lead_id)` garante 1 linha por lead |
| duplicidade de arm | inalterado: cooldown de 24 h + `ACTIVE_ARM` + preflight |
| volume 2x / 5x / 10x / 17x | testado até 30 dias de janela (~1.800 leads): sem cliff |
| plano com cardinalidade maior | curva suave; o plan flip que existia era efeito da visibility map, não da cardinalidade |
| RLS | `fact_conversations.relrowsecurity = false`, inalterada |
| grants | `postgres` e `service_role` com EXECUTE; sem `anon`/`authenticated`; inalterado |
| SECURITY DEFINER / search_path | `prosecdef = true`, `search_path = pg_catalog, public` — inalterados |
| ampliação de privilégio | nenhuma |
| limpeza | `dblink` removido, jobs temporários removidos, 0 advisory locks pendentes, 0 arms criados |

### Riscos remanescentes

1. **Inbound tardio segue podendo sumir** (item 1) — bloqueado em decisão comercial.
2. **Ordenação com empate total** entre dois candidatos deixa o `limit 1`
   não-determinístico. Defeito pré-existente, não introduzido aqui; não observado
   em produção.
3. O ganho do item 3 depende do autovacuum honrar a nova cadência; a primeira
   confirmação só virá com ~6.900 inserções (~3 dias).
4. Observação pós-patch é de ~13 minutos (11 execuções, 0 falhas, média 0,117 s).
   Curta: o pior horário histórico (22:00–01:00 UTC) ainda não foi atravessado.

---

## 6. Migrations aplicadas

| versão | nome | horário UTC | objeto |
|---|---|---|---|
| `20260905214711` | `gate7c_auto_arm_no_overlap_advisory_xact_lock` | 21:47:11 | `public.fn_gate7c_auto_arm_recurrent_inbound_v1` |
| `20260905220118` | `fact_conversations_autovacuum_insert_cadence_for_visibility_map` | 22:01:18 | `public.fact_conversations` (reloptions) |

Ação de manutenção fora de migration (VACUUM não roda em transação):
`VACUUM (ANALYZE) public.fact_conversations`, 2026-09-05 21:54:05 UTC, 6,9 s.
