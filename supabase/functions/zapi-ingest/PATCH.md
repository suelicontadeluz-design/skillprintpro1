# Patch v122 — escritor de first-touch CTWA em `marketing_touches`

Frente: `marketing-touches-sem-escritor-ctwa` (trilha `midia`, P1)
Projeto Supabase: `ldrdtaibazplvrbwyrvx`
Edge alvo: `zapi-ingest`

## Baseline

| campo | valor |
|---|---|
| versao ACTIVE | **121** |
| `ezbr_sha256` | `0dd035d29ba122a30dcb72ac1b2420045ac0fe7841def7eeead00bfd095fb104` |
| `verify_jwt` | `false` |
| `updated_at` | 1786445652716 (11/08/2026) |

> `zapi-ingest` **nao possui fonte versionada em nenhum repositorio acessivel**
> (`skillprintpro1` e um admin Next.js; `skillprint-erp` so versiona spedy-*,
> agente-noturno e migrations do ERP).

## BLOQUEIO DE DEPLOY — fonte byte-a-byte indisponivel nesta sessao

Condicao dada no GO: recuperar o fonte exato do ACTIVE e versiona-lo antes do
deploy, **sem reconstruir/transcrever manualmente**; nao sendo possivel
byte-a-byte, parar antes do deploy. Nao foi possivel. Caminhos verificados:

| caminho | resultado |
|---|---|
| Supabase CLI (`supabase functions download`) | nao instalado no container |
| `SUPABASE_ACCESS_TOKEN` em env | ausente |
| token em `~/.supabase`, `~/.claude.json`, configs | ausente |
| Management API via `curl` | sem credencial; o MCP e HTTP remoto e a credencial fica do lado do servidor |
| persistencia automatica do resultado da tool | so ocorre em resultado grande demais para o contexto; o de `get_edge_function` coube e nunca foi a disco |

O unico mecanismo disponivel, `mcp__Supabase__get_edge_function`, entrega o
fonte **para dentro do contexto do modelo**. Grava-lo em disco significaria
re-emitir ~40 KB pelo proprio modelo — que e exatamente a transcricao manual
vetada. Pior: **nao ha verificador independente**, porque `ezbr_sha256` e o hash
do bundle eszip, nao do `index.ts`, entao a igualdade byte-a-byte nem poderia ser
provada depois.

O mesmo limite atinge o deploy em si: `mcp__Supabase__deploy_edge_function`
exige `files[].content`, ou seja, o arquivo inteiro re-emitido pelo modelo. **Nao
existe aplicacao de patch no lado do servidor.** Logo o deploy v122 por esta
sessao teria a mesma fragilidade que a condicao 5 quis evitar.

**Desbloqueio** (qualquer um dos tres, fora desta sessao):

1. `supabase functions download zapi-ingest --project-ref ldrdtaibazplvrbwyrvx`
   numa maquina com CLI + `SUPABASE_ACCESS_TOKEN`, commitar o `index.ts` cru,
   e entao aplicar os 2 blocos deste documento por diff de verdade;
2. baixar o fonte pelo painel do Supabase (Edge Functions -> zapi-ingest ->
   Code) e commitar;
3. dar a esta sessao um `SUPABASE_ACCESS_TOKEN` de leitura, permitindo o
   download direto para disco sem passar pelo modelo.

Feito o passo 1/2/3, o restante do pipeline ja esta pronto: migration
**aplicada e validada em 16/08/2026**, patch com ancoras exatas abaixo, canario
de 10 provas e rollback escritos.

## Diff — 2 blocos, nenhuma linha existente alterada

O patch e **puramente aditivo**: 1 funcao nova + 1 linha de chamada.
Nada e removido, nada e reescrito.

### Bloco 1 — funcao nova

Inserir o corpo delimitado por `PATCH-INICIO` / `PATCH-FIM` em
[`patch-v122-ctwa-touch.ts`](./patch-v122-ctwa-touch.ts), **imediatamente apos**
o fim de `resolveAdData` e **antes** de `async function reportError`.

Ancora (fim de `resolveAdData`, v121):

```ts
async function resolveAdData(sourceId: string | null, adTitle: string | null): Promise<any | null> {
  if (sourceId) { const fromMeta = await getAdDataFromMeta(sourceId); if (fromMeta) return fromMeta; const fromDimAdsId = await getAdDataFromDimAdsByAdId(sourceId); if (fromDimAdsId) return fromDimAdsId; }
  if (adTitle) { const fromTitle = await getAdDataFromDimAdsByTitle(adTitle); if (fromTitle) return fromTitle; }
  return null;
}
// <<< BLOCO 1 ENTRA AQUI >>>
async function reportError(msg: string, payload: any) { ... }
```

### Bloco 2 — chamada (1 linha)

Ancora exata, no ramo `if (sourceId || ctwaClid || adTitle)`:

```ts
    if (sourceId || ctwaClid || adTitle) {
      const adData = await resolveAdData(sourceId, adTitle);
      const segmento = await classifySegmento(chatName, mensagem);
      const { leadId } = await getOrCreateLeadAtomic(phone, chatName, segmento, bcVars, ud, cd, adData, ctwaClid);
+     await registrarTouchCtwa(leadId, ctwaClid, sourceId, adData, body);
      if (!subscriberId) { log('subscriber_null_apos_retry', 'CRITICO', ...
```

A linha entra **logo apos `getOrCreateLeadAtomic`**, exatamente no ponto
apontado pela frente: ali `leadId`, `ctwaClid`, `sourceId` e o `adData` resolvido
por `resolveAdData` coexistem no mesmo escopo e no mesmo instante.

## Ordem de aplicacao

1. `supabase/migrations/20260816_marketing_touches_source_system_zapi_ingest.sql`
2. deploy da edge `zapi-ingest` v122

A ordem importa: sem a migration, `ck_source_system` recusa `'zapi_ingest'`, a
funcao devolve `{status:'rejeitado'}` e o patch vira no-op silencioso (so
registrado em `error_log`). A ordem inversa nao corrompe nada — apenas nao grava.

## Rollback

| passo | acao | efeito |
|---|---|---|
| 1 | redeploy da v121 (fonte por `get_edge_function`, conferir `ezbr_sha256`) | para de gravar touch; atendimento identico ao de hoje |
| 2 | `20260816_ROLLBACK_...sql` — **so se `count(*) where source_system='zapi_ingest'` = 0** | dominio do CHECK volta ao baseline |

`marketing_touches` e append-only (`trg_marketing_touches_no_delete`,
`_no_update`, `_no_truncate`): linhas ja gravadas **nao podem** ser apagadas para
forcar o rollback do passo 2. Se houver touch gravado, o rollback correto e
apenas o passo 1 — o dominio ampliado fica, inerte e sem escritor.

O passo 1 sozinho ja restaura 100% do comportamento anterior, porque o patch nao
altera nenhuma linha existente.
