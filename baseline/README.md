# Baseline — Rodada 2A (19/08/2026)

Projeto Supabase: `ldrdtaibazplvrbwyrvx`

O repositório não continha o código dos agentes: a implementação real vive no
Supabase. Este diretório é a captura reproduzível do estado **antes** de qualquer
alteração da Rodada 2A.

## Origem

- `edge/<slug>/` — fonte publicado das Edge Functions, obtido via
  `mcp__Supabase__get_edge_function`. Nenhum trecho foi transcrito à mão: os
  arquivos foram extraídos programaticamente do payload real da ferramenta.
  `_meta.json` registra versão publicada, `ezbr_sha256` do bundle deployado,
  data de atualização (epoch ms), origem da captura e sha256 por arquivo.
- `sql/` — DDL canônico regenerado pelo próprio Postgres
  (`pg_get_viewdef` / `pg_get_functiondef`), com `_manifest.json`.

## Rollback

Restaurar uma Edge Function = redeploy do conteúdo de `edge/<slug>/`.
Restaurar um objeto SQL = aplicar o arquivo correspondente em `sql/`.
