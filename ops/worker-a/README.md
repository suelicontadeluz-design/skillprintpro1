# Canário Shadow no Worker A — prompt preparado (NÃO aplicado)

## Alvo

| campo | valor |
|---|---|
| trigger_id | `trig_01B1pkaxoSLc5d2dKjyA9h8L` |
| nome | Cérebro — Executor Produtivo Autônomo A (1x/hora, :53) — com lease de recurso |
| cron | `53 * * * *` (UTC) |
| persistent_session_id | `session_011wFDWmt4L2BUnir9aLcZkW` |
| worker_instance_id | `wkr-A-session_011wFDWmt4L2BUnir9aLcZkW` |
| environment_id | `env_01HXFVw4PKXiN7dE9jouHnYf` |

Snapshot completo da tarefa (sem o prompt) em `trigger-worker-a-snapshot-ANTES.json`.

## Estado

O prompt novo está pronto e revisado, mas **não foi aplicado**. A chamada
`update_trigger(trigger_id, prompt=...)` foi recusada pela plataforma:

> editing the prompt of a routine whose fires deliver into a session that is not your own is not available via this tool

A rotina entrega em `session_011wFDWmt4L2BUnir9aLcZkW`; esta sessão é outra
(`session_01JvzzvVSPRi5n4Ka3k5GxFD`). Só a própria sessão do Worker A pode
editar o prompt da própria rotina. Nada foi recriado, forçado ou contornado.

## Como aplicar

Dentro da sessão `session_011wFDWmt4L2BUnir9aLcZkW` (a sessão persistente do
Worker A), chamar `update_trigger` passando **somente** o campo `prompt`, com
o conteúdo integral de `prompt-worker-a-DEPOIS-canario-shadow.txt`.
Não alterar cron, persistent_session_id, environment, allowed_tools,
notificações nem enabled. Não recriar a tarefa.

## O que muda no prompt

Ver `prompt-worker-a.diff`. Resumo:

1. `NENHUM_PONTO_SELECIONAVEL` deixa de ser gate global. Continuam gates
   globais: executor desabilitado / `PAUSADO`, `admitido=false`,
   `KILL_SWITCH_DESLIGADO`, `AUTOTESTE_REPROVADO`.
2. Novo passo `3b`: `select public.fn_shadow_canario_recomendacao(<chat_id>, 90);`
   — depois dos gates globais, antes de qualquer `parada_sem_trabalho`.
3. Exceção fechada na seleção: só `joao-polo-composicao-piquet-50-50`, só com
   `consumivel=true`, com `origem_selecao=shadow_canario` e autoridade
   `SHADOW_CANARIO`. Sem escrita em `gps_rota_decisao`,
   `gps_frente_precedencia` ou `gps_trilha_precedencia`.
4. Claim da frente vinda do Shadow: somente `fn_frente_claim_v2(...,180)`.
   Recusa = canário falhou legitimamente; não force.
5. Observabilidade no detalhe das etapas já existentes de
   `executor_rodada_etapa`. `claim_token` nunca é gravado.
6. Concorrência descrita pelo que o banco devolve (`executor_config`,
   `worker_bloqueio`, claims e leases ativos), sem presumir Worker B.
