# João replay hermético v288

Harness para reexecutar a composição **v288** — a mesma que está publicada na edge
`agente-noturno` — dentro de uma jaula de rede, sem deixar efeito nenhum sair.

Fase 0.2-pré do plano João v5. **A edge `agente-noturno` não foi tocada.**

---

## 1. Arquivos

| Arquivo | O que é |
|---|---|
| `composicao-v288.ts` | Cópia **byte-idêntica** de `patches/agente-noturno-index-20260912/v288.ts`. Os mesmos 38 imports, nos mesmos SHAs. É a fotografia versionada; não editar. |
| `harness.ts` | O wrapper. Instala a jaula, importa a composição, captura o handler de produção e executa um caso. |
| `LEIA-ME.md` | Este arquivo. |

Prova de identidade (seção 5, item 2):

```
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/agente-noturno-index-20260912/v288.ts
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/joao-replay-hermetico-v288/composicao-v288.ts
```

Edge publicada: **`agente-noturno-replay-v288`** (slug novo). A edge
`agente-noturno-replay` v17 **não foi republicada** — continua sendo o harness do
candidato v4374 e pode ser necessária.

---

## 2. Por que o v17 não servia como está

O v17 chama `installOwnSupabaseReadBridge()` **dentro do handler**, isto é, *depois*
do `import` do candidato:

```ts
let current: any = globalThis.fetch;   // ← já é a cadeia pronta, sem política
Object.defineProperty(globalThis, 'fetch', { get(){return current;}, set(fn){ current = /* política */ } });
```

O `defineProperty` só intercepta reatribuições **futuras**. O candidato v4374
(`3063c81c`) era hermético por conta própria, então isso bastava.

A v288 não é. **33 dos 38 arquivos reatribuem `globalThis.fetch` no momento do
`import`** — todos já aconteceram quando o v17 instalaria a ponte. A política nunca
envolveria nenhuma das camadas.

Correção: a ponte é instalada **antes** do `import` da composição. A raiz da cadeia
passa a ser `baseFetch` (a jaula), e toda reatribuição passa pelo setter.

Os 38 arquivos capturam a base sempre da mesma forma —
`const xxBaseFetch = globalThis.fetch.bind(globalThis)` — então, com a ponte já
instalada, todos recebem a jaula.

---

## 3. Onde a política é aplicada

Em dois pontos, de propósito:

1. **Guarda por camada** (no `set` do `defineProperty`): corta `BLOCK` na origem, sem
   esperar chegar ao fundo. `ALLOW_*` **desce a cadeia**, para que os preloads
   continuem podendo interceptar e transformar leituras — é isso que preserva a
   fidelidade com produção.
2. **`baseFetch`** (raiz): resolve `ALLOW_NATIVE` (leitura nativa com anon key) e
   `ALLOW_ANTHROPIC` (única chamada real), e bloqueia o que sobrar.

Só o bloqueio registra em `bloqueios`, e ele curto-circuita — não há contagem dupla.

### Tabela de destinos (lista fechada; default = `BLOCK`)

| Destino | Decisão | Motivo |
|---|---|---|
| `api.anthropic.com/v1/messages` | **ALLOW** | única chamada real; é ela que consome o orçamento |
| `<SUPABASE_URL>/rest/v1/*` GET/HEAD | **ALLOW** | leitura |
| `<SUPABASE_URL>/rest/v1/rpc/<fn>` POST, `fn ∈ SAFE_READ_RPCS` | **ALLOW** | RPC read-only |
| `<SUPABASE_URL>/rest/v1/rpc/<fn>` POST, fora da lista | BLOCK | `rpc_fora_da_lista:<fn>` |
| `<SUPABASE_URL>/rest/v1/<tabela>` POST/PATCH/PUT/DELETE | BLOCK | `escrita_tabela:<tabela>` |
| `<SUPABASE_URL>/functions/v1/*` | BLOCK | `edge_function_invocacao` |
| `<ERP_URL>` (`ynjsflvdfftcopibzxyo`) | BLOCK | `erp_supabase` |
| `api.z-api.io` | BLOCK | `zapi_whatsapp` |
| `backend.botconversa.com.br` | BLOCK | `botconversa` |
| `api.mercadopago.com` | BLOCK | `mercadopago` |
| `api.frenet.com.br` | BLOCK | `SEM_REPRODUCAO_FRETE` |
| `api.openai.com` | BLOCK | `openai_transcricao_audio` — **fora da tabela 1.4 do briefing** |
| `drive.google.com`, `drive.usercontent.google.com` | BLOCK | `google_drive_intake` — **fora da tabela 1.4** |
| `pay.smartpag.com.br` | BLOCK | `smartpag_checkout` — só em comentário, mas listado |
| qualquer outro | BLOCK | `destino_nao_mapeado` |

`SAFE_READ_RPCS` foi herdada literalmente do v17: `fn_agente_pausado`,
`fn_contexto_aprendizados`, `fn_contexto_comercial_do_lead`,
`fn_dtf_uv_capacidade_folha`, `fn_precificar_dtf_uv_v2`, `fn_valor_e_legitimo`,
`fn_replay_snapshot`. Nenhuma foi acrescentada.

`raw.githubusercontent.com` não aparece na tabela porque a resolução dos 38 imports
acontece no `import`, antes de qualquer `fetch` — não passa pela jaula.

---

## 4. Vias de fuga: não há

Varredura sobre os 38 arquivos pinados:

- `EdgeRuntime.waitUntil` — **0 ocorrências**
- `XMLHttpRequest` / `new WebSocket` — **0 ocorrências**
- captura de fetch fora de `globalThis.fetch` — **0 ocorrências**

O canal de saída é único: `globalThis.fetch`. Por isso a jaula na raiz é suficiente.

---

## 5. Por que 409

Corpo: `{ok:false, hermetic_block:true, target:<host>, motivo, dry_run:true}`.

`grep -nE "\b409\b"` nos 38 arquivos devolve 4 sítios, e **todos produzem** 409 —
nenhum o consome como retry:

```
01_dry-run-effect-zero-preload-v1.ts:133  drzJson({... 'dry_run_sem_operacao_produto_sintetica'}, 409)
01_dry-run-effect-zero-preload-v1.ts:136  drzJson({... 'dry_run_consumo_uv_invalido'}, 409)
01_dry-run-effect-zero-preload-v1.ts:189  drzJson({... 'dry_run_effect_zero_write_blocked'}, 409)
10_output-guard-v3-human-takeover.ts:208  ogJson({ ok:false, error:'human_takeover_active' }, 409)
```

409 é terminal para a v288, e o formato escolhido é o mesmo que o preload 01 já usa
para escrita bloqueada. Não se devolve 200 com sucesso sintético — esse é exatamente
o defeito que a Fase 0.1 vai corrigir.

---

## 6. Cadeia de `Deno.serve` — e a lacuna de contrato

### A cadeia

Oito preloads envolvem `Deno.serve`, todos no mesmo padrão
(`const prev = Deno.serve.bind(Deno)` e depois `Deno.serve = ...`), nesta ordem de
import: **1, 2, 5, 6, 7, 8, 15, 16**. O núcleo (arquivo 22) apenas *chama*
`Deno.serve(handler)`, não reatribui.

O harness substitui `Deno.serve` por um capturador **antes** do import. Logo o núcleo
chama a versão de #16, que embrulha e delega para #15, …, até #1, que entrega ao
capturador o handler **completamente embrulhado**:

```
capturador  ←  wrap01( wrap02( wrap05( wrap06( wrap07( wrap08( wrap15( wrap16( handlerDoNucleo )))))))) 
```

Em tempo de request a ordem se inverte: **#01 é o mais externo** e #16 o mais interno,
colado no núcleo. (O briefing descreve #16 como "o handler final"; #16 é o último a
*instalar*, mas o seu embrulho é o mais *interno*. O que o harness captura é a cadeia
inteira, que é o que importa.)

`modo: "inspecionar"` devolve `camadas_fetch_capturadas` e `deno_serve_chamadas` para
conferir isso em tempo de execução.

### A lacuna — leia antes de rodar qualquer caso

**O núcleo da v288 não tem suporte a replay.** Busca no arquivo 22
(`joao-slot-proveniencia-escrita/candidato/index.ts` @ `0bd29b65`):

```
replay_case_id      → 0 ocorrências
fn_replay_snapshot  → 0 ocorrências
__ctxHermetico      → 0 ocorrências
stubEscritaHermetica→ 0 ocorrências
```

Tudo isso era do candidato **v4374** (`3063c81c`), que tinha replay embutido: lia
`body.replay_case_id`, chamava `fn_replay_snapshot(p_caso_id)` e servia o estado de
`payload.slots_before`.

O núcleo da v288 aceita apenas `phone`, `chat_name`, `mensagem`, `inbound_id`,
`_dry_run`, `_sweep`, `_direct_message`. Sem caminho de snapshot, **ele leria estado
vivo do lead** — que mudou desde o `as_of` do caso. Isso é exatamente o que a seção
2.3 do briefing manda não deixar acontecer.

Fechar essa lacuna exigiria ou editar os 38 arquivos (proibido pela regra 0.2) ou
construir no harness uma camada de substituição de leitura que sirva
`contexto_snapshot`/`slots_antes` no lugar de cada leitura viva que o núcleo faz —
trabalho de outra ordem, e só parcialmente comprovável.

Por isso o harness é **fail closed** nesse ponto: sem
`aceitar_contrato_divergente: true` explícito no corpo, ele devolve **422
`CONTRATO_V288_SEM_SNAPSHOT`** e não executa. Conforme a seção 2.3, isso está
documentado e **parou antes de rodar os 29**.

---

## 7. Como rodar

`POST` para a edge, com `Authorization: Bearer <REPLAY_RUNNER_JWT>`.

Diagnóstico, não executa caso nenhum:

```json
{ "modo": "inspecionar" }
```

Execução de um caso:

```json
{ "ciclo_id": "<uuid>", "replay_case_id": "<uuid>" }
```

Ordem das travas, todas fail-closed:

1. credencial do servidor (`role=replay_runner`, `ref=ldrdtaibazplvrbwyrvx`, `exp`)
2. `Authorization` comparado em tempo constante
3. **`fn_replay_pode_executar(ciclo_id)`** — se `pode ≠ true`, devolve **423** com o
   retorno do gate. Hoje bloqueia em `ALLOW_REPLAY_EXECUTION_FALSE`, como esperado.
4. `CONTRATO_V288_SEM_SNAPSHOT` — **422** (seção 6)

Ligar `go_ai_dev_config.allow_replay_execution` é decisão do Alessandro. O harness
não altera nenhuma chave de configuração.

---

## 8. Saída

```jsonc
{
  "ok": true,
  "harness": "joao-replay-hermetico-v288/harness-v1",
  "composicao_sha256": "b33776a0...",
  "caso_id": "...", "ciclo_id": "...",
  "entrada": { "phone": "...", "mensagem": "...", "inbound_id": "..." },
  "resposta": { "status": 200, "json": { "responde": true, "mensagem": "...", "slots": {} } },
  "raw_hash": "...",
  "normalized_hash": "...",
  "bloqueios": [ { "url": "...", "metodo": "POST", "motivo": "escrita_tabela:error_log", "origem": "..." } ],
  "anthropic": { "calls": 1, "input_tokens": 0, "output_tokens": 0, "custo_usd": 0.0, "tarifa": {} }
}
```

### `normalized_hash`

sha256 do JSON da resposta após, nesta ordem:

1. remover as chaves `decision_id`, `execution_id`, `operation_id`, `operation_ids`,
   `created_at`, `executed_at`, `duracao_ms`, `tempo_execucao_ms`, `messageId`;
2. remover `*_id` cujo valor case com UUID v4, e `*_at` cujo valor seja string;
3. ordenar chaves recursivamente;
4. colapsar espaços em branco nas strings (`\s+` → ` `, com trim).

A Fase 0.1b tem de usar exatamente esta definição. Ela está implementada em
`normalizar()` / `ehVolatil()` no `harness.ts` — reaproveitar de lá, não reescrever.

### Tarifa

`claude-haiku-4-5-20251001` — **US$ 1,00 / MTok entrada**, **US$ 5,00 / MTok saída**.
Fonte: `public.go_ai_model_pricing` (`effective_from` 2026-08-31 23:10 UTC).

Atenção ao contar custo: **há dois sítios que chamam a Anthropic**, não um.
O núcleo (arquivo 22, linha 3182) e o preload 17
(`external-link-intake-preload-v3.ts`, `EL_ANTHROPIC`). O briefing 1.4 só listava o
primeiro. O contador do harness é por request e pega os dois.

---

## 9. O que este harness **não** faz

- Não escreve em `replay_execucao`. A gravação depende de rodar caso, e nenhum caso
  foi rodado nesta fase. O formato de saída acima é o que será gravado, e a seção 2.4
  do briefing pede campos que **não existem** na tabela — ver `PENDENCIAS.md`.
- Não altera `go_ai_dev_config`.
- Não toca em `agente-noturno` nem em `agente-noturno-replay` v17.
- Não edita nenhum dos 38 arquivos.
