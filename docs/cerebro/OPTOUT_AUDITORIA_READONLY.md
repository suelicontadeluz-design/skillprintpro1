# Opt-out do WhatsApp — auditoria read-only

Projeto: Supabase `ldrdtaibazplvrbwyrvx` · 2026-08-25 · Somente `SELECT`.
Nenhuma mensagem enviada. **Nenhum patch publicado.** EXP-001 congelado.

## VEREDITO: OPTOUT_CAPTURA_OK_MAS_ENVIO_FURA

## 1. Auto-refutacao da rodada anterior

Na auditoria do canal eu afirmei: *"97 recusas explicitas em 90 dias, zero
capturadas, cobertura 0,0%"*. **Essa afirmacao estava errada.** Apliquei um regex
amplo e chamei o resultado de recusa sem validar caso a caso.

Classificando o conjunto:

| padrao | o que realmente era | n |
|---|---|---|
| `me tira` | **"me tira uma duvida"** — pedido de ajuda | 18 |
| `remover` | **"remover o fundo"** — termo tecnico de DTF | 20 |
| `nao quero` | "nao quero a camiseta, quero so o dtf", "nao quero 4 metros" — recusa de PRODUTO | 53 |
| `cancelar` | cancelar pedido/item | 11 |

Busca dirigida a recusa de CONTATO (nao de produto) sobre os mesmos 90 dias
devolveu 5 linhas, e nenhuma e opt-out:

- "agora nao preciso enviar mais nada ne de arte?"
- "e nao estou recebendo a mensagem de confirmacao"
- "nao mandaram mensagem falando sobre"
- "tem como tirar um nome da lista ?"  (lista de nomes de uma estampa)
- "voce nao conseguiu receber minha mensagem?"

**Ground truth: ZERO opt-outs reais em 76.452 inbounds de 90 dias.**

## 2. A regra atual e estreita, mas nao esta errada

`fn_crm_capturar_optout_inbound` compara por IGUALDADE contra seis frases, apos
lowercase/trim/remocao de pontuacao final: `sair`, `pare`, `parar`, `cancelar`,
`nao quero receber`, `não quero receber`.

| | |
|---|---|
| Matches em 90 dias | **0** |
| Falsos positivos | **0** |
| Precisao | 100% (sem nenhum caso positivo) |
| Recall | **indefinido** — nao ha positivos no denominador |

Nao ha o que corrigir por evidencia: nao existe um unico exemplo real de opt-out
para derivar regra. Derivar padroes agora seria inventa-los, nao mede-los.

## 3. Por que NAO publiquei a regra ampliada

Teste adversarial da regra que eu quase propus, contra os 76.452 inbounds reais:

| padrao ampliado | falsos positivos que causaria |
|---|---|
| `para` tratado como verbo | **3.641** |
| `nao quero` | 53 |
| `remover` | 20 |
| `me tira` | 18 |
| `cancelar` (contexto livre) | 11 |

Ampliar a captura bloquearia milhares de conversas legitimas de clientes ativos
pedindo ajuda ou especificando pedido. A prioridade declarada era precisao.
A regra atual ja tem precisao maxima; o problema nunca esteve nela.

## 4. Matriz dos caminhos de envio — o problema real

| caminho | consulta opt-out? | fail-closed? | prova |
|---|---|---|---|
| `fn_agente_automatico_pode_atender` (guarda do whatsapp-executor) | **NAO** | sim | `prosrc` nao menciona optout de nenhuma forma |
| `fn_fila_disparos_pendentes` (monta a fila) | **NAO** | n/a | idem |
| `fn_guardrail_whatsapp_campaign` (campanhas CRM) | **NAO** | parcial | idem; testado num lead COM opt-out: devolveu `permitido=true` |
| `fn_joao_guardrail_inbound_pre` (Joao) | **NAO** | sim | idem |
| `fn_julia_pode_atender` (Julia) | **NAO** | sim | idem |
| `fn_vigia_leads_mornos` (vigia diario) | **NAO** | n/a | idem |
| `fn_resgatar_leads_vacuo` (resgate 30min) | **NAO** | n/a | idem |
| `fn_tiago_guardrail_whatsapp_v2` (Tiago) | **SIM** | sim | `select 1 from public.crm_contact_optouts o` |

**1 de 8 caminhos respeita opt-out — e e o do Tiago, que esta em dry_run e
executou 1 envio na historia inteira.** Todos os caminhos que de fato enviam
(Joao, Julia, vigia, resgate, executor) ignoram a tabela.

## 5. O unico registro existente

`crm_contact_optouts` tem 1 linha: `canal='email'`, motivo `brevo_hard_bounce`,
origem `brevo_webhook_backfill`. E um bounce tecnico de e-mail, nao um pedido de
cliente. **Nunca houve um opt-out de WhatsApp solicitado por cliente.**

## 6. Onde o opt-out real provavelmente acontece — e por que e invisivel

93% do outbound e reativo (resposta a inbound de 72h). Ninguem pede para sair de
uma lista da qual nao recebe disparo. O opt-out real neste canal e o cliente
**bloquear o numero no WhatsApp** — o que nao gera inbound nenhum e e invisivel
para o banco. Nao ha telemetria de bloqueio.

Isso importa direto para o EXP-001: seria o primeiro disparo proativo em volume
para base dormente, e e exatamente o cenario que produz os primeiros opt-outs
reais da historia da operacao — contra um mecanismo que nenhum caminho de envio
consulta.

## 7. O que precisaria ser verdade

1. `fn_agente_automatico_pode_atender` — o guarda que o executor realmente chama —
   consultar `crm_contact_optouts` e falhar fechado. Este e o patch de maior efeito
   e menor superficie: um unico ponto cobre a fila proativa inteira.
2. Uma regra de captura validada contra casos reais. Hoje nao existem casos reais.
   Eles so vao existir depois do primeiro disparo proativo — o que cria um
   ovo-e-galinha que precisa ser resolvido com o item 1 primeiro.
3. Telemetria de bloqueio do numero, se o provedor expuser.
