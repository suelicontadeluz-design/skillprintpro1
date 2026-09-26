# Núcleo — mapa ordenado de `atenderClienteInterno` (agente-noturno v4.39.0)

Arquivo: `preloads/bug3/candidate-index-v338.ts` da edge LIVE (`V` linha 362, MODEL claude-haiku-4-5 linha 363). Relatório do subagente de análise, lido integralmente; nenhum arquivo foi modificado.
Legenda: **P**=PROVADO(linha) · **I**=INFERIDO · **NE**=NÃO ENCONTRADO · **ESCRITA**=grava algo.

## ANTES DO INTERNO (entrada HTTP e lock)
- `Deno.serve` 5346. `_sweep` (5351-5385): lê `inbound_fora_horario` status=pendente 30s..4h, agrupa por phone, max 6 clientes, chama `atenderCliente`. Fluxo webhook (5387+): `_direct_message` (5401-5449) envia texto ditado sem modelo (guarda de UUID interno 5406, 422 se achar). Filtro `REGEX_AUTO_ATENDIMENTO` → `{ok:true, skip:'filtro_deterministico'}` (5452). `sleep(DEBOUNCE_MS=8000)` (5462). Se `inbound_id` já não pendente → `skip:'inbound_ja_terminal'` (5482); se existe inbound mais novo (`inboundMaisNovoQue`, 2382) → `skip:'debounce_msg_mais_nova'` (5490). Rajada 5min (5492-5513) agrega textos/imagens(≤3)/áudios(≤2, `transcreverAudio`) e forma `ownedIds`+`loteCreatedAtMax`. **P**
- `atenderCliente` 2865: `adquirirLock` → RPC `fn_joao_adquirir_lock(p_phone)` (480-482; erro na RPC = lock concedido, fail-open — mas lock-v3/gate7c convertem em fail-closed). Sem lock → `{ok:true, skip:'lock_ocupado'}` (2866). `finally liberarLock` = DELETE `agente_noturno_lock` (483; interceptado por lock-v3). Exceção não tratada: log `joao_fatal_unhandled_v191_diag` e relança (2874-2884) — inbound fica pendente. **P**

---
## PARTE A — PRÉ-MODELO (2888 → 3226), em ordem

| # | linha | passo | condição | lê | retorno antecipado | ESCRITA |
|---|---|---|---|---|---|---|
| A1 | 2889-2892 | `agentePausado` | RPC `fn_agente_pausado(p_phone)`===true (1146) | RPC | `{ok:true, respondeu:false, skip:'agente_pausado'}` | `carimbarInbound(...,'pausado_humano')` |
| A2 | 2894 | `resolverPhoneCorpus` | sempre | `fact_conversations.phone` in variantes (1161) | — | — |
| A3 | 2895-2898 | flags regex: `ehFormulario`, `ehPerguntaDireta`, `pediuMudanca`(398), `objecaoPreco`(400) | — | — | — | — |
| A4 | 2900-2913 | `resolverLeadPorTelefone` (1171: `leads_marketing.ph` exato → sufixo 8 dígitos, ambíguo=null) + `pixel_events` Purchase value>0 → `comprou` | comprou | tabelas | `{ok:true, skip:'cliente_comprador'}` | carimba `'silencio_joao'` |
| A5 | 2914 | `garantirLead` | !leadId && !dryRun | RPC `fn_get_or_create_lead` (2370) | — | **ESCRITA** cria lead |
| A6 | 2916-2920 | `lerEstado` (`agente_noturno_estado`, 1149); `estadoFresco` = updated_at < 48h (`ESTADO_VALIDO_MS` 381); `slotsSalvos` = slots crus; `estado` = só se fresco | — | tabela | — | — |
| A7 | 2922 | `lerExecucoes(leadId, pediuMudanca)` (579-641): `mp_pix_cobrancas` 72h, `orcamentos` 72h, `operacoes_financeiras` ativas. Produz `bloco` [JÁ EXECUTADO], `cobrancaPendente`, `freteJa`, `valores` | leadId | 3 tabelas | — | — |
| A8 | 2923 | `blocoArquivosDoLead` (1195): `arte_uploads` 7 dias, ≤20 itens | leadId | tabela | — | — |
| A9 | 2924 | `lerGateComercialCanonico` (2489): kill-switch `sistema_config.joao_contexto_canonico_ativo` (2477) → RPC `fn_contexto_comercial_do_lead`; erro/payload inválido ⇒ `fail_closed` | leadId | RPC | — | — |
| A10 | 2926-2950 | Anúncio de origem: `inbound_fora_horario.body->externalAdReply` mais recente; `blocoAnuncio`; `anuncioRecente` <24h; `prodOrigem` | — | tabela | — | — |
| A11 | 2952-2987 | Janela 14h `fact_conversations`: outbound ≤6, inbound ≤8. Deriva `conversaAtivaHoje`, `ultimaMsgJoao`, `promessaJaDada`, `jaDespediuHoje`, `ackCortesiaJaEnviado`, **`humanoAtivoRecente`** (RX_HUMANO `^\*(Tamires|Helen|Alessandro|Gabriel|Daniel|Edson|Kezia|Equipe)` em outbound <2h), **`humanoNegociou`**, `joaoJaDeuPreco` (qualquer R$ em outbound 14h), `jaPediuPrecoAntes`, `valoresCitados` | — | tabela | — | — |
| A12 | 2988-3028 | `fn_contexto_aprendizados(agente-noturno)` → valida manifesto (sha256, chars, ids, ≤6000 chars); recusa ⇒ `blocoAprendizados=''` | — | RPC | — | logs |
| A13 | 3030-3033 | **Human takeover** | `humanoAtivoRecente \|\| humanoNegociou` | — | `{ok:true, respondeu:false, skip:'humano_ativo'}` | carimba `'humano_ativo'` |
| A14 | 3036-3055 | Reação ❤️ pós-encerramento | `RX_CONFIRMACAO_CURTA` && `RX_ENCERRAMENTO_JOAO` na última msg do João | `messageIdInbound` | `{ok:true, respondeu:false, reagiu, motivo:'confirmacao_curta_pos_encerramento'}` | ledger + Z-API send-reaction governado |
| A15 | 3057-3096 | **Cortesia** | `REGEX_CORTESIA` && (`jaDespediuHoje` ⇒ `cortesia_pos_despedida` \| `cobrancaPendente && !pediuMudanca` ⇒ `cortesia_pos_cobranca`) | — | silêncio deliberado se já enviou ack; senão texto determinístico ('Seu pedido está reservado e o Pix que te mandei continua valendo…' ou despedida por período) | ledger completo, `gravarFio`, carimba |
| A16 | 3099-3104 | `prodMsg`, `obsTurnId`, `obsModalidade` (metro/peça), `obsCorrecoes` | — | — | — | — |
| A17 | 3109-3118 | `historicoInbound`: inbound 180d excluindo últimas 14h, ≤40 | — | tabela | — | — |
| A18 | 3120-3128 | `resolverModalidadeLogistica` (769-845): nível1 msg atual → nível2 inbounds 14h / slots → nível3 histórico → nível4 DDD. `bloqueia_frete` = retirada/motoboy OR pack digital OR (desconhecida && DDD 11). CEP: msg → inbounds → slot → freteJa → histórico | — | memória | — | — |
| A19 | 3132-3135 | Só se `!bloqueia_frete`: `lerPessoaCanonicaPorTelefone` (937, ERP REST `pessoas`) + `refinarCepComCadastro` (CEP de `pessoas` = nível 3, exige confirmação) | — | ERP HTTP | — | logs |
| A20 | 3137-3151 | logs de modalidade | — | — | — | error_log |
| A21 | 3153-3157 | `mudouProduto`, `insistindo`, `blocoMudouProduto` | — | — | — | — |
| A22 | 3166-3176 | `blocoRespostaCurta`: msg ≤3 palavras/≤40 chars && última msg do João tem `?` | — | — | — | — |
| A23 | 3178 | `blocoObjecao` | `objecaoPreco` | — | — | — |
| A24 | 3180-3213 | `hist`: 120 → dedup eco → 60 → remove `[...]` → mescla por role → remove último user se ecoa → `slice(-34)` | — | tabela | — | — |
| A25 | 3215-3218 | `gateFechado` ⇒ `BLOCO_EXECUCOES_SUPRIMIDO` | — | — | — | — |
| A26 | 3219-3224 | `blocoEstado` (só estado fresco), `blocoOrigem`, `pediuPrecoAgora`, `devePrecoJa`, `blocoPreco`, `blocoMudanca` | — | — | — | — |
| A27 | 3226-3234 | **`systemFinal`** montado | — | — | — | — |
| A28 | 3236-3245 | `registrarManifestoJoao` → INSERT `auditoria.prompt_manifesto_joao` (ANTES dos wrappers agirem) | !dryRun | — | — | **ESCRITA** |
| A29 | 3247-3256 | imagens ≤3 → base64; grava `gravarFio` inbound `'(foto enviada pelo cliente)'` | imagens | HTTP | — | **ESCRITA** |
| A30 | 3258-3273 | `arteParaCalculo` = largura×altura×cópias, anulado se `pediuMetrosDiretos` | — | — | — | — |
| A31 | 3275 | `ctx` (autorizacoes, precosAutorizados, rendimentos, cobrancaPendente, permiteMudanca, freteJa, arteParaCalculo, holdArte, modalidadeLogistica, produtoDigital) | — | — | — | — |
| A32 | 3305-3331 | **calcme**: `vw_orcamento_calcme_vigente` ≥0.90; se ausente e msg pede orçamento/pix/fecha → POST edge `joao-orcamento-calcme` (45s) | — | view + edge | — | logs |
| A33 | 3499-3508 | flags: `pediuHumano`, `pediuDesistencia`, `somenteArquivos`, `calcmeAceitouSemMudanca`, `calcmePediuResumo` | — | — | — | — |
| A34 | 3510-3547 | **calcme aceite → Pix automático**: `emitirAutorizacao('orcamento_calcme_entrada', valorEntrada%)` + `executarTool('gerar_pix')`; texto determinístico ou "cobrança não foi emitida agora. Vou tentar novamente" | aceitou && !pediuMudanca | — | decisão sem modelo | **ESCRITA** operacoes_financeiras, orcamentos, mp-pix-criar |
| A35 | 3548-3560 | calcme resumo determinístico | pediu resumo | — | sem modelo | — |
| A36 | 3561-3613 | calcme + mudança: recalcula só quantidade; queda >50% ⇒ recusa | pediuMudanca | — | sem modelo; grava slots calcme_* | — |
| A37 | 3614-3626 | **Humano / LOST**: `criarTask` (edge `agente-pipeline`, `venda_noturna_encaminhada`) e texto fixo "Claro. Registrei seu pedido para uma pessoa da equipe…" / "Entendi. Registrei sua desistência…" | pediuHumano \|\| pediuDesistencia | — | sem modelo | **ESCRITA** task (**NE**: nenhuma escrita de pausa do agente) |
| A38 | 3627-3629 | só arquivos + bloco de arquivos ⇒ `respostaDeterministicaArquivos` (1222) | — | — | sem modelo | — |
| A39 | 3631-3636 | `chamarCerebro()` se `decisao.responde!==true`; em erro com imagem, tenta de novo sem imagem | — | Anthropic | — | `logTokens` INSERT `anthropic_token_usage` |

**Dentro de `chamarCerebro` (3332-3497)** — loop ≤6 iterações, `max_tokens 1100`, timeout 35s; erro HTTP/`type:'error'` ⇒ exceção. Guardas de ferramenta em ordem: (i) `calcular_dtf_metro` com `arteParaCalculo` ⇒ redirecionado a `calcular_dtf_por_arte` (3368-3374); (ii) shadow `avaliarCompatibilidadeTool` (só registra `joao_tool_guard_shadow`); (iii) `calcular_frete` com CEP do cadastro não confirmado ⇒ tool_result erro (3405-3416); (iv) `calcular_frete` com `bloqueia_frete` ⇒ erro `frete_incompativel_com_modalidade` (3417-3446); (v) `executarTool` (1722); (vi) `consultar_tabela_dtf` + `pediuPrecoAgora` ⇒ **retorna decisão determinística com a tabela** sem voltar ao modelo (3462-3470). Texto não-JSON: `extrairJson` (1127) ou texto puro 5-1200 chars sem chaves (3355); texto com cheiro de infra ⇒ exceção (3353).

---
## PARTE B — BLOCOS DO `systemFinal` (3226-3234), na ordem de concatenação

| ordem | bloco | cabeçalho literal | fonte/linha | condição | tamanho | pode contradizer SYSTEM/REGRAS_EXTRA? |
|---|---|---|---|---|---|---|
| 1 | `SYSTEM` | "Você é João Barros…" | 2187-2252 | sempre | 8.341 | (substituído em runtime pelo prompt-core) |
| 2 | `REGRAS_EXTRA` | "REGRAS ADICIONAIS:" | 2254-2271 | sempre | 7.922 | contradiz a si mesmo (ver E) |
| 3 | `blocoAprendizados` | `===ERROS - NUNCA REPETIR===` / `===O QUE FUNCIONA - REPITA===` | 2988-3028 | manifesto válido | ≤6000 (hoje 5.786) | **SIM**: conteúdo vem do banco, sem filtro semântico (também removido pelo prompt-core) |
| 4 | `blocoRelogio()` | `[AGORA: dia, dd/mm, hhhmm (PERÍODO).]` | 473 | sempre | ~50 | não |
| 5 | `blocoGateComercial` | `[ESTADO COMERCIAL CANONICO: …]` / `[… INDISPONIVEL: … PROIBIDO afirmar qual e o pedido atual …]` | 2509-2527 | gate ≠ null | ~200-450 | **SIM** sob fail_closed: proíbe retomar orçamento enquanto `[FICHA]` e histórico existem (P 2525 vs 3219) |
| 6 | `blocoEstado` | `[FICHA: etapa=…; slots=…. NÃO pergunte o preenchido.]` | 3219 | estado <48h | dinâmico | **SIM** vs `[PRIMEIRO CONTATO]` (3230) se não houve outbound em 14h mas estado <48h (P) |
| 7 | `blocoExecucoesEfetivo` | `[JÁ EXECUTADO:\n- …\nRetome do ponto em que parou.]` ou `[MOVIMENTACAO FINANCEIRA RECENTE EXISTE …]` | 579-641 / 2529 | leadId e há cobrança/frete/autorização | dinâmico / 369 | **SIM**: injeta `operation_id` (UUID) enquanto SYSTEM diz "NUNCA escreva um identificador… UUID" (2229) — mitigado só por guarda de saída (P) |
| 8 | `blocoMudanca` | `[ALTERACAO DE PEDIDO: recalcule … NUNCA calcular_dtf_metro …]` | 3224 | `pediuMudanca` | 417 | não |
| 9 | `blocoLocalizacao(phone)` | `[LOCALIZAÇÃO: DDD …]` | 644-656 | DDD mapeado | ~90/~300 | não |
| 10 | `blocoModalidadeLogistica` | `[LOGÍSTICA: PRODUTO DIGITAL…]` / `[MODALIDADE LOGÍSTICA JÁ RESOLVIDA: …]` / `[… NÃO RESOLVIDA …]` | 847-877 | sempre (uma das 5 variantes) | ~250-600 | leve |
| 11 | `blocoCepCanonico` | `[CEP DO CADASTRO: …]` / `[CEP CONFIRMADO …]` / `[CEP AUSENTE: …]` | 1054-1075 | `!bloqueia_frete` | ~150-450 | não |
| 12 | `blocoOrigem` | `[ORIGEM: anúncio "cat"…]` | 3220 | categoria && !mudouProduto | ~100 | não |
| 13 | `blocoAnuncio` | `[ANÚNCIO DE ORIGEM: "título"… NÃO pergunte qual produto …]` | 2940-2943 | externalAdReply existe (qualquer idade) | ≤~700 | **SIM** vs `[PRIMEIRO CONTATO… faça UMA pergunta]` e vs "SIGA O CLIENTE" quando anúncio é velho (P) |
| 14 | `blocoMudouProduto` | `[O CLIENTE MUDOU DE ASSUNTO: …]` | 3156 | prodMsg≠prodOrigem | ~200 | **SIM** com `blocoAnuncio` (coexistem, P) |
| 15 | `blocoPreco` | `[O CLIENTE JÁ PEDIU PREÇO E NÃO RECEBEU NÚMERO…]` | 3223 | `devePrecoJa` | 190 | **SIM** vs guarda de preço v338 e vs p0a ASK_MISSING_FIELD (P) |
| 16 | `blocoObjecao` | `[O CLIENTE ACHOU CARO …]` | 3178 | `objecaoPreco` | ~99 | leve |
| 17 | `blocoRespostaCurta` | `[VOCÊ ACABOU DE PERGUNTAR: "…" O CLIENTE RESPONDEU: "…"…]` | 3170-3175 | msg curta && última msg tem `?` | ~300 | não |
| 18 | `blocoArquivos` | `[ARQUIVOS REAIS DESTE LEAD… — N arquivo(s)…]` | 1195-1219 | uploads 7d | ≤~2.5k | não |
| 19 | conversa | `[Cliente EM CONVERSA hoje…]` **ou** `[PRIMEIRO CONTATO…]` | 3230 | `conversaAtivaHoje` | ~80 | SIM (ver 6, 13) |
| 20 | promessa | `[Promessa de retorno JÁ DITA. Não repita.]` | 3231 | `promessaJaDada` | ~45 | não |
| 21 | formulário | `[FORMULÁRIO DO SITE…]` | 3232 | `ehFormulario` | ~55 | não |
| 22 | pergunta direta | `[PERGUNTA DIRETA…]` | 3233 | `ehPerguntaDireta` | ~45 | não |

Ausentes do prompt (só em código): `calcmeVigente`, `holdArte`, `slotsSalvos` velhos (>48h só servem para `_idioma`). **NE**: nenhum bloco informa ao modelo o `gateFechado` além do bloco 5.

---
## PARTE C — PÓS-MODELO (3638 → 5343), EM ORDEM
Formato: **nome** (linha) · condição · efeito · lê/escreve · retorno. **[+1 modelo]** = novo `chamarCerebro` com nudge (até 6 rodadas de tools cada; retries sequenciais e cumulativos → pior caso 1+14 chamadas).

**C0 saneamento** (3638) `resposta = aberturaCorreta(ajustarSaudacao(sanearMsg(decisao.mensagem)), !conversaAtivaHoje)`. `sanearMsg` (2705): remove emoji, `**`→`*`, "opa", parênteses sem R$, travessão→vírgula, "amanhã a equipe"→"no próximo dia útil…". `ajustarSaudacao` (467) troca "boa noite" pelo período. `aberturaCorreta` (486) apaga saudação do modelo e prepõe `Bom dia!`/… se primeiro contato.

**C1 p0a price-intent gate** (3640-3849) · `p0aPriceHint` = `REGEX_PEDIU_PRECO` ou espanhol · GET REST `fn_joao_price_intent_gate_eval_get_v1(p_session_id, p_message, p_tools_csv, p_legacy_slots_text)` timeout 3.5s.
- falha/`!ok` ⇒ **return `{ok:false, respondeu:false, skip:'P0A_PRICE_INTENT_GATE_UNAVAILABLE'}`** (3687-3697) — **sem carimbo, sem salvarEstado** (inbound fica pendente → sweep repete).
- `ASK_MISSING_FIELD` ⇒ `resposta = pg.required_question`, `decisao` sobrescrita (`tema:'camiseta'`, `etapa:'orcamento'`); vazia ⇒ `skip:'P0A_MISSING_FIELD_WITHOUT_QUESTION'`.
- `REQUIRE_PRICING_TOOL` ⇒ exige `orcar_camisetas`; LIVE `executarTool('orcar_camisetas', pg.required_tool_input)` (emite autorização `produto`); sucesso ⇒ **resposta substituída** por `'Para N peças, fica R$ X por peça e R$ Y no total.'` (3799-3810).
- INSERT `joao_price_intent_gate_events_v1` (3823-3841). **ESCRITA**.

**C2 tabela DTF determinística** (3850-3856) · `pediuPrecoAgora && consultar_tabela_dtf && ctx.tabelaDtfDisplay` ⇒ `resposta = renderTabelaDtfCanonica(...)`.

**C3 promessa repetida** (3857-3861) · (`promessaJaDada` ‖ tema `copo`) && "próximo dia útil" ⇒ remove frases; se <5 chars ⇒ `responde=false`.

**C4 guarda de preço sem ferramenta** (3861-4137) · `temPreco && toolsUsadas.length===0`. Para cada valor: sem produto: `PRECOS_FICHA_FECHADOS`/`PRECOS_DE_FICHA`/`valoresCitados` ⇒ conferido; RPC **`fn_valor_e_legitimo`**: legítimo com fonte ∈ {operacao_financeira, cobranca_emitida, orcamento_enviado} ou já citado ⇒ conferido; legítimo só por tabela global ⇒ **`semFonte` (v338 fail-closed)**; `preco_de_outro_produto` ⇒ `cruzados`; RPC vazia/exceção ⇒ `falhaTecnica` (liberado). Desfecho: cruzados>0 ⇒ `responde=false`; semFonte>0 ⇒ `responde=false` + `JOAO_P0_FINANCIAL_OUTPUT_BLOCKED`; senão liberado e **INVARIANTE 1** (4052-4124, inalcançável — ver E-3).

**C5 negou mídia** (4142-4157) · imagens/áudio && `RX_NEGA_MIDIA` ⇒ **[+1 modelo]**.

**C6 guardrail_preco_nao_autorizado** (4159-4177) · `temPreco && ctx.precosAutorizados.length>0` e valor fora da lista ⇒ **[+1 modelo]**; falha ⇒ `responde=false`.

**C7 guardrail_valor_diverge_cobranca_pendente** (4179-4188) · `cobrancaPendente && !pediuMudanca && temPreco` e R$ ≠ pendente ⇒ `responde=false` (sem retry).

**C8 RX_PROMETE** (4190-4199) · "vou calcular/verificar… um momento" sem R$ ⇒ **[+1 modelo]**.

**C9 devePrecoJa sem R$** (4200-4219) ⇒ **[+1 modelo]** ("MANDE A TABELA… NAO pergunte medida"); aceita qualquer resposta com R$ (**não repassa por C4/C6**).

**C10 frete sem opções** (4222-4229) · `calcular_frete` usada e sem PAC/Sedex/J&T ⇒ **[+1 modelo]**.

**C11 Pix/cartão prometido ou pedido** (4231-4317) · se (pediu‖prometeu) && !código && !pixConfirmado && !cobrancaPendente: lê `operacoes_financeiras` ativas; `escolhida` = kind `total` > `produto` (**frete nunca sozinho**). Com autorização: **[+1 modelo]** com operation_id(s) — aceita só se `ctx.pixGerado.ok`; senão texto original segue. Sem autorização e prometeuPix: **[+1 modelo]** "pergunte o que falta".

**C12 checkout cartão** (4318-4345) · `checkoutOficial` só host mercadopago.com.br; com oficial ⇒ **resposta substituída** `"Segue o link oficial do Mercado Pago…"`; sem ⇒ URLs removidas / texto fixo.

**C13 escolheu pack** (4347-4368) · msg = tema de pack && João listou packs && sem R$ ⇒ **[+1 modelo]**.

**C14 guardrail_rendimento_sem_tool** (4370-4425) · `RX_AFIRMA_RENDIMENTO` sem tool ⇒ **[+1 modelo]**; falha ⇒ `responde=false`.

**C15 guardrail_rendimento_nao_autorizado** (4427-4475) · números ∉ `rendimentosAutorizados` ⇒ **[+1 modelo]**; falha ⇒ `responde=false`.

**C16 RX_JOGA_CONTA** (4477-4484) · "quantos metros você quer…" ⇒ **[+1 modelo]**.

**C17 mudouProduto** (4485-4495) · resposta não menciona produto novo ⇒ **[+1 modelo]**.

**C18 guardrail_tabela_textil_em_contexto_uv** (4496-4508) ⇒ `responde=false`.

**C19 pergunta_repetida** (4509-4643) · `ehMesmaPergunta` vs outbounds 3h ⇒ **[+1 modelo]**; aceita se não repete && não perde R$; se perde ⇒ `removerPerguntaRepetida` cirúrgico; se ambíguo ⇒ **mantém original com a pergunta repetida** (`preservacao_falhou`).

**C20 guardrail_cep_ou_correios_sem_frete** (4645-4704) · `bloqueia_frete && RX_SAIDA_TERMO_FRETE` ⇒ **[+1 modelo]**; fallback remove sentenças; senão texto fixo ("…não tem frete. Pix ou cartão?" / "Você prefere retirar aqui em Embu ou receber por envio?").

**C21 flags terminais** (4706-4716) `promessaCalculoPendente`, `promessaPixPendente`, `promessaCartaoPendente`, `produtoSlot`.

**C22 guardrail_promessa_producao_exata** (4718-4739) · "fica pronto amanhã/hoje…" ⇒ remove frases e **anexa texto fixo de prazo** por produto.

**C23 terminal anti-promessa** (4740-4762) · promessa pendente ⇒ `consultaOperacional` ⇒ `criarTask` + "Registrei sua consulta…"; pix/cartão pendente ⇒ `perguntaDoQueFaltaFechamento`; senão por produto textos fixos. **Substitui texto**.

**C24 validação** (4764-4765) `respondeValido = responde && validarMsg (5-1200 chars, sem [..]/{..}, sem "plantão", sem REGEX_INVENCAO/REGEX_NEGA_VISAO, sem nomes Tamires/Alessandro/Julia/Marcos/Bruno) && validarPix (nenhum número de 14 dígitos fora do QR) && ≤2 parênteses`.

**C25 retry de invalidez** (4767-4826) · !válido ⇒ **[+1 modelo]** (d2); se r2 tem preço sem tool ⇒ checa `fn_valor_e_legitimo` só para `preco_de_outro_produto` — **não bloqueia sem fonte**.

**C26 eco** (4828-4832) · primeiros 60 chars iguais à última msg do João ⇒ inválido.

**C27 fallback determinístico `fechamentoForcado`** (4836-4894) · !válido && !dryRun && !jaDespediuHoje: cobrança pendente ⇒ "Seu pedido está reservado e o Pix de R$X…"; CEP na msg ⇒ **"Anotei seu CEP! Já calculo o frete e te passo o total certinho."**; adesivo ⇒ pede tamanho+quantidade; têxtil ⇒ **tabela hardcoded R$59,90/54,90/49,90/44,90/39,90/35,90** (4864); copo ⇒ **R$35,90 / R$29,90 a partir de 10** (4865); camiseta ⇒ "Me passa primeiro a quantidade de cada tamanho" (4866); pack ⇒ "a partir de R$6,90"; senão cardápio genérico. **Nenhuma guarda de preço roda sobre estes textos.**

**C28 silêncio** (4896-4899) · !válido ⇒ `registrarDecisao('silencio_noturno')`, carimba `'silencio_joao'`, **return `{ok:true, respondeu:false}`**.

**C29 slots + persistência** (4902-5105): produto determinístico (msg > leads_marketing > prodOrigem > slot do modelo); `filtrarSlotsPorProveniencia` (1535): `modalidade_logistica`/`envio_retirada` do modelo **sempre descartados**; `quantidade` numérica exige evidência textual; `cep` só se dito pelo cliente; `grade` não troca sem cliente falar de tamanho. Merge `slotsNovos`; INSERT `joao_slots_observacao`; `persistirCepCanonico` (PATCH ERP `pessoas.cep` ou task); **`salvarEstado`** UPSERT `agente_noturno_estado` (ocorre mesmo se depois superseded).

**C30 p0c apparel guard pre_dry_run** (5107-5180) · intenção de preço && produto `camiseta`; frase com (dimensão && estampa && pergunta) ⇒ remove; se nada sobra ⇒ `p0aAuthorizedResponse` ou "Onde vai a estampa: frente, costas ou manga?".

**C31 dryRun return** (5182-5186).

**C32 código Pix** (5194-5225) · linha `000201…` do modelo é **removida**; `codigoPixEnviado` = `ctx.pixGerado.qr_code` (gerado neste turno, inclusive em retry rejeitado) senão `cobrancaPendente.qr_code`.

**C33 hold arte** (5231-5235) · `holdArtePagamento` ⇒ texto fixo "Combinado! Primeiro a arte vem aqui para você aprovar…" e código suprimido.

**C34 p0c pre_transport** (5238-5249).

**C35 guardaEgressoFinanceiro** (5256-5273, 2823) · UUIDs de `operacoes_financeiras` no texto ⇒ expurgo; texto fixo "Para gerar a cobrança correta eu preciso fechar o pedido no sistema…".

**C36 decisão pré-envio** (5276-5283) · `registrarDecisaoPreEnvio` = RPC `fn_registrar_decisao_agente(p_resultado:'proposta')`; sem id ⇒ **return `{ok:false, skip:'PATRICIA_GOVERNANCE_BLOCKED:PRE_SEND_DECISION_REQUIRED'}`**.

**C37 LOST canônico** (5284-5286) · `pediuDesistencia` ⇒ POST edge `joao-lost-canonico`.

**C38 barreira de frescor** (5287-5303) · inbound pendente mais novo fora do lote ⇒ `finalizarDecisaoSuperseded` e **return `{skip:'superseded_por_inbound_mais_novo'}`** — sem carimbo (estado JÁ salvo em C29).

**C39 envio principal** (5305-5313) · `prepararEnvio` INSERT `joao_envios`; `entregarComoJoao` (2655): áudio via `joao-tts` se elegível e `joao_tts_ativo`; senão `enviarComoJoaoGovernado` (2633): RPC **`fn_conversation_effect_claim_v1`** → `enviarComoJoao` (2409): **Z-API `send-text`**; rejeição HTTP ⇒ fallback **BotConversa** → RPC **`fn_conversation_effect_finish_v1`**. `finalizarEnvioLedger` UPDATE `joao_envios`.

**C40 segundo envio (Pix)** (5320-5328) · `sleep(1200)`, segundo `enviarComoJoaoGovernado` (`payment_payload_main`).

**C41 corpus/carimbo/task** (5331-5338) · `gravarFio` outbound (`fact_conversations`, source 'joao'); `carimbarInbound('atendido_joao')` só se código entregue; `encaminhou_venda` ⇒ `criarTask` via agente-pipeline.

**C42 terminal** (5340-5343) · `finalizarDecisaoEnvio` UPDATE `agente_decisoes_log`; **return `{ok:true, respondeu:enviou, canal, tema, tools, price_gate, apparel_pricing_guard}`**.

---
## PARTE D — DECISÕES COMERCIAIS DETERMINÍSTICAS (fora do modelo)

| decisão | função/linha | condição | efeito |
|---|---|---|---|
| Tabela DTF respondida sem modelo | 3462-3470; C2 3850 | `pediuPrecoAgora` && `consultar_tabela_dtf` ok | resposta = tabela renderizada de `dtf_precos_faixa`/`dtf_uv_degraus` |
| `calcular_dtf_metro` → `calcular_dtf_por_arte` | 3368-3374; 1849-1861 | `arteParaCalculo` | tool substituída |
| Frete bloqueado por modalidade | 3417-3446; 787-792 | retirada/motoboy, pack, ou desconhecida com DDD 11 | `calcular_frete` nunca executa |
| Frete bloqueado sem confirmação de CEP do cadastro | 3405-3416; 1000-1046 | CEP só de `pessoas` | tool_result pede confirmação |
| Frete: escolha só pelo cliente | 1993-2007 | `servico_escolhido` não aparece na msg | recusa |
| Frete já calculado | 1987 | `freteJa && !pediuMudanca` | `ja_calculado` |
| Pix só via `operation_id` UUID existente | 2048-2073 | id ausente/inventado | recusa |
| Pix recusado com cobrança pendente | 2074-2077 | `cobrancaPendente && !permiteMudanca` | `ja_existe` |
| Pix exige modalidade resolvida | 2087-2091 | físico && `desconhecida` | `modalidade_logistica_pendente` |
| Pix para envio exige TOTAL composto | 2092-2101 | envio && op não é total | `envio_sem_total_composto` |
| Pix suspenso por hold de arte | 2052-2055; 5231 | `RX_HOLD_ARTE_PAGAMENTO` | recusa; texto fixo |
| Consumo atômico da autorização | 2104-2134 | Pix criado via `mp-pix-criar` | `orcamentos` INSERT |
| Legitimidade de valor | C4 (`fn_valor_e_legitimo`) | R$ sem tool | bloqueio fail-closed (v338) |
| Valor ≠ cobrança pendente | C7 | cobrança pendente e outro R$ | silêncio |
| calcme aceite ⇒ Pix automático | A34 | PDF CalcMe ≥0,90 && aceite && !mudança | Pix sem modelo |
| LOST / humano | A37; C37 | regex | task + texto fixo + `joao-lost-canonico`; **não pausa o agente** |
| Cortesia | A15 | despedida já feita / cobrança pendente | texto fixo ou silêncio |
| Cliente comprador | A4 | Purchase em `pixel_events` | silêncio |
| Humano ativo | A13 | assinatura da equipe <2h | silêncio |
| Proibição de pedir medida em camiseta (p0c) | C30/C34 | intenção de preço && camiseta | frases removidas |
| Gate de intenção de preço (p0a) | C1 | `REGEX_PEDIU_PRECO` | banco decide pergunta ou `orcar_camisetas` forçada |
| Modalidade só do resolvedor | 1548-1553; 4998-5002 | sempre | modelo nunca escreve `modalidade_logistica` |
| CEP persistido no ERP | 1077-1114 | confirmado, pessoa única | PATCH `pessoas.cep`; senão task |
| Prazo de produção | C22 | promessa de data | texto fixo |
| Fallback com preços fixos | C27 | resposta inválida | tabela hardcoded sem guarda |
| Frescor | C38; 5482-5490 | inbound pendente mais novo | resposta descartada, estado já salvo |

---
## PARTE E — CONTRADIÇÕES INTERNAS DO NÚCLEO (prompt × código, código × código)

1. **ERP autoridade × preço hardcoded no prompt.** SYSTEM 2233-2236/2243 (R$35,90/29,90 copo, A4 R$29,90, A3 R$39,00, kit R$79,90); REGRAS_EXTRA 2255 R$99,00/m. Código: `PRECOS_DE_FICHA` libera só quando `produtoGuarda` é null; com produto DTF a v338 bloqueia valor cuja fonte é só tabela (`semFonte`) — o modelo obedece à ficha e é silenciado. Kit R$79,90 não está em nenhum set. **P**.
2. **Preços fixos no fallback sem guarda.** C27 4864-4866 envia tabela têxtil e copo hardcoded sem `fn_valor_e_legitimo`; contradiz o comentário 1748 ("Nenhum numero fixo aqui"). **P**.
3. **INVARIANTE 1 morta.** 4063-4066 exige fonte ∈ {dtf_uv_degraus, catalogo_produtos}, impossível após v338 ⇒ `autorizacao_preco_de_ficha` inalcançável. **P**.
4. **Retry ignora guarda anterior.** C9, C8, C13, C16, C17, C19, C25 aceitam resposta nova só com `validarMsg/validarPix` — preço inventado no retry sai sem `fn_valor_e_legitimo`. **P**.
5. **Retry de Pix rejeitado ainda entrega o código.** C11 + C32: texto antigo que "promete" + código real. **P**.
6. **"Responder preço × exigir diagnóstico".** REGRAS_EXTRA 2262 "MANDE A TABELA… PROIBIDO responder pergunta de preco com pergunta" + `blocoPreco` vs p0a `ASK_MISSING_FIELD` (pergunta sem preço); SYSTEM 2219 "pergunte a medida do OBJETO" vs REGRAS 2266 "NUNCA peca medidas" (camiseta) vs p0c. **P**.
7. **Grade não é pré-requisito × fallback pede grade.** REGRAS 2265 vs C27 4866. **P**.
8. **"Perguntar de novo × usar estado".** blocos anti-repetição vs fallbacks C27 que ignoram `slotsAtuais`; `preservacao_falhou` devolve a pergunta repetida. **P**.
9. **"Fechar × continuar perguntando".** `gerar_pix` recusa por `modalidade_logistica_pendente` quando DDD≠11 e o cliente só mandou CEP (CEP não é sinal de envio em 715-726) ⇒ loop. **I**. `[JÁ EXECUTADO]` instrui "chame gerar_pix com o operation_id acima" para autorização só de produto, recusada em envio por `envio_sem_total_composto`. **P**.
10. **"Gerar Pix × quote válida" (calcme).** A34 gera Pix com modalidade `desconhecida`/`envio` ⇒ `gerar_pix` recusa e a resposta fixa promete "Vou tentar novamente" sem cobertura de `RX_PROMETE`. **P**.
11. **"Quem passa o valor é a Tamires" × validarMsg.** SYSTEM 2237 manda citar Tamires; `validarMsg` 2722 invalida resposta com esse nome ⇒ retry/fallback. **P**.
12. **Gate fail_closed × cortesia/fallback.** `BLOCO_EXECUCOES_SUPRIMIDO` proíbe citar cobrança; A15 e C27 afirmam "o Pix que te mandei continua valendo" sem checar `gateFechado`. **P**.
13. **Anúncio × primeiro contato.** `blocoAnuncio` convive com `[PRIMEIRO CONTATO…]` e com `[O CLIENTE MUDOU DE ASSUNTO]`. **P**.
14. **UUID no prompt × "NUNCA escreva UUID".** SYSTEM 2229 proíbe; `[JÁ EXECUTADO]` injeta; proteção só na saída (C35). **P**.
15. **Handoff humano sem pausa.** A37 cria task e responde; nenhuma escrita de pausa. **NE**.
16. **Estado salvo antes da barreira de frescor.** `salvarEstado` (5105) antes de C38 ⇒ turno superseded persiste slots de resposta nunca enviada. **P**.
17. **p0a indisponível ⇒ turno morre sem carimbo.** C1 3691 sem `carimbarInbound`; sweep reprocessa a cada 2 min chamando o modelo de novo. **P**.
18. **Voz × conteúdo.** Qualquer R$ torna resposta inelegível para áudio. **P**.
19. **`joaoJaDeuPreco` desliga `blocoPreco`.** Qualquer R$ em outbound 14h (inclusive frete) faz `devePrecoJa=false`. **I**.
20. **`REGEX_PEDIU_MUDANCA` ampla × Pix.** "cancela", "mais \d+", "errado" ⇒ `permiteMudanca` libera `gerar_pix` mesmo com cobrança pendente. **I**.

Contagem de chamadas ao modelo por turno: 1 principal (+1 se imagem falha) + até 14 retries, cada `chamarCerebro` com até 6 rounds de tools. **P**.
