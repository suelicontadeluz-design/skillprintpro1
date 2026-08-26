# R34/R35 — venda certa -> cliente errado (rd_won_*)

Frente concluida em 2026-08-26. **37 eventos corrigidos e verificados.**

## O problema

`rd-won-pixel-sync` v55 resolvia o lead por `lead_identificadores`
(`deal_rdstation_id` / `contact_rdstation_id`), chaves que nao sao unicas.
Resultado: 41 vendas ligadas ao cliente errado, 27 delas concentradas num
unico lead (Juliana) que recebeu negocios de 7 clientes distintos.

A v56 (LIVE desde 25/08) passou a resolver pelo telefone do `deal.name`,
fechando a torneira. Esta frente corrigiu o historico.

## Reconciliacao do split R33 (37/4) x R34 (39/2)

Causa provada, nao inferida: o SQL da R33 esta nos `postgres_logs` de
25/08 20:34 e 20:47. Ela montou o universo de deals a partir de caches
locais congelados (`propostas_rd` U `crm_deal_snapshot` U `crm_deals_cache`),
nunca da API da RD.

Dois deals (Otacilio, Kleberson) nao existem em nenhum cache local, entao a
R33 nao tinha o nome deles, nao tinha telefone, e os classificou SEM_LEAD.
Reproduzindo a R33 com a fonte dela: **37 CORRIGIVEL + 4 SEM_LEAD, exato.**

Hipotese descartada: truncamento por `closed_at`. Os dois extras estao nas
posicoes 659 e 706, dentro de qualquer janela de 1195.

## Semantica de `pixel_events.state`

`state` NAO e observacao independente de UF. E projecao derivada, gravada
pelo trigger `pixel_events_normalize_nulls_trigger`
(`BEFORE INSERT OR UPDATE`):

```sql
IF NEW.state IS NULL AND NEW.lead_id IS NOT NULL THEN
  SELECT lm.st INTO NEW.state FROM leads_marketing lm
   WHERE lm.lead_id = NEW.lead_id LIMIT 1;
END IF;
```

E `leads_marketing.st` e derivado do DDD do telefone por
`fn_corrigir_st_por_ddd_leads_marketing()`. Cadeia:
`state` <- lead vinculado <- DDD do telefone.

Como o trigger so preenche quando o valor e NULL, a correcao usou
`state = NULL` e deixou o sistema rederivar pela propria regra. Nenhuma UF
foi escrita a mao.

**`state` segue DESQUALIFICADO como prova de UF**, mesmo agora coerente.
Para UF confiavel use CEP (`leads_marketing.zip_code`).

## Execucao (2026-08-26 12:19:08 UTC)

```sql
UPDATE pixel_events p
   SET lead_id = r.lead_id_novo, state = null
  FROM public._r35_rollback r
 WHERE p.event_id = r.event_id
   AND p.event_name = 'Purchase'
   AND p.lead_id = r.lead_id_antigo;
```

Guardas, todas aprovadas em transacao unica:

| guarda | resultado |
|---|---|
| rowcount | 37 |
| lead_id aplicado | 37 |
| state rederivado pelo trigger | 37 |
| dos 37 com state NULL restante | 0 |
| nulls fora do alvo (antes -> depois) | 1 -> 1 |
| total Purchase (antes -> depois) | 1617 -> 1617 |
| value/event_time/campaign alterados | 0 |

Ensaio em transacao revertida executado antes, com o mesmo resultado.

## Antes x depois

| | antes | depois |
|---|---:|---:|
| rd_won_ corretos | 311 | 348 |
| rd_won_ errados | 39 | 2 |
| Juliana: eventos | 33 | 6 |
| Juliana: receita | R$6.831,59 | R$992,32 |

Campanha dos 37: R$5.839,27 saem da campanha IG da Juliana
(`120239742720480257`). 35 eventos ficam sem campanha, 1 vai para
`120238920638970257`, 1 para `120219836609290257`.

Divergencia global `state` x `st` do lead permanece em 17 linhas, a mesma
de antes: a correcao nao introduziu incoerencia nova.

## Rollback

`public._r35_rollback` (37 linhas, PK `event_id`).

```sql
UPDATE pixel_events p
   SET lead_id = r.lead_id_antigo, state = r.state_antigo
  FROM public._r35_rollback r
 WHERE p.event_id = r.event_id AND p.event_name = 'Purchase';
-- esperar rowcount 37
```

## Deliberadamente NAO tocado

- Otacilio (`rd_won_69f8a16c...`) — PROVAVEL, fonte unica, R$119,80
- Kleberson (`rd_won_69fcd9d7...`) — duplicata de lead, e merge, R$371,10
- Amanda e Alean — SEM_LEAD, R$723,83
- Jessica — deal sem telefone em nenhuma fonte, R$274,50
- 8 casos AMBIGUO, hoje ja corretos
- duplicacoes economicas (mesmo deal, mais de uma linha)
- `mv_qualidade_campanha` — **NAO refreshada**, esta desatualizada; refresh
  precisa de autorizacao propria
- `lead_score_comercial` — 11 linhas afetadas, drenam sozinhas pelo cron 144
