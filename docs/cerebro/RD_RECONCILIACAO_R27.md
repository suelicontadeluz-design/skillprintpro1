# R27 — Reconciliação do RD CRM real com a cópia do Cérebro

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`.

## VEREDITO: `PROPOSTAS_RD_NAO_REPRESENTA_RD`

`propostas_rd.won` cobre **65% das negociações** e **59% do valor** da etapa "Fechamento de Venda"
que aparece na tela do RD. **Não é a totalidade nem a semântica econômica do RD.**

Mas o achado que importa é o outro: **existem TRÊS cópias parciais do mesmo RD dentro do Cérebro,
nenhuma contém as outras, e a união das três reproduz a tela com 97,6% das negociações e 99,3%
do valor.** O RD real *está* no banco — está fragmentado.

E um terceiro achado que invalida uma conclusão minha da R26: **`pixel_events.Purchase` não é um
pixel. 77,6% das suas linhas são deals `won` do RD copiados para dentro dela.** A "comparação
entre duas verdades independentes" que fiz na R26 comparava o RD com uma tabela que contém o RD.

---

## 1. MODELO REAL SINCRONIZADO

| objeto | linhas | papel | contém |
|---|---|---|---|
| `propostas_rd` | 11.911 | cópia larga, orientada a proposta/PDF | deal, status, `total_price`, funil, etapa, `closed_at`, produto, qtd, preço unit., `lead_id` |
| `crm_deal_snapshot` | 6.868 | **log de snapshots** com `payload` cru do RD | payload completo, `http_status`, `coletado_em`, `lote` |
| `pixel_events` (`Purchase`) | 1.608 | eventos de venda | **inclui deals RD copiados** |
| `deal_produtos_rd_obs` | 1.940 | itens do deal | produto, qtd, preço, `discount`, `total_price` |
| `rd_pipelines` / `rd_stages` | 6 / 33 | dimensão funil/etapa | `synced_at` = **2026-05-02** em todas |
| `crm_deals_cache` | 4.720 | cache por telefone | `status`, `total_price`, sem `deal_id` RD |
| `deals_duplicados_limpeza` | 5.511 | fila de limpeza de duplicados | — |

**Ninguém escreve `propostas_rd` ou `crm_deal_snapshot` por SQL.** A escrita vem de edge functions,
disparadas por sete crons — todos com `status='succeeded'` nos últimos 30 dias:

| cron | frequência | edge | corpo |
|---|---|---|---|
| `rd-deal-backfill-cron` | */15 min | `rd-deal-backfill` | `{"limit":50,"offset":0}` |
| `rd-stage-sync-quente-horario` | :42 de cada hora | `rd-deal-stage-sync` | `{"modo":"quente","limite":50}` |
| `rd-stage-sync-frio-diario` | 03:20 | `rd-deal-stage-sync` | `{"modo":"frio","limite":200}` |
| `rd-deal-produtos-sync-30min` | */30 min | `rd-deal-produtos-sync` | `{"limite":100}` |
| `varredura-arquivos` / `varredura-pdf` | */5 e */10 min | `varredura-propostas` | lotes de 40 / 5 |
| **`rd-won-pixel-sync-diario`** | **07:00** | **`rd-won-pixel-sync`** | `{}` |
| `rd-deals-cleanup-loop` | */2 min | `rd-deals-cleanup` | **inativo** |

**`{"offset":0}` fixo no backfill** é uma assinatura de paginação que nunca avança.

## 2. FUNIL × ETAPA × STATUS — provados como eixos independentes

**Funil `Vendas`** (`63191f7dd02b2e000cb1805b`), 6 etapas: Lead → Conversa Iniciada → Exploração
das Necessidades → **Proposta Enviada** → **Fechamento de Venda** → Vendas Perdidas.
Existem mais 5 funis: Retenção, Indicação, Recuperação, Pós Vendas, Conteúdo.

Cruzamento etapa × status em `propostas_rd`:

| ordem | etapa | status | n | valor | tem `closed_at` |
|---|---|---|---|---|---|
| 1 | Lead | ongoing | 7.041 | 0,00 | 0 |
| 1 | Lead | **lost** | **1** | 0,00 | 1 |
| 2 | Conversa Iniciada | ongoing | 2.612 | 2.975,08 | 0 |
| 3 | Exploração das Necessidades | ongoing | 720 | 1.526,97 | 0 |
| 4 | **Proposta Enviada** | ongoing | **397** | **372.961,92** | 0 |
| 5 | **Fechamento de Venda** | **ongoing** | **1** | 136,08 | **0** |
| 5 | **Fechamento de Venda** | **won** | **991** | **371.409,82** | 991 |
| 6 | **Vendas Perdidas** | **ongoing** | **45** | 53,55 | **0** |
| 6 | Vendas Perdidas | lost | 9 | 5.532,93 | 9 |

**Resposta à pergunta: SIM — etapa e status são independentes.**
"Vendas Perdidas" tem **45 negociações `ongoing`**. "Fechamento de Venda" tem **1 `ongoing`**.
"Lead" tem 1 `lost`. **Usar o nome da etapa como sinônimo de venda produziria erro nas duas
direções.**

Nesta base, `won` ocorre **exclusivamente** na etapa "Fechamento de Venda" (991) mais 2 sem
etapa mapeada. Mas isso é uma regularidade observada, **não uma garantia estrutural** — a etapa
"Vendas Perdidas" já prova que a coincidência etapa↔status não vale.

## 3. SEMÂNTICA DE `won`

**`won` é um STATUS do RD, não uma etapa, não um evento nosso, não uma transformação.**

Prova direta no `payload` cru de `crm_deal_snapshot`: a API do RD devolve
`data.status ∈ {ongoing, won, lost}`, ao lado de `stage_id`, `pipeline_id`, `closed_at`,
`total_price`, `one_time_price`, `recurrence_price`, `lost_reason_id`.
`propostas_rd.deal_status` é cópia literal desse campo.

Corroboração pelo lado da escrita: `rd-won-pixel-sync` consulta a API do RD com
`filter=status:won,pipeline_id:<Vendas>` — **filtro por status, no servidor do RD.**

**100% dos `won` têm `closed_at`.** Nenhum `ongoing` tem.

## 4. VALOR DO NEGÓCIO — não é receita realizada

| pergunta | resposta medida |
|---|---|
| valor previsto ou final? | **previsto/corrente** — muda enquanto o deal existe |
| `total_price` = soma dos produtos? | **sim, em 706 de 726 comparáveis (97,2%)** |
| inclui recorrência? | **não** — `total_price` = `one_time_price` em **100%**; `recurrence_price` = 0 sempre |
| inclui frete? | **não observável** — nenhum campo de frete no payload |
| tem desconto? | campo `discount` existe em `deal_produtos_rd_obs` e é **> 0 em ZERO de 1.940 itens** |
| pode mudar após criação? | **SIM.** De 824 deals com mais de um snapshot, **102 (12,4%) tiveram `total_price` alterado**, com amplitude média de **R$ 647,17** |

**Conclusão: é o valor corrente da negociação, mutável, sem frete e sem desconto registrado.
Não é receita realizada, não é caixa, não é nota fiscal.** Chamar de receita exige a ressalva.

## 5. COBERTURA DA SINCRONIZAÇÃO

| medida | `propostas_rd` | `crm_deal_snapshot` |
|---|---|---|
| deals distintos | 11.911 | 3.559 (6.868 snapshots) |
| com valor | 100% | 100% |
| com etapa | 99,97% | 100% |
| com status | 100% | 100% |
| com `lead_id` | 81,8% (90,2% nos `won`) | — |
| com itens | 78,7% nos `won` | — |
| última atualização | **2026-08-25** | **2026-08-25** |
| `created_at` mais antigo | **2026-01-25** | **2026-01-25** |

**As duas cópias começam em 2026-01-25 e nenhuma contém a outra:**

- **1.167 deals** existem no snapshot e **não** em `propostas_rd`
- **9.519 deals** existem em `propostas_rd` e **não** no snapshot
- união: **13.078 deals distintos**

Nos 2.392 deals presentes em ambas: **16 com status divergente** e **25 com valor divergente
acima de 1%**. As cópias discordam entre si.

Defeitos identificados:

| defeito | evidência |
|---|---|
| **corte de data** | nenhum deal com `created_at` anterior a 2026-01-25, em nenhuma cópia |
| **paginação fixa** | `rd-deal-backfill-cron` roda com `{"offset":0}` a cada 15 min |
| **página única no won→pixel** | `rd-won-pixel-sync` só busca `page=1`, `page[size]=100`, `sort=-closed_at` — vê apenas os 100 `won` mais recentes |
| **catálogo de etapas congelado** | `rd_stages.synced_at` = 2026-05-02 em todas as 33 linhas |
| **status sub-sincronizado** | 10 `lost` em `propostas_rd`; 15 no snapshot; o RD real certamente tem mais |
| **cron ok ≠ dado gravado** | `rd-won-pixel-sync-diario` reporta `succeeded`, e **não grava uma linha desde 2026-05-07** |

## 6. `pixel_events.Purchase` NÃO É UM PIXEL

Anatomia completa, por padrão de `event_id`. **Todos têm `event_source = 'chat'`. Não existe
uma única compra vinda de pixel de navegador.**

| padrão | n | valor | período | origem |
|---|---|---|---|---|
| `won_<deal_id>` | **866** | **R$ 346.005,46** | 2026-05-04 → 2026-08-25 | **RD won** |
| `rd_won_<deal_id>` | **347** | **R$ 110.670,46** | 2026-01-26 → **2026-05-07** | **RD won**, via `rd-won-pixel-sync` |
| uuid | 202 | R$ 127.147,11 | 2026-01-26 → 2026-07-10 | não identificada nesta rodada |
| `csv_backfill_*` | 88 | R$ 26.269,62 | 2026-01-27 → 2026-05-04 | importação CSV manual |
| `mp_pix_*` / `mp_pack_*` | 34 | R$ 3.811,43 | jul–ago | Mercado Pago |
| `manual_calcme_*` | 14 | R$ 19.234,78 | mai–ago | lançamento manual do CalcMe |
| `purchase_julia_*` | 4 | R$ 781,68 | jul–ago | agente Júlia |
| `manual_*` / `balcao_ajuste_*` | 3 | R$ 5.522,76 | mai–ago | manual / balcão |

**1.215 de 1.564 (77,7%) e R$ 456.915,52 de R$ 641.936 (71,2%) são deals `won` do RD.**

O código de `rd-won-pixel-sync` insere literalmente:
`{event_name:"Purchase", event_time: closed_at, event_id:"rd_won_"+dealId, event_source:"chat", value: deal.amount ?? total_price}`.

### Correção formal da R26

Na R26 escrevi que pixel e RD eram "duas verdades econômicas concorrentes" e que o pixel era
53% maior nos mesmos leads. **O diagnóstico estava errado.** Não são fontes independentes: 71%
da receita do "pixel" É a receita do RD. A diferença de 53% não é discordância de medição —
é `propostas_rd` estar **incompleta** em relação aos mesmos deals que o outro caminho capturou:

- **495 dos 1.215 deals** derivados do RD **não existem em `propostas_rd`** — R$ 221.627,48
- **308 deles não existem em nenhuma das duas tabelas de deal** — R$ 116.756,36, vivem só como
  evento

## 7. REPRODUÇÃO DAS ETAPAS

Agregação por funil × etapa, comparada à tela do RD.

### `propostas_rd` sozinha

| etapa | RD real (tela) | `propostas_rd` | cobertura |
|---|---|---|---|
| Proposta Enviada | 527 · R$ 492.539,37 | 397 · R$ 372.961,92 | **75,3% · 75,7%** |
| Fechamento de Venda | 1.554 · R$ 628.318,67 | 992 · R$ 371.545,90 | **63,8% · 59,1%** |

### União `propostas_rd` + `crm_deal_snapshot`

| etapa | RD real | união 2 cópias | cobertura |
|---|---|---|---|
| Proposta Enviada | 527 · R$ 492.539,37 | **485 · R$ 460.372,86** | **92,0% · 93,5%** |
| Fechamento de Venda | 1.554 · R$ 628.318,67 | 1.181 · R$ 481.135,23 | 76,0% · 76,6% |

### União das TRÊS cópias (deals `won`)

| | negociações | valor |
|---|---|---|
| `propostas_rd` `won` | 993 | R$ 372.328,62 |
| `crm_deal_snapshot` `won` | 712 | R$ 282.006,92 |
| pixel derivado do RD | 1.215 | R$ 456.915,52 |
| **UNIÃO das três** | **1.517** | **R$ 623.985,05** |
| **tela do RD (Fechamento de Venda)** | **1.554** | **R$ 628.318,67** |
| **cobertura** | **97,6%** | **99,3%** |

**A união reconstrói a tela.** O resíduo — 37 negociações e R$ 4.333,62 (0,7%) — é da ordem de
grandeza de defasagem de sync e do 1 deal `ongoing` que está naquela etapa.

Distribuição temporal da união: 602 deals até 2026-05-03 (R$ 259.491,67) e 915 de 2026-05-04 em
diante (R$ 364.493,38). **Primeiro `closed_at`: 2026-01-26.**

## 8. EXPLICAÇÃO EXATA DOS ~R$ 332K DA R26

Decomposição fechada, do número da tela até o número que usei:

| | valor | causa |
|---|---|---|
| **RD real (tela, Fechamento de Venda)** | **R$ 628.318,67** | — |
| − não sincronizado em cópia nenhuma | − R$ 4.333,62 | defasagem / 1 deal `ongoing` na etapa |
| = união das três cópias | R$ 623.985,05 | |
| − `won` ausente de `propostas_rd` | − R$ 251.656,43 | **495 deals no pixel + 187 só no snapshot; paginação e corte de data** |
| = `propostas_rd` `won` | R$ 372.328,62 | |
| − `won` sem `lead_id` | − R$ 39.989,24 | 98 deals; a R26 exigia `lead_id` para comparar |
| **= número usado na R26** | **R$ 332.339,38** | |

**Soma das três perdas: R$ 295.979,29. Bate exatamente com R$ 628.318,67 − R$ 332.339,38.**

Causa dominante, com 85% do gap: **deals ausentes de `propostas_rd`.** Não é status diferente,
não é valor vazio, não é duplicação. É cobertura de sincronização.

## 9. IMPLICAÇÃO PARA A R26

Três coisas mudam. Nada do contrato econômico cai.

1. **A recomendação de receita canônica muda.** Eu recomendei `propostas_rd.won`. **Ela cobre
   59% do valor.** A receita canônica correta é **o status `won` do RD**, reconstruído da união
   das três cópias — ou, melhor, de uma sincronização consertada.
2. **A "terceira verdade concorrente" era um artefato.** Não havia conflito de medição entre
   pixel e RD; havia **uma cópia incompleta comparada com outra cópia incompleta do mesmo
   original**. O RD é a única fonte; o resto são réplicas.
3. **`pixel_events` perde o papel de "sinal canônico de tempo e atribuição" que lhe dei.** Ela é
   um agregador heterogêneo: 71% RD, 13% de origem não identificada, 4% CSV manual, mais Pix,
   CalcMe manual e balcão. O `event_time` dos 71% é o `closed_at` do RD — **não** o instante de
   um comportamento observado. Toda a análise de janela da R24 usou esse campo; a **janela de
   45 dias continua válida** (o `closed_at` é uma data real de fechamento), mas a origem do dado
   precisa ser redescrita: é CRM, não navegador.

**O que NÃO muda:** a decomposição do ciclo (R24), a recorrência de 77,9% (R26 §7), a janela de
45 dias, o motor de decisão, a assimetria pausa/escala e o contrato do ERP. Nenhum depende de
qual cópia do RD foi lida — dependem de `closed_at` e `lead_id`, que são fiéis onde existem.

## 10. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| A tela do RD talvez conte deals de outros funis? | O filtro da tela é funil Vendas. A união das três cópias, restrita a esse funil, chega a 97,6% — se houvesse mistura, o resíduo não seria de 0,7% |
| A união das três não estará dupla-contando? | Não. A união é por `deal_id` distinto, com `max(valor)` por deal. 1.517 ids únicos |
| `won_<id>` talvez não seja `deal_id`? | É: 720 dos 1.215 casam com `deal_id` de `propostas_rd`, e o código de `rd-won-pixel-sync` monta `"rd_won_"+dealId` |
| A tela pode estar defasada em relação ao banco? | Possível nos dois sentidos; por isso reporto cobertura e não igualdade, e o resíduo (0,7%) é menor que um dia de vendas |
| `total_price` da união usa `max` — infla? | Escolha conservadora **para cima**, declarada. Com `min`, a cobertura de valor cairia; o número de negociações (97,6%) não depende disso |
| Os 202 eventos `uuid` podem ser RD também? | Não identificados nesta rodada. Se forem, a cobertura sobe — não desce |
| E se o RD tiver deals `won` fora do funil Vendas? | Muito provável (Recuperação tem "Venda de Recuperação"). Não entram nesta conta e **não** estão cobertos |
| A tela mostra 1.554 na etapa, não 1.554 `won` — comparação é justa? | Na nossa cópia essa etapa é 991 `won` + 1 `ongoing`. A etapa ≈ won com erro de 0,1%. Declarado |

## 11. VEREDITO

### `PROPOSTAS_RD_NAO_REPRESENTA_RD`

`propostas_rd.won` = 63,8% das negociações e 59,1% do valor da etapa "Fechamento de Venda".
Não representa o RD, e foi usada como se representasse na R26.

Vereditos auxiliares, porque um rótulo só não conta a história:

| dimensão | veredito |
|---|---|
| sincronização agregada (união das 3) | **quase completa** — 97,6% / 99,3% no funil Vendas |
| sincronização de qualquer cópia isolada | **PARCIAL** — a melhor cobre 78% dos `won` |
| semântica de `won` | **RESOLVIDA** — status do RD, com `closed_at` em 100% |
| semântica de etapa vs status | **RESOLVIDA** — eixos independentes, provado |
| semântica do valor | **RESOLVIDA** — valor corrente e mutável, sem frete nem desconto |
| histórico anterior a 2026-01-25 | **AUSENTE** em todas as cópias |
| `pixel_events` como fonte independente | **REFUTADA** |

## 12. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é de conserto, não de construção: **fazer o `rd-won-pixel-sync` paginar.**

Ele já consulta a API do RD com o filtro certo (`status:won`, funil Vendas) e o próprio código
já lê `meta.total` e calcula `totalPages` — **e depois só busca `page=1`.** É o caminho que, dos
três, mais se aproximou do RD real (1.215 dos 1.517 deals) tendo lido apenas 100 registros por
execução.

Duas verificações antes de mexer, ambas read-only:

1. **Por que ele não grava desde 2026-05-07** apesar de o cron reportar `succeeded`. Três
   candidatos no código: token vencido, `lead_id` não resolvido (`sem_lead`), ou todos os 100
   mais recentes já existirem (`ja_existia`) — e o log da edge distingue os três.
2. **Se existem `won` fora do funil Vendas** (Recuperação tem "Venda de Recuperação"). Se
   existirem, nenhuma das três cópias os tem, e a reconciliação de 99,3% é do funil Vendas
   apenas.

Só depois disso faz sentido registrar a receita canônica que a R26 pediu — porque agora
sabemos que ela não é uma tabela nossa: **é o status `won` do RD, e o que temos são réplicas.**
