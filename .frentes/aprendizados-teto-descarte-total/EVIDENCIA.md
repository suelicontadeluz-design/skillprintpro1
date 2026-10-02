# Frente: aprendizados-teto-descarte-total
## Sessao: claude-20260818-manifesto-rpc-idhfl4

Escopo autorizado: **somente** trocar o escritor do manifesto de auditoria no
Edge `agente-noturno`. Nenhuma outra logica, nenhuma migration, nenhuma outra Edge.

## 1. Estado vivo preservado (v166)

| Campo | Valor |
|---|---|
| Projeto | `ldrdtaibazplvrbwyrvx` |
| Edge | `agente-noturno` |
| Version | **166** |
| Status | ACTIVE |
| verify_jwt | **false** |
| entrypoint (vivo) | `.../source/supabase/functions/agente-noturno/index.ts` |
| import_map | false |
| ezbr_sha256 (bundle) | `4afd32c20e306a8e63fc94a619b7586462a02910dd4d86f486d3effeba872f30` |

Confere exatamente com o sha informado pelo proprietario.

## 2. Fonte exato materializado (canal preserva-bytes)

Sem CLI autenticado, o fonte foi obtido pelo canal oficial (Supabase MCP
`get_edge_function`), cuja resposta foi gravada em arquivo pelo harness e
extraida por script — **em nenhum momento o conteudo foi reemitido/reconstruido
a partir de texto de chat**.

| Artefato | bytes | linhas | sha256 |
|---|---|---|---|
| v166 ORIGINAL | 244094 | 3215 | `6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764` |
| CANDIDATO | 244084 | 3215 | `6e2116e26d44f0d6bf901a9f563fdeec1b72d036d3c4d4271653024c1edccdf3` |

Delta: -10 bytes. Contagem de linhas inalterada.

Arquivos neste repositorio:
- `supabase/functions/agente-noturno/index.ts` — CANDIDATO (pronto para deploy)
- `.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts` — ORIGINAL exato (rollback)
- `.frentes/aprendizados-teto-descarte-total/patch_manifesto_rpc.diff` — diff completo

## 3. Diff — exatamente 1 hunk (1 linha por 1 linha)

```diff
@@ -382,7 +382,7 @@ async function registrarManifestoJoao(d: {
       aprendizados_ok: d.aprendizadosOk,
       manifesto_aprendizados: d.manifestoAprendizados
     };
-    const { error } = await sb.schema('auditoria').from('prompt_manifesto_joao').insert(row);
+    const { error } = await sb.rpc('fn_log_prompt_manifesto_joao', { p_row: row });
     if (error) await logErro('prompt_manifesto_joao_falhou', { erro: error.message });
   } catch (e: any) { await logErro('prompt_manifesto_joao_excecao', { erro: String(e?.message ?? e).slice(0,150) }); }
 }
```

Provas mecanicas executadas:
- ocorrencias do alvo no arquivo: **1** (unica)
- prefixo e sufixo ao redor do hunk: **byte-identicos** ao original
- `git diff --numstat`: `1  1` (uma linha adicionada, uma removida)
- hunks no patch: **1**
- tratamento de erro `prompt_manifesto_joao_falhou` preservado sem alteracao

Nao foram reaplicados os 3 hunks historicos de teto/orcamento da v153: o manifesto
atual ja esta saudavel e a v166 evoluiu aquele trabalho. Nao houve downgrade.

## 4. Pre-flight da RPC — PASS

| Item | Resultado |
|---|---|
| `public.fn_log_prompt_manifesto_joao(p_row jsonb)` existe | OK — retorna `bigint` |
| Assinatura aceita `p_row jsonb` | OK |
| EXECUTE para anon/authenticated/PUBLIC | **NAO concedido** — acl = `{postgres=X/postgres, service_role=X/postgres}` |
| service_role / postgres tem acesso | OK |
| `auditoria.prompt_manifesto_joao` existe | OK — 24 colunas |
| Chaves do `row` da Edge x colunas lidas pela RPC | 22/22 correspondem exatamente |
| Cliente da Edge | `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` -> papel `service_role`, que tem EXECUTE |

Nenhum grant foi alterado. Schema `auditoria` permanece **fora** do Data API.
A RPC e SECURITY DEFINER com `search_path` fixado em `public, pg_temp`.

## 5. Teste da RPC sem efeito comercial — PASS

Executado bloco transacional que chamou a RPC e abortou de proposito:

```
PROVA_RPC_OK id=3 chars_system_final_lido=5 (transacao abortada de proposito, zero residuo)
```

A RPC gravou e a linha foi lida de volta dentro da transacao. Apos o rollback:
`total_manifestos = 0`, `residuo_teste = 0`. Nenhuma mensagem foi enviada a
cliente; o Joao nao foi acionado.

Linha de base para o pos-flight: **auditoria.prompt_manifesto_joao tinha 0 linhas**
(o escritor direto nunca gravou — confirma o defeito).

## 6. Deploy — BLOQUEADO por credencial

O deploy **nao** foi executado. Motivo: nao existe nesta sessao canal de deploy
que consuma o artefato exato por arquivo.

- Supabase CLI: instalavel e funcional (`npx supabase@latest`, v2.114.0). Ja
  reconhece a funcao neste repositorio. Falha **somente** na autenticacao:
  `LegacyPlatformAuthRequiredError: Access token not provided.`
- Management API por curl: sem `SUPABASE_ACCESS_TOKEN` no ambiente; nao ha token
  no Vault (apenas tokens de cron) e nao ha workflow de deploy no repositorio.
- MCP `deploy_edge_function`: aceita conteudo **somente inline**. Publicar por ele
  exigiria reemitir 244.084 bytes token a token, o que viola o gate de integridade
  desta frente e poderia regredir a v166 silenciosamente. **Recusado de proposito.**

Comando pronto para publicar assim que o token existir:

```
SUPABASE_ACCESS_TOKEN=<sbp_...> npx --yes supabase@latest functions deploy agente-noturno \
  --project-ref ldrdtaibazplvrbwyrvx --no-verify-jwt --use-api
```

`--no-verify-jwt` preserva `verify_jwt=false` da versao viva.

## 7. Rollback

O artefato exato da v166 esta preservado e versionado em
`.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts`
(sha256 `6c3c90bf...`). Em caso de regressao, republicar esse arquivo como
`supabase/functions/agente-noturno/index.ts` pelo mesmo comando, mantendo
`--no-verify-jwt`.

## 8. Estado da frente

Producao **intacta**: v166 continua ACTIVE, verify_jwt=false, sha inalterado.
Nada foi publicado. Nenhuma migration. Nenhum grant alterado.
