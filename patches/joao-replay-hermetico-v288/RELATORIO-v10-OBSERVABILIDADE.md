# Harness de replay v10 — observabilidade de produto + palco sem futuro

**Data:** 13/09/2026 · **Autoriza:** Alessandro · **Executor:** Claude Code
**Projeto:** `ldrdtaibazplvrbwyrvx` (cérebro-vendas) · **Repo:** `suelicontadeluz-design/skillprintpro1`
**Branch:** `claude/harness-replay-v10-observability-egsq5r`

> **Estado: PARADA OBRIGATÓRIA cumprida.** Os 31 casos **não** foram rodados.
> `allow_replay_execution` continua `false`. Aguardando GO explícito.

---

## 0. O que foi entregue

| | Entrega | Onde |
|---|---|---|
| E1 | Observabilidade de slot e proveniência | `observabilidade-v10.ts` + migration `…_replay_observabilidade_slot_proveniencia_v10.sql` |
| E2 | Palco as-of de verdade (`versao_palco=3`) | migration `…_replay_palco_asof_v3.sql` |
| E3 | Separar "chegou ao modelo" de "guard interrompeu" | mesmos artefatos de E1 |

Provas reproduzíveis: `testes/observabilidade-v10.test.ts` (21 testes, Node) e
`testes/provas-v10.sql` (tabela-verdade, prova fim-a-fim com rollback, aceite do palco).

---

## 1. Segurança — o que NÃO foi tocado

- **`agente-noturno` (João de produção) não foi alterado.** Nenhum deploy, nenhum patch.
- **Nenhuma edge foi publicada.** `allow_edge_function_patch=false` foi respeitado: o
  harness v3 fica no repositório, e o bootstrap de `agente-noturno-replay-v288` continua
  pinado no SHA antigo. Repinar é ato do GO, não desta entrega.
- **`allow_replay_execution=false`** — verificado antes e depois. Nenhuma execução de caso.
- **Nenhuma interceptação nova.** Não há uma sobrescrita nova de `globalThis.fetch` nem de
  `Deno.serve`. A ponte e o relógio são exatamente os da v2; o que mudou é que dois pontos
  que **já existiam** (`anthropicNativa` e `bloquear`) passaram a registrar o que viam e
  jogavam fora. Não é o 38º remendo.
- **Nenhuma linha de promoção de produto.** `observabilidade-v10.ts` só classifica a origem
  de um valor **já resolvido**. Quem resolve produto continua sendo o núcleo; mudar isso é
  o Candidate A.
- **Nenhum segredo exposto.** `REPLAY_RUNNER_JWT` não aparece em log, output nem neste
  relatório. Do Anthropic só é guardado o **texto de saída** do modelo (limitado a 4 000
  caracteres por chamada, 5 chamadas); prompt e headers nunca.
- **Palcos anteriores preservados.** `fn_replay_congelar_palco_v3` **recusa** sobrescrever
  uma versão existente. Os 31 palcos antigos seguem intactos — a prova está no §4.

> Nota de fato, não de escopo: o briefing diz "`agente-noturno`, v288". A edge viva está
> hoje em **v290** (`updated_at` 2026-09-13). Não foi tocada — só registro a divergência
> para que ninguém leia "v288" como se fosse o que está no ar.

---

## 2. E1 — observabilidade de slot e proveniência

### 2.1 O que passa a ser persistido, por execução

`replay_execucao` ganhou:

| coluna | conteúdo |
|---|---|
| `candidato_slots` (já existia, vinha **null em 31/31**) | `{produto, produto_macro, macro_origem, origem_leitura, slots}` |
| `candidato_produto_proveniencia` (nova) | `{produto, produto_macro, fonte, fonte_detalhe, promovido, conhecimento, evidencias[], macro_sem_fonte}` |

`fonte` é **vocabulário fechado**, cravado em três lugares — no módulo do harness
(`FONTES_PRODUTO`), na função `replay_fonte_produto_valida()` e numa CHECK da tabela:

```
mensagem_cliente | estado_anterior | canonico | anuncio | modelo | nenhuma
```

`nenhuma` é valor **gravável** mas **não é fonte identificável** — é exatamente o caso que
a regra dura reprova.

### 2.2 Promovido vs. apenas conhecido

`conhecimento` distingue os dois estados que o briefing pede:

- `promovido_ao_estado` — o núcleo **tentou gravar** aquele produto em
  `agente_noturno_estado`. A jaula bloqueia a escrita, mas agora **lê o payload antes do
  409**: é literalmente o estado que produção teria gravado.
- `apenas_conhecido` — o produto aparece na resposta, no texto do modelo ou nas evidências,
  mas nenhuma escrita de estado foi tentada.

`origem_leitura` diz de onde o harness leu os slots do fim do turno, em ordem de
precedência: `escrita_estado_tentada` → `resposta_handler` → `palco_estado_anterior` →
`ausente`.

### 2.3 A escada de proveniência

Determinística, primeira que casa vence. A ordem reflete precedência causal: o que já
estava no estado não foi originado neste turno; o que o cliente escreveu vence catálogo e
anúncio; o modelo só leva o crédito quando não há evidência externa nenhuma.

1. `estado_anterior` — o valor já estava em `agente_noturno_estado.slots` do palco
2. `mensagem_cliente` — o inbound deste turno menciona o produto resolvido
3. `anuncio` — `pixel_events.familia_slug|product_type|content_category` ou `leads_marketing`
4. `canonico` — o slug existe em `catalogo_produtos` congelado
5. `modelo` — só o texto devolvido pelo modelo menciona o produto
6. `nenhuma` — resolvido, mas sem evidência em lugar nenhum

As evidências **não vencedoras continuam registradas** em `evidencias[]`: quem auditar vê
que havia anúncio e catálogo, e que a mensagem do cliente ganhou.

### 2.4 A regra dura, em três camadas

> `produto_macro` preenchido **sem** fonte identificável ⇒ veredito `INCONCLUSIVE`.
> Nunca `PASS`.

| camada | onde | o que impede |
|---|---|---|
| 1 | `observabilidade-v10.ts :: aplicarRegraProduto` | o harness devolver um veredito aprovado |
| 2 | `fn_replay_veredito_produto_v10()` | o ingestor gravar um veredito aprovado |
| 3 | CHECK `replay_execucao_produto_macro_exige_fonte` | **qualquer** INSERT, inclusive manual, entrar aprovado |

Nenhuma delas depende de julgamento humano.
`INCONCLUSIVE` foi acrescentado ao `veredito_check` da tabela.

### 2.5 Prova — tabela-verdade (rodada em 13/09, banco real)

| caso | veredito | pass | regra aplicada |
|---|---|---|---|
| base MELHOROU + fonte `nenhuma` | **INCONCLUSIVE** | false | produto_macro_sem_fonte |
| base EQUIVALENTE + fonte `nenhuma` | **INCONCLUSIVE** | false | produto_macro_sem_fonte |
| base MELHOROU + fonte `null` | **INCONCLUSIVE** | false | produto_macro_sem_fonte |
| base MELHOROU + fonte vazia | **INCONCLUSIVE** | false | produto_macro_sem_fonte |
| base MELHOROU + fonte inventada (`chute`) | **INCONCLUSIVE** | false | produto_macro_sem_fonte |
| fonte `mensagem_cliente` | MELHOROU | true | nenhuma |
| fonte `estado_anterior` | EQUIVALENTE | true | nenhuma |
| fonte `canonico` | MELHOROU | true | nenhuma |
| fonte `anuncio` | MELHOROU | true | nenhuma |
| fonte `modelo` | MELHOROU | true | nenhuma |
| sem `produto_macro` | EQUIVALENTE | true | nenhuma |

### 2.6 Prova — fim a fim, com rollback proposital

Saída literal da exceção `ROLLBACK_PROPOSITAL` (nada ficou gravado; conferido depois:
`residuo_da_prova = 0`):

```json
{
  "A_macro_sem_fonte": { "veredito": "INCONCLUSIVE", "pass": false, "regra": "produto_macro_sem_fonte" },
  "B_macro_com_fonte": { "veredito": "MELHOROU",     "pass": true,  "regra": "nenhuma" },
  "B_persistido": {
    "produto": "dtf_textil", "produto_macro": "dtf_textil",
    "fonte": "mensagem_cliente", "fonte_identificavel": true,
    "promovido": false, "conhecimento": "apenas_conhecido",
    "origem_leitura": "resposta_handler",
    "chegou_ao_modelo": false, "guard_interruptor": "cliente_comprador", "model_call_count": 0
  },
  "C_insert_direto": "RECUSADO pela constraint: new row for relation \"replay_execucao\" violates check constraint \"replay_execucao_produto_macro_exige_fonte\""
}
```

Em **A** o veredito-base era `MELHOROU` com `pass=true` e mesmo assim saiu `INCONCLUSIVE`.
Em **C** a tentativa de gravar `MELHOROU` por INSERT direto foi recusada **pelo banco**.

### 2.7 Prova — testes do módulo

```
node --experimental-strip-types --test patches/joao-replay-hermetico-v288/testes/observabilidade-v10.test.ts
# tests 21 · pass 21 · fail 0
```

---

## 3. E3 — "chegou ao modelo" vs "guard interrompeu"

Colunas novas em `replay_execucao`:

| coluna | conteúdo |
|---|---|
| `chegou_ao_modelo` | `true` se houve ao menos uma chamada a `/v1/messages` |
| `guard_interruptor` | `cliente_comprador` \| `agente_pausado` \| `sem_conteudo` \| `null` |
| `model_call_count` | quantidade de chamadas ao modelo |

Vocabulário fechado por CHECK. Há ainda uma CHECK de coerência:
`chegou_ao_modelo = (model_call_count > 0)` — os dois campos não podem contar histórias
diferentes. Quando um guard dispara **e** o modelo é chamado, isso não é escondido: sai em
`observabilidade_inconsistencias`.

O sinal vem do próprio núcleo v288, que encerra o turno devolvendo
`{"ok":true,"skip":"<guard>"}`. Os três desfechos de custo zero do baseline
(8 `cliente_comprador`, 2 `agente_pausado`, 1 `sem_conteudo`) mapeiam 1:1 e estão cobertos
por teste. Com isso, `custo_usd = 0` deixa de ser ambíguo: passa a ter causa nomeada.

---

## 4. E2 — palco as-of de verdade (`versao_palco=3`)

### 4.1 O defeito, medido

`fn_replay_congelar_palco_v288` fotografa cada tabela em **"hoje"**, não em
`replay_caso.as_of`. Não havia nenhum corte temporal na captura.

### 4.2 A regra v3

**Coleções de evento** (`pixel_events`, `orcamentos`, `vw_orcamento_calcme_vigente`,
`leads_marketing`, `lead_identificadores`, `agente_noturno_estado`) — sujeitas ao corte:

- **corte de existência**: linha criada depois do `as_of` é descartada. Para `pixel_events`,
  o corte é duplo — `event_time <= as_of` **e** `coalesce(ingested_at, event_time) <= as_of`:
  o evento tem de ter acontecido **e** ter sido ingerido até ali, senão o João daquele
  instante não o enxergava.
- **clamp declarado**: linha que existia mas foi alterada depois mantém-se, com todo carimbo
  posterior travado em `as_of`. `as_of` é **teto**, não estimativa, e o clamp fica registrado
  em `hashes.reconstrucao_v3`.

**`agente_noturno_estado` é reconstruído, não fotografado.** A tabela tem 5 colunas e 4 são
recuperáveis em `as_of`: `phone`/`lead_id` do próprio caso, `slots` de
`replay_caso.slots_antes`, `updated_at = least(linha_viva.updated_at, as_of)`.
`etapa` foi reconstruída de `agente_decisoes_log` até o `as_of` em **5 de 31** casos; nos
outros 26 a linha viva é mantida e isso sai **declarado** como
`etapa_fonte = linha_viva_nao_reconstruivel` (pendência P-v10-1).

**Tabelas de referência** (`sistema_config`, `catalogo_produtos`, `dtf_precos_faixa`,
`dtf_uv_degraus`, `dtf_produto_config`) — não existe histórico versionado delas neste banco.
Recortá-las deixaria o replay sem tabela de preço e ele não rodaria. Ficam congeladas
inteiras (com corte de existência onde há `created_at`) e **declaradas**, contadas em
separado como `referencia_posterior`. Pendência P-v10-2.

### 4.3 CRITÉRIO DE ACEITE — saída anexada

```sql
select versao_palco, count(*) casos, sum(eventos_posteriores) eventos_posteriores,
       count(*) filter (where eventos_posteriores = 0) casos_limpos,
       count(*) filter (where eventos_posteriores > 0) casos_contaminados,
       sum(referencia_posterior) referencia_posterior_declarada
from public.fn_replay_palco_futuro_v1()
group by versao_palco order by versao_palco;
```

| versao_palco | casos | eventos_posteriores | casos_limpos | casos_contaminados | referencia_posterior_declarada |
|---|---|---|---|---|---|
| 1 (geração anterior, **preservada**) | 31 | **186** | 2 | 29 | 801 |
| **3 (nova)** | **31** | **0** | **31** | **0** | 779 |

**31 palcos com `versao_palco=3`, `count(evento com timestamp > as_of) = 0` em 31/31.**
A linha da `versao_palco=1` está no resultado de propósito: é a prova de que o palco
anterior não foi apagado nem alterado — os 186 carimbos futuros continuam lá.

> Nota de numeração: as capturas existentes estão gravadas como `versao_palco=1` (é a
> geração que os relatórios chamam de "palco v2", pelo harness v2). Não existe
> `versao_palco=2` no banco. A nova foi gravada como **3**, para bater com o vocabulário do
> briefing, sem renumerar nada.

### 4.4 O que mudou em cada tabela

| tabela | linhas no palco v1 | linhas no palco v3 | causa |
|---|---|---|---|
| `pixel_events` | 201 | **143** | 58 eventos posteriores ao `as_of` descartados |
| `orcamentos` | 16 | **9** | 7 orçamentos criados depois do `as_of` |
| `catalogo_produtos` | 3 255 | **3 244** | 11 produtos criados depois do `as_of` |
| `agente_noturno_estado` | 30 | 30 | reconstruída (conteúdo mudou, contagem não) |
| demais | — | idênticas | — |

### 4.5 Consequência esperada — os 4 casos contaminados

| caso | palco | eventos | **compras** | eventos após `as_of` |
|---|---|---|---|---|
| `3b3560fe` | v1 | 7 | 3 | 4 |
| `3b3560fe` | **v3** | 3 | **0** | **0** |
| `769fb38a` | v1 | 5 | 2 | 3 |
| `769fb38a` | **v3** | 2 | **0** | **0** |
| `9c8a13d3` | v1 | 5 | 2 | 3 |
| `9c8a13d3` | **v3** | 2 | **0** | **0** |
| `3c91e46a` | v1 | 5 | 2 | 3 |
| `3c91e46a` | **v3** | 2 | **0** | **0** |

Conferido contra a tabela viva: nos 4 casos, **zero** compras antes do `as_of`; a primeira
compra é sempre posterior (`3b3560fe` em 27/08 03:19, quinze minutos depois do `as_of`; os
outros três em 30/08 13:23). Eram descartes falsos causados pelo palco.

Visão dos 11 casos de custo zero do baseline:

| guard | casos | com compra no palco v1 | com compra no palco v3 |
|---|---|---|---|
| `cliente_comprador` | 8 | 8 | **4** |
| `agente_pausado` | 2 | 0 | 0 |
| `sem_conteudo` | 1 | 0 | 0 |

Os 4 que restam tinham compra **de verdade** antes do `as_of`: para eles o guard está certo.

**Esta entrega não afirma que os 4 casos passam a rodar** — isso só se mede no rebaseline,
que depende do GO. O que está provado é que o estado congelado na data histórica agora está
correto, que é o que o briefing pediu.

---

## 5. Artefatos e SHAs

| arquivo | papel |
|---|---|
| `supabase/migrations/20260913170000_replay_observabilidade_slot_proveniencia_v10.sql` | E1 + E3: colunas, vocabulários, regra dura, ingestor, view |
| `supabase/migrations/20260913171000_replay_palco_asof_v3.sql` | E2: auditor, clamp e captura v3 |
| `patches/joao-replay-hermetico-v288/observabilidade-v10.ts` | módulo puro de observação (E1 + E3) |
| `patches/joao-replay-hermetico-v288/harness.ts` | harness v3 (era v2) |
| `patches/joao-replay-hermetico-v288/testes/observabilidade-v10.test.ts` | 21 testes |
| `patches/joao-replay-hermetico-v288/testes/provas-v10.sql` | provas SQL reproduzíveis |

**SHA para repinar o bootstrap quando vier o GO** (o blob de `harness.ts` é
`5155f0a0b4b978283ea13c4f85e81932a7bb9a35`, introduzido no commit abaixo e inalterado desde):

```
https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/0a16fb0d133d40b6ccdf4e7805052cd55f7fda56/patches/joao-replay-hermetico-v288/harness.ts
```

O `index.ts` de `agente-noturno-replay-v288` hoje aponta para
`b0d7bce7f08cda0392ccff9888123ce759b02bb9` (harness v2). **Não foi alterado.**

Ambas as migrations **já foram aplicadas** em `ldrdtaibazplvrbwyrvx` (são schema de replay:
não são escrita de produção, não são patch de edge, não são execução de replay).

**Funções novas no banco:**
`replay_fonte_produto_valida`, `replay_fonte_produto_identificavel`,
`fn_replay_veredito_produto_v10`, `fn_replay_registrar_execucao_v10`,
`replay_colecao_evento_v3`, `fn_replay_palco_futuro_estado_v1`, `fn_replay_palco_futuro_v1`,
`fn_replay_palco_clampar_v3`, `fn_replay_congelar_palco_v3`.
View nova: `vw_replay_observabilidade_v10`.

---

## 6. O que falta para o rebaseline (só com GO do Alessandro)

1. Repinar o bootstrap de `agente-noturno-replay-v288` no SHA do harness v3 desta branch
   — **requer reabrir `allow_edge_function_patch`**. Não foi feito.
2. Reabrir `allow_replay_execution`.
3. Rodar os 31 com `versao_palco: 3` no corpo, orçamento US$ 5, 3 tentativas por caso.
4. Gravar por `fn_replay_registrar_execucao_v10` — **não** por INSERT direto. Foi o INSERT
   direto que produziu `candidato_slots` null em 31/31.

O custo tende a subir: casos que antes pulavam passam a chegar ao modelo.

**O gasto de US$ 0,3908 do ciclo `920aedd5` fica como referência histórica, não como
baseline de aceite.**
