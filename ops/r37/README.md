# R37 — artefato READ-ONLY dos grupos `rd_won + uuid`

Rodada de 2026-08-26. **Nenhuma escrita. Nenhuma tabela criada** (o modo desta
rodada proibia INSERT, entao o artefato e a query abaixo, reproduzivel).

## Hipotese testada

"40 grupos `rd_won + uuid` com valor identico sao candidatos de alta confianca
a consolidacao, com survivor = `rd_won` e alias = UUID."

**Refutada parcialmente.** A contagem de 40 reproduz, mas so 16 sobrevivem aos
gates de atribuicao, identidade e valor.

## Query canonica do bloco (reproduzivel)

```sql
with px as (
  select p.event_id, p.lead_id, p.value, p.event_time, p.campaign_id, p.source,
         p.medium, p.content_category, p.product_type,
    case when p.event_id like 'rd\_won\_%' then 'rd_won'
         when p.event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then 'uuid'
         when p.event_id like 'won\_%' then 'won' else 'outro' end as prod,
    case when p.event_id ~ '^(rd_)?won_'
         then regexp_replace(p.event_id,'^(rd_)?won_','') end as de
  from pixel_events p where p.event_name='Purchase'),
canon as (
  select px.*, coalesce(px.de, m.deal_id) as ck
  from px left join pixel_crm_sync_map m on m.event_id = px.event_id),
g as (
  select ck from canon where ck is not null group by ck
  having count(*)=2
     and count(*) filter (where prod='rd_won')=1
     and count(*) filter (where prod='uuid')=1
     and count(distinct value)=1),
r as (select c.* from canon c join g on g.ck=c.ck where prod='rd_won'),
u as (select c.* from canon c join g on g.ck=c.ck where prod='uuid')
select * from r join u on u.ck=r.ck;
```

## Classificacao dos 40

| classe | grupos | por que |
|---|---:|---|
| LIMPO | 17 | UUID nao traz nada exclusivo |
| PRECISA_MERGE_campanha | 11 | UUID tem campaign/adset/ad que o rd_won nao tem |
| PRECISA_MERGE_categoria | 8 | UUID tem product_type/content_category exclusivo |
| AMBIGUO_leads_diferentes | 2 | lead_id difere entre as duas linhas (lead duplicado) |
| PRECISA_MERGE_source_medium | 2 | UUID tem source/medium exclusivo |

Gates adicionais que retiram mais 1 dos 17 LIMPO:

- 1 grupo com `value` divergente do `total_price` da RD (`69b073ef59833a001e9ea0e1`)
- 1 grupo cuja "campanha" do alias e a string literal `valor_padrao_campaign_id`
  (placeholder, nao atribuicao valida — nao migrar)
- 2 grupos com `product_type` CONFLITANTE (ambos preenchidos e diferentes)
- 6 grupos com `content_category` CONFLITANTE

**Bloco seguro final: 16 grupos, R$4.584,43.**

## Prova de mesmo negocio

- chave primaria = `canonical_deal_id` (deal_id explicito U `pixel_crm_sync_map`)
- 40/40 os deals existem na RD como `won` no pipeline de vendas
- 39/40 o `rd_won` e mais antigo que o UUID; 1 empate; 0 com UUID mais antigo
- 39/40 o `event_time` do `rd_won` e exatamente o `closed_at` da RD

## Atribuicao (gate obrigatorio)

| campo | rd_won | uuid |
|---|---:|---:|
| campaign_id / adset_id / ad_id | **0** | 11 |
| source | **0** | 8 |
| medium | **0** | 5 |
| content_category | 38 | 40 |
| product_type | 28 | 35 |

O UUID e a unica fonte de atribuicao de campanha nesses grupos. Apagar o UUID
sem migrar destruiria atribuicao legitima em 11 grupos.

## Referencias

Somente `pixel_crm_sync_map` referencia os 40 UUIDs (40/40). Zero em
capi_eventos_log, capi_won_gate_log, fact_events_marketing, lab_eventos,
lab_atribuicoes, crm_campaign_attributions, agente_decisoes_log,
atribuicao_conversao, pixel_duplicata_candidatos, pixel_consolidacao_backup.

Consequencia: qualquer DELETE do alias precisa repontar essas 40 linhas do mapa
para o survivor ANTES, senao o mapa fica orfao — e ele e lido por
`vw_venda_identidade` e `fn_merge_leads`.

## Protocolo de 02/08 (auditado, reutilizavel)

`pixel_consolidacao_log`: 1 execucao, 45 pares, 45 aliases removidos,
14 mapas atualizados, Purchase 1405 -> 1360, receita 558.314,90 -> 541.496,11,
queda 16.818,79, status ok. `executado_por = claude-fase-b`.

Auditoria do `pixel_consolidacao_backup` (45 linhas):

- `snapshot_rd` presente em **45/45** — evidencia da RD por par
- 34 survivors intocados, **11 enriquecidos**
- 8 casos em que o alias tinha campanha exclusiva -> **8/8 migradas** para o
  survivor antes do delete

Nao existe funcao SQL armazenada para isso — foi script ad hoc. O que se
reutiliza e o PROTOCOLO, nao o codigo:
snapshot RD por par -> migrar atributo exclusivo -> repontar mapa -> apagar
alias -> backup das duas linhas antes/depois.

## Impacto simulado (somente os 16)

| metrica | antes | depois |
|---|---:|---:|
| linhas Purchase | 1618 | 1602 |
| receita removida | — | R$4.584,43 |
| compradores | 500 | 500 |

(Com os 17 do bloco LIMPO original seria -17 linhas, R$5.059,87 e repeat buyers
228 -> 225.)

## Fora desta rodada

- 7 grupos restantes dos 47 (5 com valor divergente, 2 fora do padrao)
- 24 dos 40 que precisam de merge de atributo ou sao ambiguos
- 216 Purchase sem chave canonica (R$83.522,60)
