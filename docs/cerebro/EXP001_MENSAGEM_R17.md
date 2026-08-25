# R17 — Intervenção do EXP-001 congelada

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `EXP001_MENSAGEM_CONGELADA`

Uma mensagem, congelada em `crm_campaign_messages`, `aprovado=false`, campanha `rascunho`.
Fila EXP-001 = 0. Envios = 0.

**Com um achado que afeta a análise: do jeito que a métrica primária está definida, uma
resposta "SAIR" conta como sucesso.** Detalhe no item 5.

---

## 1. HISTÓRICO ANALISADO (read-only, descritivo — não causal)

Voz real da operação, medida em `waba_disparos_lista` (906 linhas com mensagem):

| evento | n | tam. médio | com "SAIR" | com oferta |
|---|---|---|---|---|
| `vigia_leads_mornos` | 280 | 169 | 0 | 0 |
| (sem evento) | 227 | 187 | 0 | 6 |
| `vigia_ciclo_compra` | 107 | 200 | 0 | 0 |
| `crm_campaign` | 5 | 196 | **5** | 0 |

Exemplos reais:

- `vigia_leads_mornos`: *"\*Bruno Fonseca:\* Oi Luiz! Bruno da Skillprint aqui 😊 A gente tava vendo teu **DTF** e a conversa parou no meio. Ficou alguma dúvida no valor ou no prazo?"*
- `crm_campaign` (Tiago): *"Oi! Tudo bem? Aqui é da Skillprint. Queria saber se ainda tem interesse nos nossos serviços de estamparia. Como posso te ajudar? / Se não quiser mais receber mensagens de divulgação, **responda SAIR**."*
- `morno`: *"Oi Cristiane! Sobre as **50 camisetas dryfit com logo branco** — posso enviar os valores?"*

Taxa de inbound em 72h após envio real (**descritivo, sem controle — é justamente o que o
EXP-001 existe para corrigir**):

| segmentação | envios | responderam 72h | % |
|---|---|---|---|
| `lead_morno` | 221 | 53 | **24,0%** |
| `reativacao_feriado_pascoa` | 39 | 14 | 35,9% |
| `checkout_urgente` | 49 | 30 | 61,2% |

O que o histórico ensina, e que mudou a copy: as mensagens de melhor desempenho **presumem
um contexto específico** ("teu DTF", "as 50 camisetas"). Para o EXP-001 isso seria inventar.

## 2. A POPULAÇÃO PROÍBE PRODUTO E EXIGE APRESENTAÇÃO

Medido nos 244 do braço TRATAMENTO:

| | valor |
|---|---|
| `impressao_dtf_textil` | 116 (47,5%) |
| **sem categoria nenhuma** | **105 (43,0%)** |
| demais (diversos, terceirão, DTF UV, evangélicos, camisetas) | 23 (9,5%) |
| **já compraram alguma vez** | **4 de 244** |
| têm nome próprio na base | 236 de 244 |
| com opt-out de WhatsApp ativo | 0 |

Três consequências diretas:

1. **Não pode nomear produto** — 43% não têm categoria.
2. **Precisa se apresentar** — 240 de 244 nunca compraram; a maioria não lembra da Skillprint.
3. **Não pode usar nome** — 8 não têm, e a função de registro aceita **um** texto fixo, sem
   template por lead. Sem nome também remove um confundidor.

O que **pode** ser afirmado com prova: todos tiveram conversa real anterior
(`inbound_total >= 1`, por construção da coorte) e o último inbound foi há 31–45 dias.
Então "a gente conversou por aqui faz um tempo" é verdade verificável, não suposição.

## 3. OS 3 CANDIDATOS

**A — mínimo, sem opt-out** (166 chars)
> Oi! Tudo bem? Aqui é a Skillprint 😊 A gente conversou por aqui faz um tempo e acabou parando. Se ainda fizer sentido, me diz que eu te ajudo. Se não, tudo bem também!

*Serve à hipótese:* proatividade pura, zero oferta. *Risco:* sem canal de opt-out, foge da
convenção da casa. *Enviesa:* "Se não, tudo bem também!" convida um "não" — que é inbound, e
portanto conta como sucesso na métrica.

**B — padrão da casa + opt-out** (213 chars) ← **escolhido**
> Oi! Tudo bem? Aqui é a Skillprint 😊 A gente conversou por aqui faz um tempo e acabou ficando por isso mesmo. Se ainda fizer sentido, me chama que eu te ajudo. Se preferir não receber mais mensagens, responda SAIR.

*Serve à hipótese:* só proatividade. Nenhum produto, preço, desconto, prazo ou urgência.
*Risco:* lembrar do opt-out pode aumentar opt-out. *Enviesa:* "SAIR" é inbound (item 5).

**C — pergunta direta** (192 chars)
> Oi! Aqui é a Skillprint. Você falou com a gente há algumas semanas sobre personalização e a conversa parou. Ainda posso te ajudar com isso? Se não quiser mais receber mensagens, responda SAIR.

*Serve à hipótese:* CTA mais claro. *Risco:* "sobre personalização" presume assunto que 43%
não têm registrado. *Enviesa:* pergunta fechada tende a puxar "não" — inbound, logo sucesso.

Os três passaram nos filtros mecânicos reais de `fn_fila_disparos_pendentes`
(sem `[placeholder]`, sem `{var}`, sem `R$X`) e no teste de oferta/urgência/produto.

## 4. REFUTAÇÃO DO CANDIDATO B

| Pergunta | Resposta |
|---|---|
| Parece spam? | Não vende, não oferta, não linka, tem saída explícita |
| Sugere que sabemos algo que não sabemos? | Não. "conversou por aqui faz um tempo" é provável por construção da coorte |
| Confunde cliente antigo? | Só 4 de 244 já compraram, e o texto não afirma pedido nem status |
| Parece promoção? | Sem desconto, preço, prazo, brinde ou frete |
| Cria obrigação de resposta? | "Se ainda fizer sentido" é condicional; não cobra |
| Induz venda em vez de conversa? | "me chama que eu te ajudo" abre conversa, não fecha venda |
| Funciona para DTF, camiseta e os 43% sem categoria? | Sim — não nomeia produto |
| Quem não lembra da Skillprint entende? | Sim — a empresa se identifica na primeira linha |
| Pode gerar reclamação? | Risco baixo, e a saída está no próprio texto |
| CTA claro? | "me chama que eu te ajudo" |
| "Sim/não" é natural? | Sim — e é aí que mora o problema de medição do item 5 |

## 5. ACHADO: "SAIR" CONTA COMO SUCESSO

A métrica primária, definida em `fn_exp001_coorte`, é:

> `retomou_conversa_72h` — ">=1 inbound em fact_conversations posterior ao instante da intervenção, em até 72h"

E `fn_crm_capturar_optout_inbound` captura opt-out por **igualdade exata** do texto:

```
'sair', 'pare', 'parar', 'cancelar', 'não quero receber', 'nao quero receber'
```

Uma pessoa que responde **"SAIR"** gera um inbound em `fact_conversations`. Pela definição
acima, **isso conta como "retomou conversa"** — ou seja, uma rejeição entra no numerador
do sucesso. Como o CONTROLE não recebe mensagem, ele não tem como produzir esse inbound:
o viés é assimétrico e infla o efeito do tratamento.

**Não corrigi a métrica nesta rodada** — ela vive em `fn_exp001_coorte`, que está fora do
escopo autorizado aqui, e mexer nela sem pedido mudaria o experimento. Fica registrado como
regra obrigatória de análise:

> Ao analisar o EXP-001, **excluir do numerador** de `retomou_conversa_72h` os inbounds cujo
> texto normalizado esteja na lista de opt-out acima, e reportar opt-out como **métrica de
> segurança separada**, por braço.

## 6. DECISÃO SOBRE OPT-OUT NO TEXTO: **incluir, com "responda SAIR"**

Não é escolha estética — é a única forma que fecha o laço:

- **"responda SAIR" produz o token exato que a captura reconhece.** Um convite vago
  ("é só me avisar") geraria texto livre que `fn_crm_capturar_optout_inbound` **não** captura
  — prometeríamos algo que o sistema não cumpre sozinho.
- Captado o opt-out, ele vira linha em `crm_contact_optouts(canal='whatsapp')`, e o guard do
  `whatsapp-executor` (R12, `optout_whatsapp`) passa a bloquear outbound daquele lead. O
  respeito é automático e auditável, não depende de ninguém lembrar.
- É a convenção da casa: `fn_tiago_autorizar_e_enfileirar` **recusa** campanha de WhatsApp
  cuja mensagem não contenha "responda SAIR" (`instrucao_optout_ausente`).

Custo aceito, declarado: lembrar do opt-out provavelmente aumenta opt-out, e o texto fica em
213 chars (as de campanha vão até 196). Ambos são preço justo por não enganar ninguém.

## 7. TEXTO EXATO CONGELADO

```
Oi! Tudo bem? Aqui é a Skillprint 😊 A gente conversou por aqui faz um tempo e acabou ficando por isso mesmo. Se ainda fizer sentido, me chama que eu te ajudo. Se preferir não receber mais mensagens, responda SAIR.
```

| | |
|---|---|
| `md5(mensagem)` | **`1c389fe45c074b24626f45fa18060e7e`** |
| caracteres | 213 |
| `nome` | `exp001_proatividade_v1` |
| `sequencia` | 1 |
| `canal` / `tipo_template` | `whatsapp` / `reativacao` |
| `aprovado` | **false** |
| `condicao_envio` | "EXP-001 dose unica: uma mensagem por lead do braco TRATAMENTO. Sem segunda tentativa na janela principal." |
| `created_at` | 2026-08-25 15:43:56.715358+00 |

## 8. SEGURANÇA — verificado ANTES de inserir

| Verificação | Resultado |
|---|---|
| triggers em `crm_campaign_messages` | **zero** |
| funções que leem a tabela | só `fn_tiago_autorizar_e_enfileirar` |
| crons que tocam campanha/Tiago/Brevo | só `fn_tiago_reconciliar_resultados` (`*/30`), que **não** enfileira e **não** faz HTTP |
| Tiago consegue pegar esta campanha? | Não — `criado_por='cerebro-exp001'` cai em `autor_invalido`, checado **antes** da mensagem |
| `UNIQUE(campaign_id, sequencia)` | garante 1 mensagem, inserção idempotente |

## 9. PROVAS

| Medida | Valor |
|---|---|
| campanha status / `criado_por` | **`rascunho`** / `cerebro-exp001` |
| mensagens da campanha / `aprovado` | **1** / **false** |
| audiência tratamento | **244** |
| snapshot total / tratamento / controle | **456** / **244** / **212** |
| hash T0 vs reconstruído | `865e8672…` = `865e8672…` |
| fila EXP-001 (via `campaign_audience_id`) | **0** |
| fila por `origem_agente`/`segmentacao` EXP-001 | **0** |
| audiências com `disparo_id` | **0** |
| envios EXP-001 (toda a história) | **0** |
| `waba_disparos_lista` total | 907 antes, **907** depois |
| guard opt-out / coorte | `d22ac0fd…` / `4390732e…` (intactos) |

Snapshot **não** recalculado: a população oficial segue sendo os 456 de T0.

## 10. PRÓXIMO PASSO MÍNIMO

O EXP-001 está completo no papel: população congelada, braços persistidos, idempotência,
opt-out respeitado, mensagem congelada. **Falta só a decisão de risco operacional que você
já levantou na R9 e que continua sem solução: existe um único número de WhatsApp, e ele
também atende clientes ativos.**

Próximo passo, uma coisa só: **decidir o canal**. Ou se aceita usar o número principal para
244 mensagens de dose única (e com que teto diário e janela), ou se o experimento espera um
número separado. Enquanto isso não for decidido, não faz sentido aprovar a campanha —
aprovar é o gatilho, e o gatilho não deve ser puxado antes dessa resposta.

Só depois disso: mudar a campanha para `aprovada` e chamar o registro com `p_enfileirar=true`.

EXP-001 continua sem execução. Zero mensagens nesta rodada.
