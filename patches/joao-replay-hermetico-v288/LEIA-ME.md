# João replay hermético v288

Harness para reexecutar a composição **v288** — a mesma publicada na edge
`agente-noturno` — dentro de uma jaula, sem deixar efeito nenhum sair **e** sem
deixar o núcleo ler estado vivo.

Fases 0.2-pré e 0.2-pré-B do plano João v5. **A edge `agente-noturno` não foi tocada.**

| Versão | Commit | O que entrou |
|---|---|---|
| harness v1 | `85d55be` | jaula de rede, captura do handler de produção |
| harness v2 | `7d76c60` | palco congelado, relógio congelado, `temperature=0`, trilha de leituras, modo `ensaiar` |

---

## 1. Arquivos

| Arquivo | O que é |
|---|---|
| `composicao-v288.ts` | Cópia **byte-idêntica** de `patches/agente-noturno-index-20260912/v288.ts`. Os mesmos 38 imports, nos mesmos SHAs. Fotografia versionada; não editar. |
| `harness.ts` | O wrapper. |
| `LEIA-ME.md`, `PENDENCIAS.md`, `RELATORIO-0.2-PRE.md`, `RELATORIO-0.2-PRE-B.md` | Documentação e evidências. |

```
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/agente-noturno-index-20260912/v288.ts
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/joao-replay-hermetico-v288/composicao-v288.ts
```

Edge: **`agente-noturno-replay-v288`**. A edge `agente-noturno-replay` v17 **não foi
republicada** — segue sendo o harness do candidato v4374.

---

## 2. Por que o v17 não servia como está

O v17 chama `installOwnSupabaseReadBridge()` **dentro do handler**, isto é, *depois*
do `import` do candidato:

```ts
let current: any = globalThis.fetch;   // ← já é a cadeia pronta, sem política
Object.defineProperty(globalThis, 'fetch', { get(){return current;}, set(fn){ current = /* política */ } });
```

`defineProperty` só intercepta reatribuições **futuras**. O candidato v4374
(`3063c81c`) era hermético sozinho, então bastava. A v288 não é: **33 dos 38 arquivos
reatribuem `globalThis.fetch` no `import`**. Aqui a ponte é instalada **antes** do
import, e a raiz da cadeia passa a ser `baseFetch` (a jaula). Os 38 capturam a base
sempre como `globalThis.fetch.bind(globalThis)`, então todos a recebem.

---

## 3. Tabela de roteamento completa

Levantada por `grep` sobre os 38 arquivos **nos SHAs pinados** — não nas versões do
HEAD, que são diferentes. **Default = `BLOCK`.** Qualquer leitura fora desta tabela é
`leitura_nao_classificada`.

### Tabelas mutáveis → `PALCO` (servidas de `replay_palco_congelado`)

`agente_noturno_estado` · `leads_marketing` · `orcamentos` ·
`vw_orcamento_calcme_vigente` · `lead_identificadores` · `pixel_events` ·
`sistema_config` · `catalogo_produtos` · `dtf_precos_faixa` · `dtf_uv_degraus` ·
`dtf_produto_config`

`agente_noturno_lock` → sempre `[]` (efêmera; escrita já bloqueada).

### Tabelas append-only → `ASOF` (nativo, com corte)

`inbound_fora_horario` · `fact_conversations` · `operacoes_financeiras` ·
`joao_envios` · `agente_decisoes_log` · `error_log` · `mp_pix_cobrancas` ·
`anthropic_token_usage` · `arte_uploads` · `joao_slots_observacao` ·
`joao_tool_guard_shadow` · `prompt_manifesto_joao` · `sistema_logs`

Todas têm `created_at`; a URL ganha `&created_at=lte.<as_of>` e vai nativa.

### RPCs

| Grupo | Funções | Destino |
|---|---|---|
| Contexto (saída congelada) | `fn_contexto_comercial_do_lead`, `fn_contexto_aprendizados`, `fn_agente_pausado` | `PALCO` |
| Calculadoras | `fn_precificar_dtf_uv_v2`, `fn_dtf_uv_capacidade_folha`, `fn_valor_e_legitimo` (STABLE sobre tabelas de preço congeladas); `fn_qualification_evaluate_v2`, `fn_closing_evaluate_v1`, `fn_joao_explicit_close_signal_v2` (**IMMUTABLE**, puras) | `NATIVO_CALC` |
| Escritoras (confirmadas por `pg_get_functiondef ~ insert\|update\|delete`) | `fn_compor_total`, `fn_get_or_create_lead`, `fn_joao_authorize_freight_choice_v1`, `fn_joao_erp_pricing_receipt_record_v1`, `fn_joao_erp_proposal_receipt_record_v1`, `fn_joao_pagamento_em_curso_v1`, `fn_registrar_decisao_agente`, `fn_emitir_operacao_financeira`, `fn_joao_adquirir_lock`, `fn_marcar_*`, `fn_finalizar_*`, `fn_consumir_*` | `BLOCK` |
| Leitora de mutável **não capturada** | `fn_joao_repeat_order_context_by_inbound_v1` (STABLE, lê estado vivo) | `BLOCK` — ver `PENDENCIAS.md` P16 |
| No ERP | `fn_cortex_pricing_calculation_v1`, `fn_cortex_proposal_snapshot_v1`, `fn_joao_lancar_orcamento_v1`, `fn_listar_modelos_disponiveis`, `fn_orcar_camisetas_agente` | `BLOCK` (host ERP) |

Confirmado conforme pedido: **`fn_get_or_create_lead` e `fn_compor_total` escrevem** e
estão fora de `SAFE_READ_RPCS`. Se algum caso precisar de `fn_compor_total` para
reproduzir a decisão, registrar `SEM_REPRODUCAO_COMPOR_TOTAL`.

### Destinos externos

| Destino | Decisão |
|---|---|
| `api.anthropic.com/v1/messages` | **ALLOW** (única chamada real; consome o orçamento) |
| `<ERP_URL>` (`ynjsflvdfftcopibzxyo`) · `pessoas` e afins | BLOCK |
| `api.z-api.io` · `backend.botconversa.com.br` · `api.mercadopago.com` · `pay.smartpag.com.br` | BLOCK |
| `api.frenet.com.br` | BLOCK `SEM_REPRODUCAO_FRETE` |
| `api.openai.com` · `drive.google.com` · `drive.usercontent.google.com` | BLOCK (fora da tabela 1.4 do briefing) |
| `<SUPABASE_URL>/functions/v1/*` | BLOCK |
| qualquer outro | BLOCK `destino_nao_mapeado` |

`raw.githubusercontent.com` e `esm.sh` não aparecem: resolvem no `import`, antes de
qualquer `fetch`.

### Filtros PostgREST aplicados em memória

Sobre o palco: `eq`, `neq`, `in`, `is`, `gt`, `gte`, `lt`, `lte`, mais `select`,
`order`, `limit`, `offset`. Cabeçalho `Accept: application/vnd.pgrst.object+json`
respeitado (devolve objeto, ou 406 `PGRST116` se não houver exatamente 1 linha).
**Filtro desconhecido — inclusive `and`, `or`, `not.` — vira `BLOCK
filtro_nao_suportado`. Nunca "devolve tudo".**

---

## 4. Vias de fuga: não há

Nos 38 arquivos pinados: `EdgeRuntime.waitUntil` → **0**;
`XMLHttpRequest`/`new WebSocket` → **0**; captura de fetch fora de `globalThis.fetch`
→ **0**. O canal de saída é único.

---

## 5. Por que 409

Corpo: `{ok:false, hermetic_block:true, target:<host>, motivo, dry_run:true}`.

`grep -nE "\b409\b"` devolve 4 sítios e **todos produzem** 409; nenhum o consome como
retry — três no preload 01 (`dry_run_effect_zero_write_blocked` etc.) e um no
preload 10 (`human_takeover_active`). 409 é terminal para a v288, e o formato é o
mesmo que o preload 01 já usa. Não se devolve 200 com sucesso sintético — esse é o
defeito que a Fase 0.1 vai corrigir.

---

## 6. Fidelidade declarada — leia isto antes de interpretar qualquer resultado

**O palco é o estado do momento da captura (`capturado_em`), não de `as_of`.**

O estado histórico dos 29 leads **nunca foi fotografado**. Medido em 13/09:

| Fonte candidata | O que tem de fato |
|---|---|
| `replay_caso.contexto_snapshot` | anotação humana (`por_que_este_caso`, `decisao_do_dono_pendente`), não fotografia |
| `replay_caso.slots_antes` | útil — os slots do turno; é o que entra no overlay |
| `agente_decisoes_log.contexto` | metadado de entrega (`provider`, `envio_estado`), não estado do lead |
| tabela de "estado no instante T" | **não existe** |

Reproduzir o passado com fidelidade é impossível — é ausência de dado, não escolha.

**O que o palco garante é DETERMINISMO:** v288 e v288-com-patch (0.1b), e depois v288
e prompt-por-estado (1.4), veem **exatamente o mesmo palco**. É disso que a comparação
precisa. A comparação com `producao_resposta` (v4.32–v4.37) é **informação, nunca
gate** — a produção rodou noutra versão.

Recaptura: **nunca atualizar** uma linha de `replay_palco_congelado`; gravar
`versao_palco+1`. O harness usa sempre a maior versão e devolve qual usou.

---

## 7. Relógio congelado

O núcleo usa relógio em ~37 sítios e os remendos em ~62 (`new Date()`/`Date.now()`):
saudação `[AGORA]`, horário comercial, "turno velho", expiração de lock,
`jaDespediuHoje`. Sem congelar, dois replays do mesmo caso divergem pela hora do dia.

Antes do `import` da composição, `globalThis.Date` vira um wrapper:

- `Date.now()` e `new Date()` **sem argumento** → `as_of + (tempo real decorrido desde
  o início do request)`. Monotônico, não parado — código que mede duração continua
  funcionando.
- Construtor **com** argumento e todos os métodos de instância: inalterados
  (`F.prototype = Date.prototype`, então `instanceof Date` continua valendo).
- Fora de um request (sem contexto) cai no relógio real.

`modo: "inspecionar"` devolve `prova_relogio` com as três provas:
`proximo_de_as_of`, `Date_now_monotonico`, `construtor_com_argumento_intacto`, e o
`TZ` da edge.

---

## 8. Determinismo do modelo e o gate de dois níveis

A chamada à Anthropic no núcleo (L3182) **não passa `temperature`** → default 1.0 → o
texto de `mensagem` varia entre duas execuções com prompt idêntico. Isso quebraria o
hash sem haver regressão.

O harness **injeta `temperature: 0`** no corpo ao liberar `api.anthropic.com`, e marca
`temperature_forcada: true`. É ajuste de harness, não da v288.

Ainda assim não é 100% determinístico. Por isso o gate tem **dois níveis** — e isto
atualiza a §0.1b do plano-mãe:

| Nível | O que entra | Efeito |
|---|---|---|
| **Duro** | `responde`, `etapa`, `tema`, `encaminhou_venda`, `slots`, tools (nome + argumentos comerciais), `json_invalido` | **É o `normalized_hash`.** Divergência reprova. |
| **Brando** | texto de `mensagem` — similaridade (Jaccard de tokens ≥ 0,85) e comprimento ±30% | Relatório. Divergência brando-só **não** reprova. |

`normalized_hash` = sha256 da **projeção dura**, após: remover
`decision_id`, `execution_id`, `operation_id`, `operation_ids`, `created_at`,
`executed_at`, `duracao_ms`, `tempo_execucao_ms`, `messageId`; remover `*_id` com
valor UUID e `*_at` string; ordenar chaves; colapsar espaços.

A 0.1b tem de usar exatamente esta definição — está em `normalizar()` /
`projecaoDura()` no `harness.ts`. Reaproveitar de lá, não reescrever.

**Custo:** `claude-haiku-4-5-20251001` — US$ 1,00/MTok entrada, US$ 5,00/MTok saída
(fonte `public.go_ai_model_pricing`, `effective_from` 2026-08-31 23:10 UTC). Há **dois
sítios** que chamam a Anthropic: núcleo L3182 e preload 17 (`EL_ANTHROPIC`). O contador
pega os dois.

---

## 9. Como rodar

`POST`, `Authorization: Bearer <REPLAY_RUNNER_JWT>`.

```jsonc
{ "modo": "inspecionar" }                                  // diagnóstico; não executa caso
{ "modo": "ensaiar",  "caso_id": "<uuid>" }                // monta tudo e para antes do handler; custo 0
{ "modo": "executar", "ciclo_id": "<uuid>", "replay_case_id": "<uuid>" }
```

Travas, todas fail-closed, nesta ordem:

1. credencial do servidor (`role=replay_runner`, `ref=ldrdtaibazplvrbwyrvx`, `exp`)
2. `Authorization` comparado em tempo constante
3. palco do caso — sem ele, **424 `PALCO_AUSENTE`**
4. **`fn_replay_pode_executar(ciclo_id)`** — `pode ≠ true` → **423** com o retorno do
   gate. Hoje bloqueia em `ALLOW_REPLAY_EXECUTION_FALSE`.

Ligar `go_ai_dev_config.allow_replay_execution` é decisão do Alessandro. O harness não
altera chave de configuração nenhuma.

### Gate de efeito zero na resposta

`nativo_em_mutavel` **tem de ser 0**. Qualquer valor acima disso significa que uma
tabela mutável escapou para leitura ao vivo — o palco tem furo, e o roteamento precisa
ser corrigido antes de seguir.

---

## 10. Palco: tabela e captura

```sql
select public.fn_replay_congelar_palco_v288('<caso_id>'::uuid, 'quem');
```

`public.replay_palco_congelado` — PK `(caso_id, versao_palco)`. `estado` é
`{tabela: [linhas]}`; `rpc_saidas` é `{fn: saída}`; `hashes` traz sha256 por tabela
(detecção de drift) e `overlay_slots_antes`.

`agente_noturno_estado` é capturada com o campo `slots` **sobrescrito por
`replay_caso.slots_antes`** quando este não é nulo — é o único pedaço de estado
histórico real que existe.

A função é `SECURITY DEFINER`, lê negócio apenas para copiar e escreve **só** em
`replay_palco_congelado`.

---

## 11. O que este harness **não** faz

- Não escreve em `replay_execucao` (nenhum caso foi executado até aqui).
- Não altera `go_ai_dev_config`.
- Não toca em `agente-noturno` nem em `agente-noturno-replay` v17.
- Não edita nenhum dos 38 arquivos.
