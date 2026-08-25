# R28 — Réplica canônica de negócios ganhos e risco de duplicação da paginação

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero deploy, zero cron,
zero INSERT, zero DELETE, zero correção.

## VEREDITOS

### `SYNC_PRECISA_CANONICALIZACAO`
### `REPLICA_RD_CANONICA_NAO_EXISTE`

`PAGINACAO_DUPLICARIA_EVENTOS` é verdadeiro no limite superior — **até 108 negócios e
R$ 47.478,29 de receita fantasma** — mas hoje está contido por uma trigger que ninguém
projetou para esse fim. **A paginação não é o problema principal, e consertá-la sozinha não
resolveria nada:** a API do RD está devolvendo `meta.total = 0`, então o laço de paginação que
o código já tem calcula **zero páginas**.

E há um precedente dentro do próprio banco: **este exato risco já foi identificado e tratado em
2026-08-16**, para uma função irmã. O registro está no corpo de `fn_sync_crm_pixel_insert`.

---

## 1. SOBREPOSIÇÃO `won_` × `rd_won_`

Extraindo o `deal_id` canônico dos dois padrões:

| | deals | valor |
|---|---|---|
| linhas `Purchase` com prefixo RD | 1.229 | — |
| **`deal_id` canônicos distintos** | **1.228** | — |
| só `won_` | 875 | R$ 345.926,61 |
| só `rd_won_` | 352 | R$ 110.299,36 |
| **nos DOIS prefixos** | **1** | R$ 371,10 |

**Hoje a sobreposição é de exatamente um negócio.** Não por desenho — por acaso temporal: o
`rd_won_` parou em **2026-05-07** e o `won_` começou em **2026-05-04**. Cruzaram-se por três dias.

Também: **zero deals com valores diferentes entre linhas**; 1 com `event_time` e `lead_id`
diferentes (o mesmo deal duplicado).

## 2. CENSO DOS PRODUTORES

| | `rd_won_<deal_id>` | `won_<deal_id>` |
|---|---|---|
| produtor | edge **`rd-won-pixel-sync`** | edge **`deal-won-ingest`** (v28) |
| gatilho | cron `rd-won-pixel-sync-diario`, `0 7 * * *` | **webhook do RD**, evento a evento |
| filtro | `filter=status:won,pipeline_id:<Vendas>` no servidor do RD | `document.status === "won"` no payload |
| paginação | `page[number]=1`, `page[size]=100`, `sort=-closed_at` — **só a página 1** | não se aplica |
| dedup próprio | `select event_id in ('rd_won_'+id)` — **só o próprio prefixo** | `eq(event_id, 'won_'+id)` — **só o próprio prefixo** |
| **valor** | `deal.amount ?? deal.total_price` (da listagem) | `amount_total ?? total_price`, **relido após inserir produtos** |
| **`event_time`** | **`closed_at`** (data real do fechamento) | **`new Date()`** (instante da ingestão) |
| `lead_id` | `lead_identificadores.deal_rdstation_id`, senão `.contact_rdstation_id` | `leads_marketing.ph` = telefone extraído do **nome do deal** |
| atribuição gravada | nenhuma | `source`, `medium`, `campaign_id`, `adset_id`, `ad_id`, `content_category`, `state` |
| em retry | `ja_existia` protege o próprio prefixo | `ja processado` protege o próprio prefixo |
| período | 2026-01-26 → **2026-05-07** | 2026-05-04 → **2026-08-25** (vivo) |

**Nenhum dos dois conhece o prefixo do outro.** É a falha estrutural desta arquitetura.

Um terceiro produtor foi **aposentado**: `fn_sync_crm_pixel_insert`, cujo corpo hoje é só um
`RAISE NOTICE` e um comentário que vale citar na íntegra:

> *"APOSENTADA em 16/08/2026 (frente rd-won-sem-atualizacao-desde-1304, GO do Alessandro).
> Motivo: produzia Purchase em paralelo com deal-won-ingest sem anti-duplicacao — dos 788 won_\*
> existentes, ZERO estavam em pixel_crm_sync_map, entao corrigir a paginacao da crm-pixel-sync
> teria duplicado a receita. Fonte viva canonica de WON: webhook RD -> deal-won-ingest ->
> pixel_events won_<deal_id>."*

**Alguém já fez esta análise, para a função irmã, e a decisão foi aposentar o produtor paralelo
— não consertar a paginação dele.** `rd-won-pixel-sync` é o mesmo caso e ficou de fora.

Existe também `fn_reconciliar_purchase_rd()`, que **não cria** eventos: consulta o RD e corrige
`value` onde é 0, apenas para `event_id LIKE 'won_%'`. É mais um objeto que enxerga um prefixo só.

## 3. POR QUE PAROU EM 07/05 — provado pelo log de hoje

Log da execução de **2026-08-25 07:00**, na íntegra:

```
{"step":"rd",   "status":"fetched","page":1,"totalPages":0,"total":0,"count":100}
{"step":"sync", "status":"done","page":1,"totalPages":0,"novos":36,"ja_existia":50,"sem_lead":14}
{"step":"pixel_insert","status":"ok","count":36}
```

Leitura linha a linha:

1. **A edge está funcionando.** Autentica, busca 100 deals, resolve leads, monta 36 inserts.
2. **`novos: 36` — ela mandou 36 linhas para o banco hoje.**
3. **`pixel_insert: ok` — o `insert` não devolveu erro.**
4. **E `max(event_time)` de `rd_won_` continua em 2026-05-07.** Nenhuma das 36 existe.

**Causa: `trg_pixel_events_dedup`.** É um trigger `BEFORE INSERT ... FOR EACH ROW`, habilitado,
que devolve `NULL` quando já existe linha com o mesmo `lead_id` + `event_name` + `value` dentro
de ±10 minutos. As 36 linhas são silenciosamente descartadas pelo Postgres. O cliente Supabase
não recebe erro, a edge loga `ok`, o cron loga `succeeded`.

**Há 3,5 meses o sync tenta gravar e o banco descarta, e os três níveis de log dizem que deu
certo.** É o caso mais nítido de "cron rodando ≠ capacidade funcionando" que apareceu em todas
estas rodadas.

### E um segundo defeito, mais grave que a paginação

**`total: 0` e `totalPages: 0`, com `count: 100`.**

A API do RD não está devolvendo `meta.total`; o código faz `?? 0` e calcula
`totalPages = Math.ceil(0/100) = 0`. Mas a página 1 **veio cheia**, com 100 registros — o que
prova que existem mais.

**Consequência direta: um conserto ingênuo de paginação (`for p = 1..totalPages`) não buscaria
uma única página a mais.** O bloqueio não está no laço; está no contador que o laço usaria.

Classificação dos 100 de hoje: 36 novos · 50 `ja_existia` · 14 `sem_lead`. Zero erro de token
(`token_crm` tem exatamente 1 linha, então o `.single()` do código funciona), zero erro HTTP.

## 4. `deal_id` COMO IDENTIDADE ECONÔMICA

| teste | resultado |
|---|---|
| `deal_id` duplicado dentro de uma réplica? | **não** — chave estável nas três |
| `deal_id` muda? | **não observado** em nenhuma réplica |
| status muda? | **sim** — 16 deals têm status divergente entre `propostas_rd` e o snapshot (R27) |
| **valor muda?** | **sim** — 102 de 824 deals com múltiplos snapshots (12,4%), amplitude média **R$ 647,17** |
| `closed_at` muda? | não observado; presente em 100% dos `won` |

**A regra "um negócio RD = um `deal_id`" se sustenta.** É a única chave de identidade econômica
disponível, e é estável.

**Mas `deal_id` sozinho não basta**, porque valor e status são mutáveis. A semântica correta é
**ambas**:

- **estado atual** por `deal_id` — é o que qualquer KPI econômico deve ler;
- **histórico de versões** — já existe de fato em `crm_deal_snapshot` (6.868 snapshots para
  3.559 deals) e é o que permite auditar uma mudança de valor depois do fato.

Hoje o histórico existe por acidente (é um log de coleta), não por contrato. Nenhum objeto o lê
como histórico.

## 5. WON POR FUNIL

| funil | etapa | deals `won` |
|---|---|---|
| **Vendas** | **Fechamento de Venda** | **1.191** |
| **Vendas** | **Proposta Enviada** | **1** |
| (pipeline não catalogado) | — | 2 |

Duas leituras:

1. **Mais uma prova de que etapa ≠ status:** existe 1 negócio `won` parado em "Proposta Enviada".
2. **Nenhum `won` fora do funil Vendas nas nossas cópias — e isso NÃO prova que não existam no
   RD.** As três réplicas são estruturalmente enviesadas para o funil Vendas: `rd-won-pixel-sync`
   filtra `pipeline_id:<Vendas>` na origem, e `deal-won-ingest` **move o deal para
   `STAGE_FECHAMENTO` do funil Vendas** ao processá-lo (`putDeal(stage_id: STAGE_FECHAMENTO)`).

**Resposta à pergunta: a tela de R$ 628k representa o funil Vendas, não a empresa.** O funil
"Recuperação" tem a etapa "Venda de Recuperação" e o "Indicação" tem "Indicação convertida" —
se houver `won` neles, **nenhuma das três réplicas o veria**, por construção. Estado:
**DESCONHECIDO**, só respondível consultando a API sem o filtro de pipeline.

## 6. CONSUMIDORES DE `pixel_events.Purchase`

**82 objetos** (funções e views) leem `Purchase`. Classificados pelo padrão de agregação:

| classe | n | exemplos que decidem dinheiro |
|---|---|---|
| **VULNERÁVEL** — soma `value` ou conta linhas sem deduplicar | **31** | `fn_atualizar_meta_comercial`, `fn_atualizar_meta_mensal`, `fn_vendas_dia_brt`, `fn_recalcular_criterios_midia`, `vw_performance_por_campanha`, `vw_agente_midia_campanhas`, `vw_conferencia_vendas_campanha`, `fn_contexto_midia_ouro`, **`vw_clientes_recorrentes_chat`**, `fn_guardrail_whatsapp_campaign` |
| protegido por `count(distinct lead)` | 11 | `fn_mapa_cerebro_v0`, `vw_cac_por_segmento`, `mv_qualidade_campanha` |
| **protegido por `DISTINCT ON` / `row_number`** | **8** | **`vw_midia_coorte_aquisicao_shadow`**, `fn_exp001_coorte`, `fn_atribuir_resultado_decisao_agente` |
| a classificar caso a caso | 32 | `fn_lead_eh_recorrente`, `vw_venda_identidade`, `fn_julia_pode_atender` |

**Resposta à pergunta crítica: SIM.** 31 objetos assumem que cada linha `Purchase` é uma compra
econômica única — entre eles **metas da empresa, vendas do dia, performance por campanha e
recorrência**. Duplicar prefixos seria dano real, não cosmético.

O motor do shadow de mídia (`vw_midia_coorte_aquisicao_shadow`) está entre os protegidos —
usa `DISTINCT ON (lead_id)`. **Ele sobreviveria; as metas e a recorrência não.**

## 7. EVENTOS QUE NÃO SÃO RD

349 linhas, **R$ 185.020,16** (28,8% da receita do "pixel"):

| tipo | n | valor | leads | prováveis do mesmo negócio RD |
|---|---|---|---|---|
| uuid | 202 | R$ 127.147,11 | 195 | **5** |
| `csv_backfill_*` | 88 | R$ 26.269,62 | 33 | **0** |
| Mercado Pago (`mp_*`) | 34 | R$ 3.811,43 | 33 | 6 |
| `manual_calcme_*` | 15 | R$ 19.546,73 | 14 | 1 |
| `manual_*` / `balcao_*` | 5 | R$ 7.318,76 | 5 | 0 |
| `purchase_julia_*` | 4 | R$ 781,68 | 4 | 2 |
| outro | 1 | R$ 144,83 | 1 | 0 |

Critério de "provável mesmo negócio": mesmo `lead_id`, valor idêntico e ≤ 3 dias de distância
de um evento derivado do RD.

**Apenas 14 de 349 (4%) parecem duplicar um negócio que já está no RD.** Os demais são vendas
fora do RD ou backfill sem correspondência. **Não somar tudo automaticamente continua correto —
mas o motivo é que são negócios distintos, não que sejam duplicatas.**

O bloco `uuid` (202 linhas, R$ 127.147 — 20% da receita do pixel) **continua com produtor não
identificado.** É a maior lacuna de proveniência que resta.

## 8. RECONSTRUÇÃO CANÔNICA POR `deal_id` (read-only, via CTE)

Deduplicando por `deal_id` sobre as três réplicas — sem escrever nada:

| | negócios | valor |
|---|---|---|
| **união canônica por `deal_id`** | **1.522** | R$ 623.985,05 (R27) |
| tela do RD (Fechamento de Venda) | 1.554 | R$ 628.318,67 |
| **cobertura** | **97,9%** | **99,3%** |

Divergências dentro da união: 16 deals com status conflitante entre réplicas, 25 com valor
divergente acima de 1%. **Regra de resolução necessária e ainda inexistente:** vencer pelo
snapshot mais recente por `coletado_em`, não por `max()` — o que usei aqui é uma aproximação
declarada, e ela infla ligeiramente o valor.

## 9. QUAL DEVE SER A RÉPLICA CANÔNICA

| critério | A. `propostas_rd` | B. `crm_deal_snapshot` | C. réplica derivada do RD |
|---|---|---|---|
| cobertura de `won` | 993 (65%) | 712 (47%) | **alvo: 100%** |
| identidade por `deal_id` | sim | sim | sim |
| valor | `total_price` | payload cru | payload cru |
| status | sim | sim | sim |
| `closed_at` | sim | sim | sim |
| **itens** | **sim** (79% dos won) | não | via `deal_produtos_rd_obs` |
| atualização | contínua | contínua | a definir |
| **histórico de versões** | **não** — sobrescreve | **sim** (6.868 p/ 3.559) | sim |
| facilidade de dedup | boa | boa | **por construção** |
| **semântica correta** | proposta, não negócio | coleta, não negócio | **negócio** |

**Nenhuma das existentes serve como está.** `propostas_rd` é a mais rica (é a única com itens) e
a mais coberta, mas é orientada a *proposta/PDF* e não guarda histórico. `crm_deal_snapshot` tem
a semântica de log correta e a pior cobertura.

**Recomendação: C — uma réplica canônica de negócio, com `deal_id` como chave única**, alimentada
pelo webhook (baixa latência) **e** por um reconciliador paginado (completude), ambos escrevendo
na mesma chave. `propostas_rd` e `crm_deal_snapshot` continuam como o que já são: extração de
proposta e log de coleta.

**E o critério que decide não é volume.** `pixel_events` hoje contém mais negócios `won` que
qualquer réplica (1.228) — e é justamente o pior candidato: não tem `deal_id` como coluna, não
tem status, não tem etapa, e mistura seis origens diferentes.

## 10. PAPEL FUTURO DE `pixel_events`

**Sim, isso mistura evento de marketing com fato comercial — e a mistura já custou uma rodada
inteira** (a "terceira verdade concorrente" da R26, que a R27 mostrou ser artefato).

Argumentos de cada lado, medidos:

| manter `won` em `pixel_events` | separar |
|---|---|
| 82 objetos já leem de lá; separar exige migrar todos | o nome mente: 0% dos `Purchase` vêm de navegador |
| `deal-won-ingest` grava atribuição junto (`campaign_id`, `adset_id`, `ad_id`) — o join com mídia fica trivial | 31 desses objetos são vulneráveis a duplicata porque a tabela não tem chave de negócio |
| a trigger de dedup existe e vem segurando | a defesa é uma janela de ±10 min sobre `value`, não uma chave |
| `event_time` já é útil para coorte e janela | **os dois produtores usam `event_time` com semânticas diferentes** — `closed_at` vs. instante da ingestão |

**Conclusão: manter é aceitável no curto prazo, com uma condição — `deal_id` precisa virar
coluna com índice único, não sufixo de string em `event_id`.** Enquanto a identidade do negócio
existir apenas embutida num texto com prefixo variável, cada novo produtor recria o mesmo bug, e
a única defesa continua sendo uma heurística de 10 minutos.

A separação completa (fato comercial fora de `pixel_events`) é o desenho certo, mas é trabalho
de migração de 82 consumidores — **e a R26 já registrou que o ERP será a fonte canônica da
economia operacional.** Não faz sentido migrar duas vezes.

## 11. SIMULAÇÃO DA PAGINAÇÃO — se ela funcionasse amanhã

Universo simulado: **1.522** negócios `won` conhecidos. Resolução de lead reproduzindo o código
(`deal_rdstation_id`, senão `contact_rdstation_id`).

| grupo | deals | valor | o que aconteceria |
|---|---|---|---|
| **A** já tem `rd_won_` | 353 | — | `ja_existia`, não insere |
| **B** sem lead resolvível | 371 | — | `sem_lead`, não insere |
| **C** genuinamente novos | **206** | **R$ 121.415,05** | **entram — é o ganho real** |
| **D** já existem como `won_<id>` | **592** | **R$ 250.621,97** | **tentaria 2ª linha do mesmo negócio** |

O grupo D é o risco. Testando cada um contra as condições exatas da trigger (mesmo `lead_id`,
mesmo `value`, ±10 min), nos 561 com dados suficientes:

| | deals | |
|---|---|---|
| `lead_id` resolveria diferente | 23 | trigger não pega |
| valor diferente | 65 | trigger não pega |
| gap > 10 min | 25 | trigger não pega |
| **BLOQUEADOS pela trigger** | **453 (80,7%)** | |
| **DUPLICARIAM** | **108 (19,3%)** | **R$ 47.478,29** |

### Mudança artificial que isso produziria

| | hoje | depois | efeito |
|---|---|---|---|
| receita `won` no pixel | R$ 456.916 | + R$ 121.415 legítimos **+ R$ 47.478 fantasmas** | **+10,4% de receita inexistente** |
| compradores | 491 | 491 | — |
| **recomprantes** | **216 (44,0%)** | **239 (48,7%)** | **+23 leads que nunca recompraram** |

**23 clientes de compra única passariam a "recomprantes" sem ter comprado nada**, e a taxa de
recompra subiria 4,7 pontos. Essa taxa é insumo direto do portão G3 do motor da R26 — o portão
que decide se uma campanha com ROAS ruim merece sobreviver.

### Auto-refutação da própria simulação

**A evidência empírica contradiz meu limite superior, e preciso registrar isso.**

O sync roda desde maio tentando inserir (36 linhas só hoje) e **zero linhas entraram em 3,5
meses**. Se 19,3% escapassem, algumas já teriam entrado.

Causa provável da diferença: eu usei `max(total_price)` das duas réplicas como o valor que o
sync usaria; o sync usa o valor **vivo da API no momento da chamada**, que quase sempre é o
mesmo que o webhook capturou. Minha união introduz divergência artificial.

**Portanto: 108 deals / R$ 47.478 é um limite superior, não uma previsão.** O valor real é
provavelmente muito menor. Mas **não é zero garantido** — as três condições de escape existem
de fato, e a única coisa que impede o dano é uma heurística que ninguém escreveu para isso.

## 12. RISCOS

1. **A defesa é acidental.** `trg_pixel_events_dedup` foi escrito para duplicatas do Make, com
   janela de ±10 min sobre `value`. Ele está protegendo a receita da empresa por coincidência.
   Qualquer mudança nele — ou um produtor que grave `value` NULL, onde `value = NEW.value` é
   `NULL` e o `EXISTS` falha — abre a porta.
2. **Silêncio em três camadas.** Cron diz `succeeded`, edge diz `pixel_insert ok`, e o banco
   descarta. Nenhum alarme dispara. Isso vale para qualquer produtor futuro.
3. **`meta.total = 0`** faz qualquer conserto de paginação parecer bem-sucedido e não trazer nada.
4. **Cada novo produtor recria o bug**, porque a identidade do negócio é um prefixo de string.
   Já aconteceu três vezes: `crm-pixel-sync` (aposentada), `rd-won-pixel-sync`, `deal-won-ingest`.
5. **Viés de funil**: as réplicas não conseguem, por construção, enxergar `won` fora de Vendas.

## 13. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| A trigger resolve, então é seguro paginar? | **Não.** Ela cobre 80,7% do grupo D por heurística, não por chave. E não cobre `value` NULL |
| O grupo C (206 novos) não compensa o risco? | Compensa **se** houver dedup por `deal_id`. Sem isso, R$ 121k legítimos vêm junto com até R$ 47k falsos |
| Minha simulação superestima o dano? | **Sim, e eu mostro isso no §11.** 3,5 meses de tentativas sem uma linha gravada contradizem os 19,3% |
| Minha simulação pode subestimar? | **Também.** Não modelei `value` NULL, nem deals cujo valor mudou após o `won_` — e os 5 `won_` com valor nulo/zero escapariam certamente |
| `deal_id` pode não ser estável no RD? | Não observei mudança. Mas não tenho histórico de `deal_id`, só de valor e status |
| Os 202 eventos `uuid` podem ser RD? | Só 5 batem com um negócio RD. Produtor não identificado — lacuna aberta |
| A união de 1.522 pode dupla-contar? | Não: `deal_id` distinto. Mas o `max(total_price)` infla levemente o valor — declarado |
| A tela do RD pode estar defasada? | Nos dois sentidos. Por isso reporto cobertura (97,9% / 99,3%), não igualdade |
| Aposentar `rd-won-pixel-sync` perderia os 206 do grupo C? | **Sim** — e é o argumento contra a solução mais simples. Os 206 precisam entrar por algum caminho |

## 14. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e não é paginar: **fazer `deal_id` virar coluna com índice único, antes de
qualquer produtor novo escrever uma linha.**

Ordem de execução, e a ordem importa:

1. **`deal_id` como coluna + índice único parcial** (`where deal_id is not null`). Com isso, um
   segundo produtor recebe erro de chave em vez de criar receita fantasma — e a defesa deixa de
   depender de uma janela de 10 minutos sobre `value`.
2. **Só então** consertar a busca do `rd-won-pixel-sync` — e o conserto **não é o laço de
   páginas**: é o `meta.total = 0`. Paginar por "página cheia" (`count === 100 → busca a
   próxima`) em vez de confiar no total.
3. **Só então** decidir o que fazer com os 371 `sem_lead`, que são 24% do universo e hoje somem
   sem registro.

E duas verificações que continuam abertas e não dependem de nada acima:

- **Existe `won` fora do funil Vendas?** Uma chamada à API sem `pipeline_id` responde. Se
  existir, nenhuma réplica o tem, e a reconciliação de 99,3% vale só para o funil Vendas.
- **Quem produz os 202 eventos `uuid`** (R$ 127.147, 20% da receita do pixel)?

Não recomendo aposentar `rd-won-pixel-sync` como se fez com a irmã em agosto: ela é o único
caminho que enxerga os **206 negócios do grupo C** que o webhook perdeu. O problema dela é a
falta de chave, não a existência.
