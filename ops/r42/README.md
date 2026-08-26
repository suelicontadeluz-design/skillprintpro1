# R42 — consolidacao dos 20 grupos `rd_won + uuid`

Executada em 2026-08-26 13:38:20 UTC. **20 aliases removidos, 20 negocios
preservados, atribuicao migrada em 12.**

## Correcao de um erro meu na R41

A R41 reportou `PRECISA_MIGRAR_ATRIBUICAO = 0`. **Estava errado.** Aquele zero
descrevia conflitos resolvidos, nao lacunas. A remedicao ao vivo antes da
escrita mostrou:

| campo | lacunas a migrar | conflitos |
|---|---:|---:|
| campaign_id | 10 | **0** |
| adset_id | 10 | **0** |
| ad_id | 10 | **0** |
| source | 8 | **0** |
| medium | 4 | **0** |

12 dos 20 grupos precisavam migrar algo. Zero conflitos (nenhum caso D), entao
o gate passou — mas com migracao, nao sem ela. Se eu tivesse confiado no proprio
relatorio anterior, 10 campanhas teriam sido apagadas.

Outros campos de aquisicao no evento (`visitor_id`, `page_url`, `referrer`):
zero preenchidos no alias. Nao existem fbp/fbc/fbclid em `pixel_events`.

## Politica aplicada em `content_category` / `product_type`

Politica C da R41: **nao migrados, nao corrigidos**, valor fisico do survivor
mantido, ambos declarados desqualificados como evidencia de produto. A pergunta
de produto usa `deal_produtos_rd_obs` (cobertura 20/20). O snapshot jsonb do
alias no artefato preserva os valores historicos removidos.

## Triggers auditados antes da escrita

- `fill_pixel_events_utms_from_page_url` — so age com `page_url` nao nulo; os
  survivors tem `page_url` NULL. No-op.
- `fill_pixel_events_user_agent_fields_from_pageview` — so age com `visitor_id`
  nao nulo; NULL nos survivors. No-op.
- `fn_enrich_pixel_events_user_agent` — poderia preencher
  `device_type`/`browser`/`operating_system` no UPDATE. Guarda dedicada mediu
  **efeito colateral = 0** no ensaio e na execucao.

## Guardas, todas aprovadas em transacao unica

| guarda | resultado |
|---|---|
| revalidacao do bloco | 20 |
| migracoes esperadas x aplicadas | 12 = 12 |
| survivor = snapshot + campos migrados | 20 |
| efeito colateral tecnico | **0** |
| mapas repontados | 20 |
| aliases deletados | 20 |
| exatamente 1 Purchase por deal | 20 |
| Purchase (delta) | 1602 -> 1582 (-20) |
| receita (delta) | 642.302,18 -> 630.711,00 (-11.591,18) |
| compradores | 500 -> 500 |
| **canonical deals** | **1355 -> 1355** |
| orfaos do mapa (delta) | 329 -> 329 |

Ensaio em transacao revertida antes: migrados 12, survivor exato 20, efeito
colateral 0, mapa 20, delete 20, e restauracao **byte a byte de alias 20/20 e
survivor 20/20**. `session_replication_role` confirmado em `origin` depois.

## Atribuicao preservada

| campo | migrados | conferidos apos commit |
|---|---:|---:|
| campaign_id | 10 | **10/10** |
| adset_id | 10 | **10/10** |
| ad_id | 10 | **10/10** |
| source | 8 | **8/8** |
| medium | 4 | **4/4** |

Survivors com campanha: de 0 para 10. **5 campanhas distintas preservadas** que
seriam perdidas num delete simples.

## Prova de nao perda economica

- `canonical_deals` 1355 antes e depois — nenhum negocio sumiu
- 20/20 survivors vivos, com `value`, `lead_id` e `event_time` do snapshot
- compradores 500 -> 500
- `vw_venda_identidade` resolve 1582 linhas

## R35 preservada

37/37 dos eventos corrigidos na R35 continuam no lead corrigido. Juliana segue
com 6 eventos. Nenhum survivor deste bloco pertencia aos 37 (aqueles 4 sairam na
R38).

## `pixel_crm_sync_map`

20/20 apontam para o survivor, 0 aliases restantes, nenhum deal com 2 linhas de
mapa, orfaos inalterados em 329 (nao reparados nesta rodada, por escopo).

## Rollback

`public._r42_rollback` (20 linhas, PK `canonical_deal_id`) com snapshot jsonb
completo de survivor, alias e linha do mapa, mais o plano de migracao aplicado.

```sql
begin;
set local session_replication_role = replica;
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_alias)).*
  from public._r42_rollback r;
update pixel_crm_sync_map m set event_id = r.alias_event_id
  from public._r42_rollback r where m.deal_id = r.canonical_deal_id;
delete from pixel_events p using public._r42_rollback r
  where p.event_id = r.survivor_event_id and p.event_name='Purchase';
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_survivor)).*
  from public._r42_rollback r;
set local session_replication_role = origin;
commit;
```

## Duplicacoes restantes: 31 -> 11

| combinacao | grupos | valor igual | valor divergente | excedente |
|---|---:|---:|---:|---:|
| rd_won + won | 4 | 1 | 3 | 626,81 |
| rd_won + uuid | 4 | 4 | 0 | 1.431,97 |
| uuid + won | 3 | 1 | 2 | 5.544,18 |

Os 4 `rd_won+uuid` restantes sao os excluidos por decisao: 2 AMBIGUO (Vanessa,
Igreja Batista), 1 com valor divergente da RD, 1 com campanha placeholder.

Fora de escopo e intocados: 329 orfaos do mapa, 54 deals sem Purchase, merges.
