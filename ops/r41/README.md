# R41 — gate final: conflitos de `content_category` e `product_type` nos 20

Rodada READ-ONLY de 2026-08-26. Nenhuma escrita.

## Decomposicao exata dos 20

| situacao | grupos |
|---|---:|
| identicos nos dois campos | 8 |
| lacuna pura (UUID preenche onde rd_won e NULL) | 4 |
| conflito de `content_category` | 6 |
| conflito de `product_type` | 2 |

## `product_type` nao e campo independente

`fn_pixel_derivar_product_type()` (BEFORE INSERT OR UPDATE, so quando NULL):

```sql
NEW.product_type := CASE NEW.content_category
  WHEN 'impressao_dtf_textil'     THEN 'dtf_textil'
  WHEN 'impressao_dtf_uv'         THEN 'dtf_uv'
  WHEN 'impressao_dtf_uv_textil'  THEN 'dtf_uv_textil'
  WHEN 'impressao_dtf_textil_uv'  THEN 'dtf_uv_textil'
  WHEN 'camisetas_personalizadas' THEN 'peca_pronta'
  ELSE NULL  -- segmento (evangelicos, uniformes...) nao diz o produto
END;
```

E `content_category` no evento vem do trigger `pixel_events_normalize_nulls`,
que copia `leads_marketing.content_category` do lead vinculado.

Cadeia: `product_type` <- `content_category` <- lead. Zero informacao propria.

Coerencia com a regra, por produtor:

| produtor | n | coerente | viola |
|---|---:|---:|---:|
| won | 877 | 868 | 9 |
| rd_won | 361 | **360** | **1** |
| uuid | 190 | 169 | **21** |
| outro | 174 | 174 | 0 |

O UUID viola a propria regra em 11% dos casos contra 0,3% do rd_won — o
`product_type` do UUID e artefato, nao observacao.

## Fonte canonica independente: EXISTE

`deal_produtos_rd_obs` guarda as linhas de produto REAIS do deal na RD.
**20/20 do bloco tem produto real registrado la.**

Confronto dos 8 conflitantes contra a familia real da RD:

| deal | cc rd_won | cc uuid | familia REAL na RD | quem acerta |
|---|---|---|---|---|
| 6977eb58 Elton | impressao_dtf_textil | impressao_dtf_textil (pt dtf_uv) | dtf_textil | **rd_won** |
| 697b3b4b Fabricio | impressao_dtf_textil | impressao_dtf_uv_textil | dtf_textil | **rd_won** |
| 698f41fe Admilson | uniformes | impressao_dtf_textil | dtf_textil | **uuid** |
| 699f3702 Giovanna | evangelicos | camisetas_personalizadas | vestuario_personalizado | **uuid** |
| 69ae7ad4 Raimundo | diversos | camisetas_personalizadas | vestuario_personalizado | **uuid** |
| 69c13840 Thayrone | uniformes | camisetas_personalizadas | vestuario_personalizado | **uuid** (cc) |
| 697a4627 Otacilio | impressao_dtf_uv_textil | impressao_dtf_uv_textil | servico_estamparia | nenhum |
| 69b99bd1 Yghor | diversos | impressao_dtf_textil | servico_estamparia | nenhum |

**`rd_won` NAO esta sistematicamente certo** — a RD da razao ao UUID em 4 de 8.
Nenhum dos dois campos e a verdade do produto.

## Consumidores reais

| consumidor | campo | le o evento? | impacto |
|---|---|---|---|
| `vw_dora_venda_produto` | product_type | **nao** — filtra `event_id LIKE 'won\_%'` e junta em `vw_deal_produtos_fisico` | **zero** |
| `vw_dora_bcg` | product_type | sim, agrega TODOS os Purchase | pequeno, medido abaixo |
| `vw_cac_por_segmento` | content_category | **do LEAD**, nao do evento | **zero** |
| `pixel_events_br` | ambos | passthrough sem agregacao | zero |

A view seria de produto (`vw_dora_venda_produto`) ja usa a fonte canonica da RD
e ignora os dois campos do evento.

## Simulacao das politicas (contagem em `vw_dora_bcg`)

| product_type | hoje | A: manter rd_won | B: migrar uuid |
|---|---:|---:|---:|
| dtf_textil | 1068 | 1053 | 1058 |
| (sem_tipo) | 273 | 271 | 264 |
| peca_pronta | 128 | 126 | 128 |
| dtf_uv_textil | 91 | 91 | 90 |
| dtf_uv | 42 | 41 | 42 |

A politica B moveria Elton para `dtf_uv` e Otacilio para `dtf_textil` — os dois
valores que a RD e a propria regra de derivacao contradizem. **B degrada.**

A e C sao identicas no banco; diferem so na semantica declarada.

## Auto-refutacao: escolher rd_won apagaria informacao verdadeira?

Sim, em parte — e por isso a resposta nao e "rd_won esta certo":

- em 4 dos 8, a classificacao do UUID e a que bate com a RD;
- o `content_category` do UUID e um snapshot historico do campo do lead num
  momento passado, e esse historico nao existe em nenhuma outra tabela.

Mas nao se perde nada de fato, porque:

1. a verdade do produto esta em `deal_produtos_rd_obs`, intacta em 20/20;
2. o artefato de rollback (padrao `_r38_rollback`) guarda a linha inteira do
   alias em jsonb, preservando o snapshot historico;
3. nenhum consumidor le historico de classificacao de lead.

## Veredito

**20_PRONTOS**, sob politica **C — desqualificar o campo**.

Nao se escolhe entre dois valores porque nenhum dos dois e evidencia do
produto. Mantem-se fisicamente o valor do `rd_won` (nada e escrito),
declara-se `content_category`/`product_type` do evento como derivados e nao
confiaveis, e usa-se `deal_produtos_rd_obs` quando a pergunta for produto.

Condicao obrigatoria: o artefato de rollback deve guardar o snapshot completo
do alias em jsonb, como na R38.
