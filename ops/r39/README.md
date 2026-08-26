# R39 — reconciliacao pos-R38 e semantica do `pixel_crm_sync_map`

Rodada READ-ONLY de 2026-08-26. Nenhuma escrita.

## Correcao de contagem da R38

O relatorio da R38 disse "24 grupos rd_won+uuid" e listou 21+2+1+1 = 25.
**O placeholder estava dentro dos 21 e foi contado duas vezes.**

Tabela mutuamente exclusiva, soma exata 24:

| classe primaria | grupos | receita |
|---|---:|---:|
| LACUNA_MIGRAVEL | 12 | 6.025,27 |
| CONTRADICAO_ATRIBUTO | 8 | 5.565,91 |
| AMBIGUO_IDENTIDADE | 2 | 776,83 |
| VALOR_DIVERGENTE | 1 | 475,44 |
| PLACEHOLDER | 1 | 179,70 |

## Lacuna x contradicao, por campo

| campo | lacuna | contradicao | placeholder |
|---|---:|---:|---:|
| campaign_id | 11 | **0** | 1 |
| adset_id | 11 | **0** | 0 |
| ad_id | 11 | **0** | 0 |
| source | 8 | **0** | 0 |
| medium | 5 | **0** | 1 |
| content_category | 2 | **6** | 0 |
| product_type | 7 | **2** | 0 |

**Toda contradicao esta em `content_category` e `product_type`. A triade de
atribuicao (campaign/adset/ad) nunca e contraditoria — so ausente.**

Consequencia: migrar SO atribuicao e mecanico. O que exige decisao humana e
categoria/produto, que nao precisam ser migrados.

## Semantica do `pixel_crm_sync_map` — provada pelo escritor

Definicao original congelada em `_backup_crm_pixel_sync_20260816`:

```sql
FROM crm_deals_cache d
JOIN leads_marketing lm ON right(lm.ph,11) = right(d.telefone,11)
LEFT JOIN pixel_crm_sync_map m ON m.deal_id = d.id
WHERE d.status='won' AND d.total_price>0 AND m.deal_id IS NULL
INSERT INTO pixel_events (...) SELECT gen_random_uuid()::text, ...
  RETURNING event_id, lead_id, value
INSERT INTO pixel_crm_sync_map (deal_id, event_id, lead_id, valor_sinc)
  ... ON CONFLICT (deal_id)
```

O mapa e um **livro de idempotencia chaveado em `deal_id`**: "este deal ja
gerou um Purchase, nao gere outro". A PK e em `deal_id`, nao em `event_id`.
A coluna `event_id` e o RECIBO do evento criado, nao um ponteiro vivo.

Os UUIDs de `pixel_events` nasceram desse `gen_random_uuid()`.

**A R38 estava semanticamente certa** ao repontar os 16 para o survivor: o
invariante e "o deal X tem um Purchase", e apos consolidar esse Purchase e o
`rd_won`. Manter o ponteiro no alias apagado criaria 16 orfaos novos.

## Os 329 registros sem evento

Nao sao residuo de consolidacao: 0 vem de 02/08, 0 vem da R38, e 329/329 tem
formato UUID (nenhum com prefixo won_/rd_won_).

Rastro nos arquivos de delecao: **0** em quarantine, lixo, apagados_*,
classif_*, separacao_*, backfill_tardia, lab_eventos, pageview,
fact_events_marketing, capi_eventos_log. Apenas 16 aparecem em
`debug_pixel_events_inserts`.

Por situacao do deal hoje:

| situacao | n |
|---|---:|
| deal tem `rd_won_` vivo | 205 |
| deal tem `won_` vivo | 1 |
| **deal sem nenhum Purchase por prefixo** | **123** |

Dos 123: 121 estao won na RD hoje. Checagem limitada por lead+valor mostra que
69 tem Purchase por outra rota. Restam **54 deals sem indicio algum de
Purchase, valor_sinc somado R$33.143,65** — potencial sub-contagem, o inverso
do problema de duplicacao. NAO investigado por heuristica nesta rodada.

## Cobertura: 216 Purchase sem chave canonica

| produtor | n | receita | posterior a 02/06 |
|---|---:|---:|---:|
| csv_backfill | 115 | 26.269,62 | 0 |
| uuid | 42 | 25.649,55 | 2 |
| mp_pix | 32 | 3.774,63 | 32 |
| outro | 27 | 27.828,80 | 19 |

O mapa so foi escrito entre 09/04 e 02/06/2026 e so pelo produtor aposentado.
`won_`, `mp_pix_` e `csv_backfill` **nunca** entraram nele — nao por defeito,
mas porque nunca foram escopo dele.

## Proximo bloco automatico

- **12 grupos (R$6.025,27)** sob criterio estrito: so lacuna, zero contradicao
  em qualquer campo.
- **20 grupos (R$11.591,18)** se a migracao se limitar a atribuicao
  (campaign/adset/ad/source/medium) e `content_category`/`product_type` forem
  deixados intocados — os 8 CONTRADICAO entram porque a contradicao deles vive
  so nesses dois campos.

Nao sao 21.
