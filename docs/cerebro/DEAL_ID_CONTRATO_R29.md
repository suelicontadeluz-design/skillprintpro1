# R29 — Contrato de canonicalização de `deal_id`

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero DDL, zero deploy,
zero INSERT/UPDATE/DELETE, zero cron. `pixel_events.deal_id` **não existe** (confirmado no
`information_schema`).

## VEREDITO: `UUID_PRECISA_SER_RESOLVIDO`

Com uma correção grave da R28 e uma boa notícia:

**A duplicação não é hipotética — ela já existe no banco.** Encontrei `pixel_crm_sync_map`, um
dicionário de 507 linhas que liga `event_id ↔ deal_id` e que eu não conhecia na R28. Com ele,
**81,2% dos 202 eventos UUID são deals do RD**, e **44 negócios já estão contados duas vezes
hoje, inflando a receita em R$ 23.522,86 e a taxa de recompra em 2,5 pontos.**

A boa notícia: **a distorção é histórica e está encerrada.** Junho, julho e agosto estão limpos.

E o resto do contrato fecha bem: `won` é terminal, `closed_at` é imutável, o valor muda depois
do won em apenas 2,2% dos casos. **O índice único é seguro — depois de resolver as 44 colisões.**

---

## 1. IDENTIDADE DO DEAL

826 deals com mais de um snapshot em `crm_deal_snapshot`:

| teste | resultado |
|---|---|
| `deal_id` duplicado | **não** |
| **mudou de pipeline** | **0** |
| mudou de etapa | 317 (normal — é o funil) |
| mudou de status | 90 |
| **`ongoing` → `won`** | **90 (todos)** |
| **`won` → qualquer outro** | **0** |
| **`won` → `lost`** | **0** |
| **`lost` → `won`** | **0** |
| **`closed_at` alterado** | **0** |
| valor alterado (todo o ciclo) | 103 |

**`won` é terminal e `closed_at` é imutável.** Nenhum deal reabriu, nenhum foi desfeito.

**Conclusão: `1 deal_id = 1 fato comercial final` se sustenta.** Não é preciso versionar o
negócio para representar a venda. O versionamento é útil para auditoria — não para identidade.

## 2. EVENTO VS ESTADO

Hoje `pixel_events` **mistura os dois, e de forma incoerente entre produtores:**

| | `deal-won-ingest` (`won_`) | `rd-won-pixel-sync` (`rd_won_`) |
|---|---|---|
| semântica gravada | **evento** — instante em que o webhook chegou | **estado** — o `closed_at` do negócio |
| valor | relido do RD após inserir produtos | valor da listagem |

Os 82 consumidores esperam **evento imutável**: todos leem `Purchase` como "aconteceu uma
compra em tal data por tal valor". Nenhum lê `pixel_events` como tabela de estado — não há um
único `UPDATE ... SET value` fora de `fn_reconciliar_purchase_rd`, que só corrige zeros.

**Modelo correto: EVENTO.** Um `Purchase` por negócio, com o instante e o valor do fechamento.
O estado atual do deal já mora em `propostas_rd` e `crm_deal_snapshot`.

## 3. `event_time` CANÔNICO

| candidato | disponibilidade | estabilidade |
|---|---|---|
| `created_at` do deal | 100% | é a abertura, não a venda |
| **`closed_at`** | **100% dos `won`** | **imutável — 0 alterações em 826 deals** |
| webhook receipt / ingest | só no `won_` | varia com fila e retry |

Distância entre o `event_time` gravado e o `closed_at` real (R28): mediana **0,08 min** no
`won_`, 95,7% dentro de 10 minutos, **4,3% fora**.

**Canônico: `closed_at`.** Três razões:

1. É o único imutável — reprocessar não move a data.
2. Aquisição, coorte e janela de 45 dias medem *quando a venda aconteceu*, não quando o
   webhook chegou. Uma fila lenta hoje desloca o lead de coorte.
3. É o que os 4,3% fora da janela corrigem, e são justamente os casos que a trigger não pega.

## 4. `value` CANÔNICO

Restringindo a snapshots **posteriores ao won** — 714 deals:

| | |
|---|---|
| mudaram de valor depois do `won` | **16 (2,2%)** |
| direção | **16 subiram, 0 desceram** |
| delta médio | R$ 307,60 · mediana R$ 105,87 · máximo R$ 1.694,11 |
| delta total | **R$ 4.921,57** |
| tempo médio até alterar | ~90 horas |

**Correção da R27/R28:** eu reportei "o valor muda em 12,4% dos deals". Esse número é sobre
**todo o ciclo de vida**, incluindo a negociação — onde mudar preço é o esperado. **Depois do
won, muda em 2,2%, sempre para cima**, e o padrão é acréscimo de itens que faltavam.

**Canônico: `value_current`** — o último valor conhecido. Como só sobe por completar o pedido,
o valor final é o correto. Não justifica duas colunas: `value_at_won` divergiria em 16 deals e
R$ 4.921 (0,8% da receita), e nenhum consumidor pede o valor de abertura.

## 5. COMPORTAMENTO DO SEGUNDO PRODUTOR

Simulação lógica com `UNIQUE(deal_id)`:

| cenário | sem contrato | **com o contrato proposto** |
|---|---|---|
| webhook grava, cron encontra depois | cron tenta `rd_won_` → duplica ou é engolido pela trigger | `ON CONFLICT (deal_id) DO UPDATE` — atualiza só se mais novo |
| cron grava, webhook chega depois | webhook tenta `won_` → duplica | idem |
| retry do mesmo produtor | protegido pelo próprio prefixo | protegido pela chave |

**Comportamento escolhido: `UPDATE_SOMENTE_SE_MAIS_NOVO`.**

```
ON CONFLICT (deal_id) WHERE ... DO UPDATE
  SET value = EXCLUDED.value, event_time = EXCLUDED.event_time, ...
  WHERE EXCLUDED.observado_em > pixel_events.observado_em
```

Por que não os outros:

- **`NO_OP` (DO NOTHING)** perderia os 16 deals cujo valor sobe depois do won, e — pior —
  perderia o enriquecimento de atribuição: o `won_` grava `campaign_id`, `adset_id`, `ad_id`,
  `content_category`; o `rd_won_` não grava nada disso. Quem chegasse primeiro venceria por
  acaso.
- **`UPSERT` cego** deixaria o cron sobrescrever a atribuição do webhook com nulos, todo dia.
- **Deixar dar erro de chave** é exatamente o que a regra central proíbe: trocar duplicidade
  silenciosa por erro silencioso. A edge trata `duplicate key` como falha e o cron reporta
  `succeeded` do mesmo jeito.

**Regra adicional obrigatória: nunca sobrescrever campo preenchido com nulo.** O `DO UPDATE`
precisa usar `coalesce(EXCLUDED.campo, pixel_events.campo)` nos campos de atribuição.

## 6. PREDICADO DO ÍNDICE

Medição: **`deal_id` só aparece em `event_name='Purchase'`.** Nenhum outro tipo de evento tem
correspondência em prefixo ou no mapa. 1.392 de 1.608 `Purchase` (86,6%) teriam `deal_id`.

**Predicado recomendado:**

```sql
UNIQUE (deal_id) WHERE deal_id IS NOT NULL AND event_name = 'Purchase'
```

Por que não `UNIQUE(deal_id)` puro: bloquearia qualquer evento futuro legítimo do mesmo
negócio — um `Refund`, um `Delivered`, uma pesquisa de pós-venda. O funil "Pós Vendas" do RD
existe e tem 6 etapas; é plausível que um dia gere evento.

Por que não restringir a "eventos derivados de RD": não há coluna que marque isso hoje, e criar
uma só para o predicado seria uma coluna a mais sem consumidor.

Por que não incluir `value > 0`: 10 `Purchase` com `deal_id` têm valor ≤ 0. Excluí-los do
índice deixaria justamente os casos frágeis sem proteção — e `value` NULL é o furo conhecido da
trigger atual.

## 7. BACKFILL SIMULADO

Extração determinística de `deal_id` para os 1.608 `Purchase`, **sem preencher nada**:

| classe | n | valor | fonte |
|---|---|---|---|
| **DEAL_ID_PROVADO — prefixo** | **1.229** | R$ 458.874,38 | `won_<id>` e `rd_won_<id>` |
| **DEAL_ID_PROVADO — mapa** | **164** | R$ ~104.000 | `pixel_crm_sync_map` |
| **NAO_RD** | 148 | R$ 57.873,05 | `csv_backfill`, `mp_*`, `manual_*`, `julia`, `balcao` |
| **DESCONHECIDO** | **38** | R$ ~23.000 | UUIDs sem entrada no mapa |
| **DEAL_ID_AMBIGUO** | **0** | — | nenhum `event_id` resolve para dois deals |

**Zero ambiguidade.** O backfill é determinístico: `regexp_replace(event_id,'^(rd_)?won_','')`,
senão `pixel_crm_sync_map.event_id`, senão NULL.

Os 38 UUIDs sem mapa ficam com `deal_id` NULL — fora do índice, protegidos apenas pela trigger.
É o resíduo aceitável.

## 8. ORIGEM DOS 202 UUID — resolvida

**`pixel_crm_sync_map` (507 linhas: `deal_id`, `event_id`, `lead_id`, `valor_sinc`,
`sincronizado_em`) resolve 164 dos 202 (81,2%).**

| tipo | n | resolvido pelo mapa |
|---|---|---|
| **uuid** | **202** | **164 (81,2%)** |
| `rd_won_` | 347 | 14 (4,0%) |
| `won_` | 871 | **0 (0,0%)** |
| demais (csv, mp, manual, julia, balcão) | 147 | 0 |

Produtor: a **`crm-pixel-sync`, aposentada em 2026-08-16** — o mapa é o registro dela. O
comentário de `fn_sync_crm_pixel_insert` já dizia que "dos 788 `won_*` existentes, ZERO estavam
em `pixel_crm_sync_map`". **Confirmado: 0 de 871.**

Classificação dos 202:

| classe | n |
|---|---|
| **VENDA_RD_DUPLICADA** (mapa resolve para deal que já tem outra linha) | **43** |
| **VENDA_RD única** (mapa resolve, sem outra linha) | 121 |
| **DESCONHECIDO** (sem mapa) | 38 |

**Sim, eles precisam entrar no desenho de canonicalização** — e são a maior parte da distorção
que existe hoje.

## 9. TRIGGER `trg_pixel_events_dedup`

`BEFORE INSERT ... FOR EACH ROW`, habilitada. Três casos:

1. com `lead_id`: bloqueia se existir mesmo `lead_id` + `event_name` + **`value`** em **±10 min**
2. com `visitor_id`: idem por `visitor_id`
3. sem identificador: `Purchase` + `value` + `state` em ±2 h

| | |
|---|---|
| **falsos negativos conhecidos** | `value` NULL (`NULL = NULL` é NULL, o `EXISTS` falha); valor diferente; `lead_id` diferente; gap > 10 min. **As 44 duplicatas atuais têm span médio de 10,7 dias e máximo de 100,8 — muito além da janela** |
| **falsos positivos possíveis** | duas compras legítimas do mesmo lead, mesmo valor, em menos de 10 min. Plausível em DTF por metro com pedidos repetidos. **Não medido — a linha bloqueada não deixa rastro** |
| pode ser removida depois? | **Não** |
| ainda necessária sem `deal_id`? | **Sim** — protege os 148 `NAO_RD` e os 38 `DESCONHECIDO`, que ficam fora do índice |

**Manter as duas defesas.** A chave cobre o que tem `deal_id`; a trigger cobre o resto. E o
silêncio dela precisa acabar: hoje ela descarta 36 linhas por execução sem registrar nada.

## 10. ESTADO CANÔNICO SIMULADO

Deduplicando por `deal_id` (prefixo + mapa), via CTE, sem escrever:

| | ANTES (linhas) | DEPOIS (canônico) | distorção |
|---|---|---|---|
| registros | 1.567 | **1.523** | **44 fantasmas** |
| **receita** | **R$ 643.894,54** | **R$ 620.371,68** | **R$ 23.522,86 (3,8%)** |
| compradores | 493 | 492 | 1 |
| **recomprantes** | **216 (43,8%)** | **203 (41,3%)** | **13 falsos (−2,5 p.p.)** |

**A taxa de recompra que a R26 publicou está inflada em 2,5 pontos.** Treze dos 216
"recomprantes" são o mesmo negócio contado duas vezes.

### E a distorção é histórica, não corrente

| mês | receita antes | canônica | distorção | % |
|---|---|---|---|---|
| 2026-01 | 6.761,55 | 6.761,55 | 0,00 | 0,0% |
| **2026-02** | 50.125,76 | 45.304,14 | **4.821,62** | **+10,6%** |
| 2026-03 | 95.934,45 | 93.490,73 | 2.443,72 | +2,6% |
| **2026-04** | 104.046,60 | 94.074,51 | **9.972,09** | **+10,6%** |
| 2026-05 | 117.552,16 | 111.266,73 | 6.285,43 | +5,6% |
| **2026-06** | 81.098,34 | 81.098,34 | **0,00** | **0,0%** |
| **2026-07** | 86.077,25 | 86.077,25 | **0,00** | **0,0%** |
| **2026-08** | 102.298,43 | 102.298,43 | **0,00** | **0,0%** |

**Fevereiro e abril fecharam com 10,6% de receita inexistente. Junho em diante está limpo** —
a aposentadoria da `crm-pixel-sync` em agosto encerrou a fonte, e os meses recentes só têm o
`won_` do webhook.

## 11. IMPACTO NOS 31 CONSUMIDORES VULNERÁVEIS

| grupo | objetos | muda? | quanto |
|---|---|---|---|
| **receita acumulada** | `vw_conferencia_vendas_campanha`, `vw_performance_por_campanha` | **sim** | **−3,8% no total; até −10,6% em fev e abr** |
| **metas** | `fn_atualizar_meta_comercial`, `fn_atualizar_meta_mensal` | **sim, retroativo** | metas de fev–mai foram avaliadas com receita inflada |
| **vendas/dia** | `fn_vendas_dia_brt` | **não hoje** | jun–ago sem distorção |
| **recorrência** | `vw_clientes_recorrentes_chat`, `fn_lead_eh_recorrente` | **sim** | 13 leads deixam de ser recorrentes (−2,5 p.p.) |
| **campanha / mídia** | `fn_contexto_midia_ouro`, `vw_agente_midia_campanhas` | **sim** | proporcional ao mês |
| **ciclo** | `fn_recalcular_criterios_midia` | **sim** | usa `AVG` sobre todos os eventos — as 44 réplicas entram no `dias_ciclo` (R24) |
| **guardrail WhatsApp** | `fn_guardrail_whatsapp_campaign` | **provável** | decide por "já comprou"; 1 comprador a menos |
| **shadow de mídia** | `vw_midia_coorte_aquisicao_shadow` | **não** | usa `DISTINCT ON (lead_id)` — imune |

**O motor do shadow sobrevive intacto. Metas, recorrência e performance por campanha não.**

## 12. PATCH MÍNIMO PROPOSTO — só desenho

Nenhuma tabela nova. Quatro passos, **nesta ordem**:

**Passo 0 — resolver as 44 colisões (obrigatório, antes de tudo).**
`CREATE UNIQUE INDEX` falha hoje. 44 deals com 44 linhas excedentes, R$ 23.522,86, 7 com
`lead_id` divergente. Critério de sobrevivência sugerido: manter a linha com **atribuição
preenchida** (`campaign_id` não nulo) e, em empate, a de `event_time` mais próximo do
`closed_at`. Os 7 com lead divergente exigem decisão caso a caso.

**Passo 1 — uma coluna.**
`pixel_events.deal_id text` — nullable, sem default.
Não recomendo coluna `source`/`produtor`: `event_id` já carrega o prefixo, e o mapa carrega o
resto. Uma coluna a mais sem consumidor é o erro que `calcme_itens_pedido` monumentaliza.

**Passo 2 — backfill determinístico** (§7): prefixo, senão `pixel_crm_sync_map`, senão NULL.
Zero ambiguidade, 1.392 de 1.608 preenchidos.

**Passo 3 — o índice:**
`UNIQUE (deal_id) WHERE deal_id IS NOT NULL AND event_name = 'Purchase'`

**Passo 4 — adaptar os dois produtores** para gravar `deal_id` e usar
`ON CONFLICT (deal_id) ... DO UPDATE ... WHERE mais_novo`, com `coalesce` nos campos de
atribuição (§5). **Os dois no mesmo deploy** — adaptar um só reintroduz a assimetria atual.

`pixel_crm_sync_map` passa a ser evidência histórica congelada. Não é mais escrita por ninguém.

## 13. PAGINAÇÃO DEPOIS DA CANONICALIZAÇÃO

Re-simulação sobre os `won` conhecidos nas réplicas de deal (1.195), **com o mapa aplicado**:

| grupo | deals | resultado |
|---|---|---|
| já canônico | **1.009** | `ON CONFLICT` → NO_OP ou atualização de valor |
| sem lead | 68 | não insere |
| **novos legítimos** | **118** | **inserem** |
| **duplicados** | **0** | **impossível por chave** |

**Prova: com o contrato, corrigir a paginação não aumenta artificialmente receita, compradores
nem recompra.** Nenhum `deal_id` novo colide com um já presente.

E um resultado que só apareceu com o mapa: **o "ganho" da paginação cai de 206 para 118
negócios.** Os outros 88 já estavam no banco como UUID. Sem o `pixel_crm_sync_map`, eu teria
criado 88 duplicatas acreditando que eram novas — **inclusive com o índice único no lugar, se o
backfill ignorasse o mapa.**

## 14. AUTO-REFUTAÇÃO

| tentativa de matar o desenho | resposta |
|---|---|
| **Um deal pode gerar mais de uma venda legítima?** | Não observado: 0 reaberturas, `won` terminal em 826 deals. Mas **não posso provar que o RD proíbe** — só que nunca aconteceu em 7 meses |
| **Uma recompra pode reutilizar `deal_id`?** | Não. Recompra abre deal novo — é o que produz os 203 recomprantes canônicos |
| **O valor pode mudar?** | Sim, 2,2% depois do won, sempre para cima. Coberto pelo `DO UPDATE` |
| **O deal pode reabrir?** | 0 casos. Se acontecer, o `DO UPDATE` sobrescreve o evento — e **isso apagaria a venda anterior**. Risco real, sem evidência. Mitigação: `won` → outro status deveria gerar alerta, não update silencioso |
| **`closed_at` pode mudar?** | 0 alterações em 826 deals |
| **UUID pode esconder deal RD?** | **Sim, e escondia — 164 deles.** É o achado desta rodada. Restam 38 sem mapa |
| **O índice único pode bloquear evento legítimo?** | Sim, se um dia houver `Refund` do mesmo deal. Por isso o predicado inclui `event_name='Purchase'` |
| **`ON CONFLICT` pode esconder divergência real?** | **Sim, e é o risco maior do desenho.** Um deal cujo valor muda de R$ 100 para R$ 5.000 seria atualizado em silêncio. Mitigação: registrar deltas acima de um limiar, em vez de só aplicar |
| **Atualizar valor histórico reescreve o passado?** | **Sim.** Uma meta de fevereiro já avaliada mudaria se o valor de um deal de fevereiro for corrigido hoje. Isso é um argumento a favor de `value_at_won` — e contra a minha própria recomendação do §4. Registro a tensão: escolhi `value_current` porque só sobe e o delta é 0,8%, mas a escolha não é isenta |
| **A trigger pode estar bloqueando compras legítimas hoje?** | **Não medido, e não mensurável** — a linha descartada não deixa rastro. É a maior lacuna que resta |
| **O mapa de 507 linhas está completo?** | Não sei. Resolve 81,2% dos UUIDs; os outros 18,8% podem ser deals cujo registro se perdeu |

## 15. VEREDITO

### `UUID_PRECISA_SER_RESOLVIDO`

Não porque a origem seja um mistério — ela está resolvida: 164 dos 202 são deals do RD, via
`pixel_crm_sync_map`. É porque **43 deles já estão duplicados no banco**, e o índice único
**falharia hoje** contra essas 44 colisões.

Vereditos auxiliares:

| dimensão | veredito |
|---|---|
| identidade `deal_id` | **estável e terminal** — não precisa versionar |
| `PRECISA_VERSIONAR_DEAL` | **refutado** — 0 reaberturas, 0 `won`→`lost` |
| `INDICE_UNICO_INSEGURO` | **refutado** — seguro com o predicado do §6, **depois** do passo 0 |
| `CANONICALIZACAO_PRONTA_PARA_IMPLEMENTAR` | **quase** — falta só resolver as 44 colisões |
| paginação pós-contrato | **segura, provado** (§13): 0 duplicados |

## 16. PRÓXIMO PASSO MÍNIMO

Uma coisa só: **decidir o critério de sobrevivência das 44 colisões.**

É a única peça do contrato que exige julgamento humano, não medição. As outras 43 seguem regra
(manter a linha com atribuição preenchida); **os 7 com `lead_id` divergente precisam de decisão
caso a caso** — duas linhas do mesmo negócio apontando para clientes diferentes significa que
uma das duas resoluções de lead está errada, e escolher a errada move a venda de cliente.

Isso é R$ 23.522,86 e 13 recomprantes falsos. É pequeno em receita e grande em confiança: até
resolver, **todo número histórico de fev a mai/2026 carrega até 10,6% de inflação**, e a taxa
de recompra de 43,8% que a R26 publicou está 2,5 pontos acima da real.

Depois disso, os passos 1 a 4 do §12 são mecânicos, e a paginação fica segura por construção.

**Não recomendo começar pela coluna.** Criar `deal_id` antes de resolver as colisões produz uma
coluna preenchida que não pode receber o índice — e um índice que não pode ser criado é
exatamente o "erro de chave silencioso" que a regra central proíbe.
