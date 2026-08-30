# LAUDO — Correção do loop de objeções (aprovação → task)

**Data:** 30/08/2026 · **Projeto Supabase:** `ldrdtaibazplvrbwyrvx` (cérebro-vendas) · **Frente:** loop de objeções (existente; nenhuma frente nova)

## VEREDITO = PASS

Evidência reproduzível de ponta a ponta, pela edge `agente-aprovacao` em produção:

```
aprovação (sim_<id>) → agente-aprovacao v3.3.0 → fn_objecao_aprovada_criar_task
  → resultado "task_criada:116af48a-7d0d-489a-889b-965451a1ee6f"  (exatamente 1 linha em crm_tasks)
  → lead_objections 4ac9561f… = 'aprovado_virou_task', task_id = 116af48a…
replay (mesmo sim_<id>) → resultado "idempotente_task_ja_existia:116af48a…"  (0 tasks novas)
```

## 1. Causa técnica confirmada

O branch `ehObjecaoTask` da edge `agente-aprovacao` v3.2.1 terminava, por desenho, em
`executor_indisponivel:agente-objecoes_sem_rota_execucao_aprovada` — não existia rota de execução
entre a aprovação e a criação da `crm_task` + gravação de `status_aprovacao='aprovado_virou_task'`.
Reconfirmado na ETAPA 0 contra o código vigente (v67) antes de qualquer escrita.
Causa secundária: corrida em `fn_objecao_registrar_uso` — um `mensagem_enviada` anterior
(`aguardando → aprovado_sem_acao`) bloqueava para sempre o `handoff_humano` posterior
(guard `WHERE status_aprovacao='aguardando'`).

## 2. Alterações aplicadas

| Onde | O quê |
|---|---|
| Banco (migration `fn_objecao_aprovada_criar_task_v1`) | Nova RPC `public.fn_objecao_aprovada_criar_task(uuid, uuid)` — ver `01-migration-…sql` |
| Banco (migration `fn_objecao_registrar_uso_upgrade_handoff`) | Backup da definição anterior em `backup_funcoes_objecao_loop_20260830` + nova `fn_objecao_registrar_uso` — ver `02-migration-…sql` |
| Edge `agente-aprovacao` | v67 (v3.2.1) → **v69 (v3.3.0)**, `verify_jwt=false` preservado. Diff = 3 hunks: cabeçalho de versão, forma escapada do regex de acentos (mesma faixa U+0300–U+036F) e o branch `ehObjecaoTask`. Nada mais mudou (`edge-…-baseline` vs `edge-…-v3.3.0` neste diretório). Obs.: o deploy intermediário v68 saiu por engano com `verify_jwt=true` e foi corrigido em ~2 min pelo v69, idêntico em conteúdo. |

## 3. RPC criada — `fn_objecao_aprovada_criar_task(p_objecao_id uuid, p_aprovacao_id uuid)`

SECURITY DEFINER, `search_path='public'`. Valida, nesta ordem: aprovação existe (lock `FOR UPDATE`);
`agente_slug='agente-objecoes'`; `opcoes[0].acao='criar_task_tamires_analisar_objecao'`;
`opcoes[0].objecao_id = p_objecao_id`; status da aprovação (`expirado`→recusa, `rejeitado`→recusa,
`pendente`→recusa `aprovacao_nao_aprovada`, e `aprovado` sem `respondido_em` já vencida→recusa);
`decisao_id` presente; objeção existe (lock); `lead_objections.decision_id = aprovacao.decisao_id`;
`lead_id` coerente. Idempotência por `lead_objections.task_id` (coluna existente, antes com 0 usos):
replay devolve `ja_existia`. Objeção `aprovado_virou_task` legada sem `task_id` é **recusada**
(backlog não é reprocessável por esta rota). Criação da task + atualização da objeção são atômicas
(bloco plpgsql com EXCEPTION → rollback implícito). A task nasce com `ai_decision_id=NULL` de
propósito: `trg_crm_task_to_disparo` é fail-closed com NULL, então **nenhuma mensagem automática é
enfileirada ao lead** — a task é humana (Tamires), sem autonomia nova.
Retorno estruturado: `criada` | `ja_existia` | `recusada`+motivo | `erro`+motivo.

## 4. Grants da RPC

`REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role.`
Verificado em `information_schema.routine_privileges`: apenas `postgres` (owner) e `service_role`.
Nenhum privilégio novo para `agente-objecoes`.

## 5. Mudança exata na `agente-aprovacao` (v3.3.0)

No branch `ehObjecaoTask`, o retorno único
`executor_indisponivel:agente-objecoes_sem_rota_execucao_aprovada` foi substituído por:
(a) registrar a aprovação como `aprovado` antes do despacho (espelho literal do contrato de mídia);
(b) `sb.rpc('fn_objecao_aprovada_criar_task', {p_objecao_id, p_aprovacao_id})`;
(c) mapeamento do resultado (`criada`/`ja_existia` → ok; recusa → `executor_recusou:<motivo>` com
`bloqueado=true`; erro de transporte → `executor_falhou:rpc:<msg>`), com
`fn_registrar_execution_event` em cada desfecho. Identidade (`validarIdentidadeObjecao`),
autoridade (`fn_agente_pode_executar`) e todos os demais guards e branches ficaram intactos.

## 6. Mudança exata em `fn_objecao_registrar_uso`

Só o predicado do UPDATE:

```sql
WHERE id = p_objection_id
  AND ( status_aprovacao = 'aguardando'
     OR (status_aprovacao = 'aprovado_sem_acao' AND v_status_aprovacao = 'aprovado_virou_task') )
```

Transição nova documentada (UPGRADE ONLY): `aprovado_sem_acao → aprovado_virou_task`.
Terminais (`aprovado_virou_task`, `rejeitado`) nunca regridem; a função continua **não** criando task.
Definição anterior preservada em `backup_funcoes_objecao_loop_20260830` (rollback verbatim).

## 7. Testes executados (fixtures `[TESTE LOOP-OBJECOES 20260830]`, lead de teste da casa `d7e43c8a…`)

| Teste | Resultado |
|---|---|
| A. happy path | PASS — `criada`, 1 task (pendente/Tamires/objecao_aprovada/`ai_decision_id` NULL), objeção `aprovado_virou_task` + `task_id`, 0 disparos ao lead |
| B. replay idempotente | PASS — `ja_existia`, mesma task, 0 novas |
| C. aprovação de outra objeção | PASS — `recusada: aprovacao_de_outra_objecao` |
| D. approval/action incompatível | PASS — `recusada: acao_incompativel` |
| E. aprovação expirada (2 variantes) | PASS — `aprovacao_expirada` e `aprovacao_expirada_sem_resposta` |
| F. objeção inexistente | PASS — `recusada: objecao_inexistente` |
| G. mensagem_enviada → handoff_humano | PASS — `aguardando → aprovado_sem_acao → aprovado_virou_task` |
| H. replay do handoff | PASS — estado inalterado, 0 tasks (registrar_uso não cria task); `mensagem_enviada` tardio não rebaixa o estado |
| I. demais branches da agente-aprovacao | PASS — diff v3.2.1↔v3.3.0 com exatamente 3 hunks (versão, escape do regex, branch de objeção); smoke test em produção (`skip: nao_e_alessandro`) OK |

Fixtures encerradas após PASS (aprovações de recusa → `rejeitado` com nota; task do teste A → `descartada` com nota). A aprovação A1 permaneceu `aprovado` como registro verdadeiro (replay nela é idempotente).

## 8. Evidência do canário (fixture `[CANARIO LOOP-OBJECOES 20260830]`)

- Objeção elegível: `4ac9561f-1cc4-4f2d-a6a7-b15ef40788f4` (`aguardando`, `decision_id=802c34fc…`).
- Aprovação válida: `773f1f97-b83c-46ad-bc0d-06737dfd7746` (`pendente`, não expirada, vínculo completo).
- Passagem pela edge: `net.http_post` (pg_net, request 58584) com payload de botão
  `{phone: 5511939490508, text: 'sim', button.payload: 'sim_773f1f97…'}` →
  HTTP 200 `{"ok":true,"acao":"aprovado","execucao":"executada","resultado":"task_criada:116af48a-7d0d-489a-889b-965451a1ee6f","chegou_executor":true}`.
- RPC chamada e trilha em `agente_execution_events` (decision_id `802c34fc…`):
  `approval_received(autoridade)` → `action_executed(fn_objecao_aprovada_criar_task, criada)` →
  [replay] `approval_received` → `action_executed(ja_existia)`. Chamadas HTTP também em `http_chamada_log`.
- Task única: `116af48a…` (`crm_tasks`, origem `agente-aprovacao`, vendedor Tamires, `ai_decision_id` NULL, 0 disparos em `waba_disparos_lista`).
- Objeção final: `aprovado_virou_task`, `task_id=116af48a…`, `aprovado_por='agente-aprovacao'`.
- Replay (request 58587): `idempotente_task_ja_existia:116af48a…`, 0 tasks adicionais.
- Task do canário encerrada em seguida como `descartada` com nota (evidência preservada, sem ruído para Tamires).

## 9. Tasks antes/depois do replay

`crm_tasks` total: **2734 antes do canário → 2735 após a aprovação → 2735 após o replay** (Δ replay = 0).
Tasks do canário: 0 → 1 → 1.

## 10. Status final da objeção do canário

`lead_objections.status_aprovacao = 'aprovado_virou_task'` (com `task_id` vinculado).

## 11. ISABELA_DRY_RUN_PERMANECEU_ATIVO = SIM

`agentes.dry_run_ativo=true`, nível 1 inalterado; `fn_dry_run_efetivo('agente-objecoes', true)=true` após a intervenção. Nada foi tocado na Isabela.

## 12. BACKLOG_ANTIGO_PROCESSADO = NAO

`lead_objections` com `aguardando` = **312 antes e depois**. `aprovado_virou_task` total = 8 =
5 históricas + 3 desta intervenção (2 fixtures de teste + 1 canário, todas marcadas `[TESTE]`/`[CANARIO]`).
Nenhuma aprovação expirada foi reaberta; nenhuma task retroativa criada. A RPC recusa estruturalmente
o backlog: aprovações `expirado` e as `aprovado` sem resposta já vencidas são recusadas, e objeções
legadas `aprovado_virou_task` sem `task_id` também.

## 13. Riscos e pendências restantes

1. **O loop segue sem entrada nova até decisão do dono**: a Isabela está em dry-run desde 13/08 e não
   cria pedidos de aprovação. O circuito aprovação→task está restaurado e provado, mas só será
   exercitado em produção quando o dono decidir tirar a Isabela do dry-run (fora do escopo desta
   intervenção, por instrução explícita).
2. As duas passagens do canário dispararam **2 mensagens de WhatsApp reais ao Alessandro** (a
   confirmação "✅ Acao executada" da edge) — comportamento pré-existente da edge, que também serve
   de notificação da prova. Nenhuma mensagem foi enviada a lead.
3. O deploy intermediário v68 ficou ~2 min com `verify_jwt=true`; qualquer webhook sem JWT nesse
   intervalo teria recebido 401. Janela curta (18:41–18:44 UTC aprox.), sem evento observado.
4. As 12 aprovações de 06–07/07 marcadas `aprovado` sem `respondido_em` continuam como estão
   (a RPC as recusa como `aprovacao_expirada_sem_resposta`); se o dono quiser tratá-las, é decisão
   de backlog separada.
5. A auto-aprovação da Patricia continua com whitelist `['aprovado','ajustado']` — objeções seguem
   exigindo aprovação humana explícita (nenhuma mudança de whitelist, conforme instrução).

## Rollback

- Edge: redeploy do arquivo `edge-agente-aprovacao-v3.2.1-baseline-index.ts` (com `verify_jwt=false`).
- `fn_objecao_registrar_uso`: executar `definicao` de `backup_funcoes_objecao_loop_20260830` verbatim.
- RPC: `DROP FUNCTION public.fn_objecao_aprovada_criar_task(uuid, uuid);` (nenhum objeto depende dela além da edge).
