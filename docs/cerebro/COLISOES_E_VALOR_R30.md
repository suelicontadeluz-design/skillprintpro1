# R30 — As 7 colisões de lead e a semântica final de valor

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero DDL, zero
INSERT/UPDATE/DELETE, zero deploy. `pixel_events.deal_id` continua inexistente.

## VEREDITO: `CANONICALIZACAO_PRONTA_PARA_IMPLEMENTAR`

Os sete casos **não precisam de escolha manual**: o próprio RD grava a identidade do cliente
dentro do `deal_nome`, no formato `Nome | Telefone`. Essa regra resolve **5 dos 7 com prova**, e
os outros 2 são **a mesma pessoa em dois leads duplicados** — o cliente é o mesmo, muda apenas
qual `lead_id` recebe a venda.

E a pendência de valor se dissolveu ao ser medida: **14 dos 16 deals não tiveram o valor
alterado — nasceram com valor zero e foram preenchidos depois.** Não há passado a reescrever.

---

## 1. OS 7 DEALS

| # | `deal_id` | valor | **nome no RD** | produtor A | produtor B |
|---|---|---|---|---|---|
| 1 | `69824985…89ae` | 119,80 | **João Galdino \| 5511971696998** | `rd_won` → **Juliana** `51992734297` | `uuid` → Joo Galdino `5511971696998` |
| 2 | `6989bb52…8834` | 59,90 | **João Galdino \| 5511971696998** | `rd_won` → **Juliana** `51992734297` | `uuid` → Joo Galdino `5511971696998` |
| 3 | `698a2008…7456` | 556,93 | **Beats Estamparia \| 5511946046144** | `rd_won` → **Juliana** `51992734297` | `uuid` → Beats Estamparia `5511946046144` |
| 4 | `69974b95…7c1d` | 113,97 | **Joao Afonso \| 5511995613472** | `rd_won` → **Juliana** `51992734297` | `uuid` → João Afonso `5511995613472` |
| 5 | `698f1c4d…6dc0` | 466,68 | **Luh \| 5511972394278** | `rd_won` → Luciane `5511972394278` | `uuid` → Igreja Batista `511972394278` |
| 6 | `69f3ac56…1053` | 310,15 | *(ausente nas réplicas)* | `rd_won` → Vanessa Büher `5541995338939` | `uuid` → Vanessa Büher `554195338939` |
| 7 | `69fcd9d7…8c73` | 371,10 | *(ausente nas réplicas)* | `rd_won` → Kleberson `119724914` | `won` → Kleberson `5511972491479` |

**O padrão salta aos olhos: o mesmo lead — "Juliana", `51992734297` — foi atribuído a quatro
negócios de quatro clientes diferentes.** Nenhum deles é dela.

## 2. EVIDÊNCIA POR LEAD

| # | evidência | força | vencedor |
|---|---|---|---|
| 1 | telefone do `deal_nome` = `5511971696998` casa exato com o lead do `uuid` | **FORTE** | `uuid` |
| 2 | idem | **FORTE** | `uuid` |
| 3 | idem + `propostas_rd.lead_id` (terceira resolução) concorda | **FORTE** | `uuid` |
| 4 | idem + `propostas_rd.lead_id` concorda | **FORTE** | `uuid` |
| 5 | `deal_nome` = `5511972394278` casa exato com o lead do `rd_won`; o `uuid` tem `511972394278` (12 díg, faltando um `5`) + `propostas_rd.lead_id` concorda | **FORTE** | `rd_won` |
| 6 | sem `deal_nome`. `crm_deals_cache` registra "Vanessa Büher \| 554195338939" — casa com o `uuid`. **Os dois leads são a mesma pessoa** (`5541995338939` vs `554195338939`: com e sem nono dígito) | **MÉDIA** | `uuid` |
| 7 | sem `deal_nome`. `crm_deals_cache` registra "Kleberson Farias \| 5511972491479" — casa com o `won`. **Os dois leads são a mesma pessoa** (o outro tem `119724914`, 9 dígitos, truncado) | **MÉDIA** | `won` |

**Não escolhi pela linha com mais campos preenchidos.** Nos casos 1–4 o vencedor é o `uuid`, que
tem *menos* atribuição; no caso 5 é o `rd_won`. O critério foi sempre o telefone que o RD grava.

## 3. CAUSA DE CADA DIVERGÊNCIA

| # | classificação | mecanismo |
|---|---|---|
| 1–4 | **RESOLUCAO_POR_CONTATO_ERRADA** | o produtor `rd_won` resolveu via `lead_identificadores` com `limit 1` sobre chaves não-únicas |
| 5 | **DUPLICIDADE_DE_IDENTIDADE** | telefone truncado (`511972394278`) criou um segundo lead para a mesma pessoa |
| 6 | **DUPLICIDADE_DE_IDENTIDADE** | nono dígito: `554195338939` e `5541995338939` são a mesma linha |
| 7 | **DUPLICIDADE_DE_IDENTIDADE** | telefone truncado a 9 dígitos (`119724914`) criou um segundo lead |

### O mecanismo, medido além dos sete

`lead_identificadores` **não tem unicidade nas chaves do RD**:

| | |
|---|---|
| `contact_rdstation_id` compartilhado por mais de um lead | **37** |
| leads afetados por contato compartilhado | **82** |
| `deal_rdstation_id` compartilhado por mais de um lead | **29** |

Dois exemplos diretos dos sete casos:

- `69758ada096bdd0013293060` aponta para **João Galdino** *e* **Beats Estamparia** — duas
  empresas distintas sob o mesmo contato do RD.
- `699c8952ffd31d00174adbdc` aponta para os **dois leads do Kleberson**.

**Qualquer resolução com `limit 1` sobre essas chaves é não-determinística.** É por isso que o
mesmo lead pegou quatro deals: não é azar, é a consequência inevitável do desenho.

### Correção de uma atribuição minha da R28

Atribuí os 347 eventos `rd_won_` à edge `rd-won-pixel-sync`. **348 deles têm `closed_at`
anterior a 2026-05-03, que é a data de criação daquela edge; apenas 5 são posteriores.** Isso é
compatível com duas leituras — a edge fez um backfill de três meses, ou houve um produtor
anterior que não consegui identificar. Como `event_time` é `closed_at`, ele não prova a data de
gravação. **Registro como indeterminado**, não como fato.

## 4. REGRA GENERALIZÁVEL

```
lead_canonico(deal) :=
  telefone extraído do último campo de `deal_nome` (formato "Nome | Telefone"),
  normalizado para DDD + últimos 8 dígitos,
  casado contra leads_marketing.ph
```

Validada retrospectivamente em **todos** os 1.203 deals `won` com nome disponível:

| resultado | n | % |
|---|---|---|
| telefone extraível do `deal_nome` | 1.197 | **99,5%** |
| **resolve para lead ÚNICO** | **1.138** | **94,6%** |
| resolve para múltiplos leads | 29 | 2,4% |
| sem lead correspondente | 30 | 2,5% |
| telefone não extraível | 6 | 0,5% |

**94,6% de resolução determinística e única** — contra uma tabela de identificadores onde 82
leads compartilham contato. A hierarquia que eu supus na R29 (contato RD > telefone) **está
invertida pelos dados**: o contato do RD é a fonte *menos* confiável, porque é reutilizado.

Hierarquia comprovada:

```
1. telefone dentro de deal_nome  (FORTE — 94,6% únicos)
2. propostas_rd.lead_id          (concorda em 3 de 3 casos verificáveis)
3. crm_deals_cache por nome+tel  (MÉDIA — sem deal_id)
4. lead_identificadores          (FRACA — 37 contatos e 29 deals compartilhados)
```

## 5. CLASSIFICAÇÃO FINAL DOS SETE

| # | veredito | uso automático? |
|---|---|---|
| 1, 2, 3, 4, 5 | **LEAD_PROVADO** | **sim** |
| 6, 7 | **LEAD_PROVAVEL** | **não** — decisão humana |
| — | AMBIGUO | nenhum |

**Nenhum caso é insolúvel.** Os dois `LEAD_PROVAVEL` têm impacto econômico nulo: nos dois, os
candidatos são o **mesmo cliente** com dois `lead_id`. A venda não muda de dono — muda de
registro. Recomendo tratá-los junto com a deduplicação de leads, não dentro da canonicalização.

## 6. `value_at_won` × `value_current` — a pendência se dissolve

Detalhamento dos 16 deals cujo valor mudou depois do `won`:

| valor no `won` | n | leitura |
|---|---|---|
| **0** | **14** | **não é alteração — é preenchimento de um registro que nasceu vazio** |
| > 0 | 2 | alteração real sobre valor existente |
| > 0, itens conferem | 1 | `6a75b7ac`: 59,90 → 119,80, itens somam 119,80 — item adicionado |

Os dois casos de alteração real, e eles merecem atenção:

| `deal_id` | no `won` | atual | delta | soma dos itens RD |
|---|---|---|---|---|
| `6a621a20…` | 1.795,79 | **3.489,90** (+94,3%) | +1.694,11 | **1.795,79** |
| `6a7b4c29…` | 1.818,26 | **2.926,40** (+60,9%) | +1.108,14 | **1.818,26** |

**Nos dois, o valor atual não bate com a soma dos itens — e a soma dos itens bate com o valor
original.** Isso não parece completar um pedido; parece erro de digitação ou duplicação dentro do
RD. **Não é caso de escolher política de valor — é caso de conferir dois deals.**

Todos os 16 fecharam em **agosto/2026** — porque só os deals recentes têm múltiplos snapshots. A
amostra não cobre fevereiro a julho, e isso é uma limitação real da conclusão.

**Resposta às perguntas A e B:** estamos registrando um **EVENTO histórico de venda** (§2 da
R29 — nenhum consumidor lê `pixel_events` como estado). Mas o valor do evento **nasce
incompleto** em 14 de 16 casos, e completá-lo não reescreve história — **preenche um vazio.**

## 7. SEMÂNTICA PROPOSTA

| alternativa | veredito |
|---|---|
| A. `value = value_at_won` | **refutada** — seria **zero em 14 de 16 casos**. Inútil |
| B. `value = value_current` | **recomendada** |
| C. guardar os dois | **desnecessária hoje** — divergem em 16 deals e R$ 4.921,57 (0,8%), e 87,5% dessa divergência é zero-para-preenchido |

**Recomendação: B, `value_current`, com uma salvaguarda.**

A preocupação da R29 — "metas não devem mudar silenciosamente porque um negócio antigo foi
corrigido meses depois" — **continua legítima, mas não se aplica a estes dados**: 14 dos 16
seriam corrigidos *de zero para o valor real*, o que **melhora** a série histórica em vez de
distorcê-la. Deixar zero para "não reescrever o passado" seria preservar um erro por princípio.

**Salvaguarda obrigatória:** o `ON CONFLICT ... DO UPDATE` deve **registrar o delta** quando
`value` já era maior que zero e muda mais que um limiar. Os dois casos de +94% e +61% são
exatamente o que precisa aparecer como alerta, não ser aplicado em silêncio.

## 8. IMPACTO NOS KPIs

Concentração do delta de R$ 4.921,57:

| dimensão | concentração |
|---|---|
| **mês** | **100% em agosto/2026** — nenhum mês anterior tem snapshot suficiente para observar |
| deals | **57% em 2 deals** (`6a621a20` e `6a7b4c29`) |
| campanha | não atribuível — nenhum dos 16 tem `campaign_id` |
| recorrência | **nenhum efeito** — muda valor, não contagem de compras |
| coortes | efeito só em agosto, coorte ainda imatura (45 dias não fecharam) |
| ticket | +R$ 4.921,57 sobre 1.523 negócios = **+R$ 3,23 no ticket médio** |

**O delta de valor é irrelevante para decisão. As 44 colisões (R$ 23.522,86 e 13 recomprantes
falsos) são 4,8× maiores e continuam sendo o que importa.**

## 9. CONTRATO FINAL DA CANONICALIZAÇÃO

| eixo | regra final |
|---|---|
| **IDENTIDADE** | `deal_id` do RD. Terminal, estável, nunca duplicado — 0 reaberturas, 0 mudanças de pipeline em 826 deals (R29) |
| **LEAD** | telefone dentro de `deal_nome` (`Nome \| Telefone`) → DDD + últimos 8 dígitos → `leads_marketing.ph`. **94,6% únicos.** Fallback: `propostas_rd.lead_id`. **Nunca `lead_identificadores` sozinho** |
| **TIMESTAMP** | `closed_at` — imutável, 0 alterações em 826 deals |
| **STATUS** | `won` terminal — 0 `won`→`lost`, 0 `lost`→`won` |
| **VALOR** | `value_current`, com registro de delta quando o valor anterior era > 0 |
| **ATRIBUIÇÃO** | `coalesce(EXCLUDED.campo, existente)` — nunca sobrescrever campo preenchido com nulo |
| **RETRY** | `ON CONFLICT (deal_id) DO UPDATE ... WHERE mais_novo` — convergente e idempotente |
| **UNIQUE** | `(deal_id) WHERE deal_id IS NOT NULL AND event_name = 'Purchase'` |

## 10. MIGRAÇÃO SIMULADA — estado final esperado

| métrica | hoje | **após canonicalização** | **+ paginação** |
|---|---|---|---|
| Purchase econômicos | 1.567 | **1.523** | **1.641** |
| receita | R$ 643.894,54 | **R$ 620.371,68** | ~R$ 741.787 |
| compradores | 493 | 492 | 492 + novos |
| **recomprantes** | **216 (43,8%)** | **203 (41,3%)** | 203 + novos |
| **duplicados** | **44** | **0** | **0** |
| sem_lead na base atual | 0 | **0** | 68 não entram |

**A canonicalização remove 44 negócios fantasmas, R$ 23.522,86 e 13 recomprantes falsos. A
paginação, depois dela, adiciona 118 negócios legítimos e zero duplicados.**

## 11. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| **O contato do RD pode mudar?** | Não medi mudança, mas medi algo pior: **ele é compartilhado** — 37 contatos para 82 leads. Por isso foi rebaixado a FRACA |
| **Telefone compartilhado entre pessoas?** | Risco real (R25: 1 chave para 2 clientes CalcMe). Nos 1.203 deals, 29 (2,4%) resolvem para múltiplos leads — esses ficam `AMBIGUO`, não são resolvidos automaticamente |
| **O lead errado já propagou para outras tabelas?** | **Provável e não rastreado.** Os 4 deals da "Juliana" já entraram em scorecards, coortes e no `dias_ciclo`. Corrigir `pixel_events` **não** corrige o que já foi derivado |
| **Corrigir o lead altera a campanha atribuída?** | **Sim, nos 4 casos.** O lead da Juliana tem `utm_campaign_id = 120239742720480257`; os leads corretos não têm campanha. **Quatro vendas saem da conta de uma campanha Meta.** Efeito: aquela campanha perde 4 conversões que nunca foram dela |
| **`value_at_won` é reconstruível?** | Só onde há mais de um snapshot — 826 de 3.559 deals (23%). Para os outros 77%, **não é reconstruível**. Argumento adicional contra a alternativa C |
| **`value_current` reescreve o passado?** | Sim, tecnicamente. Mas em 14 de 16 casos escreve por cima de **zero** |
| **Guardar dois valores é complexidade desnecessária?** | Hoje sim (0,8%, 87,5% disso zero-para-preenchido). Se o padrão dos dois casos de +94%/+61% se repetir, revisar |
| **Algum dos 7 continua insolúvel?** | **Nenhum.** 5 provados, 2 prováveis com impacto econômico nulo |
| **A regra do telefone falha em quantos?** | **5,4%** — 29 ambíguos, 30 sem lead, 6 sem telefone. Esses **não** podem ser resolvidos automaticamente |
| **Os 2 deals sem `deal_nome` provam que a regra tem furo?** | **Sim.** A regra depende de o deal existir em alguma réplica. Os 2 só existem como evento — e são justamente os que caíram para `LEAD_PROVAVEL` |
| **A amostra de valor cobre o ano todo?** | **Não.** Os 16 são todos de agosto. Fevereiro a julho não têm snapshots suficientes. **A conclusão sobre valor vale para o padrão recente, não para toda a série** |

## 12. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e agora é a primeira linha de código: **executar o passo 0 do §12 da R29 —
resolver as 44 colisões**, com as regras que esta rodada provou:

- **37 colisões** com lead concordante → manter a linha com atribuição preenchida;
- **5 colisões** com lead divergente → aplicar o telefone do `deal_nome` (`LEAD_PROVADO`);
- **2 colisões** (`69f3ac56`, `69fcd9d7`) → mesma pessoa em dois leads; escolher qualquer um não
  muda receita nem recompra, mas **a escolha é sua**, e ela pertence à deduplicação de leads.

Antes de executar, uma verificação que esta rodada abriu e não fechou: **os 4 deals da "Juliana"
já contaminaram a atribuição de campanha.** Corrigir `pixel_events` tira 4 conversões de uma
campanha Meta que nunca as gerou — e não desfaz o que já foi calculado a partir delas. Vale
saber, antes, o que já foi decidido com esse número.

E um item que ficou aberto e é maior que esta rodada: **37 `contact_rdstation_id` e 29
`deal_rdstation_id` compartilhados em `lead_identificadores`.** Enquanto isso existir, qualquer
produtor futuro que resolva lead por ali vai errar de novo — as sete colisões são o sintoma, não
a doença.
