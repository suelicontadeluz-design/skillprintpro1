# R45 — fechamento semantico dos 11 grupos duplicados restantes

Rodada READ-ONLY de 2026-08-26. Nenhuma escrita.

Nao se procurou "qual linha deletar". Procurou-se **qual fato e verdadeiro**.

## Correcao de um erro meu (R37/R42)

Eu classifiquei `69b073ef59833a001e9ea0e1` (Vagner Chagas) como
"1 grupo com valor divergente da RD". **Falso positivo meu.** O `total_price`
vivo da RD e `475.43999999999994` (float) e os dois eventos tem `475.44`; minha
comparacao `is not distinct from` marcou divergencia onde ha identidade
decimal. A soma das linhas de produto da RD da exatamente 475,44. Vagner e
grupo limpo.

## RD ao vivo — 11/11

11/11 HTTP 200, `status='won'`, pipeline de vendas. E o mais importante:
**em 11/11 a soma das linhas de `deal_produtos_rd_obs` bate exatamente com
`total_price`**. O valor da RD nao e afirmado, e itemizado.

## Valor canonico por grupo

| deal | cliente | RD (= soma produtos) | evento A | evento B | quem bate |
|---|---|---:|---:|---:|---|
| 698205f7 | Galardao Store | 179,70 | rd_won 179,70 | uuid 179,70 | ambos |
| 698f1c4d | Igreja Batista | 466,68 | rd_won 466,68 | uuid 466,68 | ambos |
| 69b073ef | Vagner Chagas | 475,44 | rd_won 475,44 | uuid 475,44 | ambos |
| 69f6929b | Dbora Mdolo | 1.571,50 | uuid 1.571,50 | won 1.571,50 | ambos |
| 69fcd9d7 | Kleberson | 371,10 | rd_won 371,10 | won 371,10 | ambos |
| 69f3ac56 | Vanessa Buher | 310,15 | rd_won 310,15 | uuid 310,15 | ambos |
| 69a86f80 | Ana Ribeiro | **3.221,88** | uuid **3.221,88** | won 3.217,20 | **uuid** |
| 69e134f5 | Antonio Tadeu | **92,97** | rd_won **92,97** | won 107,97 | **rd_won** |
| 69f692ac | Bruno Cardoso | **261,60** | rd_won **261,60** | won 10,00 | **rd_won** |
| 69fce550 | Beats Estamparia | **152,74** | rd_won **152,74** | won 763,47 | **rd_won** |
| 69fceb63 | Willian Vieira | **755,48** | uuid **755,48** | won 835,82 | **uuid** |

Em 2 dos 5 divergentes o vencedor **nao** e o `rd_won`. "Prefixo manda" seria
regra errada.

## Identidade pela v56

| deal | leads no evento | v56 sobre o telefone do deal | veredito |
|---|---|---|---|
| 698f1c4d Igreja | e218bcbb (rd_won) x 559c601d (uuid) | **1 lead unico**: `Luciane -Igreja Batista` = e218bcbb | LEAD_CANONICO_PROVADO = rd_won |
| 69fcd9d7 Kleberson | 93c70a4f (rd_won, ph `119724914` truncado) x ac931260 (won) | **1 lead unico**: `Kleberson [5511972491479]` = ac931260 | LEAD_CANONICO_PROVADO = **won** |
| 69f3ac56 Vanessa | 9abb20c2 x 336a959d | **2 leads**, ambos `Vanessa Buher`, ph `554195338939` e `5541995338939` | IDENTIDADE_DUPLICADA |

Dois dos tres casos de identidade **deixaram de ser ambiguos**. Vanessa segue
sendo merge, nao consolidacao.

## Atribuicao: zero valida nas 22 linhas

| achado | linhas |
|---|---:|
| campanha valida | **0** |
| placeholder `valor_padrao_*` | 1 (Galardao) |
| `adset_id`/`ad_id` string vazia | 2 grupos |
| `adset_id` literal `'value:'` | 1 (Bruno) |
| source/medium validos | **0** |

Nada a migrar, nada a perder.

## Produto / categoria

Nao usados como verdade. A fonte foi `deal_produtos_rd_obs`, com cobertura
11/11. `content_category` e `product_type` do evento seguem DERIVADOS.

## Tipo de cirurgia

| classe | n | grupos |
|---|---:|---|
| **CONSOLIDACAO_SIMPLES** | **5** | Galardao, Igreja, Vagner, Dbora, Kleberson |
| CORRECAO_DE_VALOR_ANTES_DE_CONSOLIDAR | 5 | Ana, Antonio, Bruno, Beats, Willian |
| IDENTIDADE_PRECISA_RESOLVER | 1 | Vanessa |
| CONSOLIDACAO_COM_MIGRACAO | 0 | — |
| NAO_E_DUPLICATA | 0 | — |
| INDETERMINADO | 0 | — |

## Survivor proposto (somente os 5 simples)

| deal | survivor | alias | motivo |
|---|---|---|---|
| 698205f7 | `rd_won_…` | uuid | alias so tem placeholder |
| 698f1c4d | `rd_won_…` | uuid | survivor tem o lead canonico |
| 69b073ef | `rd_won_…` | uuid | identicos; prefixo canonico |
| 69f6929b | `won_…` | uuid | webhook canonico; uuid e sintetico |
| 69fcd9d7 | **`won_…`** | `rd_won_…` | **survivor tem o lead canonico**, o rd_won carrega o fragmento |

Kleberson inverte o padrao: o survivor e o `won_`, nao o `rd_won_`.

## Mapa

4 dos 5 tem o alias em `pixel_crm_sync_map` (1 linha cada, survivor ausente do
mapa) — repontamento limpo, zero conflito, zero 1:N. Kleberson **nao tem linha
de mapa nenhuma**: delete direto, sem tocar no mapa.

## Impacto simulado (somente os 5)

| metrica | antes | depois |
|---|---:|---:|
| linhas Purchase | 1601 | 1596 |
| receita removida | — | **R$3.064,42** |
| **canonical deals** | **1374** | **1374** |
| compradores unicos | 505 | 504 |
| repeat buyers | 219 | 218 |

O −1 comprador e o lead duplicado `559c601d` da Igreja Batista, cuja unica
compra era a atribuicao errada. Correcao, nao perda.

## Subcontagem real restante (pos-R44), nao trabalhada aqui

32 deals won ainda sem representacao segura: **24 SEM_LEAD + 8 AMBIGUO**,
~R$17.304,10. Fora: 4 ja representados em `csv_backfill` e 1 deal 404.

## Risco tecnico permanente registrado

INSERT retroativo em `pixel_events.Purchase` aciona
`fn_cancelar_disparos_apos_compra` e `fn_trigger_feedback_purchase`, que agem
por `lead_id` **sem filtro de data** — cancelam disparos e fecham `crm_tasks`
abertas hoje. Na R44 o raio foi zero, mas o mecanismo continua vivo.
**Gate obrigatorio para qualquer backfill futuro.**

## Auto-refutacao

- *Nao e duplicata?* Nos 5 simples, mesmo deal, mesmo valor, valor = RD
  itemizada, mesma identidade canonica. Duplicata.
- *Valor diferente e ajuste legitimo?* Possivel nos 5 divergentes — por isso
  nenhum foi promovido.
- *Survivor perde atribuicao?* Nao: zero atribuicao valida em 22/22 linhas.
- *UUID guarda evidencia exclusiva?* Nao nos 5 simples.
- *Mapa impede delete?* Nao: 4 repontam limpo, 1 nem esta no mapa.
- *Duas linhas = fatos distintos?* Nos 5 divergentes, e exatamente a duvida
  aberta. Nos 5 simples, os valores sao identicos e iguais a RD.

## Veredito

**BLOCO_SEGURO_ENCONTRADO — 5 grupos, R$3.064,42.**

N_CONSOLIDACAO_SIMPLES = 5
N_COM_MIGRACAO = 0
N_CORRECAO_VALOR = 5
N_IDENTIDADE = 1
N_NAO_DUPLICATA = 0
N_INDETERMINADO = 0
