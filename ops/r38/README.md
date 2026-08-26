# R38 — consolidacao dos 16 grupos `rd_won + uuid`

Executada em 2026-08-26 12:42:39 UTC. **16 aliases removidos, 16 negocios
preservados.**

## Escopo

Somente os 16 grupos classificados como bloco automatico seguro na R37:
mesmo `canonical_deal_id`, mesmo `value`, valor batendo com a RD, mesmo
`lead_id`, e **nenhuma evidencia exclusiva na linha UUID**.

Survivor = `rd_won_*` (carrega o `closed_at` real da RD).
Alias = UUID (representacao secundaria do mesmo negocio).

## Protocolo (semantica reaproveitada da consolidacao de 02/08)

1. congelar backup completo -> `public._r38_rollback`
2. repontar `pixel_crm_sync_map` do alias para o survivor
3. validar invariantes
4. apagar o alias
5. validar efeito
6. commit

Implementacao auditada e reescrita nesta rodada; o script de 02/08 nao foi
reutilizado (era ad hoc, nao existe funcao armazenada).

## Guardas, todas aprovadas em transacao unica

| guarda | resultado |
|---|---|
| bloco revalidado dentro da transacao | 16 |
| mapas repontados | 16 |
| aliases deletados | 16 |
| survivors byte-a-byte intactos (md5) | 16 |
| exatamente 1 Purchase por canonical deal | 16 |
| correcoes da R35 preservadas | 4 |
| Purchase (delta) | 1618 -> 1602 (-16) |
| receita (delta) | 646.886,61 -> 642.302,18 (-4.584,43) |
| compradores | 500 -> 500 |
| mapas orfaos (delta) | 329 -> 329 |

Ensaio em transacao revertida executado antes: mapa 16, delete 16, survivor
hash 16, 1 Purchase por deal 16, aliases restaurados **identicos byte a byte**
16/16.

## Duas armadilhas encontradas e tratadas

**1. Rollback bloqueado por trigger.** 2 dos 16 aliases estao a menos de 10
minutos do survivor, com mesmo lead e mesmo valor — exatamente o padrao que
`prevent_pixel_event_duplicate` (BEFORE INSERT, Caso 1) descarta em silencio.
Um reinsert ingenuo no rollback seria engolido sem erro. O rollback usa
`SET LOCAL session_replication_role = replica` para restaurar byte a byte.

**2. Guarda de orfaos mal calibrada.** A primeira tentativa abortou com
"329 mapas orfaos". Eram **pre-existentes**: `pixel_crm_sync_map` tem 507
linhas, das quais 329 ja apontavam para event_ids inexistentes antes desta
rodada. A guarda foi corrigida para comparar delta (antes x depois), nao zero
absoluto. Nenhuma escrita saiu da tentativa abortada.

## Prova de nao perda economica

- `canonical_deals` distintos: **1355 antes e depois** — nenhum negocio sumiu
- 16/16 survivors com `value`, `lead_id` e `event_time` identicos ao snapshot
- repeat buyers 228 -> 225 (os 3 eram recorrencia fabricada por linha dupla)
- compradores 500 -> 500

## R35 preservada

37/37 dos eventos corrigidos na R35 continuam apontando para o lead corrigido.
Juliana permanece com 6 eventos (1 caso SEM_LEAD fora de escopo + 5
`csv_backfill`), inalterada.

## `mv_qualidade_campanha`

0 dos 16 survivors entram na base da MV (campaign_id NULL e event_time fora da
janela de 90 dias). **Nada a fazer.**

## Rollback

`public._r38_rollback` (16 linhas, PK `canonical_deal_id`) com snapshot jsonb
completo do survivor, do alias e da linha do mapa.

```sql
begin;
set local session_replication_role = replica;
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_alias)).*
  from public._r38_rollback r;
update pixel_crm_sync_map m set event_id = r.alias_event_id
  from public._r38_rollback r where m.deal_id = r.canonical_deal_id;
set local session_replication_role = origin;
commit;
```

## Duplicacoes restantes: 47 -> 31

| combinacao | grupos | observacao |
|---|---:|---|
| rd_won + uuid | 24 | 21 precisam migrar atributo exclusivo; 1 valor divergente da RD; 1 campanha placeholder; 2 AMBIGUO por lead duplicado |
| rd_won + won | 4 | 3 com valor divergente |
| uuid + won | 3 | 2 com valor divergente |

Fora de escopo, intocados: 216 Purchase sem chave canonica (R$83.522,60).
