# R19 — Segunda origem de WhatsApp: mapeamento e patch mínimo

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** diagnóstico, nada publicado

## VEREDITO: `MULTIORIGEM_PATCH_MINIMO`

O **inbound já é multi-origem por construção**. O **outbound é mono-origem de verdade**.
A distância entre os dois é pequena e enumerável — não é uma arquitetura nova.

---

## 1. ARQUITETURA ATUAL DE ORIGEM

### Inbound — já carrega a origem

```
Z-API (webhook)
  └→ insert_zapi_inbox_atomic(p_instance_id, p_connected_phone, p_message_id, …)
       └→ zapi_webhook_inbox   ← instance_id NOT NULL + connected_phone
            └→ (status='forwarded') → zapi-ingest v128 → agentes → fact_conversations
```

`zapi_webhook_inbox` tem **254.457** linhas com uma única instância real:

| `instance_id` | `connected_phone` | n (7d) |
|---|---|---|
| `3E3FDA4A904550C350F33E61E96978DB` | **5511992769857** | 11.501 |
| — | (null, eventos de status) | 838 |

A porta de entrada **já é parametrizada por instância**. Isso não precisa ser criado.

### Outbound — não carrega origem em lugar nenhum

| Tabela | Coluna de origem/linha? |
|---|---|
| `waba_disparos_lista` | **não** — `origem_agente` é qual *agente*, não qual *linha* |
| `whatsapp_executor_log` | **não** — tem `zapi_status`/`zapi_response`, nenhuma instância |
| `fact_conversations` | **não** — `source` ∈ {bruno, joao, joao_visao, joao_whisper, julia, marcos, zapi} = agente |
| `mensagem_envio` | **parcial** — `canal` ∈ {`zapi`, `botconversa`} distingue *provider*, não *linha* |
| `sistema_config` | **nenhuma** chave de zapi/instância/número |

Credenciais vivem **só em variáveis de ambiente das edges** (`ZAPI_INSTANCE_ID`,
`ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `API-KEY`). Não há registro de origens como dado.

## 2. PONTOS HARDCODED

| Onde | O quê |
|---|---|
| `whatsapp-executor` v13 | **só BotConversa**: `POST ${BOT_BASE}/subscriber/{sid}/send_message/` com header `API-KEY`. **Não passa número nem instância** — a linha é o que a conta do BotConversa tiver |
| `agente-fechamento` v6.4 | Z-API primário com `ZAPI_INSTANCE_ID` do env + **fallback BotConversa** |
| `agente-conversacao`, João | Z-API com a mesma instância de env |
| `zapi-ingest` v128 | **ignora `instanceId`/`connectedPhone` por completo** — roteia só por telefone |
| `whatsapp-webhook` v86 | idem; grava `fact_conversations.source` = provider/agente |

**O ponto que mais importa para o EXP-001:** o executor manda por **BotConversa**, e a API
do BotConversa não tem parâmetro de número — a linha é propriedade da conta/`API-KEY`.
Z-API, ao contrário, já tem a instância na própria URL.

## 3. SUPORTE EXISTENTE

| Procurei | Achei |
|---|---|
| `instance_id` | **sim** — `zapi_webhook_inbox.instance_id`, e como parâmetro de `insert_zapi_inbox_atomic` |
| `connected_phone` | **sim** — `zapi_webhook_inbox.connected_phone` |
| `provider` | sim, mas em outro sentido: `crm_campaigns.provider`, `joao_envios.provider`, `mensagem_envio.canal` |
| `sender_id` / `numero_origem` / `canal_id` / `connection_id` | **não existem** para WhatsApp |
| registro de origens (tabela) | **não existe** |

Conclusão: reutilizar `instance_id` + `connected_phone` no inbound; **criar o mínimo** no outbound.

## 4. FLUXO OUTBOUND COM SEGUNDA ORIGEM

```
fn_exp001_registrar_intervencao(lead, enfileirar=true, msg)
  └→ waba_disparos_lista (+ origem_slug='exp001')        ← 1 coluna nova
       └→ fn_fila_disparos_pendentes  (devolve origem_slug)
            └→ whatsapp-executor v14
                 ├ origem_slug='exp001' → Z-API instância EXP  ← credencial nova
                 ├ origem ausente/desconhecida → NÃO ENVIA (fail-closed)
                 └ SEM fallback para a linha principal
                      └→ whatsapp_executor_log (+ origem_slug)  ← 1 coluna nova
```

## 5. FLUXO INBOUND COM SEGUNDA ORIGEM

A resposta chega — e chega **no lead certo**:

```
cliente responde na linha 2
  └→ Z-API instância EXP → insert_zapi_inbox_atomic(instance_id='<EXP>', connected_phone='<linha 2>')
       └→ zapi_webhook_inbox  ← origem preservada e auditável
            └→ zapi-ingest → resolve lead pelo TELEFONE DO CLIENTE (não pela linha)
                 └→ fact_conversations (lead_id correto)
                      └→ fn_exp001_resultado enxerga o inbound → métrica funciona
```

**A identificação do lead é pelo telefone do cliente, não pela linha.** Por isso a métrica
do EXP-001 funciona sem nenhuma mudança.

### O vazamento real de isolamento

`zapi-ingest` **não sabe em qual linha a mensagem chegou**. Então um lead que responder ao
experimento seria roteado para Júlia/Bruno/João normalmente — e esses agentes responderiam
**pela linha principal**. Do ponto de vista do cliente: ele recebe do número 2 e é
respondido pelo número 1. Conversa quebrada, e o isolamento que você quer some.

Mitigação mínima (item 8, passo 5): um guard no topo do `zapi-ingest` — se a mensagem veio
da instância do experimento, **não acionar agente proativo**; registrar e deixar para humano.

## 6. OPT-OUT — funciona sem nenhuma mudança

`fn_crm_capturar_optout_inbound` é trigger em `fact_conversations`, chaveado por `lead_id`,
e grava `canal='whatsapp'` — **sem qualquer noção de linha**. Logo:

- um "SAIR" na linha 2 vira `crm_contact_optouts(lead_id, canal='whatsapp')`;
- o guard do R12 (`optout_whatsapp`) bloqueia outbound futuro **nas duas linhas**;
- **não há fragmentação por número**, e não é preciso criar opt-out por linha.

Isso é o comportamento certo: o cliente pediu para a *empresa* parar, não para *um número*.

## 7. OBSERVABILIDADE

| Pergunta | Hoje |
|---|---|
| "Esta resposta chegou em qual número?" | **SIM** — `zapi_webhook_inbox.instance_id` + `connected_phone` |
| "Esta mensagem saiu por qual número?" | **NÃO** — nenhuma coluna, em nenhuma tabela |

É exatamente metade do problema, e é a metade barata de resolver.

## 8. PATCH MÍNIMO (especificado, **não** implementado)

Não implementei nada: depende de credencial e número que ainda não existem, e o item 7 do
seu pedido é explícito quanto a isso. O conjunto mínimo, quando a linha existir:

| # | Mudança | Tipo |
|---|---|---|
| 1 | `waba_disparos_lista + origem_slug text` (null = linha principal, comportamento atual) | 1 coluna |
| 2 | `whatsapp_executor_log + origem_slug text` | 1 coluna |
| 3 | `fn_fila_disparos_pendentes` devolve `origem_slug` | +1 campo no RETURNS |
| 4 | `fn_exp001_registrar_intervencao` grava `origem_slug='exp001'` ao enfileirar | ~1 linha |
| 5 | `whatsapp-executor` v14: seleciona credencial por `origem_slug`; **fail-closed** se a origem for desconhecida ou a credencial faltar; **sem fallback** para a principal | edge |
| 6 | `zapi-ingest`: guard no topo — inbound da instância do experimento não aciona agente proativo | edge |
| 7 | Secrets: `ZAPI_INSTANCE_ID_EXP`, `ZAPI_TOKEN_EXP`, `ZAPI_CLIENT_TOKEN_EXP` | config |

Nada disso cria arquitetura nova: são duas colunas, dois campos e dois guards.

**Não incluí** tabela de registro de origens. Com duas linhas, `origem_slug` + secrets
resolve. Uma tabela só se justifica a partir da terceira.

## 9. O QUE DEPENDE DE PROVISIONAMENTO EXTERNO

1. **Um segundo número de telefone** (chip/linha), que não pode estar em uso no WhatsApp Business da linha 1.
2. **Uma segunda instância Z-API** apontada para esse número (a Z-API cobra por instância).
3. **Webhook da instância nova** apontando para o mesmo ingest que a atual.
4. Aquecimento do número novo — número novo disparando 244 mensagens tem risco de bloqueio pelo próprio WhatsApp. Isso é risco de plataforma, não de código.

**Alternativa que evita Z-API nova:** uma segunda conta BotConversa com seu próprio
`API-KEY`. Mantém o executor no provider que ele já usa (só troca o header), mas custa
outra assinatura e não melhora observabilidade de saída.

## 10. REFUTAÇÃO

| Ataque | Resposta |
|---|---|
| Segunda Z-API isola risco de verdade? | **Do número principal, sim** — instância e número são distintos. Não isola risco de *marca*: bloqueio do número 2 não derruba o 1, mas reclamação ainda é da Skillprint |
| BotConversa continuaria apontando para o número antigo? | **Sim.** A `API-KEY` é da conta, e a conta tem um número. Por isso o executor precisa sair do BotConversa para o EXP-001, ou ganhar uma segunda `API-KEY` |
| Inbound poderia chegar sem identificar origem? | Na tabela de entrada, **não** (`instance_id` é NOT NULL). Mas a origem **se perde** antes de `fact_conversations` |
| Algum edge hardcoda a instância atual? | **Sim** — `agente-fechamento`, `agente-conversacao` e João leem `ZAPI_INSTANCE_ID` do env, uma só |
| Fila sabe escolher sender? | **Não.** É o item 1 do patch |
| Logs misturariam números? | **Hoje sim**, e sem como separar. É o item 2 |
| Resposta no número 2 cai no João/Júlia corretamente? | **Cai — e esse é o problema.** Cairia como se fosse a linha 1, e a resposta sairia pelo número errado. É o item 6 |
| Opt-out ficaria fragmentado? | **Não.** É por `lead_id` + `canal='whatsapp'`, sem linha |
| Fallback poderia atingir o número principal? | **Hoje sim** — `agente-fechamento` já faz Z-API→BotConversa. O item 5 exige fail-closed sem fallback para a origem do experimento |

## 11. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é externa: **provisionar a segunda linha** — número + instância Z-API +
webhook apontado para o ingest atual.

Enquanto isso não existir, implementar os itens 1–6 seria construir encanamento para uma
água que não chega, com risco de alguém ligar por engano. Quando a linha existir, o patch
é pequeno o bastante para caber em uma rodada, e eu já sei exatamente quais são as duas
colunas, os dois campos e os dois guards.

## Estado preservado (nada foi alterado)

| | |
|---|---|
| snapshot T0 | **456**, hash reconstruído `865e8672…` = hash T0 |
| campanha | **`rascunho`** |
| mensagem | `1c389fe45c074b24626f45fa18060e7e` |
| fila EXP-001 / envios EXP-001 | **0** / **0** |
| `fn_exp001_resultado` / `fn_exp001_coorte` | `9fa6afb4…` / `195f25da…` |
| transação de escrita | nenhuma (`pg_current_xact_id_if_assigned()` nulo em todas as leituras) |

EXP-001 continua congelado. Zero mensagens nesta rodada.
