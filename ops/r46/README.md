# R46 — consolidacao dos 5 grupos simples

Executada em 2026-08-26 15:02:17 UTC. **5 aliases removidos, 5 negocios
preservados, zero atribuicao perdida.**

## Escopo

| cliente | survivor | alias | mapa |
|---|---|---|---|
| Galardao Store | `rd_won_` | uuid | repontado |
| Igreja Batista | `rd_won_` | uuid | repontado |
| Vagner Chagas | `rd_won_` | uuid | repontado |
| Dbora Mdolo | `won_` | uuid | repontado |
| **Kleberson** | **`won_`** | `rd_won_` | **nao existe** |

Survivor escolhido por evidencia do caso, nunca por prefixo: em 2 dos 5 o
sobrevivente e o `won_`.

## Identidades criticas reconferidas antes da escrita

| caso | survivor | ph survivor | alias | ph alias |
|---|---|---|---|---|
| Igreja | `e218bcbb` Luciane -Igreja Batista | `5511972394278` | `559c601d` | `511972394278` (sem o 5 inicial) |
| Kleberson | `ac931260` Kleberson | `5511972491479` | `93c70a4f` | `119724914` (truncado) |

O telefone do deal e `5511972394278` / `5511972491479`. O survivor bate; o alias
carrega um cadastro malformado. **Kleberson sobreviveu no `won_`, nao invertido.**

## Baseline — 5/5 na RD ao vivo

5/5 HTTP 200, `won`, e em 5/5:
`survivor.value` = `total_price` = **soma das linhas de `deal_produtos_rd_obs`**.

Nota: a comparacao usa `round(...,2)`. O `total_price` do Vagner e
`475.43999999999994` em float — foi exatamente isso que gerou meu falso positivo
de "valor divergente" nas R37/R42.

## Guardas, todas aprovadas em transacao unica

| guarda | resultado |
|---|---|
| revalidacao (RD won + valor = produtos + hash survivor + exatamente 2 eventos) | 5 |
| mapas repontados | **4** |
| aliases deletados | **5** |
| survivor byte-a-byte intacto (md5) | **5** |
| survivor campos (value=RD=produtos, lead, event_time) | **5** |
| exatamente 1 Purchase por deal | **5** |
| Purchase (delta) | 1601 -> 1596 (-5) |
| receita | 645.327,65 -> 642.263,23 (-3.064,42) |
| **canonical deals** | **1374 -> 1374** |
| compradores | 505 -> 504 |
| repeat buyers | 219 -> 218 |
| orfaos do mapa (delta) | 329 -> 329 |

Ensaio revertido antes: mapa 4, delete 5, survivor hash 5, campos 5,
um_purchase 5, orfaos 329->329, e restauracao **byte a byte de alias 5/5 e
survivor 5/5**. `session_replication_role` conferido em `origin`.

## O -1 comprador e correcao, nao perda

O lead `559c601d` ("Igreja Batista Biblica de Cristo", ph sem o 5 inicial)
ficou com **0 Purchase**. Sua unica compra era a atribuicao errada do alias.
O cliente real segue representado pelo lead `e218bcbb`.

## Nada anterior foi desfeito

- R35: **37/37** eventos corrigidos seguem no lead corrigido
- R44: **17/17** backfills seguem vivos
- survivors: 5/5 vivos, mapas 4/4 no survivor, 0 aliases restantes

## Duplicacoes restantes: 11 -> 6

| deal | cliente | combo | valor RD | excedente real |
|---|---|---|---:|---:|
| 69a86f80 | Ana Ribeiro | uuid+won | 3.221,88 | 3.217,20 |
| 69fceb63 | Willian Vieira | uuid+won | 755,48 | 835,82 |
| 69fce550 | Beats Estamparia | rd_won+won | 152,74 | 763,47 |
| 69f3ac56 | Vanessa Buher | rd_won+uuid | 310,15 | 310,15 |
| 69e134f5 | Antonio Tadeu | rd_won+won | 92,97 | 107,97 |
| 69f692ac | Bruno Cardoso | rd_won+won | 261,60 | 10,00 |

Excedente pela verdade da RD: **R$5.244,61**.

Atencao ao ler: o excedente NAO e `soma - maior`. Em Beats e Antonio a linha a
remover e a **maior**, porque a RD itemizada diz que a menor e a correta.

5 sao CORRECAO_DE_VALOR (nao consolidacao simples) e 1 e identidade (Vanessa).

## Rollback

`public._r46_rollback` (5 linhas, PK `canonical_deal_id`) com snapshot jsonb de
survivor, alias e linha do mapa, mais valor RD e soma de produtos.

```sql
begin;
set local session_replication_role = replica;
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_alias)).*
  from public._r46_rollback r;
update pixel_crm_sync_map m set event_id = r.alias_event_id
  from public._r46_rollback r
 where m.deal_id = r.canonical_deal_id and r.snapshot_mapa is not null;
set local session_replication_role = origin;
commit;
```

## Observacao fora de escopo

O lead fragmento do Kleberson (`93c70a4f`, ph `119724914`) ainda tem **1
Purchase** de outro deal. Nao tocado nesta rodada; entra na frente de merge
junto com Vanessa e o cadastro duplicado da Igreja.
