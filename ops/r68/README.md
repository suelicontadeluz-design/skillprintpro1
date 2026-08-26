# R68 — Primeira investigação do Worker Econômico, em shadow

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** SHADOW / READ-ONLY. Nenhuma frente criada, nenhuma prioridade tocada, nenhuma
mensagem enviada, nenhum dinheiro movido.

**Regra central:**
> O Worker Econômico não pergunta "qual frente do backlog parece dar dinheiro?". Ele pergunta
> "qual realidade econômica parece melhorável, isso é realmente verdade, e o que precisamos
> provar antes de agir?"

---

## §0 — Reancoragem R67

`vw_objecao_outcome_comercial` viva (572 · 202 D30 · 125 regra B · 198 ALTA) · legado intacto
(572, 187/187, zero divergência) · avaliação R67 de playbooks em 0,5 PCT / BAIXA ·
executor, GPS, tick e gating com hashes idênticos.

Sinal reproduzido exatamente: entre quem objetou, **já-cliente 63/106 = 59,4%** contra
**novo 50/173 = 28,9%**.

---

## §1/§2 — O sinal e as sete hipóteses

O ponto de partida não foi uma frente. Foi um fato do MAPA: **delta de 30,5 pp** entre cliente
existente e cliente novo. Tratado como **sinal**, não como oportunidade.

Sete hipóteses concorrentes, com H1 sem proteção. O que sobrou ao final está em §19.

---

## §4 — Reconstrução temporal: o sinal sobrevive

Testei fora da população de objeções, que é uma seleção estreita. Coortes-mês **fechadas**,
classificação feita **só com fatos anteriores ao início do mês** (sem leakage):

| mês | clientes | taxa | novos | taxa | delta |
|---|---|---|---|---|---|
| 2026-03 | 72 | 45,83% | 8.094 | 0,30% | +45,5 pp |
| 2026-04 | 150 | 37,33% | 9.395 | 0,31% | +37,0 pp |
| 2026-05 | 217 | 32,26% | 10.589 | 0,17% | +32,1 pp |
| 2026-06 | 275 | 20,73% | 11.707 | 0,21% | +20,5 pp |
| 2026-07 | 348 | 20,98% | 13.135 | 0,21% | +20,8 pp |

**O sinal não é refutado.** Mas atenção a uma diferença que não pode ser escondida: os 30,5 pp
da R67 e estes 20–45 pp **não medem a mesma coisa**. A R67 condiciona a "o lead objetou", ou
seja, alguém em negociação ativa. Aqui o denominador é toda a base de leads, majoritariamente
fria — por isso a taxa dos novos é 0,2% e não 28,9%. As duas leituras são verdadeiras e
**não são intercambiáveis**.

A taxa dos clientes também **cai** de 45,8% para 21,0% enquanto a base cresce de 72 para 348.
Isso não é piora: é diluição por recência, e leva direto ao §9.

---

## §9/§10/§19 — Recência e frequência são eixos independentes

Testados juntos, porque separados um poderia ser proxy do outro:

| | FREQ_1 | FREQ_2-3 | FREQ_4+ |
|---|---|---|---|
| **REC_0-30** | 16,7% (n=203) | 41,3% (n=126) | **77,4% (n=164)** |
| **REC_31-60** | 7,8% (n=154) | 20,0% (n=65) | 33,3% (n=24) |
| **REC_60+** | 5,6% (n=214) | 6,3% (n=63) | 14,3% (n=7) |

Dentro de **toda** faixa de recência, mais frequência sobe a taxa. Dentro de **toda** faixa de
frequência, mais recência sobe a taxa. **Nenhum dos dois é proxy do outro** — e essa era a
refutação mais provável. Amplitude de 5,6% a 77,4%: ~14×.

O degrau está entre **15–30 dias (32,0%)** e **31–60 dias (13,6%)**: a taxa cai pela metade.
De 31–60 para 61–90 desaba para 2,6%.

---

## §11/§14 — Onde está o dinheiro, sem multiplicar nada

505 clientes hoje, por célula:

| célula | clientes | receita histórica | LTV observado médio |
|---|---|---|---|
| REC_0-30 × FREQ_4+ | 63 | R$ 241.056 | R$ 3.826 |
| REC_60+ × FREQ_1 | 166 | R$ 124.254 | R$ 749 |
| REC_60+ × FREQ_2-3 | 58 | R$ 72.152 | R$ 1.244 |
| **REC_60+ × FREQ_4+** | **19** | **R$ 50.715** | **R$ 2.669** |
| REC_0-30 × FREQ_1 | 73 | R$ 42.716 | R$ 585 |
| REC_0-30 × FREQ_2-3 | 45 | R$ 41.471 | R$ 922 |
| REC_31-60 × FREQ_2-3 | 20 | R$ 27.831 | R$ 1.392 |
| REC_31-60 × FREQ_1 | 50 | R$ 24.466 | R$ 489 |
| REC_31-60 × FREQ_4+ | 11 | R$ 15.428 | R$ 1.403 |

O grupo "valioso esfriando" (≥2 compras e última compra há mais de 30 dias) soma
**108 clientes e R$ 166.126 de receita histórica**.

**Nenhum uplift foi estimado.** Multiplicar diferença observacional por receita e chamar de
dinheiro incremental é exatamente o que o §14 proíbe.

---

## §12/§13 — O mecanismo existe. E nunca disparou.

Achei a maquinaria completa: 23 campanhas em `crm_campaigns`, das quais **21 de reativação**
(maio a agosto), com `crm_campaign_audiences` populada, guardrails, canal e política de envio.

Então fui medir o contrafactual — e ele não existe:

| | |
|---|---|
| leads em audiência de reativação | **464** |
| leads que receberam algum envio | **5** |
| destes, marcados `excluido` | **5** |
| `status_disparo` = `pendente` | **1.879** |
| `status_disparo` = `enviado` | **4** |
| entregue / aberto / clicado | 4 / **0** / **0** |
| `converteu_em` preenchido | **0** |
| campanhas em `rascunho` | **21 de 23** |

Motivos de exclusão: `lead_frio` (849) e `email_guardrail_local` (90).

O quadro se repete nos outros canais: `waba_disparos_lista` com **0 ativos**;
`agente-retencao` com 253 decisões em 90 dias e apenas **13 com efeito externo** (5%);
`churn_recovery` com 132 linhas e `valor_recuperado` **inteiramente nulo`.

**Causalidade: NÃO_PROVADA, e não por falta de método — por falta de exposição.** Com n=5
expostos, todos excluídos, não há contrafactual a construir.

---

## §17 — Gap do MAPA identificado

> **Não dá para dizer se reativar cliente esfriando paga o esforço.**
> Tenho receita observada (R$ 166.126 no grupo) e taxa baseline por célula, mas **não tenho
> custo nem margem**. `calcme_itens_pedido` tem as colunas `valor_custo_total` /
> `valor_lucro_total` e está **vazia (0 linhas)**; `calcme_pedidos` está congelada desde
> **10/02/2026**.

**Tarefa técnica necessária** (§18, para um futuro Worker Sistema — **não** criada como frente):
construir fonte confiável de custo/margem por pedido. Até lá, todo candidato econômico do
território CLIENTE fica com custo `NAO_ESTIMAVEL`.

Registrado em `gap_do_mapa`.

---

## §16 — Candidato de ação (não executado)

Registrado em `candidato_acao_economica`, `status = NAO_EXECUTADO`:

- **gap** — propensão cai de 77,4% (0–30d, 4+ compras) para 14,3% (60+d, 4+ compras), e a
  máquina de reativação existe mas nunca disparou
- **população** — 108 clientes, R$ 166.126 de receita histórica
- **hipótese a testar** — reativar deliberadamente o subgrupo valioso muda a taxa. **Não está
  provado.** O que está provado é outra coisa: ser cliente existente eleva a propensão
  independentemente de recência e frequência
- **intervenção** — ligar a maquinaria que já existe, para UM segmento, com controle aleatório
- **métrica primária** — compra canônica em D30 por `vw_fato_comercial_identidade_canario`
- **baseline** — 20,0% / 33,3% / 6,3% / 14,3% conforme a célula
- **resultado esperado** — **nenhum número proposto**
- **risco** — incomodar cliente de alto valor; 849 dos excluídos foram barrados por
  `lead_frio`, guardrail que existe por algum motivo
- **custo** — não estimável (ver gap do MAPA)
- **confiança** MEDIA · **causalidade** NAO_PROVADA
- **duração** — mínimo 2 coortes-mês fechadas, respeitando o p90 de 28 dias medido na R67
- **aborto** — taxa do tratado abaixo do controle em 2 coortes seguidas, ou violação de
  guardrail de canal

---

## §19 — Auto-refutação

| tentativa | resultado |
|---|---|
| efeito some em coortes fechadas? | **não** — 5 coortes-mês fechadas, delta de 20,5 a 45,5 pp |
| é leakage temporal? | **não** — classificação feita só com fatos anteriores ao início do mês |
| recência é só frequência disfarçada? | **não** — o cruzamento 2D mostra os dois eixos monotônicos independentemente |
| frequência é só recência disfarçada? | **não** — mesma prova, na outra direção |
| clientes antigos têm perfil estruturalmente diferente? | **provavelmente sim, e isso não foi controlado**: produto, canal, campanha, região e B2B/B2C não entraram. Limite declarado. |
| o delta da R67 e o desta rodada são o mesmo número? | **NÃO** — denominadores diferentes por duas ordens de grandeza. Não podem ser citados juntos. |
| a intervenção existe? | **estruturalmente sim, operacionalmente não**: 4 envios em 4 meses |
| já fazemos isso? | **não** — 21 campanhas em rascunho, 1.879 disparos pendentes |
| receita adicional compensa o custo? | **impossível responder** — não há margem por pedido |
| dá para provar incrementalidade? | **não** — n=5 expostos |

---

## §20 — Veredito

**`HIPOTESE_ECONOMICA_PARA_TESTE`** — o fenômeno sobrevive a reconstrução temporal, a coortes
fechadas e ao controle cruzado dos dois eixos. Mas propensão observada não é uplift, e sem
exposição não há causalidade.

**`GAP_DO_MAPA_IDENTIFICADO`** — falta margem por pedido; sem ela, nenhum candidato do
território CLIENTE tem retorno calculável.

O fluxo que a rodada pretendia provar funcionou de ponta a ponta:
**MAPA → sinal → hipóteses → investigação → candidato + abstenção**, com o backlog técnico
fora do caminho. E a saída mais valiosa foi uma abstenção com endereço: *o mecanismo existe,
está construído, e está parado.*

---

## Próximo passo

1. **Perguntar ao dono por que 1.879 disparos estão `pendente` e 21 campanhas em `rascunho`.**
   Isso é decisão humana, não trabalho de agente — e é o gargalo real, não a falta de dado.
2. Se a resposta for "faltou confiança no alvo", o candidato registrado já traz segmento,
   baseline, controle e critério de aborto prontos.
3. A tarefa técnica de custo/margem por pedido é pré-requisito de qualquer conta de retorno.
   Ela pertence ao Worker Sistema, e **não foi criada como frente**.
4. Não anexar este candidato a nenhuma frente existente: a R66 já mostrou que casar economia
   com backlog por semelhança produz ponte falsa.

---

## Objetos desta rodada

**Criados:** `candidato_acao_economica` e `gap_do_mapa` (ambas append-only, com trigger) ·
`_r68_lead_fatos` (artefato de agregação por lead).
**Registrados:** 1 candidato (`NAO_EXECUTADO`) e 1 gap do MAPA.
**Alterados:** nenhum. **Removidos:** nenhum.

Verificado após a escrita: 0 frentes criadas ou atualizadas, 0 versões de campo, executor/GPS/
tick com hashes idênticos, `crm_campaign_audiences` não tocada, **0 mensagens enviadas**,
`waba_disparos_lista` não tocada, `lead_objections` intacta (572), gating intacto.

> Nota de honestidade: as 21 linhas de `crm_campaigns` aparecem com `updated_at` recente. Todas
> têm **o mesmo timestamp ao microssegundo** (`21:00:00.717195`), numa virada de hora de cron, e
> nesta rodada só emiti SELECT contra essa tabela. É escrita de job agendado, não minha — e o
> `status` de todas continua `rascunho`.

Rollback: `DROP TABLE candidato_acao_economica, gap_do_mapa, _r68_lead_fatos;
DROP FUNCTION fn_candidato_append_only();`
