# R23 — Arquitetura real do marketing autônomo da Skillprint

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY, nada construído

## VEREDITOS

| | |
|---|---|
| **A. Papéis dos agentes** | **AJUSTAR** — os nomes existem, as capacidades são muito menores que a hipótese |
| **B. Verdade econômica** | **INSUFICIENTE** — LTV, payback e incrementalidade não existem; ROAS está em ~24 objetos |
| **C. Motor de pausa/escala** | **INSEGURO** — escala por contagem de leads, pausa por gasto acumulado, ambos sem receita |
| **D. Campanha nova ponta a ponta** | **NAO_EXISTE** — não há código para criar adset nem ad em lugar nenhum |
| **E. Arquitetura MAPA/GPS/agentes** | **AJUSTAR** — a divisão é razoável, mas hoje há duas verdades econômicas concorrentes |

---

## 1. ARQUITETURA REAL HOJE

A hipótese mapeia para agentes que **existem de verdade** — mas quase todos param em "proposta".

| Papel na hipótese | slug real | nome | nível | dry_run | decisões 30d |
|---|---|---|---|---|---|
| LUCIANA (atribuição) | `agente-atribuicao` | Luciana Ramos | 3 | não | **786** |
| GUSTAVO (mídia) | `agente-midia` | Gustavo Leal | 2 | não | 155 |
| DIEGO (insights) | `agente-insights` | Diego Alves | 1 | não | 36 |
| CAMILA (criação) | `agente-criativo` | Camila Ferreira | 1 | não | **6** |
| DORA (mercado) | `agente-mercado` | Dora Campos | 1 | não | **5** |
| TIAGO (CRM/e-mail) | `agente-campanhas-crm` | Tiago Nogueira | **0** | **sim** | 9 |
| PATRÍCIA (aprovação) | `agente-aprovacao` | Patrícia Lima | 0 | não | **0** |

**Os agentes de marketing são os menos ativos do sistema.** Os que trabalham são todos de
conversa/venda: Felipe 8.747, Larissa 4.407, João 4.180, Júlia 3.634, Isabela 3.009.

## 2. MATRIZ DOS AGENTES — o que cada um realmente faz (90 dias)

### GUSTAVO — `agente-midia`

| ação | n | resultado |
|---|---|---|
| `proposta_publico_enviada` | **274** | pendente_aprovacao |
| `proposta_enviada` | **76** | pendente_aprovacao |
| `avaliacao_input_diego` | 44 | executada |
| `nao_proposto` | 29 | executada |
| `avaliacao_input_diego_shadow` | 11 | executada |
| `proposta_midia_shadow` | 7 | proposta |
| **`criar_publico`** | **6** | **executada** ← único efeito externo real |
| `simulado` / `simulado_publico` | 8 | proposta |

**350 propostas. 6 execuções. Todas de público.**

Capacidade provada por código (`gustavo-meta-actions` v2.1.0):

| ação | código existe | já executou |
|---|---|---|
| criar público custom + LAL | **sim** | **6 vezes** |
| criar campanha | sim (`POST /campaigns`, sempre `status:'PAUSED'`) | **nunca** |
| pausar campanha | sim | **nunca** |
| ativar campanha | sim | **nunca** |
| ajustar orçamento | sim | **nunca** |
| **criar adset** | **NÃO EXISTE** | — |
| **criar ad** | **NÃO EXISTE** | — |
| **posicionamento / criativo no ad** | **NÃO EXISTE** | — |
| encerrar/arquivar | não (só pausar) | — |

E o gatilho não é econômico: `modo:'comando'` recebe **linguagem natural do Alessandro por
WhatsApp**, um LLM interpreta, grava proposta e manda botão de aprovação. **Gustavo é um
assistente de chat do Alessandro, não um agente de mídia autônomo.**

### CAMILA — `agente-criativo`

| ação | n | resultado |
|---|---|---|
| `criativos_propostos` | 21 | pendente_aprovacao |
| `criativos_propostos` | **21** | **falhou** |
| `criativo_standalone` | **11** | **falhou** |
| `criativo_proposto` | 3 | pendente_aprovacao |
| `abstido_sem_criterio` | 3 | executada |

**Zero execuções. 32 de 59 tentativas falharam (54%).** Camila **não** cria briefing, **não**
cria anúncio, **não** cria campanha, **não** publica. Propõe criativo e para.

### LUCIANA — `agente-atribuicao`

| ação | n |
|---|---|
| `nenhum` | **2.332** |
| `backfill_atribuicao` | 4 |
| `corrigir_atribuicao` | 2 |

Roda o tempo todo e age **6 vezes em 90 dias**. É sensor, não decisor.

### PATRÍCIA — `agente-aprovacao`

`bloqueada_guardrail` 8 · `acao_aprovada` 2 (**1 delas falhou**). Última atividade: 26/07.

**É aqui que a cadeia morre.** ~374 propostas pendentes de Gustavo e Camila; a aprovação
aprovou 2 coisas em toda a história.

### Classificação das capacidades

| capacidade | classe |
|---|---|
| Gustavo criar público | **COMPROVADA** (6×) |
| Gustavo criar/pausar/ativar campanha, ajustar orçamento | **SÓ_DESENHADA** (código existe, 0 execuções) |
| Gustavo criar adset/ad/posicionamento | **NÃO EXISTE** |
| Camila propor criativo | **PARCIAL** (54% de falha) |
| Camila publicar | **NÃO EXISTE** |
| Luciana atribuir | **COMPROVADA mas quase inerte** |
| Patrícia aprovar | **MORTA/ÓRFÃ** (2 aprovações históricas) |
| `criterios_midia` (pausar/escalar) | **ÓRFÃ** — consumida só por `vw_criterios_midia` e `fn_gustavo_processar_handoffs_shadow` |
| `gustavo_meta_acoes` | tabela existe, **0 linhas** |

## 3. CAMPANHA NOVA PONTA A PONTA — **NÃO EXISTE**

| elo | quem deveria | quem faz hoje | estado |
|---|---|---|---|
| oportunidade | GPS / Dora | Dora (5 decisões/30d) | PARCIAL |
| decisão de criar | GPS | Alessandro, por WhatsApp | HUMANO |
| briefing | Camila | **ninguém** | NÃO EXISTE |
| criativo | Camila | Camila propõe, 54% falha | PARCIAL |
| copy | Camila | não há registro de ação de copy | NÃO EXISTE |
| estrutura de mídia | Gustavo | **ninguém** | NÃO EXISTE |
| criar campaign | Gustavo | código existe, 0 uso | SÓ_DESENHADA |
| **criar adset** | Gustavo | **sem código** | **NÃO EXISTE** |
| **criar ad** | Gustavo | **sem código** | **NÃO EXISTE** |
| publicar | Gustavo | campanha nasceria `PAUSED`, sem adset e sem ad | IMPOSSÍVEL |
| coletar resultados | Meta sync | `meta_ads_insights`, 5.928 linhas | COMPROVADA |
| atribuição | Luciana | cobertura de **12% da receita** (R22) | PARCIAL |
| decisão econômica | GPS | **ninguém** | NÃO EXISTE |
| escala/pausa | Gustavo | shadow inerte (R21), 0 escalas em 306 | BLOQUEADO |

**A cadeia quebra em dois pontos fatais:** não há como criar adset/ad, e não há aprovação
que destrave o que já foi proposto.

## 4–8. KPIs — o que existe de verdade

Varredura de todas as funções e views de `public`, `midia_shadow` e `cerebro_shadow`:

| KPI | objetos | veredito |
|---|---|---|
| **ROAS** | **~24** (views de Gustavo, Diego, Ricardo, aprovações, `fn_guardrail_financeiro`, `fn_recalcular_criterios_midia`) | **REI** |
| CAC | 4 (`vw_cac_por_segmento`, `vw_performance_por_campanha`, `fn_propor_metas_smart`, `fn_aplicar_meta_smart`) + CAC com IC95 na view do shadow | EXISTE |
| Recompra | **3**, todos da Dora (`fn_contexto_dora`, `vw_dora_bcg`, `vw_dora_bcg_v2`) — **nenhum de mídia** | EXISTE, DESCONECTADO |
| Margem/contribuição | muitos — mas quase todos em **precificação de proposta** (`calcular_preco_*`, `atualizar_precos_*`), não em mídia | EXISTE PARA PREÇO, NÃO PARA MÍDIA |
| **LTV (receita ou margem)** | **ZERO** | **NÃO EXISTE** |
| **Payback do CAC** | **ZERO** | **NÃO EXISTE** |
| **LTV/CAC** | **ZERO** | **NÃO EXISTE** |
| **Contribuição acumulada de coorte** | **ZERO** | **NÃO EXISTE** |
| **Retorno marginal do próximo real** | **ZERO** | **NÃO EXISTE** |
| **Incrementalidade / holdout / lift / contrafactual** | **ZERO** | **NÃO EXISTE** |
| Secundárias (CPL, CPC, CPM, CTR, alcance, frequência) | existem em `meta_ads_insights` e nas views proxy | EXISTEM |

**Das 14 métricas primárias que você listou, existem 3 (CAC, recompra isolada, margem de
preço). Onze não existem.** E a que mais aparece no sistema é justamente a que você não
quer como rei.

## 5. REGRA DE ATRIBUIÇÃO — separação aquisição × coorte

A estrutura **consegue** distinguir primeira compra de recompra (provei na R22: `ord=1` vs
`ord>1`), mas **nada no sistema faz essa separação hoje**. Não há objeto que calcule LTV de
coorte, recompra por campanha, ou receita posterior atribuída à aquisição.

Cliente novo × recorrente: existe `fn_lead_eh_recorrente` (usada nos guardrails de WhatsApp),
mas não entra em nenhuma conta de mídia.

## 6. ROAS COMO REI — e o motor real de pausa/escala

`criterios_midia` (ativo, alimentado por `fn_recalcular_criterios_midia`, cron mensal):

**Regras de PAUSA — por gasto acumulado, sem olhar receita:**

| segmento | pausar quando gasto ≥ | n | confiança |
|---|---|---|---|
| impressao_dtf_textil | R$ 800 | 94 | 0,75 |
| geral | R$ 600 | **4** | 0,65 |
| evangelicos | R$ 500 | 18 | 0,85 |
| diversos / uniformes / terceirao / petshop / dtf_uv / camisetas | R$ 300 | 29–479 | 0,60–0,90 |
| hamburgueria | R$ 200 | **2** | 0,90 |
| pizzaria | R$ 100 | **0** | 0,95 |

**Regras de ESCALA — por contagem de LEADS, sem olhar dinheiro:**

| segmento | escalar com ≥ | n |
|---|---|---|
| impressao_dtf_uv | **5 leads** | 143 |
| camisetas_personalizadas | **5 leads** | 29 |
| evangelicos | **3 leads** | 18 |

Escalar uma campanha porque ela trouxe **5 leads** é decidir dinheiro por métrica
intermediária. É o ERRO 2 codificado.

**Atenuante decisivo: nada disso está ligado a nada que executa.** `criterios_midia` é
consumida apenas por `vw_criterios_midia` (uma view de si mesma) e por
`fn_gustavo_processar_handoffs_shadow` — **shadow**. As regras são inertes hoje. É a única
razão pela qual não causaram dano.

### Os quatro erros

| erro | o sistema pode cometer? |
|---|---|
| **1. Pausar campanha de ROAS inicial baixo mas alto LTV** | **SIM, estruturalmente** — LTV não existe. Nada no sistema pode ver recorrência de campanha |
| **2. Escalar campanha de ROAS alto com cliente ruim/margem péssima** | **SIM** — a regra de escala olha **leads**; margem de produto cobre 8 de 104 produtos (R20) |
| **3. Escalar por atribuição sem venda incremental** | **SIM, e sem defesa** — incrementalidade tem **zero** objetos |
| **4. Pausar campanha jovem / amostra insuficiente** | **Parcialmente protegido** — a view do shadow tem `coorte_sem_maturacao` e `sem_compradores`, e o IC95 de Poisson. Mas `criterios_midia` pausa por gasto com n=0 (pizzaria) e n=2 (hamburgueria) |

## 7. MOTOR ECONÔMICO — atual × necessário

O motor que você descreveu (qualidade → aquisição → coorte → escala marginal →
incrementalidade) **existe apenas no primeiro andar, e só no shadow**:

| andar | existe hoje |
|---|---|
| qualidade/confiança do dado → abster | **SIM** — `cac_dtf_confiabilidade_status`, IC95 Poisson, `cobertura_maturacao_pct`, ação `abster` |
| aquisição: CAC + primeira compra + margem + payback | **PARCIAL** — CAC sim, primeira compra sim (R22), margem não, payback não |
| coorte: recompra + frequência + LTV + LTV/CAC | **NÃO** |
| escala marginal | **NÃO** |
| incrementalidade | **NÃO** |

## 8. PAUSA × ESCALA NÃO SÃO SIMÉTRICAS

A semântica que você quer **já existe parcialmente e está do lado certo**: o shadow emite
`manter` (238) e `abster` (68), nunca pausa por ausência de prova. `abster` é reservado a
entrada inválida (`segmento_desconhecido`, `segmento_ambiguo`).

**Falta o estado `AGUARDAR_MATURACAO` explícito** — hoje ele está embutido em `manter` com
motivo `avaliavel_acoes_bloqueadas_por_dependencia`, o que mistura "ainda não sei" com
"sei e decidi manter". E `REDUZIR` não existe em lugar nenhum: só pausar/ativar.

## 9. RETORNO MARGINAL — não observável hoje

Para responder "o próximo real ainda rende?" seria preciso histórico de orçamento
antes/depois. `meta_ads_insights` tem `spend` diário, mas **não tem `daily_budget`** —
o orçamento configurado não é armazenado em lugar nenhum. `gustavo_meta_acoes` (que
registraria `ajustar_orcamento`) tem **0 linhas**.

**Declaro: retorno marginal não é observável com os dados atuais.**

## 10. INCREMENTALIDADE — inexistente para mídia

Zero objetos com holdout, geo test, audiência controle ou contrafactual **em mídia**.
Existe maquinário de experimento (`lab_experimentos`, `lab_atribuicoes`, `midia_shadow`),
e o EXP-001 provou que o Cérebro sabe montar tratamento × controle — **mas nunca foi
aplicado a mídia**.

O sistema **não consegue** distinguir "venda atribuída ao Meta" de "venda causada pelo Meta".
Isso precisa aparecer como limitação de topo, não escondido dentro de ROAS.

## 11. MARGEM — o que podemos chamar de quê, sem mentir

| termo | podemos usar? |
|---|---|
| **RECEITA** | **Sim**, com ressalva: `pixel_events.Purchase.value` é **negócio ganho no RD CRM, não caixa** (U1 do MAPA) |
| **CONTRIBUIÇÃO DE MÍDIA** | **Sim** — receita menos gasto de mídia. Nada além disso |
| **MARGEM** | **Não**, para mídia. Custo de produto cobre 8 de 104 produtos (R20) |
| **LUCRO** | **Nunca.** Faltam custo de produto, taxa, frete, imposto e mão de obra |

## 12. MATRIZ DAS DECISÕES

| decisão | dono ideal | dono atual | executor | fonte da verdade |
|---|---|---|---|---|
| criar oportunidade | GPS | Alessandro (WhatsApp) | — | — |
| escolher produto | GPS | Alessandro | — | `catalogo_produtos` (8/104 com custo) |
| escolher objetivo | Gustavo | LLM interpretando texto livre | — | — |
| criar briefing | Camila | **ninguém** | — | — |
| criar criativo | Camila | Camila (54% falha) | humano | — |
| criar copy | Camila | **ninguém** | — | — |
| criar campaign | Gustavo | ninguém (código existe) | Meta API | — |
| **criar adset** | Gustavo | **ninguém, sem código** | — | — |
| **criar ad** | Gustavo | **ninguém, sem código** | — | — |
| escolher público | Gustavo | **Gustavo, 6×** | Meta API | pixel |
| orçamento inicial | Gustavo | código existe, 0 uso | Meta API | — |
| publicar | Gustavo | impossível (sem ad) | — | — |
| escalar / reduzir / pausar | GPS + Gustavo | shadow inerte | — | `criterios_midia` (órfã) |
| encerrar | Gustavo | **sem código** | — | — |
| atribuir vendas | Luciana | Luciana (6 ações/90d) | — | `utm_campaign_id`, 12% cobertura |
| calcular CAC | Luciana | view do shadow | — | IC95 Poisson |
| calcular LTV | Luciana | **ninguém** | — | — |
| calcular recompra | Luciana | Dora, desconectado de mídia | — | `vw_dora_bcg` |
| calcular payback | Luciana | **ninguém** | — | — |
| incrementalidade | GPS/Lab | **ninguém** | — | — |
| aprender resultado | MAPA | `agente-memoria` (35/30d) | — | — |

## 13. REDUNDÂNCIAS E CANDIDATOS

| agente | capacidade exclusiva que sobra | recomendação |
|---|---|---|
| **Luciana** | atribuição é competência real e não trivial | **VIRAR_SENSOR** do MAPA — ela recompõe verdade, não decide (6 ações em 90d) |
| **Diego** | analisa performance e alimenta Gustavo (91 análises) | **VIRAR_SENSOR** — sobrepõe-se ao MAPA; `criterios_midia` deveria ser canônico |
| **Dora** | **única fonte de recompra do sistema** | **MANTER_AGENTE**, e ligar a recompra dela à mídia |
| **Camila** | produção criativa | **MANTER_AGENTE**, mas só produz — decidir oferta é do GPS |
| **Gustavo** | única mão que toca o Meta | **VIRAR_FERRAMENTA** — hoje é um interpretador de comando do Alessandro, não um decisor |
| **Patrícia** | aprovação humana intermediada | **POSSIVELMENTE_REMOVER** ou reconstruir: 2 aprovações históricas com ~374 pendências é gargalo, não governança |
| **Tiago** | e-mail/Brevo | congelado (nível 0, dry_run) — Brevo tem 4 envios na história (R20) |

**Duas verdades econômicas concorrentes, e é o achado mais grave desta auditoria:**

| fonte | ciclo DTF têxtil | n | confiança |
|---|---|---|---|
| `criterios_midia` (Diego) | **134 dias** | **2.484** | 0,95 |
| Minha medição na R22 (primeira compra, pixel) | **saturação em 45 dias** | 102 | — |

Não sei qual está certa. As amostras diferem 24×, e é provável que meçam coisas diferentes
(Diego pode estar medindo ciclo do funil ou de recompra, com fonte anterior ao `pixel_events`,
que só existe desde 2026-01-26). **Mas o sistema hoje carrega as duas ao mesmo tempo, sem
que nenhuma seja canônica.** Isso invalida qualquer regra de janela até ser reconciliado —
inclusive a que eu propus na R22.

## 14. AUTO-REFUTAÇÃO

| ataque | resposta |
|---|---|
| MAPA virando monólito? | Risco real. Mas hoje o problema é o oposto: verdades espalhadas em Diego, Dora, Luciana e no shadow, sem canônico |
| GPS decidindo o que é do especialista? | Ainda não existe GPS de mídia; a decisão é do Alessandro |
| Gustavo poderoso demais? | **Não.** Ele não consegue nem montar um anúncio. O risco é o inverso: parecer autônomo sendo um chatbot |
| Camila decide oferta ou só produz? | Hoje só propõe, e falha em 54%. Deve só produzir |
| Luciana calcula economia ou só atribui? | Só atribui, e mal (12% de cobertura). Economia deve ser canônica no MAPA |
| LTV por campanha cria falsa causalidade? | **Sim** — creditar recompra de 6 meses à campanha de aquisição é indefensável (R22: aos 90d, 51% da receita atribuída já é recompra) |
| Recompra pode ser efeito do pós-venda? | **Sim, e é provável** — Júlia, Bruno e João conversam com o lead entre a aquisição e a venda. A mídia traz; o atendimento converte |
| CAC errado por cobertura baixa? | **Sim.** 12% de cobertura de receita (R22) |
| Retorno marginal observável? | **Não** — `daily_budget` não é armazenado |
| Incrementalidade medível? | **Hoje não.** O maquinário existe (EXP-001), nunca foi aplicado a mídia |
| Otimizando receita quando deveria ser margem? | **Sim** — margem de produto cobre 8 de 104 |
| Caixa pode impedir escala boa? | Não há nenhum objeto de caixa/fluxo no sistema. **Ponto cego total** |
| Capacidade produtiva pode tornar campanha boa em ruim? | **Sim, e é ponto cego** — R20 provou que não há dado de produção (OP, máquina, fila): `arte_uploads` 3.086, mas zero execução |

## 15. ARQUITETURA MÍNIMA RECOMENDADA

```
MAPA   → verdade canônica ÚNICA: atribuição, CAC, primeira compra, recompra, coorte
          (absorve Luciana e Diego como sensores; criterios_midia vira derivado, não fonte)
GPS    → prioriza oportunidade econômica e decide agir/abster
AGENTES→ Camila produz criativo · Gustavo executa no Meta · Dora lê mercado
WORKER → investiga anomalia e problema novo
CANAIS → Meta, Brevo, WhatsApp, ERP
```

Regras de arquitetura que a auditoria justifica:

1. **Uma só verdade de ciclo e de atribuição.** Hoje há duas (134d × 45d) e nenhuma canônica.
2. **Nenhum agente mantém verdade econômica própria.** Diego e Luciana viram sensores.
3. **Gustavo é ferramenta, não decisor.** Quem decide escala é o GPS com a verdade do MAPA.
4. **`ABSTER` e `AGUARDAR_MATURACAO` são estados de primeira classe**, distintos de `MANTER`.
5. **Incrementalidade é limitação de topo declarada**, não número escondido em ROAS.

## 16. RISCOS

**Matar campanha boa:** ALTO. Sem LTV e sem recompra por campanha, uma campanha com CAC alto
e cliente recorrente é indistinguível de lixo. As regras de pausa olham **gasto acumulado**,
não retorno — pizzaria pausa em R$100 com **n=0**.

**Sustentar campanha lixo:** ALTO. Escala por **5 leads** e ROAS em ~24 objetos, sem margem
(8/104 produtos) e sem incrementalidade. Uma campanha com ROAS bonito, cliente que não
recompra e margem negativa passaria em todos os testes atuais.

## 17. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e não é construir: **reconciliar as duas verdades de ciclo.**

Descobrir o que `criterios_midia.dias_ciclo` mede de fato (134 dias, n=2.484, fonte anterior
ao pixel) e por que diverge tanto da medição de primeira compra (saturação em 45 dias, n=102).
Uma das duas está medindo outra coisa — e enquanto isso não estiver resolvido, qualquer
janela, qualquer CAC e qualquer regra de escala herdam a ambiguidade.

**Não construí nada.** Zero deploy, zero alteração, zero Meta write, zero envio.
EXP-001 WhatsApp continua congelado.
