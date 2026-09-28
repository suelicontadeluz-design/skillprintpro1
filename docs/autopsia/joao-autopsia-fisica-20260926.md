# Autópsia física do João — 26/09/2026

Missão: **READ ONLY**. Nenhum código, banco, configuração, tráfego, flag, deploy ou dado foi alterado.
Este arquivo é o único artefato produzido. Tudo abaixo foi lido diretamente do runtime deployado
(Supabase, projeto `ldrdtaibazplvrbwyrvx`), do banco desse projeto e do repositório `suelicontadeluz-design/skillprintpro1`.

Legenda: **PROVADO** = evidência lida (arquivo:linha, função SQL, linha de tabela). **INFERIDO** = conclusão a partir de evidência indireta. **NÃO ENCONTRADO** = procurado e não achado; ausência de evidência, não conclusão.

Rastreabilidade das fontes: o código deployado foi extraído para o scratchpad da sessão (`edge/agente-noturno/*` = os 38 arquivos da edge LIVE v347; `edge/raw/*` = os 47 imports pinados por SHA; `edge/dogfood/*`, `edge/zapi-ingest/*`, `edge/conversacao/*`). Linhas citadas como `core:NNNN` referem-se a `preloads/bug3/candidate-index-v338.ts` da edge LIVE.

---

## 0. Os dez fatos que mudam a premissa

1. **O João que roda não está no repositório.** A edge `agente-noturno` v347 (atualizada 25/09 09:49 UTC) tem 38 arquivos; **nenhum dos 38 existe como blob em nenhum commit de nenhum dos 108 branches** do repo (comparação por hash de objeto git, 966 blobs). O núcleo LIVE é `agente-noturno-v4.39.0-apparel-pricing-guard` (core:362); o último núcleo versionado no repo é `v4.37.5-freight-choice` (commit `916b288`). `zapi-ingest` v153 e o candidato "clean" também não estão no repo. PROVADO.
2. **O prompt fixo do núcleo é substituído em runtime.** O preload `joao-prompt-core-preload-v1b.ts` (PC_ENABLED=true hardcoded, sem flag no banco) intercepta a chamada à Anthropic e troca os 16.263 chars fixos (`SYSTEM` 8.341 + `REGRAS_EXTRA` 7.922) por um core de ~3,3 KB, preservando tudo que vem depois. O `SYSTEM` que o código-fonte mostra **não é o que o modelo lê**. PROVADO (`preloads/joao-prompt-core-preload-v1b.ts:13,52-83`; `joao-prompt-core-v1.mjs:6-11`).
3. **O contexto final tem ~23,7 mil chars (~5,9 mil tokens) por turno**, dos quais 5.786 são 21 "regras aprendidas" carregadas do banco (`agente_aprendizados`), com preços hardcoded e referência a uma tool que não existe (`calcular_orcamento`). PROVADO (`auditoria.prompt_manifesto_joao`, 267 turnos de v4.39.0).
4. **Existem 3 entradas físicas para o João e 2 delas pulam o guardrail de inbound.** Fora do horário: `zapi-ingest` → `inbound_fora_horario` (trigger `trg_00_joao_guardrail_inbound_pre`) → `agente-noturno`. Dentro do horário: `zapi-ingest` → `julia-session-manager` → `inbound_fora_horario` com `status='bridge_joao'` (o trigger só age em `status='pendente'`; a linha é criada como `bridge_joao` e depois atualizada) → `agente-noturno`. Sweep de 2 em 2 min: `fn_joao_sweep_sync_v2` → `agente-noturno {_sweep:true}`. PROVADO.
5. **Há mais de um agente respondendo clientes.** `agente-conversacao` ("Bruno Fonseca", claude-sonnet-4-6) ainda responde leads cujo dono é Bruno (`fn_dono_conversa`: 72h após follow-up ou disparo do executor com assinatura Bruno) — 44 outbounds em 30 dias; `whatsapp-executor` enviou 204 mensagens assinadas "Bruno Fonseca" em 30 dias. `agente-fechamento` ("Marcos") está bloqueado pela view de migração. `agente-exploracao` (Julia) é tombstone HTTP 410. PROVADO.
6. **O candidato "clean" (`joao-clean-candidate/v1`) não envia mensagem quando roteado pelo ingress**: exige `_send:true` no body e o `zapi-ingest` não manda isso. Roteamento: `fn_joao_phase3c_dogfood_route_v1` (allowlist por telefone com TTL; 0 overrides ativos, o último expirou 26/09 00:53) e `fn_joao_phase3d_runtime_route_v1` (flag `internal.joao_feature_flags.v2_items_authority`: enabled, mode=percentage, **rollout_percent=0**, motivo "Candidate cleanup in progress", revisão 18 de hoje 10:38). PROVADO.
7. **O núcleo tem 12 tools declaradas; em runtime, preloads removem, interceptam ou reescrevem tools por regex**, com três detectores diferentes de "modo de serviço" e três remoções concorrentes de tools. PROVADO (lote 2 de preloads).
8. **Eventos de sistema entram como se fossem fala do cliente**: o bridge de arte (`[ARTE_PROCESSADA_CORTEX] ...`, 227 eventos em 10 dias) e o bridge Pix são enfileirados via `fn_julia_sessao_add_msg` e consolidados pelo `julia-session-manager` na string `mensagem` enviada ao João (só o tipo `fallback_julia` é filtrado). PROVADO (`julia-session-manager/index.ts` `consolidarMensagens`, `fn_cortex_artwork_joao_bridge_after_terminal_v1`).
9. **Estado transacional é injetado como memória**: o bloco `[JÁ EXECUTADO]` (core:579-643) coloca no prompt cobranças Pix pendentes/pagas (72h), orçamentos com frete e os `operation_id` de autorizações financeiras ativas, com instrução de copiá-los. PROVADO.
10. **Existe um caminho morto executado diariamente**: cron `reativar-leads-fora-horario` (18:00) → `agente-conversacao` modo `reativar_fds` → chama `functions/v1/agente-exploracao`, que responde 410 `AGENT_RETIRED`. 48 decisões `reativar_lead` em 10 dias. PROVADO.

---

## A. Caminho real de execução

### A.1 Onde o João mora

| Item | Valor | Status |
|---|---|---|
| Projeto Supabase do João | `ldrdtaibazplvrbwyrvx` ("skillprint@outlook.com's Project") | PROVADO |
| Projeto do README do repo | `jjigrdmtanyxrzmkelvz` (Skiprintpro, só edges `loyalty-*`; **não** contém o João) | PROVADO |
| ERP | `ynjsflvdfftcopibzxyo` (criativa-futuro-erp), acessado por REST/RPC com `ERP_SERVICE_KEY` | PROVADO |
| Edge LIVE | `agente-noturno` v347, 38 arquivos, `verify_jwt=false` | PROVADO |
| Modelo | `claude-haiku-4-5-20251001`, `max_tokens: 1100`, sem `temperature`, até 6 rodadas de tool | PROVADO core:363, 3335 |
| Edges com nome `agente-noturno*` | 90 | PROVADO |
| Edges com nome `joao*` | 61 | PROVADO |

### A.2 Grafo físico (mensagem → resposta)

```
WhatsApp (Z-API)  ──webhook──▶ zapi-webhook-ingress (auth por token RPC) ──▶ zapi-ingest v153
                                                                                │
   ┌────────────────────────────────────────────────────────────────────────────┤
   │ 1) override dogfood (fn_joao_phase3c_dogfood_route_v1 = true)             │
   │      └─▶ agente-noturno-bug7-phase3c-internal-dogfood-candidate            │
   │           (fail-closed 502; NÃO envia ao cliente sem _send:true)           │
   │ 2) fromMe → bloqueia estado Julia; comandos de admin (#julia ...)          │
   │ 3) FORA DO HORÁRIO (Seg-Qui 7-17h, Sex 7-16h, BRT):                        │
   │      insert inbound_fora_horario  ──trigger BEFORE INSERT──▶              │
   │        trg_00_joao_guardrail_inbound_pre                                   │
   │          ├─ fn_joao_commercial_role_decide_v1 (flag joao_commercial_role_inbound_v1=true)
   │          ├─ fn_joao_product_precedence_inbound_v1 (flag joao_product_precedence_inbound_v1=true)
   │          ├─ fn_joao_qualification_linear_quantity (flag joao_qualification_enforce_v1=true)
   │          └─ fn_joao_guardrail_inbound_classificar (flag joao_guardrail_inbound_v1=true)
   │               └─ se intercepta: chama agente-noturno {_direct_message} e marca atendido_joao
   │      depois: resolveJoaoRuntimeSlug (fn_joao_phase3d_runtime_route_v1; rollout 0% → LIVE)
   │        └─▶ agente-noturno {phone, chat_name, mensagem, inbound_id, tem_imagem}
   │ 4) DENTRO DO HORÁRIO, lead existente:                                      │
   │      donoConversa (flag roteamento_dono=ativo → fn_dono_conversa)          │
   │        ├─ 'bruno'  ─▶ agente-conversacao (Bruno, sonnet-4-6, responde e envia via BotConversa)
   │        ├─ 'marcos' ─▶ agente-fechamento (bloqueado: vw_agent_migration_current_state_v1 = ACTIVE_NO_EFFECT)
   │        └─ 'julia'/'legacy' ─▶ checkJulia → fn_julia_pode_atender → julia-session-manager {mode:'enqueue'}
   │ 5) DENTRO DO HORÁRIO, lead novo (anúncio ou orgânico): ativarJulia ─▶ julia-session-manager {enqueue}
   └────────────────────────────────────────────────────────────────────────────┘
                                                                                │
julia-session-manager (cron 1/min, mode process, QUIET 8s)                     │
   ├─ fn_julia_sessoes_prontas → fn_julia_sessao_acquire                        │
   ├─ consolidarMensagens (texto do cliente + eventos cortex_artwork_event/cortex_internal_pix)
   ├─ julia_para_joao='ativo' → fn_julia_sessao_commit + criarLoteJoao:         │
   │     insert inbound_fora_horario status='bridge_joao' (trigger NÃO age) → update status='pendente'
   └─ chamarJoao ─▶ agente-noturno {mensagem, inbound_id, tem_imagem, _cortex_route:'julia_absorvida'}
        (sem confirmação de envio → rearma lote como pendente → sweep)          │
                                                                                │
cron joao-sweep-2min ─▶ fn_joao_sweep_sync_v2 ─▶ fn_joao_recovery_before_redecision_v1 (reconcilia)
                                             ─▶ agente-noturno {_sweep:true} (até 6 clientes/rodada, lotes por phone)
                                             ─▶ joao-erp-sale-sync, joao-erp-sale-sync-multi
trigger pixel_events Purchase 'purchase_julia_%' ─▶ agente-noturno {_direct_message: "Comprovante recebido..."}
```

### A.3 Dentro da `agente-noturno` (core:5346 → resposta)

1. `Deno.serve` (core:5346). Ramos: `_sweep` (5351-5389), `_direct_message` (5398-5460, envio ditado com governança), turno normal.
2. Turno normal: debounce 8 s (core:379), dedupe causal por `inbound_fora_horario` (`inbound_ja_terminal`, `debounce_msg_mais_nova`), agregação de rajada (10 inbounds/5 min), transcrição de áudio (OpenAI Whisper, core:2179), até 3 imagens.
3. `atenderCliente` → `atenderClienteInterno` (core:2865/2888): lock (`fn_joao_adquirir_lock`), `fn_agente_pausado`, `fn_get_or_create_lead`, `lerEstado` (`agente_noturno_estado`), `lerExecucoes`, `blocoArquivosDoLead`, gate comercial (`fn_contexto_comercial_do_lead`), histórico (`fact_conversations`), aprendizados (`fn_contexto_aprendizados`), logística (`resolverModalidadeLogistica` + cadastro ERP `pessoas`), CalcMe (`vw_orcamento_calcme_vigente` / edge `joao-orcamento-calcme`).
4. `systemFinal = SYSTEM + REGRAS_EXTRA + blocos` (core:3226-3236) → `registrarManifestoJoao` (auditoria) → `chamarCerebro` (core:3332): `fetch('https://api.anthropic.com/v1/messages', {system, messages: hist+user, tools: TOOLS})`.
5. **Aqui a cadeia de `globalThis.fetch` monkey-patch age**: o `fetch` que o núcleo chama já é a composição de ~60 wrappers (ver C.1). Eles reescrevem `system`, removem tools, curto-circuitam com JSON sintético, ou reescrevem a resposta do modelo.
6. Loop de tools (core:3345-3480): redirecionamento `calcular_dtf_metro→calcular_dtf_por_arte`, guarda de frete por modalidade, guarda de CEP não confirmado, `executarTool` (core:1722), autorizações financeiras (`financial_authorizations`) acumuladas em `ctx`.
7. Pós-modelo (core:3560-5345): guards determinísticos, até N re-chamadas ao modelo com `[SISTEMA: ...]` (11 pontos, core:4151-4409), persistência de slots (`salvarEstado`, core:1152), decisão (`fn_registrar_decisao_agente`), envio governado (`enviarComoJoaoGovernado` → `fn_conversation_effect_claim_v1`/`finish` → Z-API `send-text`; TTS via `joao-tts`), ledger `joao_envios`, `gravarFio` (`fact_conversations`), carimbo de `inbound_fora_horario`.
8. Resposta HTTP ao chamador: `{ok, respondeu, skip:...}`; o `zapi-ingest` descarta a resposta (`callFunction` é `void`).

Detalhe do pós-modelo: ver seção C.4 (mapa do subagente).

### A.4 Quem chama `agente-noturno` (funções SQL, triggers, edges) — PROVADO por `pg_get_functiondef`

| Chamador | Como | Estado |
|---|---|---|
| `zapi-ingest` (edge) | fora do horário e via `resolveJoaoRuntimeSlug` | LIVE |
| `julia-session-manager` (edge, cron 1/min) | `chamarJoao` com `_cortex_route:'julia_absorvida'` | LIVE (é a via diurna) |
| `fn_joao_sweep_sync_v1/v2` (cron `joao-sweep-2min`) | `{_sweep:true}` + recovery direto de órfãos (`inbound_id`) | LIVE |
| `fn_joao_guardrail_inbound_pre` (trigger BEFORE INSERT em `inbound_fora_horario`) | `{_direct_message}` quando regra intercepta | LIVE (flag `joao_guardrail_inbound_v1=true`) |
| `fn_cortex_purchase_julia_confirm_joao_v1` (trigger AFTER INSERT em `pixel_events`) | `{_direct_message}` para Purchase `purchase_julia_%` | LIVE (flag `julia_para_joao='ativo'`) |
| `fn_varredor_noturno` (2 overloads) | `net.http_post` para `agente-noturno` | **ÓRFÃ**: nenhum cron e nenhuma função chama (NÃO ENCONTRADO chamador) |
| `fn_joao_freight_v295_live_dry_run_invoke_v1`, `fn_joao_pricing_v295_canary_invoke_v1`, `fn_joao_freight_v294_canary_invoke_v1`, `fn_joao_phase1_shadow_invoke_v1`, `fn_replay_*_dispatch` | invocações de canários/replays | ÓRFÃS (sem chamador; executáveis manualmente) |
| `fn_joao_http_post_vault_v1/v2`, `fn_joao_net_http_post_vault_v1` | helpers com allowlist de URL e segredo do vault | utilitários |

---

## B. João(s) existentes

### B.1 Classificação

| Classe | Edge(s) | Evidência |
|---|---|---|
| **LIVE** | `agente-noturno` v347 (núcleo `v4.39.0-apparel-pricing-guard` + 20 preloads locais + 47 imports pinados) | 1.007 linhas de log em 24h; 239 `resposta_noturna_enviada` com `agent_version=v4.39.0` em 25-26/09; único com rota do ingress |
| **CANDIDATE com roteamento real (0% hoje)** | `agente-noturno-bug7-phase3c-internal-dogfood-candidate` v26 (`joao-clean-candidate/v1`, atualizado hoje 11:02) | `zapi-ingest` roteia por `fn_joao_phase3c_dogfood_route_v1` (allowlist TTL, 0 ativos) e `fn_joao_phase3d_runtime_route_v1` (rollout_percent=0). 57 linhas de log em 24h (dogfood/testes). **Não envia sem `_send:true`.** |
| **CANDIDATE fonte do LIVE** | `agente-noturno-p0a-price-intent-candidate` v8, `agente-noturno-p0c-apparel-pricing-guard-candidate` v2 (25/09 09:20 e 09:48; LIVE atualizado 09:49) | INFERIDO: o núcleo LIVE é `v4.39.0-apparel-pricing-guard` e `p0aPriceGateRuntime`/`p0cApparelGuardRuntime` estão no core (core:3259-3261, 3647-3844, 5111-5172); 4 turnos com `v4.38.0-price-intent-gate` em 25/09 antes do corte |
| **SHADOW / observadores (sem efeito externo)** | `agente-noturno-fase1-shadow`, `agente-noturno-*-shadow-*`, `agente-noturno-bug7-v344-shadow-*`, `agente-noturno-p0-1177-shadow`; funções `fn_joao_skill_live_shadow_observe_v1..v34` (34 versões) disparadas por trigger em `agente_decisoes_log` (`trg_joao_artwork_shadow_after_insert_v1`) | tabela `joao_skill_live_shadow_observations`: 1.755 obs `qualification` (v15 e v33), 638 `knowledge_retrieval`, 604 `pricing_strategy`/`deal_desk`, 249 `artwork_intake`... em 7 dias |
| **CANARY / REPLAY (só execução manual)** | `agente-noturno-replay*`, `agente-noturno-*-canary*`, `agente-noturno-bug7-phase2b-*` (20+), `agente-noturno-guardrail-teste`, `agente-noturno-lab`, `agente-noturno-v433-canary` | nenhuma função/cron/trigger os chama (NÃO ENCONTRADO chamador; só as `fn_*_invoke_v1` órfãs) |
| **FALLBACK morto** | `agente-exploracao` v275 (Julia) | Tombstone HTTP 410 `AGENT_RETIRED`; ainda referenciado por `julia-session-manager` (rota `mode!=='ativo'` e `bypass_legacy_rollback`) e por `agente-conversacao` (`reativar_fds`) |
| **Concorrentes LIVE (outros nomes)** | `agente-conversacao` v103 ("Bruno Fonseca", sonnet-4-6, envia via BotConversa) | `fn_dono_conversa` devolve `bruno` por 72h após follow-up/trocas ou disparo do executor assinado Bruno; 17 estados ativos; 44 outbounds `source='bruno'` em 30d; 3 `mensagem_enviada` em 10d |
| **Concorrente bloqueado** | `agente-fechamento` v88 ("Marcos Vieira") | handler consulta `vw_agent_migration_current_state_v1` → `ACTIVE_NO_EFFECT` → responde `blocked` sem efeito; 12 outbounds `source='marcos'` em 30d (INFERIDO: anteriores ao bloqueio ou via executor) |
| **Emissores diretos ao cliente fora do João** | `whatsapp-executor` (fila `waba_disparos_lista`, 204 msgs "Bruno Fonseca" em 30d), `joao-preflight-ready-v1` (manda cotação ERP por `botconversa-sender`; 1 evento em 10d), `order-ready-zapi-dispatcher-v1`, `joao-zapi-recovery-send` | PROVADO por código e logs |
| **DEAD CODE (repo)** | `patches/agente-noturno-index-*/v288..v296*.ts`, `patches/joao-p0-1177-live-v335/*`, `patches/joao-p0-496-multiart-20260923/*`, `patches/joao-replay-hermetico-v288/*` | nenhum deles é o bundle deployado (hash não bate); são fotografias de composições anteriores |

### B.2 Respostas às perguntas da missão

- **Existe mais de um João capaz de responder?** Sim: LIVE + candidato dogfood (por override) + Bruno (`agente-conversacao`) para leads com dono Bruno. PROVADO.
- **Existe candidate recebendo tráfego?** Hoje não (0% e 0 overrides). Recebeu por override de 1 telefone até 26/09 00:53. PROVADO.
- **Existe fallback para versão antiga?** No `zapi-ingest`: se `resolveJoaoRuntimeSlug` falhar, chama LIVE (`callFunction(JOAO_LIVE_SLUG)`); no `julia-session-manager`: se `julia_para_joao != 'ativo'` chama `agente-exploracao` (410). O "fallback antigo" é um tombstone. PROVADO.
- **Circuit breaker troca de agente?** `internal.joao_feature_flags.circuit_breaker_open=false`; quando `true`, `fn_joao_phase3d_runtime_route_v1` devolve `false` → LIVE. Só afeta candidato→LIVE. PROVADO.
- **Alguma lógica pode chamar runtime antigo?** Sim: `agente-conversacao` modo `reativar_fds` (cron diário) chama `agente-exploracao` (410); `fn_varredor_noturno` é executável e chama `agente-noturno` sem debounce. PROVADO.
- **Flags de rollout/sampling?** `internal.joao_feature_flags` (`v2_items_authority`: mode `percentage`, `rollout_percent` 0, `new_sessions_only` true, `rollout_salt`, `circuit_breaker_open`), `internal.joao_feature_flag_overrides` (ENABLE/BLOCK por phone com TTL). Nenhuma outra amostragem no ingress. PROVADO.
- **Duplicidade de processamento?** Fora do horário o mesmo inbound é (a) chamado direto pelo `zapi-ingest` e (b) elegível ao sweep 30 s depois se ainda `pendente`; a proteção é o lock por phone (`agente_noturno_lock`) e o carimbo `inbound_ja_terminal`. Diurno: `julia-session-manager` chama o João e, sem confirmação de envio em ~1 s, rearma o lote como `pendente` para o sweep (`rota_joao_retry_sem_julia`). INFERIDO risco de dupla resposta quando o primeiro turno demora mais que a janela de verificação; PROVADO o mecanismo.

---

## C. Composição real do contexto

### C.1 Cadeia física de wrappers (ordem de import = ordem de execução)

`index.ts` da edge LIVE (PROVADO):

```
1  joao-dtf-multi-art-dimension-guard-v1          (local)
2  joao-canonical-live-e2e-preload-v1 (+core)     (local)  ← define __joaoCanonicalActiveTurnV1
3  joao-prompt-core-preload-v1b (+v1.mjs)          (local)  ← SUBSTITUI SYSTEM+REGRAS_EXTRA
4  joao-human-promise-task-guard-v1 (+core)        (local)
5  joao-dtf-textile-closed-meter-preload-v1        (local)
6  joao-canonical-dtf-uv-boundary-preload-v1       (local)
7  joao-dtf-erp-price-authority-v1                 (local)
8  joao-v299-freight-autoquote-stack-v1            (local)  ← importa:
      pricing-current-turn-preflight-v1 (raw)  · pricing-explicit-sheet-response-gate-v5 (raw)
      freight-current-turn-context-preload-v1.1 · freight-agent-runtime-preload-v1.3-pure-cep · freight-agent-response-gate-v1.5-pure-cep (locais)
      bug3/v294-v338 → v292.1-v338 → v291-v338:
         21 preloads raw ANTES do núcleo (dry-run-effect-zero, color-split-request-controller, erp-orcamento, proposal-receipt,
           auth, payment/order/fiscal-status, gate7c, output-guard-v3, lock-v3, reengagement, b2, promise-guard,
           sales-continuity, freshness, external-link-intake-v3, skill-advisor, skill-router, capability-guard-v1.1, layout-disambiguation)
         ./candidate-index-v338.ts  ← NÚCLEO (5.525 linhas, v4.39.0)
         16 preloads raw DEPOIS do núcleo (qualification-gate-v1.6, closing-gate-v1.3, artwork-current-turn-v1.1,
           artwork-context-v2-preflight, repeat-order-history, orchestrator-v1.5(+v1.4), direct-file-intake, freight-comparison,
           order-grade-confirmation, product-service-disambiguation v3/v4/v5, freight-choice-context, uv-operation-idempotency,
           color-split-ambiguity, color-split-resolution-fallback)
         freight-positive-output-v1.1 · uv-explicit-sheet-v1 · freight-checkout-v2 · freight-checkout-output-clarify-v1 (raw)
      pricing-financial-current-turn-postload-v1 · halftone-art-final-router-v1 · halftone-phone-resolver-v1 (raw)
9  joao-image-measure-provenance-guard-v1          (local)
10 joao-dtf-material-capability-skill-v1           (local)
11 joao-price-change-pix-gate-v1                   (local)
12 joao-dtf-textile-transfer-only-skill-v1         (local)
13 joao-apparel-catalog-skill-v1                   (local)
14 joao-artwork-gold-skill-v1                      (local)
15 joao-dtf-material-technique-gate-v1             (local)
16 joao-bag-material-clarification-gate-v1         (local)
17 joao-sheet-choice-continuity-gate-v1            (local)
18 product-service-disambiguation-preload-v3-user-evidence (+context-core) (local)
19 joao-dtf-objection-continuity-skill-v1 (+core)  (local)
20 joao-service-mode-precedence-preload-v1 (+core) (local)
21 joao-financial-input-provenance-guard-v1        (local)
22 joao-file-state-orchestrator-v1                 (local)  ← wrapper MAIS EXTERNO (também intercepta POST ao Z-API/BotConversa/joao-tts)
```

Mecânica (PROVADO): cada preload faz `const base = globalThis.fetch.bind(globalThis); globalThis.fetch = async (input, init) => {...}`. O último importado é o mais externo: vê a requisição primeiro e a resposta por último. O núcleo chama `fetch(...)` em runtime (core:3335), logo todos valem. Alguns também envolvem `Deno.serve` (dry-run-effect-zero, auth, output-guard, freight-agent-response-gate — detalhe nos lotes). Um curto-circuito de um wrapper externo (ex.: bag-material) impede que os internos vejam a chamada; injeções de `system` de wrappers externos são vistas pelos internos. Resposta sintética HTTP 409 (service-mode) vira `anthropic_indisponivel` no núcleo (core:3339-3342) → `decisao` default `responde:false` → **cliente sem resposta**.

### C.2 O que chega ao modelo, na ordem (turno típico)

Medido em `auditoria.prompt_manifesto_joao` (v4.39.0, 267 turnos): `chars_system_final` médio 23.738 (máx. 25.506), histórico médio 2.116 chars / 15 turnos. **Observação**: o manifesto é gravado ANTES dos wrappers agirem (core:3238-3246), portanto mede o `systemFinal` do núcleo, não o que o modelo recebe.

| # | Bloco | Origem | Condição | Tamanho | Nota |
|---|---|---|---|---|---|
| 1 | `SYSTEM` ("Você é João Barros, VENDEDOR...") | core:2187-2252 | sempre | 8.341 | **substituído** pelo prompt-core em runtime |
| 2 | `REGRAS_EXTRA` ("REGRAS ADICIONAIS: ...") | core:2254-2271 | sempre | 7.922 | **substituído** junto |
| 1' | `PROMPT_CORE_V1` (identidade, MISSÃO, AUTORIDADE E VERDADE, CONVERSA, FATOS ESTÁVEIS, SAÍDA JSON) | `joao-prompt-core-v1.mjs:13-34` | sempre que o system começar com o prefixo legado e tiver > 16.263 chars; senão fail-closed (mantém legado) | ~3.300 | substitui 1+2 |
| 3 | Aprendizados `===ERROS - NUNCA REPETIR=== / ===O QUE FUNCIONA - REPITA===` | `fn_contexto_aprendizados('agente-noturno')` ← `agente_aprendizados` (21 regras ativas: 20 críticas, 1 alta, todas `classe_risco='LEGADO'`, criadas 08/07 a 11/08) | sempre (validado por sha256/contagem; se inválido, omitido) | 5.786 | contém preços fixos (A4 R$29,90; A3 R$39,00; DTF R$59,90/m; copos R$29,90; packs R$6,90-29,90; kit R$79,90), tabela de medidas de camisetas, "UV nao usa calcular_orcamento" (tool inexistente), "Kezia cria as artes", "Tamires passa o valor" |
| 4 | `[AGORA: dia, data, hora (PERÍODO).]` | core:473 `blocoRelogio` | sempre | ~60 | |
| 5 | `[ESTADO COMERCIAL CANONICO: ...]` (3 variantes) | core:2508-2517 ← `fn_contexto_comercial_do_lead` | flag `joao_contexto_canonico_ativo=true`; fail-closed vira texto de "INDISPONIVEL" | 200-600 | |
| 6 | `[FICHA: etapa=...; slots={...}. NÃO pergunte o preenchido.]` | core:3219 ← `agente_noturno_estado` | se há estado | dinâmico | slots do modelo (JSON) |
| 7 | `[JÁ EXECUTADO: ...]` ou resíduo `[MOVIMENTACAO FINANCEIRA RECENTE EXISTE...]` | core:579-643 `lerExecucoes` ← `mp_pix_cobrancas` (72h), `orcamentos` (72h), `operacoes_financeiras` ativas | se há cobrança/orçamento/autorização | 200-900 | injeta `operation_id` literais |
| 8 | `[ALTERACAO DE PEDIDO: ...]` | core:3224 | regex de mudança | ~350 | |
| 9 | `[LOCALIZAÇÃO: DDD ...]` | core:644 | sempre que DDD conhecido | ~250 | |
| 10 | `blocoModalidadeLogistica` + `blocoCepCanonico` | core:847, 1054 | sempre (estado logístico resolvido em 4 níveis) | dinâmico | |
| 11 | `[ORIGEM: anúncio "..."]` / `[ANÚNCIO DE ORIGEM: ...]` | core:2940-2947 ← `pixel_events`/`leads_marketing` | lead de anúncio | ~200 | |
| 12 | `[O CLIENTE MUDOU DE ASSUNTO: ...]` | core:3145 | produto na msg ≠ produto de origem | ~200 | |
| 13 | `[O CLIENTE JÁ PEDIU PREÇO E NÃO RECEBEU NÚMERO...]` | core:3223 | regex preço e João ainda não deu R$ | ~130 | |
| 14 | `[O CLIENTE ACHOU CARO...]` | core:3170 | regex objeção | ~300 | |
| 15 | `[VOCÊ ACABOU DE PERGUNTAR: "..." O CLIENTE RESPONDEU: "..."]` | core:3156-3168 | msg ≤3 palavras e última msg do João tem `?` | ~300 | |
| 16 | `[ARQUIVOS REAIS DESTE LEAD ... N arquivo(s)]` | core:1195 ← `arte_uploads` 7 dias | se há uploads | até ~2.500 | |
| 17 | `[Cliente EM CONVERSA hoje...]` / `[PRIMEIRO CONTATO...]`, `[Promessa de retorno JÁ DITA]`, `[FORMULÁRIO DO SITE]`, `[PERGUNTA DIRETA]` | core:3232-3236 | condicionais | ~60-100 cada | |
| 18+ | Blocos injetados por preloads (ver lotes): `[SKILL DTF MATERIAL — FONTE ERP]`, `[SKILL DTF TEXTIL TRANSFER ONLY]`, `[SKILL APPAREL CATALOG]`, `[SKILL ARTWORK GOLD v1]`, `[CORTEX MATERIAL TECHNIQUE GATE v1]`, `[CORTEX SHORT CHOICE CONTINUITY v1]`, `[CANONICAL SERVICE MODE — P0]`, `[DTF_FILE_PREFLIGHT_CANONICO]`, blocos de frete (FreightAgent), qualification/closing gates, orchestrator, artwork-context, repeat-order, etc. | preloads | por regex/estado/ERP | 100-600 cada | detalhados em C.3 |
| H | `messages`: histórico `fact_conversations` 120 → dedupe eco `zapi` → 60 → merge por role → últimos 34 (~15 turnos) + mensagem atual (texto e até 3 imagens base64) | core:3180-3210, 3248-3258 | sempre | ~2.100 | histórico só de TEXTO (sem tool_results anteriores) |
| T | `tools: TOOLS` (12 declaradas, descrições longas com regras comerciais) | core:1247-1259 | sempre, menos as removidas por preloads | ~5.500 | ver D |
| N | Nudges `[SISTEMA: ...]` como nova mensagem `user` em re-chamadas | core:4151-4409 | por guard | 100-500 | até 11 pontos de re-chamada |

### C.3 Detalhe por preload (o que cada wrapper injeta, remove ou reescreve)

> Seções C.3.1–C.3.4 são os relatórios dos quatro lotes de análise (cada arquivo lido integralmente). Ver abaixo.

Relatórios completos (um por lote, com linha de evidência por afirmação):

- [`lotes/lote-1-preloads-locais-pre-nucleo.md`](lotes/lote-1-preloads-locais-pre-nucleo.md) — 11 arquivos locais antes do núcleo (prompt-core, canonical-live-e2e, uv-boundary, erp-price-authority, FreightAgent...).
- [`lotes/lote-2-preloads-locais-pos-nucleo.md`](lotes/lote-2-preloads-locais-pos-nucleo.md) — 14 arquivos locais depois do núcleo (as "skills", gates de material/modo de serviço/preço/arquivo).
- [`lotes/lote-3-preloads-pinados-pre-nucleo.md`](lotes/lote-3-preloads-pinados-pre-nucleo.md) — 21 imports pinados antes do núcleo (auth, dry-run, ERP orçamento/proposta, gate7c, output-guard, lock, freshness, skill-advisor/router, capability, layout...).
- [`lotes/lote-4-preloads-pinados-pos-nucleo.md`](lotes/lote-4-preloads-pinados-pos-nucleo.md) — 25 imports pinados depois do núcleo (qualification/closing gates, orchestrator, artwork, disambiguation v3/v4/v5, freight choice/checkout, pricing agent, halftone...).

Síntese transversal (PROVADO nos lotes):

| Métrica | Valor |
|---|---|
| Wrappers de `globalThis.fetch` na cadeia da Anthropic | ~45 (contando os 4 lotes) |
| Wrappers de `Deno.serve` (request/response) | 13 (e2e, uv-boundary, freight-ctx, freight-gate, pricing-preflight, pricing-gate-v5, dry-run, color-split, auth, payment, order, fiscal, sales-continuity, freshness) |
| Preloads que **substituem a resposta do modelo** por JSON sintético (curto-circuito) | 17 (multi-art, bag-material, artwork-gold, disambiguation-v3-user-evidence, dtf-objection, skill-router*, capability-guard, layout, qualification-gate, psd v3/v4/v5, freight-choice-context, freight-checkout-v2, halftone-router, color-split-request/ambiguity, image-measure/financial-input em tool_use) |
| Preloads que **removem tools** do array | 4 (dtf-textile-closed-meter; dtf-textile-transfer-only; dtf-material-technique-gate; service-mode-precedence) |
| Preloads que **reescrevem o texto final no transporte** (Z-API/BotConversa/TTS) | 10 (canonical-live-e2e, uv-boundary, human-promise, freight-agent-runtime, file-state, output-guard-v3, promise-guard, sales-continuity, freshness, freight-positive-output) |
| Interceptadores empilhados em `fn_emitir_operacao_financeira` | 5 (erp-orcamento, proposal-receipt, uv-operation-idempotency, uv-explicit-sheet, pricing-financial-postload) |
| Máquinas de estado concorrentes para logística | 3 (núcleo `resolverModalidadeLogistica`; `fn_joao_session_state_*` via e2e/uv-boundary/file-state; `fn_joao_shipping_state_*` via FreightAgent) + `agente_noturno_estado.slots` |
| Detectores diferentes de "modo de serviço" (transfer-only × peça pronta) | 6 (product-service-shadow via e2e; uv-boundary; transfer-only-skill; disambiguation-v3-user-evidence; dtf-objection; service-mode-precedence; psd v3/v4/v5) |
| Preloads sem kill-switch (sempre ativos) | 30+ (todos os do lote 1 exceto nenhum; lote 2 todos exceto disambiguation-v3; lote 3: erp-orcamento, proposal-receipt, auth, payment/order/fiscal, gate7c, output-guard, lock, b2, promise-guard, sales-continuity, freshness; lote 4: freight-comparison, color-split-fallback, freight-positive-output, checkout-clarify, 3 pricing-*, halftone-phone-resolver) |
| Preloads que **escrevem** estado de negócio (não só log) | e2e (session_state, payment_method, artwork_state), uv-boundary (PRODUCT_CONFIRMED), human-promise (`create_human_task_safe`), freight-runtime (shipping_state), file-state (artwork_state, upload token), color-split-request (PATCH slots), erp-orcamento/proposal (receipts + ERP), uv-explicit-sheet (ERP orçamento), freight-choice/checkout (autorizações, Pix), halftone (task), sales-continuity (logística), lock-v3, gate7c (fila executor), fiscal (solicitação NF-e no ERP) |
| Código morto PROVADO dentro do deploy | `reengagement-preload` (no-op); `artwork-gold` ramo "físico" nunca injetado; `financial-input-provenance` `jfpgSanitizeSystem` nunca chamada; `psd-v4` inalcançável com v5; `freight-agent-response-gate` e `pricing-explicit-sheet-response-gate-v5` só alteram o JSON HTTP (mensagem já enviada); `closed-meter` remove `calcular_dtf` (tool inexistente); INVARIANTE 1 do núcleo inalcançável |
| Bugs PROVADOS por leitura | `multi-art-dimension-guard` responde "6 cm"/"Ele vive" hardcoded para qualquer largura; `dtf-objection` diz "1 metro" hardcoded ignorando a quantidade; `freshness-preload` devolve sucesso sintético e o núcleo carimba como atendido; `lock-v3` nunca deixa o DELETE do lock chegar ao banco; `gate7c` transforma lock fail-open em fail-closed; `service-mode` 409 vira `anthropic_indisponivel` → cliente sem resposta |

### C.4 Pós-modelo: guards, retries e envio (mapa ordenado)

Mapa completo (pré-modelo A1–A39, blocos B1–B22, pós-modelo C0–C42, decisões determinísticas D, contradições internas E) em [`lotes/nucleo-fluxo-atenderCliente.md`](lotes/nucleo-fluxo-atenderCliente.md). Resumo:

- **Antes do modelo** o núcleo pode decidir sozinho e nunca chamar a Anthropic: cliente comprador (silêncio), humano ativo (silêncio), cortesia (texto fixo), reação ❤️, aceite de PDF CalcMe (emite autorização e gera Pix sem modelo), pedido de humano/desistência (task + texto fixo), só arquivos (texto fixo).
- **Depois do modelo** há 42 etapas; 14 delas podem re-chamar o modelo com um nudge `[SISTEMA: ...]` (pior caso 1 + 14 chamadas, cada uma com até 6 rodadas de tools). Retries são aceitos só por `validarMsg`/`validarPix`, **sem** repassar pela guarda de preço (`fn_valor_e_legitimo`).
- **Fallback determinístico** (`fechamentoForcado`, core:4836-4894) envia tabelas hardcoded (têxtil R$59,90…35,90; copo R$35,90/29,90; pack "a partir de R$6,90") sem nenhuma guarda de preço.
- **Persistência acontece antes da barreira de frescor**: `salvarEstado` (core:5105) roda mesmo quando o turno é descartado por `superseded_por_inbound_mais_novo` (core:5287).
- **Envio**: `fn_conversation_effect_claim_v1` → Z-API `send-text` (fallback BotConversa) → `fn_conversation_effect_finish_v1`; ledger `joao_envios`; segundo envio para o código Pix; `gravarFio` em `fact_conversations`; `carimbarInbound('atendido_joao')`.
- **Mesmo depois disso** os wrappers de transporte (e2e, uv-boundary, freight-runtime, file-state, output-guard, promise-guard, sales-continuity, freight-positive-output, human-promise, freshness) podem reescrever, bloquear (409/422/503) ou fingir sucesso — **o texto enviado pode diferir da decisão registrada no ledger**.

---

## D. Tools

### D.1 Declaradas ao modelo (core:1247-1259) × implementadas (`executarTool`, core:1722-2160)

| Tool | Schema (resumo) | Implementação | Sistema consultado | L/E | Efeito externo | Governança |
|---|---|---|---|---|---|---|
| `consultar_catalogo` | `{termo}` | core:1724 | `catalogo_produtos` (status ativo; `instrucao_agente`, `frases_interesse`) | L | não | — |
| `calcular_copo` | `{quantidade, liso}` | core:1732 | preço fixo em código (R$35,90 / R$29,90) + `fn_emitir_operacao_financeira` | E | cria autorização financeira | ledger `operacoes_financeiras` |
| `consultar_tabela_dtf` | `{produto: dtf_textil\|dtf_uv}` | core:1747 | `dtf_precos_faixa`, `dtf_uv_degraus`, `dtf_produto_config` | L | não | `precos_verbalizaveis`; resposta determinística se cliente pediu preço (core:3447) |
| `calcular_dtf_por_arte` | `{largura_cm, altura_cm, copias}` | core:1815 | `dtf_produto_config` + `dtf_precos_faixa` (cálculo local) + autorização | E | autorização | — |
| `calcular_dtf_metro` | `{metros}` | core:1849 | idem | E | autorização | redirecionada para `por_arte` quando há arte+cópias (core:3369) |
| `calcular_dtf_uv_metro` | `{metros}` | core:1876 | RPC `fn_precificar_dtf_uv_v2` | E | autorização | — |
| `calcular_rendimento_uv` | `{largura_cm, altura_cm, quantidade_desejada}` | core:1887 | RPC `fn_dtf_uv_capacidade_folha`, `fn_precificar_dtf_uv_v2` | E | autorização | `rendimentos_autorizados` |
| `consultar_modelos` | `{termo}` | core:1939 | **ERP** RPC `fn_listar_modelos_disponiveis` | L | não | — |
| `orcar_camisetas` | `{itens[], estampas[]}` | core:1950 | **ERP** RPC `fn_orcar_camisetas_agente` + autorização | E | autorização | — |
| `calcular_frete` | `{cep_destino, servico_escolhido}` | core:1986 | edge `calcular-frete` (Frenet) + autorização só com serviço escolhido | E | cotação externa + autorização | guardas de modalidade/CEP (core:3391-3440) |
| `compor_total` | `{operation_ids[]}` | core:2041 | RPC `fn_compor_total` | E | nova autorização "total" | — |
| `gerar_pix` | `{operation_id, produto, quantidade}` | core:2048 | RPC `fn_consumir_operacao_financeira` → edge `mp-pix-criar` (Mercado Pago) → `fn_finalizar_operacao_financeira`; `orcamentos` | E | **cobrança real** | idempotência `ja_existe`; guard de UUID no texto |

Todas as 12 declaradas têm branch em `executarTool` (PROVADO). Não há tool declarada sem implementação nem implementada sem declaração no núcleo. **Divergência está fora do núcleo**: preloads removem tools do array antes da chamada (`service-mode-precedence`: remove `consultar_tabela_dtf/calcular_dtf_por_arte/calcular_dtf_metro` em FINISHED ou `orcar_camisetas/consultar_modelos` em TRANSFER; `dtf-textile-transfer-only`: remove 5; `dtf-material-technique-gate`: remove 2 UV ou 2 têxtil), reescrevem descrição (`apparel-catalog` altera `orcar_camisetas`), interceptam `tool_use` e devolvem JSON sintético (`image-measure`, `financial-input-provenance`, `price-change-pix-gate`) — enquanto o `SYSTEM`/`REGRAS_EXTRA`/aprendizados continuam mandando o modelo chamar essas tools. Ver G.

Tools que o **prompt/aprendizados citam e não existem**: `calcular_orcamento` (regra aprendida "UV nao usa calcular_orcamento (so TEXTIL)"). NÃO ENCONTRADO em `TOOLS` nem em `executarTool`.

### D.2 Candidato "clean" (para comparação)

8 tools: `consultar_produto`, `calcular_dtf_textil`, `calcular_dtf_uv`, `consultar_modelos`, `orcar_camisetas`, `calcular_frete`, `compor_total`, `gerar_pix`; precificação 100% no ERP (`fn_cortex_pricing_calculation_v2`, exige `canonical===true`), com recibos e propostas ERP. Sem guard de texto, sem ledger, sem log. Detalhe no relatório do subagente (Apêndice X).

---

## E. Memória e estado (o que o João recebe sobre o cliente)

### E.A Memória durável (preferências/fatos persistentes) — o que existe de fato

| Fonte | Conteúdo | Entra no prompt? |
|---|---|---|
| `agente_aprendizados` (via `fn_contexto_aprendizados`) | 21 regras **globais do agente**, não por cliente | Sim, sempre (5.786 chars) |
| `memoria_semantica_lead` (tags, resumos, embeddings) | memória por lead | **NÃO** — nenhuma leitura no núcleo nem nos preloads (NÃO ENCONTRADO) |
| ERP `pessoas` (`lerPessoaCanonicaPorTelefone`) | CEP cadastral | Só quando a modalidade admite frete (core:3121-3125) |
| `leads_marketing` / `pixel_events` | anúncio de origem, categoria | Sim (`[ORIGEM]`) |
| `repeat-order-history` (preload) | pedido anterior via venda ERP / CRM won | condicional (lote raw 2) |

Conclusão: **não existe memória durável por cliente no sentido de preferências**; o que existe é "aprendizado global" injetado a todos.

### E.B Estado da conversa/venda

| Fonte | Campos | Quem escreve |
|---|---|---|
| `agente_noturno_estado` (`phone`, `lead_id`, `etapa`, `slots jsonb`) | `produto, arte, quantidade, envio_retirada, modalidade_logistica, cep, pagamento, grade[], estampas[]` + campos internos (`_produto_fonte`, `orcamento_calcme_id`, `calcme_*`, `largura_cm`, `altura_cm`, `arquivo_estado`, `cep_confirmado_para_envio`, ...) | o **modelo** (JSON de saída) + guards do núcleo + preloads (`service-mode` força `produto`; `financial-input` apaga medidas/CEP; `file-state` grava `arquivo_estado`); o candidato grava `schema_version:'joao-items/v1'` na mesma tabela |
| `canonical_session_state` (via `fn_joao_session_state_current_v1`, `fn_joao_artwork_state_apply_v1`) | `artwork.file_state`, `preflight_version`, `pricing.provenance`, `product.family` | preloads canonical-live-e2e / file-state / joao-preflight-ready-v1 |
| `inbound_fora_horario` | fila de turnos (status `pendente/atendido_joao/humano_ativo/pausado_humano/silencio_joao/reprocessado`) | ingress, trigger, núcleo, sweep, session-manager |
| `agente_noturno_lock` | lock por phone | núcleo |
| `agente_exploracao_estado` / `agente_conversacao_estado` | estados legados de Julia/Bruno que decidem o **roteamento** (`checkJulia`, `fn_dono_conversa`) | `zapi-ingest`, Bruno |
| Histórico | `fact_conversations` (texto; escrito por núcleo `gravarFio`, eco `zapi`, Bruno, executor) | — |

### E.C Fonte transacional

`operacoes_financeiras` (autorizações com `operation_id`, `kind`, `amount`, `expires_at`), `mp_pix_cobrancas` (Pix, `qr_code`, `checkout_url`), `orcamentos`, `vw_orcamento_calcme_vigente` (PDF CalcMe extraído), ERP (`fn_cortex_pricing_calculation_v1/v2`, `fn_orcar_camisetas_agente`, `fn_listar_modelos_disponiveis`, propostas), `calcular-frete` (Frenet), `mp-pix-criar` (Mercado Pago).

### E.D Transacional injetado como memória (PROVADO)

- `[JÁ EXECUTADO]` (core:579-643): valores de Pix pendentes/pagos, frete já calculado, **lista literal de `operation_id`** com instrução "Copie o operation_id EXATAMENTE". A justificativa no código (core:610-620) é que o histórico é só texto e o id "evapora" entre turnos.
- `[FICHA: slots=...]`: slots incluem `orcamento_calcme_id`, `calcme_total_ajustado`, `calcme_itens_ajustados`, `cep_confirmado_para_envio`.
- Blocos de preloads: `[DTF_FILE_PREFLIGHT_CANONICO]` (consumo/preço do preflight), `chargeable_total` da sessão canônica (file-state), `unit_price` ERP (sheet-choice), valores em R$ lidos de `operacoes_financeiras` (price-change-pix-gate).
- Candidato clean: injeta o estado v2 inteiro (`erp.operation_id`, `legacy_snapshot`) no system e proíbe revelar IDs no mesmo prompt.

---

## F. Legado executável (tudo que ainda pode afetar uma conversa)

| Item | Onde | Como afeta | Status |
|---|---|---|---|
| `SYSTEM`/`REGRAS_EXTRA` legados | core:2187-2271 | ainda compilados; o prompt-core só os remove se o prefixo e o tamanho baterem (fail-closed → legado volta inteiro) | LIVE latente |
| 21 regras aprendidas `classe_risco='LEGADO'` | `agente_aprendizados` | injetadas em todo turno; cron `aprendizado-prompt` (semanal analisar + `aprovar` a cada 2h) pode acrescentar regras sem deploy | LIVE |
| `julia-session-manager` (nome Julia) | edge + crons `julia-session-manager-tick` (1/min) | é a via diurna do João; consolida eventos de sistema como fala do cliente | LIVE |
| `agente-conversacao` (Bruno) + `whatsapp-executor` | edge + cron 15 min + `fn_dono_conversa` | responde e dispara para leads; rouba o dono por 72h | LIVE |
| `agente-fechamento` (Marcos) | edge | bloqueado pela view de migração; ainda é chamado pelo ingress | bloqueado |
| `agente-exploracao` (Julia) | edge 410 | alvo de 2 caminhos vivos (`julia-session-manager` rollback, `agente-conversacao reativar_fds`) | tombstone |
| `fn_varredor_noturno` (2 overloads) | SQL | reenvia órfãos ao João sem lock/debounce | órfã executável |
| `fn_joao_*_canary_invoke_v1`, `fn_replay_*_dispatch_v1` | SQL | chamam edges canário/replay (que existem e estão ACTIVE) | órfãs executáveis |
| 90 edges `agente-noturno-*` + 61 `joao-*` ACTIVE | Supabase | todas com `verify_jwt=false` na maioria; executáveis com service key | superfície |
| `ASSINATURA_JULIA` / `_assinar_como:'julia'` | core:365, 5410 | `_direct_message` pode sair assinado "Julia Bitencourt" | LIVE latente |
| `joao_skill_router` (flag false), `joao_external_link_intake_shadow` (false), `joao_presend_shadow_fin_cobranca` (false) | `sistema_config` | preloads ainda importados; desligados por flag | latente |
| `patches/*` no repo | repo | fotografias antigas (v288–v296, p0-1177, p0-496) que **não** são o deploy | dead code |
| Guardrail inbound por trigger | `fn_joao_guardrail_inbound_pre` | age só fora do horário (linhas criadas `pendente`); bridge diurno entra como `bridge_joao` | assimétrico |

---

## G. Contradições (regras que produzem decisões diferentes para o mesmo input)

Cada linha aponta evidência física. Lista completa de contradições internas do núcleo (20 itens) em `lotes/nucleo-fluxo-atenderCliente.md` Parte E; contradições preload×núcleo em cada lote. Abaixo, as de maior prioridade pedidas na missão.

### G.1 Responder preço × exigir diagnóstico

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 1 | REGRAS_EXTRA "QUEM PERGUNTA O VALOR DO METRO... MANDE A TABELA NA HORA... PROIBIDO responder pergunta de preco com pergunta" + `[O CLIENTE JÁ PEDIU PREÇO...]` + retry C9 | p0a `ASK_MISSING_FIELD` substitui a resposta por pergunta sem preço; `bag-material-gate` curto-circuita "quanto custa 100 sacolas?" com pergunta de material; `psd-v5` responde "quero imprimir em camisetas, quanto custa?" com pergunta sobre arquivo; `qualification-gate` força "Quantas peças você precisa?"; `capability-guard` bloqueia quando cliente diz "valor" com imagem ambígua | core:2262, 3223, 4200; core:3701; lote2 §8; lote4 §12, §1, lote3 §20 |
| 2 | SYSTEM "CLIENTE SEM MEDIDA: pergunte a medida do OBJETO... Referência: arte de caneca costuma ser 10 x 21cm" | REGRAS_EXTRA "CLASSIFICACAO INTERNA DA ESTAMPA: NUNCA peca ao cliente medidas"; p0c remove perguntas de medida em camiseta; `financial-input-provenance` bloqueia `calcular_rendimento_uv` se a medida não veio do cliente (o prompt induz 10x21 e o guard pune) | core:2211 vs 2266, 5111-5172; lote2 §13 |
| 3 | Prompt legado (removido pelo prompt-core, mas presente nas 21 regras aprendidas) manda orçar A4/A3 com preço fixo | `pricing-*` (3 camadas), `dtf-erp-price-authority`, `sheet-choice` sobrescrevem preço de folha pelo ERP; `service-mode` apaga qualquer R$ em FINISHED | `agente_aprendizados` regra "Orce por A4 R$29,90, A3 R$39,00"; lote1 §7; lote4 §21-23; lote2 §9, §12 |
| 4 | `[O CLIENTE JÁ PEDIU PREÇO...]` (blocoPreco) | `joaoJaDeuPreco` = qualquer R$ em outbound nas últimas 14h (inclusive frete ou outro produto) desliga o bloco e o retry | core:2978, 3222 |

### G.2 Perguntar novamente × usar estado existente

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 5 | `[FICHA: ... NÃO pergunte o preenchido]`, `[VOCÊ ACABOU DE PERGUNTAR...]`, guard `pergunta_repetida`, `[CORTEX CONTINUIDADE v1]`, regra aprendida "NAO REPERGUNTE" | Fallback `fechamentoForcado` repete "Me fala o tamanho... e quantos" ignorando slots; `preservacao_falhou` devolve a pergunta repetida; `bag-material-gate` repergunta material a cada turno com "sacola"; `transfer-only`/`material-technique`/`disambiguation`/`financial-input` pedem medida+cópias enquanto `file-state-orchestrator` (mais externo) proíbe exatamente essa pergunta quando MOUNTED_FILE | core:4862-4867, 4611-4614; lote2 §8, §4, §7, §10, §13, §14 |
| 6 | Três máquinas de estado dizem "modalidade já resolvida" (núcleo `blocoModalidadeLogistica`; `fn_joao_session_state`; `fn_joao_shipping_state`) | `sales-continuity` força "Fica envio mesmo" pelo estado salvo mesmo se o cliente mudou para retirada no turno; `freight-comparison` força `modalidade_logistica='envio'` sem flag; e2e `CANONICAL_PICKUP_CONTRADICTED` reescreve para retirada | lote3 §15; lote4 §8; lote1 §2 |
| 7 | Estado do modelo é filtrado por proveniência (`filtrarSlotsPorProveniencia`) | `color-split-request-controller` faz PATCH direto em `agente_noturno_estado.slots` sobrescrevendo o `salvarEstado`; candidato clean grava `schema_version:'joao-items/v1'` na mesma tabela; `salvarEstado` roda antes da barreira de frescor | core:1535, 5105, 5287; lote3 §2; candidato §6 |

### G.3 ERP como autoridade × preço hardcoded

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 8 | `erp-orcamento` + `proposal-receipt` (sempre ativos): toda autorização de produto/total exige `fn_cortex_pricing_calculation_v1` com total ±R$0,02 e proposta ERP, senão 424 | SYSTEM tem R$35,90/29,90 (copo), A4 R$29,90, A3 R$39,00, kit R$79,90, "1 metro de R$99,00"; `calcular_copo` tem preço fixo em código; fallback C27 envia tabela têxtil/copo/pack fixa sem guarda; 21 regras aprendidas repetem preços | core:2231-2238, 2255, 1732, 4864-4867; lote3 §3-4 |
| 9 | Guarda v338 (`fn_valor_e_legitimo` fail-closed): valor cuja fonte é só tabela global é bloqueado | `PRECOS_DE_FICHA`/`PRECOS_FICHA_FECHADOS` liberam esses mesmos valores quando `produtoGuarda` é null; INVARIANTE 1 (autorização por preço de ficha) ficou inalcançável | core:434-447, 3899-3948, 4052-4124 |
| 10 | `dtf-erp-price-authority` sintetiza `dtf_precos_faixa`/`dtf_uv_degraus` a partir do ERP (424 se ERP falhar) | `halftone-router` verbaliza `dtf_precos_faixa` direto do banco sem tool; `promise-guard` verbaliza `amount` de `operacoes_financeiras` dos últimos 60 s; `price-change-pix-gate`, `sheet-choice`, `file-state` escrevem valores em R$ sem passar pelo modelo nem pela guarda | lote1 §7; lote4 §24; lote3 §14; lote2 §3, §9, §14 |
| 11 | Candidato clean: "preço só do ERP" | `quoteTextile` calcula metros localmente com `dtf_produto_config` antes do ERP; `consultar_produto` nunca emite `operation_id` → sem Pix para copo/pack | candidato §8 |

### G.4 Fechar × continuar perguntando

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 12 | SYSTEM "POSTURA: ATACANTE... FECHA", "PIX: Confirma AUTOMATICAMENTE", "gerar_pix com o operation_id" | `price-change-pix-gate` troca `gerar_pix` por "Posso gerar o Pix nesse valor?" (exige confirmação); `uv-boundary` troca "Pix ou cartão?" por hold se não há `pricing.chargeable_total` canônico (produtor NÃO ENCONTRADO → hold sistemático em DTF UV, INFERIDO); `closing-gate` DEFER/DECLINE; `freight-checkout-v2` "Não vou gerar cobrança antes disso" | core:2214, 2225, 2224; lote2 §3; lote1 §6; lote4 §2, §19 |
| 13 | `[JÁ EXECUTADO]` "chame gerar_pix com o operation_id acima" (autorização só de produto) | `gerar_pix` recusa em envio sem TOTAL composto (`envio_sem_total_composto`) e com modalidade `desconhecida` (`modalidade_logistica_pendente`); CEP puro não é sinal de envio → loop de "retirada ou envio?" | core:633, 2087-2101, 715-726 |
| 14 | `orchestrator v1.4` classifica CLOSING > WAITING > LOGISTICS > QUALIFICATION | `closing-gate` e `qualification-gate` leem a string por regex; `joCloseIntent` (orchestrator) ≠ `clCloseIntent` (closing) ≠ FECHAMENTO do SYSTEM; `service-mode` 409 mata o turno em CLOSING se o payload citar DTF com R$ | lote4 §6, §2, §1; lote2 §12 |
| 15 | `order-grade-confirmation` "Não volte para preço, Pix, frete" (mode NORMALIZE) | SYSTEM/REGRAS "use orcar_camisetas assim que tiver MODELO, QUANTIDADE TOTAL e ESTAMPAS... NUNCA segure um orcamento esperando tamanho"; `apparel-catalog` "chame orcar_camisetas mesmo para 1 a 9 peças" | lote4 §9; core:2234, 2265; lote2 §5 |

### G.5 Gerar Pix × ausência de quote válida

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 16 | Aceite de PDF CalcMe emite autorização `orcamento_calcme_entrada` e chama `gerar_pix` sem modelo | `gerar_pix` recusa (`modalidade_logistica_pendente`, `envio_sem_total_composto`, `ja_existe`) e a resposta fixa promete "Vou tentar novamente" — promessa fora de `RX_PROMETE`/`prometeuPix` → repete a cada turno | core:3510-3547, 2074-2101 |
| 17 | Retry de Pix (C11) rejeitado por `validarMsg` mantém o texto antigo | C32 entrega o `qr_code` gerado no retry mesmo assim → texto "vou gerar" + código real | core:4294-4297, 5205 |
| 18 | `freight-checkout-v2` gera Pix fora do modelo (edge `mp-pix-criar`) só em re-chamadas com `[SISTEMA:` | nudge do núcleo pode vir de guard não relacionado a frete (pergunta repetida, promessa); a regex de "sinal de pagamento" inclui "sim/pode/fechado" | lote4 §19 |
| 19 | Candidato clean: `infoOnly` "não gere proposta, operação financeira nem Pix" | `quoteUv` e `freight` emitem operação/proposta ERP sem checar `infoOnly`; `_no_persist` não impede Pix/ERP/Z-API | candidato §8 itens 1, 11 |

### G.6 Produto único × multi-item

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 20 | Slots do núcleo são escalares (`produto`, `quantidade`, `arte`) + `grade[]`/`estampas[]` só para camiseta | `multi-art-dimension-guard` afirma "duas artes juntas no mesmo metro"; `closed-meter` "N cópias = N metros"; `service-mode` admite um modo só (cliente que quer camiseta + filme não cabe); `material-technique-gate` silencia quando a frase tem têxtil e rígido; `freight-comparison` soma quantidades por regex | lote1 §1, §5; lote2 §12, §7; lote4 §8 |
| 21 | Candidato clean tem estado por item (`joao-items/v1`) | grava na **mesma** `agente_noturno_estado`; se o telefone volta ao LIVE, o `[FICHA: slots=...]` recebe o objeto v2 inteiro (migração legada só no sentido inverso) | candidato §6 |

### G.7 Prompt atual × legado Julia/João anterior

| # | Regra A | Regra B | Evidência |
|---|---|---|---|
| 22 | Prompt-core v1c remove SYSTEM+REGRAS_EXTRA+aprendizados | blocos dinâmicos e nudges do núcleo continuam citando construtos do legado (`[ALTERACAO DE PEDIDO... NUNCA calcular_dtf_metro]`, `[O CLIENTE ACHOU CARO...]`, `[JÁ EXECUTADO]`, 11 nudges `[SISTEMA:...]` com regras do prompt antigo); `registrarManifestoJoao` grava o prompt legado, não o enviado | lote1 §3; core:3224, 3178, 4151-4409, 3237 |
| 23 | Prompt-core fail-closed: qualquer wrapper que **prependa** ao `system` ou mude o prefixo faz voltar silenciosamente o prompt de 16k + aprendizados | 10+ preloads pós-núcleo fazem append (OK hoje); `halftone-phone-resolver` faz append; nenhum teste de regressão no deploy protege o hash (NÃO ENCONTRADO) | lote1 §3 |
| 24 | Julia aposentada (tombstone 410, último outbound `source='julia'` 07/09) | `julia-session-manager` (cron 1/min) ainda é a via diurna; `julia_para_joao='ativo'` é lido por 4 pontos; rota `mode!=='ativo'` chama o 410; `agente-conversacao reativar_fds` chama o 410 diariamente; `ASSINATURA_JULIA` no núcleo | `julia-session-manager/index.ts`; `agente-conversacao` l.148; core:365 |
| 25 | `gate7c-preload` pina `COGNITION_AGENT_VERSION='agente-noturno-v4.37.4'` | núcleo LIVE é v4.39.0 | lote3 §9; core:362 |
| 26 | Guardrail de inbound por trigger (`fn_joao_guardrail_inbound_pre`: papel comercial, precedência de produto, quantidade, regras) | só age em linhas criadas `pendente` (fora do horário); o bridge diurno cria `bridge_joao` e depois atualiza → **metade do tráfego não passa por esse guardrail** | `pg_get_triggerdef` (BEFORE INSERT); `julia-session-manager` `criarLoteJoao` |
| 27 | Regra aprendida "UV nao usa calcular_orcamento (so TEXTIL)" e "PACK ... Anime R$6,90; ... Streetwear R$29,90" | tool `calcular_orcamento` não existe; preços de pack vêm de `catalogo_produtos` via `consultar_catalogo` | `agente_aprendizados`; core:1247-1259 |

### G.8 Concorrência de agentes (mesmo input, dois respondentes)

| # | Situação | Evidência |
|---|---|---|
| 28 | Lead recebeu campanha "Bruno Fonseca" pelo `whatsapp-executor` (204 em 30d) → `fn_dono_conversa` = `bruno` por 72h → resposta do cliente vai para `agente-conversacao` (Sonnet, prompt próprio em `agentes.prompt_base`), não para o João | `zapi-ingest` l.780-789; `fn_dono_conversa`; `whatsapp_executor_log` |
| 29 | Fora do horário: `zapi-ingest` chama o João e o sweep de 2 min também elege a mesma linha se ainda `pendente` após 30 s; diurno: `julia-session-manager` rearma o lote se não vê envio em ~1 s | core:5351-5389; `fn_joao_sweep_sync_v1`; `julia-session-manager` `rearmarLoteJoao` |
| 30 | `joao-preflight-ready-v1` manda "Arquivo analisado ✅ ... Valor pelo ERP: R$..." via `botconversa-sender` sem assinatura João e sem passar pelo prompt/guards do João | edge `joao-preflight-ready-v1` `sendQuote` (1 evento em 10d) |

---

## H. Candidatos a remoção (somente listar)

Só lista. Nada foi removido. Critério: código/objeto que hoje não altera nenhuma conversa (dead), ou que duplica outra camada com evidência, ou que é fotografia antiga.

### H.1 Edges Supabase (projeto `ldrdtaibazplvrbwyrvx`)

| Grupo | Itens | Motivo |
|---|---|---|
| Tombstone e caminhos que apontam para ele | `agente-exploracao` (410); rota `mode!=='ativo'` e `bypass_legacy_rollback` no `julia-session-manager`; `agente-conversacao` modo `reativar_fds` + cron `reativar-leads-fora-horario` | chamam um 410 |
| Candidatos/canários sem chamador (79 edges) | todas as `agente-noturno-*` exceto `agente-noturno` e `agente-noturno-bug7-phase3c-internal-dogfood-candidate`; `joao-*-canary-*`, `joao-*-selftest*`, `joao-*-replay*`, `joao-*-once`, `joao-*-probe*`, `agente-noturno-lab`, `agente-noturno-guardrail-teste`, `temp-joao-*`, `security-joao-service-probe` | nenhum cron/trigger/função os chama (PROVADO); só execução manual |
| Funções SQL órfãs de canário/replay | `fn_joao_freight_v295_live_dry_run_invoke_v1`, `fn_joao_pricing_v295_canary_invoke_v1`, `fn_joao_freight_v294_canary_invoke_v1`, `fn_joao_phase1_shadow_invoke_v1`, `fn_replay_p0_1177_v335_dispatch_v1`, `fn_replay_sales_continuity_v2_dispatch`, `fn_replay_v288_boot_probe_v1`, `fn_varredor_noturno` (2) | sem chamador |
| Observadores shadow de "skills" | `fn_joao_skill_live_shadow_observe_v1..v34` (34 versões; trigger em `agente_decisoes_log` chama só a atual via `fn_joao_artwork_shadow_trigger_v1`) e tabelas `joao_skill_live_shadow_*`, `joao_skill_shadow_comparisons` | versões antigas mortas; observação sem efeito |
| Marcos | `agente-fechamento` (bloqueado por migração) + rota `dono==='marcos'` no ingress + crons `agente-fechamento-*` | chamam um handler que devolve `blocked` |

### H.2 Dentro do bundle LIVE (`agente-noturno`)

| Item | Motivo |
|---|---|
| `reengagement-preload.ts` | no-op puro |
| `psd-v4-apparel-apply` | inalcançável (v5 mais externo com regex superconjunto) |
| `freight-agent-response-gate-v1.5` e `pricing-explicit-sheet-response-gate-v5` | só alteram o JSON HTTP; a mensagem já foi enviada |
| `artwork-gold` ramo "físico" injetado; `financial-input-provenance` `jfpgSanitizeSystem`; `closed-meter` remoção de `calcular_dtf` | código morto |
| `skill-router-preload` (flag off desde 09/09) e `external-link-intake-shadow` (off) | desligados por flag, ainda carregados |
| `SYSTEM` + `REGRAS_EXTRA` (16.263 chars) e o bloco de aprendizados | substituídos em runtime pelo prompt-core; permanecem como fallback silencioso e como fonte do manifesto errado |
| `INVARIANTE 1` (core:4052-4124) e `PRECOS_FICHA_FECHADOS`/`PRECOS_DE_FICHA` | inalcançáveis / contradizem a guarda v338 |
| Fallback `fechamentoForcado` com tabelas hardcoded (core:4836-4894) | preço sem guarda |
| `ASSINATURA_JULIA` / `_assinar_como:'julia'` | Julia aposentada |
| Um dos dois: `freight-comparison` (sem flag, força envio) × `blocoModalidadeLogistica` | contradição direta |
| Um dos dois: `color-split-ambiguity` (Modo B) × `color-split-resolution-fallback` (sem flag) | blocos idênticos, ambos injetados |
| Um dos dois: `freight-choice-context` × `freight-checkout-v2` (+ `output-clarify`) | mesmo fluxo, dois fraseados |
| Um dos dois: `uv-operation-idempotency` × `uv-explicit-sheet.reusable()` | mesma consulta de reuso |
| Um dos dois renderizadores de frete: `jcRenderShipping` (e2e) × `fn_joao_shipping_render_v1` | formatos podem divergir |
| Duplicação de guard de saída: `jcGuardOutbound` roda em e2e **e** em uv-boundary | 2× lookups por envio |
| `freshness-preload` | colide com a barreira de frescor do núcleo e produz sucesso falso |
| `gate7c` pin `agente-noturno-v4.37.4` | metadado desatualizado |
| Os 6 detectores de "modo de serviço" e os 3 removedores de tools | um só deveria existir |

### H.3 Banco (`sistema_config` / `agente_aprendizados` / flags)

| Item | Motivo |
|---|---|
| `joao_skill_router_ativo` (false, "retired"), `joao_external_link_intake_shadow_ativo` (false, "retired"), `joao_presend_shadow_fin_cobranca` (false), `joao_halftone_art_final_router_canary_ativo` | chaves aposentadas/canário |
| Regras aprendidas com preço fixo ou tool inexistente (A4/A3/packs/copos/"calcular_orcamento"/tabela de medidas de camiseta) | contradizem "ERP autoridade" e nunca chegam ao modelo com o prompt-core ligado, mas voltam se o hash falhar |
| Cron `aprendizado-prompt` (`aprovar` a cada 2h) | escreve regras no prompt sem deploy nem revisão de código |
| `internal.joao_feature_flags.v2_items_authority` + overrides | rollout 0%; só faz sentido se o candidato for retomado |

### H.4 Repositório

| Item | Motivo |
|---|---|
| `patches/agente-noturno-index-*/`, `patches/joao-p0-1177-live-v335/`, `patches/joao-p0-496-multiart-20260923/`, `patches/joao-replay-hermetico-v288/`, `patches/joao-erp-sale-sync-20260909/sale-sync-v5-retired.ts` | fotografias de composições que não são o deploy (hash não bate) |
| `.github/workflows/joao-p0-1177-source-ci.yml`, `joao-dtf-file-state-v5.yml` | testam fontes que não são o LIVE |
| Diretórios de patch cujos arquivos só existem para serem importados por SHA (todos os `patches/joao-*` usados pelo bundle) | o deploy não depende de HEAD; qualquer edição em HEAD não muda o LIVE |

---

## I. Clean-slate boundary

Pergunta: qual é o **menor ponto do runtime** onde um João novo pode ser plugado sem carregar o legado automaticamente?

### I.1 O que NÃO serve como fronteira (com evidência)

- **Trocar o núcleo dentro da `agente-noturno`** (como foi feito nos v29x/v3xx): qualquer arquivo importado por `index.ts` herda os ~60 wrappers de `globalThis.fetch`/`Deno.serve`. Provado pela cadeia (C.1) e pelo fato de que os wrappers agem em qualquer `fetch` de `api.anthropic.com`, Z-API, BotConversa, `joao-tts`, `calcular-frete`, `fn_emitir_operacao_financeira`, `dtf_precos_faixa`... — não importa quem chame.
- **Um `_dry_run`/flag dentro da mesma edge**: `dry-run-effect-zero` bloqueia escritas mas o pipeline de guards continua; e o prompt-core é hardcoded `true`.
- **Reaproveitar `agente_noturno_estado`** (como o candidato faz): contamina o `[FICHA]` do LIVE e é lida por 8 preloads (e2e, uv-boundary, freight-runtime, file-state, color-split, human-promise, uv-explicit-sheet, erp-orcamento) que tomam decisões a partir de `slots`.
- **Entrar pelo `julia-session-manager`**: o lote vira `inbound_fora_horario` e passa a ser elegível ao sweep do LIVE (`fn_joao_sweep_sync_v1` chama `agente-noturno {_sweep}` para toda linha `pendente`).

### I.2 A fronteira mínima que existe hoje (PROVADO)

O ponto é a **decisão de slug no `zapi-ingest`**, já implementada e já usada pelo candidato:

```
zapi-ingest
  ├─ hasJoaoDogfoodOverride(phone)   → fn_joao_phase3c_dogfood_route_v1  (allowlist por phone, TTL)
  └─ resolveJoaoRuntimeSlug(phone)   → fn_joao_phase3d_runtime_route_v1  (flag v2_items_authority: off/percentage/full, breaker, overrides ENABLE/BLOCK)
        └─ callFunction(slug, {phone, chat_name, mensagem, inbound_id, tem_imagem})
```

Condições para que essa fronteira seja realmente "clean" (o que a autópsia mostra que hoje NÃO é):

1. **Cobrir as três entradas, não uma.** Hoje o override cobre todas as mensagens (`!fromMe && mensagem`), mas `resolveJoaoRuntimeSlug` só é usado no ramo fora do horário. O ramo diurno vai para `julia-session-manager` → LIVE sem consultar a flag; o sweep e o trigger de guardrail chamam `agente-noturno` por URL fixa (`fn_joao_http_post_vault_v2` só permite 5 URLs, todas LIVE). Um João novo que só use a fronteira do ingress recebe apenas o tráfego fora do horário e perde o lote quando o LIVE o "rouba" pelo sweep.
2. **Estado próprio.** Tabela/sessão nova (não `agente_noturno_estado`), lock próprio (não `agente_noturno_lock`/`fn_joao_adquirir_lock_v3` interceptado), fila própria ou carimbo terminal imediato em `inbound_fora_horario` para o sweep não reprocessar.
3. **Envio com o mesmo contrato de efeito** que o LIVE já exige (`fn_conversation_effect_claim_v1`/`finish` + ledger `joao_envios` + `gravarFio`), senão `julia-session-manager`, `fn_joao_recovery_before_redecision_v1` e o sweep tratam como "não respondido" e rearmam.
4. **O candidato atual não satisfaz 2 nem 3** (grava na mesma tabela; envia direto no Z-API só com `_send:true`; sem ledger/decisão), e o ingress não passa `_send` → hoje, roteado, ele calcula e não responde.
5. **Bruno continua concorrente** por `fn_dono_conversa` independente do slug do João; a fronteira do João não cobre isso.

### I.3 O que entra "de graça" ao passar por essa fronteira (e é legado)

Mesmo com slug próprio, o João novo ainda recebe do `zapi-ingest`: debounce e agregação por `inbound_fora_horario` (trigger `fn_joao_guardrail_inbound_pre` com 4 regras de negócio quando fora do horário), `mensagem` já transformada (áudio transcrito com marcador `[Áudio]:`, `[SISTEMA: o cliente enviou um AUDIO...]` como texto), `[Arquivo recebido pelo WhatsApp: ...]`, eventos de sistema como fala (`[ARTE_PROCESSADA_CORTEX]`, Pix bridge) quando vier pelo session-manager, e documentos desviados para `arte-upload` (`handleDocumento`). Esses são os "textos legados" que entram no contexto sem que o novo runtime os peça.

### I.4 Resumo

A fronteira clean-slate mínima é **um slug de edge próprio escolhido no `zapi-ingest` (as duas RPCs de rota já existem), com estado, lock e fila próprios, e envio pelo contrato de efeito governado**. Tudo que estiver "dentro" de `agente-noturno` (index.ts e seus 66 imports) não é reaproveitável sem carregar a cadeia inteira. O que precisa ser decidido antes de cortar (não é escopo desta rodada): quem cobre o tráfego diurno (session-manager) e o sweep, e o que fazer com o dono Bruno.

---

## Apêndices

### X.1 Flags `sistema_config` que o runtime do João lê (estado em 26/09/2026)

| Chave | Valor | Quem lê |
|---|---|---|
| `joao_contexto_canonico_ativo` | true | núcleo (gate comercial) |
| `joao_tts_ativo` | true | núcleo (voz) |
| `joao_dry_run_effect_zero_v1_ativo` | true | dry-run-effect-zero |
| `joao_guardrail_inbound_v1` | true | trigger inbound |
| `joao_commercial_role_inbound_v1` | true | trigger inbound |
| `joao_product_precedence_inbound_v1` | true | trigger inbound |
| `joao_qualification_enforce_v1` | true | trigger inbound |
| `joao_qualification_gate_ativo` | true (v1.4) | qualification-gate v1.6, psd v3/v4/v5, disambiguation-v3-user-evidence (uma flag, 5 comportamentos) |
| `joao_closing_gate_ativo` | true (v1.3) | closing-gate |
| `joao_skill_orchestrator_ativo` | true (v1.3; código v1.5) | orchestrator v1.4/v1.5 (default true = fail-open) |
| `joao_skill_advisor_ativo` | true | skill-advisor |
| `joao_skill_router_ativo` | **false** (retired 09/09) | skill-router |
| `joao_capability_guard_ativo` | true (v1.1) | capability-guard |
| `joao_layout_disambiguation_ativo` | true (v1.2) | layout-disambiguation |
| `joao_artwork_context_guard_ativo` | true (v1.1) | artwork-current-turn v1.1, artwork-context v1/v2 |
| `joao_direct_file_intake_ativo` | true | direct-file-intake |
| `joao_external_link_intake_ativo` | true (v3) | external-link-intake |
| `joao_external_link_intake_shadow_ativo` | false (retired) | — |
| `joao_repeat_order_history_ativo` | true | repeat-order-history |
| `joao_order_grade_confirmation_ativo` | true | order-grade-confirmation |
| `joao_freight_choice_context_v1_ativo` | true (v1.1) | freight-choice-context |
| `joao_freight_checkout_v2_ativo` | true (v2.2) | freight-checkout-v2 |
| `joao_uv_explicit_sheet_v1_ativo` | true | uv-explicit-sheet |
| `joao_uv_financial_op_idempotency_v1_ativo` | true | uv-operation-idempotency |
| `joao_quantity_color_split_ambiguity_v1_ativo` | true (v1.1) | color-split-ambiguity |
| `joao_freight_error_truth_semantics_v1_ativo`, `joao_freight_retry_snapshot_reuse_v1_ativo` | true | edge `calcular-frete` |
| `joao_halftone_art_final_router_ativo` | true | halftone-router |
| `joao_presend_shadow_fin_cobranca` | false | — |
| `julia_para_joao` | 'ativo' | julia-session-manager, fn_julia_pode_atender, trigger Purchase |
| `julia_ativa` | true | zapi-ingest (`julia_config` também) |
| `roteamento_dono` | 'ativo' | zapi-ingest (`fn_dono_conversa`) |
| `cortex_joao_artwork_bridge_enabled` | 'ativo' | bridge de arte → session-manager |
| `cortex_joao_pix_bridge_enabled` | 'ativo' | bridge Pix → session-manager |

Sem flag (sempre ativos): prompt-core (`PC_ENABLED=true` no código), canonical-live-e2e, uv-boundary, dtf-erp-price-authority, human-promise, closed-meter, multi-art, FreightAgent (3), pricing-agent (3), halftone-phone-resolver, erp-orcamento, proposal-receipt, auth, payment/order/fiscal-status, gate7c, output-guard-v3, lock-v3, b2, promise-guard, sales-continuity, freshness, freight-comparison, color-split-fallback, freight-positive-output, checkout-clarify, image-measure, material-capability, price-change-pix-gate, transfer-only, apparel-catalog, artwork-gold, material-technique, bag-material, sheet-choice, dtf-objection, service-mode, financial-input, file-state.

### X.2 Crons que tocam o João (pg_cron, projeto `ldrdtaibazplvrbwyrvx`)

| Job | Cadência | Efeito |
|---|---|---|
| `joao-sweep-2min` → `fn_joao_sweep_sync_v2` | 1-59/2 min | recovery + `agente-noturno {_sweep}` + ERP syncs |
| `julia-session-manager-tick` | 1/min | processa sessões diurnas → João |
| `joao-preflight-ready-dispatch-v1` | 1/min | `joao-preflight-ready-v1` (cotação ERP direta ao cliente) |
| `joao-p0b-item-fact-reconcile-1min` | 1/min | `fn_joao_p0b_reconcile_pending_v1` (não lido) |
| `joao-erp-orcamento-sync-2min`, `joao-erp-sale-sync-linked-contract-2min`, `mp-pix-reconcile-open-orders-2min` | 2 min | sincronizações ERP/Pix |
| `joao-p0a-shadow-retention-v1` | diário | purge shadow p0a |
| `whatsapp-executor-15min` | 15 min | dispara fila `waba_disparos_lista` (mensagens "Bruno Fonseca") |
| `reativar-leads-fora-horario` | 18:00 | `agente-conversacao reativar_fds` → chama `agente-exploracao` (410) |
| `aprendizado-prompt-semanal` / `aprendizado-prompt-aprovacao` | semanal / 2h | escreve `agente_aprendizados` (entra no prompt) |
| `cortex_gate7c_auto_arm_recurrent_inbound_v1` | 10 min | arma leads para o bridge gate7c (Pix via executor) |
| `agente-fechamento-*` (4) | dias úteis | Marcos (bloqueado) |

### X.3 Volumes (evidência de quem responde)

| Medida | Valor |
|---|---|
| `fact_conversations` outbound 30d por `source` | joao 6.515 · zapi (eco) 18.915 · julia 1.576 (última 07/09 19:03) · bruno 44 · marcos 12 · joao-zapi-recovery 28 |
| `agente_decisoes_log` agente-noturno 10d | 2.515 enviadas v4.37.5 (até 25/09) · 239 enviadas v4.39.0 (25-26/09) · 4 v4.38.0 · 295 `falhou_envio` · 133 `superseded` |
| `inbound_fora_horario` 10d por status | atendido_joao 3.095 · humano_ativo 485 · pausado_humano 271 · silencio_joao 118 · reprocessado 17 · descartado 1; 1.808 linhas de origem `CortexDaytimeBridge` |
| `whatsapp_executor_log` 30d | 204 enviados assinados "Bruno Fonseca" (lead_morno 167, retencao 25, lead_quente 12) |
| `cortex_artwork_joao_bridge_events` 10d | 227 `queued` (viram texto `[ARTE_PROCESSADA_CORTEX]` no João) |
| `joao_preflight_events_v1` 10d | 1 (FAILED) |
| `prompt_manifesto_joao` v4.39.0 | 267 turnos; system_final médio 23.738 chars; histórico médio 15 turnos |
| Logs de edge 24h | `julia-session-manager` 1.845 · `agente-noturno` 1.007 · `zapi-ingest` 543 · dogfood 57 |

### X.4 O que esta autópsia NÃO fez (limites declarados)

- Não executou nenhuma chamada de escrita, deploy, migração, dry-run ou replay. Só `SELECT`, leitura de edge functions via API de gerenciamento, leitura de logs e `git` local read-only (`fetch --unshallow` para comparar hashes).
- Não leu o corpo das RPCs de negócio (`fn_contexto_comercial_do_lead`, `fn_qualification_evaluate_v2`, `fn_closing_evaluate_v1`, `fn_valor_e_legitimo`, `fn_joao_session_state_*`, `fn_joao_shipping_state_*`, `fn_joao_price_intent_gate_eval_get_v1`, `fn_joao_commercial_role_decide_v1`, `fn_joao_authorize_*`, `fn_gate7c_*`) — o que elas decidem está classificado como INFERIDO a partir de como o código as consome.
- Não leu as edges `calcular-frete`, `mp-pix-criar`, `joao-orcamento-calcme`, `joao-erp-*-read`, `joao-tts`, `botconversa-sender`, `arte-upload-ingest`, `agente-pipeline` além do que o núcleo/preloads expõem delas.
- Não verificou o conteúdo de `agentes.prompt_base` de Bruno.
- O `prompt_manifesto_joao` mede o prompt ANTES dos wrappers; o tamanho real enviado à Anthropic não é observável no banco (INFERIDO: ~7 KB fixos do prompt-core + blocos dinâmicos + skills injetadas + tools ≈ 12-18 mil chars).
- Os relatórios de lote foram produzidos por subagentes de leitura e revisados por amostragem; cada afirmação carrega a linha de origem para conferência.

### X.5 Como reproduzir as evidências (read-only)

- Edge LIVE: `list_edge_functions` / `get_edge_function('agente-noturno')` no projeto `ldrdtaibazplvrbwyrvx` (38 arquivos; `ezbr_sha256 d9e99f35…`).
- Imports pinados: `curl https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/<sha>/patches/...` para cada `import` (47 URLs).
- Hash × repo: `git rev-list --all | xargs -n1 git ls-tree -r | awk '{print $3}' | sort -u` vs `git hash-object <arquivo deployado>`.
- Roteamento: `pg_get_functiondef` de `fn_joao_phase3c_dogfood_route_v1`, `fn_joao_phase3d_runtime_route_v1`, `fn_joao_sweep_sync_v1/v2`, `fn_joao_guardrail_inbound_pre`, `fn_cortex_purchase_julia_confirm_joao_v1`, `fn_dono_conversa`, `fn_julia_pode_atender`; `pg_get_triggerdef`; `cron.job`.
- Flags: `select chave, valor_bool, valor_text from sistema_config where chave ilike 'joao%'`; `select * from internal.joao_feature_flags`.
- Prompt: `select * from auditoria.prompt_manifesto_joao order by registrado_em desc`; `select public.fn_contexto_aprendizados('agente-noturno', null)`.
