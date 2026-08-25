# P0 João — `operation_id` interno vazando para o cliente como Pix

**Frente:** `joao-egresso-identificador-financeiro-interno`
**Edge:** `agente-noturno` (projeto `ldrdtaibazplvrbwyrvx`)
**Baseline:** Edge **174**, lógica `agente-noturno-v4.32.0`, `ezbr_sha256 ff71708ee81856cd36d7e2793391b678b6e52dbc6ff609b8a576558c61c47db4`
**Candidato:** lógica `agente-noturno-v4.33.0` — `candidato/index.ts`, 278.653 bytes, `sha256 a9a4aaf143a1188b0308ec459cda69d6d4479ead95704ddf61664db3401b91b4`

> **NÃO PUBLICADO.** Produção segue na v174 intacta. Ver "Bloqueio de publicação".

## Defeito

`lerExecucoes()` injeta `AUTORIZAÇÕES ATIVAS` com `operation_id` no contexto e
`financial_authorizations` devolve `operation_id`. As duas coisas são **necessárias** para o
modelo chamar `gerar_pix`. O defeito nunca foi a entrada: era a **ausência de qualquer
barreira na saída**. O id interno atravessava para a resposta.

### Incidência histórica medida
`fact_conversations` outbound, deduplicando o eco `joao`/`zapi` (8 linhas brutas → **4
vazamentos distintos**, 4 telefones):

| data | tel | kind | valor | forma do vazamento |
|---|---|---|---|---|
| 04/08 01:00 | 0059 | `pedido_total` | R$64,52 | dentro de code block markdown |
| 08/08 20:20 | 1308 | `pedido_total` | R$41,83 | dentro de `https://pay.smartpag.com.br/<id>` inventada |
| 23/08 22:15 | 9530 | `produto` | R$233,61 | id solto após "Cartão certo?" |
| 25/08 02:19 | 5163 | `produto` | R$101,18 | após "Segue o Pix:" |

O caso de 23/08 **não constava no relato original** e foi encontrado nesta varredura.

## Correção — por proveniência, não por formato

Não se bloqueia todo UUID: uma chave Pix aleatória legítima também tem formato UUID.
Bloqueia-se o UUID que **existe em `operacoes_financeiras`** — onde vivem todos os ids em
jogo (autorizações de `lerExecucoes`, `operation_id` do envelope, id novo do `compor_total`,
`ctx.pixGerado.operation_id`). Texto sem UUID nenhum não consulta o banco (custo zero).

1. **Invariante de transporte** — guarda antes de `entregarComoJoao`, e no caminho próprio do
   `_direct_message`. Bloqueia, registra `guardrail_identificador_financeiro_interno`, expurga
   o id solto/markdown/URL, e falha fechada quando não há cobrança provada.
2. **QR oficial intacto** — só o QR de proveniência **provada** (`ctx.pixGerado.qr_code` /
   `mp_pix_cobrancas.qr_code`) é isento da varredura. Prefixo `000201` forjado não isenta.
3. **Chave Pix manual desativada** — `30248650000111` é CNPJ e o proprietário confirmou que
   **não** é a chave operacional. Nenhuma fonte canônica existe em `sistema_config`,
   `atendimento_config`, `julia_config`, `skillprint_base_conhecimento` ou `vault.secrets`.
   Sem prova, o fallback sai de circulação e `validarPix` passa a recusá-lo.
4. **Furo da guarda de URL** — `checkoutMercadoPago()` devolve `null` para host não-MP; sem
   checkout oficial `checkoutOficial` também era `null`, e `null === null` dava "URL
   autorizada" para qualquer link inventado. Foi por aqui que o link de 08/08 saiu.
5. **`prometeuPix`** — passa a reconhecer afirmação de **entrega** ("Segue o Pix", "Chave
   Pix:", "aqui está o Pix", "te envio o Pix", "código Pix"), não só promessa em futuro.
6. **Hold de arte** — quando o cliente condiciona explicitamente o pagamento a aprovar a arte,
   aquele **turno** não gera cobrança. A política comercial não muda: pagamento continua antes
   da produção.

## Provas

```
node out/testes.js       # candidato : 14/14 obrigatórios + 14/14 refutação = 28 PASS
node out/testes_base.js  # baseline  : 5/5 casos VAZARAM
```

O código sob teste é **extraído verbatim** de `candidato/index.ts`; só o mundo (banco, log) é
mocado. `provas/harness_base.ts` reproduz o sítio de transporte da v174 e devolve as strings
de produção byte a byte.

## Bloqueio de publicação

O único canal de deploy disponível (`mcp__Supabase__deploy_edge_function`) exige a fonte
inteira como string literal no tool call — 278.653 caracteres. Não há Supabase CLI, não há
`SUPABASE_ACCESS_TOKEN`/`sbp_` em env nem em `vault.secrets`, e a rede do container recusa
hosts fora da allowlist. Transcrever 278KB por geração de tokens não permite provar
`publicado == candidato` **antes** de estar no ar, e o modo de falha (corrupção silenciosa de
preço/regex num agente financeiro) é pior que o defeito corrigido.

**Para desbloquear:** publicar `candidato/index.ts` por canal com acesso a filesystem —
Supabase CLI (`supabase functions deploy agente-noturno`) ou Management API multipart com
token `sbp_`. Preservar `verify_jwt=false` e o entrypoint
`supabase/functions/agente-noturno/index.ts`.

## Rollback exato

Redeploy da v174 (`ezbr_sha256 ff71708e…47db4`). Não há migração, tabela nova nem estado
persistido: reverter a Edge restaura o comportamento anterior por completo.
