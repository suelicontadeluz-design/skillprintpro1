# R78 — Censo canônico de executores de reativação e contaminação

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY.
Nenhum cron parado, nenhuma função alterada, nenhum pré-registro tocado, nenhuma V3,
nenhuma mensagem, nenhuma policy, nenhum agente, nenhuma frente.

**Regra da rodada:** antes de perguntar "qual agente devo acionar?", o Cérebro precisa saber
"quem já está agindo sobre essa realidade?".

---

## §1 — Reancoragem, com três correções à R77

A R77 acertou o total e errou a decomposição. Corrigindo com `status` explícito:

| origem | disparos 30d | **enviados 30d** | enviados 60d | enviados 90d |
|---|---|---|---|---|
| `vigia_leads_mornos` | 220 | **186** | 254 | 254 |
| `vigia_ciclo_compra` | 50 | **29** | 85 | 85 |
| `followup_agente` (evento vazio) | 25 | **24** | 138 | 210 |
| `crm_campaign` | 5 | **0** (todos `removido`) | 0 | 0 |
| **total enviado 30d** | | **239** | | |

**Correção 1.** A R77 atribuiu 50 envios ao `vigia_ciclo_compra`. São **29 enviados + 21 erro**.
O total de 239 estava certo; a repartição, não.

**Correção 2.** Não são duas funções sem dono, são **três caminhos**. O terceiro tem `evento`
vazio, `tipo_template = 'followup_agente'`, e dispara às **11:00, 15:00 e 21:00** — exatamente os
horários de `cerebro-manha`, `cerebro-tarde` e `cerebro-fim-tarde`. É o caminho
**orquestrador → agente-conversacao (Bruno)**. Um de seus segmentos chama-se, literalmente,
`lead_frio_reengajamento`.

**Correção 3, a mais importante.** A R77 escreveu "11 dos 29 `FREQ_2_3` ... o envio mais recente
foi 25/08". As duas frases são verdadeiras separadamente e **enganosas juntas**: o envio de 25/08
foi para um cliente `FREQ_4_PLUS`. Para os **29 `FREQ_2_3`**, a última exposição do
`vigia_ciclo_compra` foi em **03/08** — 24 dias atrás. Nos últimos 14 dias: **zero**.

Os 11 seguem confirmados, mas com a distribuição temporal que faltava:

| origem | ≤7d | ≤14d | ≤30d | ≤60d | ≤90d | última |
|---|---|---|---|---|---|---|
| `vigia_ciclo_compra` | 0 | 0 | **1** | 9 | 9 | 03/08 |
| `winback_churn_julho` | 0 | 0 | 0 | 2 | 2 | 04/07 |
| `followup_agente` | 0 | 0 | 0 | 0 | 0 | — |
| `crm_campaign` (enviado) | 0 | 0 | 0 | 0 | 0 | — |

---

## §2, §3 — Inventário de caminhos capazes de intervir nesta população

| # | caminho | tipo | acionado por | declarada | implementada | comprovada | efeito externo |
|---|---|---|---|---|---|---|---|
| 1 | `fn_vigia_ciclo_compra` | função SQL | cron 107, seg–sex 15:20 | `agente-retencao` | vigia de cadência própria | **sim** | WhatsApp real |
| 2 | `fn_vigia_leads_mornos` | função SQL | cron 118, seg–sex 14:00 | **nenhum dono** | followup de lead morno | **sim** | WhatsApp real |
| 3 | `orquestrador → agente-conversacao` | edge + edge | crons 11/15/21h | Caio → Bruno | followup por lead | **sim** | WhatsApp real |
| 4 | `agente-campanhas-crm` | edge | cron **OFF** | Tiago | campanha CRM | **bloqueada** | 0 nesta população |
| 5 | `agente-pipeline` → `crm_tasks` | edge | orquestrador | Rafael | task humana p/ Tamires | **sim, mas** | ver §7 |
| 6 | humano direto | pessoa | — | — | — | **sim** | `fact_conversations` outbound |

---

## §4 — `fn_vigia_ciclo_compra`, aberta

| dimensão | o que o código faz |
|---|---|
| população | `Purchase` com `value>0` nos **últimos 180 dias**, `having count(*)>=2` |
| cadência | mediana dos gaps entre compras, piso de 3 dias |
| gatilho | `dias_sem_comprar > cadencia*1.5` **e** `>= 10` |
| dedup | `not exists` em `waba_disparos_lista` nos **últimos 21 dias** (mesmo telefone) |
| anti-colisão | `not exists` task pendente em `crm_tasks`; `not exists` conversa nas **últimas 48h** |
| irmão/gêmeo | exclui se um lead com mesmo telefone-8 ou mesmo primeiro nome comprou nos últimos 20 dias |
| idempotência | `vera_retencao_ciclos` com âncora `(lead_id, compra_ancora_em)` e `on conflict do nothing` |
| consentimento / optout | **não há checagem explícita** — só o dedup de 21 dias e os anti-colisão acima |
| cota | `limit 15` por rodada; no máximo 10 `reengajar_ciclo`, 5 `escalar_task_retencao` |
| ordenação | **`order by compras desc, ratio desc`** |
| mensagem | "Oi {nome}! Bruno da Skillprint aqui 😊 Faz uns {N} dias que não vejo pedido teu." |
| outcome | `vera_retencao_ciclos` (53 linhas) registra o ciclo, **não** o desfecho comercial |
| dono real | função SQL; `agente-retencao` é rótulo em `agente_decisoes_log`, não executor |

### A descoberta que muda a leitura da R77

Das **29 `FREQ_2_3` contatáveis**, apenas **3 têm ciclo calculável** — ou seja, apenas 3 têm
≥2 compras dentro dos 180 dias. As outras **26 são invisíveis para a vigia**, e são invisíveis
exatamente pelo motivo que as coloca na audiência V2: pararam de comprar faz tempo.

**A janela de 180 dias da vigia é a exclusão que ainda não tínhamos visto** (§16). Ela não é
um guard declarado; é um efeito colateral da definição de população. E ela protege 26 dos 29.

---

## §5 — Classificação por cliente (29 `FREQ_2_3` contatáveis)

| classe | n | última exposição |
|---|---|---|
| `NAO_EXPOSTO` (nenhum canal, 90d) | **15** | — |
| `EXPOSTO_VIGIA_CICLO` | 9 | 03/08 |
| `EXPOSTO_CRM` (`winback_churn_julho`) | 2 | 04/07 |
| `EXPOSTO_HUMANO` (outbound em `fact_conversations`, sem disparo correspondente) | 3 | 21/08 |
| `EXPOSTO_VIGIA_MORNOS` | **0** | — |
| `MULTIPLAS_EXPOSICOES` | 0 | — |

Medindo pelo canal em vez de pela tabela de fila — `fact_conversations` com `direction='outbound'`
é o registro mais amplo — a exposição fica: **1 em 7d · 2 em 14d · 3 em 30d · 13 em 60d · 14 em 90d.**

---

## §6 — Qual janela de contaminação é a correta

Não usei 60 dias por conveniência. Medi o comportamento comercial observado depois de uma
exposição real da vigia (56 clientes, envios de 06/07 a 27/07, janela D30 fechada):

| janela | converteram | % das conversões D30 |
|---|---|---|
| D7 | 16 | 50% |
| D14 | 25 | **78%** |
| D30 | 32 | 100% |

Mediana até a compra: **180 horas ≈ 7,5 dias**.

O efeito de uma exposição anterior se esgota rápido: metade em 7 dias, quase quatro quintos em 14.
Como o desfecho do experimento é D30, a janela que pode sujar a medição é a que ainda estaria
produzindo conversões durante a medição — ou seja, **D30 é a janela defensável**. D14 é o piso
agressivo; 60 e 90 dias são conservadorismo sem base no dado observado.

**Com a janela D30: 26 dos 29 estão limpos.** Com 60 dias, 16. A escolha da janela muda a
população limpa em 10 clientes, e é por isso que ela não podia ser arbitrada.

---

## §7 — Um cliente do CONTROLE pode receber mensagem automaticamente? **SIM — mas hoje, não.**

Rodei a regra completa da vigia, com todos os guards, contra os 29:

| | n |
|---|---|
| têm ciclo calculável (≥2 compras em 180d) | **3** |
| passam `1,5× cadência` e `≥10 dias` | 3 |
| passam também telefone válido | 3 |
| **elegíveis hoje, após todos os guards** | **3** |
| bloqueados por dedup 21d / task pendente / conversa 48h | 0 / 0 / 0 |

E então testei o que decide de fato — a **fila**:

| | |
|---|---|
| pool elegível hoje, sistema inteiro | **27** |
| `limit` do cron | **15** |
| posição dos 3 no ranking `compras desc, ratio desc` | **21º, 25º, 26º** (todos com `compras=2`) |
| **entrariam no top 15 hoje** | **0** |

O `order by compras desc` é um escudo estrutural: um cliente `FREQ_2_3` tem, por definição, 2 ou 3
compras, e perde para todo `FREQ_4_PLUS` enquanto o pool passar de 15. Hoje sobram 6 posições de
folga acima deles.

**Mas é um escudo probabilístico, não uma garantia.** Numa semana fraca — ou depois que o dedup
de 21 dias tirar os primeiros da fila — as posições 21 a 26 ficam alcançáveis. A resposta honesta
a §7 é: **sim, pode acontecer; hoje não aconteceria; e ninguém no sistema saberia impedir.**

---

## §8 — Tratamento exclusivo?

Um cliente do tratamento poderia acumular, no mesmo período: mensagem experimental + vigia de
ciclo + followup do Bruno + task humana. Risco medido para os 29:

| fonte de dupla intervenção | exposição em 30d | observação |
|---|---|---|
| `vigia_ciclo_compra` | 1 de 29 | limitado pelos 180 dias |
| `vigia_leads_mornos` | **0 de 29** | população disjunta (lead morno, não cliente recorrente) |
| `followup_agente` (Bruno) | 0 de 29 | não alcançou esta população em 90 dias |
| `crm_tasks` | 6 de 29 criadas em 30d | **23 tasks, todas `descartada`** — ver abaixo |
| humano direto (outbound) | 3 de 29 | último 21/08 |

**As 23 tasks foram todas descartadas.** Task criada e descartada não é contato: `agente-pipeline`
gerou intenção de intervenção, ninguém executou. Isso derruba a leitura preguiçosa de que "o
humano é o principal contaminador" pela via das tasks — mas **não** derruba a via direta: 3
clientes receberam outbound humano em 30 dias, e essa é a maior fonte de contaminação atual.

---

## §9 — População limpa (sem alterar nada)

| janela de contaminação | `FREQ_2_3` limpos | de 29 |
|---|---|---|
| 7 dias | 28 | 97% |
| 14 dias | 27 | 93% |
| **30 dias (defensável, §6)** | **26** | **90%** |
| 60 dias | 16 | 55% |
| 90 dias | 15 | 52% |

Com a janela que o dado sustenta, **26 clientes limpos**. E é preciso dizer o que isso não
resolve: o `N_MAX` da V2 é **70 por braço, 140 no total**. Contaminação custa 3 clientes;
a falta de amostra custa 111. **A contaminação nunca foi a restrição que trava o experimento.**

---

## §10 — Opções de isolamento (avaliadas, nenhuma implementada, nenhuma escolhida)

| opção | a favor | contra |
|---|---|---|
| **A.** excluir quem as vigias já atendem | trivial, zero código, zero acoplamento | tira 3 de 29 numa amostra que já é 21% do necessário |
| **B.** vigias reconhecerem o assignment | isolamento real e permanente | exige alterar `fn_vigia_ciclo_compra`; cria acoplamento entre produção e experimento; a vigia passa a depender de um objeto de pesquisa |
| **C.** medir intervenção **adicional** sobre tratamento já existente | é o que a realidade oferece: já existe uma reativação rodando, e o §12 mostra qual é o desempenho dela | **muda o estimando** — deixa de ser "reativar vs não reativar" e passa a ser "reativar de novo vs a reativação atual". Exigiria novo pré-registro |
| **D.** inviável enquanto coexistirem | seria verdade se a sobreposição fosse total | **refutada pelo dado**: 26 dos 29 são estruturalmente invisíveis à vigia, e 0 dos 3 restantes entra no top 15 hoje |

A evidência aponta para **C** como a pergunta mais honesta, e para **A** como a operação mais
barata. Não escolho nenhuma: C exige novo pré-registro, que a R76 congelou até 04/09, e escolher
A por ser barata seria escolher por conveniência. Fica registrado para o dono decidir depois do
canário.

---

## §11 — "A vigia já é a intervenção que estamos tentando construir"

| dimensão | `fn_vigia_ciclo_compra` | experimento V2 |
|---|---|---|
| população | ≥2 compras em **180d** + silêncio >1,5× cadência própria | `ESFRIANDO` por p90 da classe + contatável |
| **cobertura da população V2** | **3 de 29** | 29 de 29 |
| timing | diário, seg–sex 15:20, contínuo | one-shot, randomizado |
| canal | WhatsApp | WhatsApp |
| mensagem | "faz uns N dias que não vejo pedido teu" | reativação |
| regra | cadência individual | classe + estado econômico |
| outcome | **não acompanha** desfecho comercial | D30 pré-registrado |
| efeito conhecido em `FREQ_2_3` | **1/13 = 7,7%** | hipótese pinada: 10,2% → 30,2% |

**Veredito: `CAPACIDADE_PARCIALMENTE_SOBREPOSTA`.**

É a mesma capacidade — WhatsApp de reativação para cliente que passou do próprio ciclo — com
regra de elegibilidade diferente. E a diferença não é cosmética: **a janela de 180 dias da vigia
exclui 26 dos 29 clientes que o experimento quer medir.** O experimento não duplicaria a vigia;
ele atacaria justamente a fatia que a vigia estruturalmente não enxerga.

Isso refuta tanto `MESMA_CAPACIDADE` quanto `INTERVENCAO_DIFERENTE`.

---

## §12 — Já existe evidência econômica, e ela é desconfortável

56 clientes expostos ao `vigia_ciclo_compra` com janela D30 fechada:

| classe na exposição | n | D30 | taxa | IC95 Wilson | baseline R73 | Fisher 2-caudas |
|---|---|---|---|---|---|---|
| `FREQ_4_PLUS` | 43 | 31 | **72,1%** | [57,3%, 83,3%] | 59,4% | **p = 0,19** |
| **`FREQ_2_3`** | **13** | **1** | **7,7%** | **[1,4%, 33,3%]** | **10,2%** | **p = 1,00** |

Leitura, sem afirmar causalidade:

- Uma mensagem real de reativação **já foi enviada a 13 clientes `FREQ_2_3`**, e o resultado é
  **indistinguível do baseline de quem não recebeu nada** (p = 1,00).
- Em `FREQ_4_PLUS` a taxa é maior que o baseline, mas não significativa (p = 0,19) e
  **confundida por seleção**: a vigia escolhe justamente quem está mais atrasado no próprio
  ciclo, e a R67 já mediu que "já é cliente" vale 30,5 pp.
- Nenhum dos dois substitui o experimento. Mas o primeiro é informação real sobre a hipótese
  pinada da V2: a alternativa **10,2% → 30,2%** pede um salto de 20 pp que a única evidência
  observacional disponível não sugere em lugar nenhum.

Isto não altera o pré-registro. É insumo para quem for decidir se vale gastar 140 contatos.

---

## §13 — Autoria

| caminho | é possível determinar executor/capacidade/motivo/origem? | cobertura |
|---|---|---|
| `crm_tasks.origem` | **sim, completo** | **100%** |
| `waba_disparos_lista.evento` | parcial — o caminho do Bruno grava vazio | **65,5%** (426/650, 90d) |
| `crm_campaign_audiences.guardrail_slug` | parcial | 50,4% |
| `mensagem_envio.autor_tipo` / `origem_tipo` | **majoritariamente não** | **20,1%** (3.074/15.317, 90d) |
| `fact_conversations` | só `source`, sem executor nem motivo | — |

A R77 disse "79% sem autor". Confirmado e refinado: **20,1% de cobertura em 90 dias**. O campo
`evento` de `waba_disparos_lista` é o único ponto onde o sistema quase acerta — e ele falha
exatamente no caminho do orquestrador, que grava string vazia. Nenhum caminho registra
**experimento/campanha** como dimensão; se a V2 rodasse hoje, não haveria onde marcar quem é
tratamento.

---

## §14 — O que precisa entrar no registro canônico de capacidades

Não são agentes. São **caminhos com efeito externo**, no modelo
`CAPACIDADE → EXECUTOR → IMPLEMENTAÇÃO → CONSUMIDOR → EFEITO → EVIDÊNCIA`:

| capacidade | executor | implementação | consumidor | efeito | evidência |
|---|---|---|---|---|---|
| reativar cliente por cadência própria | `agente-retencao` (rótulo) | `fn_vigia_ciclo_compra` | cron 107 | WhatsApp | `waba_disparos_lista.evento='vigia_ciclo_compra'` |
| reengajar lead morno | **sem dono** | `fn_vigia_leads_mornos` | cron 118 | WhatsApp | `evento='vigia_leads_mornos'` |
| followup por lead priorizado | Caio → Bruno | edges | crons 11/15/21h | WhatsApp | `tipo_template='followup_agente'` |
| campanha CRM segmentada | Tiago | `agente-campanhas-crm` | cron **OFF** | bloqueado | `crm_campaigns` |
| task humana de retenção | Rafael | `agente-pipeline` | orquestrador | intenção, **não contato** | `crm_tasks.origem` |
| contato humano direto | pessoa | — | — | WhatsApp | `fact_conversations` outbound |

Duas linhas dessa tabela não têm dono no registro de agentes, e uma delas (`vigia_leads_mornos`)
é o **maior emissor do sistema**: 186 enviados em 30 dias.

---

## §15 — Impacto no experimento V2 (pré-registro **não** alterado)

```
V2_EXECUTAVEL_COM_ISOLAMENTO
```

Este veredito é **sobre contaminação, e só sobre ela**. A contaminação é isolável:
26 dos 29 estão limpos na janela D30 defensável, 26 são estruturalmente invisíveis à vigia por
causa dos 180 dias, e nenhum dos 3 elegíveis entra na fila de 15 hoje.

O que **não** muda: a V2 continua sem amostra. 29 contra `N_MAX = 140`. Isso a R73 e a R75 já
tinham estabelecido e a R78 não reabre. Registrar `CONTAMINACAO_IRRELEVANTE` seria falso — a
contaminação é pequena, não irrelevante, e o risco futuro do §7 é real. Registrar
`V2_NAO_EXECUTAVEL_NESTE_AMBIENTE` seria atribuir à contaminação uma culpa que é da amostra.

**Nenhuma V3 criada.** O desenho segue congelado até 04/09, como a R76 determinou.

---

## §16 — Auto-refutação

| tentativa | resultado |
|---|---|
| os 11 envios não têm relação com reativação? | **refutado** — texto explícito de reposição de pedido |
| a vigia atende população diferente? | **parcialmente confirmado, e é o achado da rodada**: 26 dos 29 estão fora dos 180 dias dela |
| a exposição anterior já está longe demais? | **em grande parte sim** — última em `FREQ_2_3` foi 03/08; mediana até compra é 7,5 dias; D14 captura 78% |
| o controle pode ficar limpo naturalmente? | **sim, hoje** — 0 dos 3 elegíveis entra no top 15. **Não garantidamente**: pool 27 contra limite 15, folga de 6 posições |
| o cron tem exclusão que ainda não vimos? | **sim** — a janela de 180 dias, que não é guard declarado e é o que protege 26 dos 29 |
| o humano é o principal contaminador? | **sim para a exposição atual** (3 outbound em 30d, contra 1 da vigia), **não pelas tasks**: as 23 foram todas descartadas |
| `crm_campaign` não é relevante? | **confirmado irrelevante** — 6 clientes enfileirados, **0 enviados**, e os 5 disparos de 30d estão `removido` |
| a população limpa é suficiente? | **não** — 26 limpos contra 140 necessários. Contaminação custa 3; amostra custa 111 |

---

## Gate de segurança

| verificação | observado |
|---|---|
| crons parados ou alterados | **0** (106 total, 93 ativos) |
| funções alteradas | **0** |
| pré-registro alterado | **0** — V1 e V2 intactos, **sem V3** |
| mensagens enviadas | **0** |
| policy alterada | **0** (`ativo = false`) |
| agentes alterados | **0** |
| frentes criadas | **0** |
| objetos criados no banco | **0** — rodada somente leitura |
