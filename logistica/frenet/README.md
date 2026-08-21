# Criação de etiqueta Frenet — contrato seguro

Frente canônica: **`agente-logistica-criar-etiqueta`** (trilha `erp`).
Sessão: `claude-20260821-criar-etiqueta-frenet`, 21/08/2026.

**Nada aqui está deployado. Nenhuma etiqueta foi emitida. Nenhuma migration foi aplicada.**

---

## 1. Endpoint escolhido

| Estado | Endpoint | Efeito |
|---|---|---|
| `COTAR` | `POST api.frenet.com.br/shipping/quote` | `NENHUM` |
| `VALIDAR_EMISSAO` | nenhum — puramente local | `NENHUM` |
| `EMITIR` | `POST {base_whitelabel}/v1/orders` | `MUTACAO_SEM_DEBITO` |
| proibido nesta fase | `POST {base_whitelabel}/v1/orders/oneclick` | `FINANCEIRO` |

Escolha por efeito, não por nome. `orders/oneclick` valida, cria, **paga** e imprime
numa única requisição: um timeout nele deixa um débito de resultado desconhecido e
não existe ponto de parada entre "existe pedido" e "comprei frete". `orders` separa
esses dois fatos — o pedido nasce em *aguardando pagamento* e o pagamento/impressão
é um segundo passo observável. É o único desenho compatível com "repetição da mesma
intenção não compra duas etiquetas" enquanto não há reconciliação provada.
`shipments*` (Whitelabel completo) pressupõe gerir merchants e carteira de terceiros
dentro da nossa plataforma — escopo maior, sem benefício aqui.

Ver `endpoints.ts`, que também registra **como cada linha foi verificada**
(`PRODUCAO_NOSSA` / `SDK_OFICIAL` / `DOC_NAO_LIDA`).

## 2. Separação de estados

```
COTAR ──► VALIDAR_EMISSAO ──► EMITIR
  │             │                │
efeito       efeito           efeito MUTACAO_SEM_DEBITO
NENHUM       NENHUM           exige GateAberto + READY + teto
```

`cotar()` assere `Efeito.NENHUM` no descritor antes de chamar: cotação não pode
comprar por acidente nem por refactor.

`validarEmissao()` devolve `READY | BLOCKED_DADOS | BLOCKED_FONTE |
BLOCKED_POLITICA | BLOCKED_IDEMPOTENCIA | NEEDS_HUMAN`, sem tocar a Frenet.
Precedência: `NEEDS_HUMAN` > `BLOCKED_IDEMPOTENCIA` > `BLOCKED_FONTE` >
`BLOCKED_POLITICA` > `BLOCKED_DADOS`.

`criarPedido()` só aceita um `GateAberto`, que é uma *capability* selada por
`Symbol` — não um booleano. Produzi-lo exige autor humano nomeado, teto em BRL e
`liberacao_operacional`, indisponível em desenvolvimento.

## 3. Idempotência

Chave determinística:

```
sha256( v1 ~ pedido_fonte ~ pedido_id ~ documento ~ cep ~ numero ~
        complemento ~ servico_codigo ~ valor_declarado ~ pacotes_ordenados )
```

Serviço, valor declarado e pacote entram de propósito: trocá-los é **outro envio**,
não um retry. Ordem dos pacotes e máscara de CPF/CEP não afetam a chave.

Persistência antes/depois do efeito externo (`logistica_envio_tentativa`):

| Estado anterior | Retry |
|---|---|
| nenhum | prossegue |
| `CONCLUIDA` | reaproveita o resultado, não compra |
| `EM_VOO` | `NEEDS_HUMAN` |
| `INDETERMINADA` (timeout/5xx) | `NEEDS_HUMAN` — reconciliar na Frenet antes |
| `FALHA_DEFINITIVA`, payload igual | prossegue |
| `FALHA_DEFINITIVA`, payload diferente | `NEEDS_HUMAN` (troca silenciosa) |

Reforço no banco: índice único parcial em `chave_idempotencia` onde
`estado in ('EM_VOO','CONCLUIDA')`. Dois workers concorrentes colidem no Postgres,
não só na aplicação.

## 4. Webhook

Contrato montado em `webhook.ts`, para ir no corpo da criação do pedido:

- `Url` — receptor **auditado**;
- `TokenName` — `FRENET_WEBHOOK_TOKEN_NAME`;
- `TokenValue` — `FRENET_WEBHOOK_TOKEN_VALUE`.

Nenhum segredo fake é gerado: sem o secret, `montarContratoWebhook` lança.
`conferirSeparacaoDeCredenciais` impede usar o Partner Token (ou o Token do
Cliente) como token de webhook.

`auditarReceptor` recusa receptor que: não seja HTTPS, não autentique o token,
não tenha dedup operante, não persista evento bruto, ou dispare mensagem externa.
**O receptor atual (`frenet-tracking-webhook` v27, ezbr `af11c994…`) reprova em
todos esses pontos** — por isso a URL dele não pode ser informada na criação.

`OrderId` enviado à Frenet é o nosso `envio_id` (uuid), **nunca** telefone, CPF ou
e-mail — que é a premissa do receptor atual.

## 5. Fonte dos dados

`fontes.ts` é lido em runtime pelo validador. Rebaixar uma fonte lá bloqueia a
emissão automaticamente. Hoje **19 de 24** campos mapeados bloqueiam.

## 6. Como rodar

```bash
node --experimental-strip-types --test logistica/frenet/test/contrato.test.ts
node --experimental-strip-types logistica/frenet/dry-run.ts
tsc -p logistica/frenet/tsconfig.json
```

## 7. Rollback

Nada foi deployado nem aplicado, então o rollback é `git revert` do commit.
Se a migration for aplicada no futuro, o bloco de rollback está no fim de
`sql/0001_logistica_envio.sql`.
