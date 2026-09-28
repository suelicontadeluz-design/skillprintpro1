# Lote 1 — preloads locais importados ANTES do núcleo (11 arquivos)

Fonte: edge `agente-noturno` v347, diretório `preloads/` ("D/"). Núcleo: `D/preloads/bug3/candidate-index-v338.ts` ("core"). Relatório do subagente de análise, lido integralmente; nenhum arquivo foi modificado.

## Ordem global (PROVADO)
- `D/index.ts`: l.1 multi-art, l.2 e2e, l.3 prompt-core, l.8 human-promise, l.9 closed-meter, l.10 uv-boundary, l.11 erp-price-authority, l.12 `joao-v299-freight-autoquote-stack-v1.ts` → (`preloads/joao-v299-freight-autoquote-stack-v1.ts` l.8 freight-ctx, l.9 freight-runtime, l.10 freight-gate, l.12 `bug3/v294` → v292.1 → v291 → core em `preloads/bug3/v291-v338.ts` l.23). **Todo o lote é avaliado ANTES do core.**
- Core chama `fetch(` global em tempo de requisição (core l.3335) e `Deno.serve` em l.5346 → todos os wrappers de fetch do lote se aplicam; wrappers de Deno.serve instalados antes do core se aplicam.
- Cadeia fetch para `api.anthropic.com` (mais externo = instalado por último): closed-meter (muta system+tools) → prompt-core (reescreve system) → e2e (não toca) → multi-art (inspeciona resposta) → fetch real. Na volta: multi-art age primeiro, closed-meter depois.
- Cadeia Deno.serve (mais externo = instalado primeiro): e2e → uv-boundary → freight-ctx → freight-gate → [patches remotos] → handler do core.
- Nenhum arquivo do lote lê `sistema_config`. Segredos: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; erp-price-authority usa `ERP_URL` (default hardcoded l.11), `ERP_SERVICE_KEY`/`ERP_SERVICE_ROLE_KEY`.

---

### 1. joao-dtf-multi-art-dimension-guard-v1.ts
- **Hook**: `globalThis.fetch` só em `^https://api.anthropic.com/v1/messages` (l.82), não-stream (l.85). Antes do core (index l.1); wrapper mais interno da cadeia Anthropic.
- **Injeção no prompt**: NÃO ENCONTRADO (só lê `messages` l.86 e substitui a RESPOSTA).
- **Condição**: `jdmgUnresolved` (l.54-56) = têxtil estabelecido nas últimas 30 falas do usuário (l.30-35) E multi-arte (l.36-40: "duas|2|tres|3|varias artes" OU "etiqueta"+"ele vive") E largura parcial "N cm de largura" (l.41-46) E sem altura (l.47-53). Só bloqueia se a resposta do modelo tiver `tool_use` de `calcular_dtf_por_arte|calcular_dtf|calcular_dtf_metro|compor_total|gerar_pix|criar_cobranca` (l.60) ou texto com `R$ \d|total|pix|cartao|pagamento|209 copias|144 copias|1 metro por arte` (l.63). Sem flags; fail-open.
- **Tools**: não altera a lista; **bloqueia execução** substituindo a resposta inteira por `end_turn` (l.77).
- **Banco**: nenhum.
- **Efeito**: JSON determinístico (l.69-76, 273 chars): "Antes de recalcular, falta uma medida que você ainda não informou: da arte “Ele vive” eu tenho 6 cm de largura, mas não tenho a altura. Qual é a altura em cm? Vou considerar as duas artes juntas no mesmo metro quando couber; não vou cobrar 1 metro por arte sem necessidade." tema `dtf_metro`, etapa `orcamento`, slots `{produto:'dtf_textil'}`.
- **Decisões**: medidas (exige altura antes de preço); DTF têxtil multi-item ("duas artes juntas no mesmo metro" = política de precificação afirmada ao cliente); bloqueia preço/Pix/pagamento. PROVADO: texto fixo diz "6 cm" e "Ele vive" (l.71) enquanto o gatilho aceita qualquer largura (l.43) → se o cliente disse 8 cm, João responde "6 cm". Constantes de caso específico: "209 copias", "144 copias" (l.63).
- **Duplicidade/conflito**: core l.2211 "CLIENTE SEM MEDIDA: pergunte a medida"; core l.2199 "DTF têxtil -> calcular_dtf_por_arte" e blocoMudanca l.3224 vs guard l.60 que bloqueia exatamente esse tool_use. Sobrepõe closed-meter (#5).

### 2. joao-canonical-live-e2e-preload-v1.ts + -core-v1.ts
- **Hook**: (a) `Deno.serve` wrapper (l.635-747): POST JSON com `phone`≥10 dígitos; reconcilia estado canônico ANTES do handler. (b) `globalThis.fetch` (l.574-632): `/subscriber/get_by_phone/` (cache sid→phone); POST para Z-API `send-text`, BotConversa `send_message`, `/functions/v1/joao-tts` (core-e2e l.93-113). Camada Deno.serve mais externa.
- **Injeção no prompt**: NÃO ENCONTRADO.
- **Condição**: sempre (todo POST com phone). Escritas: produto quando shadow `RESOLVED`+`HIGH` e mudou e `!dryRun` (l.430-437); pagamento quando `jclPaymentCandidate` e outbound anterior perguntou forma de pagamento (l.305-323); NO_ART (regex l.77-80, família dtf_uv/dtf_textil); quantidade quando `jcQuantityCandidate` (número solto ≤120 chars) e outbound anterior perguntou quantidade; retirada quando `jcPickupSelection` — **executa também em dryRun** (l.547). Guard de saída sempre que estado canônico `ok` (l.617). Fail-open.
- **Tools**: nenhum.
- **Banco**: LÊ `agente_noturno_estado` (l.139), RPC `fn_joao_session_state_current_v1` (l.158), `fact_conversations` (l.209, 308, 328), `agente_decisoes_log` (l.242). **ESCRITA**: RPC `fn_joao_session_state_apply_v1` (PRODUCT_CONFIRMED l.438; QUANTITY_CONFIRMED l.525; FULFILLMENT_PICKUP_SELECTED l.548), RPC `fn_joao_payment_method_apply_v1` (l.466), RPC `fn_joao_artwork_state_apply_v1` FILE_STATE_SET=NO_ART (l.493), INSERT `sistema_logs` (l.348), inclusive `product_service_shadow_diff` a cada turno live (l.274, background `EdgeRuntime.waitUntil` l.178-195).
- **Efeito na saída**: reescreve texto no transporte (core-e2e l.210-265): `CONFIRMED_QUANTITY_REASK` → remove pergunta ou "Já estou com N peças confirmadas. Vou seguir com essa quantidade."; `CONFIRMED_PRODUCT_SERVICE_REASK` → "Perfeito, sigo com DTF têxtil para aplicar nas peças." / "Perfeito, sigo com a peça personalizada conforme combinado."; `CONFIRMED_PAYMENT_METHOD_REASK` → "Pagamento confirmado via Pix|cartão. Vou seguir com o fechamento."; `CONFIRMED_SHIPPING_MODE_REASK` → "Já está confirmado que será envio..."; `CANONICAL_PICKUP_CONTRADICTED` → "Perfeito, ficou combinado: retirada na loja, sem frete..."; `CANONICAL_ZIP_REASK` → render das cotações ou "Já estou com o CEP X registrado..."; `CANONICAL_FREIGHT_DENIED` → "Tenho opções de frete para o CEP …". Canary probe 200/503 só com `_canonical_live_canary && _dry_run` (l.685-716). Expõe `__joaoCanonicalActiveTurnV1`, `__joaoCanonicalGuardV1` (l.749-768).
- **Decisões**: quantidade (número solto vira quantidade confirmada); retirada; pagamento; produto + modo de serviço (heurísticas do shadow #11); arte (NO_ART); frete; correferência.
- **Duplicidade/conflito**: comentários dizem "effect-zero… no competing authority" (l.26-27, l.299-301) mas l.437-446 GRAVA `PRODUCT_CONFIRMED` (PROVADO). Core l.2217/2269 "PROIBIDO pedir CEP" sob retirada vs guard; core l.2271 "NAO REPERGUNTE…" vs `CONFIRMED_QUANTITY_REASK`; core `blocoModalidadeLogistica` l.858-866 / `blocoCepCanonico` l.1063-1070 vs `fn_joao_session_state` (segunda máquina de estado). Mesmo guard roda de novo em #6 → 2× lookups por saída. Remoção de "Pix ou cartão?" vs core l.2223 passo 3.

### 3. joao-prompt-core-preload-v1b.ts + joao-prompt-core-v1.mjs
- **Hook**: `globalThis.fetch` em `api.anthropic.com/v1/messages` (l.50). Antes do core (index l.3). `PC_ENABLED = true` hardcoded (l.13); o comentário l.7 fala em env `JOAO_PROMPT_CORE_V1_ENABLED` mas o código não lê env (PROVADO).
- **Injeção**: **SUBSTITUI o prefixo fixo inteiro** `SYSTEM+REGRAS_EXTRA` (16.263 chars) **e também o bloco de regras aprendidas** (`blocoAprendizados`, core l.3227) por `PROMPT_CORE_V1` (3.262 chars, mjs l.12-41) + `\n\n` + cauda a partir de `[AGORA:` (mjs l.82-89). Verificado: core SYSTEM len 8341 / sha `2de211…`, REGRAS_EXTRA len 7922 / sha `58e68f…` = pins (mjs l.6-10) → aplica em produção (PROVADO). Conteúdo novo: missão (1 pergunta), autoridade (fatos só de contexto/skills/tool_result; execute tool no mesmo turno; nunca UUID), conversa (≤2 frases, sem emoji/travessão), fatos estáveis (site, insta, endereço, horário, prazos ≈ core l.2240-2246), contrato JSON idêntico ao legado (mjs l.41 = core l.2252).
- **Condição**: sempre que `system` começa com "Você é João Barros, VENDEDOR…", hashes batem e existe `[AGORA:`; senão fail-closed = prompt legado intacto (preload l.67-70). Sem flags, sem banco.
- **Decisões (por remoção)**: retira do modelo: preços hardcoded (copo R$35,90/29,90 l.2231; UV A4 R$29,90/A3 R$39,00 l.2232; kit R$79,90 l.2238; "1 metro de R$99,00" l.2255), ordem de SLOTS l.2216, roteiro de FECHAMENTO l.2220-2228, "Pix ou cartão?" l.2223, roteamento de tools (l.2199, 2255, 2262, 2265), "ESTAMPARIA não cota" l.2235, packs l.2236, revendedor l.2261, "Sedex mais barato" l.2271, **todas as regras aprendidas do banco**.
- **Duplicidade/conflito**: blocos dinâmicos que sobrevivem ainda citam construtos legados (blocoMudanca l.3224; blocoObjecao l.3170; `[JÁ EXECUTADO]` l.638). `registrarManifestoJoao` (core l.3237) grava `systemFinal` ANTES da reescrita → manifesto no banco não reflete o prompt enviado (PROVADO por ordem). Qualquer wrapper mais externo que PREPENDA ao `system` quebra o hash → volta silenciosamente ao prompt legado de 16k. No lote só closed-meter toca `system` (append). Preloads pós-núcleo que tocam `.system` (apparel-catalog, artwork-gold, material-capability, technique-gate, transfer-only, file-state, financial-input, image-measure, service-mode, sheet-choice) fazem append — verificado no lote 2.

### 4. joao-human-promise-task-guard-v1.ts + -core.mjs
- **Hook**: `globalThis.fetch`: `/functions/v1/joao-tts` (l.242), Z-API `send-text` (l.265), BotConversa `get_by_phone` (l.286) e `send_message` (l.305). Antes do core (index l.8).
- **Condição**: `humanPromise` (core.mjs l.1-17): palavra de dependência humana (equipe|producao|atendimento|financeiro|arte final|responsavel|setor|estoque|agenda|encaixe|disponibilidade|prazo) + verbo de promessa. **Fail-CLOSED**: corpo não inspecionável/não-JSON → 409 sem enviar (l.75-89, l.244, l.268, l.308). Sem flags.
- **Banco**: LÊ `agente_noturno_estado` (l.108). **ESCRITA**: RPC `create_human_task_safe` (l.167) — tarefa CRM "João — confirmação humana pendente", etapa `joao_consulta_humana`, urgência `alta`, `p_due_horas:1`.
- **Efeito**: TTS com promessa → 409 forçando fallback texto. Texto: tarefa aceita → envia igual; recusada/sem phone → remove as frases com promessa e anexa "Esse ponto depende da confirmação da equipe; não vou te prometer antes dela." (core.mjs l.33).
- **Decisões**: follow-up/promessa humana (cria tarefa CRM); prazo/encaixe/agenda.
- **Duplicidade/conflito**: core l.2245 manda dizer que "a equipe consulta a agenda… NUNCA prometa encaixe sem consultar" e l.2234/2265 "encaminhe para a equipe" → produz exatamente a frase que o guard captura (PROVADO regex core.mjs l.11/14). Custo: 3 sends/turno podem gerar 3 tarefas.

### 5. joao-dtf-textile-closed-meter-preload-v1.ts
- **Hook**: `globalThis.fetch` em Anthropic (l.191). Muta REQUISIÇÃO (system+tools) e RESPOSTA. Antes do core (index l.9); externo a prompt-core (append preserva o prefixo do hash).
- **Injeção**: append ao `system` do bloco "[CORTEX DTF TEXTIL UNIDADE COMERCIAL v1] … [/CORTEX DTF TEXTIL UNIDADE COMERCIAL]" (l.137-146, ~631 chars): "metragem comercial fechada: N metro(s)", "Nao use calcular_dtf_por_arte nem calcular_dtf", "use calcular_dtf_metro com metros=N", "57x100 cm = 1 metro comercial; N cópias = N metros".
- **Condição**: têxtil estabelecido (últimas 14 falas) E fala atual com "57x100/100x57" ou "N m|metro(s)" com 1≤N≤500. Sem flags, sem banco. Fail-open.
- **Tools**: **REMOVE** `calcular_dtf_por_arte` e `calcular_dtf` (l.209; `calcular_dtf` NÃO existe em TOOLS). **Reescreve tool_use** desses nomes para `calcular_dtf_metro {metros:N}` (l.175-179); sem tool direto, troca por texto "Nao consegui confirmar o preco canonico desse metro agora..." e `end_turn`.
- **Decisões**: DTF têxtil quantidade/medida ("57x100 = 1 m; N cópias = N m"); roteia preço para `calcular_dtf_metro`; qualquer "N m" na fala vira metragem fechada (INFERIDO risco: "1 m de altura").
- **Duplicidade/conflito**: core TOOLS l.1251 (`calcular_dtf_metro`: "PROIBIDO usar quando existem largura, altura e copias"), core l.2199, blocoMudanca l.3224 "NUNCA calcular_dtf_metro" vs regra injetada l.141 + reescrita (preload vence porque remove a tool). Núcleo ainda redireciona `calcular_dtf_metro→calcular_dtf_por_arte` (core:3369) — duas direções opostas no mesmo turno.

### 6. joao-canonical-dtf-uv-boundary-preload-v1.ts + -core-v1.ts
- **Hook**: `Deno.serve` wrapper (l.274-302) reconcilia produto antes do handler; `globalThis.fetch` em `get_by_phone` + saídas Z-API/BotConversa/TTS (l.221-271). 2ª camada Deno.serve.
- **Condição**: `jduFinishedFamily` (l.118-127) → drinkware/apparel FINISHED_PERSONALIZED; UV explícito ou continuação UV → dtf_uv TRANSFER_ONLY + substratos. Escrita pulada em dryRun salvo sessão `canary-live:`/`replay:`. Saída: base `jcGuardOutbound` sempre; regras UV só se família canônica `dtf_uv`. Fail-open.
- **Banco**: LÊ `agente_noturno_estado`, `fact_conversations`, RPC `fn_joao_session_state_current_v1`. **ESCRITA**: RPC `fn_joao_session_state_apply_v1` PRODUCT_CONFIRMED com `application_substrates` (l.186); `sistema_logs`.
- **Efeito**: `CANONICAL_PRODUCT_REQUALIFICATION` → "DTF UV já está confirmado para aplicação. Vou seguir nesse pedido."; `CANONICAL_TRANSACTIONAL_PRICE_MISSING` (texto com R$ + total/fica/sai/fechar OU "Pix/cartão?" sem `pricing.chargeable_total` canônico) → substitui por hold ("Preciso concluir o total correto do pedido antes de passar a forma de pagamento." etc.); `CANONICAL_TRANSACTIONAL_PRICE_MISMATCH` → "Total do pedido: R$ X."; `CANONICAL_SHIPPING_SELECTION_MISSING` → hold.
- **Decisões**: produto/modo; preço (bloqueia total/pagamento sem `chargeable_total` canônico — NÃO ENCONTRADO no lote quem grava `pricing.chargeable_total`; INFERIDO: se ninguém grava, todo "Pix ou cartão?" em DTF UV vira hold); pagamento; frete; fechamento.
- **Duplicidade/conflito**: core l.2223 "Pix ou cartão?" e l.2213/blocoPreco l.3223 vs guard que troca R$ por hold quando há "fica/sai/total" (core-uv l.82 inclui `\bsai\b|\bfica\b`, que aparecem em cotação simples). Repete #2 (mesmo `jcGuardOutbound`, 2× por saída).

### 7. joao-dtf-erp-price-authority-v1.ts
- **Hook**: `globalThis.fetch` em REST do projeto principal: GET `/rest/v1/dtf_precos_faixa` (l.149), GET `/rest/v1/dtf_uv_degraus` (l.158), POST `/rest/v1/rpc/fn_precificar_dtf_uv_v2` (l.166). Core lê essas fontes em l.1751, 1763, 1829, 1865, 1879, 1916.
- **Condição**: sempre nessas URLs. Sem chave ERP ou ERP falha → **424 fail-closed**. Sem flags.
- **Banco**: LÊ host ERP: `produtos` (sku DTF-TXT; "Filme DTF UV Impresso"), `produto_precos_venda` tabela PADRAO, RPC `fn_cortex_pricing_calculation_v1`. Sem escrita.
- **Efeito**: sintetiza linhas de `dtf_precos_faixa` e `dtf_uv_degraus` a partir do ERP; substitui `preco_total/degrau/unidade_cobranca/quantidade_cobrada/precos_verbalizaveis` do RPC UV pelo total ERP + `pricing_authority`. Falha ERP → 424 `{ok:false, erro:'erp_preco_indisponivel', acao:'Nao informe preco ate o ERP responder.'}`.
- **Decisões**: preço DTF têxtil e UV (ERP é a autoridade); degraus UV.
- **Duplicidade/conflito**: core l.2232 (A4 R$29,90 / A3 R$39,00) e l.2255 são constantes no prompt legado; prompt-core (#3) as remove só se aplicado; as 21 regras aprendidas repetem "A4 R$29,90, A3 R$39,00".

### 8. freight-current-turn-context-preload-v1.1-active-turn.ts
- **Hook**: `Deno.serve` wrapper (l.55-95): guarda ctx do turno por phone + `AsyncLocalStorage`; expõe `__joaoFreightCurrentTurnV1` e `__joaoFreightActiveTurnV1`. Sempre. Sem banco, sem efeito. 2 turnos simultâneos do mesmo phone → `AMBIGUOUS_ACTIVE_TURN` → #9 falha fechado.

### 9. freight-agent-runtime-preload-v1.3-pure-cep.ts
- **Hook**: `globalThis.fetch` (l.741-815): `get_by_phone`; POST `/functions/v1/calcular-frete` (l.765: bind/bloqueio/reuso); saídas Z-API/BotConversa/TTS (reescreve texto); retry Z-API 1× em 408/409/425/429/5xx.
- **Condição**: saída reescrita só com ctx de turno ativo, turno "shipping relevant" (regex cep/frete/sedex/pac/j&t/entrega/envio/retirada, serviço, continuação curta) e NÃO `mixed_sensitive` (pix/pagamento/total/preco/valor/quantidade/peca/dtf/camiseta/arte ou "NxM" → só observa). Bind de `calcular-frete`: turno ativo + lead + produto canônico "enforced" (dtf_textil TRANSFER_ONLY ou apparel FINISHED_PERSONALIZED) → exige recibo canônico de proposta ERP dos últimos 7 dias (`joao_erp_proposal_receipts_v1`) senão **409**. Reuso: cotação canônica fresca p/ mesmo CEP sem `servico_escolhido` → 200 sintético sem chamar a edge. Fail-closed sem ctx.
- **Tools**: intercepta a chamada backend da tool `calcular_frete` (core l.2013 envia `metros:1, valor_declarado:60`): pode bloquear (409), reescrever body para `{cep_destino, shipment_kind:'apparel'}`, ou responder com cotações canônicas.
- **Banco**: LÊ `agente_noturno_estado`, `joao_freight_quote_snapshots` (TTL 2h), RPC `fn_joao_session_state_current_v1`, `joao_erp_proposal_receipts_v1`, RPC `fn_joao_shipping_state_current_v1`, RPC `fn_joao_shipping_render_v1`. **ESCRITA**: RPC `fn_joao_shipping_state_apply_v1` (QUOTE_EXPIRED, ZIP_PROVIDED, QUOTE_RECORDED, QUOTE_SELECTED), RPC `fn_joao_shipping_preference_reapply_v1`, `sistema_logs`. **Chama a edge `calcular-frete` por conta própria** (autoquote) quando a fala é CEP puro e há venda canônica.
- **Efeito**: substitui o texto de saída pelo render canônico (`fn_joao_shipping_render_v1.text`) ou safe-text ("Já tenho seu CEP X. Preciso concluir o orçamento atual antes de consultar as opções de frete." / "…não consegui concluir a cotação das transportadoras agora."). O texto do modelo é descartado inteiro em turno puro de frete com render não-vazio (PROVADO l.784-795).
- **Decisões**: frete (captura CEP, registra/expira cotação, seleção por nome ou valor, autoquote em CEP puro, reuso); proposta (recibo ERP obrigatório antes do frete); produto (gating por família canônica); quantidade (peças/metros do recibo); intenção (shipping vs misto).
- **Duplicidade/conflito**: core l.2222 "chame calcular_frete SO com o CEP… aguarde a escolha… NUNCA escolha frete pelo cliente" vs autoquote sem o modelo e reuso sintético; core l.2013 `metros:1` fixo vs metros/peças do recibo; core `blocoCepCanonico`/`blocoModalidadeLogistica` vs `fn_joao_shipping_state` (2ª máquina de estado). Dois renderizadores de frete (#2 `jcRenderShipping` vs `fn_joao_shipping_render_v1`).

### 10. freight-agent-response-gate-v1.5-pure-cep.ts
- **Hook**: `Deno.serve` wrapper (l.82-179) no lado da RESPOSTA HTTP: parseia JSON do handler e lê `payload.resposta`.
- **Banco**: LÊ `agente_noturno_estado`, `vw_canonical_session_state_current_v1`, RPC `fn_joao_shipping_render_v1`; chama `__joaoFreightAdvanceCurrentTurnV1` → dispara as **ESCRITAS** de #9 uma segunda vez no mesmo turno (PROVADO; idempotente por comparação de estado, mas roundtrips duplicados). **ESCRITA**: `sistema_logs`.
- **Efeito**: muta o JSON da resposta HTTP (`freight_phase1`, `respondeu=true`, `resposta=canonicalText`). **Não altera a mensagem ao cliente**: o retorno live do core (l.5343) não tem campo `resposta` e o envio ao WhatsApp já ocorreu antes → `base_was_silent` é sempre true no caminho live (PROVADO por ordem; o chamador não reenvia).

### 11. joao-product-service-shadow-v1.ts
- Importado só por `joao-canonical-live-e2e-preload-v1.ts` l.13-19 (não está em index.ts). Módulo puro: `shadowResolveProductService` (overrides explícitos, família, modo, matriz válida) e `shadowLooksLikeProductServiceClarification`.
- **Uso efetivo**: #2 grava `PRODUCT_CONFIRMED` live quando RESOLVED+HIGH — logo NÃO é shadow puro; log `product_service_shadow_diff`.
- **Conflito**: core l.2235/2265 "ESTAMPARIA em peça do cliente: você NÃO cota… Tamires" vs shadow que trata "tenho as camisetas/aplicar em" como dtf_textil TRANSFER_ONLY e o guard #2 responde "Perfeito, sigo com DTF têxtil para aplicar nas peças." (INFERIDO ambiguidade). Sobrepõe #6 (duas gravações possíveis de PRODUCT_CONFIRMED por turno, com heurísticas diferentes — PROVADO pela ordem das camadas Deno.serve).

---

## Tabela

| arquivo | hook | sempre/condicional | escreve no banco? | altera tools? | bloqueia/reescreve saída? |
|---|---|---|---|---|---|
| joao-dtf-multi-art-dimension-guard-v1.ts | fetch Anthropic (resposta) | condicional (têxtil+multi-arte+largura sem altura) | não | bloqueia tool_use trocando a resposta | sim: JSON fixo (pergunta altura) |
| joao-canonical-live-e2e-preload-v1.ts (+core) | Deno.serve + fetch Z-API/BotConversa/TTS/get_by_phone | sempre; escritas condicionais | SIM: fn_joao_session_state_apply_v1, fn_joao_payment_method_apply_v1, fn_joao_artwork_state_apply_v1, sistema_logs | não | sim: reescreve texto no transporte (7 violações) |
| joao-prompt-core-preload-v1b.ts (+v1.mjs) | fetch Anthropic (requisição) | sempre (hash bate) | não | não | substitui SYSTEM+REGRAS_EXTRA+aprendizados por core de 3.262 chars |
| joao-human-promise-task-guard-v1.ts (+core.mjs) | fetch TTS/Z-API/BotConversa | condicional; 409 p/ body não inspecionável | SIM: RPC create_human_task_safe | não | sim: 409 no TTS; texto reescrito |
| joao-dtf-textile-closed-meter-preload-v1.ts | fetch Anthropic (req+resp) | condicional (têxtil + 57x100 ou "N m") | não | SIM: remove calcular_dtf_por_arte; reescreve tool_use → calcular_dtf_metro | sim |
| joao-canonical-dtf-uv-boundary-preload-v1.ts (+core) | Deno.serve + fetch saídas | sempre (guard base); regras UV se dtf_uv | SIM: PRODUCT_CONFIRMED, sistema_logs | não | sim: hold de preço/pagamento, total canônico |
| joao-dtf-erp-price-authority-v1.ts | fetch REST dtf_precos_faixa / dtf_uv_degraus / rpc fn_precificar_dtf_uv_v2 | sempre | não (lê ERP) | indireto (resultados das tools DTF) | 424 fail-closed nas leituras de preço |
| freight-current-turn-context-preload-v1.1 | Deno.serve (ctx) | sempre | não | não | não |
| freight-agent-runtime-preload-v1.3-pure-cep.ts | fetch calcular-frete + saídas | condicional (frete puro) | SIM: shipping_state_apply, preference_reapply, sistema_logs; chama calcular-frete sozinho | intercepta backend de calcular_frete | sim: render canônico ou safe-text |
| freight-agent-response-gate-v1.5-pure-cep.ts | Deno.serve (resposta HTTP) | condicional | indireto + sistema_logs | não | só o JSON HTTP |
| joao-product-service-shadow-v1.ts | nenhum (importado por e2e) | n/a | via e2e: sim | não | não |
