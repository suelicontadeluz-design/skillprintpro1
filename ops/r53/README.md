# R53 — consolidacao do ultimo par duplicado da Vanessa

Executada em 2026-08-26. **1 representacao errada removida, 1 negocio
preservado, 2 leads preservados, identidade da R49 intacta.**

## Veredito

**VANESSA_DUPLICACAO_ZERADA**

E mais do que a Vanessa: **`grupos_duplicados_restantes = 0` na base inteira.**

## §0 — O que esta rodada NAO e

Nao e merge de lead. Nenhum lead foi apagado, alterado ou fundido. Vanessa
continua com **dois leads historicos vivos**, ligados a **uma** `pessoa_id` pela
camada da R49. O que saiu foi a **segunda representacao de um unico negocio**.

## §1 — Par reancorado

Reconstruido ao vivo por `canonical_deal_id` = prefixo do `event_id` **uniao**
`pixel_crm_sync_map.deal_id`:

| | survivor | alias |
|---|---|---|
| `event_id` | `rd_won_69f3ac56eb71690018211053` | `203a53bd-2b42-4c83-9e8e-f3539ae4b081` |
| `lead_id` | **`9abb20c2`** | `336a959d` (fragmento) |
| `value` | 310,15 | 310,15 |
| `event_time` | **2026-04-30 19:31:28.796** | 2026-05-08 14:10:39.092 |
| `pessoa_id` | `cbfe9287` | **`cbfe9287`** (a mesma) |
| campanha / adset / ad / source / medium | **todos NULL** | **todos NULL** |
| `content_category` / `product_type` / `state` | iguais | iguais |
| linha de mapa | nenhuma | `69f3ac56 → 203a53bd`, escrita **2026-06-02 15:05:14** |

Exatamente **2** representacoes, **zero** terceiro evento.

### Uma guarda minha disparou — e estava errada, nao o dado

A primeira versao do ensaio testava "terceiro evento" com
`event_id LIKE '%' || deal_id || '%'`. **O UUID nao contem o `deal_id`** — ele se
liga ao negocio pelo **mapa**, que e precisamente a razao de o
`canonical_deal_id` existir. A guarda abortou a transacao, eu corrigi a guarda
para usar prefixo ∪ mapa, e refiz. O aborto foi meu erro de teste; nenhum dado
foi tocado.

## §2 — RD LIVE

`GET api.rd.services/crm/v2/deals/69f3ac56eb71690018211053`:

| campo | valor |
|---|---|
| HTTP | **200** |
| `name` | `Vanessa Büher \| 554195338939` |
| `status` | **won** |
| pipeline | `63191f7dd02b2e000cb1805b` (vendas) |
| `total_price` | **310,15** |
| `closed_at` | **2026-04-30 19:31:28.796** |
| linhas em `deal_produtos_rd_obs` | 2 |
| **soma dos produtos** | **310,15** |

O valor da RD nao e afirmado, e **itemizado**: soma das 2 linhas = `total_price`.

## §3 — Valor: **AMBOS_CORRETOS**

`rd_won.value` = `uuid.value` = `total_price` = soma dos produtos = **310,15**.

Nao havia divergencia de valor a resolver. O que decide o survivor e outra
coisa.

## §4 — Identidade (reancorada, sem merge)

| lead | pessoa_id |
|---|---|
| `9abb20c2` | `cbfe9287` |
| `336a959d` | `cbfe9287` |

Uma pessoa, dois leads. **A diferenca de `lead_id` entre as duas linhas nao
transformava as duas linhas em duas vendas** — e exatamente por isso este caso
sobreviveu ate agora: nao dava para consolidar antes de a identidade estar
provada.

`fn_merge_leads` **nao foi executado**.

## §5 — Survivor: **SURVIVOR_RD_WON**, por tres provas convergentes

1. **`event_time` = `closed_at` real.** O survivor marca
   `2026-04-30 19:31:28.796`, que e **exatamente** o `closed_at` da RD. O alias
   marca `2026-05-08 14:10:39` — o instante da sincronizacao, nao o fato
   comercial. Uma das duas linhas mente sobre quando o negocio fechou.
2. **Lead historico correto (R51).** O deal fechou em **30/04**. O lead
   `336a959d` so nasceu em **02/06** — 33 dias depois. Nao podia carregar o fato.
   Em 30/04 quem tinha o telefone `554195338939` era o proprio `9abb20c2`
   (provado pelo snapshot de 05/05).
3. **A linha de mapa e tardia.** Foi escrita em **02/06 15:05**, uma hora e meia
   depois de o fragmento nascer (02/06 13:31). E atribuicao posterior, nao
   evidencia contemporanea.

O telefone atual do deal **nao** foi usado como criterio.

## §6 — Atribuicao: nada a migrar, nada a perder

| campo | survivor | alias | classe |
|---|---|---|---|
| `campaign_id` | NULL | NULL | IGUAL |
| `adset_id` | NULL | NULL | IGUAL |
| `ad_id` | NULL | NULL | IGUAL |
| `source` | NULL | NULL | IGUAL |
| `medium` | NULL | NULL | IGUAL |

**Zero LACUNA_SURVIVOR, zero PLACEHOLDER, zero CONFLITO_REAL.** Guarda de abort
na transacao: se o alias tivesse qualquer atribuicao valida exclusiva, a
transacao teria parado. Conferido tambem no snapshot de rollback apos o commit:
**0**.

## §7 — `content_category` / `product_type`

Identicos nas duas linhas (`impressao_dtf_textil` / `dtf_textil`). Nao houve
divergencia e nada foi migrado "para uniformizar". Seguem **desqualificados**
como fonte canonica de produto (politica da R41) — a fonte usada foi
`deal_produtos_rd_obs`.

## §8 — Mapa

A linha apontava para o alias. **Repontada para o survivor antes do DELETE**, na
mesma transacao.

| guarda | resultado |
|---|---|
| linhas repontadas | **1** |
| `deal_id` preservado | sim |
| linhas do mapa | 507 → **507** |
| orfaos do mapa | 329 → **329** (zero orfao novo) |
| `event_id` 1:N no mapa | **0** |

Nota deliberada: **`pixel_crm_sync_map.lead_id` continua `336a959d`.** Nao foi
alterado. A R39 estabeleceu que esse campo e **recibo** do que a sincronizacao
resolveu naquele momento, nao ponteiro vivo — mesma decisao da R46. Alterar o
recibo seria reescrever o registro de uma decisao passada. Verificado que isso
nao cria falso "sem representacao": o teste da R43 exige tambem a ausencia de
`rd_won_<deal_id>`, que agora existe.

## §9 — Torneira de recriacao: **MORTA, em tres camadas**

O alias e um UUID, produzido pela extinta `fn_sync_crm_pixel_insert`.

| camada | estado |
|---|---|
| **corpo da funcao** | **esvaziado em 16/08/2026** — hoje so faz `RAISE NOTICE` e `RETURN 0`. Nao insere nada nem se chamada a mao. Original preservado em `_backup_crm_pixel_sync_20260816` |
| triggers que a chamam | **0** |
| crons `crm-pixel-sync` | **3, todos inativos** (`08h`, `12h`, `18h`) |
| edge `crm-pixel-sync` | tombstone HTTP 410 (R47) |

Investiguei os **2 Purchase com `event_id` UUID criados nos ultimos 90 dias**
(mais recente 10/07). **Nao sao do produtor:** sao inserts manuais via
`mgmt-api`/`postgres`, com o comentario *"Mutar o João pros dois via a trava de
comprador que JÁ existe"*, sem `event_id` explicito — o UUID veio do default da
coluna. Insercao humana ad-hoc nao e caminho automatico de recriacao.

A v56 cria `rd_won_`, que **e o survivor**: verificado apos o commit que ela
encontra `rd_won_69f3ac56…` e marcara `ja_existia`.

## §10 — Backup

`public._r53_rollback` (1 linha) com snapshot jsonb de survivor, alias e linha
do mapa, mais `rd_total_price`, `rd_closed_at`, soma dos produtos e **snapshot
dos 2 vinculos da R49**.

## §11 — Ensaio revertido

Cirurgia completa executada em transacao e revertida, incluindo **restauracao
byte a byte** do alias e do mapa (`session_replication_role = replica`, porque
`prevent_pixel_event_duplicate` engoliria a reinsercao). Hash do alias
restaurado conferido contra o snapshot: **igual**.

```
mapa_repontado 1 · alias_deletado 1 · purchase 1599->1598 · queda_receita 310.15
canonical 1399->1399 · compradores 504->504 · repeat_buyers 216->216
orfaos_mapa 329->329 · linhas_mapa 507->507 · vinculos_r49 6->6 · leads 16031->16031
```

## §12 — Transacao real

| guarda | resultado |
|---|---|
| canonical com exatamente 2 representacoes | **2** |
| survivor confere (lead + value + `event_time`=`closed_at`) | ok |
| alias confere (lead + value) | ok |
| **atribuicao valida no alias** | **0** |
| os 2 leads na mesma `pessoa_id` | **1 pessoa** |
| **mapa repontado** | **1** |
| **aliases deletados** | **1** |
| representacoes apos o delete | **1** |
| survivor byte-a-byte intacto (md5) | ok |
| Purchase (delta) | 1599 → **1598** |
| **queda de receita (exata)** | **310,15** |
| **canonical deals** | **1399 → 1399** |
| orfaos do mapa | 329 → **329** |
| linhas do mapa | 507 → **507** |
| **vinculos R49** | **6 → 6** |
| **leads** | **16031 → 16031** |

A guarda de receita exige **exatamente** R$310,15, nao faixa. Nenhum merge,
nenhum lead tocado.

## §13 — Prova de nao perda

- **1 Purchase** para o deal: `rd_won_69f3ac56…`, lead `9abb20c2`, R$310,15,
  `event_time` = `closed_at` da RD
- `canonical_deal_id` preservado — **1399 → 1399**, o negocio nao sumiu
- valor = `total_price` = soma itemizada dos produtos
- atribuicao valida preservada (nao havia nenhuma dos dois lados)
- **pessoa Vanessa continua com os dois leads**, `pessoa_id` inalterada
- **nenhum historico de aquisicao apagado**: os 2 leads seguem vivos com
  `created_at`, email e `external_id` proprios

## §14 — Impacto

| metrica | antes | depois |
|---|---:|---:|
| Purchase | 1599 | **1598** |
| receita representada | 640.130,28 | **639.820,13** |
| **canonical deals** | **1399** | **1399** |
| compradores unicos | 504 | **504** |
| repeat buyers | 216 | **216** |
| orfaos do mapa | 329 | **329** |
| **duplicacoes conhecidas** | **1** | **0** |

### Vanessa

| | antes | depois |
|---|---:|---:|
| lead `9abb20c2` | 24 / R$12.179,46 | **24 / R$12.179,46** |
| lead fragmento `336a959d` | 3 / R$825,59 | **2 / R$515,44** |
| **pessoa Vanessa** | 27 / R$13.005,05 | **26 / R$12.694,90** |

O fragmento perdeu **exatamente** a representacao duplicada e ficou com suas
**2 vendas reais exclusivas**: `won_6a296a5f…` (R$275,25) e `won_6a4d53bc…`
(R$240,19). Sao os mesmos R$515,44 que a R48 identificou como historia
exclusiva dele. **Nenhuma venda real foi perdida.**

## §15 — Auto-refutacao

| tentativa de refutar | resultado |
|---|---|
| sao duas vendas legitimas? | Nao. **Um** `deal_id`, um `closed_at`, um `total_price` itemizado. O alias tem `event_time` que **nao existe** na RD. |
| valores diferem? | Nao: 310,15 = 310,15 = RD = soma dos produtos |
| survivor perde evidencia? | Nao: **0** atribuicao no alias, conferido no snapshot pos-commit |
| lead historico errado? | Nao: o fragmento nasceu 33 dias **apos** o fechamento |
| mapa quebra? | Nao: repontado, 507 linhas, 329 orfaos, 0 relacao 1:N |
| alias pode ser recriado? | Nao: funcao esvaziada, 0 triggers, 3 crons inativos, edge 410 |
| identidade R49 seria alterada? | Nao: **6 vinculos, 3 pessoas, 2 leads vivos** |
| alguma campanha desaparece? | Nao: **0** campos de atribuicao no alias |
| RD mudou apos o commit? | Nao: reconsultado — **won / 310,15** |

Nenhuma refutacao sobreviveu.

## Nada anterior foi desfeito

R35: **37/37** · R44: **17/17** · R49: **6 vinculos / 3 pessoas** ·
R52: **8/8** · leads: **16031**, nenhum apagado.

## Rollback

```sql
begin;
set local session_replication_role = replica;
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_alias)).*
  from public._r53_rollback r;
update pixel_crm_sync_map m set event_id = r.alias_event_id
  from public._r53_rollback r where m.deal_id = r.canonical_deal_id;
set local session_replication_role = origin;
commit;
-- os vinculos da R49 nao sao tocados em nenhum passo
```

`session_replication_role = replica` e necessario: sem ele o
`prevent_pixel_event_duplicate` engole a reinsercao em silencio.

## Proximo passo

A frente da Vanessa esta **encerrada**: subcontagem zero (R52) e duplicacao zero
(R53). E a duplicacao acabou na base inteira — **47 grupos tratados, 0
restantes**.

Em aberto, registrados e nao trabalhados:

- **22 SEM_LEAD**, R$12.702,59, e **2 sem telefone no nome**, R$1.800,00;
- **T0 de 2025-08-22** da Vanessa/Alean, perdido no merge de 25/05, vivo apenas
  em `leads_marketing_bk_normalizacao_20260505`;
- par da Igreja `466,68` / `466,80` e par de R$1.799,79 do Kleberson —
  suspeitas de duplicacao **no nivel da RD**, que a consolidacao de
  `pixel_events` nao alcanca porque sao `deal_id` distintos;
- **`fn_fechar_tasks_apos_compra`** (descoberto na R52): casa por telefone e
  reabre tarefa descartada — gate obrigatorio em qualquer backfill futuro;
- 329 orfaos do mapa e `crm_deals_cache` congelado desde 16/08.
