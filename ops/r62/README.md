# R62 — O MAPA econômico passa a consumir a recorrência econômica validada na R61

**Data:** 2026-08-26
**Projeto Supabase:** `ldrdtaibazplvrbwyrvx`
**Modo:** leitura/publicação econômica do MAPA. Objeto NOVO em canário. Zero alteração no gating operacional.

**Regra central da rodada:**
> O MAPA não deve apenas dizer: "216 clientes recompram." Ele deve saber quantos são
> comprovados, quantos são incertos, quanto dinheiro existe em cada classe e por que
> acredita nisso.

---

## §0 — Reancoragem LIVE

| Métrica | Valor |
|---|---|
| Clientes econômicos | 510 |
| Receita comercial | R$ 645.223,80 |
| Recorrentes econômicos | 216 (42,35%) |
| Receita dos recorrentes | R$ 453.276,14 |
| LTV observado médio / mediano | R$ 1.265,14 / R$ 487,78 |
| ALTA | 181 · R$ 412.462,05 |
| MEDIA | 2 · R$ 1.888,28 |
| BAIXA | 33 · R$ 38.925,81 |
| NAO_RECORRENTE | 294 · R$ 191.947,66 |

---

## §1/§2 — Gate dos 11 recorrentes do mesmo dia: **PASSOU**

Os 11 clientes com `dias_distintos_de_compra = 1` se separam **apenas** por regra,
sem nenhum julgamento implícito:

| cliente_key | compras | com deal | dias | classe | por quê |
|---|---|---|---|---|---|
| `5b8083a4…` (Igreja Batista) | 2 | 2 | 1 | **MEDIA** | ≥2 com deal, mesmo dia |
| `LEAD:b0b2e90c…` | 2 | 2 | 1 | **MEDIA** | ≥2 com deal, mesmo dia |
| `LEAD:10b72e15`, `1c475d7d`, `2d9f0ff8`, `49ae3cc3`, `7ccb8a6a`, `7f0441c8`, `ad079d17`, `c316b896`, `ecf18c80` | 2–3 | 0–1 | 1 | **BAIXA** | `<2` com deal → BAIXA precede MEDIA na cascata |

Toda classe é derivável de `compras_com_deal_canonico` + `dias_distintos_de_compra`.
**Zero julgamento manual → o gate não obriga PARAR.**

---

## §3 — As 33 BAIXA em detalhe

| | |
|---|---|
| Clientes | 33 (todos com chave `LEAD:`, nenhum `EVT:`) |
| Compras | 88 |
| Receita | R$ 38.925,81 |
| Compras **com** deal canônico | 27 |
| Compras **sem** deal canônico | 61 |
| Clientes 100% sem deal | 6 |
| Clientes com exatamente 1 deal | 27 |
| Clientes com ≥2 deals | **0** |
| **Seriam recorrentes sem os fatos sem deal** | **0 de 33** |

**Os 33 BAIXA são recorrentes SOMENTE por fatos sem deal canônico.** Nenhum deles
sobrevive à remoção desses fatos. BAIXA não é evidência equivalente a ALTA e o MAPA
publica isso explicitamente (`nao_promover`).

Produtores das 61 compras sem deal:

| produtor | compras | receita | janela |
|---|---|---|---|
| `csv_backfill` | 33 | R$ 5.650,00 | 30/01 – 04/05 |
| UUID (`fn_sync_crm_pixel_insert`, retirada) | 15 | R$ 8.621,01 | 12/02 – 10/07 |
| `mp_pix` | 7 | R$ 1.135,35 | 21/07 – 16/08 |
| `manual_calcme_*` / `manual_alex_*` | 6 | R$ 3.603,19 | 27/04 – 29/07 |

`manual_calcme_*` e `manual_alex_*` são **produtores não catalogados até esta rodada**.

---

## §4 — Métricas econômicas oficiais publicadas

Todas saem de `vw_cliente_economico_canario` e `vw_clientes_recorrentes_economico` (R58/R61),
nenhuma foi recalculada por caminho novo.

---

## §5 — Nomenclatura de LTV

O MAPA publica **`ltv_observado`** e apenas ele, com três campos de contenção:

```
"definicao": "soma das compras JA OBSERVADAS por cliente ate hoje"
"nao_e_previsao": true
"proibido": "usar como LTV preditivo, valor de vida esperado, ou base para CAC alvo"
```

LTV preditivo entra como incerteza **U13 / FORA_DO_ESCOPO** — não como número.

---

## §6/§7 — O que é o MAPA e qual o raio de alcance

Três coisas distintas usam a palavra "mapa":

| objeto | o que é | econômico? |
|---|---|---|
| `sistema_mapa` (21 linhas) | mapa de **arquitetura** (componente/entradas/saídas/depende_de) | não |
| `vw_mapa_sistema`, `vw_mapa_agentes` (23 linhas) | decisões e autonomia de agente | não |
| **`fn_mapa_cerebro_v0() → jsonb`** (40.181 chars) | **o MAPA econômico** | **sim** |

Raio de alcance medido de `fn_mapa_cerebro_v0`:

- funções que a citam: **0**
- views que a citam: **0**
- crons ativos: **0**
- `pg_stat_statements` (reset 16/08, 10 dias): chamada **somente** pela role `postgres`
  (console SQL). Zero chamadas por `authenticator`/`service_role`, que é como toda edge
  function chega ao banco.
- edge functions com "cérebro" no nome: `cerebro-vendas` e `teste-cerebro`.
  `cerebro-vendas` foi lido por inteiro: ele usa `fn_contexto_meta_cerebro`,
  `fn_prompt_rules_ativas`, `fn_contexto_real_cliente`, `fn_calcular_score_base` —
  **não** o MAPA.

**Conclusão:** o MAPA econômico é contexto de leitura, sem consumidor automático.

---

## §8 — Decisão: paralelo, não promoção

Mesmo com raio de alcance zero, a rodada seguiu a via mais conservadora do §8:
**`fn_mapa_cerebro_v0` não foi tocada** (hash idêntico antes/depois) e foi criado um
objeto novo:

```
public.fn_mapa_cerebro_econ_v2() -> jsonb   -- LANGUAGE sql, STABLE, SECURITY INVOKER
```

Ele **chama** `fn_mapa_cerebro_v0()` e faz merge aditivo. Não reimplementa nada, não
copia nenhum número do V0, e por construção não pode divergir dele.

---

## §9/§10 — O que o V2 acrescenta

`estado.cliente_economico`:

- `clientes`, `compras`, `receita_comercial`, `receita_atribuivel`, `receita_sem_atribuicao`
- `composicao_do_fato`: PURCHASE 1600 + IDENTIDADE_DEAL 9 = 1609
- `ltv_observado` (médio 1.265,14 · mediano 487,78 · p90 2.884,39 · máx 25.243,55)
- `recorrencia`: 216 recorrentes, taxa 42,35%, `comprovados_alta` 181,
  `incertos_media_baixa` 35, `por_confianca` (4 classes com dinheiro em cada),
  `criterio_confianca`, `por_que_acredita`, `sensibilidade`, `nao_promover`
- `base_de_prova`: 1393 com deal / 216 sem deal (86,6%)
- `residuo_sem_deal_canonico`: 216 fatos · R$ 83.522,60 · 133 clientes · REGISTRADO_NAO_RESOLVIDO
- `canarios`: os 4 casos nominais, com ressalva onde existe suspeita
- `nao_usar_para`: gating operacional

**Separação receita comercial × receita atribuível (§10):**

| classe | receita comercial | receita atribuível | % |
|---|---|---|---|
| ALTA | R$ 412.462,05 | R$ 53.464,13 | 13,0% |
| MEDIA | R$ 1.888,28 | R$ 0,00 | 0% |
| BAIXA | R$ 38.925,81 | R$ 6.047,68 | 15,5% |
| NAO_RECORRENTE | R$ 191.947,66 | R$ 15.233,05 | 7,9% |
| **total** | **R$ 645.223,80** | **R$ 74.744,86** | **11,6%** |

Este 11,6% **não substitui** o `pct_receita_atribuivel = 21,5` já codificado no V0: os
denominadores são diferentes. Ambos ficam expostos, e a diferença é registrada como
contradição **C6** em vez de um número sobrescrever o outro.

Também entram: incertezas **U11** (216 fatos sem deal), **U12** (3 PROVAVEL + 12
SEM_EVIDENCIA), **U13** (LTV preditivo), **U14** (pares quase idênticos no RD), e uma
auto-refutação registrando a separação economia × operação (R60/R61/R62).

---

## §11 — Canários: **PASSOU**

| canário | classe | esperado | veredito |
|---|---|---|---|
| Igreja Batista `5b8083a4` | **MEDIA** | MEDIA | **OK — não é ALTA** |
| Vanessa Büher `cbfe9287` | ALTA (26 compras, 26 com deal, 25 dias) | ALTA | OK |
| Kleberson `d74e8ace` | ALTA (23 compras, 19 com deal, 17 dias) | ALTA | OK |
| Gabriela Zeferino `LEAD:eb813b70` | ALTA (7 compras, 7 dias) | ALTA | OK |

`falha_se_ALTA = false` para a Igreja é publicado dentro do próprio MAPA, para que o
teste continue rodando toda vez que o MAPA for lido.

Ressalva registrada: existem **três** clientes cujo nome contém "Gabriela"
(`Gabriela de Oliveira Zeferino Santos` ALTA, `Gabriela Vieira de Souza Correa`
NAO_RECORRENTE, `Marlia Gabriela Pereira` NAO_RECORRENTE). O canário fixa a chave, não o nome.

---

## §12 — MAPA_OLD × MAPA_ECON_V2

Comparação feita com **as duas versões calculadas na mesma transação**
(`WITH ... AS MATERIALIZED`), para não confundir mudança de código com deriva de fonte viva:

| verificação | resultado |
|---|---|
| chaves de topo novas / perdidas | `[]` / `[]` |
| `estado`: chaves novas | `["cliente_economico"]` |
| `estado`: chaves perdidas | `[]` |
| **`estado`: blocos antigos alterados** | **`[]`** |
| `capacidades` / `objetivos` / `gargalos` / `relacoes` | idênticos |
| `incertezas` | 11 → 15, as 11 antigas preservadas **na mesma ordem** |
| `contradicoes` | 5 → 6, as 5 antigas preservadas |
| `auto_refutacao` | 5 → 6, as 5 antigas preservadas |
| `lacunas_criticas` / `fontes_stale` / `cobertura_estimativa` | idênticos |
| `veredito` / `confianca_global` | `MAPA_PARCIAL` / `media` em ambos |

**V2 é superset estrito de V0.** Nada foi sobrescrito.

> Uma primeira comparação, feita com os dois MAPAs capturados em chamadas separadas,
> acusou 2 blocos antigos alterados (`receita_observada_pixel`, `vendas_observadas_pixel`).
> Investigado antes de seguir: os **valores** eram idênticos (103.615,39 e 253); só o
> `atualizado_em` da fonte havia avançado entre as duas chamadas. A comparação na mesma
> transação acusa 0. Não era diferença de código.

---

## §13 — Gating operacional intocado (prova pós-escrita)

| objeto | hash | igual ao registrado |
|---|---|---|
| `fn_lead_eh_recorrente` | `b8013b034c6955e52a06e0842f77eba7` | sim |
| `fn_julia_pode_atender` | `0582ae31b19c68d0cc67665b1582f2b7` | sim |
| `fn_agente_automatico_pode_atender` | `d22ac0fd2e6d57c4fd183c717272ae59` | sim |
| `vw_clientes_recorrentes_chat` | `8637ee584c19a834221fe8145562574a` | sim |
| `fn_mapa_cerebro_v0` | `001b8bd6f34e1ee90438b3642a6f4369` | sim |
| `julia_config.julia_atende_recorrentes` | `false` | sim |
| hash conjunto das views que leem Purchase | `9621d7113893d2937900db35f2dbfc8b` | sim |

Nota de método: os hashes de função registrados desde a R60 são `md5(prosrc)`.
Uma leitura com `md5(pg_get_functiondef())` devolve outros valores — foi conferido que
a diferença é da expressão, não do código.

---

## §14 — GPS: não conectado

O GPS existe e é grande (17 tabelas, 7 views, 7 funções). Nenhum objeto GPS cita
`recorrent`, `ltv`, `cliente_economico` ou `mapa_cerebro`; nenhum cron ativo cita GPS.
Como o GPS **não consome** essas métricas hoje, ele **não foi conectado** nesta rodada.

---

## §15 — Performance

| chamada | execuções |
|---|---|
| `fn_mapa_cerebro_v0()` | 3 ms · 23 ms |
| `fn_mapa_cerebro_econ_v2()` | 72 ms · 28 ms |

Mesma ordem de grandeza; a diferença fica dentro do ruído entre execuções. Capturas em
cache frio chegaram a 589 ms para o V0.

**Armadilha registrada:** chamar V0 e V2 **na mesma consulta**, com subqueries
correlacionadas referenciando os dois, passou de 90 s e teve de ser cancelado — as
funções `LANGUAGE sql` são *inlined* e cada referência reavalia o corpo inteiro. A
comparação correta materializa os dois JSONs primeiro (`AS MATERIALIZED` ou tabela de
artefato) e só então compara — e mesmo assim capturar os dois na mesma transação custou
18,2 s (V0) + 58,5 s (V2). Chamado sozinho, cada um custa dezenas de ms.

**Armadilha registrada (2):** medir o tempo sem materializar o `jsonb` devolve 3 ms
falsos — o planner elimina a chamada quando o resultado não é usado. É a mesma armadilha
da R59.

---

## §16 — Auto-refutação

1. **"V2 é superset"** — testado na mesma transação: 0 blocos antigos alterados,
   0 chaves perdidas, arrays antigos preservados em ordem. **Sobrevive.**
2. **"Igreja é MEDIA, logo o gate passou"** — sobrevive como *classe*, mas a recorrência
   inteira da Igreja depende de dois deals de `466,68` (17:58) e `466,80` (18:17) do
   mesmo 23/02/2026, com `deal_id` distintos. Se forem uma venda duplicada no RD, a
   Igreja **deixa de ser recorrente**. Registrado como **U14** e como ressalva dentro do
   próprio canário. **Não foi silenciado.**
3. **"216 recorrentes"** — piso medido: se todo fato sem deal canônico for descartado,
   caem para **183** (−33 clientes, R$ 38.925,81 em risco). Publicado como
   `recorrencia.sensibilidade`. O número não é um intervalo fechado.
4. **"1609 compras"** — conferido: 1600 `PURCHASE` + 9 `IDENTIDADE_DEAL` (R$ 5.250,41,
   exatamente as 9 identidades provadas da R57). `deal_id` duplicado: **0**.
   `event_id` duplicado: **0**. **Sobrevive.**
5. **"11,6% de receita atribuível"** — não sobrevive como número único: conflita com o
   21,5% já codificado no V0. Resolvido expondo os dois com seus denominadores (C6), não
   escolhendo um.

---

## §17 — Veredito

**VALIDADO EM CANÁRIO. NÃO PROMOVIDO.**

- O MAPA econômico agora sabe dizer, de dentro de si: 510 clientes, R$ 645.223,80,
  216 recorrentes, **181 comprovados / 35 incertos**, dinheiro por classe, o critério de
  cada classe, o piso da recorrência e os quatro resíduos abertos.
- `fn_mapa_cerebro_v0` continua sendo o MAPA vigente, byte a byte.
- `fn_mapa_cerebro_econ_v2` tem **0 consumidores** — é canário, por escolha.
- Promoção (apontar quem lê o MAPA para o V2) é decisão de uma próxima rodada.

---

## §18 — Objetos desta rodada

**Criados**
- `public.fn_mapa_cerebro_econ_v2() -> jsonb`
- `public._r62_mapa_snapshot` (artefato: OLD, NEW, PAIR_OLD, PAIR_NEW, PERF_*)

**Alterados:** nenhum.
**Removidos:** nenhum.

Rollback: `DROP FUNCTION public.fn_mapa_cerebro_econ_v2(); DROP TABLE public._r62_mapa_snapshot;`
Como nada consome o V2, o rollback é total e não tem efeito colateral.

---

## Continua aberto (registrado, não tocado)

- 216 Purchase sem `deal_id` — R$ 83.522,60, 133 clientes (U11)
- 3 identidades PROVAVEL (R$ 1.859,23) e 12 deals SEM_EVIDENCIA (R$ 7.392,95) (U12)
- LTV preditivo inexistente (U13)
- Pares quase idênticos no RD: Igreja `466,68/466,80`, Kleberson `1.799,79` (U14)
- Produtores `manual_calcme_*` / `manual_alex_*` não catalogados
- Débito da R60/R61: nome enganoso de `fn_lead_eh_recorrente`, perna morta da função,
  gate `julia_atende_recorrentes=false` ativo, caso `559c601d`
- `fn_fechar_tasks_apos_compra`; 329 órfãos de mapa; `crm_deals_cache` congelado desde 16/08
