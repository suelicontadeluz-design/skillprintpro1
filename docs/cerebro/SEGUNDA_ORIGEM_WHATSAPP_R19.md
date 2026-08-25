# R19 — Segunda origem de WhatsApp: mapeamento e patch mínimo

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** diagnóstico, nada publicado
**Revisão 2** — corrige três afirmações da primeira passagem, que eu tinha inferido em vez de medir.

## VEREDITO: `MULTIORIGEM_PATCH_MINIMO`

O caminho de entrada **já é multi-origem de ponta a ponta**, e a origem **já chega gravada**
em `fact_conversations`. O que falta é o outbound saber *escolher* a linha. O patch é menor
do que eu disse antes.

---

## 0. CORREÇÕES À PRIMEIRA PASSAGEM

| Eu havia dito | Medição |
|---|---|
| "a origem se perde antes de `fact_conversations`" | **Errado.** `raw_payload->>'instanceId'` e `connectedPhone` estão em **11.486 de 11.486** linhas `source='zapi'` (7d) — 100%, nos dois sentidos |
| "'Esta mensagem saiu por qual número?' → NÃO" | **Errado.** Dá para responder hoje, pelo espelho Z-API |
| levantei Make.com como possível orquestrador | **Refutado.** `make_status_code` é nulo em 100% das linhas recentes; são colunas legado. O receptor real é a edge `super-endpoint` v92 |

## 1. ARQUITETURA ATUAL DE ORIGEM

```
Z-API (instância única)
  └→ super-endpoint v92  (verify_jwt=false — é esta a porta de entrada real)
       ├ EXIGE instanceId: sem ele devolve 400 missing_required_fields
       ├→ insert_zapi_inbox_atomic(p_instance_id, p_connected_phone, …) → zapi_webhook_inbox
       ├→ whatsapp_message_log (payload completo, com instanceId)
       ├→ fact_conversations (source='zapi', raw_payload completo) ← ESPELHO
       └→ encaminha o PAYLOAD ORIGINAL para zapi-ingest v128 → agentes
```

`whatsapp-webhook` v86 tem `verify_jwt=true` — a Z-API **não consegue chamá-la**. Não está
no caminho vivo; quem grava `source='zapi'` é o `super-endpoint`.

**O espelho é o superconjunto.** Em 7 dias:

| source | direção | n | com `instanceId` |
|---|---|---|---|
| `zapi` | outbound | 5.841 | **5.841 (100%)** |
| `zapi` | inbound | 5.645 | **5.645 (100%)** |
| `joao` | outbound | 828 | 0 |
| `julia` | outbound | 715 | 0 |
| `bruno` / `marcos` | outbound | 9 / 5 | 0 |

O espelho (5.841) é maior que a soma dos agentes (1.557) porque a Z-API devolve `fromMe=true`
para **tudo** que sai na linha — agente, humano no WhatsApp Web, e também o que o BotConversa
manda, já que hoje é o mesmo número. As linhas dos agentes são uma **segunda cópia** da mesma
mensagem, escritas por eles sem payload.

Instância e número medidos, únicos: `3E3FDA4A904550C350F33E61E96978DB` / **5511992769857**.

## 2. PONTOS HARDCODED

| Onde | O quê |
|---|---|
| `whatsapp-executor` v13 | **só BotConversa** (`/subscriber/{id}/send_message/` + header `API-KEY`). A API **não tem parâmetro de número** — a linha é propriedade da conta |
| `agente-fechamento` v6.4 | Z-API `ZAPI_INSTANCE_ID` do env + **fallback BotConversa** |
| `agente-conversacao`, `agente-noturno` (João) | Z-API, mesma instância de env |
| **`super-endpoint.atenderPeloLid`** | **sender que eu não tinha contado**: monta `api.z-api.io/instances/${ZAPI_INSTANCE_ID}/...` e envia direto |
| `zapi-ingest` v128 | **recebe `instanceId` no payload encaminhado e simplesmente não lê** |

Esse último ponto é a boa notícia: a origem já está na mão do roteador. O guard é **uma
leitura**, não encanamento novo.

## 3. SUPORTE EXISTENTE

| Procurei | Achei |
|---|---|
| `instance_id` | **sim** — coluna `NOT NULL` em `zapi_webhook_inbox`, parâmetro de `insert_zapi_inbox_atomic`, campo obrigatório no `super-endpoint`, e dentro de `raw_payload` |
| `connected_phone` | **sim** — coluna própria + no payload; já usado por `aprenderPonte` para não confundir o número da empresa com um LID |
| `provider` | sim, noutro sentido: `mensagem_envio.canal` ∈ {`zapi`,`botconversa`} |
| `sender_id`/`numero_origem`/`canal_id` | **não existem** |
| registro de origens (tabela) | **não existe**; credenciais só em env das edges (`sistema_config` não tem nenhuma chave de zapi) |

## 4. FLUXO OUTBOUND COM SEGUNDA ORIGEM

```
fn_exp001_registrar_intervencao(lead, enfileirar=true, msg)
  └→ waba_disparos_lista (+ origem_slug='exp001')          ← 1 coluna nova
       └→ fn_fila_disparos_pendentes (devolve origem_slug)  ← +1 campo
            └→ whatsapp-executor v14
                 ├ 'exp001' → Z-API instância EXP           ← credencial nova
                 ├ origem desconhecida / credencial ausente → NÃO ENVIA (fail-closed)
                 └ SEM fallback para a linha principal
```

Observabilidade de saída vem **de graça**: se a linha 2 for Z-API com webhook apontado para
o `super-endpoint`, cada envio volta como `fromMe=true` e é espelhado com o `instanceId` dela.

## 5. FLUXO INBOUND COM SEGUNDA ORIGEM

```
cliente responde na linha 2
  └→ super-endpoint (mesma porta, já exige instanceId)
       ├→ zapi_webhook_inbox (instance_id = EXP)
       ├→ fact_conversations (raw_payload com instanceId da linha 2)
       └→ zapi-ingest → resolve lead pelo TELEFONE DO CLIENTE
            └→ fn_exp001_resultado enxerga o inbound → métrica funciona
```

**A identificação do lead é pelo telefone do cliente, não pela linha.** A métrica do EXP-001
funciona sem nenhuma mudança.

### O vazamento real

`zapi-ingest` tem o `instanceId` e o ignora. Então a resposta ao experimento seria roteada
para Júlia/Bruno/João, que responderiam **pela linha principal**: cliente recebe do número 2
e é respondido pelo número 1. É o único ponto onde o isolamento quebra de verdade.

## 6. OPT-OUT — funciona sem mudança nenhuma

`fn_crm_capturar_optout_inbound` é trigger em `fact_conversations`, chaveado por `lead_id`,
grava `canal='whatsapp'` — **sem noção de linha**. Um "SAIR" na linha 2:

- vira `crm_contact_optouts(lead_id, canal='whatsapp')`;
- faz o guard do R12 (`optout_whatsapp`) bloquear outbound **nas duas linhas**;
- **não fragmenta** por número.

É o comportamento certo: o cliente pediu para a *empresa* parar, não para *um número*.

## 7. OBSERVABILIDADE

| Pergunta | Hoje |
|---|---|
| "Esta resposta chegou em qual número?" | **SIM** — `zapi_webhook_inbox.instance_id`/`connected_phone`, e `fact_conversations.raw_payload->>'connectedPhone'` |
| "Esta mensagem saiu por qual número?" | **SIM, pelo espelho Z-API** — 100% das saídas na linha voltam como `fromMe=true` com `instanceId` |

O que falta é **conveniência, não informação**: hoje a resposta está em JSON, sem coluna e
sem índice. Uma coluna `origem_slug` no log de execução torna a consulta trivial e cobre o
caso em que o espelho falhar.

## 8. PATCH MÍNIMO (especificado, **não** implementado)

| # | Mudança | Tamanho |
|---|---|---|
| 1 | `waba_disparos_lista + origem_slug text` (null = principal = comportamento atual) | 1 coluna |
| 2 | `whatsapp_executor_log + origem_slug text` | 1 coluna |
| 3 | `fn_fila_disparos_pendentes` devolve `origem_slug` | +1 campo |
| 4 | `fn_exp001_registrar_intervencao` grava `origem_slug='exp001'` ao enfileirar | ~1 linha |
| 5 | `whatsapp-executor` v14: credencial por `origem_slug`, **fail-closed**, **sem fallback** | edge |
| 6 | `zapi-ingest`: guard no topo lendo `body.instanceId` — se for a do experimento, não aciona agente proativo | **~3 linhas** |
| 7 | Secrets `ZAPI_INSTANCE_ID_EXP` / `_TOKEN_EXP` / `_CLIENT_TOKEN_EXP` | config |
| 8 | Webhook da instância nova → **mesma URL do `super-endpoint`** | config externa |

Duas colunas, um campo, dois guards. **Não** inclui tabela de registro de origens: com duas
linhas, `origem_slug` + secrets basta; tabela só a partir da terceira.

## 9. O QUE DEPENDE DE PROVISIONAMENTO EXTERNO

1. Segundo número, não usado no WhatsApp Business da linha 1.
2. Segunda instância Z-API apontada para ele (custo por instância).
3. Webhook dessa instância → URL do `super-endpoint` (ele já exige e já grava `instanceId`).
4. **Aquecimento.** Número novo disparando 244 mensagens tem risco de bloqueio pelo próprio
   WhatsApp. É risco de plataforma, não de código, e não some com patch.

**Alternativa:** segunda conta BotConversa com `API-KEY` própria. Mantém o executor no provider
atual (troca só o header), mas custa outra assinatura e **não** ganha o espelho Z-API.

## 10. REFUTAÇÃO

| Ataque | Resposta |
|---|---|
| Segunda Z-API isola risco? | **Do número, sim.** Da marca, não: bloqueio do 2 não derruba o 1, mas reclamação continua sendo da Skillprint |
| BotConversa continuaria no número antigo? | **Sim.** `API-KEY` é da conta, e a conta tem um número. Por isso o EXP-001 precisa sair do BotConversa ou ganhar segunda conta |
| Inbound poderia chegar sem identificar origem? | **Não.** `super-endpoint` devolve 400 se faltar `instanceId` |
| Algum edge hardcoda a instância? | **Sim, quatro**: `agente-fechamento`, `agente-conversacao`, João, e o `atenderPeloLid` do próprio `super-endpoint` |
| Fila sabe escolher sender? | **Não.** É o item 1 |
| Logs misturariam números? | Só nas linhas escritas pelos agentes. O espelho Z-API separa |
| Resposta no número 2 cai no João/Júlia corretamente? | **Cai — e é o problema.** Cairia como se fosse a linha 1 e sairia pelo número errado. Item 6 |
| Opt-out fragmentaria? | **Não.** É por `lead_id` + `canal`, sem linha |
| Fallback atingiria o número principal? | **Hoje sim** — `agente-fechamento` já faz Z-API→BotConversa. Item 5 exige fail-closed |

## 11. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é externa: **provisionar a segunda linha** — número, instância Z-API e webhook
apontado para o `super-endpoint`.

Implementar os itens 1–6 antes disso seria encanamento para água que não chega, com risco de
alguém ligar por engano. Quando a linha existir, o patch cabe em uma rodada: eu já sei quais
são as duas colunas, o campo e os dois guards, e o guard do `zapi-ingest` é uma leitura de
`body.instanceId` que já está lá.

## Estado preservado (nada foi alterado)

| | |
|---|---|
| snapshot T0 | **456**, hash reconstruído `865e8672…` = hash T0 |
| campanha | **`rascunho`** |
| mensagem | `1c389fe45c074b24626f45fa18060e7e` |
| fila EXP-001 / envios EXP-001 | **0** / **0** |
| `fn_exp001_resultado` / `fn_exp001_coorte` | `9fa6afb4…` / `195f25da…` |
| escrita no banco | nenhuma |

EXP-001 continua congelado. Zero mensagens nesta rodada.
