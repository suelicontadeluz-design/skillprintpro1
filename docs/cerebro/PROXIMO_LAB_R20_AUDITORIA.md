# R20 — Escolha do próximo laboratório do Cérebro (fora do WhatsApp)

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY, zero deploy, zero envio

## VEREDITO: `PROXIMO_LAB_META`

Mas **não** com uma mudança de verba. O primeiro laboratório é destravar e validar o
**shadow de mídia que já existe e já roda** — e que hoje é inerte por um motivo nomeado.

---

## 1. TERRITÓRIOS AUDITADOS — volume medido, não catálogo

| Território | Tabelas | Evidência decisiva |
|---|---|---|
| **Meta Ads** | 29 | `meta_ads_insights` **5.928** linhas, nível anúncio, **2024-10 → 2026-08** |
| **Margem/Produto** | 20 | `catalogo_produtos` 104, `calcme_pedidos` 3.730 |
| **Brevo/E-mail** | 3 | `crm_email_send_attempts` **1**, `crm_email_provider_events` **5** |
| **Produção** | 8 | `canva_preimpressao_handoffs` **1**, `onedrive_preimpressao_envios` **1** |
| **ERP/Logística** | 2 | `frenet_tracking_eventos` **1**, `frete_config` **4** |

Três territórios morrem por volume, antes de qualquer discussão de desenho.

## 2. CAPACIDADES REAIS

### Meta Ads — COMPROVADO

Gasto vivo e material:

| mês | spend | leads (Meta) | campanhas | ads |
|---|---|---|---|---|
| 2026-05 | 4.518,11 | 689 | 8 | 29 |
| 2026-06 | 7.797,86 | 885 | 11 | 28 |
| 2026-07 | 5.980,12 | 441 | 17 | 39 |
| 2026-08 (parcial) | 2.329,78 | 3 | 5 | 13 |

**A cadeia econômica interna fecha ponta a ponta**, e eu a rodei:

`meta_ads_insights.spend` → `leads_marketing.utm_campaign_id` → `pixel_events` (Purchase, `value`)

ROAS interno por campanha, desde 2026-05:

| campanha | spend | leads int. | compradores | receita interna | **ROAS int.** |
|---|---|---|---|---|---|
| CP01 camisetas leadads | 1.790,26 | 1.339 | 7 | 4.508,59 | **2,52** |
| CP134 cbo tofu dtftextil | 3.199,94 | 1.092 | 12 | 7.985,45 | **2,50** |
| CP136 impressao dtfuv | 4.450,59 | 1.437 | 27 | 10.289,90 | **2,31** |
| CP130 mofu wpp remarketing | 2.495,27 | 623 | 10 | 4.843,35 | 1,94 |
| CP145 eventos evangélicos | 998,12 | 83 | 1 | 1.386,86 | 1,39 |
| CP155 CTWA DTF têxtil | 1.293,37 | 443 | 7 | 1.354,46 | 1,05 |
| CP151 CTWA DTF UV | 2.351,04 | 737 | 18 | 2.014,15 | 0,86 |
| CP150 WhatsApp copos | 204,11 | 40 | 1 | 56,88 | 0,28 |
| CP143 Copa 2026 | 1.033,00 | 21 | 1 | 69,90 | **0,07** |
| CP153 Kiwify | 242,40 | 18 | 1 | 6,90 | 0,03 |
| CP137 camisetas público | 706,00 | 49 | 1 | 0,00 | **0,00** |
| CP147 pack rock | 553,01 | **0** | 0 | 0,00 | **0,00** |
| CP148 copos CBF | 269,54 | 49 | 0 | 0,00 | **0,00** |
| CP156 terceirão | 269,52 | 41 | 0 | 0,00 | **0,00** |

**R$ 3.277 gastos em campanhas com ROAS ≤ 0,28**, contra **R$ 9.441 em campanhas rendendo 2,3–2,5x.**
Essa é a maior oportunidade econômica concreta que encontrei em toda a auditoria.

**A atribuição do Meta é pior que a interna.** CP151: Meta reporta **0 leads**; a base tem
**737**. CP130: Meta 1, base 623. Confiar no `roas` do Meta seria medir o marketing do
próprio fornecedor.

### O shadow de mídia já existe — e é inerte

`midia_shadow.avaliacao`: **306 avaliações**, 18 campanhas, 11→25/08, cron diário 09:30.
`midia_shadow.participante`: 198 linhas, com `classe_divergencia`.

Mas:

| `acao_shadow` | n | `pausa_disponivel` | `escala_disponivel` |
|---|---|---|---|
| `manter` | 238 | **0** | **0** |
| `abster` | 68 | **0** | **0** |

**Nunca propôs pausar nem escalar, uma única vez.** O motivo é uniforme nas 306:

```
pausa_bloqueio  = promocao_formal_ausente_frente_kpis_decisivos_midia
escala_bloqueio = contribuicao_conservadora_ausente
```

Isso é um **bloqueio de governança e definição, não de dado**. E `contribuicao_conservadora`
é exatamente o que a consulta de ROAS interno acima calcula.

Write real: `gustavo_meta_acoes` tem fluxo de aprovação completo (`payload_proposto`,
`aprovado_por`, `executado_em`, `meta_response`) e **zero linhas** — nunca foi exercido.
`agente-midia` existe com autonomia 2.

### Margem/Produto — PARCIAL, e a lacuna é fatal

`catalogo_produtos` tem o schema ideal: `custo_unitario`, `custo_frete_fornecedor`,
`custo_aplicacao_uv`, `preco_1un`, `preco_10un`, `margem_alvo_pct`, `quadrante_bcg`,
`teste_verba_dia`, `teste_vendas`, `veredito`, `custo_fonte`, `custo_vigencia_inicio`.

Só que:

| medida | valor |
|---|---|
| produtos | 104 |
| com custo > 0 | 66 |
| com preço > 0 | 41 |
| **com custo E preço** | **8** |
| com `custo_fonte` | 5 |
| com `teste_inicio` | 1 |
| **com `teste_vendas` > 0** | **0** |

**Margem real é computável para 8 produtos de 104.** E `calcme_itens_pedido` está **vazia**:
há 3.730 pedidos em `calcme_pedidos`, todos com colunas `text` cruas (`Valor:text`,
`Data:text`) e **sem itens** — não dá para ligar produto a pedido por aí.
`deal_produtos_cobertura` (1.228) salva parcialmente o vínculo produto↔negócio, mas sem
custo na maioria, margem continua indisponível.

**Declaro: os dados de custo são insuficientes para uma decisão de preço/mix hoje.**

### Brevo — DESCONHECIDO virou COMPROVADAMENTE VAZIO

| medida | valor |
|---|---|
| `crm_email_send_attempts` | **1** |
| `crm_email_provider_events` | **5** |
| audiências de e-mail com `status_disparo='enviado'` | **4** |
| entregues | 4 |
| **abertos** | **0** |
| **cliques** | **0** |

Quatro e-mails na história inteira. Sem opens, sem clicks, sem entregabilidade, sem
histórico de campanha. **Não é possível testar causalmente nada por Brevo hoje.**
O único opt-out da base é um `brevo_hard_bounce` de backfill.

### Produção — sem execução, só entrada

`arte_uploads` tem **3.086** linhas (entrada de arte é real), mas não existe nenhuma tabela
de OP, máquina, fila de produção, tempo, atraso, perda ou retrabalho.
`canva_arte_aprovacoes` = 1, `canva_arte_exportacoes` = 1, `onedrive_preimpressao_envios` = 1.
**Há volume de entrada e nenhum dado de execução.** Não dá para detectar gargalo.

### ERP/Estoque/Logística — inexistente

`frenet_tracking_eventos` = **1**, `frete_config` = 4. Sem estoque, sem ruptura, sem
expedição, sem tempo até despacho. Nada a testar.

## 3. COMPROVADO / PARCIAL / DESCONHECIDO

| | |
|---|---|
| **COMPROVADO** | Spend Meta por anúncio (23 meses); vínculo lead→campanha→Purchase; dispersão de ROAS interno; shadow de mídia rodando; fluxo de aprovação de write nunca usado; Brevo vazio; ERP e Produção sem dado de execução |
| **PARCIAL** | Margem (8/104 produtos); `deal_produtos_cobertura` liga produto a negócio mas sem custo; atribuição Meta divergente da interna |
| **DESCONHECIDO** | Se o write no Meta funciona de fato (nunca exercido); custo real dos 96 produtos sem custo; por que `leads_meta` caiu para 3 em agosto |

## 4. NOTAS 0–10

| Território | A impacto | B dados | C executar | D medir | E causal | F revers. | G risco baixo | H tempo | **média** |
|---|---|---|---|---|---|---|---|---|---|
| **Meta Ads** | 9 | 8 | 4 | 8 | 6 | 9 | 6 | 7 | **7,1** |
| Margem/Produto | 8 | 3 | 3 | 5 | 6 | 8 | 5 | 5 | **5,4** |
| Brevo | 5 | **1** | 3 | 2 | 7 | 8 | 8 | 4 | **4,8** |
| Produção | 7 | 2 | 1 | 2 | 3 | 5 | 4 | 3 | **3,4** |
| ERP/Logística | 4 | **1** | 1 | 2 | 3 | 6 | 6 | 3 | **3,3** |

Brevo tem nota alta em causalidade e risco — e isso não importa: com B=1 não há o que medir.

## 5. TOP 5

**1 — Meta Ads: destravar e validar o shadow de contribuição**
Hipótese: *a política do Cérebro, se aplicada, teria realocado verba melhor que a política atual.*
Ação: definir `contribuicao_conservadora` a partir de `pixel_events` e deixar o shadow emitir `pausar`/`escalar` sem executar.
Métrica primária: acerto direcional das decisões do shadow contra o desfecho real observado nas 14–18 campanhas.
Efeito econômico: estimável a partir da dispersão medida — R$ 3.277 hoje em ROAS ≤ 0,28.
População: 18 campanhas já sob observação, 723 anúncios históricos.
Risco: **zero** (nenhum write). Falta: a definição da contribuição e a promoção formal da frente.
Tempo: 14–21 dias. Executor: `midia_shadow.fn_observador` + `agente-midia`.

**2 — Meta Ads: realocação real com holdout de campanhas**
Só depois do #1. Pausar as de ROAS ≈ 0 e redirecionar para as de 2,3–2,5x, mantendo um subconjunto intocado como controle. Risco médio: mexe em receita real.

**3 — Margem: completar custo dos produtos ativos**
Não é experimento, é pré-requisito. 33 ativos, 8 com custo+preço. Sem isso, nenhum lab de preço existe.

**4 — Produção: instrumentar execução**
`arte_uploads` (3.086) prova que há entrada. Falta registrar OP, tempo e atraso. Também pré-requisito, não lab.

**5 — Brevo: reativar o canal com volume mínimo**
Com 4 envios na história, o próximo passo é operacional (listas, entregabilidade), não causal.

WhatsApp/EXP-001 permanece fora do ranking, congelado, por decisão sua.

## 6. AUTO-REFUTAÇÃO DO ESCOLHIDO

| Pergunta | Resposta honesta |
|---|---|
| Por que esse teste pode produzir correlação falsa? | ROAS por campanha confunde **campanha** com **público e oferta**. CP143 "Copa 2026" pode ter ROAS 0,07 por sazonalidade morta, não por má gestão |
| Qual variável escondida explica o resultado? | O algoritmo do Meta realoca sozinho dentro da campanha. Uma campanha "boa" pode ser só a que o Meta escolheu alimentar |
| O sistema controla a ação? | **Não hoje.** `gustavo_meta_acoes` tem zero linhas: o write nunca foi exercido. Isso é um DESCONHECIDO, não um comprovado |
| Observamos o efeito externo? | Sim: spend é externo, real e diário |
| Medimos dinheiro ou métrica intermediária? | **Dinheiro** — `pixel_events.value` de Purchase. Com a ressalva do U1 do MAPA: Purchase é negócio ganho no RD, não caixa |
| Existe controle legítimo? | No #1, sim, e é o melhor tipo: o shadow decide sem executar, e o real acontece de qualquer jeito. Comparação sem custo |
| A ação pode prejudicar a operação? | No #1, **não** — nenhum write. No #2, sim: pausar campanha errada corta lead real |
| Atribuição de janela? | `pixel_events` não tem janela de atribuição declarada; um Purchase pode ser de lead antigo. Precisa ser fixada antes do #2 |

## 7. LABORATÓRIO ESCOLHIDO

**EXP-002 — Mídia: contribuição conservadora e validação do shadow.**

Escolhi Meta e **não** margem, apesar de preço ser alavanca mais forte, porque margem tem
8 produtos com dado e Meta tem 23 meses. E escolhi o shadow e **não** a realocação de verba
porque o write nunca foi exercido: propor mexer em R$ 6 mil/mês com um caminho de execução
não testado seria repetir o erro que essa auditoria inteira existe para evitar.

## 8. HIPÓTESE

> Uma regra de contribuição conservadora, calculada com receita interna real
> (`pixel_events.Purchase.value`) e não com a atribuição do Meta, classifica campanhas em
> pausar/manter/escalar com acerto direcional melhor que a política atual.

## 9. DESENHO READ-ONLY DO TESTE

1. Definir `contribuicao_conservadora` = receita interna atribuída ÷ spend, com janela de
   atribuição **declarada** e lead vinculado por `utm_campaign_id`.
2. Rodar contra o histórico de 723 anúncios / 154 campanhas — retrospectivo, sem write.
3. Deixar o shadow emitir `pausar`/`escalar` prospectivamente por 14–21 dias, ainda sem write.
4. Comparar: onde o shadow disse "pausar", o ROAS realizado depois foi de fato pior?
5. Só se o acerto direcional se sustentar: propor o #2 (realocação com holdout).

Nada nesse desenho toca verba, campanha ou Meta.

## 10. PRÓXIMO PASSO MÍNIMO

Uma coisa só: **definir e implementar `contribuicao_conservadora` como função read-only**,
espelhando o cálculo de ROAS interno que já rodei nesta auditoria, com a janela de
atribuição explícita.

É o literal `escala_bloqueio` das 306 avaliações. Destravado ele, o shadow deixa de ser
inerte e começa a produzir decisões comparáveis — sem gastar um real e sem risco.

EXP-001 WhatsApp permanece congelado: snapshot 456, campanha `rascunho`, fila 0, envios 0.
