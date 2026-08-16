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
> agente-noturno e migrations do ERP). O baseline aqui e registrado por
> versao + hash, que sao verificaveis, em vez de uma copia transcrita a mao —
> publicar um fonte que talvez nao corresponda ao vigente violaria o item 3 do
> `AGENTS.md`. Antes do deploy, recuperar o fonte exato com
> `mcp__Supabase__get_edge_function(project_id, 'zapi-ingest')` e commitar como
> `index.ts` na mesma branch.

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
