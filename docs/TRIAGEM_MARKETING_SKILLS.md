# Triagem — MarketingSkills → Córtex

**Rodada:** inventário → cruzamento → classificação → shortlist → arquitetura.
**Não implementa nada.** Nenhum SkillContract, capability, action, agente, taxonomy, replay ou Gate foi criado/alterado.

Fonte avaliada: `coreyhaines31/marketingskills` @ plugin `marketing-skills` v2.11.1 — **50 skills**, 466 arquivos, formato `SKILL.md` + `references/` + `evals/`.

---

## 0. Base de auditoria — o que foi verificado e o que não foi

Isto condiciona a confiança de cada linha abaixo. Ler antes da tabela.

### Verificado em código real

| Fonte | O que foi lido |
|---|---|
| `coreyhaines31/marketingskills` | 50 skills, frontmatter, referências cruzadas, `references/`, `tools/integrations/` (40+ conectores) |
| `suelicontadeluz-design/cortex-platform-vercel-mirror` | `cortex_contracts/` (commerce + storefront), `cortex_control_plane/` (core, api, data_plane, revalidation), app `skillprint-commerce-web` |
| `suelicontadeluz-design/skillprint-erp` | 32 edge functions Supabase, roteador Iris, hooks, PCP |

### NÃO verificado — bloqueio real

O repositório canônico do Córtex é **`skillprint-cortex/cortex-platform`** (declarado em `MIRROR_NOT_CANONICAL.md`, branch `feat/skillprint-commerce-week2-frontend`, PR #36 sobre #34). **Esta sessão não consegue anexá-lo** — `add_repo` recusa cross-tier: a sessão já tem repos do owner `suelicontadeluz-design`.

Consequência — os seguintes itens do pedido **não puderam ser auditados contra código**:

- registro real de **capabilities**
- registro real de **actions** além das que aparecem no espelho
- **taxonomy** (skills previstas sem contrato)
- roster de **agentes**
- estado do **Gate 5B** e das frentes vivas
- definição interna dos **13 SkillContracts** provados

Os 13 contratos e as lacunas ("atribuição, funil, mídia, conteúdo orgânico, comercial, identidade, segurança") foram tomados **como dados do handoff**, não confirmados em código. Toda linha marcada `PRECISA_AUDITORIA_DE_LEGADO` depende de acesso ao repo canônico para fechar.

### O que o espelho revelou — e que muda a triagem

O espelho é não-canônico mas contém contratos e control plane reais. Isso derruba parte da premissa "marketing é lacuna aberta": **já existe superfície de ação de marketing governada, sem skill que a decida.**

`ActionType` (verificado em `cortex_contracts/commerce_contracts.py:63`):

```
PUBLISH_BANNER · REORDER_VITRINE · CREATE_COLLECTION
UPDATE_SEO_META · PUBLISH_LP · LAUNCH_EXPERIMENT · TRIGGER_ROLLBACK
```

Ciclo de vida de estado: `DRAFT → CANARY → STABLE → LAST_KNOWN_GOOD → DEPRECATED`.
Eventos: `ACTION_PROPOSED · POLICY_ALLOWED · POLICY_DENIED · CANARY_STARTED · CANARY_MEASURED · PROMOTED · ROLLBACK_TRIGGERED · ROLLBACK_COMPLETED`.

`PolicyEngine` (`cortex_control_plane/core.py:58`) já impõe guardrails comerciais que **são exatamente o domínio de `offers` e `pricing`**:

```
min_margin_pct = 0.15 · max_discount_pct = 0.20 · max_canary_traffic_pct = 10.0
+ capacity_units <= capacity_limit_units
```

E o motor é explícito: *"The caller cannot self-attest margin/discount/capacity in the request"* — a evidência tem que existir no snapshot candidato. Circuit breaker cobre `MARGIN_VIOLATION`, `CHECKOUT_FAIL_SPIKE`, `RENDER_INTEGRITY_FAILURE`, `MANUAL_KILL_SWITCH`.

Dados de marketing já em produção (`apps/skillprint-commerce-web`):

- `/api/tracking/pageview` — first-party, com `uuid`, `event_id`, `referrer`, **`utm_source/medium/campaign_name/campaign_id/content`, `utm_adset_id`, `utm_ad_id`, `utm_ad_name`, `fbp`, `fbc`** → persistido em Supabase
- `google-tag-manager.tsx` — GTM ativo
- `lib/pricing.ts` — `pricingSource { version: "2026-09-01", currency: "BRL", status: "PUBLISHED" }`, tiers e preços fixos DTF têxtil/UV
- `lib/intents.ts` — `PublicStorefrontState` com `schema_version "1.0.0"`, hero, `intents[]`, `service_ladder[]` — copy comercial **já é estado versionado e validado por Pydantic strict** (`extra=forbid, frozen=True, strict=True`)

Legado ERP (`skillprint-erp`): agentes Iris (vendas, estoque, ranking, contexto, estratégia/PCP), `agente-exploracao` emitindo `DemandaNaoAtendida` (o radar de demanda), `agente-noturno`, loyalty, NF-e. **Nenhum comportamento de marketing** — nada de atribuição, mídia, criativo, conteúdo ou pricing estratégico. O `orcamento` do ERP é custo/precificação de pedido, não estratégia de preço.

### Leitura de negócio que filtra o repo

Skillprint é gráfica DTF (têxtil/UV) no Brasil: e-commerce + ERP + PCP + fidelidade, ticket B2B/B2C, BRL. O repositório MarketingSkills é fortemente **B2B SaaS / produto digital**. Isso põe uma fatia grande do repo fora de escopo por construção, não por qualidade.

---

## 1. Inventário + cruzamento + classificação (50 skills)

Legenda de situação: **A** = já coberto por contrato provado · **B** = lacuna real · **C** = conhecimento, não capacidade · **D** = duplicada · **E** = fora de escopo · **F** = precisa auditoria do canônico.

### 1.1 Contexto e pesquisa

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `product-marketing` | B | nenhum — nenhum dos 13 contratos carrega produto/ICP/posicionamento | **Sim.** Todas as demais skills do repo leem `.agents/product-marketing.md`; o Córtex não tem esse estado | **NOVO_SKILLCONTRACT_CANDIDATO** — mas como *contrato de estado versionado*, não como skill de decisão | **P0** |
| `customer-research` | B | `data_analysis` analisa dados, não sintetiza VOC/persona/JTBD | **Sim.** Nenhum contrato produz ICP, dor verbatim ou JTBD | **NOVO_SKILLCONTRACT_CANDIDATO** | **P1** |
| `competitor-profiling` | F | possível sobreposição com `data_analysis` + radar de demanda | Parcial | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |
| `competitors` (páginas comparativo) | E | — | Não — jogada de SEO B2B SaaS | **FORA_DE_ESCOPO** | — |
| `marketing-psychology` | C | `objection_handling`, `negotiation`, `copywriting` (candidato) | Não — é lente, não capacidade | **ABSORVER_COMO_CONHECIMENTO_DE_OUTRA_SKILL** | P2 |
| `marketing-council` | E | `executor_routing` roteia executores reais | Não — simulação de persona de marketeiros famosos; **não determinístico, não provável em replay** | **FORA_DE_ESCOPO** (viola a regra de capacidade governável/testável) | — |

### 1.2 Medição — a lacuna mais dura

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `attribution` | B | nenhum. `data_analysis` é genérico; a taxonomia lista "atribuição" como frente sem cobertura | **Sim, e com dado já em produção**: `utm_*`, `utm_ad_id`, `utm_adset_id`, `fbp`, `fbc` gravados em first-party sem nenhum contrato que decida modelo, reconcilie fontes ou reporte confiança | **NOVO_SKILLCONTRACT_CANDIDATO** | **P0** |
| `analytics` (plano de tracking) | B/F | pipeline `/api/tracking/pageview` + GTM existem; nenhum contrato governa o schema de eventos | **Sim.** A própria skill `attribution` declara que depende de `analytics` como pré-requisito | **NOVO_SKILLCONTRACT_CANDIDATO** (menor que attribution; pode virar referência dela) | P1 |
| `ab-testing` | A + C | `scientific_method` (provado) **+ action `LAUNCH_EXPERIMENT` já existente** com `traffic_percent` e guardrail de canário 10% | Não como contrato. Falta só o cálculo (amostra, MDE, duração) | **REUTILIZAR_CONTRATO_EXISTENTE** + **ABSORVER** `sample-size-guide.md` em `scientific_method` | **P1** |

### 1.3 Oferta, preço e funil

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `offers` | B | `negotiation` negocia caso a caso; `PolicyEngine` só **valida** `discount_pct` — ninguém **desenha** a oferta | **Sim.** A evidência (`policy_evidence.discount_pct`) precisa de um produtor governado | **NOVO_SKILLCONTRACT_CANDIDATO** | **P1** |
| `pricing` | B | `lib/pricing.ts` é fonte publicada e versionada; `min_margin_pct`/`max_discount_pct` são guardrails; nenhum contrato decide preço | **Sim** — e é a de maior risco externo | **NOVO_SKILLCONTRACT_CANDIDATO** (nunca ENFORCE nesta fase) | **P1** |
| `cro` | B | nenhum. Alimenta diretamente `LAUNCH_EXPERIMENT` | **Sim.** "funil" é lacuna declarada; a action de experimento existe sem quem gere hipótese | **NOVO_SKILLCONTRACT_CANDIDATO** | **P1** |
| `paywalls` | E | — | Não — SaaS assinatura; Skillprint é pedido/impressão | **FORA_DE_ESCOPO** | — |
| `signup` | C | subconjunto de `cro` | Não | **ABSORVER** em `cro` | P3 |
| `popups` | C | subconjunto de `cro` | Não | **ABSORVER** em `cro` | P3 |
| `onboarding` | F | ativação pós-signup; ERP tem `skillprint-pro-enroll-v1` e loyalty | Parcial | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |
| `lead-magnets` | C | subconjunto de `offers` | Não | **ABSORVER** em `offers` | P3 |
| `free-tools` | E | — | Não | **FORA_DE_ESCOPO** | — |

### 1.4 Mídia paga e criativo

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `ads` | B | nenhum. `fbp`/`fbc`/`utm_ad_id` no tracking provam que já há mídia rodando **sem governança** | **Sim.** "mídia" é lacuna declarada | **NOVO_SKILLCONTRACT_CANDIDATO** (efeito externo = gasto; começa NO_EFFECT) | **P2** |
| `ad-creative` | B | **action `PUBLISH_BANNER` já existe**; `CanonicalAsset` já tem `rights_status: CLEAR/PENDING_REVIEW/RESTRICTED` | **Sim.** Existe superfície de publicação de criativo sem skill que o produza sob contrato | **NOVO_SKILLCONTRACT_CANDIDATO** | **P2** |
| `image` | C | `CanonicalAsset` (mime png/tiff/svg, rights_status) governa o ativo | Não como contrato próprio | **ABSORVER** em `ad-creative` | P3 |
| `video` | E | — | Não nesta fase | **FORA_DE_ESCOPO** | — |
| `aso` | E | não há app mobile | Não | **FORA_DE_ESCOPO** | — |

### 1.5 Copy e conteúdo

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `copywriting` | B | **`PublicStorefrontState` já valida copy** (hero, intents, service_ladder, limites de caracteres) e **`PUBLISH_LP` já existe** — sem skill que escreva sob contrato | **Sim.** Alvo de escrita já é estado tipado e versionado | **NOVO_SKILLCONTRACT_CANDIDATO** | **P1** |
| `copy-editing` | C | mesmo domínio de `copywriting` | Não | **ABSORVER** em `copywriting` | P2 |
| `content-strategy` | B | nenhum. "conteúdo orgânico" é lacuna declarada | **Sim** | **NOVO_SKILLCONTRACT_CANDIDATO** | **P2** |
| `seo-audit` | F | **`UPDATE_SEO_META` já existe** como action | Parcial — action sem skill decisora | **PRECISA_AUDITORIA_DE_LEGADO** | P2 |
| `schema` | C | insumo de `UPDATE_SEO_META` | Não | **ABSORVER** no contrato de SEO, se houver | P3 |
| `site-architecture` | F | `intents`/`service_ladder` já definem hierarquia comercial | Parcial | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |
| `programmatic-seo` | E | — | Não nesta fase | **FORA_DE_ESCOPO** | — |
| `ai-seo` | E | — | Não nesta fase | **FORA_DE_ESCOPO** | — |
| `directory-submissions` | E | — | Não — diretórios SaaS/AI | **FORA_DE_ESCOPO** | — |
| `social` | E/F | "conteúdo orgânico" é lacuna, mas a skill é operação de publicação multiplataforma | Parcial | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |

### 1.6 Ciclo de vida, comercial e retenção

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `revops` | B/F | `executor_routing` roteia executores — **não** leads; `workflow_orchestration` orquestra | **Sim, parcial.** Falta estágio de ciclo de vida, scoring e segmentação | **NOVO_SKILLCONTRACT_CANDIDATO** *(segmentação/ciclo de vida)* após auditoria de `executor_routing` | **P2** |
| `churn-prevention` | D | **`winback_eligibility` + `winback_action_planning` + `winback_recovery`** — trio já provado | Não | **DUPLICADA** | — |
| `emails` (lifecycle) | A | `follow_up` (16/16 PASS em cadeia dedicada) + trio winback | Não como contrato; templates são conteúdo | **REUTILIZAR_CONTRATO_EXISTENTE** + **ABSORVER** templates | P2 |
| `cold-email` | A | `follow_up` + `negotiation` + `objection_*` | Não | **REUTILIZAR_CONTRATO_EXISTENTE** | P3 |
| `sms` | F | canal, não capacidade cognitiva; compliance BR (LGPD) não coberto pelo repo (US-centric) | Parcial — canal | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |
| `prospecting` | B/F | radar de demanda (`DemandaNaoAtendida`) cobre demanda interna, não prospecção externa | Parcial | **PRECISA_AUDITORIA_DE_LEGADO** — insumo do contrato de segmentação | P2 |
| `sales-enablement` | A + C | `objection_classification`, `objection_handling`, `negotiation` | Não. `objection-library.md` é conhecimento | **REUTILIZAR** + **ABSORVER** | P2 |
| `referrals` | F | fidelidade já existe no ERP (`loyalty/`, `skillprint-pro-enroll-v1`) | Parcial — pode já estar no legado | **PRECISA_AUDITORIA_DE_LEGADO** | P3 |

### 1.7 Planejamento e orquestração

| Skill do repo | Situação no Córtex | Equivalente atual | Lacuna real | Recomendação | Prior. |
|---|---|---|---|---|---|
| `marketing-plan` | A | `five_w_two_h` + `smart_goal` + `workflow_orchestration` | Não. AARRR/budget são conhecimento | **REUTILIZAR_CONTRATO_EXISTENTE** + **ABSORVER** | P2 |
| `marketing-loops` | D | `workflow_orchestration` + `executor_routing` | Não | **DUPLICADA** | — |
| `marketing-ideas` | C | — | Não | **ABSORVER_COMO_CONHECIMENTO** | P3 |
| `launch` | A | `five_w_two_h` + `smart_goal` + `workflow_orchestration` | Não | **REUTILIZAR_CONTRATO_EXISTENTE** | P3 |
| `events`, `public-relations`, `co-marketing`, `community-marketing`, `influencer-marketing` | E | — | Não nesta fase | **FORA_DE_ESCOPO** | — |

### Consolidado

| Classificação | Qtd |
|---|---|
| NOVO_SKILLCONTRACT_CANDIDATO | 12 |
| REUTILIZAR_CONTRATO_EXISTENTE | 6 |
| ABSORVER_COMO_CONHECIMENTO | 8 |
| DUPLICADA | 2 |
| FORA_DE_ESCOPO | 14 |
| PRECISA_AUDITORIA_DE_LEGADO | 8 |

**De 50 skills, 12 viram candidatas.** As outras 38 ou já estão cobertas, ou são material de referência, ou não pertencem a este negócio.

---

## 2. Resposta direta: `product-marketing` deve ser skill-base?

**Sim — mas não como SkillContract de decisão. Como contrato de estado versionado.**

Evidência de que reduz duplicação, medida no próprio repo: **8 skills abrem com o mesmo bloco literal** *"Check for product marketing context first: if `.agents/product-marketing.md` exists, read it before asking questions"* — `offers`, `pricing`, `ads`, `revops`, `customer-research`, `attribution`, `marketing-council`, `marketing-plan`. Sem essa camada, cada contrato de marketing teria que declarar produto, ICP, dor, posicionamento, diferencial e restrição comercial nos próprios inputs. Com ela, declaram **uma referência** a um snapshot versionado.

O que a skill original faz e **não deve** ser importado: ela é conversacional, grava um `.md` livre e faz o próprio agente redigir. No Córtex isso vira:

- `MarketingContextState` — Pydantic strict (`extra=forbid, frozen=True`), no mesmo padrão de `PublicStorefrontState`
- `schema_version` + `context_version` + changelog — a skill original **já versiona e mantém changelog**, o que casa com o ciclo `DRAFT → STABLE`
- consumido **por referência imutável** (`context_snapshot_id`), para que replay e proof sejam determinísticos: sem snapshot fixo, nenhuma skill de marketing é reproduzível

Risco a registrar: contexto é entrada de **todas** as demais. Um erro nele propaga para copy, oferta, preço e mídia de uma vez. Ele precisa de proof próprio antes de qualquer skill dependente entrar em Shadow.

---

## 3. TOP 12 recomendadas

Ordenadas por dependência, não por apelo.

### P0 — camada base

**1. `marketing_context`** *(de `product-marketing`)*
- **Por quê:** sem ele, cada skill de marketing repete produto/ICP/posicionamento nos inputs e nenhum replay é determinístico.
- **Frentes:** identidade (parcial), comercial, conteúdo, mídia, funil — todas leem daqui.
- **Agente:** nenhum "carrega" — é estado do control plane, lido por todos.
- **Capability/action:** nenhuma action nova. Capability de leitura de snapshot + versionamento no data plane.
- **Efeito externo:** **NO_EFFECT.** Puro estado interno.

**2. `attribution`**
- **Por quê:** a lacuna com maior distância entre dado e governança. `utm_ad_id`, `utm_adset_id`, `fbp`, `fbc` já são gravados em first-party e **ninguém decide** modelo, reconcilia fontes divergentes ou declara confiança. Hoje qualquer número de canal é opinião não rastreável.
- **Frentes:** atribuição, mídia, funil, comercial.
- **Agente:** o mesmo que carrega `data_analysis` — atribuição é `data_analysis` com modelo causal declarado.
- **Capability/action:** capability de leitura da tabela de pageview/conversão. **Nenhuma action** — a saída é um readout.
- **Efeito externo:** **NO_EFFECT.** Fixture real disponível de imediato: eventos de tracking já em produção.

### P1 — evidência e decisão

**3. `customer_research`**
- **Por quê:** alimenta `marketing_context`. Sem VOC verbatim, copy e oferta viram invenção.
- **Frentes:** comercial, conteúdo, identidade.
- **Agente:** o de `data_analysis` / pesquisa.
- **Capability/action:** leitura de propostas, pedidos, objeções e histórico de atendimento no ERP. Sem action.
- **Efeito externo:** **NO_EFFECT.**

**4. `marketing_analytics_plan`** *(de `analytics`)*
- **Por quê:** `attribution` declara depender de tracking existente. O endpoint existe; o **schema de eventos** não é governado. Sem isso, atribuição mede o que calhou de ser instrumentado.
- **Frentes:** atribuição, funil.
- **Agente:** mesmo de `attribution`.
- **Capability/action:** nenhuma action. Produz especificação de eventos.
- **Efeito externo:** **NO_EFFECT.** Candidato a virar referência de `attribution` em vez de contrato próprio — decidir após auditoria do canônico.

**5. `offer_design`** *(de `offers`)*
- **Por quê:** o `PolicyEngine` já **valida** `discount_pct` e exige que a evidência esteja no snapshot — mas nenhum contrato **produz** a oferta. Hoje quem monta oferta é humano, fora do sistema de prova.
- **Frentes:** comercial, funil, mídia.
- **Agente:** o que carrega `negotiation` / `objection_handling`.
- **Capability/action:** produz candidato que alimenta `policy_evidence`. Reaproveita `LAUNCH_EXPERIMENT` para testar oferta.
- **Efeito externo:** **NO_EFFECT → SHADOW.** Só propõe; `PolicyEngine` continua sendo a autoridade.

**6. `pricing_strategy`** *(de `pricing`)*
- **Por quê:** `lib/pricing.ts` é fonte `PUBLISHED` e versionada; `min_margin_pct = 0.15` já é lei. Falta a decisão governada de estrutura de tier e valor.
- **Frentes:** comercial, funil.
- **Agente:** `negotiation` + `data_analysis`.
- **Capability/action:** leitura de custo/margem do ERP. **Nenhuma action de publicação de preço nesta fase.**
- **Efeito externo:** **maior risco da lista.** `SHADOW` apenas, **nunca ENFORCE** nesta rodada. Preço publicado errado atravessa checkout e dispara `MARGIN_VIOLATION` no circuit breaker.

**7. `marketing_copy`** *(de `copywriting` + `copy-editing`)*
- **Por quê:** `PublicStorefrontState` já é copy tipada, com limites de caracteres e validação strict, e `PUBLISH_LP` já é action. É a skill com o **caminho mais curto até proof real**: o alvo já tem schema.
- **Frentes:** conteúdo, comercial, identidade.
- **Agente:** agente de conteúdo/storefront.
- **Capability/action:** **`PUBLISH_LP` e `PUBLISH_BANNER` já existem** — nada a criar.
- **Efeito externo:** **SHADOW** com ciclo `DRAFT → CANARY` já pronto. Rollback já existe (`TRIGGER_ROLLBACK`).

**8. `conversion_optimization`** *(de `cro` + `signup` + `popups`)*
- **Por quê:** "funil" é lacuna declarada e a action de experimento (`LAUNCH_EXPERIMENT`, canário ≤10%) existe **sem quem gere a hipótese**. `scientific_method` valida hipótese, mas não a produz a partir de uma página.
- **Frentes:** funil, comercial.
- **Agente:** o de `scientific_method`.
- **Capability/action:** consome `attribution` + tracking; emite candidatos para `LAUNCH_EXPERIMENT`.
- **Efeito externo:** **NO_EFFECT** (diagnóstico) → **SHADOW** (proposta de experimento).

### P2 — produção e distribuição

**9. `paid_media_planning`** *(de `ads`)*
- **Por quê:** há mídia rodando (os `fbp`/`fbc` provam) sem contrato de decisão de verba, alvo ou meta de CPA.
- **Frentes:** mídia, atribuição, comercial.
- **Agente:** agente comercial/mídia, sob `workflow_orchestration`.
- **Capability/action:** leitura de plataforma. **Action de gasto é fora de escopo por ora.**
- **Efeito externo:** **alto** (dinheiro). `NO_EFFECT` estrito nesta fase — plano, não execução.

**10. `ad_creative`** *(de `ad-creative` + `image`)*
- **Por quê:** `PUBLISH_BANNER` existe e `CanonicalAsset.rights_status` já governa direitos de imagem — falta a skill que produza o criativo sob contrato.
- **Frentes:** mídia, conteúdo, identidade.
- **Agente:** agente de conteúdo/criativo.
- **Capability/action:** `PUBLISH_BANNER` já existe; `CanonicalAsset` já valida mime e direitos.
- **Efeito externo:** **SHADOW.** Bloquear publicação com `rights_status != CLEAR`.

**11. `content_strategy`**
- **Por quê:** "conteúdo orgânico" é lacuna declarada e nenhum dos 13 contratos decide pauta.
- **Frentes:** conteúdo, identidade.
- **Agente:** agente de conteúdo.
- **Capability/action:** consome `customer_research` + `attribution`. Sem action nova.
- **Efeito externo:** **NO_EFFECT.**

**12. `lifecycle_segmentation`** *(de `revops` + `prospecting`)*
- **Por quê:** segmentação é pedido explícito e nenhum contrato define estágio de ciclo de vida ou score. **Condicionado a auditoria**: `executor_routing` roteia executores, não leads — a sobreposição precisa ser confirmada no canônico antes de virar contrato.
- **Frentes:** comercial, funil, atribuição.
- **Agente:** o de `executor_routing` / `follow_up`.
- **Capability/action:** leitura de clientes/pedidos do ERP. Sem action.
- **Efeito externo:** **NO_EFFECT.** ⚠️ Não abrir antes da auditoria — risco real de duplicar `executor_routing`.

---

## 4. Arquitetura proposta

### Correção à ordem sugerida no handoff

A cadeia do handoff era linear e termina em `scientific_method`:

```
product-marketing → customer-research → offer/pricing → copywriting
  → ads/ad-creative → attribution/analytics → CRO → scientific_method
```

Três correções, com base no que o código mostra:

1. **`attribution`/`analytics` não vêm depois de mídia — vêm antes.** Sem plano de eventos e modelo declarado, mídia gasta sem leitura. E o dado já existe: a instrumentação está em produção **hoje**, antes de qualquer skill de mídia.
2. **`scientific_method` não é o fim da fila — envolve o ciclo inteiro.** Já está provado e já tem action (`LAUNCH_EXPERIMENT` + `TRIGGER_ROLLBACK`). É a autoridade de validação, não a última etapa.
3. **Não é linha, é laço.** `attribution` realimenta contexto e mídia. Uma coleção linear é exatamente o que vira coleção solta.

### Camadas

```
CAMADA 0 — ESTADO
  marketing_context  (snapshot imutável, versionado)
      ▲ escrito por customer_research · lido por todas
      
CAMADA 1 — EVIDÊNCIA          [NO_EFFECT]
  customer_research ─┐
  marketing_analytics_plan ──► attribution ──┐
  data_analysis (existente) ─┘               │
                                             │
CAMADA 2 — DECISÃO             [SHADOW]      │
  offer_design ──► pricing_strategy          │
  conversion_optimization                    │
  lifecycle_segmentation                     │
      │  guardrail: PolicyEngine             │
      │  (margem 15% · desconto 20% · capacidade)
      ▼                                      │
CAMADA 3 — PRODUÇÃO            [SHADOW]      │
  marketing_copy · ad_creative · content_strategy
  paid_media_planning [NO_EFFECT]            │
      ▼                                      │
CAMADA 4 — EFEITO (actions já existentes)    │
  PUBLISH_LP · PUBLISH_BANNER · UPDATE_SEO_META
  REORDER_VITRINE · CREATE_COLLECTION        │
      ▼                                      │
CAMADA 5 — VALIDAÇÃO (já provada)            │
  scientific_method ─► LAUNCH_EXPERIMENT (canário ≤10%)
      DRAFT → CANARY → STABLE                │
      falhou? TRIGGER_ROLLBACK → LAST_KNOWN_GOOD
      └──────────── mede via ────────────────┘
                              
TRANSVERSAL: workflow_orchestration · executor_routing · five_w_two_h · smart_goal
CIRCUIT BREAKER: MARGIN_VIOLATION · CHECKOUT_FAIL_SPIKE · RENDER_INTEGRITY_FAILURE
```

### Regras de dependência

1. **Nenhuma skill de marketing entra em Shadow antes de `marketing_context` ter proof.** É entrada de todas — erro nela propaga para copy, oferta, preço e mídia simultaneamente.
2. **Nenhuma skill da Camada 2/3 promove sem leitura da Camada 1.** Decisão sem evidência é prompt, não capacidade.
3. **`pricing_strategy` e `paid_media_planning` não recebem action nesta rodada.** São as duas de efeito externo irreversível (preço publicado, verba gasta).
4. **Toda skill de Camada 3 escreve em estado `DRAFT` e sobe por canário.** O caminho já existe — não construir um paralelo.
5. **A evidência de política nunca vem da skill.** `PolicyEngine` é explícito: o chamador não pode auto-atestar margem/desconto/capacidade. `offer_design` e `pricing_strategy` propõem; a política decide.

### Sequência sugerida de prova

| Onda | Skills | Por que nessa ordem |
|---|---|---|
| 1 | `marketing_context`, `attribution` | Contexto destrava todo o resto; atribuição tem fixture real disponível hoje |
| 2 | `customer_research`, `marketing_analytics_plan` | Fecham a camada de evidência |
| 3 | `marketing_copy`, `conversion_optimization` | Caminho mais curto até Shadow real — schema e action já existem |
| 4 | `offer_design`, `pricing_strategy` | Só depois que a evidência estiver provada |
| 5 | `ad_creative`, `content_strategy`, `paid_media_planning` | Produção e distribuição |
| — | `lifecycle_segmentation` | **Bloqueada** até auditoria de `executor_routing` |

### O que não importar do repositório

- **`marketing-council`** — simulação de personas de marketeiros célebres. Não determinístico, não replayável, não provável. É exatamente a "coleção de prompts" que a regra principal proíbe.
- **Os blocos "Related Skills"** — o repo encadeia skills por referência textual em Markdown. No Córtex a dependência é contrato declarado, não link.
- **Templates e frameworks** (AARRR, value equation, copy frameworks, objection library, sample-size guide) — entram como **conhecimento** dentro de contratos existentes, nunca como contrato próprio.

---

## 5. Bloqueios para a próxima rodada

1. **Acesso a `skillprint-cortex/cortex-platform`.** Sem ele não dá para fechar taxonomy, capabilities, agentes, Gate 5B nem os 8 itens `PRECISA_AUDITORIA_DE_LEGADO`. `add_repo` recusa por ser outro owner — precisa de sessão iniciada com esse repo como fonte.
2. **Auditoria `executor_routing` vs. segmentação de leads** — decide se `lifecycle_segmentation` existe ou é duplicata.
3. **Confirmar se o espelho reflete o canônico.** As actions e o `PolicyEngine` acima vieram do espelho no snapshot `da250a1`. Se o canônico avançou, a linha "action já existe" muda.
4. **Decidir `marketing_analytics_plan`**: contrato próprio ou referência de `attribution`.
5. **Compliance BR.** O repo é US-centric (CAN-SPAM/TCPA). `sms` e `emails` precisam de LGPD antes de qualquer efeito externo.
