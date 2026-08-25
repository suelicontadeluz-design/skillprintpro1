# R12 — Opt-out de WhatsApp no caminho outbound do `whatsapp-executor`

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `OPTOUT_OUTBOUND_CORRIGIDO`

Publicado nos dois lados, com hash provado. Inbound intocado e provado intocado.

---

## 1. BASELINES (reancorados antes de escrever)

| Objeto | Baseline | Confere |
|---|---|---|
| `fn_agente_automatico_pode_atender` | `716eace2fa6a736752496c8fe30de97e` (3429 b, 6 args, 1 overload) | sim |
| `fn_exp001_coorte` | `8be3ea0aa38a813c40591138624904a8` | sim |
| `fn_mapa_cerebro_v0` | `226944645b3f715d75b9a82b33211f28` | sim |
| `fn_score_lead_campanha` | `75e946c1e963357e4585487695fed871` | sim |
| `fn_crm_capturar_optout_inbound` | `10c20a94fc64e8272d27ec04c350bac5` | sim |
| `fn_fila_disparos_pendentes` | `8eeebb25371cb903eda1455103ed23f6` | sim |
| `whatsapp-executor` | v82, `ezbr_sha256 af715998…5025b`, `verify_jwt=false` | sim |
| `crm_contact_optouts` | 1 linha (`email/marketing`), 0 opt-outs WhatsApp | sim |
| `waba_disparos_lista` | 906 linhas, `lead_id NOT NULL`, 0 nulos | sim |

ACL da guarda: `{=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}`, owner `postgres`,
`SECURITY INVOKER`. Dependências (`pg_depend`): **nenhuma**.

## 2. ACHADO QUE MUDOU O FORMATO DO PATCH

O plano original (R11) era `CREATE OR REPLACE` com o parâmetro novo. **Isso teria
derrubado a produção inteira.** Provado em transação antes de publicar:

```
CREATE OR REPLACE ... (7 args)  →  passam a existir 2 funcoes (overload)

SELECT fn_agente_automatico_pode_atender(p_lead_id=>…, p_phone=>…, …6 args…)
ERROR: 42725: function ... is not unique
HINT: Could not choose a best candidate function.
```

As 4 edges chamam com **6 argumentos nomeados**. Com o overload, todas as 4 receberiam
erro — e as três fazem *fail-closed* em `rpc_error`:

- `whatsapp-executor` → `rpc_error_fail_safe`, fila para inteira
- `agente-conversacao` `modoReativo` → `rpc_error` **e grava `status='bloqueada_humano'` no lead**
- `agente-fechamento` `modoReativo` → idem

Ou seja: os dois agentes de INBOUND parariam de responder clientes **e corromperiam o
estado das conversas**. Por isso o patch é **DROP + CREATE atômico**, não `CREATE OR REPLACE`.

## 3. DIFF SQL

Assinatura: `+ p_checar_optout_whatsapp boolean DEFAULT false` (7º argumento).
Corpo: **+629 bytes**, um único bloco novo, inserido como Guarda 1.5 (depois da pausa
global da Júlia, antes da Guarda 2 de estado — vontade do cliente precede heurística):

```sql
IF p_checar_optout_whatsapp AND EXISTS (
  SELECT 1 FROM crm_contact_optouts o
  WHERE o.lead_id = p_lead_id
    AND o.canal = 'whatsapp'
    AND o.revogado_em IS NULL
) THEN
  RETURN jsonb_build_object('pode', false, 'motivo', 'optout_whatsapp');
END IF;
```

O corpo publicado foi **derivado do LIVE por `replace()`**, com `RAISE EXCEPTION` se o
md5 do baseline **ou** o md5 do candidato divergisse do pré-computado. Nenhuma outra
regra da função foi tocada.

| | md5(prosrc) | bytes |
|---|---|---|
| baseline | `716eace2fa6a736752496c8fe30de97e` | 3429 |
| candidato pré-computado | `d22ac0fd2e6d57c4fd183c717272ae59` | 4058 |
| **LIVE pós-deploy** | **`d22ac0fd2e6d57c4fd183c717272ae59`** | **4058** |

Funções com esse nome após o deploy: **1**. ACL preservada byte a byte.

## 4. DIFF EDGE (v12 → v13, versão 83)

Exatamente 4 regiões, 2 comportamentais:

```diff
-  if (!leadId) return { pode: true, motivo: 'sem_lead_id_skip_guard' };
+  if (!leadId) {
+    log('guard', 'sem_lead_id_fail_closed', { phone });
+    return { pode: false, motivo: 'sem_lead_id_fail_closed' };
+  }

-      p_respeitar_julia_pausa: true
+      p_respeitar_julia_pausa: true,
+      p_checar_optout_whatsapp: true
```
(+ rótulo de versão `v12`→`v13` em `log()` e no meta do `cron_log_start`.)

`verify_jwt` mantido em `false` (igual ao baseline).

## 5. PROVA DE QUE `DEFAULT false` PRESERVA OS CHAMADORES

Contra a função **já publicada**:

| forma de chamada | quem usa | resultado |
|---|---|---|
| 6 args **nomeados** | as 4 edges (via PostgREST) | `{"pode":true,"motivo":"ok"}` |
| 6 args **posicional** | compatibilidade | `{"pode":true,"motivo":"ok"}` |
| só `p_lead_id` | defaults puros | `{"pode":true,"motivo":"ok"}` |

Nenhuma ambiguidade: existe **uma** função, e o 7º argumento cai no default.

## 6. PROVA DE INBOUND INTACTO

Com opt-out de WhatsApp **ativo** no lead:

| Teste | Chamada | Resultado |
|---|---|---|
| T7 | `agente-conversacao modoReativo` (params reais, sem a flag) | **`pode=true, ok`** |
| T8 | `agente-fechamento modoReativo` (`p_checar_purchase=false`) | **`pode=true, ok`** |

O cliente que deu opt-out de outbound **continua sendo atendido normalmente quando ele
mesmo escreve**. Invariante cumprida.

## 7. PROVA DE OUTBOUND BLOQUEADO — a cadeia

```
waba_disparos_lista (lead_id NOT NULL)
  └→ fn_fila_disparos_pendentes(p_limite:3)
     └→ whatsapp-executor v13 · linha 174: agentePodeAtender(leadIdStr, item.phone, !veraOk)
        └→ rpc fn_agente_automatico_pode_atender(..., p_checar_optout_whatsapp: true)
           └→ Guarda 1.5: opt-out whatsapp ativo → {"pode":false,"motivo":"optout_whatsapp"}
              └→ linha 175 if (!guard.pode) → fn_marcar_disparo_erro + gravarLog + continue (linha 190)
```

**T10 — bloqueio antes de qualquer chamada externa.** O único envio externo é
`enviarMensagem` (`POST .../send_message/`), invocado **uma única vez**, na linha 202.
A guarda está na 174 e o `continue` na 190. A linha 202 é inalcançável sem passar pela
guarda. O `get_by_phone` (`resolverSubscriberId`, linha 193) é *lookup*, não envio, e
também está depois da guarda.

## 8. REFUTAÇÃO

| Ataque ao patch | Resultado |
|---|---|
| `DEFAULT false` preserva todos os chamadores? | **Sim** — provado nas 3 formas de chamada |
| Chamada posicional quebra com o arg novo? | **Não** — 6 posicionais resolvem, 7º default |
| Existe overload? | **Existiria, e era fatal.** Detectado e eliminado com DROP+CREATE. `n_funcoes = 1` |
| Edge pode esquecer de passar `true`? | Pode — e aí a proteção fica inativa, **não** vira bloqueio errado. Falha para o lado seguro do cliente. Mitigado pelo `versao: v13` no `cron_execution_log` |
| Algum branch do executor envia antes da guarda? | **Não** — único envio na linha 202, guarda na 174 |
| Opt-out de e-mail poderia bloquear WhatsApp? | **Não** — `canal='whatsapp'` no predicado; testado com a linha real do `brevo_hard_bounce`: `pode=true` |
| `revogado_em` é a semântica certa de "ativo"? | **Sim** — CHECK do schema não define outra; testado: revogado → `pode=true` |
| `lead_id` do opt-out pode divergir da fila? | **Não** — FK para `leads_marketing(lead_id)`, e telefone→lead é 1:1 (15.980/15.980, máx 1) |
| Fail-closed em `lead_id` ausente bloqueia fila legítima? | **Não** — `waba_disparos_lista.lead_id` é `NOT NULL`; 0/940 no histórico. Remove código morto |
| Cache de schema do PostgREST ficaria velho após DROP? | **Não** — `pgrst_ddl_watch` e `pgrst_drop_watch` ativos; + `NOTIFY pgrst` explícito. Confirmado na prática (item 10) |

## 9. DEPLOY

- **14:44:xx** — migration `r12_optout_whatsapp_gate_outbound_only`. LIVE = `d22ac0fd…`, 1 função, ACL preservada.
- **14:44:50** — edge v83. ACTIVE re-baixada e comparada byte a byte com o candidato:
  `md5 = 42c9d80ce1456887afdd32ecaf34db8d` nos três (ACTIVE, candidato, arquivo do repo). **0 diferenças.**

Janela entre os dois deploys: sem estado enganoso. Com o SQL publicado e o executor
ainda em v12, o comportamento era **idêntico ao anterior** (`DEFAULT false`) — proteção
ainda não ativa, nunca bloqueio indevido.

## 10. VERIFICAÇÃO EM PRODUÇÃO REAL

O cron do `whatsapp-executor` disparou **depois** do deploy:

```
cron_execution_log · 14:45:05 · status=success · rows=3 · error_msg=null · meta.versao="v13"
```

Esta é a prova mais forte de T9: o v13 está no ar, passando `p_checar_optout_whatsapp: true`,
e o RPC de 7 argumentos **resolveu normalmente pelo PostgREST**. Se a assinatura ou o cache
tivessem quebrado, os 3 itens teriam virado `bloqueado_guard: rpc_error_fail_safe` — nenhum virou.

## 11. TESTES

| # | Teste | Resultado |
|---|---|---|
| T1 | outbound normal continua permitido | `pode=true, ok` |
| T2 | opt-out WhatsApp bloqueia outbound | `pode=false` |
| T3 | motivo explícito | `optout_whatsapp` |
| T4 | opt-out de e-mail não bloqueia WhatsApp | `pode=true` |
| T5 | hard bounce não bloqueia | `pode=true` |
| T6 | revogado não bloqueia | `pode=true` |
| T7 | inbound `agente-conversacao` continua atendendo | `pode=true` |
| T8 | inbound `agente-fechamento` continua atendendo | `pode=true` |
| T9 | executor passa `flag=true` | v13 rodou em produção 14:45, sem erro |
| T10 | nenhum branch envia antes da guarda | único envio na l.202, guarda na l.174 |
| T11 | `sem_lead_id` agora fail-closed | `pode:false, sem_lead_id_fail_closed` |
| T12 | zero mensagem externa **minha** | ver ressalva abaixo |
| T13 | EXP-001 intacto | `8be3ea0a…` |
| T14 | MAPA/score/captura/fila/Júlia intactos | hashes conferem |
| T15 | rollback SQL provado | reconstrói `716eace2…`, 6 args, `n=1` |
| T16 | rollback edge disponível | v12 salvo, diff = 4 regiões |
| T17 | candidato == LIVE nos dois artefatos | `d22ac0fd…` e `42c9d80c…` |

### Ressalva honesta sobre T12

**Eu não enviei nenhuma mensagem.** Todos os meus testes rodaram em `BEGIN … ROLLBACK`,
sem resíduo (`TESTE_R12* = 0`, `crm_contact_optouts` segue com 1 linha).

Mas **a operação normal da empresa enviou 3 mensagens** às 14:45:06, 14:45:50 e 14:47:02,
pelo cron de 15 em 15 minutos, dentro da janela comercial. Não foram causadas pela mudança:
os 3 leads não têm opt-out, então teriam sido enviadas igual sob o v12. Registro isso
explicitamente para não afirmar "zero mensagens externas" de forma enganosa — o número
zero vale para o que **eu** fiz, não para o sistema, que segue operando.

## 12. ROLLBACK

Artefatos em `ops/cerebro/`:

- `fn_agente_automatico_pode_atender_R12_ROLLBACK.sql` — volta para 6 args e md5 `716eace2…`, com assert nos dois lados. **Provado em transação.**
- `whatsapp-executor_v12_ROLLBACK.ts` — v12 íntegro (era a versão 82).

**Ordem obrigatória: edge primeiro, SQL depois.** Se a função voltar para 6 argumentos
enquanto o executor v13 ainda enviar `p_checar_optout_whatsapp`, o PostgREST recusa e o
executor entra em `rpc_error_fail_safe` — a fila para. Fail-closed, mas para.

## 13. PRÓXIMO PASSO MÍNIMO

O gate está armado mas **não tem o que bloquear: existem 0 opt-outs de WhatsApp na base**
(R10 provou que as "97 recusas" não eram opt-out). A proteção é garantia futura.

Próximo passo mínimo, uma coisa só: **fazer a captura de opt-out de WhatsApp existir**,
com precisão auditável e sem LLM, alimentando `crm_contact_optouts` com `canal='whatsapp'`.
Sem isso, o gate nunca dispara.

Depois disso, e só depois: avaliar o site 2 (`agente-conversacao` `modoProativo`), que é o
outro caminho outbound. Os sites 3 e 4 (inbound) **nunca**.

EXP-001 continua congelado.
