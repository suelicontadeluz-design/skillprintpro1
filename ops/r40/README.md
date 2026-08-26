# R40 — fechamento dos 329 `pixel_crm_sync_map` sem evento

Rodada READ-ONLY de 2026-08-26. Nenhuma escrita.

## 1. Origem — PROVADA por evidencia primaria

`debug_pixel_events_inserts` guarda o texto da query originadora. Os 16 orfaos
que aparecem la mostram:

```
application_name: postgrest|sess=authenticator|curr=postgres
usename:          authenticator
query:            WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM
                  (SELECT "public"."fn_sync_crm_pixel_insert"() pgrst_scalar) ...)
janela:           2026-05-18 21:05 -> 2026-05-27 21:05
```

Os UUIDs nasceram do `gen_random_uuid()::text` dentro de
`fn_sync_crm_pixel_insert()`, chamada por PostgREST (crons 21/22/23 da
`crm-pixel-sync`, hoje aposentada).

## 2. Quem apagou — NAO DETERMINADO, com duas hipoteses refutadas

Nenhuma funcao SQL viva apaga `pixel_events` (varredura completa de `pg_proc`:
zero resultados para `DELETE FROM pixel_events`).

**Hipotese A — `fn_sync_crm_pixel_remove()`. REFUTADA.**
A funcao existia e apagava exatamente assim:

```sql
WITH saidos AS (
  SELECT m.deal_id, m.event_id FROM pixel_crm_sync_map m
  LEFT JOIN crm_deals_cache d ON d.id = m.deal_id AND d.status = 'won'
  WHERE d.id IS NULL),
del_pixel AS (DELETE FROM pixel_events pe USING saidos s WHERE pe.event_id = s.event_id::text ...)
DELETE FROM pixel_crm_sync_map m USING saidos s WHERE m.deal_id = s.deal_id;
```

Foi **desarmada em 2026-08-02 02:07:36**, com o motivo registrado em
`backup_funcoes_desarmadas`: "Apagava pixel_events via LEFT JOIN
crm_deals_cache WHERE d.id IS NULL, tratando ausencia de leitura como saida de
won. Cache parcial e congelado em 18/05/2026."

Mas o teste falsificavel derruba a hipotese: **507/507 deals do mapa (orfaos e
vivos) estao em `crm_deals_cache` com `status='won'`**. O predicado
`d.id IS NULL` nunca seria verdadeiro para nenhum deles. Ela nao pode ter sido.

(Junto dela foi desarmada `fn_sync_crm_pixel_update`, que sobrescrevia `value`
a partir do mesmo cache congelado.)

**Hipotese B — multiplos leads por deal gerando eventos extras. REFUTADA.**
Distribuicao de leads casando por telefone e praticamente identica entre
orfaos (295 com 1 lead, 1 com varios) e vivos (168 com 1 lead, 1 com varios).

**Tambem descartado:** 0 rastro em quarantine (144 linhas UUID), lixo,
apagados_*, classif_*, separacao_*, backfill_tardia, lab_eventos, pageview,
fact_events_marketing, capi_eventos_log, consolidacao 02/08, R38. As unicas
migrations com DELETE em pixel_events sao de abril e removem 1 evento nomeado.

Conclusao honesta: **INDETERMINADO**. A remocao veio de fora do banco (edge ou
SQL manual) e nao deixou artefato.

## 3. Os 205 com `rd_won_` — o survivor esta correto

| prova | resultado |
|---|---:|
| deal_id identico | 205/205 |
| exatamente 1 Purchase hoje | **205/205** |
| mesmo lead que o mapa registrou | 196/205 |
| mesmo valor que o mapa registrou | 202/205 |
| valor bate com a RD viva | 202/205 |

Nao ha duplicacao remanescente nesses 205. A linha do mapa e apenas um recibo
histórico obsoleto.

## 4. Os outros 124

- **1** deal representado por `won_`
- **123** deals sem nenhum Purchase por prefixo; destes **121 estao won na RD
  hoje**. Checagem limitada por lead+valor: 69 tem Purchase por outra rota,
  **54 nao tem indicio algum — R$33.143,65**.

Esse e o unico achado com risco economico da rodada, e e de SUB-contagem.

## 5. Reparo deterministico do mapa

| situacao | n | valor_sinc |
|---|---:|---:|
| alvo unico (reparavel sem ambiguidade) | **206** | — |
| alvo ambiguo | **0** | — |
| sem alvo | 123 | 60.825,31 |

206 de 329 podem ser repontados deterministicamente para o unico Purchase vivo
do deal. Os 123 nao tem para onde apontar.

## 6. Impacto sobre o bloco dos 20 — nenhum

| verificacao | resultado |
|---|---:|
| UUID do bloco ainda vivo | 20/20 |
| linha de mapa viva (nao orfa) | 20/20 |
| deal tocado por algum orfao | **0/20** |

O bloco dos 20 esta inteiramente na parte sa do mapa. Os 329 nao o afetam.

## 7. Veredito

- Origem: **PROVADA**
- Processo de delecao: **INDETERMINADO** (duas hipoteses refutadas por teste)
- Mapa: **HISTORICO_VALIDO, REPARAVEL EM 206/329**
- Bloco dos 20: **LIBERADO, sem dependencia dos orfaos**
