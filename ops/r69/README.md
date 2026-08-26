# R69 — Por que a máquina de reativação não dispara

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY.
Nenhuma campanha ativada, nenhum status alterado, nenhuma mensagem enviada, nenhum cron tocado.

**Regra central:**
> "não disparou" não significa automaticamente "alguém não autorizou". Primeiro provar quem ou
> o que está segurando a máquina.

---

## §0 — Reancoragem R68 (reconstruída do zero)

23 campanhas: **21 rascunho · 1 pausada · 1 em_execucao** · 21 de reativação ·
audiência de reativação: **1.879 pendente, 95 cancelado, 4 enviado, 1 erro** ·
entregue 4, aberto **0**, `converteu_em` **0** ·
`agente-retencao` 253 decisões / 13 efeito externo / **0 dry_run** ·
`churn_recovery` 132 linhas com `valor_recuperado` **100% nulo**.

---

## §1/§2 — A cadeia real, e quem tira do rascunho

O que transforma rascunho em executável é **`fn_tiago_autorizar_e_enfileirar(campaign_id, …)`**.
Não há UI, aprovação manual ou trigger: a função faz tudo — valida, enfileira em
`waba_disparos_lista` e, **só se enfileirar alguém**, grava
`status='em_execucao'`, `aprovado_por='sistema:'||versao`, `aprovado_em=now()`.

**A ativação é automática por código.** O campo `aprovado_por` não espera humano: é preenchido
pelo próprio sistema.

Os gates, na ordem exata em que o código retorna:

| # | gate | erro retornado |
|---|---|---|
| 1 | `criado_por LIKE 'agente-campanhas-crm-%'` | `autor_invalido` |
| 2 | `status = 'rascunho'` | `estado_invalido` |
| 3 | existe `crm_campaign_autonomy_policy` | `politica_ausente` |
| **4** | **`policy.ativo`** | **`politica_desligada`** |
| 5 | existe `crm_campaign_messages` com `sequencia=1` | `mensagem_ausente` |
| 6 | mensagem é `whatsapp` e tem ≥20 chars | `mensagem_invalida` |
| 7 | sem placeholders `[…]` `{…}` `R$X` | `placeholder_na_mensagem` |
| 8 | mensagem contém **"responda SAIR"** | `instrucao_optout_ausente` |
| 9 | limite diário da política | `limite_diario_esgotado` |
| 10 | `fn_tiago_guardrail_whatsapp_v2` por lead | cancela a linha |

---

## §7 — Existe bloqueio humano documentado. E ele **não** é o gargalo.

`crm_campaign_autonomy_policy` (única linha):

```
ativo          = false
versao         = tiago-policy-v1
atualizado_em  = 2026-08-21T13:09:01
atualizado_por = "gpt-20260821-tiago-brevo-e2e: canario 5 concluido;
                  congelado para validar eventos/resultado"
```

A política foi **deliberadamente congelada em 21/08 após um canário de 5 envios** — e os 4
enviados + 1 erro são exatamente esses 5. Isso é decisão registrada, com autor e motivo.

Mas ela é o **gate 4**, e nenhuma campanha chega lá.

---

## §3/§9 — Cada uma das 21, e o primeiro gate que a barra

| primeiro gate que barra | campanhas | fila elegível |
|---|---|---|
| **8 — mensagem sem "responda SAIR"** | **13** | 686 |
| 5 — mensagem `sequencia=1` ausente | 4 | 43 |
| 6 — canal `email` (a função só aceita whatsapp) | 2 | 91 |
| 1 — `criado_por` inválido (`cerebro-exp001`, `agente-campanhas-crm / auditoria-manual`) | 2 | 245 |
| **4 — política desligada** | **0** | **0** |

> **Ligar a política hoje enviaria ZERO mensagens.** Nenhuma das 21 campanhas alcança o gate
> de autorização.

A maior fila isolada é `EXP-001 Reaquecimento 31-45d` (244 leads), barrada logo no gate 1
porque foi criada por `cerebro-exp001` — um autor fora do padrão que a função exige.

---

## §4 — O consumidor: não existe

- **Nenhum cron** chama `fn_tiago_autorizar_e_enfileirar`.
- **Nenhuma função** a chama.
- Em 10 dias de `pg_stat_statements`, a única ocorrência do nome é um script de migração de
  25/08 (`-- apply sql from post body -- R13 …`), **não uma invocação**.

Os únicos crons vizinhos são `refresh-mv-qualidade-campanha`, `score-leads-novos-campanha` e
`expirar-disparos-vencidos` — **nenhum envia**.

E `expirar-disparos-vencidos` chama `fn_expirar_disparos_vencidos(72)`, que expira
`waba_disparos_lista` — **não** `crm_campaign_audiences`. Por isso existe audiência pendente há
**114,8 dias** sem nunca expirar.

**O canal em si funciona:** `waba_disparos_lista` tem **762 enviados** e apenas 1
`pendente_envio`. Quem não chega lá é a fila de campanha.

---

## §10 — Pendente ≠ elegível

| | |
|---|---|
| pendentes (todas as campanhas) | **2.124** |
| **não elegíveis** (excluído ou não incluído) | **849 (40%)** |
| **elegíveis agora** | **1.275** |
| elegíveis em campanha de canal whatsapp | **1.099** |
| leads distintos na fila elegível | **564** |
| fila mais antiga | 114,8 dias |

O número operacional relevante não é 1.879 — é **1.099**, e mesmo esses só sairiam se as
mensagens fossem corrigidas.

---

## §8 — `agente-retencao`: 253 decisões, 13 efeitos

| ação | resultado | n | com efeito externo |
|---|---|---|---|
| `escalar_task_retencao` | executada | 89 | **0** |
| `reengajar_ciclo` | executada | 51 | 10 |
| `reengajar_ciclo` | convertida | 50 | 3 |
| `escalar_task_retencao` | convertida | 27 | **0** |
| `escalar_task_retencao` | **pendente_aprovacao** | **26** | **0** |
| `reengajar_ciclo` | falhou | 8 | 0 |

**142 das 253 (56%) são `escalar_task_retencao`** — que por construção não envia nada: cria
tarefa para uma pessoa. Zero efeito externo aí não é falha, é o desenho. E **26 estão
`pendente_aprovacao`**.

Quem realmente envia é `reengajar_ciclo`: 109 decisões, 13 com efeito externo.

---

## §12 — Consentimento

`leads_marketing`: **16.049 de 16.049 com `consentimento` preenchido**. Os guardrails de
exclusão da audiência foram `lead_frio` (849) e `email_guardrail_local` (90) — nenhum por falta
de consentimento. Cobertura não é o problema.

---

## §16 — Auto-refutação

| tentativa | resultado |
|---|---|
| não é humano? | **procede em parte** — a decisão humana existe e está documentada, mas é o gate 4 e nenhuma campanha chega nele |
| o cron está funcionando? | **não há cron** para esta etapa; nunca houve invocação |
| os pendentes não são elegíveis? | **procede em 40%** — 849 de 2.124 |
| as campanhas foram deixadas em draft de propósito? | **não** — draft é o estado de entrada; sair dele é automático. Elas ficaram porque falham nos gates |
| o provider está saudável? | **sim** — 762 envios via WABA |
| o conteúdo está incompleto? | **SIM, e é a causa dominante** — 13 sem opt-out, 4 sem mensagem |
| consentimento bloqueia? | **não** — 100% coberto |
| `agente-retencao` se abstém deliberadamente? | **em parte** — 56% das ações são escalar para humano, por desenho |
| os 1.879 são lixo histórico? | **40% sim**; os outros 1.275 são fila real |

---

## §13/§17 — Veredito: **MULTICAUSAL**

Em ordem de quanto cada causa realmente segura a máquina:

1. **CONFIG_INCOMPLETA / GATE_GOVERNANCA — o gargalo real.** 21 de 21 campanhas barram antes da
   autorização. 13 delas por falta da instrução de opt-out: um gate de **compliance**, não de
   aprovação. O gerador de mensagem do `agente-campanhas-crm` produz texto que a própria função
   de autorização rejeita.
2. **EXECUTOR_NAO_CONSOME.** Nenhum cron, nenhuma função e nenhuma invocação real de
   `fn_tiago_autorizar_e_enfileirar` em 10 dias.
3. **BLOQUEIO_HUMANO_PROVADO, porém não vinculante hoje.** Política congelada em 21/08 com
   autor e motivo registrados.
4. **AUDIENCIA_NAO_ELEGIVEL parcial.** 849 dos 2.124 pendentes.

### Correção do que eu disse na R68

Eu encerrei a R68 afirmando que *"o gargalo real não é dado, é que 1.879 disparos estão parados
e isso é decisão humana"*. **Estava errado.** A decisão humana existe e está documentada, mas
não é o que segura a fila: mesmo revertida, nada sairia. O que segura é conteúdo e configuração.

---

## §18 — Próximo passo, com a separação exigida

**Depende de SISTEMA** (registrado em `gap_do_mapa`, sem criar frente):
- corrigir o gerador de mensagem do `agente-campanhas-crm` para sempre incluir a instrução de
  opt-out — desbloqueia 13 campanhas e 686 leads;
- decidir o caminho de e-mail: `fn_tiago_autorizar_e_enfileirar` só trata whatsapp e não existe
  função de enfileiramento para e-mail;
- prover invocação (cron ou chamada) para a função de autorização;
- fazer `crm_campaign_audiences` expirar — hoje só `waba_disparos_lista` expira.

**Depende de HUMANO:**
- religar `crm_campaign_autonomy_policy.ativo` — mas **só faz sentido depois** do item de
  conteúdo, senão o efeito é zero;
- os 26 `escalar_task_retencao` em `pendente_aprovacao`.

**§15:** a ausência de margem por pedido continua registrada como gap separado da R68. Não
precisa ser resolvida para descobrir por que as mensagens não saem, e não foi misturada aqui.

**§14:** nenhum uplift estimado. A causalidade da reativação segue `NAO_PROVADA` desde a R68.

---

## Objetos desta rodada

**Criados:** nenhum. **Alterados:** nenhum. **Registrados:** 1 linha em `gap_do_mapa` (R69).

Verificado após a escrita: campanhas ainda 21 rascunho / 1 pausada / 1 em_execucao ·
`crm_campaign_autonomy_policy.ativo` ainda `false` · **0 mensagens enviadas** · audiências,
`crm_campaign_messages` e `waba_disparos_lista` não tocadas · 0 frentes tocadas ·
executor/GPS/tick com hashes idênticos · 93 crons ativos, nenhum alterado.
