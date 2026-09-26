# Lote 4 — 25 preloads pinados por SHA, importados DEPOIS do núcleo (v291 24–39, v292.1, v294, stack v299)

Fonte: imports pinados da edge LIVE (`edge/raw/`). Relatório do subagente de análise, lido integralmente; nenhum arquivo foi modificado.


Fontes: `/tmp/claude-0/-home-user-skillprintpro1/a1334adc-5089-5cad-a537-a454c7d7b1a0/scratchpad/edge/raw/<sha8>__patches__…` (todos lidos integralmente) e núcleo `…/scratchpad/edge/agente-noturno/preloads__bug3__candidate-index-v338.ts` (SYSTEM L2187, REGRAS_EXTRA L2254, systemFinal L3226, fetch Anthropic L3335, TOOLS L1247-1259, Deno.serve L5346). Dependências importadas pelos preloads (`file-state-core.ts`, `preflight-context-core.ts`, `artwork-context-preload.ts` v1) lidas da cópia local `/home/user/skillprintpro1/patches/...` (pinadas nos shas 62415fa5/fe7c9b03 — INFERIDO que a cópia local é igual; git não foi tocado).

## Ordem real de instalação (PROVADO pelos wrappers)
- Núcleo usa `fetch(` global em tempo de chamada (L3335) e `createClient(URL,KEY)` sem fetch custom (L451) → todos os `globalThis.fetch=` valem para a chamada Anthropic e (INFERIDO, supabase-js resolve `fetch` global tardiamente) para `sb.rpc('fn_emitir_operacao_financeira')` (L1269).
- Semântica: o último wrapper instalado é o mais EXTERNO (vê o request primeiro, a resposta por último). Cadeia (do mais interno ao mais externo), só os do lote:
  `[index.ts imports 1-11 / pricing-current-turn-preflight (v299:5) / gate-v5 (v299:6, só Deno.serve) / freight-agent…]` → `[v291:2-22 pré-núcleo]` → NÚCLEO (v291:23) → qualification-gate (v291:24) → closing-gate (25) → artwork-current-turn v1.1 (26) → artwork-context v1 (via import de 27) → artwork-context v2-preflight (27) → repeat-order-history (28) → orchestrator v1.4 (via import de 29) → orchestrator v1.5 (29) → direct-file-intake (30) → freight-comparison (31) → order-grade (32) → psd v3 (33) → psd v4 (34) → psd v5 (35) → freight-choice-context (36) → uv-op-idempotency (37) → color-split-ambiguity (38) → color-split-fallback (39) → freight-positive-output (v292.1:4) → uv-explicit-sheet (v294:5) → freight-checkout v2 (v294:6) → freight-checkout-output-clarify (v294:7) → pricing-financial-postload (v299:13) → halftone-router (v299:14) → halftone-phone-resolver (v299:15, MAIS EXTERNO).
- Consequência: `[CORTEX JOURNEY…]` do orchestrator v1.4 (L222) já está no `system` quando qualification/closing gates rodam (são internos). Curto-circuitos (qualification, psd v3/v4/v5, fcc, fc2, halftone) impedem que camadas internas e o modelo vejam o turno. Todos os curto-circuitos escolhem o último `user` que NÃO começa com `[SISTEMA:` → um retry-nudge do núcleo (`chamarCerebro(nudge)` L3331-3333) recebe a MESMA resposta sintética (INFERIDO: loop/bloqueio de guardrails do núcleo).

---

### 1. qualification-gate-preload-v1.6.ts (1ffd7471)
- **Hook**: `globalThis.fetch` em `^https://api.anthropic.com/v1/messages` (L299-301). Pós-núcleo (v291:24), o mais interno do lote pós-núcleo.
- **Injeção no prompt**: nenhuma. Substitui a chamada por resposta sintética Anthropic (`model:'cortex-qualification-gate'`, header `x-cortex-qualification-gate`, L285-287).
- **Condição**: flag `sistema_config.joao_qualification_gate_ativo` (L35), cache 15s; default `false`, erro→`false` (fail-closed = gate desligado). Lê `[CORTEX JOURNEY v1 stage=` (L61-64; produtor: orchestrator v1.4 L222), `[FICHA: … slots=` (L182-183; produtor núcleo L3219) e `invalidations=` (L184; produtor NÃO ENCONTRADO no núcleo nem no lote), `[VOCÊ ACABOU DE PERGUNTAR:` (L84-88; núcleo L3164). Pula em CLOSING/WAITING (L309-312). Chama RPC `fn_qualification_evaluate_v2` (L235-243) com snapshot; em LOGISTICS suprime holds de produto/quantidade (L318-321). Enforce só se `qgShouldEnforce` (L261-273): não é turno não-comercial (regex L244-249: rejeição, suporte, histórico, "como funciona"), não é pergunta de preço de tabela sem quantidade (L250-254, 265), há intenção comercial (L255-260).
- **Tools**: não altera definição; ao enforçar, o modelo não roda (nenhuma tool possível).
- **Banco**: lê `sistema_config`, RPC `fn_qualification_evaluate_v2`; ESCRITA `sistema_logs` (L289-297, funcao `qualification-production-gate`, categoria `skill_runtime`).
- **Efeito na resposta**: texto determinístico (L274-284): "Só pra eu não misturar com o pedido anterior: qual produto você quer orçar agora?", "Qual produto você quer orçar?", "Quantas peças você precisa?" / "Quantas cópias dessa arte você precisa?" / "Quantos adesivos você precisa?" / "Qual quantidade você precisa?", "Me passa o CEP de entrega que eu calculo as opções de frete." (tema `frete`, etapa `orcamento`, sem slots — L282).
- **Decisões comerciais**: classifica família de produto (L112-134); recupera produto/quantidade de mensagens antigas (L135-164); troca de produto apaga quantidade/cep/envio (L197); parse de CEP (L171-180); modalidade (L165-170); multi-quantidade vira quantidade=1 na avaliação (L232); pergunta de preço por metro/A3/A4 não exige quantidade (L265); pergunta de CEP se houver palavra logística no turno (L266-269); precedência CLOSING>WAITING>LOGISTICS>QUALIFICATION.
- **Skill real?** Não: regex + texto fixo em código + RPC avaliadora no banco; sem manifesto/descoberta. `skill_ref:'qualification'` só no log. Flag: `joao_qualification_gate_ativo` (reutilizada por psd v3/v4/v5).
- **Duplicidade/conflito**: núcleo "SLOTS: produto -> arte -> quantidade -> MODALIDADE… UMA pergunta por mensagem" (L2222-2224) vs perguntas forçadas L276-282; núcleo "QUEM PERGUNTA O VALOR DO METRO… MANDE A TABELA NA HORA" (L2266) vs L265 (mesma regra, duplicada); núcleo "RESOLVA A MODALIDADE ANTES DO CEP" (L2225) + `blocoModalidadeLogistica` "PROIBIDO pedir CEP" (L852-857) vs L282 pedir CEP com stage UNKNOWN/QUALIFICATION quando inbound cita "correio/envio" (L267) — depende da RPC não devolver HOLD_MISSING_CEP em retirada (RPC fora de escopo); regex de família duplica artwork v1.1 L61-76 e orchestrator.
- **Segredos**: usa env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 2. closing-gate-preload-v1.3.ts (abb5b0d2)
- **Hook**: fetch Anthropic (L40-41). v291:25.
- **Injeção**: anexa ao `system` `[SKILL closing/v1 — PRODUCTION GATE]\n{texto}\nA skill pode bloquear avanço cognitivo, mas NÃO cria cobrança…[/SKILL]` (L38, ~170 chars de moldura) com um de 6 textos (~200-300 chars cada): PAUSED-DEFER (L52), NOT AUTHORIZED-DECLINE (L53), BLOCKED tool falhou (L57), BLOCKED pelo evaluator (L66), READY tool_result canônico (L69), INTENT explícito (L73), CONTINUATION (L76).
- **Condição**: flag `joao_closing_gate_ativo` default false, erro→false (fail-closed off). Só se stage==CLOSING ou marcador ausente (L43). Branches por ordem: pausa (regex L22-29) > `"ok":false`+pix em tool_result do turno (L47) > `"ok":true`+pix_copia_e_cola/qr_code/checkout_url/payment_id (L48) → RPC `fn_joao_explicit_close_signal_v2` (L30) + `fn_closing_evaluate_v1` (L36, L63) > intenção lexical (L21) > continuação.
- **Tools**: nenhuma; lê `tool_result` do turno (L20).
- **Banco**: lê `sistema_config`, RPCs acima; ESCRITA `sistema_logs` (L37).
- **Efeito**: só prompt; não reescreve saída.
- **Decisões**: Pix/pagamento (pausar, negar, proibir "vou gerar", enviar só o Pix exato da tool), fechamento (não reabrir produto/qtd/frete), objeção de pagamento.
- **Skill real?** Não: texto fixo + regex + RPC avaliadora. Flag acima.
- **Duplicidade**: núcleo "EXECUTE, NÃO PROMETA… vou gerar o Pix" (L2199) e "PROMESSA DE PIX (v4.21.1)" (L2270) vs L73; núcleo "Se existe cobrança enviada, NÃO gere outra" (L2203) e "ja_existe: NÃO gere outro" (L2236) vs L52; núcleo "Erro -> NAO improvise cobranca" (L2239) vs L57; núcleo já tem nudge próprio "[SISTEMA: o Pix foi prometido e nao foi gerado" (L4282-4306). Regex DEFER (L24) duplica `joWaitingIntent` do orchestrator (v1.4 L76): "não gera o pix agora" cai em CLOSING (joCloseIntent L66 `o pix`) antes de WAITING (L118<L119), então DEFER é alcançável; frases sem "pix" viram WAITING e o closing-gate sai em L43.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 3. artwork-current-turn-preload-v1.1.ts (fe7c9b03)
- **Hook**: fetch Anthropic, pré (system) e pós (reescreve decisão) (L137-189). v291:26. O comentário L4 diz que roda "dentro do wrapper base v1", mas na v291 o v1 só é importado depois (via v2-preflight L14) → v1 ENVOLVE v1.1 (v1.1 é interno). PROVADO pela ordem.
- **Injeção**: `[CORTEX ARTWORK CURRENT TURN v1 product=… precedence=CURRENT_EXPLICIT>CONFIRMED_SLOTS>HISTORICAL_ARTWORK]` (~430 chars, L154) quando produto atual incompatível com anterior; senão `[CORTEX ARTWORK SCOPE v1]` (~330 chars, L156) quando o system já tem `[CORTEX ARTWORK CONTEXT` (produtor: artwork-context-preload v1 L271) e o turno não fala de arte (regex L151; `[ARTE_PROCESSADA_CORTEX]` produtor NÃO ENCONTRADO).
- **Condição**: flag `joao_artwork_context_guard_ativo` (compartilhada com v1 e v2), default false, erro→false. Produto por regex (L61-76), anterior por texto ou `[FICHA: slots=` (L90-112), matriz de compatibilidade (L99-105).
- **Tools**: nenhuma.
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L127-135).
- **Efeito**: pós-processamento só quando `content` tem 1 bloco texto (L167): força `slots.produto` (L173); se a resposta cita DTF UV/adesivo em turno de vestuário (L119-126) SUBSTITUI a mensagem por "Entendi: agora você está falando de X. Vou considerar este produto atual e ignorar o produto/técnica anterior. Vou usar somente os dados já confirmados para ele." (L176); senão prefixa "Entendi: …" (L178); no modo SCOPE prefixa "Certo, " em perguntas (L181). Header `x-cortex-artwork-current-turn`.
- **Decisões**: correferência/troca de produto; DTF UV vs camiseta; medidas A3/A4 antigas não migram; "Imagem/arquivo nunca troca produto sozinho".
- **Duplicidade**: núcleo "SIGA O CLIENTE… outro produto" (L2189), "MUDANCA DE ASSUNTO" (L2257), `blocoMudouProduto` (systemFinal L3229), "NUNCA MISTURE AS TABELAS" (L2262) vs L154/L119-126; núcleo ESTILO "PROIBIDO abrir toda mensagem com muleta" e `aberturaCorreta` (L3638) vs prefixos "Entendi:/Certo," (L178,181).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 4. artwork-context-preload-v2-preflight.ts (62415fa5)
- **Hook**: fetch Anthropic (L145-164). Importa v1 (`../joao-artwork-context-20260909/artwork-context-preload.ts`, L14) e `./preflight-context-core.ts` (L15). v291:27 (v2 externo ao v1).
- **Injeção**: bloco `[DTF_FILE_PREFLIGHT_CANONICO]…[/DTF_FILE_PREFLIGHT_CANONICO]` (preflight-context-core L87; ~400 chars fixos + 1 linha por arquivo: nome, cópias, status, medidas cm, metros, fundo, resolução, quote_ready, print_ready, motivo).
- **Condição**: mesma flag `joao_artwork_context_guard_ativo` (L48), default false. Telefone extraído do system/últimos 24 textos por regex `55\d{10,11}`, excluindo hardcoded `5511992769857` (L68-82); `arte_uploads` do phone nas últimas 24h com `arquivos[]` (L93-118). Sem gatilho semântico → injeta em TODO turno enquanto houver upload recente.
- **Tools**: nenhuma.
- **Banco**: lê `sistema_config`, `arte_uploads`; ESCRITA `sistema_logs` (L120-143).
- **Efeito**: só prompt.
- **Decisões**: arte/medidas/metragem: "Se quote_ready=true, nao pergunte tamanho de cada arte"; "print_ready=false explique a pendencia"; "preco… pertence ao motor".
- **Duplicidade**: núcleo já injeta `[ARQUIVOS REAIS DESTE LEAD…]` (L1217) e regra "VOCÊ LÊ ARQUIVOS… diferencie arte solta de arquivo montado" (L2209); v1 injeta `[CORTEX ARTWORK CONTEXT — REGRA OBRIGATORIA]` (v1 L271) com a mesma ideia; direct-file-intake injeta um 3º bloco de arquivos → até 4 blocos de arquivo no mesmo prompt.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 5. repeat-order-history-preload-v1.ts (73858086)
- **Hook**: fetch Anthropic (L128-151). v291:28.
- **Injeção**: `[CORTEX PEDIDO ANTERIOR v1 status=…]` 3 variantes: venda comprovada (L107, ~650 chars + fatos ≤6500), só proposta (L111, ~300 + ≤5000), não materializado (L114, ~700).
- **Condição**: flag `joao_repeat_order_history_ativo` (L46); default false; HTTP !ok ou exceção mantém valor anterior (L49,52) → fail-closed no início, "pegajoso" depois. Intenção forte por regex (L55-66) ou continuação "mesma coisa/igual/puxar pelo" após contexto de histórico (L67-80). RPC `fn_joao_repeat_order_context_by_inbound_v1(p_inbound, p_window_minutes=30)` (L81-90) — identidade resolvida pelo texto no banco; INBOUND_AMBIGUOUS/NOT_RESOLVED → passthrough (L139-142).
- **Tools**: nenhuma.
- **Banco**: lê `sistema_config`, RPC acima; ESCRITA `sistema_logs` (L118-126, com `lead_id`).
- **Efeito**: só prompt.
- **Decisões**: repetição de pedido como baseline; "PREÇO antigo NÃO é preço atual: recalcule no ERP"; "Frete/CEP antigo não autorizam frete atual"; não inventar layout; no máximo UMA pergunta.
- **Duplicidade**: núcleo "HISTORICO DE RETIRADA OU MOTOBOY… nao para decidir" (L2268), "NAO REPERGUNTE O QUE JA FOI RESPONDIDO" (L2269); qualification-gate `qgNonQuoteTurn` já reconhece "histórico|pedido passado|puxar pelo|consegue confirmar pra mim" (qual L247) — mesmos gatilhos em dois lugares.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 6. orchestrator-preload-v1.5.ts (e161b346) + orchestrator-preload-v1.4.ts (cae1a089)
**v1.4** (importado por v1.5 L6, interno):
- **Hook**: fetch Anthropic (L212-246).
- **Injeção**: SEMPRE (com flag on): `[CORTEX JOURNEY v1 stage=X precedence=CLOSING>WAITING>LOGISTICS>QUALIFICATION source=Y]` (~260 chars, L222); condicionais: `[CORTEX CONTINUIDADE v1 confirmed_slots=…]` (~420, L163, quando FICHA tem slots), `[CORTEX ESPERA v1]` (~330, L167, WAITING), `[CORTEX PERGUNTA ATUAL v1]` (~380, L171, pergunta sobre fornecedor).
- **Condição**: flag `joao_skill_orchestrator_ativo` (L33) — default **`true`** (L15), !ok/exceção mantém → FAIL-OPEN. Classificação L114-126 (regex L60-113).
- **Cache/dedupe**: chave modelo+stage+inbound+pergunta anterior+fingerprint de `[SISTEMA:`+últimos 3 tool_results (L196-200), TTL 2200 ms (L13); chamada duplicada não-stream recebe a resposta cacheada sem ir ao modelo (L226-232).
- **Tools**: nenhuma.
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` a CADA chamada ao modelo (`journey_stage_resolved`, L244) e em dedupe (L229).
- **Efeito**: nenhum direto; pode devolver resposta cacheada idêntica.
- **Decisões**: classificação de intenção (fechamento/espera/logística/qualificação/conversa); continuidade de slots; espera = não executar cobrança/frete/orçamento; pergunta de fornecedor tem prioridade.
- **Skill real?** Não há tabela de skills, manifesto, descoberta nem progressive disclosure; "precedência entre skills" é uma string no prompt lida por regex pelos gates (qual L62, closing L18). Flag acima.
- **Duplicidade**: núcleo "[FICHA…] NÃO pergunte o preenchido" (L3219), "NAO REPERGUNTE…" (L2269), `[VOCÊ ACABOU DE PERGUNTAR…]` (L3164) vs CONTINUIDADE L163; `joCloseIntent` (L60-71) vs `clCloseIntent` (closing L21) vs FECHAMENTO do núcleo (L2233-2239); `joLogisticsIntent` (L79) vs qual L267.
**v1.5** (externo):
- **Hook**: fetch Anthropic, pós-resposta (L114-137). Mesma flag, default true (L13).
- **Condição**: inbound é pergunta sobre "fornecedor(es)" (L59-63), não-stream; se decisão do modelo tem `responde:false` → força `responde:true`, mensagem "Você está falando dos fornecedores da camiseta 100% algodão, certo?" / "…das camisetas…" / "…do DTF UV…" / "…do DTF…" / "…desse produto…" (L75-82), apaga `slots` (L96).
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L103-112).
- **Efeito**: reescreve saída (silêncio → pergunta).
- **Duplicidade**: v1.4 já injeta "Não encerre o turno em silêncio" (L171) e v1.5 impõe o mesmo em código; núcleo "SEM DISPENSAR" (L2260).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 7. direct-file-intake-preload-v1.ts (a417e818)
- **Hook**: fetch Anthropic (L28-41). v291:30.
- **Injeção**: `[CORTEX ARQUIVO DIRETO v1]` (~750 chars, L37) com inventário JSON dos ZIPs.
- **Condição**: flag `joao_direct_file_intake_ativo` (L16), default false, !ok mantém. Só se o `system` contém `ZIP_VALIDADO: N arquivo(s) de arte; itens=…; ignorados=N` (L21) — produtor NÃO ENCONTRADO no núcleo nem no lote.
- **Tools**: nenhuma. **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L26).
- **Efeito**: só prompt.
- **Decisões**: contagem de anexos vs arquivos internos; não inferir DPI/medida por nome; "não autoriza preço, quantidade, frete ou pagamento".
- **Duplicidade**: núcleo L2209 e `[ARQUIVOS REAIS…]` L1217; artwork v1/v2 (itens 3-4).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 8. freight-comparison-preload-v1.ts (5d70c213)
- **Hook**: fetch Anthropic pré+pós (L124-155). v291:31. **Sem flag** — sempre ativo (nenhuma leitura de `sistema_config`).
- **Injeção**: `[CORTEX FREIGHT COMPARISON v1]` (~560 chars, L145): "modalidade_logistica=envio… NÃO pergunte 'envio ou retirada'… uma chamada de calcular_frete por CEP".
- **Condição**: ≥2 CEPs nos últimos 10 turnos do cliente (L60-64, 138) + regex de comparação (L66-70; inclui par de cidades hardcoded `registro|sao paulo`, L69).
- **Tools**: não altera definição; orienta N chamadas de `calcular_frete`.
- **Banco**: nenhum; sem auditoria.
- **Efeito**: pós: reescreve `decision.slots` — `modalidade_logistica='envio'`, `envio_retirada='envio'`, `freight_comparison_pending=true`, `ceps_cotacao`, `quantidade` (L104-118) → persistidos pelo núcleo em `agente_noturno_estado` (INFERIDO, núcleo L1153). Header `x-cortex-freight-comparison`.
- **Decisões**: frete comparativo implica envio; quantidade extraída por regex (L72-85).
- **Duplicidade/conflito**: contradiz núcleo "RESOLVA A MODALIDADE ANTES DO CEP" (L2225), "MODALIDADE LOGISTICA ANTES DO CEP… NAO chame calcular_frete" (L2267) e `blocoModalidadeLogistica` "PROIBIDO calcular frete" (L866-868); resolvido só por posição (anexado depois).
- **Segredos**: nenhum.

### 9. order-grade-confirmation-preload-v1.ts (8ad4b1c2)
- **Hook**: fetch Anthropic (L120-139). v291:32.
- **Injeção**: `[CORTEX ORDER GRADE CONFIRMATION v1 mode=NORMALIZE effect=NONE]` (~1500 chars, L105) ou `mode=CONFIRMED` (~750, L108).
- **Condição**: flag `joao_order_grade_confirmation_ativo` (L51), default false, !ok mantém. Lista = sinal de tamanho (L63-65) + quantidade (L66-71) + (cor/modelo L72-74 ou pedido prévio de lista L75-78) + (≥2 quebras de linha ou ≥24 chars) (L86); confirmação = "sim/ok/…" (L91-94) após assistente que perguntou "confirma… pedido/lista/grade" e listou com "total: N" (L95-103).
- **Tools**: nenhuma. **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L110-118).
- **Efeito**: só prompt.
- **Decisões**: grade de camiseta MODELO→TECIDO→COR→TAMANHO→QTD, recálculo do total, "Não volte para preço, Pix, frete", `ready_for_handoff`, "Nunca diga que a Helen assumiu".
- **Skill real?** Não: "Você está usando a skill order_grade_confirmation" é texto; sem manifesto. Flag acima.
- **Duplicidade/conflito**: núcleo "use orcar_camisetas assim que tiver MODELO, QUANTIDADE TOTAL e ESTAMPAS… NUNCA segure um orcamento esperando tamanho" e "MEMORIA DA GRADE… slots.grade" (L2264) vs regra 5 "Não volte para preço… orçamento" (L105) — o núcleo quer orçar no mesmo turno, o preload proíbe; formato Markdown com `**negrito duplo**` e travessão "—" (L105) vs núcleo "Negrito… asterisco SIMPLES, NUNCA duplo" (L2187) e "nunca travessão" (L2248); schema `slots.grade/estampas` do JSON do núcleo (L2252) não é citado pelo preload.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 10. product-service-disambiguation-preload-v3-textile-intent.ts (f23bc4fb)
- **Hook**: fetch Anthropic, curto-circuito (L135-158). v291:33.
- **Injeção**: nenhuma; resposta sintética (`model:'cortex-qualification-disambiguation'`, L126-133).
- **Condição**: flag **`joao_qualification_gate_ativo`** (reutiliza a do item 1, L31), default false. Inbound sem modo explícito (regex L74-91: dtf/transfer/adesivo/folha/metro/"aplicar em tecido" OU "peça pronta/personalizada") E contexto DTF nas mensagens anteriores (L99-103) E inbound cita vestuário ou copo/caneca (L92-98).
- **Tools**: modelo não roda.
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L111-125).
- **Efeito**: mensagens fixas (L104-110) "Só pra eu não te passar o preço errado: você quer somente as impressões para aplicar (DTF UV para caneca e DTF têxtil para camisa) ou quer as canecas e camisetas já personalizadas?" / variante copo / variante camisa; tema `sondagem`, `slots:{}`.
- **Decisões**: transfer vs peça pronta; adia preço.
- **Duplicidade**: núcleo "CLIENTE QUE JÁ TEM A PEÇA… produto é o ADESIVO DTF UV" (L2197), "ESTAMPARIA… você NÃO cota" (L2242), "DOIS PERFIS DE CLIENTE" (L2266); guard `pergunta_repetida` do núcleo (L4585-4600) — v4 L4-6 documenta que v3 repetiu a pergunta e caiu nesse guard; psd v4/v5 (mesma flag) e `product-service-disambiguation-preload-v3-user-evidence.ts` do index.ts (fora do lote, NÃO ANALISADO).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 11. product-service-disambiguation-preload-v4-apparel-apply.ts (ce04266c)
- **Hook**: fetch Anthropic, curto-circuito (L103-126). v291:34.
- **Condição**: flag `joao_qualification_gate_ativo` (L36), default false. Regex "passar/aplicar/estampar/imprimir … em/para camiseta…" (L73-78) + vestuário sem copo/caneca (L114).
- **Efeito**: mensagem fixa "Perfeito, então é DTF têxtil para aplicar nas camisetas. Qual é o tamanho da estampa em centímetros e quantas cópias você precisa?" tema `dtf_metro`, `slots:{produto:'dtf_textil'}` (L116-123).
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L79-93).
- **Decisões**: DTF têxtil; pede medida em cm + cópias.
- **Duplicidade/conflito**: psd v5 (externo, v291:35, mesma flag) intercepta antes com regex superconjunto (file-state-core L34-35 `.{0,50}` ⊇ v4 `.{0,40}`, mesmas condições apparel && !drinkware) → **v4 é inalcançável** com v5 ativo (PROVADO por ordem+regex). v5 afirma "antes de perguntar tamanho/copia, descobre o ESTADO DO ARQUIVO" (v5 L8) — intenção oposta à de v4. Núcleo "CLIENTE COM ARQUIVO MONTADO: NAO pergunte tamanho de estampa nem quantas copias" (L2266).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 12. product-service-disambiguation-preload-v5-file-state.ts (62415fa5)
- **Hook**: fetch Anthropic, curto-circuito (L128-151). Importa `./file-state-core.ts` (L3). v291:35.
- **Condição**: flag `joao_qualification_gate_ativo` (L42), default false. `pd5BuildDecision` (core L78-133): aplicação explícita em vestuário sem copo/caneca OU resposta à pergunta "arquivo montado… artes separadas" com contexto têxtil confiável (L65-76); estado por regex (L38-63).
- **Efeito**: 4 textos fixos (core L95, L105, L115, L125): "Perfeito. Como o arquivo já está montado, me envie pelo formulário de upload do DTF têxtil…", "Perfeito. Você quer que a Skillprint monte essas artes no arquivo de impressão para você?", "Sem problema. Posso te ajudar por três caminhos: pack de artes prontas, nosso Studio para preparar a estampa, ou criação da arte…", "Perfeito, então é DTF têxtil para aplicar nas peças. Você já tem o arquivo montado… ou tem as artes separadas?…"; `slots.produto='dtf_textil'` + `arquivo_estado`. Header `x-cortex-product-service-disambiguation`.
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L95-116).
- **Decisões**: DTF têxtil; upload; oferta de montagem; pack/Studio/criação; classificação de estado do arquivo.
- **Duplicidade/conflito**: núcleo "QUEM PERGUNTA O VALOR DO METRO… MANDE A TABELA NA HORA… PROIBIDO responder pergunta de preco com pergunta sobre arte" (L2266) e "ANTI-ENROLAÇÃO… PRÓXIMA MENSAGEM TEM NÚMERO EM R$" (L2216) — v5 responde "quero imprimir em camisetas, quanto custa?" com pergunta sobre arquivo e sem preço; o guard `pediu_preco_e_nao_recebeu` do núcleo (L4205-4217) re-chama com nudge e v5 devolve a mesma sintética (INFERIDO). Torna v4 morto (item 11).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 13. freight-choice-context-preload-v1.ts (05ec4f81; `FCC_VERSION='v1.1'`)
- **Hook**: fetch Anthropic pré + curto-circuito (L228-263). v291:36.
- **Condição**: flag `joao_freight_choice_context_v1_ativo` (L151), default false, !ok mantém. Último turno do João listou ≥2 opções PAC/Sedex/J&T com `R$` (L63-79) e perguntou "qual prefere/opção" (L134); CEP em turno anterior do cliente (L136-142); inbound SEM nome de serviço (L91) e resolvido por valor exato, "mais barato" ou ordinal (L88-113).
- **Banco**: lê `sistema_config`; RPC `fn_joao_authorize_freight_choice_v1` (L160-179) — ESCRITA INFERIDA (emite/reutiliza autorização de frete e compõe total, cabeçalho L11-13; corpo da RPC fora de escopo); ESCRITA `sistema_logs` (L180-192).
- **Efeito**: `RESOLVED_TOTAL(_REUSED)` → resposta sintética (L193-226): "Fechado! Vamos de {serviço} por R$ {frete}. Com o frete, o total fica *R$ {total}*. Você prefere Pix ou cartão?" tema `fechamento`, etapa `pagamento`, slots frete_*/operation ids. `RESOLVED_FREIGHT_ONLY` → injeta `[CORTEX FREIGHT CHOICE CONTEXT v1]` (~600 chars, L255: "NÃO chame calcular_frete de novo… componha o total"). Outro status → passthrough.
- **Tools**: substitui `calcular_frete(servico_escolhido)` + `compor_total` por execução fora do modelo.
- **Decisões**: escolha de frete por preço/ordem; total; "Pix ou cartão?"; modalidade envio.
- **Duplicidade/conflito**: núcleo "So depois de o CLIENTE escrever explicitamente PAC, Sedex ou J&T, chame calcular_frete… NUNCA escolha frete pelo cliente" (L2235) e tool `calcular_frete` (L1257) — contornado por design; template de mensagem idêntico em freight-checkout v2 (fc2 L43) e reescrito só lá por freight-checkout-output-clarify (fco L25-26) → dois fraseados no mesmo fluxo; freight-comparison também força `envio`.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 14. uv-operation-idempotency-preload-v1.ts (e010ed76)
- **Hook**: fetch em POST `…/rest/v1/rpc/fn_emitir_operacao_financeira` (L163) — RPC Supabase, não Anthropic. v291:37.
- **Injeção**: nenhuma.
- **Condição**: flag `joao_uv_financial_op_idempotency_v1_ativo` (L12,79), default false, !ok mantém. `p_kind='produto'` e `p_source_tool` ∈ {calcular_rendimento_uv, calcular_dtf_uv_metro} (L168). Busca `operacoes_financeiras` (lead, produto, ativa, `used_at` null, não expirada, ≤5 min, L115) com match semântico amount/consumo_m/quantidade/adesivo_cm/degrau (L46-62) e recibo canônico em `joao_erp_proposal_receipts_v1` com mesmo total e metros UV (L90-107; `produto_id` hardcoded `d48addf9-…` L68).
- **Tools**: intercepta o efeito da tool (emissão de autorização) — devolve a operação existente como se fosse a resposta da RPC (L176-180). Bloqueia a escrita nova.
- **Banco**: lê `sistema_config`, `operacoes_financeiras`, `joao_erp_proposal_receipts_v1`; ESCRITA `sistema_logs` (L131-158, categoria `financial_runtime`).
- **Efeito na resposta**: indireto (operation_id reutilizado no `financial_authorizations`).
- **Decisões**: reutilização de autorização/preço DTF UV.
- **Duplicidade**: uv-explicit-sheet `reusable()` (ues L37) repete a mesma consulta+recibo (5 min); pricing-financial-postload também intercepta a mesma RPC (3 camadas no mesmo endpoint, ver item 18).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 15. color-split-ambiguity-preload-v1.ts (c0e9e9c8; `QAG_VERSION='v1.1'`)
- **Hook**: fetch Anthropic (L187-229). v291:38.
- **Condição**: flag `joao_quantity_color_split_ambiguity_v1_ativo` (L16,141), default false, !ok mantém. Modo A: inbound `^(seriam) N <cor> ou M de cada cor$` (L110-118) + contexto UV (L119-121) + ≥2 cores (L99-103, preferindo "N + cor" contadas). Modo B: inbound "N de cada cor"/"N brancos" (L129-136) após assistente com "só pra eu fechar certo"+"de cada cor" (L122-128).
- **Injeção**: Modo B: `[CORTEX QUANTIDADE RESOLVIDA v1.1]` (~600 chars, L183) com total calculado e ordem de chamar `calcular_rendimento_uv quantidade_desejada=N` e depois frete.
- **Tools**: Modo A força `stop_reason='end_turn'` e descarta qualquer `tool_use` (L165-173).
- **Banco**: lê `sistema_config`; ESCRITA `sistema_logs` (L151-160, categoria `qualification_runtime`).
- **Efeito**: Modo A CHAMA o modelo (L208; tokens contados pelo núcleo L3344) e SUBSTITUI o conteúdo por `{"responde":true,"mensagem":"Só pra eu fechar certo: você quer N adesivos <cor> no total ou M de cada cor (lista)?","tema":"adesivo_uv","etapa":"orcamento"}` sem slots (L161-176, 206). Header `x-cortex-quantity-ambiguity`.
- **Decisões**: quantidade por cor; DTF UV; recálculo; "Nao invente preco".
- **Duplicidade/conflito**: color-split-resolution-fallback (item 16, externo, sem flag) implementa o mesmo Modo B com regex idênticas (qrf L49-68) e bloco quase igual → quando pergunta e fala ambígua estão ambas no histórico, os DOIS blocos são injetados (sem exclusão mútua; PROVADO por ordem). `color-split-request-controller-v1` (v291:3, fora do lote). Núcleo "SEMPRE use calcular_rendimento_uv com quantidade_desejada" (L2193) repetido no bloco.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 16. color-split-resolution-fallback-preload-v1.ts (d00d2fdf)
- **Hook**: fetch Anthropic (L70-92). v291:39. **Sem flag** — sempre ativo.
- **Condição**: inbound "N de cada cor"/"N brancos" (L62-68) E alguma mensagem anterior do cliente com padrão ambíguo (L53-61) E contexto UV no fim do system + últimos 12 turnos (L81-82) E ≥2 cores contadas (L43-48, 83-84).
- **Injeção**: `[CORTEX RESOLUCAO QUANTIDADE FALLBACK v1]` (~520 chars, L88). Põe header no REQUEST (`x-cortex-color-split-resolution-fallback`, L90) — inócuo.
- **Tools/Banco**: nenhum; sem auditoria.
- **Efeito**: só prompt.
- **Decisões**: mesmas do item 15 Modo B.
- **Duplicidade**: ver item 15.
- **Segredos**: nenhum.

### 17. freight-positive-output-preload-v1.1.ts (729e4ac7)
- **Hook**: fetch de SAÍDA (transporte), não Anthropic: Z-API `send-text` (L126), BotConversa `send_message` tipo text (L129; phone via cache do lookup `get_by_phone` L147-159) e edge `joao-tts` (L135). v292.1:4 → externo a toda v291. **Sem flag** (só checa env L71,107) — sempre ativo.
- **Condição**: texto de saída bate regex de negação de frete ("não retornou/sem opção de frete", L35-40) E existe linha em `joao_freight_quote_snapshots` do phone nos últimos 20 min com `opcoes` (e mesmo CEP se houver CEP no texto) (L70-91).
- **Tools**: nenhuma.
- **Banco**: lê `joao_freight_quote_snapshots`; ESCRITA `sistema_logs` (L106-123, categoria `freight_runtime`, status `observed`).
- **Efeito**: REESCREVE a mensagem enviada ao cliente: remove frases de regressão (negação, "confirma o CEP", "prefere retirar/motoboy", L41-47, 99-100) e anexa "Para o CEP XXXXX-XXX, tenho estas opções de frete:\n• {serviço}: R$ x — N dias úteis\nQual você prefere?" (L102); se nada sobrar, prefixa "*João Barros:*" (L103). Retry único (300 ms) na Z-API para HTTP 408/409/425/429/5xx (L188-201).
- **Decisões**: frete (apresenta opções persistidas), impede regressão para CEP/retirada, transporte.
- **Duplicidade/conflito**: núcleo já tem nudge "[SISTEMA: voce chamou calcular_frete e nao colocou as opcoes" (L4224); reescrita ocorre DEPOIS de `registrarDecisao`/ledger (núcleo L2272-2300, INFERIDO) → texto enviado ≠ decisão registrada; `blocoModalidadeLogistica` "PROIBIDO oferecer PAC ou Sedex" em retirada (L855) vs anexo de opções sempre que houver snapshot; núcleo já concatena `assinatura + texto` (L2412) → possível assinatura dupla no caso L103 (INFERIDO). Usa "—" no texto (L65) contra "nunca travessão" (L2248).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 18. uv-explicit-sheet-preload-v1.ts (365e568a)
- **Hook**: fetch em POST `…/rpc/fn_emitir_operacao_financeira` (L42). v294:5 → externo ao uv-op-idempotency, interno ao pricing-financial-postload.
- **Condição**: flag `joao_uv_explicit_sheet_v1_ativo` (L32), default false, exceção mantém. `p_kind='produto'` + tools UV (L44); lead uuid; `recentSheet`: varre `fact_conversations` inbound do lead nas últimas **24h** (30 linhas) por "N folhas A4/A3" (L20-31, 33) — não é limitado ao turno atual.
- **Execução determinística substituindo a RPC**: (1) ERP `fn_cortex_pricing_calculation_v1` (host env `ERP_URL`, default hardcoded `https://ynjsflvdfftcopibzxyo.supabase.co`, chave env `ERP_SERVICE_KEY`/`ERP_SERVICE_ROLE_KEY`) (L48); (2) reuso (L37,51); (3) ESCRITA RPC `fn_emitir_operacao_financeira_explicit_uv_v1` (L52); (4) lê `agente_noturno_estado.phone` (L34,54); (5) ESCRITA ERP `fn_joao_lancar_orcamento_v1` (cria orçamento no ERP, L55); (6) ERP `fn_cortex_proposal_snapshot_v2` (L57); (7) ESCRITA `fn_joao_erp_proposal_receipt_record_v1` (L59); devolve a operação (L62). Qualquer falha → HTTP 424 JSON (L49,50,53,56,58,60) → núcleo `emitirAutorizacao` recebe erro → `null` (L1273) → sem autorização/preço (INFERIDO: fail-closed sem preço).
- **Tools**: substitui a matemática da tool do núcleo (`p_amount` trocado por `total_price` do ERP, L50-52).
- **Banco**: lê `sistema_config`, `fact_conversations`, `operacoes_financeiras`, `joao_erp_proposal_receipts_v1`, `agente_noturno_estado`; ESCRITA RPCs acima + `sistema_logs` (L38, `financial_runtime`) + host ERP externo.
- **Efeito na resposta**: indireto (valor autorizado).
- **Decisões**: preço DTF UV por folhas explícitas (autoridade ERP), proposta/orçamento no ERP, reuso.
- **Duplicidade/conflito**: pricing-current-turn-preflight (interno) re-injeta `requested_sheet_*` na mesma chamada ERP (PCP L33-38) → dupla injeção; pricing-financial-postload (externo) já reescreveu `p_amount/components` antes (item 23) e ues recalcula de novo → 3 camadas decidindo o mesmo preço; ues usa 24h de histórico, pricing usa turno atual → divergência possível (turno atual sem menção a folha mas mensagem de 20h atrás com folha: só ues age). Núcleo hardcoda "A4 R$29,90; A3 R$39,00" (L2242, L2191). Idempotência duplicada com item 14.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ERP_URL`, `ERP_SERVICE_KEY`/`ERP_SERVICE_ROLE_KEY`.

### 19. freight-checkout-preload-v2.ts (374f025b; `v2.2`)
- **Hook**: fetch Anthropic, curto-circuito (L46-81). v294:6.
- **Condição**: flag `joao_freight_checkout_v2_ativo` (L37), default false, exceção mantém. **Só quando a última mensagem é `user` iniciada por `[SISTEMA:`** (L22, 49) → isto é, só nas re-chamadas de nudge do núcleo (`chamarCerebro(nudge)` L3331-3333); a chamada inicial nunca aciona (PROVADO). CEP do diálogo/system (L24-29) e (serviço nomeado L19 OU sinal de pagamento L20 — inclui "sim/pode/fechado/gera/manda").
- **Execução fora do modelo**: RPC `fn_joao_authorize_named_freight_choice_v2` (L54, ESCRITA INFERIDA) ou `fn_joao_recent_checkout_context_v1` (L58); edge `joao-erp-orcamento-sync` (L65, ESCRITA ERP INFERIDA); RPC `fn_joao_checkout_projection_from_total_v1` (L67); se pagamento: `fn_joao_pix_charge_guard_v1` (L72), `fn_joao_checkout_confirm_pix_contract_v1` (L74, ESCRITA INFERIDA), edge **`mp-pix-criar`** (L76, ESCRITA: cria cobrança Pix), confere `mp_pix_cobrancas` (L40).
- **Tools**: substitui `calcular_frete`+`compor_total`+`gerar_pix`.
- **Banco**: acima + ESCRITA `sistema_logs` (L41, `checkout_runtime`).
- **Efeito**: respostas sintéticas (header `x-cortex-freight-checkout`, `x-cortex-payment-id`): "Fechado! Vamos de X por R$ f. Com o frete, o total fica *R$ t*. Posso gerar o Pix copia e cola nesse valor?" / "…Você prefere Pix ou cartão?" (L43); holds: "O frete está escolhido, mas o total ainda não passou pela conferência do ERP. Não vou gerar cobrança antes disso." (L66), "O total está confirmado, mas a cobrança não foi liberada. Não vou enviar um Pix sem validação." (L75), "Não consegui confirmar a criação do Pix, então não vou te passar nenhum código sem validação." (L78); Pix: "Perfeito. Gerei o Pix de *R$ v* para o pedido de R$ t.\n\n{qr}" `encaminhou_venda:true`, `slots.payment_id` (L44).
- **Decisões**: frete escolhido, total, Pix, pagamento, fechamento.
- **Duplicidade/conflito**: núcleo FECHAMENTO 2-4 e tools `gerar_pix`/`compor_total` (L2235-2237, L1258-1259) substituídos; núcleo "NUNCA revele funcionamento interno: PROIBIDO falar em sistema" (L2249) vs "conferência do ERP"/"validação" (L66,75,78); template duplicado com fcc (item 13); regex de pagamento ampla (L20).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 20. freight-checkout-output-clarify-v1.ts (47fbcea4)
- **Hook**: fetch Anthropic, pós-resposta apenas (L6-30). v294:7. **Sem flag**, mas só age se a resposta traz header `x-cortex-freight-checkout` (do item 19) → gated indiretamente.
- **Injeção**: nenhuma. **Tools/Banco**: nenhum.
- **Efeito**: reescreve a mensagem do fc2 para "Fechado! Frete {serviço}: R$ f. Total do pedido: *R$ t*. Posso gerar o Pix copia e cola nesse valor?" / "…Você prefere Pix ou cartão?" (L24-26) quando slots têm serviço, frete>0, uuid do total e sem `payment_id`, e a mensagem contém "total … R$".
- **Decisões**: só fraseado de frete/total/Pix.
- **Duplicidade**: cosmético sobre fc2 L43; ignora a mensagem idêntica do fcc (header diferente) → dois fraseados no mesmo fluxo (PROVADO).
- **Segredos**: nenhum.

### 21. pricing-current-turn-preflight-v1.ts (1fa32774)
- **Hook**: DOIS. (a) `Deno.serve` wrapper (L44-51): lê `mensagem`/`message` do body do request, parseia "N folhas A4/A3" (L19), cria contexto AsyncLocalStorage `{incoming, order, explicit_uv (adesivo|dtf uv|uv), mixed (cep/frete/pix/… L21), dry_run (_dry_run), financial_rewrites}` e expõe `globalThis.__joaoPricingCurrentTurnV1` e `__joaoPricingCanonicalQuoteV1` (RPC ERP `fn_cortex_pricing_explicit_sheet_quote_v1`, L25-26). (b) fetch em POST `…/rpc/fn_cortex_pricing_calculation_v1` (L33): se ctx tem folha explícita e payload é dtf_uv com tool UV, injeta `requested_sheet_format/count/degrau` em `components` (L36-38). Instalado v299:5, ANTES de bug3 → wrapper de fetch mais interno do lote; wrapper de serve envolve por fora do gate v5 (v5 lê o ALS, PROVADO L7/L6 e bind order). O núcleo lê o body com `req.json()` (L5349); PCP usa `req.clone()` (L46).
- **Condição**: **sem flag** — sempre. `console.log` de load (L53).
- **Injeção no prompt**: nenhuma. **Tools**: nenhuma.
- **Banco**: lê ERP (`fn_cortex_pricing_explicit_sheet_quote_v1`) sob demanda; muta o payload da chamada ERP; sem escrita.
- **Decisões**: preço DTF UV por folhas (contrato explícito).
- **Duplicidade**: ues (L47-48) já põe os mesmos campos na mesma RPC ERP; núcleo hardcoda preços A4/A3 (L2242).
- **Segredos**: env `ERP_URL`, `ERP_SERVICE_KEY`/`ERP_SERVICE_ROLE_KEY`.

### 22. pricing-explicit-sheet-response-gate-v5.ts (b0ab80ed)
- **Hook**: só `Deno.serve` wrapper pós-handler (L15-39): pós-processa a RESPOSTA HTTP da edge function, não a chamada Anthropic. v299:6.
- **Condição**: **sem flag**; age só se ctx (item 21) tem `order` e `explicit_uv` (L20).
- **Efeito**: chama quote ERP; se não canônico → substitui payload por `respondeu:true, resposta:'Não consegui confirmar o preço canônico dessas folhas agora. Não vou informar valor até o ERP responder corretamente.'`, modo FAIL_CLOSED (L25); senão compõe "N folhas A4: R$ t (R$ u cada)." (L28) com base saneada (`sanitizeMixed` L13 remove frases com preço/consolidação divergente; exclui hardcoded `R$ 39/29` L13) ou substitui a base (L29-33); headers `x-cortex-pricing-agent(-mode)`.
- **CRÍTICO (PROVADO)**: em produção o retorno do núcleo (L5343) é `{ok, respondeu, canal, tema, tools, price_gate, apparel_pricing_guard}` — **sem `resposta`** — e a mensagem já foi enviada dentro do handler; logo este gate só altera o JSON devolvido ao chamador do webhook (adicionando `resposta`), não a mensagem ao cliente. Só em dry-run (L5186 inclui `resposta`) ele reescreve a resposta simulada. (Salvo camada mais externa em index.ts que reenvie — NÃO ANALISADO.)
- **Tools/Banco**: leitura ERP; sem escrita; `console.log`.
- **Decisões**: preço DTF UV por folha; fail-closed sem preço.
- **Duplicidade**: núcleo "ANTI-ENROLAÇÃO… NÚMERO EM R$" (L2216) vs texto FAIL_CLOSED sem número; guard de preço do núcleo (L4164) atua na decisão do modelo; preços hardcoded do SYSTEM (L2242) vs sanitização de 39/29.
- **Segredos**: via item 21.

### 23. pricing-financial-current-turn-postload-v1.ts (b99cd6d1)
- **Hook**: fetch em POST `…/rpc/fn_emitir_operacao_financeira` (L14). v299:13 → externo a todo bug3 (vê a RPC antes de ues e uvi).
- **Condição**: **sem flag**; só com ctx ALS (`order`+`explicit_uv`) e `p_kind='produto'` com tool UV (L16-18).
- **Efeito**: quote ERP não canônico → responde HTTP 424 (L19-20) → núcleo sem autorização (INFERIDO fail-closed sem preço); senão reescreve `p_amount=total ERP` e `p_components += requested_sheet_*` (L21-25) e repassa (para ues → uvi → … → RPC real). Registra em `ctx.financial_rewrites` e `console.log`.
- **Injeção**: nenhuma. **Tools**: altera o valor emitido pela tool.
- **Banco**: leitura ERP; muta args da RPC (ESCRITA indireta: valor gravado em `operacoes_financeiras`).
- **Decisões**: preço DTF UV por folha (ERP sobre a matemática da tool).
- **Duplicidade**: ues refaz e sobrescreve (item 18); uvi (item 14); SYSTEM hardcoded.
- **Segredos**: via item 21.

### 24. halftone-art-final-router-v1.ts (4c1f2bc7)
- **Hook**: fetch Anthropic, curto-circuito (L235-295). v299:14 (externo a tudo, exceto item 25).
- **Condição**: flag `joao_halftone_art_final_router_ativo` (L18,118), default false, erro→false. Classificação L202-210: CONFIRMED se assistente anterior pediu confirmação de halftone e cliente afirmou (L79-87) ou pedido explícito (L68-74) não "ofertista" (L75-78); OPEN_TASK_PRICE_ONLY se há `crm_tasks` aberta do phone em `etapa_funil='arte_final_halftone'` (L137-145) e pergunta de preço DTF (L96-100); CLARIFY se cita halftone/arte final (L60-67). Phone por regex no system/texto (L101-113; exclui hardcoded `5511992769857`).
- **Banco**: lê `sistema_config`, `crm_tasks`, `leads_marketing` (L126-136), `dtf_precos_faixa` (L177-190); ESCRITA RPC `create_human_task_safe` (L146-175: etapa `arte_final_halftone`, `p_script:null`, `p_decision_id:null`, due 4h, origem `joao_halftone_art_final_router`) e `sistema_logs` (L221-234).
- **Efeito**: sintéticas (`model:'cortex-halftone-art-final-router'`): CLARIFY "Só pra confirmar: você quer que a Skillprint trate essas imagens em halftone com o nosso arte-finalista, correto?" (+ " E sobre o DTF têxtil por metro, a tabela atual é: {faixas}." se pediu preço) (L264); OPEN_TASK "O tratamento em halftone continua com a Arte Final. Sobre o DTF têxtil por metro, a tabela atual é: … O valor do tratamento de Arte Final é separado e eu não vou inventar esse preço." (L273); CONFIRMED "Perfeito — encaminhei suas imagens para a Arte Final fazer o tratamento em halftone…" / variante dry-run / variante falha "Entendi que você quer o tratamento em halftone…" (L281-285).
- **Tools**: modelo não roda; tabela de preço verbalizada direto de `dtf_precos_faixa` sem tool nem `financial_authorizations`.
- **Decisões**: classificação de serviço de arte; handoff humano (task); preço DTF têxtil por metro; "não inventar preço de Arte Final".
- **Duplicidade/conflito**: núcleo "ESTAMPARIA… você NÃO cota. Quem passa o valor é a Tamires" (L2242) — coerente; "NUNCA revele funcionamento interno" (L2249) vs "encaminhei… para a Arte Final"; núcleo exige `consultar_tabela_dtf` (L2261, tool L1250, que também lê `dtf_precos_faixa` L1751) → caminho paralelo de preço; guard `guardrail_preco_nao_autorizado` do núcleo (L4164) sobre a decisão sintética com R$ sem tool → nudge → mesma sintética (INFERIDO); travessão "—" (L282-284) vs L2248; regex de phone duplica artwork v2 L68-82.
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### 25. halftone-phone-resolver-v1.ts (8424198c)
- **Hook**: fetch Anthropic, pré (L64-83). v299:15 → wrapper MAIS EXTERNO do grafo. **Sem flag** — sempre.
- **Condição**: system sem `55\d{10,11}` (L43-45, 73) → consulta `fact_conversations` inbound com `message_text=eq.<inbound>` nos últimos 15 min (L46-62); exatamente 1 phone → anexa ao system `[HALFTONE_IDENTITY_RESOLVED phone=55… source=fact_conversations_exact_recent]` (L79).
- **Tools**: nenhuma. **Banco**: lê `fact_conversations`; sem escrita/auditoria.
- **Efeito**: injeta o telefone completo no prompt do modelo para que item 24 (`hafPhone` L101-113) e item 4 (`pfcPhone`) o resolvam — acoplamento entre camadas via system (PROVADO). Filtro `eq.` com texto livre do cliente (vírgulas/parênteses do PostgREST) pode falhar (INFERIDO).
- **Decisões**: nenhuma comercial (identidade).
- **Duplicidade**: o núcleo já tem `phone` no handler (L5396) mas não o coloca no `systemFinal` (NÃO ENCONTRADO em L3226-3233).
- **Segredos**: env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Achados transversais (PROVADO salvo indicação)
1. Flags lidas em `sistema_config` (todas `valor_bool`, cache 15 s): `joao_qualification_gate_ativo` (itens 1,10,11,12 — uma flag para 4 comportamentos), `joao_closing_gate_ativo`, `joao_artwork_context_guard_ativo` (3,4 e v1), `joao_repeat_order_history_ativo`, `joao_skill_orchestrator_ativo` (**default true/fail-open**, 6), `joao_direct_file_intake_ativo`, `joao_order_grade_confirmation_ativo`, `joao_freight_choice_context_v1_ativo`, `joao_uv_financial_op_idempotency_v1_ativo`, `joao_quantity_color_split_ambiguity_v1_ativo`, `joao_uv_explicit_sheet_v1_ativo`, `joao_freight_checkout_v2_ativo`, `joao_halftone_art_final_router_ativo`. **Sem kill-switch**: freight-comparison, color-split-fallback, freight-positive-output, freight-checkout-output-clarify, os 3 pricing-*, halftone-phone-resolver.
2. Nenhum preload do lote adiciona/remove/renomeia entradas de `tools: TOOLS`; os que "alteram tools" o fazem substituindo a execução (RPC/edge) ou impedindo o modelo de rodar.
3. `fn_emitir_operacao_financeira` tem 3 interceptadores empilhados (23 → 18 → 14), com três fontes de verdade para "folhas explícitas" (turno atual ALS, 24h de `fact_conversations`, componentes da tool).
4. Todo curto-circuito ignora nudges `[SISTEMA:` do núcleo → guardrails do núcleo (preço sem R$, pergunta repetida, promessa de Pix) recebem a mesma resposta sintética em retry (INFERIDO).
5. `sistema_logs` recebe escrita de 19 dos 25 arquivos; orchestrator v1.4 grava 1 linha por chamada ao modelo.
6. Produtores NÃO ENCONTRADOS (nem núcleo, nem lote): `invalidations=` (item 1), `ZIP_VALIDADO:` (item 7), `[ARTE_PROCESSADA_CORTEX]` (item 3).

## Tabela
| arquivo | hook | sempre/condicional | escreve no banco? | altera tools? | bloqueia/reescreve saída? |
|---|---|---|---|---|---|
| qualification-gate-v1.6 | fetch Anthropic (curto-circuito) | flag `joao_qualification_gate_ativo` (def. off) + RPC status + regex | sistema_logs | modelo não roda | SIM: substitui por pergunta fixa |
| closing-gate-v1.3 | fetch Anthropic (system) | flag `joao_closing_gate_ativo` (def. off), stage CLOSING | sistema_logs | não | não (só prompt) |
| artwork-current-turn-v1.1 | fetch Anthropic (system + pós) | flag `joao_artwork_context_guard_ativo` (def. off) | sistema_logs | não | SIM: prefixa/substitui mensagem, força slots.produto |
| artwork-context-v2-preflight | fetch Anthropic (system) | mesma flag; upload ≤24h | sistema_logs | não | não |
| repeat-order-history-v1 | fetch Anthropic (system) | flag `joao_repeat_order_history_ativo` (def. off) + regex + RPC | sistema_logs | não | não |
| orchestrator-v1.4 | fetch Anthropic (system + cache) | flag `joao_skill_orchestrator_ativo` (def. ON) — injeta sempre | sistema_logs (toda chamada) | não | cache 2,2 s devolve resposta anterior |
| orchestrator-v1.5 | fetch Anthropic (pós) | mesma flag; pergunta sobre fornecedor | sistema_logs | não | SIM: responde:false → pergunta fixa |
| direct-file-intake-v1 | fetch Anthropic (system) | flag `joao_direct_file_intake_ativo` (def. off) + `ZIP_VALIDADO` | sistema_logs | não | não |
| freight-comparison-v1 | fetch Anthropic (system + pós) | SEMPRE (≥2 CEPs + regex) | não | não | SIM: reescreve slots (envio, ceps) |
| order-grade-confirmation-v1 | fetch Anthropic (system) | flag `joao_order_grade_confirmation_ativo` (def. off) | sistema_logs | não | não |
| psd-v3-textile-intent | fetch Anthropic (curto-circuito) | flag `joao_qualification_gate_ativo` + contexto DTF | sistema_logs | modelo não roda | SIM: pergunta fixa |
| psd-v4-apparel-apply | fetch Anthropic (curto-circuito) | mesma flag (inalcançável com v5) | sistema_logs | modelo não roda | SIM: mensagem fixa |
| psd-v5-file-state | fetch Anthropic (curto-circuito) | mesma flag | sistema_logs | modelo não roda | SIM: 4 mensagens fixas |
| freight-choice-context-v1 | fetch Anthropic (curto-circuito/system) | flag `joao_freight_choice_context_v1_ativo` (def. off) | sistema_logs; RPC autorização (ESCRITA inferida) | substitui calcular_frete/compor_total | SIM: "Fechado! Vamos de…" |
| uv-operation-idempotency-v1 | fetch RPC `fn_emitir_operacao_financeira` | flag `joao_uv_financial_op_idempotency_v1_ativo` (def. off) | sistema_logs; evita escrita | reutiliza operação | indireto |
| color-split-ambiguity-v1(.1) | fetch Anthropic (pós/system) | flag `joao_quantity_color_split_ambiguity_v1_ativo` (def. off) | sistema_logs | descarta tool_use no modo A | SIM: substitui por pergunta fixa |
| color-split-resolution-fallback-v1 | fetch Anthropic (system) | SEMPRE (regex) | não | não | não |
| freight-positive-output-v1.1 | fetch Z-API/BotConversa/joao-tts (saída) | SEMPRE (regex + snapshot ≤20 min) | sistema_logs | não | SIM: reescreve texto enviado + retry |
| uv-explicit-sheet-v1 | fetch RPC `fn_emitir_operacao_financeira` | flag `joao_uv_explicit_sheet_v1_ativo` (def. off) + folha ≤24h | RPCs emitir_explicit_uv, receipt_record, ERP lancar_orcamento, sistema_logs | substitui valor/emissão | indireto (424 = sem preço) |
| freight-checkout-v2(.2) | fetch Anthropic (curto-circuito) | flag `joao_freight_checkout_v2_ativo` (def. off) + só em nudge `[SISTEMA:` | RPCs checkout, edges erp-sync e mp-pix-criar, sistema_logs | substitui frete/total/gerar_pix | SIM: mensagens fixas + Pix |
| freight-checkout-output-clarify-v1 | fetch Anthropic (pós) | SEMPRE, mas só respostas com header do fc2 | não | não | SIM: refraseia |
| pricing-current-turn-preflight-v1 | Deno.serve (ALS) + fetch RPC ERP pricing | SEMPRE | não | muta payload ERP | não |
| pricing-explicit-sheet-response-gate-v5 | Deno.serve (pós-resposta HTTP) | SEMPRE se folha explícita no turno | não | não | só JSON HTTP (em prod. sem efeito no WhatsApp; dry-run sim) |
| pricing-financial-current-turn-postload-v1 | fetch RPC `fn_emitir_operacao_financeira` | SEMPRE se folha explícita no turno | muta args (valor emitido) | substitui valor | indireto (424 = sem preço) |
| halftone-art-final-router-v1 | fetch Anthropic (curto-circuito) | flag `joao_halftone_art_final_router_ativo` (def. off) | RPC create_human_task_safe, sistema_logs | modelo não roda | SIM: mensagens fixas + tabela de preço |
| halftone-phone-resolver-v1 | fetch Anthropic (system) | SEMPRE se system sem phone | não | não | não |