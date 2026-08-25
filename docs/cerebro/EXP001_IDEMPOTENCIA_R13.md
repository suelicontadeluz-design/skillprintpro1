# R13 — Idempotência real do EXP-001: no máximo 1 intervenção por lead

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `IDEMPOTENCIA_EXP_CORRIGIDA`

Com um achado que muda a resposta: **o modelo atual já suportava a invariante**.
Nenhuma tabela, coluna ou índice novo foi criado. O que faltava era um **produtor**
que fornecesse a identidade da intervenção.

---

## 1. BASELINE

`waba_disparos_lista` — 906 linhas, 680 leads distintos, `lead_id NOT NULL`.

Índices:

| Índice | Definição | Protege até quando |
|---|---|---|
| `uq_waba_lead_pendente_ou_ativo` | `UNIQUE(lead_id) WHERE status IN ('ativo','pendente_envio')` | **só enquanto pendente** — some ao virar `enviado` |
| `uq_waba_disparos_lead_ativo` | `UNIQUE(lead_id) WHERE status='ativo'` | idem, mais estreito |
| **`uq_waba_campaign_audience`** | **`UNIQUE(campaign_audience_id) WHERE campaign_audience_id IS NOT NULL`** | **sempre — não tem predicado de status** |

Triggers: `trg_marcar_acao_executada`, `trg_vera_waba_status` (só `evento='vigia_ciclo_compra'`).
Produtores que inserem na fila: `upsert_waba_disparo_safe` (2 overloads), `fn_crm_task_to_disparo`,
`fn_vigia_leads_mornos`, `fn_vigia_ciclo_compra`, `fn_tiago_autorizar_e_enfileirar`.
Nenhuma função faz `DELETE` na fila. Nenhuma zera `campaign_audience_id`.

## 2. DUPLICIDADES HISTÓRICAS — separando A de B

| Medida | Valor |
|---|---|
| leads com 2+ disparos | **151** |
| máximo por lead | **11** |
| menor intervalo, `evento` diferente | 13,98 h |
| menor intervalo, **mesmo `evento`** | **1,17 h** |
| leads dup. com **todas** as linhas sem `campaign_audience_id` | **151 de 151** |
| leads com 2+ `campaign_audience_id` distintos | **0** |

**A (legítimo):** 82 leads com `evento` diferente entre os disparos — campanhas distintas.
**B (indevido):** 69 leads com o **mesmo** `evento` repetido; o par de 1,17 h é o caso mais claro.

**O índice que protegeria nunca foi violado — ele nunca foi exercido.** 901 das 906 linhas
têm `campaign_audience_id NULL`, e índice parcial não cobre NULL. Só as 5 linhas de
`evento='crm_campaign'` (fluxo do Tiago) carregam a chave.

## 3. MODELO ATUAL DE IDENTIDADE — já existe, completo

```
crm_campaigns.slug                                    UNIQUE   → identidade do experimento
   └─ crm_campaign_audiences  UNIQUE(campaign_id, lead_id)     → identidade da INTERVENÇÃO
        └─ waba_disparos_lista UNIQUE(campaign_audience_id)
                               WHERE campaign_audience_id IS NOT NULL
                                                                → 1 disparo por intervenção,
                                                                  em QUALQUER status
```

Procurei antes de criar: `campaign_audience_id`, `ai_decision_id`, `origem_agente`,
`evento`, `crm_task_id`, `execution_id`, `decision_id`, `provider_message_id`.
A combinação `campaign_id + lead_id` já é exatamente `experimento + lead`.

## 4. CHAVE ESCOLHIDA — reutilizada, não criada

`crm_campaigns.slug = 'EXP-001-REAQUECIMENTO-31-45D'` → `campaign_id`,
e então **`UNIQUE(campaign_id, lead_id)`**.

Não é `UNIQUE(lead_id)` global: EXP-002 no mesmo lead continua possível (T4 prova).

## 5. SEMÂNTICA DE RETRY — derivada do executor real

O executor é **cron fire-and-forget**: `Deno.serve` roda a cada 15 min, processa até 3 e
**ninguém recebe ack por lead**. Não existe chamador capaz de distinguir "enfileirado mas
não processado" de "processado". Daí:

| Estado | Como se observa hoje | Retry permitido? |
|---|---|---|
| `NUNCA_ENFILEIRADO` | sem linha em `crm_campaign_audiences` | **Sim** |
| `ENFILEIRADO` | audience existe; fila `ativo`/`pendente_envio` | **Não** |
| `SUBMETIDO` | fila `enviado`, `last_sent_at`, `api_response` | **Não** |
| `ECO_CONFIRMADO` | `whatsapp_executor_log.status='enviado'` + `zapi_status` | **Não** |
| `FALHA_ANTES_ENVIO` | fila `bloqueado`, `motivo_bloqueio='guard_bloqueou:…'` | **Não** — ver abaixo |
| `FALHA_DEPOIS_SUBMISSAO` | fila `erro`, `HTTP xxx` em `erro_msg` | **Não** — pode ter chegado |
| `DESCONHECIDO` | qualquer outro | **Não** (fail-closed) |

**Momento em que a intervenção se torna irrepetível: `ENFILEIRADO`.** Justificativa, não
simplificação:

- Tecnicamente, `FALHA_ANTES_ENVIO` **não** enviou mensagem (provado em R12: guarda na
  linha 174, envio na 202). Um retry não duplicaria mensagem.
- Mas para um **experimento causal**, tratar o lead num momento diferente do resto da
  coorte quebra a comparabilidade. O lead bloqueado pelo guard é um lead que a política
  disse para não contatar.
- O erro de reenviar para um cliente real é muito pior que o de perder um lead. E o lead
  perdido é **contável**: `status='bloqueado'` com `campaign_audience_id` preenchido vira
  atrito de coorte medido, não perda silenciosa.

Quem quiser uma rodada de retry: isso é **EXP-001b**, slug novo. A invariante continua de pé.

## 6. DESENHO MÍNIMO

Opção escolhida: **(C) usar a chave derivada que já existe**. Zero DDL de schema.
Uma função nova, `fn_exp001_registrar_intervencao(p_lead_id, p_enfileirar, p_mensagem)`.

Duas travas de segurança, ambas com mecanismo já existente:

1. **Enfileirar exige `crm_campaigns.status='aprovada'`.** A campanha nasce `rascunho`,
   então enquanto EXP-001 estiver congelado o ramo de enfileiramento **nunca executa**.
   Verificado: retorna `motivo_nao_enfileirou: "experimento_nao_armado"`.
2. **`criado_por='cerebro-exp001'`.** `fn_tiago_autorizar_e_enfileirar` recusa qualquer
   campanha cujo `criado_por` não case com `agente-campanhas-crm-%` (`autor_invalido`), e
   também exigiria `crm_campaign_messages` que esta campanha não tem. Logo o fluxo do
   Tiago **não pode** disparar EXP-001 por conta própria.

## 7. CONCORRÊNCIA

A garantia é **estrutural**: índice único. Não há `SELECT`-depois-`INSERT` no caminho de
decisão — o `INSERT ... ON CONFLICT DO NOTHING` resolve no próprio índice.

Provado que o índice rejeita atomicamente quando não se usa `ON CONFLICT`:

| Inserção duplicada | Resultado |
|---|---|
| `crm_campaign_audiences` (campaign_id, lead_id) | `SQLSTATE 23505 unique_violation` |
| `waba_disparos_lista` (campaign_audience_id) | `SQLSTATE 23505 unique_violation` |

**Limite honesto:** não consegui abrir duas conexões simultâneas desta sessão — `dblink`
e `pg_background` não estão instalados, e eu **não** usei `pg_net` contra a fila real
porque uma linha inserida seria enviada pelo cron de 15 min. Então provei a propriedade
que torna a concorrência segura (unicidade atômica no índice + `ON CONFLICT`), não uma
corrida entre duas sessões vivas. Em Postgres o segundo inserter da mesma chave bloqueia
no lock do índice e depois falha (23505) ou vira no-op com `ON CONFLICT` — não há janela.

**Detalhe que quebraria o produtor:** o índice é **parcial**, então
`ON CONFLICT (campaign_audience_id) DO NOTHING` falha com `42P10`. É obrigatório repetir
o predicado: `ON CONFLICT (campaign_audience_id) WHERE campaign_audience_id IS NOT NULL`.

## 8. IMPACTO SIMULADO

Se a chave tivesse sido usada em todo o histórico, agrupando por `(lead_id, evento)`:
**130 de 906 linhas (14,35%)** teriam sido rejeitadas como duplicata da mesma intervenção,
em 105 pares. As demais 776 seguiriam normais.

Sobre a fila hoje: **impacto zero**. As 901 linhas com `campaign_audience_id NULL`
continuam operando sem nenhuma restrição nova (T11 prova).

## 9. PATCH E DEPLOY

Migration `r13_exp001_idempotencia_por_intervencao`. Um único objeto novo.

| | valor |
|---|---|
| assinatura | `fn_exp001_registrar_intervencao(uuid, boolean, text)` |
| LIVE `md5(prosrc)` | `4b3c979bf5adf5484f302d5631d85b29` (3580 bytes) |
| overloads | 1 |
| linhas de dado escritas nesta rodada | **0** |

A campanha EXP-001 **ainda não existe** — a função a cria na primeira chamada. Como não a
chamei em produção, esta rodada é DDL pura.

## 10. TESTES

| # | Teste | Resultado |
|---|---|---|
| T1 | primeira intervenção aceita | `intervencao_registrada` |
| T2 | segunda tentativa da mesma | `ja_registrado` (no-op) |
| T3 | protege depois de `enviado` | `enfileirado:false, ja_enfileirado:true` — **1 linha na fila** |
| T4 | EXP-002 no mesmo lead | permitido |
| T5 | outro lead no EXP-001 | permitido |
| T6 | concorrência | `23505` atômico nos dois índices (limite no item 7) |
| T7 | retry após timeout | `ja_registrado` |
| T8 | cron repetido | `enfileirado:false, ja_enfileirado:true` |
| T9 | opt-out independente | A `pode=true` · C `pode=false, optout_whatsapp` · D revogado `pode=true` |
| T10 | inbound intacto | `agente-conversacao` e `agente-fechamento` seguem `pode=true` com opt-out ativo |
| T11 | fila fora do EXP continua | insert com `cca NULL` funciona |
| T12 | zero mensagem externa | 0 linhas escritas; fila 906 e audiências 1982 inalteradas; resíduo de teste 0 |
| T13 | EXP-001 congelado | campanha nem existe; `experimento_nao_armado` |
| T14 | coorte intacta | `fn_exp001_coorte` = `8be3ea0a…` |
| T15 | nada fora do escopo | MAPA, guarda opt-out, fila, score, upsert, Tiago — todos com hash igual |
| T16 | rollback provado | `DROP` deixa 0 funções, em transação |
| T17 | candidato == LIVE | `4b3c979bf5adf5484f302d5631d85b29`, 3580 bytes, nos dois |

## 11. AUTO-REFUTAÇÃO

| Pergunta | Resposta |
|---|---|
| Confundindo campanha com experimento? | Não — `crm_campaigns` é o container genérico; o slug é que dá o significado de experimento. Reuso, não confusão |
| Uma campanha pode ter 2 mensagens legítimas? | Sim, e `crm_campaign_messages.sequencia` já modela isso. **EXP-001 é de dose única por desenho.** Uma sequência multietapa precisaria de chave por etapa — fora de escopo, e registrado aqui |
| Existe sequência multietapa hoje? | Sim no schema (`sequencia`), não em uso pelo EXP-001 |
| Falha antes de qualquer envio libera retry? | **Não** — decisão justificada no item 5 |
| Falha depois da submissão sem eco? | **Não** — pode ter chegado |
| Como distinguir retry legítimo de duplicidade? | Não dá, com a observabilidade atual. Por isso fail-closed |
| Algum fluxo depende de reenfileirar o mesmo lead? | Sim — `vigia_leads_mornos`, `vigia_ciclo_compra`, `crm_task`. **Nenhum é tocado**: continuam com `cca NULL` |
| Índice único quebraria campanhas existentes? | Não criei índice nenhum. O existente já vigora e nunca foi violado |
| "1 linha para sempre" é simplificação? | Seria, se eu não tivesse fixado o ponto de consumo. Fixei em `ENFILEIRADO`, com justificativa |

## 12. PRÓXIMO PASSO MÍNIMO

A garantia existe mas **ainda não protege ninguém**: nenhuma intervenção do EXP-001 está
registrada, porque a função nunca foi chamada.

Próximo passo, uma coisa só: **registrar a coorte de tratamento** (246 leads do braço
TRATAMENTO de `fn_exp001_coorte`) chamando a função com `p_enfileirar=false`. Isso congela
a identidade das intervenções sem enviar nada e sem enfileirar nada — e a partir daí
qualquer tentativa de dose dupla vira `ja_registrado`.

Só depois, e como decisão separada e explícita: mudar a campanha para `aprovada`.

EXP-001 permanece congelado. Zero mensagens nesta rodada.
