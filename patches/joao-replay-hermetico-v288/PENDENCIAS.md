# PENDÊNCIAS — Fase 0.2-pré, João v5

Tudo que foi visto durante a Fase 0.2-pré e **não** faz parte do escopo. Nada aqui
foi corrigido (regra 0.6 do briefing). Ordenado por consequência.

---

## P1. O núcleo da v288 não tem suporte a replay — bloqueia a Entrega 3

Busca no arquivo 22 (`joao-slot-proveniencia-escrita/candidato/index.ts` @ `0bd29b65`),
que é o núcleo da v288:

| Símbolo | Ocorrências |
|---|---|
| `replay_case_id` | 0 |
| `fn_replay_snapshot` | 0 |
| `__ctxHermetico` | 0 |
| `stubEscritaHermetica` | 0 |

Tudo isso existia no candidato **v4374** (`3063c81c`), para o qual o harness v17 foi
feito. O núcleo da v288 aceita apenas `phone`, `chat_name`, `mensagem`, `inbound_id`,
`_dry_run`, `_sweep`, `_direct_message`.

**Consequência:** sem caminho de snapshot, o núcleo lê **estado vivo do lead**, que
mudou desde o `as_of` dos casos. O baseline dos 29 não seria fiel ao instante gravado.
É a condição da seção 2.3 do briefing — documentado, e parou antes de rodar os 29.

Precedente na própria tabela: o ciclo `0c981cfa` (Isabela) está bloqueado com
`REPLAY_HISTORICO_IMPOSSIVEL_NA_VERSAO_VIVA`, que é o mesmo problema em outro agente.

**Decisão necessária do Alessandro** antes da Entrega 3. Três caminhos, nenhum
executado aqui:
1. construir no harness uma camada de substituição de leitura que sirva
   `contexto_snapshot`/`slots_antes` no lugar de cada leitura viva (trabalho de outra
   ordem; só parcialmente comprovável);
2. um remendo novo, **por fora** dos 38, que reintroduza o contrato de replay;
3. aceitar o baseline com estado vivo, registrando a perda de fidelidade.

---

## P2. `fn_replay_execucao_append_only` é um TRIGGER, não uma função chamável

O briefing (1.3 e 2.4) diz "escrever só via `fn_replay_execucao_append_only` (leia a
assinatura)". A assinatura real:

```
proname                         | args | result
fn_replay_execucao_append_only  |      | trigger
fn_replay_caso_imutavel         |      | trigger
```

Não é RPC: é a trava append-only na própria tabela. A gravação é `INSERT` normal em
`public.replay_execucao`; o trigger é que impede `UPDATE`/`DELETE`.

---

## P3. `replay_execucao` não tem as colunas que a seção 2.4 exige

Colunas que existem: `id, ciclo_id, caso_id, tentativa, candidate_sha, candidate_diff,
modo, as_of_usado, candidato_resposta, candidato_slots, candidato_tools,
candidato_guardrails, candidato_acoes_hipoteticas, veredito, veredito_motivo,
detector_producao, detector_candidato, custo_usd, efeito_zero_ok, erro, executado_em,
executado_por`.

Colunas que a 2.4 pede e **não existem**: `raw_hash`, `normalized_hash`, `bloqueios`,
`anthropic_calls`, `input_tokens`, `output_tokens`, `json_invalido`,
`pergunta_repetida`, `agent_version`.

Como a regra 0.4 proíbe escrita fora de `replay_ciclo`/`replay_execucao` e
`allow_schema_patch` está `false`, **não foi feito nenhum ALTER TABLE**. O mapeamento
proposto (a confirmar antes da Entrega 3):

| Campo 2.4 | Coluna destino |
|---|---|
| `bloqueios` | `candidato_acoes_hipoteticas` (jsonb) |
| `raw_hash`, `normalized_hash`, `json_invalido`, `pergunta_repetida`, `anthropic_calls`, tokens | `detector_candidato` (jsonb) |
| `agent_version` (v288 + v4.26.6) | `candidate_sha` / `detector_candidato` |
| `resposta_bruta` | `candidato_resposta` |
| `tools_chamadas` | `candidato_tools` |

---

## P4. `replay_ciclo.max_casos` tem default 25, e são 29 casos

`max_casos` não foi mencionado no briefing. Default 25 < 29. O ciclo aberto nesta fase
usa `max_casos = 29`.

Observação: `fn_replay_pode_executar` **não** consulta `max_casos` — quem limitar tem
de ser o chamador. Hoje esse limite não é aplicado por ninguém.

---

## P5. `tentativas` é por ciclo, não por caso

No corpo de `fn_replay_pode_executar`:

```sql
if ci.tentativas >= ci.max_tentativas then ... 'LIMITE_TENTATIVAS'
```

É contador único do ciclo. A decisão "3 tentativas por caso" vira, conforme a própria
seção 3.1 do briefing, **`max_tentativas = 87`** (29 × 3). O teto por caso continua
sem ser aplicado pelo banco — cabe ao runner.

---

## P6. Destinos de rede fora da tabela 1.4 do briefing

`grep -ohE "https?://[a-zA-Z0-9./_-]+"` sobre os 38 arquivos pinados:

| Destino | Onde | Estava na 1.4? |
|---|---|---|
| `api.openai.com/v1/audio/transcriptions` | núcleo, linha 2146 (`transcreverAudio`) | **não** |
| `drive.google.com/drive/folders` | preload 17, linha 165 | **não** |
| `drive.usercontent.google.com/download` | preload 17, linha 150 | **não** |
| `pay.smartpag.com.br` | núcleo, linhas 2623 e 3933 — **só comentário**, não é fetch | não |
| `skillprintestamparia.com.br` | núcleo, linha 366 — constante de texto do prompt, não é fetch | não |
| `esm.sh` | import de módulo, não passa por `fetch` | não |

Os três primeiros fazem `fetch` de verdade e estão **bloqueados** no harness. Os
demais não são egresso.

---

## P7. A Anthropic é chamada de dois lugares, não de um

A tabela 1.4 lista só o núcleo (linha ~3182). Existe um segundo sítio:

```
17_external-link-intake-preload-v3.ts:12  const EL_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
22_index.ts:3182                          await fetch('https://api.anthropic.com/v1/messages', ...)
```

Ambos consomem orçamento. O contador do harness é por request e pega os dois, mas
qualquer estimativa de custo feita supondo "1 chamada por caso" vai subestimar.

---

## P8. Ordem da cadeia de `Deno.serve` — a descrição do briefing está invertida

A seção 2.2.5 diz "o handler final é o do arquivo 16 (último a envolver antes do
núcleo)". Os 8 preloads (1, 2, 5, 6, 7, 8, 15, 16) usam
`const prev = Deno.serve.bind(Deno)` + `Deno.serve = ...`, então:

```
capturador ← wrap01( wrap02( wrap05( wrap06( wrap07( wrap08( wrap15( wrap16( núcleo ))))))))
```

\#16 é o último a **instalar**, mas o seu embrulho fica o mais **interno**, colado no
núcleo; **#01 é o mais externo em tempo de request**. Não muda o harness — ele captura
a cadeia inteira — mas a descrição precisa ser corrigida no plano.

---

## P9. Divergência de rótulo de versão (pedida explicitamente na 4.1)

Três rótulos diferentes para a mesma coisa:

| Rótulo | Origem |
|---|---|
| `v288` | número da versão da edge `agente-noturno` e nome do remendo |
| `v4.26.6` | `const V` do núcleo (arquivo 22), gravado em `agent_version` do `prompt_manifesto_joao` e das observações |
| `v4.32.0` … `v4.37.1` | `replay_caso.producao_versao` dos 29 casos |

Ou seja: o `agent_version` que a v288 grava em auditoria (**v4.26.6**) é *anterior* às
versões que produziram os casos (v4.32–v4.37.1). Quem ler `prompt_manifesto_joao` vai
datar errado o artefato. Vale escolher um rótulo único antes da 0.1b.

---

## P10. Leituras nativas preservam o `Authorization` do chamador

`leituraNativa()` força o header `apikey` para a anon key, mas mantém os demais
headers do chamador — comportamento herdado do v17. Vários preloads (01, 07, 08)
carregam `SUPABASE_SERVICE_ROLE_KEY` e o mandam em `Authorization`. Logo uma leitura
liberada pode rodar com service role, não com anon.

Não afeta a hermeticidade (só leitura chega lá; toda escrita é bloqueada antes), mas
não é o privilégio mínimo. Registrado para a Fase 2.

---

## P11. Outras tabelas de replay sem relação com esta frente

No schema `public` do `ldrdtaibazplvrbwyrvx`: `_r34_replay`,
`luciana_origin_replay_v1`, `tiago_3caminhos_replay_evidence_v1`,
`tiago_bypass_replay_evidence_v1`, `tiago_envio_gate_replay_evidence_v1`,
`tiago_replay_nonce_v1`, `tiago_skill_shadow_replay_observations`,
`gate5b_cognitive_replay_proof_versions`,
`gate5b_post_sale_follow_up_replay_proof_versions`, `gate5b_skill_replay_bindings`,
`vw_patricia_replay_oficial_v1`, `replay_efeito_zero`.

Não foram tocadas nem investigadas. Registradas só para constar que existem e que o
vocabulário "replay" está sobrecarregado no projeto.

---

## P12. Segunda linha de config com permissões abertas

`go_ai_dev_config` tem 3 linhas. `fn_replay_pode_executar` lê apenas `nome='default'`.
A linha `go04-budget-canary-20260901` está com `allow_edge_function_patch = true` e
`allow_schema_patch = true` (com `enabled=false`).

Nenhuma chave foi alterada (regra 0.3). Registrado porque uma função futura que leia
a linha errada herdaria permissões abertas.

---

## P13. `replay_execucao` não estava vazia

O briefing (1.3) diz "`public.replay_execucao` — 0 linhas". Havia **26**:

| ciclo | n | executado_por | quando |
|---|---|---|---|
| `7a522685` | 22 | `alessandro/claude-replay-engine-v1` | 2026-08-30 10:01:47 UTC |
| `0c981cfa` | 4 | `alessandro/claude-replay-isabela` | 2026-08-30 10:16:12 UTC |

Todas de 30/08, custo 0, dos dois ciclos bloqueados. Nenhuma do ciclo novo — nada foi
executado nesta fase. A anotação do plano está desatualizada; quem for medir baseline
precisa filtrar por `ciclo_id`, não contar a tabela inteira.

---

## P14. Índice único impede ciclo novo na mesma frente

`replay_ciclo_um_vivo_por_alvo` é único em `(frente_slug, alvo)`
`WHERE estado NOT IN ('promovido','descartado')`. Como `bloqueado` **não** está na
lista de exceções, um ciclo bloqueado ocupa o slot para sempre.

O ciclo `7a522685` (bloqueado, `joao-parametro-financeiro-sem-proveniencia` /
`agente-noturno`) impediu abrir o ciclo desta fase nessa frente. Não foi descartado
para liberar o slot — é a evidência do vazamento de 30/08. O ciclo novo foi aberto sob
`joao-replay-hermetico-v288`.

Consequência para o plano: ou "bloqueado" entra nas exceções do índice, ou cada ciclo
novo precisa de um `frente_slug` distinto. Hoje o vocabulário de `estado`
(`aberto`, `bloqueado`, `promovido`, `descartado`) não tem um estado terminal para
"bloqueado e arquivado".

---

## P15. Teste de boot da edge não foi possível nesta sessão

O proxy de egresso nega `ldrdtaibazplvrbwyrvx.supabase.co:443` (403, política da
organização), então a edge `agente-noturno-replay-v288` não pôde ser invocada por
HTTP. Publicação e bundle estão provados; o carregamento em runtime não.

Falta rodar `POST {"modo":"inspecionar"}` com `Bearer REPLAY_RUNNER_JWT`. Esperado:
`camadas_fetch_capturadas: 33`, `deno_serve_chamadas: 1`, `handler_producao: true`.

---

# Fase 0.2-pré-B (13/09/2026)

## P16. `fn_joao_repeat_order_context_by_inbound_v1` fica bloqueada

É `STABLE` e não escreve, mas lê estado **mutável** que o palco não capturou (histórico
de pedidos por inbound). Não dá para servir do palco nem para rodar ao vivo sem furar o
determinismo. Está em `BLOCK` por padrão (regra "leitura não classificada = BLOCK").

O preload 27 (`repeat-order-history-preload-v1`) a chama. Casos que dependam de
histórico de recompra vão ver a chamada bloqueada e podem divergir de produção.

**Para fechar:** acrescentar a saída dela a `rpc_saidas` numa recaptura
(`versao_palco = 2`), como já é feito com as outras três RPCs de contexto.

---

## P17. `REPLAY_RUNNER_JWT` não está no Vault — rota C1 indisponível

`select name from vault.secrets` devolve 14 segredos; **nenhum é o do runner de
replay**. Os que existem: `botconversa_api_key_v1`, `cortex_gate6c_supabase_anon_jwt`,
`go_multimodel_edge_key_v1`, `internal_edge_cron_shared_secret_v1`,
`meta_graph_access_token_v1`, `patricia_shadow_edge_token`,
`rd_crm_webhook_shared_secret_v1`, `rd_legacy_oauth_client_id_v1`,
`rd_legacy_oauth_client_secret_v1`, `rd_stage_sync_cron_token`,
`ricardo_edge_cron_token`, `v5_auditor_patricia_runtime_password`,
`v5_executor_worker_runtime_password`, `zapi_webhook_ingress_secret_v1`.

O segredo existe apenas como **variável de ambiente da edge**
(`Deno.env.get('REPLAY_RUNNER_JWT')`), que o banco não alcança.

A sonda `fn_replay_v288_boot_probe_v1` foi criada e **falha fechada** com
`SEGREDO_AUSENTE_NO_VAULT` e a instrução de cadastro. Assim que o valor for cadastrado
como `replay_runner_jwt_v1`, a rota C1 passa a funcionar sem mais nenhuma mudança.

Não cadastrei o segredo: não conheço o valor, e inventá-lo seria pior que parar.

---

## P18. `pixel_events` congelada por lead, não inteira

32.565 linhas na tabela. Congelar inteira em 29 palcos seria inviável. O palco guarda
só as linhas do `lead_id` do caso. Se algum caminho do núcleo ler `pixel_events` por
outro critério (visitor_id, campanha), o filtro não vai bater e a leitura devolverá
vazio em vez de bloquear — é o único ponto do roteamento onde "vazio" pode mascarar
uma leitura fora do palco.

Baixo risco (o núcleo lê `pixel_events` em 1 sítio), mas vale cravar na 0.1b.

---

## P19. `TZ` da edge não verificado

O relógio congelado preserva o timezone do runtime; a §3.2 do briefing pede confirmar
que a edge roda em `America/Sao_Paulo`. `modo: "inspecionar"` devolve o `TZ`, mas o
boot não pôde ser executado (P17/P15). **Conferir junto com o boot.** Se a edge rodar
em UTC e produção também, não há problema; divergência entre as duas é que quebraria
horário comercial e saudação.

---

## P20. `max_casos` do ciclo não é aplicado por ninguém

Já registrado em P4; reforçado agora que o palco existe: `fn_replay_pode_executar` não
consulta `max_casos`, e o harness também não. O teto de 29 é hoje apenas documental.
