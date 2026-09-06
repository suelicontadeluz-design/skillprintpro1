# Triagem de Skills Financeiras para o Córtex — Rodada 1

**Escopo desta rodada:** inventário → cruzamento → classificação → shortlist → arquitetura proposta.
**Nada foi implementado.** Nenhum SkillContract, capability, action, agente, taxonomy, replay, fixture ou regra financeira foi criado ou alterado. Nenhuma leitura tocou dinheiro, ERP ou crédito.

**Fonte de conhecimento avaliada:** `alirezarezvani/claude-skills` (clone raso em `/home/user/alirezarezvani/claude-skills`, HEAD de 06/09/2026), diretórios `finance/` e `c-level-advisor/skills/cfo-advisor/`.

**Bases inspecionadas (somente leitura):**

| Papel | Projeto Supabase | Observação |
|---|---|---|
| Córtex / Cérebro | `ldrdtaibazplvrbwyrvx` | 985 tabelas em `public` + schemas `patricia`, `cerebro_shadow`, `midia_shadow`, `agente_infra` |
| ERP | `ynjsflvdfftcopibzxyo` (criativa-futuro-erp) | schema financeiro completo, base quase vazia |
| Fidelidade | `jjigrdmtanyxrzmkelvz` (Skiprintpro) | schema `loyalty`, sem relevância financeira corporativa |
| App/entitlements | `fgiewvovsaqsezrwbuaq` (cortex-app) | só auth/tenant/Play billing |

---

## 0. Estado real do Córtex (medido, não presumido)

### 0.1 As 13 skills canônicas

`public.skill_contract_versions` — 13 `skill_ref` distintos:

`data_analysis`, `executor_routing`, `five_w_two_h`, `follow_up` (v2), `negotiation` (v3), `objection_classification` (v2), `objection_handling`, `scientific_method`, `smart_goal`, `winback_action_planning`, `winback_eligibility`, `winback_recovery`, `workflow_orchestration`.

Provas: `gate5b_cognitive_replay_proof_versions` tem 117 provas cobrindo 12 dessas skills, **todas com `verdict` PASS e `effect_zero = true`**; `follow_up` prova na tabela própria (`gate5b_post_sale_follow_up_replay_proof_versions`). Ou seja: o padrão vigente de "skill pronta" é prova com efeito zero — exatamente o regime em que uma skill financeira deve nascer.

**Nenhuma das 13 é financeira.**

### 0.2 Taxonomia (v5) — o que já está previsto

| Família | Skills previstas |
|---|---|
| `COMMERCIAL` | closing, discovery, follow_up, negotiation, objection_classification, objection_handling, proposal_generation, qualification, upsell_cross_sell, winback_action_planning, winback_eligibility, winback_recovery |
| `FINANCE_COLLECTION` | **credit_check, dunning_negotiation, payment_issue, pricing_calculation, receipt_validation** |
| `GOVERNANCE_ANALYSIS` | audit_logging, authority_check, copy_generation, data_analysis, five_w_two_h, media_handling, scientific_method, smart_goal |
| `OPERATIONS_SUPPORT` | executor_routing, handoff_trigger, knowledge_retrieval, logistics_quote, operational_exception_management, order_tracking, technical_support, ticket_escalation, workflow_orchestration |

Achado que muda o desenho: **existe família financeira na taxonomia, mas ela é de cobrança/transação no atendimento (`FINANCE_COLLECTION`), não de gestão financeira da empresa.** Nenhuma das 5 tem SkillContract. Fluxo de caixa, capital de giro, dívida, alocação de capital e orçado-vs-realizado **não estão previstos em nenhuma família da v5** — entrariam numa família nova (proposta: `FINANCE_MANAGEMENT`), o que exige taxonomy v6. Fora do escopo desta rodada; registrado como pré-requisito.

### 0.3 Capabilities

`capacidade_vocabulario` — 38 capacidades em 13 domínios (`comercial`, `reativacao`, `midia`, `engenharia`, `governanca`, `observabilidade`, `atribuicao`, `aquisicao`, `produto`, `mercado`, `laboratorio`, `infraestrutura`, `direcao`, `economico`).

**No domínio `economico` existe exatamente uma:**

> `MEDIR_CUSTO_MARGEM_POR_PEDIDO` — "Apurar custo e margem reais por pedido".
> Motivo registrado: *"GAP R68: sem isso, todo candidato economico do territorio CLIENTE fica com custo NAO ESTIMAVEL."*

E ela **não tem nenhuma linha em `capacidade_registro`** — está declarada no vocabulário e não tem executor. Não é falta de vocabulário: é falta de executor provado.

Não existe capability para caixa, dívida, capital de giro, orçamento, projeção ou alocação de capital.

### 0.4 Actions e autoridade

`operator_action_registry` — 12 actions ativas:

- `agent_runtime` (8): `agent.analysis.test_hypothesis`, `agent.market.radar_demand`, `agent.operations.route_work`, `agent.planning.build_action_plan`, `agent.planning.evaluate_goal`, `agent.post_sales.plan_followup`, `agent.sales.assess_opportunity`, `agent.sales.assess_recovery`
- `communications.whatsapp.send`: `connector.whatsapp.send_text`
- `marketing.brevo.read`: `connector.brevo.health_read`
- `general`: `logistics.quote.override_discount`
- `test.stub`: `connector.stub.echo`

**Nenhuma action financeira. Nenhum `authority_domain` financeiro.** O padrão `agent.<dominio>.<verbo>` com TTL de 300–900s é o molde a seguir — e todas as 8 do `agent_runtime` são de análise/planejamento, ou seja, o Córtex já tem o formato certo para uma action financeira NO_EFFECT.

### 0.5 Agentes

- `standard_agent_card_versions` — 16 cartões. Em `MANAGEMENT_GOVERNANCE` existem **`financeiro`**, **`cobranca`** e **`dados_bi`**. Cartão-padrão existe; não há instância viva.
- `agentes` — 24 agentes vivos (comercial, marketing, infraestrutura, direção). **Nenhum financeiro.** Os mais próximos: `agente-insights` (Diego Alves — CAC por segmento), `agente-midia` (Gustavo Leal — opera Meta Ads), `agente-supervisor` (Ricardo Neves — direção).

Conclusão: o portador natural de uma camada financeira já existe **como cartão** (`financeiro`) e não existe como agente. Isso é bom — nasce sem legado de comportamento.

### 0.6 Comportamento financeiro legado (o que já mexe com dinheiro hoje)

Isto é o que impede copiar playbook cegamente:

| Objeto legado | O que faz | Consequência para a triagem |
|---|---|---|
| `fn_emitir_operacao_financeira` / `fn_consumir_operacao_financeira` / `fn_finalizar_operacao_financeira` + tabela `operacoes_financeiras` (1.018 linhas, 26/07–06/09/2026) | Emite e consome cobrança Pix com TTL, revogação e reconciliação | Efeito externo real. **Nenhuma skill nova pode encostar nisso na fase 1.** |
| `fn_guardrail_financeiro` | Guardrail financeiro tipado no fluxo de Pix | Frente P1 `guardrail-financeiro-joao` em andamento |
| `fn_replay_prova_financeira` | Prova de replay já existente no eixo financeiro | Infra de prova financeira já nasceu; reusar, não recriar |
| `fn_precificar_dtf_uv` / `_v2`, `fn_julia_tabela_precos_dtf`, `fn_precos_verbalizaveis_uv`, `calcula_margem_dinamica`, `calcular_precificacao_*` | Motor de preço e margem dinâmica em produção | É o `pricing_calculation` da taxonomia. Qualquer "análise de margem" nova **duplica** se não for auditada contra isso primeiro |
| `fn_calcular_custo_ficha`, `fn_custo_proposta_item` | Custo por ficha técnica (ERP) | Fonte de custo real — e é onde o GAP R68 mora |
| `get_planejamento_financeiro_view`, `atualizar_movimentacoes_financeiras`, `atualizar_margem_real_planejamento` | Visões de planejamento financeiro legado | **Não auditadas nesta rodada** — entram como `PRECISA_AUDITORIA_DE_LEGADO` |
| `previsao_receita_mensal` (1 linha) | Ledger de previsão com `metodologia`, `metodologia_versao`, `previsto_receita`, `realizado_receita`, `erro_absoluto`, `erro_percentual`, `persistida_antes_do_mes` | **Já é um contrato de previsão-vs-realizado.** Uma skill de forecast/BvA precisa escrever nele, não ao lado dele |
| `midia_investimento_mensal` (4 linhas) | `gasto_real`, `pct_teste`, `orcamento_teste` por mês | Orçado-vs-realizado de mídia em miniatura, já existente |
| `frente_economia` (10 linhas) | Contrato econômico das frentes: `territorio`, `metrica`, `direcao`, `valor`, `unidade`, `horizonte`, `confianca`, `evidencia_tipo`, `valido_ate` | **Este é o vocabulário econômico canônico do Córtex.** Saída financeira deve falar essa língua (`BRL`, `D30`, `QUERY_MEDIDA`, `MARGEM`, `RECEITA_EM_RISCO`), não inventar outra |
| Frente `teto-financeiro-acumulado` (bloqueada, P3) | *"O teto de R$100/dia do Gustavo é decorativo — nada lê `limite_financeiro_dia`"* | Prova documentada de que declarar limite financeiro sem leitor não produz controle |

### 0.7 Frentes reais com eixo financeiro (abertas)

| Frente | Prioridade | Estado | Eixo |
|---|---|---|---|
| `joao-parametro-financeiro-sem-proveniencia` | 1 | em_andamento | Parâmetro financeiro inventado vira verdade e contamina preço |
| `joao-preco-guarda-cega-produto` | 1 | aberta | Guarda de preço cega a produto |
| `guardrail-financeiro-joao` | 1 | em_andamento | Guardrail tipado no fluxo de Pix |
| `joao-dtf-textil-recalculo-rendimento-quantidade` | 1 | aberta | Preço/rendimento não recalculado |
| `julia-pagamento-grounded` | 1 | em_andamento | Porta de saída grounded para fatos de pagamento |
| `joao-dtf-uv-cartela-folha-semantica` | 2 | aberta | Semântica de unidade x preço canônico |
| `custo-observavel-por-agente-e-por-frente` | 2 | em_andamento | 2 de 23 agentes têm telemetria de custo; nenhuma frente tem custo |
| `teto-financeiro-acumulado` | 3 | bloqueada | Teto de gasto decorativo |
| `contas-grandes-encolhidas` | — | — | R$ 23.204,88 de receita em risco medido + R$ 19.828 estimado (D30) |
| `taxonomia-produto` | — | — | R$ 38.231,32 de margem potencial em risco (D30) |

Leitura importante: **todas as frentes P1 financeiras são de *preço e proveniência*, não de gestão de caixa.** A dor provada hoje é "o número que o agente fala está certo?" — não "quanto caixa eu tenho em 13 semanas". Isso não invalida a camada de caixa; significa que ela não pode ser vendida como se estivesse resolvendo essas frentes.

---

## 1. Inventário — capacidades financeiras do repositório

Legenda: **D** = determinística (mesmo input ⇒ mesmo output), **I** = interpretativa (depende de julgamento/benchmark).

### 1.1 `finance/skills/financial-analyst` (4 ferramentas Python, stdlib apenas)

| # | Capacidade | Propósito | Inputs | Outputs | Fórmula/cálculo | Dependências | D/I | NO_EFFECT? | Recomenda ou decide? |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | `ratio_calculator` — rentabilidade | ROE, ROA, margem bruta/operacional/líquida | `income_statement` (revenue, COGS, operating_income, ebitda, net_income), `balance_sheet` (total_equity, total_assets) | ratios + interpretação textual | `net_income/equity`, `net_income/assets`, `(rev-cogs)/rev` | DRE + balanço | D (cálculo) + I (interpretação/benchmark) | Sim | Recomenda |
| 1.2 | `ratio_calculator` — liquidez | Corrente, seca, caixa | `current_assets`, `inventory`, `cash`, `current_liabilities` | 3 índices + leitura | `CA/CL`, `(CA-Inv)/CL`, `Cash/CL` | Balanço | D | Sim | Recomenda |
| 1.3 | `ratio_calculator` — alavancagem | D/E, cobertura de juros, DSCR | `total_debt`, `total_equity`, `operating_income`, `interest_expense`, `total_debt_service`, `operating_cash_flow` | 3 índices | `D/E`, `EBIT/juros`, `OCF/serviço da dívida` | Balanço + DRE + dívida | D | Sim | Recomenda |
| 1.4 | `ratio_calculator` — eficiência | Giro de ativo/estoque/recebíveis, DSO | `revenue`, `cogs`, `inventory`, `accounts_receivable`, `total_assets` | 4 métricas | `rev/ativos`, `cogs/estoque`, `rev/AR`, `AR/rev*365` | Balanço + DRE | D | Sim | Recomenda |
| 1.5 | `ratio_calculator` — valuation | P/E, P/B, P/S, EV/EBITDA, PEG | `market_data` (share_price, shares_outstanding, market_cap) | múltiplos | múltiplos de mercado | Preço de ação | D | Sim | Recomenda |
| 1.6 | `dcf_valuation` | Valuation por fluxo descontado | `historical.revenue/net_income`, `assumptions` (growth, fcf_margin, terminal_growth, WACC inputs: rf, ERP, beta, Kd, tax, pesos) | EV, equity value, sensibilidade 2D | WACC por CAPM; `Σ FCF_t/(1+r)^t`; TV por Gordon ou múltiplo de saída | Projeções + premissas de mercado | D dado o input, **I na origem do input** (beta, ERP, growth são arbitrados) | Sim | Recomenda |
| 1.7 | `budget_variance_analyzer` | Realizado vs orçado vs ano anterior | `line_items[]` (name, type revenue/expense, department, category, actual, budget, prior_year) | variações $ e %, classificação favorável/desfavorável, sumário executivo | `actual-budget`; `var/budget`; materialidade default 10% ou $50K; lógica de sinal invertida para despesa | Orçamento estruturado por linha | D | Sim | Recomenda |
| 1.8 | `forecast_builder` — receita por driver | Projeção de receita dirigida por drivers | `historical_periods[]`, `drivers` (units.base_units, growth_rate; pricing.base_price, annual_increase), `assumptions` | receita projetada por período | volume × preço com crescimento composto | Série histórica + drivers | D | Sim | Recomenda |
| 1.9 | `forecast_builder` — caixa 13 semanas | Projeção rolante de caixa | `cash_flow_inputs`: `opening_cash_balance`, `weekly_revenue`, `collection_rate` (0.85 default), `collection_lag_weeks` (2), `weekly_payroll/rent/operating/other`, `one_time_items[]` | 13 semanas com entradas, saídas, saldo, saldo mínimo e semana, runway em semanas | Entrada = receita defasada × taxa de cobrança; saldo acumulado | Saldo inicial + receita semanal média | D | Sim | Recomenda |
| 1.10 | `forecast_builder` — cenários | base/bull/bear | multiplicadores sobre o base | comparação de cenários | escala paramétrica | 1.8/1.9 | D | Sim | Recomenda |
| 1.11 | `forecast_builder` — tendência | Regressão linear simples sobre histórico | `historical_periods[]` | slope, projeção | mínimos quadrados (stdlib) | Série histórica | D | Sim | Recomenda |

**Observação técnica que muda a decisão (1.9):** o modelo de 13 semanas do repositório assume **receita semanal constante e cobrança por taxa média com defasagem fixa**. A Skillprint tem título com vencimento datado (`contas_receber.data_vencimento`, `parcela_atual`, `total_parcelas`). Copiar o algoritmo seria trocar dado exato por média. **A metodologia serve; a implementação não.**

### 1.2 `finance/business-investment-advisor`

Sem scripts — é framework puro (SKILL.md).

| # | Capacidade | Propósito | Inputs | Outputs | Fórmula | D/I | NO_EFFECT? | Recomenda ou decide? |
|---|---|---|---|---|---|---|---|---|
| 2.1 | ROI | Retorno simples | custo total, ganho/economia no período | % | `(ganho líquido / custo) × 100` | D | Sim | Recomenda |
| 2.2 | Payback | Tempo de retorno | investimento, fluxo anual líquido | anos | `investimento / fluxo anual` (alvo <3 anos) | D | Sim | Recomenda |
| 2.3 | NPV | Valor criado | fluxos por período, custo de capital `r` | R$ | `Σ CF_t/(1+r)^t − I₀` | D (dado `r`) | Sim | Recomenda |
| 2.4 | IRR | Taxa implícita | fluxos | % | `r` tal que NPV=0; compara com hurdle (10–15% estável / 20–25% crescimento / 30%+ risco) | D | Sim | Recomenda |
| 2.5 | Custo de oportunidade | Comparar contra alternativa | IRR do projeto, taxa da dívida | comparação | *"incluir quitar dívida como alternativa — retorno garantido = sua taxa de juros"* | D | Sim | Recomenda |
| 2.6 | Comparação/ranking sob orçamento | Alocar capital limitado | lista de opções + orçamento | ordem de prioridade | ranking por retorno ajustado | D no cálculo, I no peso | Sim | Recomenda |
| 2.7 | Build vs Buy / Lease vs Buy / Hire vs Automate | Frameworks de trade-off | matriz qualitativa + TCO | matriz + recomendação | TCO no mesmo horizonte; regra "compre se o fornecedor entrega ≥80% a <50% do custo" | **I** | Sim | Recomenda |
| 2.8 | Rubrica de score 1–5 | ROI, payback, aderência estratégica, risco, reversibilidade, impacto no caixa | julgamento | score | pesos subjetivos | **I** | Sim | Recomenda |

**Nota:** 2.5 é exatamente a decisão "pagar dívida ou manter caixa" da lista da Skillprint — e é determinística.

### 1.3 `c-level-advisor/skills/cfo-advisor` (3 scripts)

| # | Capacidade | Propósito | Inputs | Outputs | Fórmula | D/I | NO_EFFECT? |
|---|---|---|---|---|---|---|---|
| 3.1 | `burn_rate_calculator` | Runway com plano de contratação e cenários | saldo, burn bruto/líquido, plano de headcount | meses de runway, data de caixa zero, burn multiple | `saldo/burn líquido`; `burn multiple = burn líquido / novo ARR líquido` | D | Sim |
| 3.2 | `unit_economics_analyzer` | LTV por coorte, CAC por canal, payback | ARPA, margem bruta, churn mensal, CAC por canal | LTV, LTV:CAC, payback, rating | `LTV = ARPA × MB% / churn`; `payback = CAC / (ARPA × MB%)` | D | Sim |
| 3.3 | `fundraising_model` | Diluição, cap table, rodadas | cap table, rodadas | diluição, exit analysis | pró-rata societário | D | Sim |
| 3.4 | Gestão de caixa (`references/cash_management.md`) | Tesouraria, otimização de AR/AP, extensão de runway, cortar vs investir | — | frameworks | — | I | Sim |
| 3.5 | Board pack / BvA | Pacote financeiro de conselho | — | template | — | I | Sim |

### 1.4 `finance/skills/saas-metrics-coach` (3 scripts)

ARR, MRR, churn logo/receita, CAC, LTV, NRR, Quick Ratio (`(novo+expansão)/(churn+contração)`), projeção 12 meses. Modelo de assinatura recorrente.

### 1.5 `finance/skills/stock-analysis` (não pedido, encontrado)

21 referências + rubrica de score, red flags forenses, modos IPO/forense, 25 arquivos setoriais, scripts `ratios.py`/`valuation.py`/`score.py`. Análise de ação listada em bolsa.

---

## 2. Cruzamento com o Córtex + 3. Classificação

Nenhuma equivalência foi assumida por semelhança de nome; cada linha foi verificada contra `skill_contract_versions`, `product_skill_taxonomy_entries` (v5), `capacidade_vocabulario`, `capacidade_registro`, `operator_action_registry`, `agentes`, `standard_agent_card_versions`, `frentes` e as funções `pg_proc` do schema `public`.

| Capacidade do repositório | SkillContract equiv.? | Capability equiv.? | Action equiv.? | Previsto na taxonomia v5? | Legado financeiro? | Frente real? | Classificação |
|---|---|---|---|---|---|---|---|
| 1.1 Rentabilidade / margem | Não | **Sim — `MEDIR_CUSTO_MARGEM_POR_PEDIDO`** (declarada, sem executor) | Não | Parcial (`pricing_calculation` é preço, não margem) | **Sim** — `calcula_margem_dinamica`, `fn_calcular_custo_ficha`, `atualizar_margem_real_planejamento`, `vw_margem_por_produto` | `taxonomia-produto` (R$38.231 em risco), GAP R68 | **PRECISA_AUDITORIA_DE_LEGADO** → depois **NOVO_SKILLCONTRACT_CANDIDATO ligado à capability já existente** |
| 1.2 Liquidez | Não | Não | Não | Não | Não | Não | **NOVO_SKILLCONTRACT_CANDIDATO (bloqueado por dado — sem balanço)** |
| 1.3 Alavancagem / cobertura de juros | Não | Não | Não | Não | Não | Não | **NOVO_SKILLCONTRACT_CANDIDATO (bloqueado por dado — não existe cadastro de dívida em nenhuma base)** |
| 1.4 Eficiência / DSO / giro | Não | Não | Não | Não | Parcial (`contas_receber` tem emissão, vencimento e recebimento) | Não | **NOVO_SKILLCONTRACT_CANDIDATO** |
| 1.5 Múltiplos de valuation | Não | Não | Não | Não | Não | Não | **FORA_DE_ESCOPO** (empresa fechada, sem preço de ação) |
| 1.6 DCF | Não | Não | Não | Não | Não | Não | **FORA_DE_ESCOPO** (o próprio handoff coloca valuation abaixo das decisões de caixa) |
| 1.7 Orçado vs realizado | Não | Não | Não | Não | **Sim** — `previsao_receita_mensal` (com `erro_percentual` e `persistida_antes_do_mes`), `midia_investimento_mensal`, `metas_crescimento`, `meta_comercial` | `metas-sem-formula` (85 unidades sem fórmula) | **PRECISA_AUDITORIA_DE_LEGADO** → depois **NOVO_SKILLCONTRACT_CANDIDATO** |
| 1.8 Forecast de receita por driver | Não | Não | Não | Não | **Sim** — `previsao_receita_mensal.metodologia/metodologia_versao` | `metas-sem-formula` | **PRECISA_AUDITORIA_DE_LEGADO** (risco alto de duplicar metodologia existente) |
| 1.9 Fluxo de caixa 13 semanas | Não | Não | Não | Não | Parcial (`get_planejamento_financeiro_view`, não auditada) | Não | **NOVO_SKILLCONTRACT_CANDIDATO** — metodologia aproveitada, **algoritmo NÃO** (ver §1.1) |
| 1.10 Cenários base/bull/bear | **Sim, parcialmente — `scientific_method`** (hipótese/teste) | Não | `agent.analysis.test_hypothesis` | Sim (`GOVERNANCE_ANALYSIS`) | Não | Não | **ABSORVER_COMO_CONHECIMENTO_DE_OUTRA_SKILL** (`scientific_method`) |
| 1.11 Regressão / tendência | **Sim — `data_analysis`** (contrato v1, 5 provas PASS) | Não | Não | Sim | Não | Não | **REUTILIZAR_CONTRATO_EXISTENTE** |
| 2.1–2.4 ROI / payback / NPV / IRR | Não | Não | Não | Não | Não | `custo-observavel-por-agente-e-por-frente`; `frente_economia` já usa BRL/D30 | **NOVO_SKILLCONTRACT_CANDIDATO** |
| 2.5 Custo de oportunidade (quitar dívida como alternativa) | Não | Não | Não | Não | Não | Não | **NOVO_SKILLCONTRACT_CANDIDATO** (dentro de ROI/alocação; é a decisão "pagar dívida ou manter caixa") |
| 2.6 Ranking sob orçamento | Não | Não | Não | Não | Parcial (`midia_investimento_mensal.orcamento_teste`) | `teto-financeiro-acumulado` (bloqueada) | **NOVO_SKILLCONTRACT_CANDIDATO** |
| 2.7 Build/Buy, Lease/Buy, Hire/Automate | Não | Não | Não | Não | Não | Não | **ABSORVER_COMO_CONHECIMENTO_DE_OUTRA_SKILL** (base de conhecimento da skill de alocação; interpretativo, não vira contrato) |
| 2.8 Rubrica de score 1–5 | Não | Não | Não | Não | Não | Não | **ABSORVER_COMO_CONHECIMENTO** — e **fora do cálculo determinístico** (pesos subjetivos não podem entrar em `resolution_hash`) |
| 3.1 Burn rate / runway | Não | Não | Não | Não | Não | Não | **ABSORVER** no candidato de caixa (§4.1) — bloqueado: **não existe saldo bancário no sistema** |
| 3.2 Unit economics LTV/CAC | Não | Parcial (`MEDIR_CUSTO_MARGEM_POR_PEDIDO` cobre margem, não CAC) | Não | Não | **Sim** — `vw_cac_por_segmento`, `vw_margem_por_produto.ltv_contribuicao_por_cliente`, agente `agente-insights` (Diego Alves) | — | **PRECISA_AUDITORIA_DE_LEGADO** (alto risco de duplicar o Diego) |
| 3.3 Fundraising / cap table / diluição | Não | Não | Não | Não | Não | Não | **FORA_DE_ESCOPO** |
| 3.4 Gestão de caixa / otimização AR-AP / capital de giro | Não | Não | Não | Não | Não | Não | **NOVO_SKILLCONTRACT_CANDIDATO** |
| 3.5 Board pack / BvA de conselho | Não | Não | Não | Não | Não | Não | **FORA_DE_ESCOPO** |
| 1.4 (saas) ARR/MRR/churn/NRR/Quick Ratio | Parcial — retenção já é `winback_eligibility` + `winback_recovery` (contratos provados) | `DETECTAR_CLIENTE_FORA_DO_CICLO`, `MEDIR_RESULTADO_REATIVACAO` | `agent.sales.assess_recovery` | Sim (`COMMERCIAL`) | Sim (`vw_cliente_frequencia_status`, `churn_recovery`) | `contas-grandes-encolhidas` (R$23.204,88 medidos) | **FORA_DE_ESCOPO** para ARR/MRR/Quick Ratio (não há assinatura). **Exceção: o conceito de NRR aplicado à carteira recorrente = `ABSORVER_COMO_CONHECIMENTO` de `winback_eligibility`** — a frente `contas-grandes-encolhidas` é, em substância, um problema de NRR |
| 1.5 (stock-analysis) | Não | Não | Não | Não | Não | Não | **FORA_DE_ESCOPO** |

### Resumo da classificação

| Classificação | Nº | Itens |
|---|---|---|
| `NOVO_SKILLCONTRACT_CANDIDATO` | 8 | 1.2, 1.3, 1.4, 1.9, 2.1–2.4, 2.5, 2.6, 3.4 |
| `PRECISA_AUDITORIA_DE_LEGADO` | 4 | 1.1, 1.7, 1.8, 3.2 |
| `ABSORVER_COMO_CONHECIMENTO` | 4 | 1.10, 2.7, 2.8, NRR-na-carteira |
| `REUTILIZAR_CONTRATO_EXISTENTE` | 1 | 1.11 (`data_analysis`) |
| `FORA_DE_ESCOPO` | 5 | 1.5, 1.6, 3.3, 3.5, saas-metrics-coach, stock-analysis |
| `DUPLICADA` | 0 | Nenhuma capacidade do repositório é duplicata literal de contrato existente — as sobreposições são com **legado não contratado**, por isso caem em auditoria |

---

## 4. Dado real disponível (inventário de fixtures candidatas)

Regra aplicada: **fixture congela a fonte antes da execução** e **saída histórica de agente não vira input de replay**.

| Fonte | Base | Volume | Janela | Qualidade | Serve de fixture para |
|---|---|---|---|---|---|
| `meta_ads_insights` | Córtex | 5.998 linhas; **R$ 216.199,35 de spend**, R$ 154.667,41 de purchase_value, 18.058 leads | 03/07/2023 → 04/09/2026 | **Alta** — granularidade dia × campanha × anúncio, com spend, leads, purchases, ROAS | **ROI de investimento, alocação de capital, orçado-vs-realizado de mídia** |
| `vw_margem_por_produto` | Córtex | 4 produtos; R$ 343.389 de receita; margem 46,7–86,6% em DTF | acumulado | **Média** — `custo_metro` NULL em `vestuario_personalizado` (172 compras, R$154.961) e `objeto_personalizado`: é o GAP R68 visível | **Margem real / integridade de margem** |
| `calcme_pedidos` | Córtex | 3.730 pedidos, **R$ 1.885.528,94** | 01/02/2024 → 31/12/2024 | **Média** — colunas texto com decimal BR (`442,34`), datas `dd/mm/aaaa`; tem `Boleto`, `Contas`, `Nota_Fiscal`, `Data_Entrega` em 100% das linhas | **Sazonalidade de entrada de caixa, padrão de recebimento** (histórico 2024, não corrente) |
| `contas_receber` | ERP | 22 títulos — 15 pendentes (R$ 11.583,59, 6 parcelados), 6 recebidos (R$ 3.354,48), 1 cancelado | venc. 06/05/2026 → 04/11/2026 | **Baixa em volume, alta em estrutura** — tem `data_emissao`, `data_vencimento`, `data_recebimento`, `parcela_atual`, `total_parcelas`, `juros_mensal`, `multa` | **Fluxo de caixa por vencimento, DSO, capital de giro** |
| `contas_pagar` | ERP | **3 títulos, R$ 47,84 no total** | venc. 03/09 → 15/10/2026 | **Insuficiente** — schema completo (parcelas, juros, DRE, centro de custo), base vazia | Nada hoje. **Bloqueio nº 1 do fluxo de caixa** |
| `vendas` | ERP | 19 vendas, R$ 16.360,40; custo em 16; margem média 38,2%; 6 parceladas | 06/05 → 05/09/2026 | Média | Margem por venda, impacto de parcelamento |
| `financeiro_lancamentos` | ERP | 8 | 26/08 → 05/09/2026 | Insuficiente | — |
| `extrato_bancario` / `financeiro_contas_bancarias` | ERP | **0 / 0** | — | **Ausente** | **Bloqueio nº 2: não existe saldo de caixa no sistema** |
| `compras` | ERP | **0** (schema tem `moeda`, `taxa_cambio`, `valor_total_nacionalizado`, `parcelas`) | — | Ausente | Decisão de importação/crédito — **sem dado** |
| Empréstimos / financiamentos / dívida | — | **Não existe tabela em nenhuma das 4 bases** | — | **Ausente** | **Bloqueio nº 3: `debt_analysis` não tem fonte** |
| `ai_usage_ledger` | Córtex | 21.783 chamadas, **US$ 136,90** | 19/08 → 06/09/2026 | Alta | Despesa operacional de IA — insumo de custo por frente |
| `previsao_receita_mensal` | Córtex | 1 linha, com previsto/realizado/erro | — | Estrutura ótima, volume mínimo | **Orçado-vs-realizado — reusar o ledger, não recriar** |
| `midia_investimento_mensal` | Córtex | 4 meses (`gasto_real`, `orcamento_teste`) | — | Média | Orçado-vs-realizado de mídia |
| `frente_economia` | Córtex | 10 linhas em BRL/PCT/EVENTOS com `confianca` e `evidencia_tipo` | — | Alta | **Formato de saída** de qualquer skill financeira |
| `operacoes_financeiras` | Córtex | 1.018 (R$ 206.168,84 em `produto/ativa`) | 26/07 → 06/09/2026 | Alta — **mas é saída de agente** | ❌ **Não usar como input de replay.** Serve como evidência de efeito, não como fonte congelada |

**Três bloqueios de dado, nomeados:**
1. **Sem contas a pagar reais** (3 títulos, R$ 47,84) → projeção de saída de caixa não é calculável a partir do ERP hoje.
2. **Sem saldo bancário** (`extrato_bancario` e `financeiro_contas_bancarias` vazias) → `opening_cash_balance` e runway precisam de valor humano declarado e congelado na fixture.
3. **Sem cadastro de dívida** em nenhuma base → alavancagem, cobertura de juros, troca de dívida cara por barata e "pagar dívida vs manter caixa" não têm fonte automatizável.

Nenhum dos três se resolve criando skill. Todos se resolvem com **fonte congelada** — que é exatamente o que uma fixture é.

---

## 5. Tabela de entrega

| Skill/capacidade | Existe no Córtex? | Dado real disponível? | Valor para Skillprint | Risco | Recomendação |
|---|---|---|---|---|---|
| Fluxo de caixa por vencimento (13 semanas) | Não (nem contrato, nem capability, nem action, nem taxonomia) | **Parcial** — AR estruturado (22 títulos, parcelas, vencimento); AP vazio; **sem saldo inicial** | **Alto** — "prever caixa futuro" e "quanto caixa manter" | **Médio** — decisão de caixa sobre base incompleta induz erro; algoritmo do repo (receita média) esconde o dado exato | **NOVO_SKILLCONTRACT_CANDIDATO** — nº 1, com saldo inicial e AP como entrada humana congelada |
| Margem real por pedido/produto | **Capability sim** (`MEDIR_CUSTO_MARGEM_POR_PEDIDO`), **sem executor e sem contrato** | **Sim** — `vw_margem_por_produto` + `vendas.custo_total` (16/19) + `fn_calcular_custo_ficha`; buraco conhecido no vestuário | **Alto** — precondição de todo o resto; R$ 38.231 de margem em risco medidos | **Alto de duplicação** — motor de preço/margem legado em produção | **PRECISA_AUDITORIA_DE_LEGADO primeiro** → depois contrato ligado à capability existente |
| Capital de giro / ciclo de caixa (DSO, DPO, DIO) | Não | **Parcial** — DSO calculável (emissão/vencimento/recebimento); DPO sem base; DIO com estoque quase vazio | **Alto** — "avaliar capital de giro", "impacto de parcelas" | Baixo (NO_EFFECT puro, só leitura) | **NOVO_SKILLCONTRACT_CANDIDATO** |
| ROI de investimento (ROI/payback/NPV/IRR) | Não | **Sim, forte** — 3 anos de `meta_ads_insights` (R$216k spend × R$154k receita atribuída) | **Alto** — "máquina, mídia ou estoque", "comparar ROI" | Baixo em cálculo; médio em atribuição de receita | **NOVO_SKILLCONTRACT_CANDIDATO** |
| Alocação de capital (ranking sob orçamento) | Não | Parcial — mídia sim; máquina/estoque exigem entrada humana | **Alto** — é a decisão que o dono toma | **Médio** — rubrica subjetiva contaminando cálculo determinístico | **NOVO_SKILLCONTRACT_CANDIDATO** com rubrica **fora** do hash |
| Orçado vs realizado | Não como contrato; **sim como legado** (`previsao_receita_mensal`, `midia_investimento_mensal`, `metas_crescimento`) | Parcial | **Médio-alto** | **Alto de duplicação** — metodologia de previsão já versionada no legado | **PRECISA_AUDITORIA_DE_LEGADO** → depois contrato |
| Saúde financeira (liquidez, alavancagem, cobertura) | Não | **Não** — sem balanço, sem dívida, sem saldo | Médio (viraria alto com os dados) | Alto — índice calculado sobre input inventado é pior que índice nenhum (cf. frente `joao-parametro-financeiro-sem-proveniencia`) | **NOVO_SKILLCONTRACT_CANDIDATO — adiado até existir fonte** |
| Análise de dívida | Não | **Não** — zero tabelas de empréstimo/financiamento | **Alto na decisão**, zero em dado | Alto | **Adiar a skill; criar antes a fonte congelada de dívida** |
| Unit economics (LTV/CAC) | Parcial — `vw_cac_por_segmento`, `ltv_contribuicao_por_cliente`, agente Diego Alves | Sim | Médio | **Alto de duplicação com agente vivo** | **PRECISA_AUDITORIA_DE_LEGADO** |
| Cenários base/bull/bear | **Sim** — `scientific_method` (contrato + 4 provas PASS) | Sim | Médio | Baixo | **ABSORVER_COMO_CONHECIMENTO** |
| Tendência/regressão | **Sim** — `data_analysis` (contrato + 5 provas PASS) | Sim | Médio | Baixo | **REUTILIZAR_CONTRATO_EXISTENTE** |
| DCF / valuation / múltiplos | Não | Não | **Baixo agora** | — | **FORA_DE_ESCOPO** |
| Fundraising / cap table / board pack | Não | Não | Baixo | — | **FORA_DE_ESCOPO** |
| ARR/MRR/churn/NRR/Quick Ratio | Retenção já contratada (`winback_*`) | Não há assinatura | Baixo (exceto NRR na carteira) | Alto de duplicação com `winback_eligibility` | **FORA_DE_ESCOPO**, exceto NRR-na-carteira → **ABSORVER** |
| Stock analysis (forense/IPO/setorial) | Não | Não | Nenhum | — | **FORA_DE_ESCOPO** |

---

## 6. TOP 6 FINANCE SKILLS (shortlist)

Seis recomendadas para a fila, em ordem de execução. Duas adicionais ficam **explicitamente adiadas** (§6.7) — somam 8 avaliadas, dentro do teto pedido.

Convenção de nomes seguindo o vocabulário real do Córtex (`skill_ref` em snake_case inglês, como `data_analysis`/`five_w_two_h`; actions em `agent.<dominio>.<verbo>`; saída econômica no vocabulário de `frente_economia`).

---

### 6.1 `unit_margin_integrity` — margem real por pedido *(faça esta primeiro)*

- **Problema que resolve:** hoje o Córtex sabe que a margem é 46,7–86,6% em DTF e **não sabe nada** sobre `vestuario_personalizado` (172 compras, R$ 154.961 de receita, `custo_metro` NULL). Enquanto isso, todo candidato econômico do território CLIENTE fica com custo "NÃO ESTIMÁVEL" (GAP R68 registrado no próprio vocabulário). Sem margem confiável, ROI, alocação e caixa herdam o erro.
- **Dados necessários:** `vw_margem_por_produto`; ERP `vendas` (`total_liquido`, `custo_total`, `margem_percentual` — 16 de 19 preenchidos), `fn_calcular_custo_ficha`, `produto_insumos`, `produto_processos`; congelamento por janela.
- **Cálculo/metodologia:** margem de contribuição por pedido = receita líquida − (insumos + processos + frete + taxa de pagamento); ponte com `vw_margem_por_produto`; classificação explícita de "custo não estimável" em vez de imputação. Determinístico. **A interpretação/benchmark do `ratio_calculator` (rentabilidade) entra como conhecimento, não como cálculo.**
- **Agente que poderia carregar:** cartão-padrão `financeiro` (`MANAGEMENT_GOVERNANCE`), em composição com `data_analysis`.
- **Action/capability provável:** **capability já existe** — `MEDIR_CUSTO_MARGEM_POR_PEDIDO`. Action nova sugerida: `agent.finance.measure_unit_margin`, `authority_domain = agent_runtime`, TTL 300s.
- **Pode começar NO_EFFECT?** **Sim** — leitura pura, saída em relatório.
- **Frentes que poderia absorver:** `taxonomia-produto` (R$ 38.231,32 de margem potencial em risco/D30); alimenta `contas-grandes-encolhidas`; fecha o GAP R68 que trava o território CLIENTE.
- **Pré-condição obrigatória:** auditoria do legado (`calcula_margem_dinamica`, `atualizar_margem_real_planejamento`, `get_planejamento_financeiro_view`, motor `fn_precificar_dtf_uv*`) — **se o cálculo já existir lá, isto vira executor da capability, não skill nova.**

---

### 6.2 `cash_position_forecast` — caixa por vencimento (13 semanas)

- **Problema que resolve:** "prever caixa futuro" e "quanto caixa manter". Hoje não existe nenhuma projeção de caixa no sistema.
- **Dados necessários:** `contas_receber` (22 títulos, vencimento até 04/11/2026, 6 parcelados) + `contas_pagar` + saldo inicial. **Os dois últimos não existem em volume utilizável** → entram como **entrada humana congelada na fixture**, com proveniência declarada (a frente `joao-parametro-financeiro-sem-proveniencia` é exatamente o pecado a não repetir).
- **Cálculo/metodologia:** projeção semanal **dirigida por vencimento**, não por receita média — `saldo_t = saldo_{t-1} + Σ recebíveis com vencimento na semana × taxa histórica de pontualidade − Σ pagáveis com vencimento na semana`; saldo mínimo, semana do vale, semanas de runway. Taxa de pontualidade estimável de `calcme_pedidos` (2024) e de `contas_receber.data_recebimento` vs `data_vencimento`. **A metodologia das 13 semanas do repositório é aproveitada; o algoritmo de receita constante × `collection_rate` fixo é rejeitado** (troca dado exato por média).
- **Agente:** cartão `financeiro`.
- **Action/capability provável:** `agent.finance.forecast_cash_position` / capability nova `PROJETAR_CAIXA_POR_VENCIMENTO`, `authority_domain = agent_runtime`, TTL 900s.
- **Pode começar NO_EFFECT?** **Sim** — e deve. Nenhum pagamento, nenhuma escrita no ERP.
- **Frentes que poderia absorver:** nenhuma frente aberta hoje. **Isto é honestidade, não demérito:** é capacidade nova para uma decisão que hoje não tem instrumento. Deve nascer justificada pela decisão do dono, não por frente existente.

---

### 6.3 `working_capital_analysis` — ciclo de caixa e capital de giro

- **Problema que resolve:** "avaliar capital de giro" e "entender impacto de parcelas e financiamento no caixa". 6 de 22 títulos a receber e 6 de 19 vendas são parcelados — o parcelamento já está deslocando caixa e ninguém mede.
- **Dados necessários:** `contas_receber` (emissão/vencimento/recebimento, `parcela_atual`, `total_parcelas`, `juros_mensal`), `vendas.quantidade_parcelas`, `taxas_cartao` (schema pronto, sem dados), `movimentacoes_estoque`/`insumos` (quase vazios), `contas_pagar` (vazio → entrada congelada).
- **Cálculo/metodologia:** DSO = `Σ(data_recebimento − data_emissão) ponderado`; DPO análogo; DIO por giro de insumo; **ciclo de conversão de caixa = DSO + DIO − DPO**; necessidade de capital de giro = ciclo × custo diário. Determinístico. Eficiência/giro do `ratio_calculator` (1.4) e otimização AR/AP do `cfo-advisor` (3.4) entram como conhecimento.
- **Agente:** cartão `financeiro`; consumidor natural: `agente-supervisor` (direção).
- **Action/capability:** `agent.finance.analyze_working_capital` / `ANALISAR_CAPITAL_DE_GIRO`, `agent_runtime`, TTL 900s.
- **Pode começar NO_EFFECT?** **Sim.**
- **Frentes:** alimenta a decisão de crédito para importação (`compras` tem `moeda`/`taxa_cambio`/`valor_total_nacionalizado` e zero linhas — a skill mostra o custo de giro antes de a operação existir).

---

### 6.4 `investment_roi` — ROI, payback, NPV, IRR

- **Problema que resolve:** "decidir investimento em máquina, mídia ou estoque" e "comparar ROI entre alternativas".
- **Dados necessários:** **a fixture mais forte do inventário** — `meta_ads_insights`: 5.998 linhas, 03/07/2023→04/09/2026, R$ 216.199,35 de spend, R$ 154.667,41 de purchase_value, 18.058 leads, granularidade dia × campanha × anúncio. Para máquina/estoque: entrada humana congelada (custo, vida útil, ganho esperado, taxa de capital).
- **Cálculo/metodologia:** ROI = `ganho líquido/custo`; payback = `investimento/fluxo anual`; NPV = `Σ CF_t/(1+r)^t − I₀`; IRR = `r | NPV = 0`; comparação contra hurdle. **Custo de oportunidade obrigatório na saída, incluindo "quitar dívida" como alternativa de retorno garantido = taxa de juros** — é literalmente a decisão "pagar dívida ou manter caixa". Determinístico dado `r`; `r` é premissa declarada, nunca inferida.
- **Agente:** cartão `financeiro`; para mídia, composição com `agente-insights` (Diego Alves, já calcula CAC) — **auditar antes para não duplicar**.
- **Action/capability:** `agent.finance.evaluate_investment` / `AVALIAR_RETORNO_DE_INVESTIMENTO`, `agent_runtime`, TTL 300s.
- **Pode começar NO_EFFECT?** **Sim** — recomenda, não compra.
- **Frentes:** `custo-observavel-por-agente-e-por-frente` (P2, em andamento — 2 de 23 agentes com telemetria de custo, nenhuma frente com custo). Saída deve escrever no vocabulário de `frente_economia` (`territorio`, `metrica`, `valor`, `unidade=BRL`, `horizonte=D30`, `confianca`, `evidencia_tipo=QUERY_MEDIDA`).

---

### 6.5 `capital_allocation` — ranking de alternativas sob orçamento

- **Problema que resolve:** o dono não decide um investimento isolado; decide **onde põe o próximo real** entre máquina, mídia, estoque e dívida.
- **Dados necessários:** saída de 6.4 para cada alternativa + orçamento disponível (entrada humana congelada) + `midia_investimento_mensal.orcamento_teste`.
- **Cálculo/metodologia:** ordenação por NPV por real investido e por IRR contra hurdle, com restrição de orçamento e de caixa mínimo (vindo de 6.2). Frameworks Build vs Buy / Lease vs Buy / Hire vs Automate e a rubrica 1–5 entram **como conhecimento consultivo, explicitamente fora do cálculo determinístico** — pesos subjetivos não podem entrar em `resolution_hash`, sob pena de a prova de replay ficar irreprodutível.
- **Agente:** cartão `financeiro` + `agente-supervisor`.
- **Action/capability:** `agent.finance.rank_capital_allocation` / `ALOCAR_CAPITAL_ENTRE_ALTERNATIVAS`, `agent_runtime`, TTL 900s.
- **Pode começar NO_EFFECT?** **Sim.**
- **Frentes:** `teto-financeiro-acumulado` (bloqueada, P3) — a frente registra que *"o teto de R$100/dia do Gustavo é decorativo — nada lê `limite_financeiro_dia`"*. Esta skill é candidata natural a **leitora** desse limite, o que destrava a frente **sem** precisar de ação financeira executiva.

---

### 6.6 `budget_vs_actual` — orçado vs realizado

- **Problema que resolve:** "medir margem real" no nível de empresa e fechar o loop de meta: hoje `previsao_receita_mensal` tem **uma** linha e `metas-sem-formula` registra 85 unidades sem fórmula.
- **Dados necessários:** `previsao_receita_mensal` (previsto/realizado/erro, com `persistida_antes_do_mes` — antifraude embutido), `midia_investimento_mensal` (4 meses), `metas_crescimento` (13), `meta_comercial` (6), realizado de `vendas`/`vw_margem_por_produto`.
- **Cálculo/metodologia:** variação absoluta e percentual, classificação favorável/desfavorável com sinal invertido para despesa, filtro de materialidade (o default do repo — 10% ou US$50K — **não serve**; a materialidade tem de ser calibrada para a escala Skillprint). Determinístico.
- **Agente:** cartão `financeiro`; consumidor `agente-supervisor`; compõe com `smart_goal` (contrato provado) para a meta e `five_w_two_h` para a explicação da variação.
- **Action/capability:** `agent.finance.compare_budget_actual` / `COMPARAR_ORCADO_REALIZADO`, `agent_runtime`, TTL 300s.
- **Pode começar NO_EFFECT?** **Sim.**
- **Frentes:** `metas-sem-formula` (85 unidades, `QUALIDADE_DO_DADO`/RISCO).
- **Pré-condição:** auditoria de `previsao_receita_mensal.metodologia_versao` — **a skill deve escrever nesse ledger, não criar um paralelo.**

---

### 6.7 Adiadas com motivo (não entram na fila agora)

| Candidata | Por que não agora | O que a destrava |
|---|---|---|
| `financial_health_snapshot` (liquidez, alavancagem, cobertura de juros) | Não existe balanço patrimonial, saldo bancário nem cadastro de dívida em nenhuma das 4 bases. Índice calculado sobre input inventado reproduz exatamente a frente P1 `joao-parametro-financeiro-sem-proveniencia` | Fonte de balanço/saldo com proveniência declarada |
| `debt_analysis` (dívida, troca de dívida cara por barata) | **Zero tabelas** de empréstimo/financiamento/parcela de dívida. É a decisão de maior valor declarado e a de menor dado disponível | Criar antes a **fonte congelada de dívida** (contratos, taxas, saldos, cronograma) — é cadastro, não skill. Enquanto isso, a comparação "quitar dívida vs investir" já é atendida por 6.4/6.5 como custo de oportunidade com taxa declarada |

---

## 7. Arquitetura proposta (proposta — nada criado)

### 7.1 Ordem de maturação

```
6.1 unit_margin_integrity   ──┐ (precondição de custo/margem)
                              ├─→ 6.4 investment_roi ──→ 6.5 capital_allocation
6.2 cash_position_forecast  ──┤                              ↑
6.3 working_capital_analysis──┘                              │
6.6 budget_vs_actual ────────────────────────────────────────┘
```

### 7.2 Regime de nascimento (idêntico ao das 13 provadas)

Todas as 6 nascem com `effect_zero = true` e `execution_mode` de sombra — o mesmo padrão das 117 provas PASS existentes:

| Elo | Proposta |
|---|---|
| SkillContract | 6 contratos, família nova `FINANCE_MANAGEMENT` (exige taxonomy v6 — **não feito nesta rodada**) |
| Capability | 1 reutilizada (`MEDIR_CUSTO_MARGEM_POR_PEDIDO`) + 5 novas |
| Action | 6 actions `agent.finance.*`, todas `authority_domain = agent_runtime`, TTL 300–900s — **nenhuma em domínio de pagamento, crédito ou escrita em ERP** |
| Agente | cartão-padrão `financeiro` (já existe, `MANAGEMENT_GOVERNANCE`), sem instância viva a criar nesta fase |
| Composição | com `data_analysis` (regressão), `scientific_method` (cenários), `smart_goal` (meta), `five_w_two_h` (explicação de variação) — todos com contrato e prova |
| Autoridade | somente leitura; nenhuma solicitação de `APROVAR_ACAO_DE_RISCO` na fase 1 |
| Fixture | fonte congelada **antes** da execução, com hash — `meta_ads_insights` (janela fechada), `vw_margem_por_produto`, `contas_receber`; entradas ausentes (saldo, AP, dívida) entram como valor humano declarado **dentro** da fixture, com proveniência |
| Shadow → replay → proof | `gate5b_*` + `gate5b_cognitive_replay_proof_versions`, mesmo formato das 12 skills provadas |
| Saída | no vocabulário de `frente_economia`: `territorio`, `metrica`, `direcao`, `valor`, `unidade`, `horizonte`, `confianca`, `evidencia_tipo`, `valido_ate` |

### 7.3 Regras de contenção

1. **Nenhuma skill financeira encosta em `fn_emitir_operacao_financeira`, `fn_consumir_operacao_financeira` ou `fn_guardrail_financeiro` na fase 1.** Essas funções têm efeito externo real (R$ 206.168,84 em operações ativas).
2. **`operacoes_financeiras` não é fixture.** É saída de agente; usar como input de replay violaria a regra do handoff.
3. **Rubricas e frameworks interpretativos ficam fora do cálculo hasheado.** Se entrarem, a prova de replay deixa de ser reproduzível.
4. **DCF, valuation, cap table, ARR/MRR e análise de ação não entram.** Nem como conhecimento auxiliar nesta fase.
5. **Auditoria de legado antes de contrato** para 6.1 e 6.6 — o motor de preço/margem e o ledger de previsão já existem em produção.

### 7.4 O que falta decidir (do dono, não da máquina)

1. Saldo de caixa e contas a pagar reais: entram no ERP, ou ficam como declaração congelada por rodada?
2. Cadastro de dívida: existe fonte fora do sistema (contratos em banco) que possa ser congelada?
3. Taxa de capital (`r`) e hurdle rate da Skillprint — premissa declarada, necessária para 6.4/6.5.
4. Materialidade de variação para 6.6 (o default do repositório, US$50K, é de outra escala).
5. Aprovar (ou não) a família de taxonomia `FINANCE_MANAGEMENT` na v6.

---

## 8. Nota de segurança (não relacionada à triagem)

O advisor do Supabase reportou, no projeto ERP (`ynjsflvdfftcopibzxyo`), **RLS desabilitado** em `public.backup_cliente_nomes_20260905` (146 linhas, snapshot de nomes de cliente de 05/09/2026) — exposta às roles `anon`/`authenticated`. Remediação sugerida pelo advisor:

```sql
ALTER TABLE public.backup_cliente_nomes_20260905 ENABLE ROW LEVEL SECURITY;
```

Não foi aplicada — habilitar RLS sem policies bloqueia todo acesso à tabela. Decisão do dono.
