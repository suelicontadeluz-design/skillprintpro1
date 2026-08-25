# R24 — Reconciliação das duas verdades de ciclo de mídia

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL` em todas as sessões.
`criterios_midia` inalterada: 43 linhas, `max(updated_at)` = `2026-08-01 09:00:00.516301+00`,
hash `1e36e95cacb95a9875572bbf00dce4ff`. Zero deploy, zero DDL, zero Meta.

Ressalva honesta: uma tentativa de `CREATE TEMP TABLE` estourou timeout de 60s e foi abortada.
Tabela temporária vive no schema temporário da conexão e desaparece com ela — nenhum efeito em
dado do usuário, confirmado pelo readback acima. Substituída por CTEs pré-agregadas.

## VEREDITO: `CICLO_45_PROVADO_134_INVALIDO`

A hipótese principal — "elas medem eventos diferentes" — **está confirmada como explicação da
divergência**. Mas ela não sobrevive ao segundo teste: o 134 não é uma medida *válida* nem do
fenômeno que ele tangencia. Por isso não posso declarar `CICLOS_SAO_METRICAS_DIFERENTES`, que
exigiria que os dois fossem verdadeiros. O fenômeno de relacionamento **é real e deve ser
preservado** — mas com outro número, outra fonte e outro nome.

---

## 1. ORIGEM DO 134

| pergunta | resposta provada |
|---|---|
| **quem escreveu** | `fn_recalcular_criterios_midia()` — plpgsql, `VOLATILE`, 5.606 b |
| **por qual processo** | `cron.job` **85**, `diego-recalcular-criterios`, `0 9 1 * *` (mensal, dia 1, 09:00 UTC), `active=true` |
| **quando** | linha semeada em `2026-05-17 03:47:02.757093+00`; valor atual gravado em `2026-08-01 09:00:00.516301+00` |
| **migration de origem** | `20260517034546_criterios_teste_midia` (tabela + seed) e `20260517035344_criterios_midia_dinamicos` (função + cron) |
| **fonte do dado** | `pixel_events` × `leads_marketing` — **não** é fonte pré-pixel |
| **`fonte` declarada** | `diego_analise` (rótulo, não procedência) |

**Primeiro achado estrutural: `dias_ciclo` não é uma coluna.** Não existe
`criterios_midia.dias_ciclo`. Existe uma linha `(segmento, tipo='tempo', metrica='dias_ciclo')`
cujo valor mora em `valor_minimo`. A R23 nomeou como coluna o que é uma linha — irrelevante para
a conclusão, mas registro a correção.

### Definição matemática literal

```sql
tempo_conv AS (
  SELECT lm.content_category AS segmento,
         AVG(EXTRACT(EPOCH FROM (pe.event_time - lm.created_at))/86400) AS dias_ciclo
  FROM pixel_events pe
  JOIN leads_marketing lm ON lm.lead_id = pe.lead_id
  WHERE pe.event_name = 'Purchase'
    AND pe.event_time >= NOW() - INTERVAL '90 days'
    AND pe.event_time > lm.created_at
  GROUP BY lm.content_category
)
```

Então `dias_ciclo` mede: **média aritmética da idade de TODO evento `Purchase` dos últimos 90
dias, em relação ao `created_at` do lead, sem deduplicar por lead.**

Traduzindo para as opções que você listou:

| conceito | é isso? |
|---|---|
| lead → venda | **parcialmente** — é lead → *cada* venda |
| contato → venda | não |
| primeira conversa → venda | não |
| proposta → venda | não |
| **primeira compra** | **não** — não há `ord = 1`, não há `DISTINCT ON` |
| **recompra** | **sim, incluída** |
| tempo entre compras | não |
| **outro conceito** | **sim: idade média das compras, ponderada pela frequência de compra do cliente** |

### Três defeitos de construção, no próprio código

1. **A janela de 90 dias filtra o EVENTO, não o LEAD.** `pe.event_time >= NOW() - 90d` sem
   qualquer filtro em `lm.created_at`. Um lead de 2024 que compra hoje entra com ~700 dias. É
   por isso que uma "janela de 90 dias" produz uma média de 134 — contradição que já estava
   escrita no próprio `motivo` da linha e nunca foi lida.
2. **`baseado_em_n = 2484` vem de outra população.** Esse número sai da CTE `leads_seg`
   (`lm.created_at >= NOW() - 90d`). A média sai de `tempo_conv`, que **não tem filtro de data de
   lead**. O texto "145 compradores em 2.484 leads" cola três populações distintas: leads dos
   últimos 90d (denominador), compradores de qualquer safra (numerador) e eventos de qualquer
   safra (a média). **Nenhum dos três é o n do 134.**
3. **`content_category` é a categoria anunciada no lead, não o produto do pedido.** O grupo
   "impressao_dtf_textil" é o que o anúncio dizia, não o que foi impresso.

Prova do defeito 2, replay em `2026-08-01`, `impressao_dtf_textil`:

| medida | valor |
|---|---|
| `leads_seg` (leads criados nos 90d) | 2.895 |
| `compras_seg` (compradores, qualquer safra) | 146 ≈ 145 gravado ✓ |
| **compradores que TAMBÉM são leads dos 90d** | **78** |

A taxa de conversão 145/2484 = 5,8% divide um numerador de qualquer safra por um denominador de
90 dias. A taxa real na mesma safra é 78/2895 = 2,7%.

## 2. REPRODUÇÃO DO 134 — `134_REPRODUZIVEL`

`ingested_at` existe em `pixel_events` desde `2026-07-26`; 1.303 de 1.603 `Purchase` têm
`ingested_at IS NULL` (linhas anteriores à coluna). Estado da tabela em 2026-08-01 reconstruído
como `ingested_at IS NULL OR ingested_at <= t0`.

| variante | n eventos | média |
|---|---|---|
| dados de hoje, sem reconstrução | 593 | 138,75 |
| **reconstrução em `2026-08-01 09:00`** | **435** | **132,49** |
| + `event_time <= t0` | 435 | 132,49 |
| + `created_at <= t0` | 435 | 132,49 |
| **valor gravado** | — | **134** |

**Delta 1,51 dia (1,1%).** A fórmula está identificada e re-derivada. O resíduo é atribuível a
linhas com `ingested_at` nulo inseridas por caminho que não preenche a coluna, e a eventual
reclassificação de `content_category` — nenhum dos dois reconstruível. **Reprodução aceita.**

Sanidade: a mesma fórmula reproduz os outros segmentos gravados (camisetas 56 vs 52 gravado,
UV 48 vs 52, terceirão 28 vs 31, uniformes 29 vs 55) — todos na ordem certa, com a mesma deriva
de janela móvel.

## 3. ORIGEM DO 45

A R22 não mediu "45" como estatística. Mediu a **curva acumulada de primeira compra** e cortou
onde ela satura. Método:

- **T0:** `least(leads_marketing.created_at, min(pixel_events não-Purchase))`
- **População:** leads com `utm_campaign_id IS NOT NULL`
- **Evento:** `Purchase` com `value > 0`
- **Primeira compra:** `row_number() over (partition by lead_id order by event_time) = 1`
- **Recompra:** excluída
- **Janela da base:** nenhuma — o delta é medido a partir do T0 de cada lead
- **Campanha resolvida:** na §4 da R22, apenas `utm_campaign_id` preenchido (a §8 usava o
  critério mais duro de `campaign_id` reconhecido em `meta_ads_insights`)

## 4. REPRODUÇÃO DO 45 — `45_REPRODUZIDO_EXATO`

Recálculo LIVE, `impressao_dtf_textil`:

| | R22 relatado | LIVE hoje |
|---|---|---|
| n | 102 | **102** ✓ |
| mediana | 5,1 | **5,1** ✓ |
| ≤30d | 68 | **68** ✓ |
| ≤45d | 71 | **71** ✓ |
| ≤60d | 71 | **71** ✓ |
| ≤90d | 71 | **71** ✓ |

Byte a byte. E um número que a R22 **não** publicou e que muda a leitura: **a média dessa mesma
população é 71,2 dias**, não 45. O "45" nunca foi uma média. Comparar 134 (uma média) com 45
(um ponto de corte) já era comparação inválida antes de qualquer diferença de população.

Com o critério duro (campanha reconhecida no Meta): n=78, ≤45 = ≤60 = ≤90 = 51. A saturação
sobrevive aos dois recortes.

## 5. POPULAÇÕES LADO A LADO

| | **134 dias** | **45 dias** |
|---|---|---|
| universo | leads com `content_category`, **qualquer safra** (desde 2024-07-19) | leads com `utm_campaign_id` (13.353) |
| exige campanha? | **não** | **sim** |
| datas | eventos dos últimos 90d; leads sem limite | sem janela; delta a partir do T0 de cada lead |
| T0 | `lm.created_at` | `least(created_at, min pixel não-Purchase)` |
| produto | `content_category` (categoria anunciada) | `content_category` (mesma) |
| leads no grupo DTF têxtil | 11.456 | 13.353 (todos os segmentos) |
| leads que entram na conta | só quem comprou: 227 (**2,0%**) | só quem comprou: 188 (**1,4%**) |
| vendas contadas | **435 eventos** de 146 leads | **102 primeiras compras** de 102 leads |
| recompra | **incluída e ponderada por frequência** | **excluída** |
| estatística | média aritmética | ponto de saturação da curva acumulada |
| canais | qualquer | qualquer |
| origem | `pixel_events` | `pixel_events` + `leads_marketing` |

**Os dois números são comparáveis? NÃO.** Diferem em população, em unidade de observação
(evento vs. lead), em tratamento de recompra e em estatística. Quatro diferenças simultâneas.

## 6. DECOMPOSIÇÃO DOS CICLOS

População: 13.353 leads com campanha. 188 compraram; 88 recompraram; 4.667 têm conversa;
6.722 têm proposta.

| | etapa | n | média | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| **A** | aquisição → 1ª conversa | 2.601 | 23,6 | **0,0** | 0,0 | 79,9 | 237,0 |
| **B** | aquisição → 1ª proposta | 5.265 | 119,6 | 35,2 | 270,4 | 271,0 | 271,2 |
| **C** | aquisição → 1ª compra | 176 | 54,9 | **6,0** | 39,4 | 208,3 | 262,5 |
| **D** | 1ª conversa → 1ª compra | 123 | 8,1 | **2,2** | 9,1 | 22,3 | 27,5 |
| **E** | 1ª proposta → 1ª compra | 109 | 7,4 | **1,7** | 8,0 | 15,9 | 31,6 |
| **F** | 1ª compra → 2ª compra | 88 | 21,0 | **10,1** | 21,8 | 51,4 | 107,8 |
| **G** | 1ª compra → última compra | 88 | 64,4 | 31,4 | 114,0 | 180,1 | 191,9 |
| **H** | aquisição → última compra | 182 | 83,4 | 18,6 | **133,0** | 305,4 | 352,5 |

**Qual ciclo se aproxima de 134?** O **H** — relacionamento inteiro — no P75: **133,0 dias**.
Nenhuma etapa de aquisição chega perto. As etapas de aquisição são todas de dias, não de meses:
conversa em 0 dias, conversa→compra em 2,2, proposta→compra em 1,7.

A etapa B (proposta) tem P75/P90/P95 travados em ~271 — assinatura de importação em bloco, não
de comportamento. Não usar B para nada.

### A escada: qual mudança transforma um número no outro

`impressao_dtf_textil`, cada linha adiciona **uma** alteração à anterior:

| passo | n | média | Δ |
|---|---|---|---|
| **S0** R22: campanha + `ord=1` + T0=`least` | 99 | **73,0** | — |
| S1 + T0 = `created_at` (abandona o `least`) | 99 | 73,0 | **0,0** |
| **S2 + inclui recompra (todos os eventos)** | 438 | **135,1** | **+62,1** |
| S3 + deixa de exigir campanha | 936 | 125,6 | −9,5 |
| S4 + janela de evento de 90d (= fórmula viva) | 461 | 140,1 | +14,5 |

**A escolha de T0 é irrelevante (0,0 dia).** **Contar recompra responde por praticamente todo o
abismo: +62 de ~62 dias.** O resto são efeitos de segunda ordem que quase se cancelam.

### Por que contar recompra dobra o número: a ponderação

`impressao_dtf_textil`, peso de cada lead no `AVG` sem deduplicação:

| compras do lead | leads | eventos | **% do peso** | média de dias do lead |
|---|---|---|---|---|
| 1 | **110** | 110 | **11,8%** | 37,1 |
| 2–4 | 61 | 161 | 17,2% | 103,7 |
| 5–9 | 28 | 184 | 19,7% | 169,8 |
| 10–19 | 22 | 304 | **32,5%** | 127,6 |
| 20+ | **6** | 177 | **18,9%** | 136,0 |

**110 leads de compra única — metade dos compradores — valem 11,8% do resultado. Seis contas
com 20+ pedidos valem 18,9%.** Os 12% de clientes com 10+ compras carregam **51,4%** do número.

`dias_ciclo` de DTF têxtil é, na prática, a idade média das compras de uma dúzia de contas
recorrentes B2B. Não é um ciclo. É um retrato de carteira.

## 7. PRIMEIRA COMPRA VS RECOMPRA

O teste que você pediu — "45 = aquisição, 134 = relacionamento" — **passa na direção e falha no
valor.**

Passa: nenhuma etapa de aquisição (A, C, D, E) chega a 134; a etapa de relacionamento (H)
chega a 133 no P75. A separação semântica é real.

Falha: **134 não é uma medida honesta de relacionamento**, porque chega lá por dois vieses
grandes que se somam (§8 e §9), não por medir relacionamento.

### Corroboração independente, de fonte pré-pixel

`calcme_pedidos`: **3.730 pedidos, 1.135 clientes, 2024-01-11 → 2026-02-10** — dois anos,
anterior ao pixel, sem qualquer relação com `pixel_events` ou `leads_marketing`.

| medida (CalcMe, excluindo `Cancelado`) | n | média | P50 | P75 | P90 |
|---|---|---|---|---|---|
| intervalo entre pedidos consecutivos | 2.570 | 38,5 | **12** | 34 | 105 |
| span 1º → último pedido (clientes ≥2) | 469 | 210,8 | **147** | 353 | 500 |

Confronto com o pixel:

| conceito | pixel | CalcMe | veredito |
|---|---|---|---|
| intervalo entre compras | P50 10,1 (n=88) | P50 **12** (n=2.570) | **concordam** |
| span do relacionamento | P50 31,4 (n=88, 7 meses de janela) | P50 **147** (n=469, 2 anos) | concordam na direção; o pixel está truncado |

Duas fontes independentes, uma delas com 24× mais dados e o dobro do horizonte, concordam:
**recorrência ≈ 12 dias; relacionamento ≈ 147 dias (mediana).** O 134 fica na faixa de
relacionamento — mas por acaso, e a mediana honesta desse fenômeno é 147, não 134.

## 8. PRODUTOS

Curva de primeira compra na **coorte limpa** (leads nascidos após o início do pixel,
`2026-01-26`, sem os importados de agosto/2025):

| categoria | n | média | P50 | P95 | máx | ≤7 | ≤14 | ≤30 | **≤45** | ≤90 |
|---|---|---|---|---|---|---|---|---|---|---|
| impressao_dtf_textil | **65** | **4,6** | 1,2 | 15,3 | 42,0 | 52 | 58 | 64 | **65** | 65 |
| diversos | 21 | 9,2 | 5,9 | 38,3 | 42,0 | 13 | 16 | 19 | **21** | 21 |
| impressao_dtf_uv | 12 | 16,3 | 2,5 | 73,1 | 135,1 | 8 | 10 | 11 | **11** | 11 |
| evangelicos | 11 | 20,3 | 8,2 | 66,4 | 84,0 | 4 | 7 | 8 | **9** | 11 |
| camisetas_personalizadas | 9 | 25,9 | 12,9 | 89,7 | 119,6 | 4 | 5 | 7 | **8** | 8 |

**134 não é específico de DTF têxtil nem resultado de mistura de categorias.** Na coorte limpa,
DTF têxtil é o segmento **mais rápido** da casa: média 4,6 dias, 100% das primeiras compras em
42 dias. O 134 é um artefato de método que atinge com mais força justamente o segmento de maior
volume e maior recompra — porque é lá que a ponderação por frequência morde mais.

Cobertura honesta: só DTF têxtil e `diversos` têm n ≥ 20. Os demais são n ≤ 12 e **não sustentam
janela própria.**

## 9. VIESES

### 9.1 Sobrevivência — severo, e confirmado

`tempo_conv` só enxerga leads que compraram. Em `impressao_dtf_textil`: **11.456 leads,
227 compraram = 1,98%.** **98% da população não entra na média.** `dias_ciclo` é uma média
condicional a ter comprado, apresentada como se fosse o ciclo do segmento.

Consequência prática: quem nunca compra é invisível, e quem compra muitas vezes pesa muitas
vezes. Os dois erros empurram o número na mesma direção.

### 9.2 Truncamento à esquerda do histórico de compra — o maior viés isolado

`pixel_events` só tem `Purchase` a partir de **2026-01-26**. Leads anteriores a essa data têm a
"primeira compra observada" definida pelo início do pixel, não pelo comportamento.

Das 176 primeiras compras da população com campanha:

| grupo | n | % | média de dias |
|---|---|---|---|
| lead criado **antes** do pixel | 40 | 22,7% | **209,5** |
| lead criado **depois** do pixel | 136 | 77,3% | **9,3** (P50 = **2,7**) |

**Uma diferença de 22×.** E aqui preciso corrigir a R22: eu atribuí a cauda longa de 22% a
"atribuição espúria de leads antigos" sem provar o mecanismo. O mecanismo é este —
**censura à esquerda do histórico de compra** — e ele explica a cauda inteira.

### 9.3 `created_at` como data de sincronização — confirmado

Concentração de `leads_marketing.created_at`:

| data | leads |
|---|---|
| **2025-08-22** | **4.655** |
| 2025-08-23 | 1.249 |
| 2025-08-21 | 349 |

**6.253 leads em três dias = 39% da base inteira.** Importação em bloco, não aquisição.

Impacto direto no 134 (`impressao_dtf_textil`, janela viva de 90d):

| leads | eventos | **média de dias** |
|---|---|---|
| não importados | 328 | **64,9** |
| **importados em ago/2025** | 133 (**29% do peso**) | **325,6** |

**35 leads cujo T0 é um carimbo de importação carregam 29% do peso do número, com média de
325,6 dias.** Removê-los derruba a média de 140 para 64,9.

### 9.4 Truncamento à direita — controlado, e a conclusão sobrevive

Coorte limpa, por maturidade mínima:

| maturidade | n | média | ≤30 | **≤45** | ≤60 | ≤90 | %≤45 |
|---|---|---|---|---|---|---|---|
| qualquer | 136 | 9,3 | 127 | **132** | 133 | 134 | **97,1%** |
| ≥ 90 dias | 69 | 13,2 | 62 | **65** | 66 | 67 | **94,2%** |
| ≥ 150 dias | 37 | 15,7 | — | **34** | — | — | **91,9%** |

A média sobe com a maturidade (9,3 → 15,7), como tem de subir. Mas **a cobertura de 45 dias fica
entre 92% e 97% em todos os cortes.** A saturação não é artefato de janela curta.

### 9.5 Backfill de eventos

De 1.603 `Purchase`, 243 foram ingeridos **depois** de 2026-08-01. A janela móvel de 90 dias
combinada com backfill faz o mesmo segmento oscilar entre execuções mensais sem que nada tenha
mudado no negócio. Não há tabela de histórico de `criterios_midia` — **o valor original semeado
em 2026-05-17 foi sobrescrito e está perdido.**

## 10. FONTE PRÉ-PIXEL

A R23 sugeriu que o 134 viesse de fonte anterior ao pixel. **Isso está refutado:** o 134 vem de
`pixel_events`, provado por reprodução (§2).

Mas existe uma fonte pré-pixel real, e ninguém a usa para medir ciclo:

| fonte | n | início | fim | confiabilidade temporal |
|---|---|---|---|---|
| `calcme_pedidos` | 3.730 | **2024-01-11** | 2026-02-10 | **alta** — data do pedido, sistema de produção |
| `pixel_events` Purchase | 1.561 | 2026-01-26 | 2026-08-25 | alta para o evento; **cega antes de 2026-01-26** |
| `propostas_rd` | 11.911 | 2026-01-25 | 2026-08-24 | média — assinatura de importação no P75 (§6, etapa B) |
| `crm_deal_snapshot` | 6.801 | 2026-01-25 | 2026-08-25 | média |
| `fact_conversations` | 270.247 | **2026-03-30** | 2026-08-25 | alta, mas começa tarde |
| `leads_marketing` | 15.993 | 2024-07-19 | 2026-08-25 | **baixa em 39%** — importação de ago/2025 |
| `meta_ads_insights` | — | — | — | não tem `daily_budget` (R23) |

**CalcMe cobre 2024-01 a 2026-02; o pixel cobre 2026-01 em diante.** Sobreposição de duas
semanas. Juntas dão 2,5 anos de histórico de compra — e hoje nenhum objeto do banco as costura.
Não descartei a fonte antiga: é ela que corrobora o §7.

## 11. SEMÂNTICA CANÔNICA PROPOSTA

Nomes distintos para conceitos distintos. **Nenhum reutiliza `dias_ciclo`.**

| nome | definição | valor medido | fonte | n | confiança |
|---|---|---|---|---|---|
| `ciclo_aquisicao_dias` | T0 → **primeira** compra, coorte limpa | P50 **1,2** · P95 **15,3** · **corte 45** | pixel, pós-2026-01-26 | 65 (DTF têxtil) · 136 (todos) | **alta** |
| `ciclo_recorrencia_dias` | intervalo entre compras consecutivas | P50 **12** | **CalcMe** (2 anos) | 2.570 | **alta** — 2 fontes concordam |
| `horizonte_relacionamento_dias` | 1º → último pedido, clientes com ≥2 | P50 **147** · média 211 | **CalcMe** | 469 | **média** — truncado à direita |
| `horizonte_ltv_dias` | período de acompanhamento de coorte | **não medido** | — | — | **DESCONHECIDO** |
| ~~`dias_ciclo`~~ | — | — | — | — | **APOSENTAR** |

`horizonte_ltv_dias` fica declarado DESCONHECIDO de propósito: é uma escolha de política de
observação, não uma medição, e a R23 provou que **zero objetos** do banco calculam LTV.

### Nota crítica sobre o risco real do `dias_ciclo`

Varredura completa de `pg_proc` e `pg_get_viewdef` em todos os schemas: a string `dias_ciclo`
aparece **exclusivamente dentro de `fn_recalcular_criterios_midia`**, que a escreve. O único
consumidor de `criterios_midia` no banco — `fn_gustavo_processar_handoffs_shadow` — lê apenas
`tipo='teste'` (`orcamento_maximo`, `testes_simultaneos`).

**`dias_ciclo` tem zero leitores. É um número write-only.**

Isso corrige, para menos, a gravidade que atribuí na R23: as duas verdades não estão em
disputa operacional hoje; uma delas não está em uso nenhum. E corrige, para mais, uma outra
coisa — **a regra de pausa de `criterios_midia` não tem nenhum portão de maturação, porque a
única métrica temporal da tabela não é lida por ninguém.** Pausar por R$100 acumulados sem
esperar a janela fechar é o risco concreto; ele não depende do 134 estar certo ou errado.

Limite de escopo: provei ausência de leitores **dentro do banco**. Edge functions acessam via
PostgREST e não são varríveis por SQL. A auditoria de edges da R23 não encontrou leitura de
`criterios_midia`, mas isso é evidência, não prova.

## 12. IMPLICAÇÕES PARA CAC / LTV / PAYBACK / ATRIBUIÇÃO

O motor econômico vivo (`vw_midia_coorte_aquisicao_shadow`, lido por
`midia_shadow.fn_observador_impl`) já usa, hoje:

- janela de atribuição: `p.event_time <= l.acquired_at + '30 days'`
- maturação: `created_at <= CURRENT_DATE - 30`
- **`DISTINCT ON (p.lead_id) ORDER BY p.lead_id, p.event_time` → primeira compra apenas** ✓

Ou seja: **o shadow já exclui recompra corretamente.** O ajuste pendente é só 30 → 45.

| métrica | alimentar com | valor | por quê |
|---|---|---|---|
| **atribuição** | `ciclo_aquisicao_dias` | **45 dias** | 92–97% das primeiras compras, coorte limpa, sob controle de maturidade |
| **CAC** | mesma janela, `ord=1`, coorte madura | **45 dias** | CAC é custo de *adquirir*; recompra não é aquisição |
| **maturação de campanha** | igual à janela | **45 dias** | julgar antes de fechar a janela é julgar com receita truncada |
| **payback** | — | **DESCONHECIDO** | sem custo de produto, taxa e frete (R23), receita − mídia não é lucro e não vira payback |
| **LTV** | `horizonte_relacionamento_dias` + CalcMe | **não construído** | R23: zero objetos. Precisa costurar CalcMe + pixel primeiro |
| **recompra** | `ciclo_recorrencia_dias` | **12 dias** (P50) | duas fontes independentes concordam |
| **pausa** | CAC vs. teto, **com portão de maturação de 45d** | — | hoje pausa por gasto acumulado, sem portão nenhum |
| **escala** | `contribuicao_conservadora` | — | **continua bloqueada** (R21). Nada aqui destrava |

Impacto medido de 30 → 45, coorte limpa com maturidade ≥90d:

| janela | 1ªs compras | receita de 1ª compra |
|---|---|---|
| 30d | 62 (89,9%) | R$ 34.266,69 |
| **45d** | **65 (94,2%)** | **R$ 38.456,19** (**+12,2%**) |
| 90d | 67 (97,1%) | R$ 39.849,43 (+3,6% sobre 45d) |

**A regra que você impôs está respeitada nos dois sentidos.** Relacionamento longo **não** virou
janela longa: a janela fica em 45 dias, apesar de o relacionamento durar 147. E a janela curta
**não** eliminou a recompra: ela ganha nome, valor e fonte próprios
(`ciclo_recorrencia_dias` = 12, `horizonte_relacionamento_dias` = 147), fora da conta de CAC.

## 13. AUTO-REFUTAÇÃO

| tentativa de matar a conclusão | resultado |
|---|---|
| **45d está limitado pelo início do pixel?** | **Parcialmente sim — e isso reforça o 45, não o enfraquece.** A coorte limpa satura em ~42 dias com máximo observável de 211. Mas a cauda de 22% que eu usei na R22 para rejeitar 90d era ela própria artefato de censura. Conclusão certa, argumento errado — corrigido no §9.2 |
| **134 sofre survivorship bias?** | **Sim, severo.** 98% dos leads DTF têxtil não entram na média |
| **A população de 2.484 não é de mídia?** | **Pior: não é a população do 134.** `baseado_em_n` vem de outra CTE (§1) |
| **Produto está misturado?** | Não. Na coorte limpa, DTF têxtil é o mais rápido da casa (4,6 dias). O 134 não vem de mistura |
| **`created_at` é data de sync?** | **Sim, em 39% da base.** Esses leads carregam 29% do peso do 134 com média de 325,6 dias |
| **Purchase do RD está atrasado?** | Não testável isoladamente. O pixel é a fonte dos dois números, então o viés, se existe, é comum e não explica a divergência |
| **Recompra foi confundida com conversão?** | **Sim — é a causa dominante.** +62 de ~62 dias na escada (§6) |
| **Campanhas não existiam no T0?** | Relevante para os 40 leads pré-pixel: `utm_campaign_id` pode ter sido preenchido por enriquecimento posterior. Já excluídos da coorte limpa |
| **Estamos comparando relacionamento com aquisição?** | **Sim — hipótese confirmada.** Mas 134 não mede relacionamento honestamente (§7) |
| **A escada prova causalidade ou é coincidência?** | Cada passo isola **uma** alteração. S1→S2 (única mudança: incluir recompra) move 73,0 → 135,1. É isolamento, não correlação |
| **E se `content_category` mudar de valor com o tempo?** | Não consigo excluir — não há histórico. É a explicação candidata para o resíduo de 1,5 dia da reprodução |
| **A corroboração do CalcMe é circular?** | Não. `calcme_pedidos` não tem `lead_id`, não referencia `pixel_events`, e o período mal se sobrepõe (2 semanas) |
| **Os n pequenos por produto invalidam a janela?** | Para produto sim — só DTF têxtil e `diversos` têm n≥20. Por isso **não** recomendo janela segmentada |
| **A média de 71,2 da população do "45" não contradiz o 45?** | Não: 71,2 é média de uma distribuição com cauda censurada (§9.2). Na coorte limpa a média cai para 4,6 |

## 14. VEREDITO

### `CICLO_45_PROVADO_134_INVALIDO`

**45 está provado e saiu mais forte.** Reproduzido exato (n=102, ≤45=71). Depurado de censura à
esquerda e de importação em bloco, cobre 92–97% das primeiras compras sob controle de
maturidade, com o corte apoiado em n=136 em vez de n=182 contaminados.

**134 é reproduzível como cálculo e inválido como medida.** Três defeitos independentes:
mistura aquisição com recompra ponderada por frequência (+62 dias), toma 29% do seu peso de
leads cujo T0 é um carimbo de importação (média 325,6 dias), e é condicional a ter comprado
(exclui 98% da população). Além disso, seu `baseado_em_n` e sua taxa de conversão vêm de
populações diferentes da própria média.

**Por que não `CICLOS_SAO_METRICAS_DIFERENTES`:** esse veredito exigiria que os dois fossem
verdadeiros para fenômenos diferentes. A primeira metade é verdadeira — eles medem coisas
diferentes, e isso explica a divergência. A segunda não: 134 não é uma medida honesta de
relacionamento. O fenômeno existe e a medida dele é **147 dias de mediana** (CalcMe, n=469),
com recorrência de **12 dias** (n=2.570). O 134 chega perto do 147 por acaso, somando dois
vieses grandes.

**O que preservar dos dois:** a janela de aquisição de 45 dias e — com outro nome, outro número
e outra fonte — o relacionamento. Nada de valor se perde ao aposentar o 134.

**O que muda para o Cérebro hoje:** nada urgente. `dias_ciclo` tem zero leitores. Isso rebaixa
a gravidade que atribuí na R23: não há duas verdades econômicas disputando uma decisão — há uma
verdade em uso (30 dias, primeira compra, no shadow) e um número órfão que ninguém lê.

## 15. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e continua não sendo construir: **costurar `calcme_pedidos` a `leads_marketing`.**

CalcMe tem 3.730 pedidos e 2 anos de histórico de compra que o pixel não enxerga. É a única
fonte capaz de resolver, ao mesmo tempo:

- a censura à esquerda que distorce toda medida de ciclo antes de 2026-01-26;
- o LTV e o payback, que hoje não existem em objeto nenhum (R23);
- e os 70,6% de compras sem campanha resolvida (próximo passo da R22, ainda aberto).

A ligação provável é telefone (`clientes_calcme.telefone_canonico`). **Antes de qualquer
modelo: medir a taxa de casamento.** Se a cobertura for baixa, isso precisa ser dito — e não
compensado com estimativa.

Não recomendo mexer em `dias_ciclo` nesta rodada. Sem leitores, ele é inofensivo; corrigi-lo
antes de decidir o que a empresa quer medir só troca um número errado por outro sem destino.
