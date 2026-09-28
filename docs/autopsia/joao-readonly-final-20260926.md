# JOÃO — READ-ONLY FINAL — 26/09/2026

Última rodada de investigação antes do Clean Slate. Fecha as cinco lacunas da rodada anterior e classifica a fronteira. **Nenhuma ação de escrita foi executada**: nenhum código, banco, flag, cron, ownership ou tráfego foi alterado; nenhuma mensagem de teste foi enviada; nenhuma API com efeito externo foi chamada. Só leitura de definição (código das edges, `pg_get_functiondef`, `pg_get_triggerdef`, SELECTs de contagem/estado).

Complementa `docs/autopsia/joao-autopsia-fisica-20260926.md` (autópsia física) e `docs/autopsia/lotes/*`. Não repete o que já está provado lá; referencia.

## Legenda e fontes

| Marca | Significado |
|---|---|
| **PROVADO** | lido diretamente no código deployado, na definição SQL ou no resultado de SELECT; origem citada |
| **INFERIDO** | conclusão lógica a partir de itens provados; não observado diretamente |
| **NÃO ENCONTRADO** | procurado onde deveria estar e não existe, ou fonte inacessível |

Fontes físicas usadas nesta rodada (todas read-only):

- Projeto Supabase do João: `ldrdtaibazplvrbwyrvx`. ERP: `ynjsflvdfftcopibzxyo`.
- Edge LIVE `agente-noturno` v347. Núcleo `preloads/bug3/candidate-index-v338.ts` (`V='agente-noturno-v4.39.0-apparel-pricing-guard'`, 5.525 linhas). Referências `C:<linha>` apontam para este arquivo.
- Edge candidato `agente-noturno-bug7-phase3c-internal-dogfood-candidate` v26 (`joao-clean-candidate/v1`), arquivo único `index.ts`. Referências `D:<linha>`.
- Edge `zapi-ingest` v153 (`index.ts`). Referências `Z:<linha>`.
- Edges auxiliares lidas: `julia-session-manager`, `super-endpoint` v110, `botconversa-sender` v90, `joao-tts` v28, `joao-zapi-recovery-send` v10, `temp-joao-approved-send-20260925` v1, `order-ready-zapi-dispatcher-v1` v14, candidatos `phase3a2` e `phase3b` v4.
- RPCs/triggers: definição completa via `pg_get_functiondef` (lista na seção A).
- Preloads pinados por SHA (47) e locais (20): ver lotes 1–4 da autópsia.

---

## Resumo das cinco respostas

1. **Quem decide quem pode responder**: não existe uma RPC única. É uma composição de seis RPCs de leitura (`fn_joao_phase3c_dogfood_route_v1`, `fn_joao_phase3d_runtime_route_v1`, `fn_dono_conversa`, `fn_julia_pode_atender`, `fn_agente_pausado`, `fn_joao_human_takeover_output_guard_v1`) espalhadas entre o ingress, o núcleo do LIVE e o claim de efeito. Nenhuma delas devolve "joao" como dono. PROVADO.
2. **Edges auxiliares**: há sete componentes fora do `agente-noturno` que chamam o João, e cinco deles chamam a URL `functions/v1/agente-noturno` por string fixa (`julia-session-manager`, `fn_joao_sweep_sync_v1`, `fn_joao_guardrail_inbound_pre`, `fn_cortex_purchase_julia_confirm_joao_v1`, `super-endpoint.atenderPeloLid`). Só o `zapi-ingest` (ramo fora do horário) resolve o slug por flag. PROVADO.
3. **`_send`**: existe apenas no candidato dogfood (`D:578`, `D:584`, `D:612`), é `boolean` estrito, default ausente = não envia, não tem governança, ledger, idempotência nem HOLD/BLOCK. O `zapi-ingest` nunca envia `_send`. Quem criou: NÃO ENCONTRADO (o candidato não existe em nenhum branch do repo; `phase3a2` e `phase3b` não têm `_send`).
4. **Lock e ownership**: lock por `phone` em `agente_noturno_lock`, TTL 120 s, adquirido em `atenderCliente` (`C:2865`) e por isso comum às três entradas (inbound, bridge diurno, sweep). Quatro caminhos enviam sem esse lock: `_direct_message`, `_dry_run`, dogfood, `super-endpoint`. Bruno×João é decidido por `fn_dono_conversa` (72 h) só no ramo diurno do ingress; fora do horário o João responde sem consultar ownership. PROVADO.
5. **Efeito externo**: não há ponto canônico único. A cadeia governada (decisão `proposta` → `joao_envios` → claim → Z-API `send-text` → finish → ledger) vive como funções TypeScript dentro do núcleo do `agente-noturno`; a parte em banco (claim/finish/trigger) só aceita os slugs `agente-noturno` e `agente-conversacao`. Existem pelo menos nove emissores WhatsApp fora dessa cadeia. PROVADO.

**Veredito: `CLEAN_SLATE_BOUNDARY_NOT_PROVED`** (seção I).

---

## A. RPCs de decisão

Formato por RPC: chamadores → parâmetros → tabelas → regra → retorno → efeitos colaterais.

### A1. `fn_joao_phase3c_dogfood_route_v1(p_phone text) RETURNS boolean` — PROVADO
- **Chamador**: `zapi-ingest.hasJoaoDogfoodOverride` (`Z:253-274`), executado para toda mensagem `!fromMe && mensagem` antes do restante do roteamento (`Z:690`).
- **Tabelas**: `internal.joao_feature_flags` (`feature_key='v2_items_authority'`, `enabled=true`, `circuit_breaker_open=false`), `internal.joao_feature_flag_overrides` (`target_type='phone'`, `action='ENABLE'` com `expires_at` obrigatório e futuro; qualquer `action='BLOCK'` vigente veta).
- **Regra**: telefone normalizado deve casar `^55[0-9]{10,11}$`; exige override ENABLE com TTL. `LANGUAGE sql STABLE SECURITY DEFINER`.
- **Retorno**: `true` → ingress chama o slug dogfood; erro/exceção → `false` (fail-closed para o fluxo legado, `Z:260-272`).
- **Efeitos colaterais**: nenhum.
- **Estado hoje**: 0 overrides ENABLE vigentes (SELECT da rodada anterior). Ninguém está roteado por esta via.

### A2. `fn_joao_phase3d_runtime_route_v1(p_phone text) RETURNS boolean` — PROVADO
- **Chamador**: `zapi-ingest.resolveJoaoRuntimeSlug` (`Z:276-300`), usado **apenas** no ramo fora do horário comercial (`Z:763`). O ramo diurno não passa por aqui.
- **Tabelas**: `internal.joao_feature_flags` (mesma chave), `internal.joao_feature_flag_overrides`; chama `public.fn_joao_authority_bucket_v1(phone, rollout_salt)` (FNV-1a mod 100).
- **Regra** (ordem): flag inexistente/`enabled=false`/`circuit_breaker_open`/`mode='off'` → false; override BLOCK vigente → false; override ENABLE vigente → true; `mode='full'` → true; `mode<>'percentage'` ou `rollout_percent<=0` → false; senão `bucket < rollout_percent`.
- **Retorno**: `true` → slug `agente-noturno-bug7-phase3c-internal-dogfood-candidate`; `false`, erro ou exceção → `agente-noturno` (`Z:283-299`).
- **Efeitos colaterais**: nenhum (`STABLE`).
- **Estado hoje**: `enabled=true, mode='percentage', rollout_percent=0, circuit_breaker_open=false` → devolve sempre `false`. 100 % do tráfego fora do horário vai ao LIVE.

### A3. `fn_dono_conversa(p_lead_id uuid, p_phone text DEFAULT NULL) RETURNS jsonb` — PROVADO
- **Chamadores**: `zapi-ingest.donoConversa` (ramo horário comercial, depois de resolver `leadExistente`), `dogfood.ownerFor` (`D:88-94`). Existe segundo overload `fn_dono_conversa(p_lead_id uuid)`.
- **Tabelas**: `agente_conversacao_estado` (`status`, `trocas`, `ultimo_followup_em`, `updated_at`, `contexto_followup->>'sinal'`), `whatsapp_executor_log` (`status='enviado'`, `executado_em` ≤ 72 h, `mensagem LIKE '%Marcos Vieira%'` / `'%Bruno Fonseca%'`).
- **Regra**: estado em `bloqueada_purchase|bloqueada_humano|handoff_humano|fora_de_escopo|qualificado|recuperado` → `julia`; `sinal='checkout_sem_compra'` → `marcos`, senão `bruno`; estado ativo nas últimas 72 h (followup ou `trocas>0` com `updated_at`) → esse dono; assinatura no executor em 72 h → `marcos`/`bruno`; senão `julia` (`sem_estado` ou `estado_frio`).
- **Retorno**: `{dono, motivo, trocas?}`. `STABLE`, `statement_timeout=3s`.
- **Efeitos colaterais**: nenhum.
- **Fato relevante**: a função **nunca devolve `joao`**. "Julia" é o default para lead sem estado. Consequência para o dogfood: `ownerFor` devolve `String(d?.dono)` → `'julia'` para a maioria dos leads → `D:570` retorna `{ok:true, skip:'owned_by_julia'}` a menos que `_force===true`. O ingress não envia `_force`. **INFERIDO por leitura (não executado)**: um lead com `lead_id` roteado ao dogfood pelo ingress é respondido apenas se estiver sem estado e sem lead (`'legacy'`).

### A4. `fn_julia_pode_atender(p_lead_id uuid) RETURNS jsonb` → `fn_julia_pode_atender_legacy_v1(p_lead_id uuid) RETURNS jsonb` — PROVADO
- **Chamador**: `zapi-ingest` (ramo horário comercial, quando `fn_dono_conversa` devolve `julia`), antes de entregar ao `julia-session-manager`.
- **Tabelas**: `sistema_config` (`cortex_joao_artwork_bridge_enabled`, `julia_para_joao`), `cortex_artwork_joao_bridge_events` (janela 5 s), `fact_conversations`; legado: `agente_noturno_estado.updated_at` (posse do João 60 min), outbound `source='joao'`, humano 30 min/24 h, horário, `julia_modos_lead`, `agente_exploracao_estado`, `julia_config`.
- **Regra do wrapper**: se bridge de arte ligado e evento `detected|queued` há ≤ 5 s sem inbound posterior → `{pode:false, motivo:'artwork_delegated_to_joao_recently', owner_agent:'joao'}`; se `julia_para_joao='ativo'` e motivo legado ∈ {`joao_atendendo_lead`, `joao_atendimento_recente`, `estado_bloqueado_qualificado`} → `{pode:true, motivo:'migracao_joao_continuidade', owner_agent:'joao'}`; senão devolve o legado.
- **Retorno**: `{pode, motivo, owner_agent?, legacy_motivo?, upload_id?}`.
- **Efeitos colaterais**: nenhum.
- **Fato relevante**: a "posse do João" é derivada de `agente_noturno_estado.updated_at` (60 min). Não há coluna de dono.

### A5. `fn_agente_automatico_pode_atender(p_lead_id, p_phone, p_janela_humano_min=90, p_checar_recorrente, p_checar_purchase, p_respeitar_julia_pausa, p_checar_optout_whatsapp) RETURNS jsonb` → `_legacy_v1` — PROVADO
- **Chamadores**: `fn_conversation_effect_claim_v1` (só no ramo `agente-conversacao`, com `(p_lead_id,p_phone,90,true,true,false,false)`). Chamada pelo edge do Bruno: INFERIDO, não verificado nesta rodada.
- **Tabelas**: `sistema_pausado`, `julia_config`, optout, `crm_tasks` pendente, recorrente, purchase 24 h, assinatura humana N min.
- **Retorno**: `{pode, motivo}`. Sem efeitos colaterais.
- **Relevância para o João**: não participa do caminho do João. Listada porque é a guarda que a governança aplica ao Bruno no mesmo claim.

### A6. `fn_agente_pausado(p_phone text) RETURNS boolean` — PROVADO
- **Chamadores**: núcleo `agentePausado` (`C:1147`) usado em `atenderClienteInterno` (`C:2888-2891` → `skip:'agente_pausado'` + carimbo `pausado_humano`); `dogfood.paused` (`D:96`) → `skip:'paused'`.
- **Tabelas**: `agentes_pausados` (`pausado_ate` nulo ou futuro), `fact_conversations` outbound `source='zapi'` nos últimos 30 min sem `raw_payload.fromApi='true'`, sem assinatura `^\*Nome:\*`, fora de padrões automáticos/placeholders de mídia, e sem texto idêntico de agente (`source in joao,julia,bruno,marcos,joao_visao`) a ±120 s.
- **Retorno**: boolean. `LANGUAGE sql STABLE`. Sem efeitos colaterais.
- **Estado hoje**: 38 pausas ativas em `agentes_pausados`.

### A7. `fn_joao_human_takeover_output_guard_v1(p_phone text, p_window_minutes int DEFAULT 480) RETURNS jsonb` — PROVADO
- **Chamadores**: `fn_conversation_effect_claim_v1` (ramo `agente-noturno`, exceto `operator_dictated`/`operator_payment`, janela 480); edge `joao-zapi-recovery-send` (outputGuard).
- **Tabela**: `fact_conversations` outbound `source='zapi'`, `fromMe='true'`, `fromApi='false'`, texto assinado `^\*[^*\n]{2,80}:\*` cuja primeira linha **não** seja `*João Barros:*`, dentro da janela (clamp 1..1440 min).
- **Retorno**: `{bloquear, motivo, human_at?, signature?, window_minutes}`. `STABLE`. Sem efeitos colaterais.
- **Fato relevante**: só bloqueia envios que passam pelo claim. Dogfood, `temp-joao-approved-send`, `order-ready-zapi-dispatcher-v1` e `super-endpoint.atenderPeloLid` não passam pelo claim e por isso não são bloqueados por esta guarda.

### A8. Lock: `fn_joao_adquirir_lock(p_phone) RETURNS boolean`, `fn_joao_adquirir_lock_v3(p_phone) RETURNS uuid`, `fn_joao_liberar_lock_v3(p_phone, p_owner_token uuid) RETURNS boolean` — PROVADO
- **Chamadores**: núcleo `adquirirLock` (`C:480-482`) chama `fn_joao_adquirir_lock`; o preload pinado `patches/joao-sales-continuity-20260907/lock-v3-preload.ts` intercepta `globalThis.fetch`, redireciona para `fn_joao_adquirir_lock_v3`, guarda o token num `Map` em memória e responde `true/false` ao núcleo; o `DELETE /rest/v1/agente_noturno_lock` de `liberarLock` (`C:483`) é convertido em `fn_joao_liberar_lock_v3(p_phone, token)` e o DELETE original nunca chega ao banco (lote 3, item 11). O preload `gate7c` converte erro HTTP da RPC em `false` (lote 3, item 10), anulando o fail-open de `C:481`.
- **Tabelas**: `agente_noturno_lock(phone, locked_at, owner_token)`; `gate7c_commercial_bridge_fences` (fence `ACTIVE` com `valid_until` futuro → recusa); `gate7c_commercial_bridge_arms` / `gate7c_commercial_bridge_lock_sessions` (se há arm `ARMED`, cria sessão de 120 s; sessão ativa existente → `raise 'GATE7C_ARM_SESSION_ALREADY_ACTIVE'`).
- **Regra**: `INSERT ... ON CONFLICT(phone) DO UPDATE SET locked_at=now()[,owner_token] WHERE locked_at < now()-interval '120 seconds'`. Sem linha retornada → false/null. Chave gravada é `p_phone` **cru** (a normalização só entra no hash da fence).
- **Efeitos colaterais**: escreve `agente_noturno_lock`; escreve/aborta/expira `gate7c_commercial_bridge_lock_sessions`.
- **Liberação**: `DELETE ... WHERE phone=p_phone AND owner_token=p_owner_token`; token nulo → false.
- **Estado hoje**: 4 linhas em `agente_noturno_lock`, a mais antiga de 2026-07-21 (órfã, inerte porque o TTL permite roubo); 0 fences/arms gate7c ativos.

### A9. `fn_registrar_decisao_agente(p_agente_slug, p_acao_executada, p_resultado, ..., p_dry_run, p_agent_version, ...) RETURNS uuid` — PROVADO
- **Chamadores**: núcleo `registrarDecisaoPreEnvio` (`C:5276-5283`, `p_resultado:'proposta'`) e `registrarDecisao` (`C:2275`, `C:2284`, `p_resultado:'executada'`).
- **Tabela**: `agente_decisoes_log` (INSERT). Consulta `agentes` só para `RAISE WARNING` se o slug não existir; não bloqueia.
- **Regra**: normaliza `p_resultado` para o enum; fora do enum → `'executada'`.
- **Retorno**: `uuid` da decisão; **qualquer exceção é engolida** (`EXCEPTION WHEN OTHERS → RAISE WARNING`) e devolve `NULL`. O núcleo trata `NULL` como `PATRICIA_GOVERNANCE_BLOCKED:PRE_SEND_DECISION_REQUIRED` (`nucleo-fluxo-atenderCliente.md`, C36).
- **Slug-agnóstica**: sim. Qualquer slug consegue registrar decisão.

### A10. `fn_conversation_effect_active_policy_v1(p_agent_slug text) RETURNS text` — PROVADO
- **Chamador**: `fn_conversation_effect_claim_v1`.
- **Tabela**: `authority_policy_activation_events` (`tenant_id='skillprint_embu_01'`, último evento por `authority_domain`).
- **Regra**: mapa fixo `agente-conversacao → conversation.bruno.customer_reply`, `agente-noturno → conversation.joao.customer_reply`, **qualquer outro slug → NULL**. Só devolve política se o último evento for `ACTIVATE`.
- **Estado hoje**: `polv_joao_customer_effect_v1` e `polv_bruno_reactive_reply_v1` ativas desde 25/09 08:03.

### A11. `fn_conversation_effect_claim_v1(p_agent_slug, p_decision_id, p_lead_id, p_phone, p_runtime, p_effect_kind, p_effect_key, p_payload) RETURNS jsonb` — PROVADO
- **Chamador**: núcleo `claimConversationEffectJoao` (`C:2609-2618`) com `p_agent_slug:'agente-noturno'`, `p_runtime:V`, `p_effect_key = execution_id+':'+ordinal` (`C:3046`, `C:3079`, `C:5308`, `C:5323`, `C:5426`, `C:5432`). Ramo `agente-conversacao`: chamador não lido nesta rodada (INFERIDO pelo ramo da função e por 1 claim `FAILED` do Bruno em 7 dias).
- **Tabelas**: `agente_decisoes_log` (leitura), `patricia.conversation_effect_claims_v1` (leitura + INSERT), via A10 e A7/A5.
- **Regra (ordem de rejeição, todas com `status:'ABORTED_BYPASS_ATTEMPT'`)**: `decision_id` nulo; `runtime`/`effect_key` vazios; decisão inexistente; `agente_slug` da decisão ≠ `p_agent_slug`; `dry_run`; `terminal_operacional` já definido; `efeito_externo` já true; `lead_id` divergente (ou ausente para efeito automatizado); `resultado <> 'proposta'`; política ativa nula (A10); para `agente-noturno`: `acao_executada` deve ser a esperada para o `effect_kind` (`customer_reply|payment_payload_main → resposta_noturna_pronta_para_envio`; `operator_dictated|operator_payment → mensagem_ditada_pronta_para_envio`; `courtesy → resposta_cortesia_pronta_para_envio`; `reaction → reacao_cortesia_pronta_para_envio`) e, salvo ditado de operador, A7 não pode bloquear; slug fora do mapa → `AGENT_NOT_IN_CONVERSATION_POLICY`. Depois: se já existe claim para `(decision_id, effect_key)` → `CACHED_SUCCEEDED` / `BLOCKED_IN_FLIGHT` / `BLOCKED_FAILED_REQUIRES_NEW_DECISION` / `BLOCKED_UNKNOWN_REQUIRES_RECONCILIATION`.
- **Retorno**: `{ok:true, status:'CLAIMED', claim_id, decision_id, policy_version_id, payload_hash, guard}` ou `{ok:false, status, reason, ...}`.
- **Efeitos colaterais**: INSERT em `patricia.conversation_effect_claims_v1` com `status='CLAIMED'`, `payload_hash`, `phone_hash`, `guard_snapshot`. Constraint `UNIQUE(decision_id, effect_key)`.
- **Estado (7 dias)**: agente-noturno `customer_reply` SUCCEEDED 245 / FAILED 1 / UNKNOWN 3; `operator_dictated` 2+2; agente-conversacao 1 FAILED.

### A12. `fn_conversation_effect_finish_v1(p_claim_id, p_outcome, p_provider, p_provider_id, p_http_status, p_receipt) RETURNS jsonb` — PROVADO
- **Chamador**: núcleo `finishConversationEffectJoao` (`C:2619-2628`): `ok → SUCCEEDED`; `estado in (incerto, nao_observavel) → UNKNOWN`; senão `FAILED`. Exceções engolidas.
- **Regra**: `UPDATE ... WHERE claim_id=? AND status='CLAIMED'`; outcome fora de `SUCCEEDED|FAILED|UNKNOWN` → `REJECTED`; claim já terminal → `CLAIM_ALREADY_TERMINAL`.
- **Efeitos colaterais**: grava `status`, `receipt` (provider, provider_id, http_status, detail) e `finished_at`.

### A13. Trigger `trg_000_joao_envio_require_decision_v1` (BEFORE INSERT em `joao_envios`) → `fn_joao_envio_require_decision_v1()` — PROVADO
- **Regra**: `decision_id` obrigatório; decisão deve existir; **`agente_slug = 'agente-noturno'` (literal)**; não `dry_run`; `resultado='proposta'`, sem terminal, sem efeito; `acao_executada` ∈ {`resposta_noturna_pronta_para_envio`, `mensagem_ditada_pronta_para_envio`, `resposta_cortesia_pronta_para_envio`, `reacao_cortesia_pronta_para_envio`}. Violação → `raise 'PATRICIA_GOVERNANCE_BLOCKED'` com `detail.code`.
- **Consequência**: nenhum slug diferente de `agente-noturno` consegue gravar em `joao_envios`.

### A14. Autenticação — PROVADO
- `fn_cortex_internal_edge_auth_v1(p_token) RETURNS boolean`: compara com o segredo `internal_edge_cron_shared_secret_v1` do vault. Chamadores: `dogfood.authorized` (`D:69-75`, aceita também `Bearer <service key>`), `joao-zapi-recovery-send`, `temp-joao-approved-send`.
- `fn_edge_cron_auth_ok_v1`, `fn_zapi_webhook_auth_ok_v1`: idem para cron/webhook (rodada anterior).
- `fn_joao_http_post_vault_v1/v2(p_uri, p_content, p_content_type)`: injeta `x-cron-secret` do vault, **allowlist literal de URLs** (`agente-noturno`, `joao-erp-sale-sync`, `joao-erp-sale-sync-multi`, `joao-erp-order-read`; v2 adiciona `joao-zapi-recovery-send`). URL fora da lista → `raise 'url not allowed'`.

### A15. Reprocessamento — PROVADO
- `fn_joao_sweep_sync_v2()` → `fn_joao_sweep_sync_v1()` (cron `joao-sweep-2min`). Marca `humano_ativo` (lead com `agente_exploracao_estado.status='bloqueada_humano'`), `reprocessado`, recupera órfãos chamando `net.http_post` direto em `https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/agente-noturno` com `inbound_id` preservado (comentário no SQL: "não passa de novo pelo zapi-ingest"), e por fim `fn_joao_http_post_vault_v1(<agente-noturno>, '{"_sweep":true}')`; valida `ok`, `sweep` e `clientes_na_fila` contra um pré-check; depois `joao-erp-sale-sync` e `-multi`. Linhas elegíveis ao `_sweep` no núcleo: `status='pendente'`, `created_at` entre 4 h e 30 s atrás (`C:5352`), até `SWEEP_MAX_CLIENTES` por execução.
- `fn_joao_guardrail_inbound_pre()` (trigger BEFORE INSERT em `inbound_fora_horario`, só `status='pendente'`): quando a regra intercepta, chama `fn_joao_http_post_vault_v1(<agente-noturno>, {_direct_message, _guardrail_rule, ...})`.

### Quem define quem pode responder — síntese PROVADA

Três camadas, nenhuma delas um serviço único:

1. **Ingress (`zapi-ingest`)**, em ordem física: comandos admin/`chatAtivo` (agente-chat) → override dogfood (A1) → `fromMe` humano marca `agente_exploracao_estado='bloqueada_humano'` → botões → `agente-aprovacao` → **fora do horário**: enfileira em `inbound_fora_horario` (trigger A15 pode disparar `_direct_message` no LIVE) e chama o slug de A2 → **horário comercial**: A3 (`bruno`/`marcos` → seus edges) → A4 (`julia` pode?) → `julia-session-manager` → bridge para o LIVE.
2. **Dentro do LIVE (`atenderCliente`/`atenderClienteInterno`)**: lock (A8) → A6 pausa → `humanoAtivoRecente` (`C:2956`, `C:2974`, `C:3028`: outbound assinado por `Tamires|Helen|Alessandro|Gabriel|Daniel|Edson|Kezia|Equipe` nas últimas 2 h, ou humano que negociou) → decisão `proposta` (A9) → claim (A11, que aplica A10 e A7) → trigger do ledger (A13).
3. **Dentro do dogfood**: A6 → A3 (cede a `bruno`/`marcos`/`julia`, salvo `_force`) → sem A9/A11/A13.

---

## B. Edges e componentes auxiliares no caminho entrada → routing → João → governança → worker → transporte

Só o que está fisicamente no caminho. Colunas: quem chama / o que recebe / modifica payload / escreve estado / envia ao cliente / reescreve texto / curto-circuita o LLM / depende de `agente-noturno`.

| Componente | Quem chama | Recebe | Modifica payload | Escreve estado | Envia | Reescreve texto | Curto-circuita LLM | Dependência de `agente-noturno` | Marca |
|---|---|---|---|---|---|---|---|---|---|
| `zapi-webhook-ingress` | Z-API | webhook cru | não (encaminha) | não | não | não | não | nenhuma | PROVADO (rodada 1) |
| `zapi-ingest` v153 | ingress; `super-endpoint` | body Z-API | sim: monta `joaoPayload`/`dogfoodPayload` `{phone, chat_name, mensagem, inbound_id, tem_imagem}` (`Z:693`, `Z:760`) | `inbound_fora_horario` (INSERT), `agente_exploracao_estado`, `julia_config` | só BotConversa para admin/menus; **não** envia como João | não | sim (comandos admin, `sem_conteudo`, `fromMe_humano`) | `JOAO_LIVE_SLUG='agente-noturno'` (`Z:251`), slug dogfood (`Z:252`); `callFunction(slug)` (`Z:304`) | PROVADO |
| trigger `trg_00_joao_guardrail_inbound_pre` | INSERT em `inbound_fora_horario` (pelo ingress) | linha `pendente` | não (gera `_direct_message`) | não diretamente (o LIVE carimba) | via LIVE `_direct_message` | sim: resposta fixa da regra | **sim** (sem LLM) | URL literal via `fn_joao_http_post_vault_v1` | PROVADO |
| `julia-session-manager` (cron 1/min) | pg_cron | sessões prontas (`fn_julia_sessoes_prontas`, quiet 8 s, PIX grace 30 s) | sim: `chamarJoao` monta `{phone, chat_name:'Cliente', mensagem, inbound_id, tem_imagem, _cortex_route:'julia_absorvida', _cortex_original_reengagement?}` | `julia_sessoes_inbound` (acquire token/commit), `inbound_fora_horario` (`bridge_joao` → `pendente` em `rearmarLoteJoao`), `error_log` | não (delega ao LIVE) | não | não | **URL literal** `${SUPABASE_URL}/functions/v1/agente-noturno`, timeout 55 s | PROVADO |
| cron `joao-sweep-2min` → `fn_joao_sweep_sync_v2/v1` | pg_cron | `inbound_fora_horario` pendentes | não | `inbound_fora_horario.status` (`humano_ativo`, `reprocessado`), recovery | via LIVE | não | não | URL literal ×2 (net.http_post direto + vault v1 allowlist) | PROVADO |
| `fn_joao_recovery_before_redecision_v1` | sweep | decisões/envios órfãos | não | reconcilia `agente_decisoes_log`/`joao_envios` | não | não | não | semântica do ledger do LIVE | PROVADO (rodada 1) |
| trigger `pixel_events` Purchase → `fn_cortex_purchase_julia_confirm_joao_v1` | INSERT em `pixel_events` | evento `purchase_julia_%` | gera `_direct_message` | não | via LIVE | sim (texto fixo) | sim | URL literal | PROVADO (rodada 1) |
| `agente-noturno` v347 (LIVE) | os cinco acima | `{phone, chat_name, mensagem, inbound_id, tem_imagem, _sweep?, _direct_message?, _dry_run?, _cortex_route?}` | — | `agente_noturno_estado`, `agente_noturno_lock`, `agente_decisoes_log`, `joao_envios`, claims, `fact_conversations` (`gravarFio`, `C:2703`), `inbound_fora_horario.status`, `error_log` + escritas dos preloads (rodada 1, seção "Preloads que escrevem") | **sim** (Z-API `send-text`/`send-audio`/`send-reaction`, BotConversa fallback) | sim (≈60 preloads; freshness devolve sucesso sintético; gate7c troca Z-API por fila do executor) | sim (guardrails, `_direct_message`, respostas fixas) | é o próprio | PROVADO |
| `joao-tts` v28 | núcleo `entregarComoJoao` (`sintetizarVoz`) | texto | não | não | não (devolve base64) | não | não | flag `joao_tts_ativo`; chamado só pelo LIVE | PROVADO |
| `whatsapp-executor` (via preload gate7c) | preload gate7c intercepta `send-text` com payload Pix | texto/Pix | sim | `waba_disparos_lista` (fila) | sim (BotConversa) | não | não | acionado só de dentro do LIVE | PROVADO (lote 3) |
| `super-endpoint` v110 | Z-API (ingress alternativo) | webhook | sim | `insert_zapi_inbox_atomic`, `whatsapp_message_log`, `fact_conversations` | **sim** em `atenderPeloLid` (Z-API pelo `@lid`, texto fallback fixo) | sim (fallback) | parcial: chama `agente-noturno {_dry_run:true}` e envia por conta própria | URL literal; `_dry_run` → sem lock, sem claim | PROVADO |
| `agente-noturno-bug7-phase3c-internal-dogfood-candidate` v26 | `zapi-ingest` (A1) ou chamada manual | `{phone, mensagem|message, _send?, _force?, _no_persist?, history?}` | — | `agente_noturno_estado` (upsert por `phone`, `etapa:'clean_v2'`, `D:112-123`) | só com `_send===true` | não | sim (`deterministic-erp`, clarificação) | nenhuma import; **compartilha** `agente_noturno_estado`, `fact_conversations` (leitura `D:129`), `fn_dono_conversa`, `fn_agente_pausado` | PROVADO |

Fora do caminho do João mas emitindo no mesmo número de WhatsApp (ver E3): `botconversa-sender`, `whatsapp-executor` (Bruno/Marcos), `agente-conversacao`, `agente-fechamento`, `joao-zapi-recovery-send`, `temp-joao-approved-send-20260925`, `order-ready-zapi-dispatcher-v1`, `joao-preflight-ready-v1`, `comprovante-pix-worker`, `zapi-send-contact`, `agente-chat`, RPCs `botconversa_send_message(_sync)`, `fn_bc_solicitar_subscriber`.

**Quem escreve estado do João**: LIVE (`agente_noturno_estado` via `lerEstado`/gravação do núcleo e preloads) e dogfood (`saveState`, mesma tabela, mesma chave `phone`). PROVADO. Colisão de linha entre LIVE e candidato: INFERIDO (nenhum caso observado porque o candidato não recebe tráfego).

**Quem reescreve texto antes do transporte**: só preloads dentro do LIVE (lotes 1–4). Nenhum componente externo reescreve a resposta do João. PROVADO.

**Quem curto-circuita o LLM fora do LIVE**: trigger guardrail, trigger purchase (ambos injetam `_direct_message`), `super-endpoint` (fallback fixo). PROVADO.

---

## C. Contrato exato de `_send`

### Onde existe — PROVADO
- **Somente** em `agente-noturno-bug7-phase3c-internal-dogfood-candidate` v26, `index.ts`: `if(body._send===true) sent=await sendZapi(phone,reply);` em `D:578` (resposta determinística de catálogo), `D:584` (pergunta de clarificação) e `D:612` (resposta do modelo).
- Não existe em nenhum dos 38 arquivos do LIVE nem nos 47 imports pinados (grep `\b_send\b` = 0 ocorrências). Não existe em `phase3a2` (0 ocorrências no dump de 724 KB) nem em `phase3b` v4 (43 arquivos, 0 ocorrências).
- Nenhuma RPC lida nesta rodada referencia `_send`. `zapi-ingest` não referencia `_send` (grep = 0).

### Quem criou — NÃO ENCONTRADO
O código do candidato não existe como blob em nenhum dos 108 branches do repositório (rodada 1). Não há migration, commit, PR ou comentário que introduza `_send`. Primeira aparição observável: v26 do dogfood (versões 1–25 não inspecionadas; o histórico de versões da edge não expõe diff).

### Tipo, default, leitura — PROVADO
- Tipo: `boolean` com comparação estrita (`=== true`). `"true"` (string), `1`, `"1"` não enviam.
- Default: ausente → `sent = {ok:false, skipped:true}` e a resposta é devolvida no JSON sem envio.
- Lido em três pontos, sempre depois de a resposta existir; não altera nada antes (não afeta `loadState`, `saveState`, `brain`).

### Schema real do request (derivado de `D:558-612`, sem campos inventados)

```json
{
  "phone": "55DDDNNNNNNNN",        // obrigatório; normalizado por normPhone; regex ^55\d{10,11}$ (D:562-564)
  "mensagem": "texto",              // obrigatório (ou "message"); trim; vazio → 400 phone_or_message_invalid
  "_send": true,                    // opcional; só true literal envia (D:578/584/612)
  "_force": true,                   // opcional; ignora owner bruno/marcos/julia (D:570)
  "_no_persist": true,              // opcional; bloqueia saveState (D:597, D:113)
  "history": [ {"role":"user|assistant","content":"..."} ]   // opcional; últimos 12; se ausente lê fact_conversations (D:124-133)
}
```

Campos que o ingress envia e o candidato **ignora** (não lidos no handler): `chat_name`, `inbound_id`, `tem_imagem`. PROVADO (grep = 0 em `index.ts`). Consequência: o candidato **não carimba** `inbound_fora_horario` e o `inbound_id` se perde.

Autenticação: `Authorization: Bearer <service key>` ou header `x-cron-secret` validado por `fn_cortex_internal_edge_auth_v1` (`D:69-75`). Método só `POST`.

### Schema real do response — PROVADO
```json
{ "ok": true, "version": "joao-clean-candidate/v1", "model": "<MODEL>|deterministic-erp",
  "lead_id": "uuid|null", "owner": "bruno|marcos|julia|legacy",
  "reply": "texto", "state": { "schema_version": "joao-items/v1", "items": [...] },
  "tools": ["..."],
  "writer": { "write_allowed": bool, "block_reason": "INFORMATIONAL_ONLY|AMBIGUOUS_TARGET|null",
              "resolution": {...}|null, "divergence_flags": [...] },
  "sent": { "ok": false, "skipped": true }                       // sem _send
        | { "ok": bool, "id": "messageId|zaapId|id|null", "status": 200 }   // com _send
        | { "ok": false, "error": "zapi_config_ausente" } }
```
Saídas curtas: `{ok:true, skip:'paused'}` (`D:568`), `{ok:true, skip:'owned_by_<owner>'}` (`D:570`); erros `405 method_not_allowed`, `401 unauthorized`, `400 invalid_json`, `400 phone_or_message_invalid`, `502 brain_failed`.

### Governança, idempotência, autorização — PROVADO
- **Decisão prévia**: nenhuma (`fn_registrar_decisao_agente` não é chamada; grep = 0).
- **Claim de efeito**: nenhum (`fn_conversation_effect_claim_v1` não é chamada; grep = 0).
- **Ledger**: nenhum (`joao_envios` não é tocada; `fact_conversations` só é lida, `D:129`; `whatsapp_message_log` não é tocada).
- **Idempotency key**: nenhuma. `sendZapi` (`D:459-469`) faz um único `POST send-text` sem chave; `inbound_id` não é usado. Reenvio do mesmo webhook = novo envio.
- **HOLD/BLOCK**: NÃO ENCONTRADO. Não existe estado HOLD nem BLOCK. O único "block" é `writer.block_reason` (`INFORMATIONAL_ONLY`/`AMBIGUOUS_TARGET`), que bloqueia **escrita de estado**, não envio: com `_send:true` a resposta é enviada mesmo com `write_allowed=false` (`D:578`, `D:584`).
- **Guardas de humano**: só `fn_agente_pausado` (A6) e `fn_dono_conversa` (A3). `fn_joao_human_takeover_output_guard_v1` (A7) não é consultada.
- **Quem executa o envio**: a própria edge, direto na Z-API (`https://api.z-api.io/instances/<id>/token/<token>/send-text`, header `Client-Token`, prefixo `'*Joao Barros:*\n'` sem acento, timeout 20 s). Credenciais via env `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`. Sem fallback BotConversa. Sem retry.
- **Por que o candidato é mudo em produção**: o `dogfoodPayload` do ingress (`Z:693-699`) e o `joaoPayload` (`Z:760`) não contêm `_send` → toda chamada vinda do ingress devolve `sent.skipped=true`. PROVADO.

---

## D. Ownership e locking

### D1. Lock de execução do João — PROVADO
| Item | Valor | Origem |
|---|---|---|
| Chave de identidade | `phone` cru como recebido pelo núcleo (`String(body.phone).replace(/\D/g,'')`, `C:5391`) | `fn_joao_adquirir_lock*` (`insert ... values(p_phone, ...)`) |
| Tabela | `agente_noturno_lock(phone PK, locked_at, owner_token)` | A8 |
| TTL | 120 s (`locked_at < now() - interval '120 seconds'` permite roubo) | A8 |
| Aquisição | `atenderCliente` (`C:2865`): `if (!dryRun) { temLock = await adquirirLock(phone); if (!temLock) return {ok:true, skip:'lock_ocupado'} }` → RPC `fn_joao_adquirir_lock` interceptada pelo preload lock-v3 → `fn_joao_adquirir_lock_v3` → token em `Map` de memória | `C:480-482`, `C:2865`, lote 3 item 11 |
| Renovação | **NÃO ENCONTRADO**. Nenhum heartbeat. Turno maior que 120 s pode ser roubado por outro turno do mesmo phone. Risco: INFERIDO |
| Liberação | `finally liberarLock` (`C:483`, DELETE por phone) → interceptado → `fn_joao_liberar_lock_v3(phone, token)`; sem token (preload não interceptou a aquisição) → `false` e a linha fica até expirar | lote 3 item 11 |
| Precedência sobre o lock | fence gate7c `ACTIVE` → lock negado antes do INSERT; arm gate7c `ARMED` → cria sessão de 120 s e aborta sessões cujo `locked_at` mudou | A8 |
| Falha da RPC | núcleo: `if (error) return true` (fail-open, `C:481`); gate7c converte HTTP erro em `false` (fail-closed). Comportamento efetivo em produção: fail-closed | lote 3 item 10 |

### D2. Quem obedece a esse lock — PROVADO
| Entrada | Passa por `atenderCliente`? | Lock | Origem |
|---|---|---|---|
| Inbound normal fora do horário (`zapi-ingest` → LIVE turno normal) | sim | sim | `C:5391+` → `atenderCliente` |
| Bridge diurno (`julia-session-manager.chamarJoao` → LIVE turno normal, `_cortex_route:'julia_absorvida'`) | sim | sim (mesmo phone) | idem |
| Sweep (`_sweep:true` → `atenderCliente(ph, ...)` por phone agrupado) | sim | sim | `C:5351-5389` |
| `_direct_message` (guardrail, purchase, sweep recovery) | **não** (caminho próprio `C:5398-5460`: decisão → `prepararEnvio` → `enviarComoJoaoGovernado`) | **não** | `C:5398+` |
| `_dry_run` (inclusive `super-endpoint.atenderPeloLid`) | sim, mas `if (!dryRun)` pula o lock | **não** | `C:2865` |
| Dogfood candidate | não (edge separada) | **nenhum lock** | `D:558-620` |
| Bruno (`agente-conversacao`) | não | trava própria `agente_conversacao_estado.processando_em` (45 s) | rodada anterior |
| `julia-session-manager` | não | lock de sessão por token (`fn_julia_sessao_acquire`), zumbis liberados após 3 min (`fn_julia_sessoes_cleanup_zumbis`); advisory lock por lead em `fn_julia_sessao_add_msg` | rodada anterior |

Resposta à pergunta "as três entradas obedecem ao mesmo lock": **sim para inbound, bridge e sweep**, porque as três convergem na mesma função `atenderCliente` dentro da mesma edge. Mas o lock é implementado como função TypeScript + preload interceptador dentro do `agente-noturno`; a única parte que existe como serviço são as RPCs `_v3`. Um João novo só obedece ao mesmo lock se chamar `fn_joao_adquirir_lock_v3`/`fn_joao_liberar_lock_v3` por conta própria.

### D3. Precedência humano × agente — PROVADO
| Mecanismo | Janela | Onde age | Quem respeita |
|---|---|---|---|
| `agentes_pausados` (pausa manual) | até `pausado_ate` | A6 | LIVE (`skip:'agente_pausado'`, carimbo `pausado_humano`), dogfood (`skip:'paused'`) |
| Outbound humano no aparelho (Z-API sem `fromApi`) | 30 min | A6 | idem |
| Outbound assinado por humano (`RX_HUMANO`) | 2 h; ou qualquer se "negociou" (pdf/orçamento/pix/comprovante) | núcleo `C:2974-2975`, `C:3028` | só LIVE (`skip:'humano_ativo'`, carimbo `humano_ativo`) |
| Takeover humano assinado (`*Nome:*` ≠ João Barros, `fromMe` sem `fromApi`) | 480 min | A7 dentro do claim (A11) | só envios governados do LIVE; `_direct_message` isento |
| `agente_exploracao_estado.status='bloqueada_humano'` | até reset | `zapi-ingest` (`fromMe` humano) e sweep (`humano_ativo`) | Julia/sweep; LIVE não lê essa coluna diretamente (INFERIDO) |
| Julia legado: humano 30 min / 24 h | 30 min / 24 h | A4 legacy | só ramo diurno |

### D4. Precedência Bruno × João e Julia × João — PROVADO
- **Ramo diurno** (`zapi-ingest`): `fn_dono_conversa` (A3, 72 h) decide `bruno`/`marcos` antes de qualquer João. Se `julia`, `fn_julia_pode_atender` (A4) decide; a "posse do João" ali é `agente_noturno_estado.updated_at` ≤ 60 min ou outbound `source='joao'` recente, convertida em `migracao_joao_continuidade` quando `julia_para_joao='ativo'`. O João nunca é dono explícito; ele "herda" a sessão da Julia via bridge.
- **Ramo fora do horário** (`zapi-ingest` `Z:745-771`): o `return` do ramo fora-do-horário acontece **antes** do bloco que consulta `fn_dono_conversa`. O João responde mesmo com Bruno ativo há menos de 72 h. Dentro do LIVE não há consulta a `fn_dono_conversa` (grep = 0 no núcleo).
- **Sweep**: não consulta ownership de agente; só `bloqueada_humano`.
- **Dogfood**: consulta A3 e cede a `bruno`/`marcos`/`julia` (isto é, cede em quase todo lead com `lead_id`, ver A3).
- **72 h**: aparece só em `fn_dono_conversa` (Bruno/Marcos). Não há 72 h para o João.

### D5. Carimbo de `inbound_fora_horario` (posse do lote) — PROVADO
`carimbarInbound` (`C:2403-2407`): com `ids` → UPDATE por id; sem `ids` → UPDATE das linhas `pendente` do phone nos últimos 10 min. Estados gravados pelo LIVE: `atendido_joao`, `silencio_joao`, `humano_ativo`, `pausado_humano`, `ja_respondida`, etc. O dogfood não carimba nada (não lê `inbound_id`). O sweep reelege qualquer linha ainda `pendente` entre 30 s e 4 h. INFERIDO: qualquer runtime novo que não carimbe a linha em menos de 30 s terá o lote reprocessado pelo LIVE.

---

## E. Cadeia canônica de efeito externo

### E1. Cadeia governada do LIVE (texto principal) — PROVADO
1. `registrarDecisaoPreEnvio` → A9 com `p_resultado:'proposta'`, `acao_executada:'resposta_noturna_pronta_para_envio'` (`C:5276-5283`). Sem id → `skip:'PATRICIA_GOVERNANCE_BLOCKED:PRE_SEND_DECISION_REQUIRED'`.
2. `prepararEnvio` → INSERT `joao_envios {decision_id, execution_id, ordinal, tipo, provider:'nenhum', phone, status:'preparado'}` (`C:2291`); trigger A13 valida.
3. `entregarComoJoao` (`C:2655`): decide texto ou áudio (`joao_tts_ativo` + cliente mandou áudio + elegibilidade → `joao-tts` → `send-audio`); chama `enviarComoJoaoGovernado` (`C:2633-2642`).
4. `claimConversationEffectJoao` → A11 com `effect_kind:'customer_reply'`, `effect_key: execution_id+':1'`, `payload:{phone, execution_id, ordinal, message...}` (`C:5308`). Rejeição → `governanceBlockedEnv` (`canal:'governance'`, `estado:'rejeitado_provider'`, `erro:'ABORTED_BYPASS_ATTEMPT:<reason>'`), sem envio.
5. `enviarComoJoao` (`C:2409-2440`): Z-API `send-text` com `Client-Token`, body `{phone, message: assinatura+texto}`, timeout 15 s. 2xx sem id → `estado:'incerto'`; HTTP rejeitado → fallback BotConversa `get_by_phone` + `send_message` (`estado:'nao_observavel'`); sem credenciais Z-API → só BotConversa. **Sem retry.**
6. `finishConversationEffectJoao` → A12 (`SUCCEEDED`/`UNKNOWN`/`FAILED`).
7. `finalizarEnvioLedger` → UPDATE `joao_envios` (provider, ids, http_status, status=`estado`, modalidade, tts).
8. `finalizarDecisaoEnvio` → UPDATE `agente_decisoes_log` (`resposta_noturna_enviada` | `resposta_noturna_falhou_envio`, `efeito_externo`, `terminal_operacional`).
9. `gravarFio` → INSERT `fact_conversations` (`C:2703`, outbound `source='joao'`).
10. Carimbo do lote (`carimbarInbound`).
11. Eco do provedor: o webhook Z-API `fromMe/fromApi` volta pelo ingress e reconcilia `mensagem_envio` (`fn_mensagem_envio_reconciliar`) e `whatsapp_message_log`/`fact_conversations` (rodada anterior).

Segundo envio na mesma decisão (Pix): `effect_key: execution_id+':2'`, `effect_kind:'payment_payload_main'` (`C:5323`). Cortesia (`C:3079`) e reação (`C:3046`) têm decisões próprias. `_direct_message` (`C:5423-5432`): decisão `mensagem_ditada_pronta_para_envio`, `operator_dictated`/`operator_payment`, isenta de A7.

**Idempotência**: só via A11 (`UNIQUE(decision_id, effect_key)`): a mesma decisão não envia duas vezes. Uma decisão nova para o mesmo inbound gera envio novo (sweep/rearm; contradição 29 da rodada 1). **Timeout**: 15 s Z-API. **Duplicidade entre provedores**: `incerto` (2xx sem id) não dispara fallback; `nao_observavel` só após rejeição HTTP. **Confirmação**: `messageId`/`zaapId` no ledger + eco do webhook. **Event store**: `agente_decisoes_log` + `joao_envios` + `patricia.conversation_effect_claims_v1` + `fact_conversations` + `error_log`. Nenhum deles é um event store append-only único; são cinco tabelas com semânticas diferentes.

Interferência de preloads no passo 5 (lotes 3–4, PROVADO): gate7c substitui `send-text` com payload Pix por enfileiramento no `whatsapp-executor`; freshness devolve sucesso sintético; output-guard e promise-guard podem trocar o texto. O `finish` recebe o que o preload devolveu, não o que a Z-API fez (INFERIDO para o caso gate7c).

### E2. Worker
Não existe worker separado. O "worker" é a própria invocação HTTP do `agente-noturno`: a decisão, o claim, o envio e o ledger acontecem no mesmo processo Deno, na mesma requisição. Não há fila de saída do João (a única fila é a do `whatsapp-executor` quando gate7c intercepta). PROVADO.

### E3. Todos os emissores WhatsApp encontrados (mesmo número) — PROVADO por leitura
| Emissor | Provedor | Decisão A9 | Claim A11 | Ledger `joao_envios` | Idempotência | Guarda humano |
|---|---|---|---|---|---|---|
| LIVE `enviarComoJoaoGovernado` (texto/áudio/reação/ditado/Pix) | Z-API → BotConversa fallback | sim | sim | sim | claim | A6 + `humanoAtivoRecente` + A7 |
| LIVE via preload gate7c (Pix) | `whatsapp-executor` (BotConversa fila) | sim | sim (claim anterior) | sim | claim; fila própria | idem |
| Dogfood `sendZapi` | Z-API | não | não | não | nenhuma | A6 + A3 |
| `super-endpoint.atenderPeloLid` | Z-API (`@lid`) | não (usa `_dry_run` do LIVE) | não | não | nenhuma | NÃO ENCONTRADO |
| `temp-joao-approved-send-20260925` | Z-API cru | não | não | não | nenhuma | só `x-cron-secret` |
| `order-ready-zapi-dispatcher-v1` (cron 1/min, assinado "*João Barros:*") | Z-API | não | não | não | claim/complete/fail da fila ERP | NÃO ENCONTRADO |
| `joao-zapi-recovery-send` v10 | Z-API | exige `decision_id` (trigger A13) | NÃO ENCONTRADO no código lido | sim (`mensagem_ditada`) | ledger | A7 (outputGuard) |
| `botconversa-sender` v90 (chamado por `joao-preflight-ready-v1` e outros) | BotConversa | não | não | `mensagem_envio` | `origem_tipo/origem_id` | não |
| `whatsapp-executor` (Bruno/Marcos) | BotConversa | própria | não | `whatsapp_executor_log` | fila | própria |
| `agente-conversacao` (Bruno) | BotConversa | sim | sim (ramo Bruno) | não | claim | A5 |
| `agente-fechamento` (Marcos, bloqueado) | Z-API + BC | ? | não | não | ? | ? |
| `comprovante-pix-worker.notificarAdmin`, `zapi-send-contact`, `agente-chat` | Z-API | não | não | não | nenhuma | não |
| SQL `botconversa_send_message(_sync)`, `fn_bc_solicitar_subscriber` | BotConversa | não | não | não | nenhuma | não |

**Conclusão E**: **múltiplos caminhos**. O único caminho com decisão + claim + ledger + finish é o de dentro do LIVE, e ele só existe como código TypeScript do `agente-noturno`. Não há serviço de envio canônico.

---

## F. Validação da fronteira Clean Slate

Teste: "inbound / bridge / sweep → `JOAO_CLEAN` sem importar código do `agente-noturno`", assumindo um slug novo (≠ `agente-noturno`).

| Entrada | Ponto de troca existente | Resultado | Evidência |
|---|---|---|---|
| Inbound **fora do horário** | `zapi-ingest.resolveJoaoRuntimeSlug` (A2) → `callFunction(slug)` | **NÃO PROVADO**. O ponto de troca existe e é independente do código do LIVE, mas: (a) o INSERT em `inbound_fora_horario` que o precede dispara `trg_00_joao_guardrail_inbound_pre`, que chama o LIVE por URL fixa; (b) a linha fica `pendente` e o sweep a reelege no LIVE entre 30 s e 4 h se o runtime novo não carimbar; (c) o slug alvo é uma constante do `zapi-ingest` (`Z:252`), não uma configuração. | `Z:251-252`, `Z:745-771`, A15, `C:5352` |
| Inbound **horário comercial** | nenhum | **FALSO**. O ramo diurno não consulta A2; vai para `fn_dono_conversa` → `julia-session-manager` → `chamarJoao` com URL literal `${SUPABASE_URL}/functions/v1/agente-noturno`. | `Z:773+`, `julia-session-manager.chamarJoao` |
| Bridge diurno | nenhum | **FALSO** (mesma URL literal; `rearmarLoteJoao` devolve o lote ao `pendente`, que o sweep entrega ao LIVE). | idem + `rearmarLoteJoao` |
| Sweep | nenhum | **FALSO**. `fn_joao_sweep_sync_v1` usa duas URLs literais para `agente-noturno` e o helper `fn_joao_http_post_vault_v1` só aceita 4 URLs (5 na v2), todas do LIVE. | A15, A14 |
| Triggers `_direct_message` (guardrail, purchase) | nenhum | **FALSO** (URL literal via vault v1). | A15 |
| `super-endpoint.atenderPeloLid` | nenhum | **FALSO** (URL literal; envia por conta própria). | B |
| Governança do efeito para slug novo | A10/A11/A13 | **FALSO**. `fn_conversation_effect_active_policy_v1` devolve NULL para qualquer slug fora de {`agente-conversacao`,`agente-noturno`} → claim `NO_ACTIVE_CONVERSATION_POLICY`; trigger de `joao_envios` exige literal `agente-noturno`. Um João novo com slug próprio só envia **sem** governança (como o dogfood) ou fingindo ser `agente-noturno`. | A10, A11, A13 |
| Ownership para o slug novo | A3/A6 reutilizáveis | **PROVADO** que as RPCs são chamáveis sem código do LIVE (o dogfood já faz). Mas A3 devolve `julia` por default e o dogfood cede → runtime mudo sem `_force`. | A3, `D:570` |
| Lock para o slug novo | `fn_joao_adquirir_lock_v3`/`liberar_v3` | **PROVADO** que existem como RPCs chamáveis; **NÃO PROVADO** que o candidato as use (dogfood não usa). | A8, `D:*` |
| Estado para o slug novo | `agente_noturno_estado` | **NÃO PROVADO** isolamento: dogfood grava na mesma linha (`phone`) que o LIVE lê. | `D:112-123`, `C:2888+` |

Classificação global: **NÃO PROVADO**. Existe exatamente um ponto de troca por flag (A2), cobrindo um dos cinco caminhos de entrada, e mesmo esse caminho é reabsorvido pelo LIVE via trigger e sweep.

---

## G. Serviços reutilizáveis × acoplados ao legado

| Serviço | Onde vive hoje | Classificação | Motivo (PROVADO salvo indicação) |
|---|---|---|---|
| Routing por flag/percentual | `fn_joao_phase3c_dogfood_route_v1`, `fn_joao_phase3d_runtime_route_v1`, `internal.joao_feature_flags/_overrides` | **REUTILIZÁVEL COMO SERVIÇO CANÔNICO** (as RPCs) / **ACOPLADO** (a cobertura) | RPCs puras por phone; mas o slug alvo é constante no `zapi-ingest` e só o ramo fora-do-horário consulta |
| Lock | `agente_noturno_lock` + `fn_joao_adquirir_lock_v3` / `fn_joao_liberar_lock_v3` | **REUTILIZÁVEL COMO SERVIÇO CANÔNICO** (com dependência) | RPCs por phone, token, TTL 120 s; dependem das tabelas gate7c (fence/arm), hoje vazias; a versão sem token (`fn_joao_adquirir_lock`) é legado |
| Ownership Bruno/Marcos/Julia | `fn_dono_conversa` | **REUTILIZÁVEL** | slug-agnóstica, sem escrita; ressalva: nunca devolve `joao` |
| Pausa/humano no aparelho | `fn_agente_pausado` | **REUTILIZÁVEL** | por phone, sem escrita |
| Takeover humano assinado | `fn_joao_human_takeover_output_guard_v1` | **REUTILIZÁVEL** (parametrizada) | assinatura `*João Barros:*` fixa na regex |
| Posse do João (60 min) | `fn_julia_pode_atender_legacy_v1` | **ACOPLADO** | derivada de `agente_noturno_estado.updated_at` e semântica da Julia |
| Session state | `agente_noturno_estado(phone, lead_id, etapa, slots)` | **ACOPLADO** | tabela e chave compartilhadas entre LIVE e candidato; `slots` tem dois schemas (legado e `joao-items/v1`) |
| Memory / histórico | `fact_conversations` (leitura) | **REUTILIZÁVEL** (como fonte) | dogfood e LIVE leem a mesma tabela; escrita outbound `source='joao'` é feita pelo LIVE (`gravarFio`) |
| Aprendizados | `fn_contexto_aprendizados`, `prompt_manifesto_joao` | **ACOPLADO** | dependem do prompt do LIVE (rodada 1) |
| Skill loader | preloads que patcham `globalThis.fetch`/`Deno.serve` dentro do LIVE | **ACOPLADO** (não existe como serviço) | rodada 1, lotes 1–4 |
| Tools | funções no núcleo; RPCs ERP (`erpRpc`) | **ACOPLADO** (registro/execução) / **REUTILIZÁVEL** (as RPCs ERP) | rodada 1 seção tools |
| Governance adapter: decisão | `fn_registrar_decisao_agente` | **REUTILIZÁVEL** | slug-agnóstica |
| Governance adapter: claim/finish/política | A10, A11, A12 | **ACOPLADO** | mapa de slugs literal; guard por slug |
| Governance adapter: ledger | `joao_envios` + A13 | **ACOPLADO** | trigger exige `agente_slug='agente-noturno'` |
| Send adapter Z-API | `enviarComoJoao` (TS no núcleo); `sendZapi` (dogfood); ×7 outros | **NÃO EXISTE COMO SERVIÇO** | cada emissor tem o próprio `fetch` |
| Send adapter BotConversa | `botconversa-sender` v90 | **REUTILIZÁVEL** | edge própria, idempotente por `origem_tipo/origem_id` |
| Idempotency | `UNIQUE(decision_id, effect_key)` em claims; `mensagem_envio` | **ACOPLADO** (claims) / **REUTILIZÁVEL** (`mensagem_envio`, só BC) | idem |
| Event logging | `agente_decisoes_log`, `error_log`, `fact_conversations` | **REUTILIZÁVEL** (tabelas) | escritas por vários agentes |
| Auth interna | `fn_cortex_internal_edge_auth_v1`, `fn_edge_cron_auth_ok_v1` | **REUTILIZÁVEL** | segredo do vault, sem slug |
| Helpers HTTP do banco | `fn_joao_http_post_vault_v1/v2`, `fn_joao_net_http_post_vault_v1` | **ACOPLADO** | allowlist literal de URLs do LIVE |
| TTS | `joao-tts` v28 | **REUTILIZÁVEL** | recebe texto, devolve base64; flag `joao_tts_ativo` |

---

## H. Bloqueadores restantes (só dependências da fronteira; sem lista de melhorias)

1. `julia-session-manager.chamarJoao`: URL literal `functions/v1/agente-noturno`. Cobre todo o tráfego diurno.
2. `fn_joao_sweep_sync_v1`: duas URLs literais + allowlist de `fn_joao_http_post_vault_v1/v2`. Cobre o reprocessamento.
3. `fn_joao_guardrail_inbound_pre` e `fn_cortex_purchase_julia_confirm_joao_v1`: URL literal; disparam o LIVE no INSERT, antes de qualquer roteamento.
4. `super-endpoint.atenderPeloLid`: URL literal + envio próprio via `_dry_run`.
5. `fn_conversation_effect_active_policy_v1`, `fn_conversation_effect_claim_v1`, `fn_joao_envio_require_decision_v1`: slug `agente-noturno` literal. Sem política de efeito para outro slug.
6. `inbound_fora_horario`: o candidato não carimba a linha (ignora `inbound_id`); o sweep reelege no LIVE após 30 s.
7. `agente_noturno_estado`: chave `phone` compartilhada entre LIVE e candidato.
8. `zapi-ingest`: slugs constantes (`Z:251-252`); ramo diurno sem consulta a A2; payload sem `_send` e sem `_force` → candidato mudo.
9. Lock: candidato não chama `fn_joao_adquirir_lock_v3`/`liberar_v3` → sem exclusão mútua com o LIVE no mesmo phone.

---

## I. VEREDITO

**`CLEAN_SLATE_BOUNDARY_NOT_PROVED`**

Dependências faltantes para que a fronteira seja provável (exatamente as de H, sem acréscimos):

- Ponto de troca de slug para: `julia-session-manager.chamarJoao`; `fn_joao_sweep_sync_v1` (+ allowlist `fn_joao_http_post_vault_v1/v2`); `fn_joao_guardrail_inbound_pre`; `fn_cortex_purchase_julia_confirm_joao_v1`; `super-endpoint.atenderPeloLid`; ramo diurno do `zapi-ingest`.
- Política de efeito e ledger que aceitem um slug diferente de `agente-noturno` (A10, A11, A13).
- Posse do lote em `inbound_fora_horario` pelo runtime novo (carimbo) ou exclusão do sweep do LIVE para phones roteados.
- Estado e lock próprios (ou uso explícito de `fn_joao_adquirir_lock_v3`/`liberar_v3` e chave de estado distinta).
- Contrato de envio do candidato: `_send`/`_force` decididos por quem roteia, não pelo chamador manual.

Investigação encerrada. STOP.
