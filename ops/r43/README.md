# R43 — os 54 deals sem Purchase: subcontagem real e seu tamanho

Rodada READ-ONLY de 2026-08-26. Nenhuma escrita.

## Universo reancorado

329 orfaos do mapa -> 123 sem Purchase por prefixo -> **54** sem indicio por
lead+valor. **R$33.143,65** em `valor_sinc`. Reproduz exato.

Sinal imediato: os 54 tem `sincronizado_em` **identico** —
`2026-04-09 18:40:53.272973+00`, a primeira execucao do mapa. E **38 dos 54
tem `lead_id` NULL** no mapa.

## RD ao vivo — GET individual por deal_id

54 chamadas `GET /crm/v2/deals/<id>`:

| classe | n |
|---|---:|
| WON_CONFIRMADO | **53** |
| INEXISTENTE (HTTP 404) | **1** (`69b19ad9cef9600019ff82f2`, R$1.330,80) |
| NAO_WON | 0 |
| ERRO_LEITURA | 0 |

Dos 53 won: **53/53 no pipeline de vendas** e **53/53 com `total_price`
identico ao `valor_sinc`**. Valor estavel, sem divergencia.

## Representacao canonica: esgotada, zero encontrada

| rota testada | encontrados |
|---|---:|
| `won_<deal_id>` / `rd_won_<deal_id>` | 0 |
| event_id contendo o deal_id | 0 |
| outra linha de mapa apontando p/ evento vivo | 0 |
| capi_eventos_log / capi_won_gate_log | 0 |
| fact_events_marketing | 0 |
| pixel_events_quarantine | 0 |
| debug_pixel_events_inserts | 0 |

## Cobertura entre replicas

| fonte | cobre |
|---|---:|
| RD live | 53/54 |
| `crm_deals_cache` | **54/54** |
| `propostas_rd` | 51/54 |
| `crm_deal_snapshot` | 22/54 |
| `deal_produtos_rd_obs` | **0/54** |
| `pixel_events` | **0/54** |

## Hipotese de paginacao: REFUTADA

A primeira execucao (09/04 18:40:53) escreveu **457** linhas de mapa.
Delas, **296 sao orfas e 161 continuam vivas**. Se fosse janela/paginacao, a
execucao inteira teria o mesmo destino. Nao tem.

O discriminador real e outro:

| origem (mesma execucao) | n | `lead_id` NULL |
|---|---:|---:|
| linhas VIVAS | 161 | **0 (0,0%)** |
| linhas ORFAS | 296 | 46 (15,5%) |
| **os 54** | 54 | **38 (70,4%)** |

E hoje existem **zero** Purchase com `lead_id` NULL na tabela inteira.
Correlacao forte e medida; o mecanismo exato da remocao continua nao provado
(ver R40) e nao o afirmo.

Valor: R$27.342,36 dos R$33.143,65 estao nos 38 sem lead no mapa.

## Classificacao final dos 54

| classe | deals | valor |
|---|---:|---:|
| BACKFILL_PRECISA_RESOLVER_LEAD (sem lead) | 24 | 14.502,59 |
| **BACKFILL_DETERMINISTICO** | **17** | **14.011,85** |
| BACKFILL_PRECISA_RESOLVER_LEAD (ambiguo) | 8 | 2.801,51 |
| JA_EXISTE_OUTRA_REPRESENTACAO (`csv_backfill`) | 4 | 496,90 |
| NAO_E_WON (404 na RD) | 1 | 1.330,80 |

**Realmente ausentes: 49 deals, R$31.315,95.**

Os 4 ja representados casam com Purchase `csv_backfill_*` de valor identico no
mesmo dia (Daniela, Samara x2, e um caso Promove Arte cujo Purchase pertence a
outro nome — telefone possivelmente compartilhado, nao promovido a prova).

## Identidade pela regra v56 (READ-ONLY)

| resultado | deals |
|---|---:|
| RESOLVE_UNICO | 21 |
| SEM_LEAD | 22 |
| AMBIGUO | 8 |
| sem telefone no nome | 3 |

## Impacto economico simulado — SOMENTE os 17 deterministicos

| metrica | valor |
|---|---:|
| deals | 17 |
| valor comercial | R$14.011,85 |
| leads distintos | 14 |
| deals cujo lead **ja e comprador hoje** | **14** |
| deals que criariam comprador novo | 3 |
| com compra anterior ao `closed_at` (recompra clara) | 7 |
| lead com campanha | **1** |
| lead sem campanha | 16 |

Ou seja: representar os 17 nao traria clientes novos em escala — traria
sobretudo **recompra**. Compradores iriam de 500 para 503.

## Atribuicao

16 dos 17 leads nao tem campanha: **SEM_ATRIBUICAO**. Apenas 1 tem campanha, e
como 14 dos 17 sao de clientes que ja compraram, copiar UTM atual do lead
transformaria recompra em aquisicao. Nao fazer.

## Auto-refutacao

- *Algum dos 54 nao e won?* Sim, 1 (404). Removido.
- *Existe Purchase sob outro produtor?* Sim, 4 via `csv_backfill`. Removidos.
- *Valor mudou depois do fechamento?* Nao — 53/53 batem exatamente.
- *E recompra confundida com aquisicao?* Sim, risco real: 14 dos 17 sao de
  clientes ja compradores. Por isso atribuicao nao pode ser copiada.
- *Os R$33k sao caixa?* Nao. E **verdade comercial RD won**, nao recebimento.
- *Deal duplicado/reaberto?* Nenhum com 2 linhas de mapa; nenhum com 3+ Purchase.
- *A tese sobrevive?* Sim, mas menor: 49 deals / R$31.315,95, dos quais so
  17 / R$14.011,85 sao acionaveis sem decisao humana.

## Veredito

**SUBCONTAGEM_MENOR_QUE_54**

- 49 deals realmente ausentes — R$31.315,95 de valor comercial
- 17 seguros para eventual backfill deterministico — R$14.011,85
- 8 ambiguos
- 24 sem lead
- 0 com valor divergente
