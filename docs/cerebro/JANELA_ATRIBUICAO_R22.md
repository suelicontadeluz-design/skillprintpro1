# R22 — Janela canônica de atribuição de mídia da Skillprint

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY, nada publicado

## VEREDITO: `JANELA_CANONICA_PROVADA` — **45 dias, contando apenas primeira compra**

Com uma ressalva severa que não muda a janela mas muda o que ela pode decidir: **só 12% da
receita da empresa é atribuível a campanha Meta.** Detalhe no item 8.

---

## 1. T0 CANÔNICO

Três candidatos medidos em 6.265 leads com campanha (180d):

| candidato | cobertura | mediana vs `created_at` | sinal ANTES do `created_at` |
|---|---|---|---|
| `leads_marketing.created_at` | 100% | — | — |
| **`min(pixel_events)` não-Purchase** | **98,8%** | **0,000 d** | 2.097 (33%) |
| `min(fact_conversations)` inbound | 65,7% | 0,000 d | 3.318 (53%) |

`created_at` **não é** o instante de aquisição: em 33–53% dos casos há sinal anterior a ele
(enriquecimento, backfill). Mas a mediana da diferença é **zero**.

**T0 adotado:** `least(leads_marketing.created_at, min(pixel_events não-Purchase))`.
Monotônico, nunca posterior a qualquer sinal, 98,8% de cobertura.

Nota: `leads_first_touch_audit` existe (guarda de imutabilidade de first-touch) e está
**vazia** — a guarda nunca disparou. Não é prova de que não há sobrescrita; é ausência de registro.

## 2. DISTRIBUIÇÃO T0 → PRIMEIRA VENDA

n = **182** primeiras vendas atribuíveis a campanha.

| medida | dias |
|---|---|
| média | 54,1 |
| P25 | **1,0** |
| **P50 (mediana)** | **6,0** |
| P75 | 41,1 |
| P90 | **207,7** |
| P95 | 256,1 |
| máximo | 368,2 |

Distribuição fortemente bimodal: metade compra quase imediatamente, e há uma cauda de 6–12 meses.

| faixa | n | % | **% acum** | receita | **receita % acum** |
|---|---|---|---|---|---|
| 0–7d | 96 | 52,7 | **52,7** | 31.601,10 | **48,2** |
| 8–14d | 18 | 9,9 | 62,6 | 6.375,37 | 58,0 |
| 15–30d | 18 | 9,9 | **72,5** | 5.621,16 | **66,6** |
| **31–45d** | 8 | 4,4 | **76,9** | 6.008,20 | **75,7** |
| 46–60d | **1** | 0,5 | 77,5 | 1.333,34 | 77,8 |
| 61–90d | **1** | 0,5 | **78,0** | 59,90 | **77,9** |
| >90d | 40 | 22,0 | 100,0 | 14.507,50 | 100,0 |

**A faixa 46–90 dias tem 2 vendas em 182 (1,1%) e 2,2% da receita.** Estender de 45 para 90
dias compra praticamente nada — e abre a porta para os 22% de cauda longa, que são quase
certamente atribuição espúria de leads antigos.

## 3. PRIMEIRA VENDA × RECOMPRA — o argumento mais forte

| janela | 1ªs vendas | recompras | receita 1ª | receita recompra | **% receita de recompra** |
|---|---|---|---|---|---|
| 30d | 132 | 88 | 43.597,63 | 27.437,06 | 38,6% |
| **45d** | **140** | 121 | **49.605,83** | 37.743,57 | **43,2%** |
| 60d | 141 | 151 | 50.939,17 | 44.908,92 | 46,9% |
| 90d | 142 | 186 | **50.999,07** | 53.207,18 | **51,1%** |
| 180d | 155 | 265 | 56.262,16 | 68.057,85 | 54,7% |

Duas leituras que decidem a questão:

1. **A primeira compra satura.** 45d → 60d ganha R$ 1.333. 60d → 90d ganha **R$ 60,00**.
2. **A recompra explode.** 45d → 90d, a recompra sobe R$ 15.464 (+41%), e **aos 90 dias mais
   da metade da "receita da campanha" é recompra.**

Ou seja: estender a janela além de 45–60 dias **não captura mais aquisição — captura
recompra**. É exatamente o crédito infinito que você proibiu.

## 4. POR PRODUTO — o ciclo difere, a saturação não

| produto | n | mediana | ≤30 | **≤45** | ≤60 | ≤90 |
|---|---|---|---|---|---|---|
| impressao_dtf_textil | 102 | 5,1 | 68 | **71** | 71 | 71 |
| diversos | 21 | 5,9 | 19 | **21** | 21 | 21 |
| impressao_dtf_uv | 13 | **2,6** | 11 | **11** | 11 | 11 |
| evangelicos | 12 | 8,5 | 8 | 9 | 10 | **11** |
| camisetas_personalizadas | 11 | **21,2** | 7 | **8** | 8 | 8 |
| petshop | 5 | 11,5 | 4 | **4** | 4 | 4 |
| impressao_dtf_uv_textil | 5 | 26,4 | 3 | **4** | 4 | 4 |

**Em 6 de 8 grupos, ≤45d == ≤60d == ≤90d**: depois de 45 dias literalmente nada mais entra.
A única exceção é `evangelicos` (9 → 10 → 11), com n=12.

O ciclo **é** diferente por produto — DTF UV tem mediana 2,6 dias, camisetas 21,2 — mas o
**ponto de saturação é comum**. Por isso **não recomendo janela segmentada**: a diferença
está na mediana, não no corte.

## 5. POR CAMPANHA — e a CP145 desmontada

Receita de **primeira compra** por campanha:

| campanha | r1_30 | **r1_45** | r1_60 | r1_90 | recompra_90 |
|---|---|---|---|---|---|
| CP136 dtfuv | 2.876,30 | **2.948,13** | 2.948,13 | 2.948,13 | **7.010,33** |
| CP134 dtftêxtil | 2.031,79 | **2.186,20** | 2.186,20 | 2.186,20 | 4.718,63 |
| CP01 camisetas | 2.154,59 | **2.154,59** | 2.154,59 | 2.154,59 | 2.354,00 |
| CP151 CTWA UV | 1.701,97 | **1.701,97** | 1.701,97 | 1.701,97 | 312,18 |
| CP130 mofu wpp | 1.462,81 | **1.462,81** | 1.462,81 | 1.462,81 | 3.380,54 |

**Em praticamente toda campanha, `r1_45 == r1_60 == r1_90`.** E o "CP136 fica positiva aos
90 dias" que reportei na R21 era **recompra de R$ 7.010**, não aquisição nova.

### CP145 não é campanha de ciclo longo

Ela tem **uma única compra**: R$ 1.386,86, `ord=1`, aos **44,9 dias**.

Não é padrão de ciclo longo — é **n=1 caindo a 2,4 horas do corte de 45 dias**. Uma janela
de 45d a captura; uma de 30d a perde. Eu tratei essa campanha como evidência de ciclo longo
na R21; com o recorte de primeira compra, ela vira o oposto: um argumento a favor de 45 e
contra 30, e nada mais.

## 6. JANELA × MATURAÇÃO — não são a mesma coisa

- **Janela de atribuição = 45 dias.** Tempo após T0 em que uma primeira compra recebe crédito.
- **Maturação mínima = 45 dias.** Uma coorte só pode ser julgada quando *todos* os seus leads
  já tiveram a janela inteira para converter.

Aqui eles **coincidem**, e por um motivo simples: julgar antes de a janela fechar é julgar
com receita truncada. A view atual usa maturação de 30d com janela de 30d — coerente, mas
corta os 8 leads da faixa 31–45d (4,4% das vendas, **9,1% da receita**).

## 7. SENSIBILIDADE 30/45/60/90 — classificação

| classe | campanhas |
|---|---|
| **SINAL_ESTAVEL** (r1 idêntico em 45/60/90) | CP136, CP134, CP01, CP151, CP130, CP155, CP152 — **a maioria** |
| **SENSIVEL_A_JANELA** | só entre 30d e 45d: CP136 (+71,83), CP134 (+154,41), CP145 (0 → 1.386,86) |
| **DADOS_INSUFICIENTES** | campanhas com < 3 primeiras compras |

**Nenhuma campanha muda de sinal entre 45, 60 e 90 dias em primeira compra.** A instabilidade
que reportei na R21 vinha inteiramente de (a) não separar recompra e (b) usar 30d em vez de 45d.

## 8. COBERTURA — a ressalva severa

| | compras | receita |
|---|---|---|
| Purchase com `value > 0` | 1.561 | **R$ 639.899,28** |
| com `lead_id` | 1.561 (100%) | 639.899,28 |
| lead com `utm_campaign_id` preenchido | **459 (29,4%)** | **R$ 97.795,89 (15,3%)** |
| `campaign_id` reconhecido em `meta_ads_insights` | **363 (23,3%)** | **R$ 77.084,51 (12,0%)** |
| lead sem campanha (orgânico/indicação/base antiga) | 1.102 (70,6%) | R$ 542.103,39 (**84,7%**) |

**Só 12% da receita é atribuível a uma campanha Meta reconhecível.** Isso não invalida a
janela — o padrão temporal medido nos 182 casos é consistente e replicável — mas define o
que ela pode decidir: **contribuição de mídia ≠ resultado da empresa.** Qualquer decisão de
escala olha para 12% do negócio.

E **aumentar a janela não melhora a cobertura**: o gargalo é `utm_campaign_id` ausente na
aquisição, não tempo.

## 9. AUTO-REFUTAÇÃO

| Pergunta | Resposta medida |
|---|---|
| Compras tardias são efeito da campanha? | **Provavelmente não.** 22% das primeiras vendas ocorrem após 90 dias, com P90 em 207 dias. Creditar isso à campanha de aquisição é indefensável |
| Recompra infla 60/90d? | **Sim, e é o efeito dominante.** Aos 90d, 51,1% da receita atribuída é recompra |
| Lead pode ter sido tocado por outra campanha depois? | **Sim, e não consigo excluir.** O modelo é first-touch por `utm_campaign_id` do lead; não há registro de toques posteriores |
| First-touch vs last-touch confundidos? | O modelo é first-touch por construção. `leads_first_touch_audit` existe para proteger isso, mas está vazia |
| CTWA novo sobrescreve origem antiga? | **Não medi diretamente.** A guarda existe e nunca registrou bloqueio — o que é ambíguo, não tranquilizador |
| Campanha sazonal distorce? | CP143 "Copa 2026" tem 1 venda de R$ 69,90. Não distorce a distribuição global, mas mostra que campanha sazonal morta não é diagnosticável por janela |
| Ticket alto de poucos clientes muda tudo? | **Sim.** CP145 inteira é 1 venda de R$ 1.386,86. Por isso a regra exige n mínimo, não só valor |
| Purchase é deal ganho, não caixa? | **Sim.** U1 do MAPA. Não é lucro, não é margem, não é caixa |
| Ciclo longo é efeito do atendimento, não da mídia? | **Não separável hoje.** O lead conversa com Júlia/Bruno/João entre T0 e a venda. A mídia traz; o atendimento converte. A atribuição não distingue |

## 10. REGRA CANÔNICA PROPOSTA

| | |
|---|---|
| **A. Janela de atribuição** | **45 dias corridos a partir de T0** |
| **B. Maturação mínima** | **45 dias** — coorte só é julgada com a janela fechada para todos os leads |
| **C. Recompra** | **Excluída.** Só `ord = 1` (primeira compra do lead após T0) entra na contribuição de mídia |
| **D. Múltiplas campanhas** | **First-touch**, via `utm_campaign_id` do lead, imutável. Toque posterior não redistribui crédito |
| **E. Confiança** | Manter o IC95 de Poisson já usado (`ref_poisson_ic95`); exigir cobertura de maturação ≥ 50% e n ≥ 3 primeiras compras |
| **T0** | `least(leads_marketing.created_at, min(pixel_events não-Purchase))` |

Por que 45 e não 30: a faixa 31–45d tem **8 vendas e 9,1% da receita** — descartá-la é
perder quase um décimo do sinal, e é o que a view faz hoje.

Por que 45 e não 60/90: a faixa 46–90d tem **2 vendas e 2,2% da receita**, e além de 45 o
ganho passa a ser majoritariamente recompra.

**Não escolhi a janela que deixa mais campanhas positivas.** Escolhi a que satura a curva de
primeira compra. Aliás, 45d deixa *menos* campanha positiva que 90d — porque 90d é inflado
por recompra.

## 11. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e não é a janela: **descobrir por que 70,6% das compras têm lead sem
`utm_campaign_id`.**

Com 12% de cobertura de receita, decidir escala por contribuição de mídia é decidir sobre
um oitavo da empresa. A janela já está resolvida; a cobertura, não. E aumentar a janela não
resolve — o gargalo é a captura da origem no momento da aquisição.

## Estado preservado

Nenhuma escrita. Shadow intocado (306 avaliações, 0 `escala_disponivel`).
EXP-001 WhatsApp congelado: snapshot 456, `rascunho`, fila 0.
