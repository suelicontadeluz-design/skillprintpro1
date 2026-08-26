# R59 — primeiro consumidor economico real em canario

Executada em 2026-08-26. **Uma view paralela criada. A antiga segue intacta e
continua sendo a unica em producao.**

## Veredito

**CONSUMIDOR_CLIENTE_V2_VALIDADO**

Todos os deltas explicados por causa. **Nenhum delta ficou como "a view nova
conta diferente".**

## §0 — Reancoragem da R58

| item | medido |
|---|---|
| fato canario | **1.609 linhas / R$645.223,80** |
| `deal_id` duplicado | **0** |
| CONTRADICAO | **0** |
| os 9 da R57 | **exatamente 9** |
| clientes economicos | **510** |
| Gabriela | 3 compras / R$2.939,50 / 43 dias |
| Vanessa | 26 compras / R$12.694,90 |

## §1 — `LEAD:<lead_id>` nao e identidade

A V2 expoe a coluna `classe_identidade` com dois valores explicitos:

- `IDENTIDADE_MATERIALIZADA` — identidade provada (R49/R57)
- `CLIENTE_AINDA_NAO_MATERIALIZADO` — chave `LEAD:<lead_id>`, **agrupamento
  transitorio de leitura**

Nenhuma linha foi criada em `identidade_comercial` para esses casos.

## §2 — Inventario dos consumidores de cliente

| view | linhas | fonte | consumidores | risco de troca |
|---|---:|---|---|---|
| **`vw_clientes_recorrentes_chat`** | **126** | **`pixel_events`** | 0 views, **1 funcao**, 0 crons | **alto na promocao** (ver abaixo) |
| `vw_cliente_frequencia_status` | 1.135 | **`calcme_pedidos`** | 0 / 0 / 0 | — |
| `vw_clientes_frequencia_resumo` | 1.135 | **`calcme_pedidos`** | **2 views** | — |
| `vw_sheets_clientes_frequencia_export` | 1.135 | derivada da acima | consumo externo (Sheets) | — |
| `vw_sheets_clientes_frequencia_sanitizada` | 1.135 | derivada da acima | consumo externo (Sheets) | — |

**A escolha foi forcada pelo dado, nao por preferencia:** toda a familia
`frequencia` le `calcme_pedidos`, **nao** `pixel_events`. Elas nao consomem a
semantica de Purchase e nao seriam comparaveis. Sobrou **uma** candidata real.

## §3 — Canario escolhido: `vw_clientes_recorrentes_chat`

Atende aos criterios: e leitura pura, nao escreve, nao controla dinheiro nem
campanha, e a comparacao antiga × nova e direta.

**Mas um criterio nao e atendido, e preciso dizer isso em voz alta:**
a view antiga e consumida por `fn_lead_eh_recorrente`, que por sua vez e
chamada por **`fn_julia_pode_atender`** e **`fn_agente_automatico_pode_atender`**
— ou seja, ela participa do **gating de atendimento por agente**.

Isso **nao** contamina esta rodada, porque a V2 e paralela e **ninguem a
consome**. Mas define a condicao de promocao: trocar essa view em producao
mexeria em decisao de agente, e por isso a promocao **nao** pode ser
automatica (§17).

## §4 — `vw_clientes_recorrentes_chat_v2_canario`

Paralela. Quatro diferencas deliberadas, todas declaradas no `comment`:

1. unidade = **cliente economico**, nao `lead_id`;
2. inclui a perna de deal provado sem Purchase (R57);
3. **omite** `tem_checkout_ativo` / `valor_checkout_ativo` — sao decisao de
   atendimento em janela de 24h, nao economia de cliente;
4. **omite** o filtro `event_source = 'chat'` da antiga, porque hoje ele e
   **no-op**: medido **1.600 de 1.600** Purchase com `event_source='chat'`.
   Registrado, nao presumido.

Mantidos iguais para permitir comparacao: o limiar `HAVING >= 3` e as colunas
economicas.

## §5/§6 — OLD × V2, com causalidade

| metrica | OLD | V2 | delta |
|---|---:|---:|---:|
| clientes | 126 | **127** | **+1** |
| compras | 1.131 | **1.137** | **+6** |
| receita | R$348.279,07 | **R$353.534,01** | **+R$5.254,94** |
| ticket por venda | R$307,94 | R$310,94 | +3,00 |
| receita por cliente | R$2.764,12 | R$2.783,73 | +19,61 |

### Toda a diferenca, por classe

| causa | clientes | Δ compras | Δ receita |
|---|---:|---:|---:|
| **C1** — novo, por deal sem lead | **1** | +3 | **+R$2.939,50** |
| **C4** — mesma pessoa, contagem corrigida | **2** | +3 | **+R$2.315,44** |
| **C5** — identico | **124** | 0 | R$0,00 |
| **C3** — saiu do V2 | **0** | — | — |

2.939,50 + 2.315,44 = **5.254,94**. Fecha exatamente.

### Caso a caso

| cliente | OLD | V2 | por que |
|---|---|---|---|
| **Gabriela Anjos** | **ausente** | 3 compras / R$2.939,50 | nao tem Purchase nenhum; entra pela perna de deal da R57 |
| **Kleberson** | 22 / R$11.477,72 | **23 / R$13.277,72** | o lead fragmento tem **1** Purchase de R$1.800,00 e, sozinho, **nao atinge o `HAVING >= 3`** — no OLD essa compra some |
| **Vanessa Büher** | 24 / R$12.179,46 | **26 / R$12.694,90** | o lead fragmento tem **2** Purchases (R$515,44) e tambem cai fora do limiar |

**Achado que vale registrar:** o OLD **nao divide** Vanessa e Kleberson em dois
clientes — ele **descarta em silencio** as compras do lead menor, porque o
fragmento nao alcanca 3 compras. Isso e pior que dividir: **R$2.315,44
desaparecem sem aparecer em lugar nenhum**. A V2 nao "conta mais": ela para de
perder.

## §7 — Gabriela

| | OLD | V2 |
|---|---|---|
| aparece? | **nao** | **sim** |
| clientes | — | **1** |
| compras | — | **3** |
| receita | — | **R$2.939,50** |
| dias de relacionamento | — | **43** |
| `possui_lead` | — | **false** |
| `possui_deal_sem_lead` | — | **true** |
| leads artificiais | — | **0** |

## §8 — Vanessa

No OLD ela aparece em **1 linha** (`9abb20c2`, 24 compras, R$12.179,46) — o
fragmento `336a959d` fica de fora pelo limiar.

Na V2: **1 cliente, 26 compras, R$12.694,90**, 191 dias. Sem alias da R53.

## §9 — Fallbacks

Amostra dos maiores `CLIENTE_AINDA_NAO_MATERIALIZADO`:

| chave | cliente | compras | receita |
|---|---|---:|---:|
| `LEAD:7eef4d5d…` | Dbora Mdolo Bispo | 14 | R$25.243,55 |
| `LEAD:3a6d8372…` | Jane Ribeiro | 24 | R$24.715,11 |
| `LEAD:87b5d3e0…` | Elmer P Laime | 5 | R$15.249,00 |
| `LEAD:044f7e62…` | Douglas Dias da Luz | 22 | R$14.288,41 |
| `LEAD:fac72414…` | Omar de Laura Rivero | 4 | R$12.019,80 |

Continuam existindo, com suas compras intactas, **nao colapsados** e **nao
promovidos** a identidade. Guarda `clientes do OLD ausentes na V2 = 0`.

## §10 — Receita comercial × atribuivel

| medida | V2 |
|---|---:|
| **RECEITA_COMERCIAL_OBSERVADA** | **R$353.534,01** |
| **RECEITA_ATRIBUIVEL** | **R$53.359,88** |
| receita sem atribuicao | R$300.174,13 |

Os 3 clientes que mudaram tem `receita_atribuivel = 0`. Nenhuma campanha nasceu.

## §11 — Os 216 Purchase sem `deal_id`

Perna classificada como **FATO_EVENTO_SEM_DEAL_CANONICO**. Nao se afirma que
tenham identidade comercial de deal provada — entram por `EVT:<event_id>`.

| medida | valor |
|---|---|
| quantidade | **216** |
| valor | **R$83.522,60** |
| clientes envolvidos | **133** |

| prefixo | linhas / valor |
|---|---|
| `csv_backfill_` | 115 / R$26.269,62 |
| uuid legado | 42 / R$25.649,55 |
| `mp_pix_` | 32 / R$3.774,63 |
| outro | 23 / R$25.329,66 |
| `mp_pack_` | 2 / R$36,80 |
| `bcwon_` / `balcao_` | 1 / R$144,83 e 1 / R$2.317,51 |

**Confianca separada, e menor:** sem `deal_id` nao ha como detectar duplicacao
pelo mecanismo canonico. Busquei o sinal residual possivel (mesmo cliente +
mesmo valor + mesmo dia) e achei **2 grupos**, os dois `csv_backfill`:

- Kleberson, R$0,00 em 23/04 — sem efeito em receita;
- `LEAD:dba94bba…`, **R$203,71 em 24/02**, duas linhas.

**Pre-existente, nao causado pela V2, e nao bloqueia a rodada.** Registrado.

## §12 — MAPA simulado (nenhuma escrita)

| indicador | MAPA hoje | MAPA se consumisse V2 |
|---|---:|---:|
| receita | R$639.973,39 | — |
| **receita_comercial_observada** | — | **R$645.223,80** |
| **receita_atribuivel** | — | **R$74.744,86** |
| clientes | 505 | **510** |
| repeat buyers | 216 | **216** |
| **LTV_observado medio** | — | **R$1.265,14** |

O MAPA passaria de **um** numero de receita para **dois**. **Nada foi alterado.**

## §13 — Materializar os ~500 fallbacks: refutado

Tentei justificar e nao consegui. Beneficio economico imediato de transformar
`LEAD:<id>` em `pessoa_id`: **nenhum**. Os numeros de cliente, receita, recompra
e LTV **ja saem corretos** com a chave transitoria — a prova e que 124 dos 127
clientes da V2 sao identicos ao OLD.

Materializar so faria sentido para **colapsar** leads equivalentes, e isso exige
**evidencia caso a caso**, exatamente como a R49 fez com 3 casos e a R56 provou
ser perigoso generalizar (um `contact_rdstation_id` compartilhado por 6 pessoas
diferentes).

**Identidade nasce com evidencia, nao para completar cadastro.** Fallback
continua.

## §14 — Performance: a V2 e mais rapida

| | OLD | V2 |
|---|---:|---:|
| execucao | **38,5 ms** | **18,9 ms** |
| buffers | 2.800 | 2.215 |
| leitura de disco | 0 | 0 |

Por que: o OLD faz **Seq Scan em `pixel_events` filtrando `event_source='chat'`
(20.006 linhas)** e **Seq Scan na `leads_marketing` inteira (16.040)**. A V2
filtra `event_name='Purchase'` (1.600) e busca apenas os **127 leads que
precisa**, por `Index Scan` na PK.

Ressalva honesta: na primeira medicao a V2 deu 18,3 ms porque o planner
**eliminou o join com `leads_marketing`** (colunas de nome nao usadas no
agregado). Remedi com as colunas de nome no SELECT: **18,9 ms**. O ganho e real.

`PERFORMANCE_BLOQUEIA` descartado.

## §15 — Preservacao

| item | resultado |
|---|---|
| **hash das 34 views** | **`f7e6cf306f04305ef91cbf9163c30911` — identico a R57/R58** |
| `vw_clientes_recorrentes_chat` (OLD) | **definicao intacta** |
| `fn_lead_eh_recorrente` | **corpo intacto** |
| `pixel_events` | 30.544, inalterado |
| Purchase | 1.600 / R$639.973,39 |
| `identidade_comercial` | **10** |
| R49 | **6 / 3** |
| R57 | **9 / 7** |
| MAPA / CAC / campanha / agente | **nao tocados** |

## §16 — Auto-refutacao

| tentativa | resultado |
|---|---|
| cliente desaparece? | **0** clientes do OLD ausentes na V2 |
| pessoa diferente foi colapsada? | so as equivalencias ja provadas (R49); 124 de 127 identicos |
| venda duplicou? | `deal_id` duplicado = **0**; receita da perna A confere com `pixel_events` |
| deal da R57 entra duas vezes? | **9 exatamente 9**, anti-join no plano |
| fallback cria falsa identidade? | nao: `classe_identidade` marca `CLIENTE_AINDA_NAO_MATERIALIZADO` e **0** linhas foram criadas |
| Purchase sem deal esta duplicado? | **2 grupos suspeitos**, pre-existentes, `csv_backfill`, registrados no §11 |
| recompra aumentou artificialmente? | repeat buyers **216 → 216**, sem mudanca |
| receita atribuivel mudou? | os 3 clientes alterados tem atribuivel **0** |
| Gabriela errada? | 1 cliente, 3 compras, R$2.939,50, 43 dias |
| Vanessa errada? | 1 cliente, 26 compras, R$12.694,90 |
| performance piorou? | **melhorou** — 38,5 → 18,9 ms |

Nenhuma refutacao sobreviveu.

## §17 — Decisao de promocao

**Nao trocar producao automaticamente.**

| item | resposta |
|---|---|
| consumidor que **podera** ser substituido | `vw_clientes_recorrentes_chat` |
| delta esperado | **+1 cliente, +6 compras, +R$5.254,94**, com causa conhecida por cliente |
| quem e afetado | `fn_lead_eh_recorrente` → `fn_julia_pode_atender` e `fn_agente_automatico_pode_atender` — **gating de atendimento por agente** |
| rollback | `drop view public.vw_clientes_recorrentes_chat_v2_canario;` — nada mais foi tocado |
| a proxima rodada pode promover? | **so com gate operacional**, ver abaixo |

**Condicao que eu nao considero cumprida ainda:** a V2 muda **quem e
recorrente**, e isso muda **quem o agente pode atender**. Tres clientes passam a
cruzar ou nao o limiar de forma diferente. Antes de promover e preciso medir o
efeito em `fn_julia_pode_atender` e `fn_agente_automatico_pode_atender` — o que
**nao** foi feito nesta rodada, por estar fora do escopo autorizado.

Alternativa de menor risco a avaliar na R60: promover a V2 **apenas para
leitura economica** e deixar o gating de agente continuar lendo a antiga,
separando de vez economia de operacao.

## §18 — Proximo passo

**R60 — medir o efeito operacional antes de promover.** Concretamente: rodar
`fn_lead_eh_recorrente` na semantica antiga e na nova para os leads afetados, e
determinar se algum lead muda de "pode atender" para "nao pode" (ou vice-versa).
So depois decidir entre promover, ou separar economia de gating.

Registrados, sem mudanca: os 3 PROVAVEL (R$1.859,23); os 12 SEM_EVIDENCIA
(R$7.392,95); os 2 grupos `csv_backfill` suspeitos do §11; as 2 views
indeterminadas da R56; a divida do indice unico em `erp_pessoa_id`; o `lead_t0`
de 2025-08-22 da Vanessa/Alean; os pares suspeitos da Igreja e do Kleberson;
`fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa; `crm_deals_cache`
congelado desde 16/08.
