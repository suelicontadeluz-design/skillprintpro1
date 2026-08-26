# R44 — backfill dos 17 deals won ausentes de `pixel_events`

Executado em 2026-08-26 13:54:03 UTC. **17 Purchase criados, zero atribuicao
fabricada, zero efeito em agentes ou operacao.**

## Gate que quase bloqueou: triggers AFTER INSERT

`pixel_events` tem 8 triggers AFTER INSERT. Dois agem por `lead_id`
**sem nenhum filtro de data**:

```sql
-- fn_cancelar_disparos_apos_compra
UPDATE waba_disparos_lista SET status='removido'
 WHERE lead_id = NEW.lead_id AND status IN ('pendente_envio','ativo');

-- fn_trigger_feedback_purchase
UPDATE crm_tasks SET convertido_em_venda=true, status='concluida',
       data_resultado=NOW(), resultado_registrado_por='pixel_events_auto'
 WHERE lead_id = NEW.lead_id AND status IN ('pendente','em_andamento');
```

Uma venda de janeiro cancelaria disparos e fecharia tarefas **de hoje**.

Raio medido antes da escrita: os 14 leads tem 10 disparos e 68 tarefas, mas
**0 nos estados que os triggers tocam**. Risco real no mecanismo, nulo no dado
atual — e por isso virou guarda de abort na transacao, nao premissa.

## Idempotencia futura — provada

`rd-won-pixel-sync` v56 faz, antes de decidir:

```js
.in("event_id", dealIds.map(id => `rd_won_${id}`))
if (existingSet.has(eventId)) { ja_existia++; continue; }
```

Usando `event_id = 'rd_won_' || deal_id`, uma execucao futura marca
`ja_existia` e nao cria segunda linha. Protecao dupla: a v56 le apenas a
pagina 1 (100 deals mais recentes por `closed_at`) e estes fecharam entre
28/01 e 20/03.

## Reancoragem — 17/17 na RD ao vivo

GET individual por `deal_id`: 17/17 HTTP 200, `status='won'`, pipeline de
vendas, `total_price` = `valor_sinc` = **R$14.011,85**, `closed_at` presente.

## Semantica do candidato = semantica do v56

Insert com exatamente as mesmas 7 colunas que a v56 grava:

```sql
insert into pixel_events (lead_id, event_name, event_time, event_id, event_source, value, currency)
select c.lead_id,'Purchase',c.rd_closed_at,'rd_won_'||c.deal_id,'chat',c.rd_total_price,'BRL'
```

Diff contra o produtor normal: **nenhum**. `event_time = closed_at` (fato
representado e o fechamento comercial, nao o backfill). `value` = `total_price`
vivo da RD. `lead_id` = resolver v56, 17/17 RESOLVE_UNICO.

## Guardas, todas aprovadas em transacao unica

| guarda | resultado |
|---|---|
| revalidacao (RD won + valor + lead unico + sem Purchase) | 17 |
| inseridos | 17 |
| campos corretos (lead, value, event_time) | 17 |
| **campanha fabricada** | **0** |
| deals com 2 representacoes | 0 |
| Purchase (delta) | 1582 -> 1599 (+17) |
| **canonical deals (delta)** | **1355 -> 1372 (+17)** |
| compradores | 500 -> 503 |
| receita representada | 630.711,00 -> 644.722,85 (+14.011,85) |
| `waba_disparos_lista` | 752 -> 752 |
| `crm_tasks` convertidas | 300 -> 300 |
| `ai_decision_evaluations` | 125 -> 125 |
| `vera_retencao_eventos` | 163 -> 163 |
| `lead_score_refresh_queue` | +13 |

Ensaio em transacao revertida antes: ins=17, campos=17, campanha=0, del=17,
sobra=0, e os mesmos deltas nas tabelas de efeito colateral.

## Campos derivados (politica da R41 respeitada)

Nao escrevi `state`, `content_category` nem `product_type`. Os triggers normais
derivaram: `state` 17/17, `content_category` 17/17, `product_type` 14/17 (os 3
restantes tem categoria de segmento, que a regra mapeia para NULL). Seguem
desqualificados como evidencia canonica.

## Atribuicao

**17/17 sem `campaign_id`, `adset_id`, `ad_id`, `source` ou `medium`.**
16 dos 17 leads nao tinham campanha historica; o unico que tem nao recebeu,
por falta de evidencia temporal daquela aquisicao. Nenhuma recompra virou
aquisicao.

## Primeira compra x recompra

Pela ordem temporal real: **9 recompra, 8 primeira compra conhecida**.
Compradores unicos subiram de 500 para 503 — os outros 14 deals sao de clientes
que ja apareciam na base.

## Correcao de subcontagem, nao efeito indesejado

Purchase +17 e receita representada +R$14.011,85 sao **CORRECAO_DE_SUBCONTAGEM**:
os fatos sao won confirmados na RD, com `event_time` = `closed_at` real, sem
atribuicao inventada. As series historicas de jan-mar mudam porque estavam
erradas para menos.

## Ainda ausentes

| antes | depois |
|---|---|
| 54 deals / R$33.143,65 | **37 deals / R$19.131,80** |

Composicao dos 37: 24 sem lead, 8 ambiguos, 4 ja representados por
`csv_backfill`, 1 inexistente na RD (404). **Cobertura NAO esta completa** e
esses 37 seguem UNKNOWN/PARTIAL.

Os 329 orfaos do mapa permanecem 329 — nao reparados, por escopo.

## Rollback

`public._r44_candidatos` (17 linhas, PK `deal_id`) com deal, event_id futuro,
lead, event_time, value e a evidencia RD.

```sql
delete from pixel_events p using public._r44_candidatos c
 where p.event_id = c.event_id_futuro and p.event_name='Purchase';
-- esperar rowcount 17
```

Ressalva honesta: o rollback e exato em `pixel_events`, mas **nao desfaz** duas
residuos benignos — 13 linhas em `lead_score_refresh_queue` (fila drenada pelo
cron 144, recalculo idempotente) e 17 em `debug_pixel_events_inserts` (log de
auditoria append-only, que deve mesmo permanecer).
