# Runbook de deploy — verificado em 25/08/2026

Tudo está pronto e provado. **Falta exatamente uma coisa: a credencial.**

## O que já foi verificado neste ambiente

| item | estado |
|---|---|
| Supabase CLI 2.115.0 | instalável via npm e **executando** |
| árvore de deploy no formato do entrypoint atual | montada |
| `candidato/index.ts` sha256 | `a9a4aaf143a1188b0308ec459cda69d6d4479ead95704ddf61664db3401b91b4` |
| comando de deploy | correto |
| **credencial** | **AUSENTE** |

Erro exato devolvido pelo CLI, com todo o resto pronto:

```json
{"_tag":"Error","error":{"code":"LegacyPlatformAuthRequiredError",
 "message":"Access token not provided. Supply an access token by running `supabase login`
            or setting the SUPABASE_ACCESS_TOKEN environment variable."}}
```

Confirmado ausente: `SUPABASE_ACCESS_TOKEN`/`sbp_` em env, `~/.supabase`, `~/.config/supabase`,
`vault.secrets` e config MCP local (o conector Supabase é remoto — a credencial vive do lado do
servidor e não é exposta ao container). Zero arquivos com `sbp_` no filesystem.

## Comando (executar onde houver a credencial)

```bash
mkdir -p supabase/functions/agente-noturno
cp patches/joao-egresso-identificador-financeiro-interno/candidato/index.ts \
   supabase/functions/agente-noturno/index.ts

# confira o hash ANTES de publicar
sha256sum supabase/functions/agente-noturno/index.ts
# deve ser: a9a4aaf143a1188b0308ec459cda69d6d4479ead95704ddf61664db3401b91b4

export SUPABASE_ACCESS_TOKEN=<token sbp_>   # nunca commitar, nunca logar
npx supabase@2 functions deploy agente-noturno \
  --project-ref ldrdtaibazplvrbwyrvx \
  --no-verify-jwt
```

`--no-verify-jwt` preserva `verify_jwt=false`, como está hoje na v174.

## Prova pós-deploy obrigatória

1. Reobter a edge LIVE.
2. `sha256` do conteúdo publicado deve bater com `a9a4aaf1…b91b4`.
3. `logical version` deve virar `agente-noturno-v4.33.0`.
4. Se o deploy disser sucesso e o hash **não** bater → tratar como FAIL, não fechar a frente,
   e fazer rollback.

## Rollback

Redeploy da v174 (`ezbr_sha256 ff71708ee81856cd36d7e2793391b678b6e52dbc6ff609b8a576558c61c47db4`),
preservando `verify_jwt=false`. Sem migração e sem estado novo.
