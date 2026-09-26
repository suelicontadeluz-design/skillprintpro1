# Lote 3 — 21 preloads pinados por SHA, importados ANTES do núcleo (`bug3/v291-v338.ts` linhas 2–22)

Fonte: imports `raw.githubusercontent.com/.../<sha>/patches/...` da edge LIVE (baixados por SHA, `edge/raw/`). Núcleo (C) = `preloads/bug3/candidate-index-v338.ts`. Relatório do subagente de análise, lido integralmente; nenhum arquivo foi modificado.

## Fatos estruturais (PROVADO)
- **Ordem de empilhamento**: cada preload faz `const base = globalThis.fetch.bind(globalThis)` no import e reatribui `globalThis.fetch` → o import mais TARDIO é a camada mais EXTERNA. Para `fetch` saindo do núcleo, dentro deste lote a ordem de passagem é: layout-disambiguation(22) → capability-guard(21) → skill-router(20) → skill-advisor(19) → external-link(18) → freshness(17) → sales-continuity(16) → promise-guard(15) → b2(14) → reengagement(13) → lock-v3(12) → output-guard(11) → gate7c(10) → proposal-receipt(5) → erp-orcamento(4) → color-split(3) → dry-run(2) → fetch nativo. Preloads pós-núcleo ficam ainda mais externos.
- **`Deno.serve`**: a request atravessa dry-run → color-split → **auth** → payment → order → fiscal → sales-continuity → freshness → handler do núcleo (C:5346). Consequência: dry-run e color-split rodam ANTES do 401 de auth (color-split faz 2 leituras no banco em `buildCtx` para qualquer POST cujo `mensagem` case com `resolution()`; dry-run lê `sistema_config` quando `_dry_run===true`).
- Núcleo cria `sb = createClient(...)` sem fetch custom (C:451) → chamadas `sb.rpc/sb.from` passam pelos wrappers deste lote (pré-núcleo). INFERIDO: supabase-js captura a referência de `fetch` no `createClient`, logo preloads PÓS-núcleo podem não interceptar `sb.*` (só `fetch(...)` direto do núcleo).
- **Núcleo NÃO tem autenticação própria** (grep `x-cron-secret|unauthorized|401` = 0) → auth-preload é a única barreira.

---

### 1. dry-run-effect-zero-preload-v1.ts
- **Hook**: `globalThis.fetch` (l.192) + `Deno.serve` (l.269). Só age se `AsyncLocalStorage` tem store dry-run, criado quando body tem `_dry_run===true` E flag ligada (l.276–283). Reconhece: Anthropic/OpenAI (passthrough); POST RPC `fn_emitir_operacao_financeira`, `fn_cortex_proposal_snapshot_v1`, `fn_joao_erp_proposal_receipt_record_v1`; GET `joao_erp_proposal_receipts_v1`, `operacoes_financeiras`; POST `/functions/v1/calcular-frete`; whitelist de RPCs read-only (l.184); GET/HEAD liberado; qualquer outra mutação para SUPABASE_URL/ERP_URL/botconversa/z-api/mercadopago ou host externo → bloqueada. Camada mais interna do lote.
- **Condição**: `_dry_run===true` + `sistema_config.joao_dry_run_effect_zero_v1_ativo` (=true hoje). Produção passthrough.
- **Tools**: intercepta EXECUÇÃO: `fn_emitir_operacao_financeira` vira operação sintética em memória; `calcular-frete` vira cotação Frenet direta read-only (usa `TOKEN_FRENET`, `http://api.frenet.com.br/shipping/quote`) exigindo op de produto sintética com `consumo_m` 0<x≤10, senão 409.
- **Banco**: em dry-run bloqueia toda ESCRITA com 409 `dry_run_effect_zero_write_blocked`. Externo: Frenet.
- **Efeito**: headers `x-cortex-dry-run-effect-zero`, `x-cortex-dry-run-blocked-count`.
- **Decisões (dry-run)**: frete — filtra Correios PAC/Sedex e J&T, CEP origem fixo `06813230`, dimensões fixas 13x30x13/1 kg.
- **Conflito PROVADO**: em dry-run, `erp-orcamento` chama `${ERP}/rest/v1/rpc/fn_cortex_pricing_calculation_v1` → fora da whitelist → 409 → `ERP_PRICING_HTTP_FAIL` → 424. Com a flag ligada, TODA emissão de produto em dry-run falha 424. payment/order/fiscal preloads bloqueados em dry-run → respondem "Não localizei…". Núcleo já tem branch `dryRun` próprio (C:5182, C:2866).

### 2. color-split-request-controller-v1.ts
- **Hook**: `Deno.serve` cria ctx via `buildCtx` e `globalThis.fetch` intercepta Anthropic só com ctx ativo. Pós-processa a resposta HTTP.
- **Injeção**: SUBSTITUI a resposta do modelo: 1ª chamada → resposta sintética `stop_reason:'tool_use'` com `calcular_rendimento_uv{...}` + `calcular_frete{cep_destino}`; após ambos tool_results → JSON de decisão determinístico.
- **Condição**: sem flag. `mensagem` casa `^(quero )?N de cada cor$` ou `^(quero )?N brancos( no total)?$`; `agente_noturno_estado.slots.produto` ~ /dtf uv/; histórico tem inbound ambíguo `N <cor> ou N de cada cor`; ≥2 cores; medida `AxB cm`; `slots.cep` 8 dígitos.
- **Banco**: LÊ `agente_noturno_estado`, `fact_conversations`; ESCRITA PATCH `agente_noturno_estado.slots` (produto='DTF UV', quantidade, cep, envio_retirada='envio', modalidade_logistica='envio', cep_confirmado_para_envio=true) em produção após turno — sobrescreve `salvarEstado` do núcleo.
- **Efeito**: `Fechando em {N} adesivos: DTF UV R$ {amount}. Frete para {cep}: {opções}. Qual você prefere?` com `tema:'frete', etapa:'fechamento', encaminhou_venda:true`.
- **Decisões**: quantidade (N×cores ou N total); preço; frete; modalidade = envio; etapa fechamento; correferência.
- **Duplicidade**: `color-split-ambiguity` / `color-split-resolution-fallback` (pós-núcleo) mesmo tema; SYSTEM C:2201.

### 3. erp-orcamento-preload.ts
- **Hook**: `globalThis.fetch`; POST RPC `fn_emitir_operacao_financeira` e `fn_compor_total`. Executa o RPC nativo primeiro, depois valida.
- **Condição**: SEMPRE. Só `kind` produto|total. `ERP_SERVICE_KEY` ausente → 424 fail-closed.
- **Tools**: intercepta o resultado de todas as tools de cálculo que emitem autorização (via `emitirAutorizacao` C:1264–1277) e `compor_total`; bloqueia com 424 `ERP_CANONICAL_PRODUCT_REQUIRED` → núcleo loga `autorizacao_nao_emitida` e devolve `null` → tool_result sem `financial_authorizations` → gerar_pix impossível.
- **Banco**: LÊ `agente_noturno_estado`, `operacoes_financeiras`. ESCRITA: RPC main `fn_joao_erp_pricing_receipt_record_v1`; ERP `fn_cortex_pricing_calculation_v1` (cálculo); ERP `fn_joao_lancar_orcamento_v1` (ESCRITA no ERP, retry 1x).
- **Decisões**: preço — exige `erp.total_price` == amount ±0,02 senão `ERP_AUTHORIZED_TOTAL_MISMATCH`; mapeia família: orcar_camisetas→apparel, calcular_dtf_por_arte/metro→dtf_textil, calcular_rendimento_uv/uv_metro→dtf_uv; outras tools → 424 provável para `calcular_copo`/`consultar_catalogo` se emitirem produto (INFERIDO).
- **Duplicidade**: proposal-receipt (mesmos 2 RPCs) — dois fail-closed 424 sequenciais.

### 4. proposal-receipt-preload.ts
- **Hook**: mesmos RPCs; camada externa ao erp-orcamento. SEMPRE; kind produto|total; 424 `ERP_CANONICAL_PROPOSAL_REQUIRED` se snapshot ERP não for `ok&&canonical&&system_of_record==='ERP'` ou receipt falhar.
- **Banco**: ERP RPC `fn_cortex_proposal_snapshot_v1`; ESCRITA main RPC `fn_joao_erp_proposal_receipt_record_v1`.
- **Decisões**: proposta — exige proposta ERP existente por operation_id antes de qualquer preço sair.

### 5. auth-preload.ts
- **Hook**: `Deno.serve` wrapper. Autoriza `Bearer <SERVICE_ROLE_KEY>` ou `x-cron-secret` via RPC `fn_edge_cron_auth_ok_v1`. SEMPRE; fail-closed. Efeito: 401. Roda DEPOIS de dry-run e color-split.

### 6. payment-status-preload.ts
- **Hook**: `Deno.serve`. Ignora não-POST, `_sweep`, `_direct_message`, phone<10.
- **Condição**: regex `inFlight` (acabei de pagar|ja paguei|pix caiu|mandei o pix|comprovante…) ou `paymentHistoryIntent` (parcela|vencimento|historico|saldo|quanto falta|em aberto…).
- **Edges/RPC**: `/functions/v1/joao-erp-payment-read`; RPC `fn_joao_pagamento_em_curso_v1`.
- **Efeito**: substitui o turno por `_direct_message` determinístico (o modelo nunca é chamado): `Não encontrei parcelas ou histórico financeiro registrado no ERP para este WhatsApp.`; `O ERP registra N título(s) em aberto, somando R$…`; `Sim. O Córtex registra o PIX de R$… como aprovado…` / `…Ainda não vou marcar como paga sem a confirmação automática.` etc. `_source_tag:'joao_cortex_payment_read_v1'|'joao_erp_payment_read_v1'`.
- **Decisões**: pagamento/Pix — nunca marca como pago sem baixa; classificação de intenção.

### 7. order-status-preload.ts
- **Hook**: `Deno.serve`. Condição: `isOrderIntent` (rastreio|tracking|"como está meu pedido"|status/andamento+pedido|pedido…pronto/enviado/prazo). Edge: `/functions/v1/joao-erp-order-read`.
- **Efeito**: `_direct_message`: `Não localizei um pedido pelo seu WhatsApp no ERP…`, `Encontrei mais de um pedido…`, `Pedido {ref}: o código de rastreio…`, `Pedido {ref}: o ERP registra previsão da OP para dd/mm/aaaa. É uma previsão do sistema, não uma nova garantia.` `_source_tag:'joao_erp_order_read_v1'`.

### 8. fiscal-status-preload.ts
- **Hook**: `Deno.serve`. Condição: `fiscalIntent` (nf-e|nfe|nota fiscal|danfe|xml|chave de acesso); `requestIntent` (quero/emitir/gerar/mandar + nota). Edge `/functions/v1/joao-erp-fiscal-read` com `action:'status'` e, em pedido de emissão, `action:'request'` — ESCRITA indireta no ERP ("Registrei a solicitação fiscal do pedido … no ERP").
- **Efeito**: textos determinísticos (`Pedido {ref}: a NF-e consta autorizada no ERP…` etc.). `_source_tag:'joao_erp_fiscal_v1'`.

### 9. gate7c-preload.ts
- **Hook**: `globalThis.fetch`. Alvos: (a) POST `/rest/v1/prompt_manifesto_joao` (profile `auditoria`) → reencaminha para RPC `fn_log_prompt_manifesto_joao`, responde 201 sintético; (b) qualquer URL contendo `fn_joao_adquirir_lock` → HTTP !ok/exception vira `false` 200; (c) Z-API `send-text` cujo `message` contém payload Pix EMV válido (CRC16, `BR.GOV.BCB.PIX`).
- **Condição**: SEMPRE. Pins fixos: `COGNITION_AGENT_VERSION='agente-noturno-v4.37.4'`, `SOURCE_PIN='5a533d…'` — descasados do núcleo v338/v4.39.0.
- **Banco**: RPCs `fn_gate7c_commercial_bridge_session_for_phone_v1` (L), `fn_gate7c_commercial_bridge_intercept_prepare_v1` (E), `fn_gate7c_commercial_bridge_send_v1` (E fila), `fn_gate7c_commercial_bridge_fence_release_v1` (E), `fn_gate7c_commercial_bridge_reconcile_v1`; edge `/functions/v1/whatsapp-executor`; `fn_log_prompt_manifesto_joao` (E).
- **Efeito**: para lead ARMADO, o envio Z-API do Pix é substituído por execução via fila/executor; devolve JSON 200 `{messageId|id:'cortex-exec:…', bridge:'gate7c_commercial_bridge_v1'}` ou `{bridge_state:'incerto_fail_closed'}` 200 → núcleo registra `incerto`. Fence local 35 min por phone suprime QUALQUER send-text seguinte, inclusive não-Pix.
- **Conflito PROVADO**: lock — núcleo C:481 `if (error) return true` (fail-open); gate7c converte erro em `false` → `skip:'lock_ocupado'` → muda fail-open para fail-closed. lock-v3 intercepta a mesma URL.

### 10. output-guard-v3-human-takeover.ts
- **Hook**: `globalThis.fetch`. Alvos: `get_by_phone` (observa sid→phone); Z-API `send-{tipo}`; BotConversa `send_message`; `/functions/v1/joao-tts`. Só texto.
- **Condição**: SEMPRE. Fail-CLOSED: phone indisponível → 503; exceção/timeout de RPC (2,5 s) → 503 `output_guard_unavailable`.
- **Banco**: RPCs `fn_joao_human_takeover_output_guard_v1` (480 min), `fn_saida_freight_completeness_detectar_v1`, `fn_joao_freight_latest_by_phone_v1`, `fn_saida_guarda_registrar` (E); `sistema_logs` (E); `lead_identificadores` (L).
- **Efeito**: bloqueia envio com 409 `human_takeover_active`, 422 `output_guard_blocked`, 503; REESCREVE texto acrescentando `\n\nPrazos desta cotação: {serviço}: {prazo} | …` quando cita R$ + PAC/SEDEX/J&T e o detector marca faltante.
- **Duplicidade**: núcleo já bloqueia por `agentePausado` (C:2889) e `humanoAtivoRecente||humanoNegociou` (C:3028) ANTES do modelo; este repete no transporte com outro RPC. Frete: núcleo C:4224 retry cobre o mesmo defeito via modelo.

### 11. lock-v3-preload.ts
- **Hook**: `globalThis.fetch`. POST RPC `fn_joao_adquirir_lock` sem `_v3` → chama `fn_joao_adquirir_lock_v3{p_phone}`, guarda token em `Map`; responde `true/false`. DELETE `/rest/v1/agente_noturno_lock?phone=eq.X` (núcleo C:483) → `fn_joao_liberar_lock_v3{p_phone,p_owner_token}` e responde 204 sintético. **O DELETE original NUNCA chega ao banco.**
- **Conflito**: gate7c intercepta a mesma URL. Token em memória do isolate: se o isolate reiniciar entre adquirir e liberar, não há liberação → lock preso até TTL do v3 (TTL NÃO ENCONTRADO). Núcleo comenta v2 em C:135 mas chama a v1 (C:481).

### 12. reengagement-preload.ts
- **Hook**: `globalThis.fetch` — wrapper NO-OP puro (l.1–2). Só uma camada de indireção. PROVADO.

### 13. b2-preload.ts
- **Hook**: `globalThis.fetch`. RPC `fn_consumir_operacao_financeira` (observa) e `/rest/v1/orcamentos` (reescreve body do INSERT). Só age quando a linha tem `metros===0` ou `preco_por_metro===0` — exatamente o insert hardcoded do núcleo em `gerar_pix` C:2118–2121.
- **Banco**: LÊ `operacoes_financeiras`; ESCRITA alterada em `orcamentos` (metros/preco_por_metro → null ou valor semântico das tools de metro).
- **Efeito**: nenhum ao cliente (registro contábil).

### 14. promise-guard-preload.ts
- **Hook**: `globalThis.fetch`; Z-API `send-text`, BotConversa `send_message` text, `joao-tts`.
- **Condição**: SEMPRE; texto sem `R$` e com `(vou|irei|já vou|deixa eu)…(calcular|cotar|orçar|fazer orçamento)`.
- **Banco**: LÊ `fact_conversations` (lead por sufixo de 8 dígitos), `operacoes_financeiras` ativas dos últimos 60 s.
- **Efeito**: substitui por `*João Barros:*\nPronto, calculei:\n{N adesivos: *R$ X*|…}` ou fallback de pergunta: camiseta → "…tamanho aproximado de cada estampa: pequena, A4, A3 ou maior?"; frete → "…me confirma o CEP de entrega."; uv → "…medidas do adesivo e a quantidade."; genérico → "…medidas da arte e a quantidade.". Insere assinatura (INFERIDO duplica assinatura já concatenada em C:2412).
- **Conflito PROVADO**: fallback camiseta pede TAMANHO da estampa — contradiz REGRAS_EXTRA "CLASSIFICACAO INTERNA DA ESTAMPA: NUNCA peca ao cliente medidas… nem se e pequena ou grande" (C:2254). Fallback "me confirma o CEP" contradiz "MODALIDADE LOGISTICA ANTES DO CEP" (INFERIDO). Núcleo `RX_PROMETE` C:4190 já re-prompta para o mesmo caso.

### 15. sales-continuity-preload.ts
- **Hook**: `Deno.serve` + `globalThis.fetch` (POST `calcular-frete`; `get_by_phone`; transportes de texto).
- **Injeção**: reescreve o **tool_result** de calcular_frete quando `ok!==true`: adiciona `acao:'A cotacao automatica nao retornou uma opcao para este CEP agora. NAO conclua que o CEP e invalido… NAO ofereca retirada/motoboy… Ofereca tentar OUTRO CEP… ou encaminhar…'` e `nao_inferir:[…]` (~330 chars).
- **Condição**: SEMPRE. Serve: se `mensagem` é resposta explícita de envio e houve outbound nos últimos 30 min perguntando retirada×envio → RPC fix de estado. Em toda cotação com CEP, acha o phone varrendo os últimos 100 inbounds de 1 h que contenham o CEP e fixa estado como envio+cep.
- **Banco**: LÊ `agente_noturno_estado`, `fact_conversations`; ESCRITA RPC `fn_joao_logistica_estado_fix_v1`.
- **Efeito**: (a) diagnóstico de frete inseguro ou promessa "volto em X minutos" → `*João Barros:*\nA cotação automática não retornou uma opção para esse CEP agora…`; (b) estado=envio e texto oferece retirada/motoboy → remove frases e anexa `Fica envio mesmo…`; (c) claim absoluto de durabilidade UV → texto fixo; (d) slot dtf/uv e texto "7 a 10 dias úteis" → substitui por prazo UV.
- **Conflito**: SYSTEM C:2244–2245 prazos × (d) reescreve por slot, não pela mensagem → se slot é adesivo e cliente pergunta camiseta, prazo vira UV (INFERIDO). "a fala nova dele vence o historico" × (b) força "Fica envio mesmo" pelo estado salvo (INFERIDO). Phone por CEP pode acertar outro lead (INFERIDO).

### 16. freshness-preload.ts
- **Hook**: `Deno.serve` captura o inbound mais novo (`fact_conversations` inbound source=zapi) e só arma ALS se o texto bater com `body.mensagem`; `globalThis.fetch` nos 3 transportes de texto.
- **Condição**: SEMPRE; ignora `_sweep` e `_direct_message`; fail-open.
- **Banco**: LÊ `fact_conversations`; ESCRITA `error_log` (`stale_turn_outbound_suppressed`).
- **Efeito**: se existe inbound mais novo → NÃO envia e devolve 200 sintético `{ok:true,success:true,messageId:'stale-turn-suppressed',stale_suppressed:true}`.
- **Conflito PROVADO**: núcleo já tem "BARREIRA FINAL DE FRESCOR" (C:5287–5300) que suprime SEM carimbar e registra `superseded`; este preload devolve sucesso falso → núcleo registra envio `aceito_provider` com messageId fictício e carimba o inbound como atendido. Fontes diferentes (núcleo: `inbound_fora_horario`; preload: `fact_conversations` zapi).

### 17. external-link-intake-preload-v3.ts
- **Hook**: `globalThis.fetch` em Anthropic. Camada interna a skill-advisor.
- **Injeção**: `system +=` `[CORTEX GOOGLE DRIVE PUBLIC v3] … [/CORTEX GOOGLE DRIVE PUBLIC]` (≈700 chars + JSON) e `[CORTEX EXTERNAL LINK INTAKE v3 links=…] … [/CORTEX EXTERNAL LINK INTAKE]` (≈1.400 chars). ANEXA blocos `image` base64 (até 4, ≤4 MB cada) na última mensagem de usuário.
- **Condição**: `sistema_config.joao_external_link_intake_ativo` (=true hoje). Só quando a rajada atual contém URL http(s), máx. 4.
- **Tools**: ADICIONA `{type:'web_fetch_20250910', name:'web_fetch', max_uses≤4, max_content_tokens:4000}` — tool server-side inexistente no núcleo.
- **Banco/externo**: `sistema_logs` (E); `drive.google.com/drive/folders/{id}`, `drive.usercontent.google.com/download`; o modelo pode buscar qualquer URL via web_fetch.
- **Decisões**: arte/upload (link não confirma medida/fundo/resolução/preço/frete/pagamento); classificação de provedor; multi-item.
- **Duplicidade**: SYSTEM C:2207 "VOCÊ ENXERGA IMAGENS" × preload "NÃO diga que viu" se `public_access=false` (tensão PROVADA). `direct-file-intake-preload-v1` (pós-núcleo) tema sobreposto.

### 18. skill-advisor-preload.ts
- **Hook**: `globalThis.fetch` em Anthropic.
- **Injeção**: `system += "\n\n[CORTEX SKILL ADVISOR v1]\n" + "SKILL qualification=<status>. …" e/ou "SKILL closing=<estado>. …" + rodapé "Estas skills são ADVISOR: não concedem autoridade externa…"`. Textos fixos por status, 200–330 chars cada.
- **Condição**: `sistema_config.joao_skill_advisor_ativo` (=true hoje). Requer inbound de cliente. Só injeta se houver guidance.
- **Banco**: RPC `fn_qualification_evaluate_v2{p_snapshot,p_as_of}`. Sem escrita.
- **Decisões**: qualificação (extrai quantidade/cep/envio_retirada da resposta curta ao `[VOCÊ ACABOU DE PERGUNTAR:` e do `[FICHA: … slots=`); "COTE AGORA" quando QUALIFIED_FOR_QUOTE_SHADOW; fechamento/Pix.
- **"Skill" real?** NÃO. Sem descoberta, manifesto, tabela de skills ou progressive disclosure: texto fixo condicionado ao status devolvido por `fn_qualification_evaluate_v2`.
- **Duplicidade PROVADA**: closing × SYSTEM C:2199 "PROIBIDO escrever 'vou gerar o Pix'…", REGRAS_EXTRA "PROMESSA DE PIX (v4.21.1)" e retries do núcleo C:4282–4309; HOLD_MISSING_CEP × SYSTEM C:2216–2218 "CEP NÃO É SLOT UNIVERSAL… RESOLVA A MODALIDADE ANTES DO CEP"; QUALIFIED "não faça nova sondagem" × C:2213. Skill-router faz a MESMA chamada RPC → 2 chamadas por turno quando ambas ligadas.

### 19. skill-router-preload.ts
- **Hook**: `globalThis.fetch` em Anthropic; camada EXTERNA ao skill-advisor.
- **Condição**: `sistema_config.joao_skill_router_ativo` (**=false hoje**, "retired-from-production 09/09"). Só quando `fn_qualification_evaluate_v2` devolve `HOLD_MISSING_QUANTITY` ou `HOLD_MISSING_CEP_FOR_SHIPPING` E inbound não é pergunta direta nem intenção de fechar.
- **Efeito**: SUBSTITUI a chamada ao modelo por resposta sintética (`Quantas peças você precisa?` / `Quantas cópias dessa arte você precisa?` / `Quantos adesivos você precisa?` / `Me passa o CEP de entrega…`).
- **"Skill" real?** NÃO — texto fixo + RPC de qualificação.
- **Conflito**: REGRAS_EXTRA "DOIS PERFIS… PROIBIDO responder pergunta de preco com pergunta" e "UMA PALAVRA: 'Valor' = MANDE O NUMERO AGORA" × router pergunta quantidade quando `srDirect` não casa ("valor", "tabela", "preço" NÃO estão no regex) — INFERIDO. Sobrepõe `qualification-gate-preload-v1.6` (pós-núcleo).

### 20. capability-guard-preload-v1.1.ts
- **Hook**: `globalThis.fetch` em Anthropic; camada externa a skill-router.
- **Injeção**: `system += "[SKILL: DISCOVERY / production_capability_validation_v1.1 — REGRA OBRIGATORIA] … [/SKILL]"` (≈480 chars) quando há imagem recente com prova localizada/pergunta pendente. OU substitui a chamada por resposta sintética.
- **Condição**: `sistema_config.joao_capability_guard_ativo` (=true hoje). Bloqueio determinístico se pedido REAL de sublimação total/silk/bordado → mensagem fixa; ou pergunta pendente de técnica sem prova; ou imagem ≤4 turnos + "consegue fazer igual" sem cobertura + (pergunta visual ou avanço comercial: pix|cartao|frete|cep|valor|quanto|prazo…) → pergunta. Bypass em contexto caneca/copo/adesivo/dtf uv.
- **Banco**: `sistema_logs` (E).
- **Efeito**: textos fixos: `Esse tipo de personalização é sublimação total e nós não fazemos essa técnica…` / `Silk/serigrafia nós não fazemos…` / `Bordado nós não fazemos…`; pergunta `Só pra eu confirmar a técnica antes de orçar: essa arte é uma estampa localizada na frente/costas ou é impressão total…?`. `slots:{}`.
- **"Skill" real?** NÃO — `skill_ref:'discovery'`/`strategy_key` são rótulos em `sistema_logs`.
- **Duplicidade PROVADA**: SYSTEM C:2237 "NÃO FAZEMOS: silk, serigrafia, sublimação, bordado" + `REGEX_INVENCAO` C:401. Conflito: bloqueia quando cliente diz "valor/quanto" × C:2213 ANTI-ENROLAÇÃO (INFERIDO).

### 21. layout-disambiguation-preload.ts
- **Hook**: `globalThis.fetch` em Anthropic; camada MAIS EXTERNA do lote.
- **Injeção**: `system += "[SKILL: DISCOVERY / partial_order_change_disambiguation_v1 — REGRA OBRIGATORIA] … [/SKILL]"` (≈900 chars) OU resposta sintética.
- **Condição**: `sistema_config.joao_layout_disambiguation_ativo` (=true hoje). Bloqueia quando inbound casa posição (manga|manda|frente|costas|gola|nuca|lateral) + partícula parcial e não há resolução, ou quando a última mensagem do assistente foi a pergunta pendente e a resposta não resolve.
- **Banco**: `sistema_logs` (E).
- **Efeito**: perguntas fixas: `Perfeito. Só pra confirmar antes de calcular: você quer estampar somente a manga, ou também vai ter estampa na frente e/ou nas costas?` (variações; retry `Só pra eu não errar o orçamento: …`); slots = FICHA atual.
- **"Skill" real?** NÃO.
- **Duplicidade**: REGRAS_EXTRA "CORRECAO PARCIAL DA GRADE" e "MEMORIA DA GRADE" já impõem delta. Regex `manda` como sinônimo de manga pode casar "manda o pix"/"manda a tabela" + partícula → bloqueio indevido (INFERIDO; condição PROVADA).

---

## Tabela-resumo

| arquivo | hook | sempre/condicional | escreve no banco? | altera tools? | bloqueia/reescreve saída? |
|---|---|---|---|---|---|
| dry-run-effect-zero-preload-v1 | fetch (RPCs financeiros, calcular-frete, mutações) + Deno.serve | condicional: `_dry_run` + flag (on) | não (bloqueia escritas; chama Frenet) | intercepta execução | 409 em mutações; headers |
| color-split-request-controller-v1 | Deno.serve + fetch Anthropic | condicional (regex + estado DTF UV + histórico + medida + CEP) | SIM: PATCH `agente_noturno_estado` | força tool_use rendimento_uv+frete | substitui resposta do modelo; reescreve JSON HTTP |
| erp-orcamento-preload | fetch RPC emitir/compor_total | sempre (produto/total) | SIM: receipt main; ERP lancar_orcamento | intercepta resultado das tools de cálculo | 424 fail-closed |
| proposal-receipt-preload | fetch RPC emitir/compor_total | sempre | SIM: proposal receipt main | idem | 424 fail-closed |
| auth-preload | Deno.serve | sempre | não | não | 401 |
| payment-status-preload | Deno.serve | condicional (regex pagamento) | não direto (edge read + RPC) | modelo não chamado | `_direct_message` determinístico |
| order-status-preload | Deno.serve | condicional (regex pedido/rastreio) | não (edge read) | não | idem |
| fiscal-status-preload | Deno.serve | condicional (regex NF-e) | indireto: `action:'request'` registra solicitação no ERP | não | idem |
| gate7c-preload | fetch (prompt_manifesto, adquirir_lock, send-text com Pix) | sempre | SIM: RPCs gate7c, fn_log_prompt_manifesto_joao; edge whatsapp-executor | não | substitui envio Z-API; fence 35 min; lock fail-closed |
| output-guard-v3-human-takeover | fetch (z-api, botconversa, joao-tts, get_by_phone) | sempre | SIM: `sistema_logs`, fn_saida_guarda_registrar | não | 409/422/503; anexa "Prazos desta cotação" |
| lock-v3-preload | fetch (adquirir_lock, DELETE lock) | sempre | SIM: lock v3 adquirir/liberar | não | não |
| reengagement-preload | fetch no-op | — | não | não | não |
| b2-preload | fetch (consumir_operacao, INSERT orcamentos) | sempre (metros/preco=0) | SIM: altera INSERT `orcamentos` | não | não |
| promise-guard-preload | fetch transportes de texto | condicional (promessa sem R$) | não | não | reescreve texto final |
| sales-continuity-preload | Deno.serve + fetch (calcular-frete, transportes) | sempre / regex | SIM: fn_joao_logistica_estado_fix_v1 | reescreve tool_result de calcular_frete | reescreve texto final (4 casos) |
| freshness-preload | Deno.serve + fetch transportes | condicional | SIM: `error_log` | não | suprime envio com 200 sintético |
| external-link-intake-preload-v3 | fetch Anthropic | condicional: flag (on) + URL | SIM: `sistema_logs` | ADICIONA `web_fetch`; anexa imagens | não |
| skill-advisor-preload | fetch Anthropic | condicional: flag (on) + guidance | não | não | não (injeta system) |
| skill-router-preload | fetch Anthropic | condicional: flag (**off**) | SIM: `sistema_logs` | modelo não chamado | substitui resposta |
| capability-guard-preload-v1.1 | fetch Anthropic | condicional: flag (on) + regex | SIM: `sistema_logs` | não | substitui resposta ou injeta system |
| layout-disambiguation-preload | fetch Anthropic | condicional: flag (on) + regex | SIM: `sistema_logs` | não | substitui resposta ou injeta system |

## Achados transversais
1. 5 preloads dependem de flags `sistema_config` (advisor on, router **off**, capability on, layout on, external-link on). Nenhum é "skill" com descoberta/manifesto; `skill_ref:'discovery'` é rótulo em `sistema_logs`.
2. 3 preloads substituem a resposta do modelo por JSON determinístico (skill-router, capability-guard, layout) e 1 (color-split) força tool_use + resposta final; camadas externas decidem antes das internas.
3. erp-orcamento + proposal-receipt tornam TODA emissão de produto/total dependente de ERP (2 RPCs ERP + 2 receipts) e fail-closed 424 sem `ERP_SERVICE_KEY`; em dry-run com effect-zero ligado o pricing ERP é bloqueado → 424 sistemático.
4. freshness devolve sucesso sintético — colide com a barreira de frescor do núcleo (C:5287–5300).
5. lock passa de fail-open (C:481) a fail-closed via gate7c/lock-v3; DELETE do lock nunca chega ao banco.
6. auth (401) roda depois de dry-run e color-split no pipeline de `Deno.serve`.
7. Duplicidades prompt × preload com evidência: promise-guard × C:4190/C:2199; skill-advisor × C:2199 e C:4282–4309; capability-guard × C:2237/C:401; sales-continuity × C:2244–2245; skill-advisor × C:2216–2218; promise-guard × "CLASSIFICACAO INTERNA DA ESTAMPA".
8. Segredos: apenas env. Um project-ref do ERP está hardcoded como default de ERP_URL.
