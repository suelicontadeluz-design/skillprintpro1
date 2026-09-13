# RELATÓRIO — Fase 0.2-pré-B, plano João v5

**Data:** 13/09/2026
**Escopo:** Entrega A (palco congelado), Entrega B (harness serve o palco), Entrega C (teste de boot).
**Nenhum caso de replay foi executado.** `allow_replay_execution` continua `false`.

---

## 1. Resultado em uma linha

Entregas A e B fechadas e publicadas. **Entrega C parcialmente bloqueada:**
`REPLAY_RUNNER_JWT` não está no Vault, então nem a rota C1 nem o sandbox alcançam a
edge. A sonda está pronta e falha fechada; falta um segredo que eu não tenho.

| # | Critério (§6 do briefing) | Estado |
|---|---|---|
| 1 | `replay_palco_congelado` com 29 linhas, hashes preenchidos | **✅** |
| 2 | `agente-noturno-replay-v288` v2 por SHA; v1 preservada | **✅** |
| 3 | Boot: 33 / 1 / true / true / true | **❌ bloqueado** — §4 |
| 4 | Ensaio do controle: sem `NATIVO` em mutável | **❌ bloqueado** pelo mesmo motivo |
| 5 | Relógio: 3 provas | **⚠️ implementadas e instrumentadas, não executadas** — §4 |
| 6 | João v288 `updated_at` inalterado | **✅** |
| 7 | `allow_replay_execution=false`, `replay_execucao` sem linha nova | **✅** |
| 8 | `LEIA-ME.md` atualizado | **✅** |

---

## 2. Entrega A — Palco congelado

### Objetos criados

`public.replay_palco_congelado` — PK **`(caso_id, versao_palco)`** (o briefing sugeria
PK só em `caso_id` e depois pedia a troca para permitir recaptura; já nasceu na forma
final). Índice `(caso_id, versao_palco desc)`.

`public.fn_replay_congelar_palco_v288(p_caso_id uuid, p_por text)` — `SECURITY
DEFINER`, lê negócio só para copiar, escreve **só** em `replay_palco_congelado`.
`execute` revogado de `public`, `anon`, `authenticated`.

### Captura dos 29

```
total | com_estado | com_rpc | com_hashes | com_overlay | com_erro_rpc
  29  |     29     |   29    |     29     |     29      |      0
```

Janela: **2026-09-13 02:10:25 → 02:10:40 UTC** (15 s). Todos `versao_palco = 1`.

**Prova de ausência de drift durante a captura:** `count(distinct hashes->>'sistema_config') = 1`
e `count(distinct hashes->>'catalogo_produtos') = 1` — as tabelas globais têm hash
idêntico nos 29 palcos.

`overlay_slots_antes = true` nos 29: o campo `slots` de `agente_noturno_estado` foi
sobrescrito por `replay_caso.slots_antes` em todos.

Conteúdo por palco: **12 tabelas** + **3 saídas de RPC**, ~144 kB.

| Grupo | Tabelas |
|---|---|
| Escopo do lead | `agente_noturno_estado`, `leads_marketing`, `orcamentos`, `vw_orcamento_calcme_vigente`, `lead_identificadores`, `pixel_events` |
| Tabela inteira (pequenas) | `sistema_config` (41), `catalogo_produtos` (105), `dtf_precos_faixa` (10), `dtf_uv_degraus` (4), `dtf_produto_config` (2) |
| Sempre vazia | `agente_noturno_lock` |
| RPCs | `fn_contexto_comercial_do_lead`, `fn_contexto_aprendizados`, `fn_agente_pausado` — **0 erros de captura** |

### Fidelidade — declarada, não escondida

O palco é o estado de **hoje**, não de `as_of`, e isso está gravado no `comment` da
tabela, no `LEIA-ME.md` §6 e no campo `capturado_em`. O estado histórico nunca foi
fotografado. O que o palco garante é **determinismo**: as duas execuções comparadas
veem o mesmo palco.

---

## 3. Entrega B — Harness v2

Publicado: commit **`7d76c60`**, edge `agente-noturno-replay-v288` **version 2**,
`ezbr_sha256 7781b9c974d3b63be6d5ecd2ee46d97365b15fbb9d7ae13435274ef65bf18384`.
v1 (`85d55be`) preservada no histórico da edge.

### Roteamento (grep refeito sobre os 38 nos SHAs pinados)

O levantamento da §1 do briefing estava **incompleto**: os remendos leem por URL crua
muito mais do que a tabela listava.

| Achado | Detalhe |
|---|---|
| `sistema_config` | 20 sítios em REST cru + 2 via `.from()` — congelada |
| `sistema_logs` | 19 sítios (não constava) — append-only, corte `as_of` |
| `lead_identificadores` | preload 10 (não constava) — congelada |
| `pessoas` | está no **ERP** → já bloqueada |
| **15 RPCs por URL crua** | não constavam; classificadas abaixo |

Classificação das RPCs por natureza real (`pg_proc.provolatile` +
`pg_get_functiondef ~ insert|update|delete`):

- **Escritoras → BLOCK:** `fn_compor_total`, `fn_get_or_create_lead`,
  `fn_joao_authorize_freight_choice_v1`, `fn_joao_erp_pricing_receipt_record_v1`,
  `fn_joao_erp_proposal_receipt_record_v1`, `fn_joao_pagamento_em_curso_v1`.
  **Confirmado conforme pedido:** `fn_get_or_create_lead` e `fn_compor_total` escrevem
  e estão fora de `SAFE_READ_RPCS`.
- **IMMUTABLE (puras) → ao vivo:** `fn_qualification_evaluate_v2`,
  `fn_closing_evaluate_v1`, `fn_joao_explicit_close_signal_v2`. São função pura dos
  argumentos; rodar ao vivo é determinístico.
- **STABLE sobre tabela de preço congelada → ao vivo:** `fn_precificar_dtf_uv_v2`,
  `fn_dtf_uv_capacidade_folha`, `fn_valor_e_legitimo`.
- **STABLE lendo mutável não capturada → BLOCK:**
  `fn_joao_repeat_order_context_by_inbound_v1` (P16).
- **No ERP → BLOCK:** `fn_cortex_pricing_calculation_v1`,
  `fn_cortex_proposal_snapshot_v1`, `fn_joao_lancar_orcamento_v1`,
  `fn_listar_modelos_disponiveis`, `fn_orcar_camisetas_agente`.

### Filtros PostgREST em memória

`eq`, `neq`, `in`, `is`, `gt`, `gte`, `lt`, `lte` + `select`, `order`, `limit`,
`offset`; `Accept: vnd.pgrst.object+json` respeitado (objeto ou 406 `PGRST116`);
`content-range` emitido. **Filtro desconhecido — `and`, `or`, `not.` incluídos — vira
`BLOCK filtro_nao_suportado`, nunca "devolve tudo"**, como a §3.1 exige.

### Relógio congelado

`globalThis.Date` substituído **antes** do import: `Date.now()` e `new Date()` sem
argumento devolvem `as_of + decorrido real` (monotônico, não parado); construtor com
argumento e métodos de instância intactos (`F.prototype = Date.prototype`, então
`instanceof Date` continua valendo). Fora de request, relógio real.

As três provas da §3.2 estão **implementadas e instrumentadas** em
`modo: "inspecionar"` (`proximo_de_as_of`, `Date_now_monotonico`,
`construtor_com_argumento_intacto`), mas **não puderam ser executadas** — §4.

### Determinismo do modelo

`temperature: 0` injetado no corpo ao liberar `api.anthropic.com`, com
`temperature_forcada: true` registrado. `normalized_hash` passou a ser a **projeção
dura** (`responde`, `etapa`, `tema`, `encaminhou_venda`, `slots`, tools,
`json_invalido`); o texto de `mensagem` **saiu do gate** e virou relatório, conforme o
gate de dois níveis da §3.3 — já documentado no `LEIA-ME.md` §8 para a 0.1b.

### Trilha de leituras

Toda resposta traz `leituras: [{alvo, destino, filtro_aplicado}]` com
`destino ∈ {PALCO, ASOF, NATIVO_CALC, BLOCK}` e o campo de gate
**`nativo_em_mutavel`** (tem de ser 0).

---

## 4. Entrega C — bloqueada, e por quê

### C1 (preferida) — impossível hoje

A §4 mandava verificar se `REPLAY_RUNNER_JWT` existe no Vault. **Não existe.**
`select name from vault.secrets` devolve 14 segredos, nenhum do runner de replay
(lista completa em `PENDENCIAS.md` P17). O segredo vive só como variável de ambiente
da edge — que o banco não alcança.

Mesmo assim deixei a infraestrutura pronta:

- `public.replay_ciclo.detalhes` (jsonb) — coluna criada.
- `fn_replay_v288_boot_probe_v1(ciclo_id)` — lê o segredo do Vault, faz `net.http_post`
  para `/functions/v1/agente-noturno-replay-v288` com `{"modo":"inspecionar"}`.
- `fn_replay_v288_boot_probe_colher_v1(request_id, ciclo_id)` — colhe de
  `net._http_response`, avalia os 5 critérios de aceite e grava em
  `replay_ciclo.detalhes`.

Retorno real da sonda hoje:

```json
{
    "ok": false,
    "motivo": "SEGREDO_AUSENTE_NO_VAULT",
    "detalhe": "cadastrar o valor de REPLAY_RUNNER_JWT em vault.secrets com name=replay_runner_jwt_v1",
    "como": "select vault.create_secret('<valor>', 'replay_runner_jwt_v1', 'JWT do runner de replay v288');"
}
```

Não cadastrei o segredo: não conheço o valor, e inventá-lo seria pior que parar.

**Basta cadastrá-lo** e C1 passa a funcionar sem mais nenhuma mudança:

```sql
select vault.create_secret('<valor de REPLAY_RUNNER_JWT>', 'replay_runner_jwt_v1', 'JWT do runner de replay v288');
select public.fn_replay_v288_boot_probe_v1('920aedd5-fd26-4529-b651-2861403aac1d'::uuid);
-- depois, com o request_id devolvido:
select public.fn_replay_v288_boot_probe_colher_v1(<request_id>, '920aedd5-fd26-4529-b651-2861403aac1d'::uuid);
```

### C2 (fallback) — comando pronto para o Alessandro

O proxy de egresso desta sessão nega `ldrdtaibazplvrbwyrvx.supabase.co:443` (403 de
política), então o `curl` tem de sair da máquina dele. O segredo **não** aparece no
texto:

```bash
export REPLAY_RUNNER_JWT='...'   # o mesmo valor da env da edge

# 1) boot — aceite: 33 / 1 / true / true / true
curl -sS -X POST \
  https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/agente-noturno-replay-v288 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $REPLAY_RUNNER_JWT" \
  -d '{"modo":"inspecionar"}' | jq

# 2) ensaio do caso controle — aceite: nativo_em_mutavel = 0, handler_chamado = false
curl -sS -X POST \
  https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/agente-noturno-replay-v288 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $REPLAY_RUNNER_JWT" \
  -d '{"modo":"ensaiar","caso_id":"3b3560fe-b830-43c9-a8ee-66a2e3cab9a2"}' | jq
```

Ambos têm custo zero e efeito zero: `inspecionar` não toca em caso nenhum e `ensaiar`
para **antes** de chamar o handler.

### O que fica em aberto por causa disso

Critérios 3, 4 e 5 do §6 não puderam ser marcados. Em particular: **o harness v2 nunca
foi carregado em runtime.** Publicação e bundle estão provados
(`ezbr_sha256` emitido, arquivos servidos pelo raw com o hash certo), mas o
carregamento da composição sob a jaula, a contagem das 33 camadas e as provas do
relógio continuam por verificar. Também por isso o `TZ` da edge segue não confirmado
(P19).

---

## 5. Conformidade

| Regra | Estado |
|---|---|
| Não tocar em `agente-noturno` | **cumprida** — version **288**, `updated_at 1789257400509` = **2026-09-12 23:56:40 UTC**, inalterado |
| Não editar nenhum dos 38 arquivos | cumprida — diff da branch só toca `patches/joao-replay-hermetico-v288/` |
| Não alterar `go_ai_dev_config` | cumprida — `allow_replay_execution = false`; `max(updated_at)` = **2026-09-11 06:30:16 UTC** |
| Não rodar caso com o handler | cumprida — `replay_execucao` = 26 linhas, **0 novas** (todas de 30/08) |
| Escrever só em `replay_palco_congelado` e `replay_ciclo.detalhes` | cumprida — mais o `INSERT` do ciclo, da fase anterior |
| Não ligar a trava | cumprida |

```
allow_replay_execution | config_updated_max          | replay_execucao_total | novas | palcos | ciclos
        false          | 2026-09-11 06:30:16.117+00  |          26           |   0   |   29   |   3
```

---

## 6. Próximo passo

1. **Cadastrar `REPLAY_RUNNER_JWT` no Vault** como `replay_runner_jwt_v1` (ou rodar o
   `curl` da C2). Sem isso o boot não acontece e nada além disso avança.
2. Rodar boot + ensaio; conferir 33 / 1 / true / true / true e
   `nativo_em_mutavel = 0`.
3. Recaptura `versao_palco = 2` incluindo
   `fn_joao_repeat_order_context_by_inbound_v1` em `rpc_saidas` (P16), se os casos de
   recompra importarem para o baseline.
4. Só então o GO da trava.
