# R26 — Contrato canônico do MAPA econômico da Skillprint

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero deploy, zero DDL,
zero função, zero tabela, zero mudança no shadow, zero Meta, zero campanha.

**Premissas aceitas desta rodada:** CalcMe não é fonte canônica nem dependência estratégica —
aparece aqui apenas como evidência histórica já medida (R24/R25), nunca como requisito. O ERP
próprio será a fonte canônica da economia operacional. As habilidades do Gustavo ficam para
depois.

---

## VEREDITOS

| | |
|---|---|
| **A. MAPA econômico atual** | **PARCIAL** |
| **B. Aquisição** | **PARCIAL** |
| **C. Recorrência** | **MENSURAVEL** |
| **D. Economia/margem** | **BLOQUEADA_ATE_ERP** |
| **E. Motor pausa/escala** | **PODE_SER_DEFINIDO** — para escalar. **INSEGURO** para pausar |
| **F. Contrato futuro do ERP** | **CLARO** |

Duas surpresas contra o que eu mesmo escrevi antes: **a recorrência é mensurável hoje, sem
CalcMe e sem ERP** (§7), e **existe um caminho parcial de custo já hoje** (§9) que eu havia
declarado inexistente na R23 e na R25. Ambas mudam o desenho.

---

## 1. VERDADE DISPONÍVEL HOJE

O Cérebro consegue observar, com dado real e verificado nesta rodada:

1. **Quanto gastou** — por dia, por campanha, por conjunto, **por anúncio**.
2. **Quem chegou** — lead com telefone em 100% e campanha em 83,5%.
3. **Quem comprou** — por dois caminhos que **não concordam entre si** (§3.1).
4. **Quando comprou a primeira vez** — janela de aquisição de 45d validada (R24, §6).
5. **Se voltou a comprar** — e isso é novo: **77,9% dos compradores maduros recompram** (§7).
6. **O que foi vendido** — produto, quantidade e preço unitário em 79% dos deals ganhos.
7. **Custo variável de insumo** — para 61% dos deals ganhos, com ressalva grave (§9).

## 2. VERDADE FALTANTE

1. **Imposto** — nenhum objeto no banco inteiro.
2. **Taxa de pagamento/adquirência** — nenhum objeto.
3. **Frete realizado** — só em `orcamentos` (101 linhas), nunca no pedido.
4. **Custo de produção e mão de obra** — inexistente (bloqueio herdado da R20).
5. **Histórico de custo** — uma única vigência, 2026-07-19.
6. **Desconto explícito** — não existe campo; só o preço final.
7. **Caixa** — nenhum objeto de fluxo em lugar nenhum (herdado da R23).
8. **Capacidade de produção** — não observável.
9. **Causalidade** — nenhum experimento contrafactual jamais rodado.

## 3. MATRIZ DE FONTES

| fonte | fato observado | granularidade | período | cobertura | atualização | representa | **classe** |
|---|---|---|---|---|---|---|---|
| `meta_ads_insights` | gasto e entrega | **dia × anúncio** (4.169 linhas, 104 camp / 159 adset / **361 ads**) | 2024-10-01 → 2026-08-24 | R$ 65.423,50 | diária (2026-08-25) | **execução de mídia** | **CANONICO_HOJE** |
| `leads_marketing` | aquisição declarada | lead (15.997) | 2024-07-19 → hoje | `ph` 100%, `utm_campaign_id` 83,5%, `content_category` 93,6% | contínua | **aquisição** | **PARCIAL** — 39% do `created_at` é carimbo de importação (R24) |
| `pixel_events` `Purchase` | compra observada | evento (1.607; 1.561 com valor) | **Purchase só desde 2026-01-26** | `lead_id` 70,4% | contínua | **receita, proxy de pedido** | **PARCIAL** — censura à esquerda |
| `propostas_rd` `won` | negócio fechado | deal (993) | 2026-01-25 → 2026-08-24 | `total_price` 100%, produto 78,9%, qtd 78,7%, preço unit. 77,9%, `lead_id` 90,2%, `utm_campaign` **21,8%** | contínua | **receita + item** | **PARCIAL** — melhor detalhe econômico que existe |
| `fact_conversations` | conversa | mensagem (270.551) | **2026-03-30** → hoje | `lead_id` 96,6% | contínua | **intenção/atendimento** | **PROXY** |
| `catalogo_produtos` | custo de insumo | SKU (104) | vigência única **2026-07-19** | `custo_unitario` 63,5% | manual, 1 vez | **custo parcial** | **PARCIAL** |
| `criterios_midia` | limiares de decisão | segmento (43) | 2026-05 → | — | cron mensal | **regra, não fato** | **NAO_CONFIAVEL** (R24) |
| `gustavo_meta_acoes` | intervenção de mídia | — | — | **0 linhas** | — | log de ação | **FUTURO** |
| pedido, item, custo, frete, imposto, produção | — | — | — | — | — | — | **FUTURO_ERP** |
| CalcMe | histórico de compra | pedido (3.730) | 2024-01 → 2026-02 | ligação ao lead: **3,4%** (R25) | congelado | evidência histórica | **fora do contrato** |

### 3.1 Achado crítico: duas receitas concorrentes, e elas discordam

| | leads | receita |
|---|---|---|
| `pixel_events` Purchase (`value > 0`) | 491 | **R$ 641.935,68** |
| `propostas_rd` `deal_status='won'` | 335 | **R$ 332.339,38** |
| nos **dois** | **329** | — |
| só pixel | 162 | — |
| só RD | 6 | — |

**Nos mesmos 329 leads: pixel diz R$ 496.609,53, RD diz R$ 323.631,72 — o pixel é 53% maior.
Apenas 158 de 329 (48%) concordam dentro de 1%.**

Isto é uma **terceira verdade econômica concorrente**, no mesmo padrão que a R23 encontrou no
ciclo. O contrato precisa nomear uma canônica, e nunca somá-las.

**Proposta:** `propostas_rd.won` é a **receita canônica** (é negócio fechado, tem item, produto,
quantidade e preço, e `lead_id` em 90%). `pixel_events.Purchase` é o **sinal canônico de tempo
e atribuição** (cobre 162 leads que o RD não tem, e é o que se liga ao caminho de aquisição).
Uma é *quanto*, a outra é *quando e de onde*. **Nenhuma das duas é as duas coisas.**

## 4. AS QUATRO VERDADES — o que dá para observar

| | verdade | pergunta | hoje |
|---|---|---|---|
| **A** | **Aquisição** | quem foi adquirido por qual esforço? | **PARCIAL** — 83,5% dos leads têm campanha, mas só 21,8% dos deals ganhos; e a campanha é gravável em quem já era cliente (R25) |
| **B** | **Valor do cliente** | continuou comprando? | **OBSERVÁVEL** — 77,9% de recompra na coorte madura (§7) |
| **C** | **Economia** | quanto dinheiro/margem deixou? | **BLOQUEADA** — 61% dos deals têm custo de insumo, mas falta imposto, taxa, frete e produção (§9) |
| **D** | **Causalidade** | aconteceu POR CAUSA da mídia? | **NÃO OBSERVÁVEL** — zero contrafactuais (§12) |

**Duas de quatro.** E as duas que faltam são exatamente as que separam "gastar melhor no Meta"
de "ganhar mais dinheiro".

## 5. AQUISIÇÃO — reancoragem, não reconstrução

O estado LIVE continua consistente com a R24. Reafirmado sem recalcular tudo:

- **primeira compra** define aquisição; recompra fica **fora** do CAC;
- **janela de 45 dias** — 92–97% das primeiras compras na coorte limpa;
- **maturação de 45 dias** antes de julgar campanha;
- `vw_midia_coorte_aquisicao_shadow` já usa `DISTINCT ON (lead_id)`, então **já exclui recompra**;
  o único ajuste pendente continua sendo 30 → 45.

### KPIs de aquisição: o que é realmente calculável hoje

| KPI | hoje? | ressalva |
|---|---|---|
| spend | **SIM** | por dia e por anúncio |
| leads | **SIM** | 83,5% com campanha |
| novos compradores | **SIM** | com a receita canônica escolhida no §3.1 |
| **CAC de novo cliente** | **PARCIAL** | só 21,8% dos deals ganhos têm campanha; o denominador é frágil |
| conversão lead → 1ª compra | **SIM** | ~1,4% na população com campanha |
| receita inicial / ticket inicial | **SIM** | depende de qual receita (§3.1) |
| **cobertura de atribuição** | **SIM** | e é o número mais importante da lista |
| confiança estatística | **SIM** | `ref_poisson_ic95` já existe e é usado |

## 6. KPIs PRIMÁRIOS — validados e refutados

| # | KPI | função econômica | quando usar | risco | hoje? | ERP? | causal? |
|---|---|---|---|---|---|---|---|
| 1 | **CAC de novo cliente** | preço de comprar um cliente | após maturação de 45d | denominador só com atribuição resolvida | **PARCIAL** | não | não |
| 2 | **Contribuição da aquisição** | sobra da 1ª compra | com custo completo | 82,7% de margem aparente é ilusão (§9) | **NÃO** | **SIM** | não |
| 3 | **LTV de margem** | valor total do cliente | com custo + coorte madura | vira ficção sem custo | **NÃO** | **SIM** | não |
| 4 | **LTV/CAC** | eficiência do capital | com 1 e 3 | herda os dois erros | **NÃO** | **SIM** | não |
| 5 | **Payback** | tempo até recuperar o CAC | com 1 e 3 | sem caixa, é payback contábil, não financeiro | **NÃO** | **SIM** | não |
| 6 | **Taxa de recompra por coorte** | qualidade do cliente | maturação ≥180d | julgar cedo subestima brutalmente (§7) | **SIM** | não | não |
| 7 | **Contribuição acumulada** | valor gerado até hoje | com custo | não é lucro | **NÃO** | **SIM** | não |
| 8 | **Retorno marginal** | vale o próximo R$1? | com histórico de mudança de verba | confundido com pacing do Meta | **NÃO** | não | **parcial** |
| 9 | **Incrementalidade** | a mídia causou? | com contrafactual | atribuição travestida de causa | **NÃO** | não | **SIM** |
| 10 | **Cobertura/confiança** | posso decidir? | sempre, **primeiro** | ser tratado como acessório | **SIM** | não | não |

### Refutações

- **KPI 4 (LTV/CAC) é redundante como KPI primário.** É um quociente de 1 e 3; não traz
  informação nova e esconde qual dos dois se moveu. **Rebaixar a derivado.**
- **KPI 7 (contribuição acumulada) é o mesmo objeto que o KPI 3** visto em outro corte de tempo.
  Manter os dois como primários cria duas verdades sobre a mesma coisa — o erro que já custou
  duas rodadas. **Fundir em 3, com o tempo como parâmetro.**
- **KPI 10 não é um KPI — é um portão.** Não compete com os outros; ele decide se os outros
  podem ser lidos. Promover a **pré-condição do motor**, não a item de lista.

**Lista primária final: sete.** CAC (1), contribuição de aquisição (2), LTV de margem com
horizonte parametrizado (3+7), payback (5), recompra por coorte (6), retorno marginal (8),
incrementalidade (9). Cobertura (10) vira portão. LTV/CAC (4) vira derivado.

## 7. RECORRÊNCIA — o achado que muda o desenho

Medido **hoje, só com `pixel_events`, sem CalcMe e sem ERP**:

| maturidade da coorte | compradores | recompraram | **%** | ≤30d | ≤90d | P50 até a 2ª |
|---|---|---|---|---|---|---|
| < 90 dias | 227 | 69 | 30,4% | 26,0% | 30,4% | 9,1 d |
| 90–180 dias | 178 | 80 | 44,9% | 30,9% | 41,0% | 14,6 d |
| **≥ 180 dias** | **86** | **67** | **77,9%** | **61,6%** | 73,3% | **12,5 d** |

**Julgar recompra antes de 180 dias subestima o fenômeno em mais da metade.** E a mediana de
12,5 dias bate com os 12 dias medidos independentemente no CalcMe (R25) — duas fontes que não se
tocam, mesmo número.

### Receita acumulada por coorte — `valor_receita_coorte_observado`

| coorte | clientes | 30d | 90d | 180d | por cliente 30d | por cliente 180d | **multiplicador** |
|---|---|---|---|---|---|---|---|
| 90–180d | 178 | 187.761 | 235.537 | 266.067 | R$ 1.054,83 | R$ 1.494,76 | **1,42×** |
| ≥180d | 86 | 59.638 | 120.327 | 189.950 | R$ 693,46 | R$ 2.208,72 | **3,19×** |

**Auto-refutação obrigatória sobre o próprio número:** a coorte ≥180d tem **42,7% de leads
anteriores ao início do pixel**, contra 9,8% nas demais — são contas já estabelecidas, e o 3,19×
está inflado pela mesma censura à esquerda da R24. O 1,42× está truncado em 180 dias.

**Declaração honesta: o multiplicador 30d → 180d está entre 1,4× e 3,2×, e não é separável
hoje.** Mesmo o piso de 1,4× já é decisivo: **julgar campanha por receita de 30 dias vê, no
melhor caso, 70% do valor — e possivelmente 31%.**

Classificação do contrato de recorrência:

| item | classe |
|---|---|
| taxa de recompra 30/60/90/180/365d | **CALCULAVEL_HOJE** (365d ainda sem coorte madura) |
| tempo até a 2ª compra | **CALCULAVEL_HOJE** |
| frequência / pedidos por cliente | **CALCULAVEL_HOJE** |
| receita acumulada por coorte | **PARCIAL_HOJE** — viés declarado acima |
| retenção / curva de coorte | **PARCIAL_HOJE** — 7 meses de histórico |
| horizonte de relacionamento | **PARCIAL_HOJE** — truncado |
| **LTV de receita** | **PARCIAL_HOJE** — é receita, não valor |
| **LTV de margem** | **DEPENDE_ERP** |

## 8. LTV — o que pode e o que não pode ser chamado assim

Três objetos distintos, três nomes distintos, **nunca intercambiáveis**:

| nome | definição | hoje |
|---|---|---|
| `valor_receita_coorte_observado` | receita acumulada da coorte até T dias | **PARCIAL** |
| `ltv_receita` | receita acumulada projetada ao horizonte | **não projetar** — 7 meses de base |
| `ltv_margem` | contribuição acumulada ao horizonte | **DEPENDE_ERP** |

**Só `ltv_margem` pode entrar em decisão de escala.** Os outros dois informam; não decidem.

## 9. MARGEM — existe um caminho parcial, e ele prova a própria insuficiência

Correção do que escrevi na R23 e na R25: **há sim um caminho de custo hoje**, via
`propostas_rd.produto_principal` + `quantidade` + `unidade` cruzado com os custos declarados em
`catalogo_produtos` (DTF Têxtil R$ 8,00/m; DTF UV R$ 40,00/m; DTF UV folha A4 R$ 9,30, A3
R$ 18,18).

| situação | deals | receita | custo estimado | contribuição parcial |
|---|---|---|---|---|
| **custo aplicável** | **607 (61%)** | R$ 149.690,47 | R$ 25.933,38 | R$ 123.757,09 |
| unidade sem custo declarado | 170 | **R$ 151.601,52** | — | — |
| sem família mapeável | 214 | R$ 65.640,98 | — | — |
| falta qtd/unidade | 2 | R$ 5.395,65 | — | — |

**Duas leituras, e as duas condenam o caminho:**

1. **A margem bruta implícita é 82,7%.** Uma gráfica DTF não tem 82,7% de margem. O número não
   está errado — está **incompleto**: falta mão de obra, máquina, energia, imposto, taxa e
   frete. **É a prova aritmética de que o custo é parcial.**
2. **Os 170 deals sem custo carregam R$ 151.601 — mais receita que os 607 que têm custo.**
   Ticket médio: R$ 891,78 sem custo contra R$ 246,61 com custo. **O caminho cobre a cauda
   barata e perde os deals grandes.**

Some-se: vigência única de 2026-07-19 aplicada a deals desde janeiro, e nenhum campo de desconto.

**Veredito: `BLOQUEADA_ATE_ERP`.** O caminho parcial serve para **testar o formato do contrato**,
nunca para decidir. E **nunca** chamar `receita − mídia` de lucro.

### Fórmula canônica (a ser preenchida pelo ERP)

```
contribuicao_variavel =
    receita_liquida                       -- preço final, líquido de desconto
  - custo_variavel_produto                -- insumo × quantidade, custo VIGENTE na data
  - custo_frete_subsidiado                -- o que a empresa absorveu
  - taxa_pagamento                        -- adquirência/gateway
  - imposto_variavel                      -- o que incide sobre a venda
  - outros_custos_variaveis_diretos
```

`contribuicao_liquida_de_midia = contribuicao_variavel − spend_atribuido`. **Isto não é lucro:**
não deduz custo fixo, folha, estrutura nem depreciação.

## 10. PAYBACK

**Não calculável hoje**, e a razão não é só o custo: **não existe nenhum objeto de caixa no
banco**. Payback sem caixa é payback contábil — diz quando o resultado empata no papel, não
quando o dinheiro volta. Para uma empresa que precisa financiar o próximo lote de insumo, a
diferença é a que importa.

**Depende de: ERP (custo) + objeto de caixa (inexistente hoje).**

## 11. RETORNO MARGINAL

**Definição:** a variação de contribuição por unidade de variação de gasto, na mesma campanha e
no mesmo período — `Δcontribuição / Δspend`. Não é `contribuição/spend`; é a **derivada**, não a
média. Uma campanha com ROAS 3,0 pode ter retorno marginal negativo se já saturou o público.

Matéria-prima observável hoje:

| item | estado |
|---|---|
| gasto diário por campanha e por anúncio | **OBSERVAVEL_HOJE** |
| variações de gasto ≥30% dia a dia | **OBSERVAVEL_HOJE** — **227 ocorrências**, 16 campanhas com ≥5 |
| campanhas com ≥30 dias de gasto | 16 |
| **orçamento diário definido (`daily_budget`)** | **NAO_OBSERVAVEL_HOJE** — campo inexistente |
| **log de intervenção deliberada** | **NAO_OBSERVAVEL_HOJE** — `gustavo_meta_acoes` = **0 linhas** |
| novos clientes incrementais | **REQUER_HISTORICO_FUTURO** — precisa de maturação de 45d após cada salto |
| deterioração por saturação | **REQUER_HISTORICO_FUTURO** |

**Classificação: `REQUER_HISTORICO_FUTURO`.** Os 227 saltos existem, mas são **confundidos**:
sem log de intervenção e sem campo de orçamento, não há como distinguir "Alessandro dobrou a
verba" de "o Meta redistribuiu sozinho". Um experimento natural onde não se sabe quem fez o
tratamento não é experimento.

**Destravar isso não depende do ERP** — depende de gravar a intervenção. É o item mais barato
de toda esta lista.

## 12. INCREMENTALIDADE

**Atribuição** = a campanha apareceu no caminho. **Incrementalidade** = o resultado não teria
acontecido sem ela. A R25 mostrou o abismo entre as duas com dado: 15 clientes com
`utm_campaign_id` gravado cuja primeira compra antecede o lead em ~239 dias.

Mecanismos futuros possíveis, do mais barato ao mais caro:

| mecanismo | custo | o que responde | viável quando |
|---|---|---|---|
| **holdout de audiência** | baixo | a mídia causou nesta audiência? | quando houver público estável |
| **A/B de criativo/oferta** | baixo | qual variante causa mais? | já viável tecnicamente |
| **experimento de orçamento** | médio | qual o retorno do próximo real? | após gravar intervenção (§11) |
| **geo holdout** | médio | a mídia causou na região? | precisa de volume regional |
| **blackout temporal** | baixo | o que acontece sem a campanha? | qualquer momento — e é o mais informativo por real gasto |

**Nada disso é para agora.** Registrado como o único caminho conhecido para a verdade D.

## 13. MOTOR DE DECISÃO

Árvore econômica, em ordem obrigatória. **Cada portão só é avaliado se o anterior passou.**

```
G0  DADO CONFIAVEL?
    cobertura de atribuicao >= piso | receita canonica definida | sem conflito de fonte
    NAO -> ABSTER

G1  COORTE MADURA?
    todos os leads da coorte tiveram >= 45 dias de janela
    NAO -> AGUARDAR_MATURACAO

G2  AQUISICAO VIAVEL?
    CAC de novo cliente | contribuicao da 1a compra | n >= minimo com IC95
    NAO CONCLUSIVO -> TESTAR        EVIDENCIA NEGATIVA MADURA -> REDUZIR/PAUSAR

G3  QUALIDADE DO CLIENTE?
    recompra por coorte | frequencia | ltv_margem
    BOA -> sobrevive a G2 fraco      RUIM -> nao escala mesmo com G2 forte

G4  ESCALA MARGINAL?
    o proximo R$1 tende a gerar valor?
    SIM -> ESCALAR    DESCONHECIDO -> MANTER    NAO -> MANTER ou REDUZIR

G5  CAUSALIDADE?
    ha contrafactual?
    NAO -> teto de escala; escalar so em incremento com medicao
```

**Estados validados:** `ESCALAR`, `MANTER`, `AGUARDAR_MATURACAO`, `TESTAR`, `REDUZIR`, `PAUSAR`,
`ABSTER` — os sete se sustentam e são mutuamente exclusivos.

**Refutação de um deles:** `ABSTER` e `AGUARDAR_MATURACAO` parecem redundantes e **não são**.
`ABSTER` = *não sei se o dado presta* (problema de qualidade, pode nunca resolver).
`AGUARDAR_MATURACAO` = *o dado presta e o relógio ainda não fechou* (resolve sozinho, com data
prevista). Fundir os dois faria o motor tratar um defeito permanente como espera temporária.
**Manter os dois, com a distinção escrita no contrato.**

**Estado do motor hoje:** G0 e G1 são executáveis. G2 é parcial. G3 é executável (§7). **G4 e G5
não são executáveis** — e é por isso que `ESCALAR` não pode ser emitido automaticamente hoje.

## 14. REGRA ASSIMÉTRICA DE PAUSA E ESCALA

**Ausência de evidência positiva ≠ evidência negativa.** Formalizado:

| condição | significa | **NÃO** autoriza |
|---|---|---|
| amostra pequena (n < mínimo) | não sei | **PAUSAR** |
| atribuição fraca (cobertura baixa) | não sei de onde veio | **PAUSAR** |
| coorte jovem (< 45d) | ainda não terminou | **PAUSAR** |
| custo incompleto (pré-ERP) | não sei a margem | **PAUSAR** |
| conflito entre fontes de receita | não sei quanto | **PAUSAR nem ESCALAR** |

### Evidência exigida para PAUSAR
1. coorte **madura** (45d fechados para todos os leads);
2. **gasto suficiente** para que a ausência de conversão seja informativa — calculado a partir
   do CAC-alvo, **não** um valor fixo em reais;
3. **limite superior do IC95** do CAC acima do teto econômico — *o pessimista já é ruim demais*;
4. cobertura de atribuição acima do piso;
5. **nenhum sinal de recompra** na coorte (§7 — 77,9% recompram: pausar antes de olhar recompra
   é o erro mais caro possível).

### Evidência exigida para ESCALAR
1. tudo de PAUSAR, mais:
2. **limite inferior do IC95** do CAC abaixo do teto — *o otimista não basta*;
3. `ltv_margem` positivo (**DEPENDE_ERP**);
4. retorno marginal não deteriorando (**REQUER_HISTORICO_FUTURO**);
5. escala em **incremento medido**, nunca em salto.

**Consequência imediata e honesta:** com as regras acima, hoje o motor pode legitimamente emitir
`ABSTER`, `AGUARDAR_MATURACAO`, `TESTAR` e `MANTER`. **Não pode emitir `ESCALAR` (falta 3 e 4)
nem `PAUSAR` com segurança (falta o teto econômico do critério 3, que depende de margem).** Isso
não é um defeito do desenho — é o desenho recusando decidir sem base. Note que é exatamente o
estado em que `midia_shadow.fn_observador_impl` já se encontra, com `escala_disponivel=false` e
`pausa_disponivel=false`. **O shadow já estava certo.**

### A regra de `criterios_midia` é o contra-exemplo

Ela pausa por **gasto acumulado** (pizzaria R$100 com n=0) e escala por **contagem de leads**.
Nenhum dos dois é evidência econômica, e nenhum tem portão de maturação. É inerte hoje (R24) —
e deve continuar inerte até ser substituída por esta regra.

## 15. CAMPANHA BOA COM ROAS RUIM — o teste do motor

**Caso A** — ROAS inicial baixo, CAC aceitável, alta recorrência, LTV alto, payback aceitável.

O motor **preserva A**: G2 pode ser fraco (ROAS de 30 dias baixo) e o caso **sobrevive em G3**,
que olha recompra e `ltv_margem`. E a regra de pausa exige explicitamente "nenhum sinal de
recompra" — A tem recompra, logo **não pode ser pausada**. Com o multiplicador de 1,4×–3,2×
medido no §7, **este não é um caso hipotético: é o caso típico da Skillprint.**

**Caso B** — ROAS inicial alto, compra única, margem baixa, sem recorrência.

O motor **não escala B**: passa em G2, mas **falha em G3** (sem recompra) e em G4 (`ltv_margem`
baixo). Resultado: `MANTER`, nunca `ESCALAR`.

**O motor passa nos dois testes — mas só porque G3 existe.** Um motor que fosse de G2 direto a
G4 mataria A e escalaria B. Essa é a diferença entre otimizar o Meta e otimizar o dinheiro da
empresa, e ela cabe em um único portão.

## 16. CONTRATO MÍNIMO DO ERP

Contrato **semântico**, não desenho de banco. O que o ERP precisa expor ao MAPA:

### PEDIDO
`pedido_id` · `cliente_id` · `data_pedido` · `status` · `valor_bruto` · `desconto_total` ·
`valor_liquido` · `frete_cobrado` · `frete_custo_real` · `canal_venda`

### ITEM
`pedido_id` · `sku` · `familia` · `quantidade` · `unidade` · `preco_unitario` · `desconto_item` ·
**`custo_unitario_vigente_na_data`** · `custo_fonte`

> O item mais importante do contrato inteiro é `custo_unitario_vigente_na_data`. Custo **sem
> vigência** é o defeito que hoje inviabiliza `catalogo_produtos` (§9). Um custo é um fato
> datado, não uma constante.

### CUSTOS DA VENDA
`taxa_pagamento` · `imposto_variavel` · `frete_subsidiado` · `outros_variaveis_diretos`

### CLIENTE
**`cliente_id` canônico e estável** · `telefone` · `email` · `documento` · `primeira_compra_em` ·
`origem_declarada`

> A R25 provou que identidade sem chave canônica estável custa 96,6% da receita. **`cliente_id`
> canônico é requisito, não conveniência.**

### PRODUÇÃO (segunda fase)
`pedido_id` · `iniciado_em` · `concluido_em` · `custo_producao` · `refugo`

### O que cada KPI exige

| KPI | precisa do ERP |
|---|---|
| CAC | cliente canônico + primeira compra |
| margem de contribuição | item + custo vigente + custos da venda |
| LTV de margem | tudo acima + histórico de pedidos por cliente |
| LTV/CAC · payback | tudo acima (+ caixa, para payback financeiro) |
| recorrência | cliente canônico + data do pedido |
| rentabilidade por produto | item + custo vigente |
| rentabilidade por campanha | tudo acima + ligação cliente ↔ lead |

**Regra de fronteira, para o ERP não virar a próxima verdade concorrente (§18):** o ERP é
canônico para **pedido, item, produto, custo, frete e produção**. Ele **não** é canônico para
aquisição, campanha, lead nem conversa — isso continua em `leads_marketing` e `meta_ads_insights`.
A ponte entre os dois mundos é **uma só**: `cliente_id ↔ lead_id`, resolvida **uma vez**, no
momento da primeira compra, e **imutável** depois. Duas pontes seriam duas verdades.

## 17. O QUE FICA BLOQUEADO ATÉ O ERP — não construir agora

| não construir | por quê |
|---|---|
| objeto de LTV de margem | não há custo completo |
| objeto de payback | não há custo nem caixa |
| objeto de LTV/CAC | derivado de dois inexistentes |
| regra automática de PAUSA | falta o teto econômico (§14) |
| regra automática de ESCALA | falta `ltv_margem` e retorno marginal |
| motor de retorno marginal | sinal confundido (§11) |
| qualquer coisa de incrementalidade | nenhum contrafactual existe |
| nova costura de identidade | decisão tomada — o ERP resolve |
| tabela de custo paralela ao ERP | seria a próxima verdade concorrente |
| projeção de LTV | 7 meses de base não projetam 12 meses |

**Princípio:** não criar objeto vazio porque o schema parece bonito. `calcme_itens_pedido` tem o
schema de custo perfeito e **zero linhas** desde sempre — é o monumento a esse erro dentro do
próprio banco.

## 18. MAPA → GPS → AGENTE

Fluxo validado: **MAPA** publica verdade econômica → **GPS** escolhe o maior gap →
**agente especialista** executa → **Worker** investiga causa desconhecida → resultado volta ao MAPA.

### Há função econômica morando em agente que deveria estar no MAPA?

**Sim, em quatro objetos distintos.** Nenhum deles é o MAPA:

| objeto | linhas | verdade econômica que guarda | dono hoje |
|---|---|---|---|
| `criterios_midia` | 43 | limiares de pausa e escala, `dias_ciclo` | cron "Diego" |
| `catalogo_produtos` | 104 | `margem_alvo_pct`, `custo_unitario`, `veredito`, `quadrante_bcg` | catálogo/agentes |
| `lab_experimentos` | 7 | `custo_maximo_conversao`, `margem_minima_pct` | laboratório |
| `offer_playbooks` | 6 | `margem_minima_pct` | playbook de oferta |

**Quatro objetos definem margem mínima ou teto de custo, e nenhum conversa com os outros.** Este
é o mesmo padrão que produziu o `dias_ciclo=134` da R23/R24: verdade econômica escrita onde a
ação acontece, em vez de onde a verdade mora.

**Regra do contrato:** teto de CAC, margem mínima, horizonte de LTV e limiar de escala são
**propriedades do MAPA**. Agente **lê**; agente **não define**. O catálogo pode guardar o custo
do insumo (é um fato do produto); **não** pode guardar a margem-alvo (é uma política econômica).

## 19. AUTO-REFUTAÇÃO

| tentativa de destruir o desenho | resposta |
|---|---|
| **CAC sem atribuição suficiente?** | **Sim, é o furo maior.** 21,8% dos deals ganhos têm campanha. Por isso cobertura virou **portão G0**, não KPI |
| **LTV atribuído à campanha cria causalidade falsa?** | **Sim.** Mitigação: LTV entra em G3 como **qualidade do cliente adquirido**, nunca como receita creditada à campanha. E G5 põe teto na escala sem contrafactual |
| **Recompra pode vir do atendimento, não da mídia?** | **Sim, e não é separável hoje.** O lead conversa com Júlia/Bruno/João entre a 1ª e a 2ª compra. G3 mede *que o cliente é bom*, não *que a mídia o fez recomprar* |
| **Margem muda por produto?** | **Sim, e muito.** DTF Têxtil R$8/m contra DTF UV R$40/m. Por isso o contrato exige custo **por item**, não por pedido |
| **Caixa pode impedir escala rentável?** | **Sim, e é um ponto cego total** — nenhum objeto de caixa existe. Uma campanha com payback de 90 dias pode ser rentável e **inviável** |
| **Produção pode não suportar a demanda?** | **Sim, e não é observável.** Escalar mídia sem capacidade gera prazo, retrabalho e churn. Registrado como fase 2 do contrato |
| **Campanha canibaliza orgânico?** | **Não medido, e provável.** 70,6% das compras não têm campanha (R22). Só contrafactual responde |
| **Cliente B2B grande distorce a coorte?** | **Sim.** 20 clientes = 15,3% da receita CalcMe (R25); 6 leads = 18,9% do peso do `dias_ciclo` (R24). O contrato exige **mediana e IC**, nunca média simples |
| **Meta otimiza internamente e confunde retorno marginal?** | **Sim, e é exatamente por isso que o §11 dá `REQUER_HISTORICO_FUTURO`** — sem log de intervenção não se sabe quem mudou a verba |
| **Janela de 45d serve a todos os produtos?** | **Não comprovadamente.** Só DTF têxtil e `diversos` têm n≥20 (R24). Os demais têm n≤12. Por isso **janela única**, e não segmentada |
| **O ERP vira outra verdade concorrente?** | **É o risco número um desta rodada.** Mitigação no §16: fronteira escrita, uma única ponte `cliente_id ↔ lead_id`, resolvida uma vez e imutável |
| **O motor é conservador demais e trava tudo?** | **Hoje ele trava `ESCALAR` e `PAUSAR` — de propósito.** Mas libera `TESTAR` e `AGUARDAR_MATURACAO`, que são ações reais. Um motor que só sabe dizer "não" seria inútil; este sabe dizer "teste com verba limitada e meça" |
| **E se o ERP demorar?** | Recorrência (§7), aquisição (§5) e retorno marginal (§11, com log de intervenção) **não dependem dele**. Metade do mapa é destravável sem ERP |

## 20. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é a mais barata da lista inteira: **decidir e registrar qual é a receita
canônica** — `propostas_rd.won` ou `pixel_events.Purchase`.

Não é uma questão técnica; é uma escolha de verdade. Hoje as duas discordam em 53% na mesma
população, e **enquanto isso não estiver decidido, todo KPI desta rodada tem dois valores** —
CAC, ticket, contribuição, LTV, recompra, todos. É o mesmo defeito do `dias_ciclo=134`, uma
camada acima, e custa uma decisão em vez de um sistema.

Minha recomendação, já fundamentada no §3.1: **`propostas_rd.won` como receita canônica**
(negócio fechado, com item, produto, quantidade e preço, `lead_id` em 90,2%) e
**`pixel_events.Purchase` como sinal canônico de tempo e atribuição**. Uma responde *quanto*, a
outra *quando e de onde*. Registrar essa decisão em algum lugar que o Cérebro leia — antes de
construir qualquer objeto que dependa dela.

Depois disso, e ainda sem ERP, o item de maior retorno é **gravar a intervenção de mídia**
(`gustavo_meta_acoes` tem 0 linhas): destrava o retorno marginal usando os 227 saltos de verba
que já existem no histórico.
