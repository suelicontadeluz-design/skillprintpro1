# agente-pipeline — patch handoff `system` (v65 -> v66)

Projeto Supabase: `ldrdtaibazplvrbwyrvx` · Edge `agente-pipeline` (`verify_jwt: false`)

## Defeito corrigido

`gerarOrientacaoHandoff` recebia `promptBase` e `reflexao` em `params` (o call site
ja os passava, e o tipo ja os declarava), mas desestruturava apenas
`nome, segmento, historico, ctx`. Os dois campos eram silenciosamente descartados
e a chamada Anthropic do handoff seguia **sem `system`** — enquanto o CASO 2
(decisao autonoma) ja enviava `system: promptBase + reflexao`.

## Alteracao (2 linhas, ambas dentro de `gerarOrientacaoHandoff`)

```diff
-  const { nome, segmento, historico, ctx } = params;
+  const { nome, segmento, historico, ctx, promptBase, reflexao } = params;
-      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
+      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, system: promptBase + reflexao, messages: [{ role: 'user', content: prompt }] }),
```

A composicao do `system` e byte-equivalente a que o CASO 2 ja usa em producao.
Nenhuma outra alteracao funcional. `user` prompt, `titulo`, `orientacao`,
`urgencia`, `prazo`, guardrails, gate do canario e CASO 2: inalterados.

## Artefatos

| arquivo | sha256 | papel |
|---|---|---|
| `v65_baseline_index.ts` | `545dbc14989b35279a48839fe28a5f203c5f9def11782205b7ce263dab1e6151` | baseline / **artefato de rollback** (fonte da edge v65, `ezbr_sha256 d63c3368857060a55186f21436d9a49c04ce72b06aff4f9023ff4130f83f0953`) |
| `v66_publicado_index.ts` | `c0f2db1fd0693930d64bafa2819af58addbb9d3a6fdf9bfeba06a7cadcb92cab` | candidato == fonte publicado na v66 (`ezbr_sha256 b4f56dd376d48cf39e29db650850b35e1f2857b8c13968e2422c3b53c380b93e`) |
| `v65_para_v66.diff` | — | diff completo baseline -> publicado |
| `transform.py` | — | transformacao programatica e localizada (assert de escopo) |
| `build_harness.py` + `dryrun.ts` | — | testes de montagem do request, pre-deploy |

Integridade: `sha256sum -c SHA256SUMS`.

## Reproduzir

```
python3 transform.py                                   # baseline -> candidato
python3 build_harness.py && node --experimental-strip-types dryrun.ts
```

`transform.py` aborta se qualquer ancora nao for unica, cair fora de
`gerarOrientacaoHandoff`, ou se alguma linha alem de 226/255 mudar.

## Rollback

Republicar `v65_baseline_index.ts` como `index.ts` da edge `agente-pipeline`
(entrypoint `index.ts`, `verify_jwt: false`, arquivo unico, sem import map).
O arquivo esta preservado byte a byte e sobrevive intacto ao caminho de
codificacao JSON usado pelo deploy. Apos republicar, reobter a edge e conferir
que o fonte publicado bate com o sha256 acima.
