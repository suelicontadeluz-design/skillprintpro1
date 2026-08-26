# R58 — leitura economica de cliente por identidade (canario)

Executada em 2026-08-26. **Duas views novas e isoladas. Zero alteracao em
`pixel_events`, em lead, em identidade e nas 34 views existentes.**

## Veredito

**CLIENTE_ECONOMICO_CANARIO_VALIDADO**

## §0 — Reancoragem, com deriva legitima declarada

| item | medido |
|---|---|
| R49 | **3 identidades / 6 vinculos de lead** |
| R57 | **7 identidades / 9 vinculos de deal**, R$5.250,41, **0 contradicoes** |
| `identidade_comercial` total | **10** |

A base e viva e derivou durante a propria rodada: `Purchase` foi de **1.599 → 1.600**
e `leads_marketing` de 16.039 → **16.040**, por vendas e leads inbound do dia.

Isso apareceu como um susto real: uma consulta deu `216 + 1.384 = 1.600` contra um
total de 1.599 medido minutos antes, o que pareceu duplicacao no join. Investiguei
antes de seguir: `pixel_crm_sync_map` tem **0 `event_id` repetidos** e o total ja
era 1.600 — **uma venda nova chegou entre as duas consultas**. Nao havia bug.
Nenhum total absoluto foi usado como guarda.

## §1 — Fonte canonica local da perna B: `propostas_rd`

A view nao pode fazer HTTP. Comparei as candidatas locais contra a RD ao vivo,
deal a deal:

| fonte | valor bate | `closed_at` bate | status won | veredito |
|---|:--:|:--:|:--:|---|
| **`propostas_rd`** | **9/9** | **9/9, ao microssegundo** | **9/9** | **escolhida** |
| `crm_deals_cache` | 9/9 | **nao tem a coluna** | 9/9 | rejeitada |
| `crm_deal_snapshot` | — | — | — | **0 de 9** (R54) |

`propostas_rd` nao foi escolhida por ter as colunas, e sim por **bater ao vivo**.
E `deal_id` e **UNIQUE** nela (11.911 linhas, 11.911 distintos, 0 duplicados) —
confirmado tambem pelo plano de execucao, que usa `propostas_rd_deal_id_key`.

## §2/§3 — Anti-duplicacao

`canonical_deal_id` = prefixo do `event_id` **uniao** `pixel_crm_sync_map.deal_id`.

- **Perna A**: todo `Purchase`.
- **Perna B**: `identidade_comercial_deals` **apenas** quando
  `NOT EXISTS` representacao canonica daquele `deal_id` na perna A.

Nao ha `UNION ALL` cego. O plano confirma **`Hash Right Anti Join`**.

| guarda | resultado |
|---|---:|
| `deal_id` duplicado no fato | **0** |
| linhas no fato | **1.609** = 1.600 Purchase + 9 |
| receita da perna A **=** receita direta de `pixel_events` | **R$639.973,39 = R$639.973,39** |
| alias removido na R53 ressuscitado | **0** |
| os 9 da R57 aparecem | **exatamente 9** |
| perna B sem valor ou sem data | **0** |
| `cliente_key` nulo | **0** |

**216 Purchase nao tem `deal_id` canonico** (`mp_pix`, `csv_backfill`, manual,
R$83.522,60). Sao vendas reais e entram **por evento**, nao por deal — por isso a
chave do fato e `deal_id` quando existe e `EVT:<event_id>` quando nao.

## §4 — `vw_fato_comercial_identidade_canario`

Uma linha por venda comercial canonica: `deal_id`, `event_id`, `lead_id`,
`value`, `ocorrido_em`, `pessoa_via_lead`, `pessoa_via_deal`, `pessoa_id`,
`status_resolucao`, `origem_identidade` (`LEAD`/`DEAL`), `possui_lead`,
`possui_atribuicao`, `fonte_fato` (`PURCHASE`/`IDENTIDADE_DEAL`), `cliente_key`.

## §5 — Resolucao de identidade

| `status_resolucao` | linhas |
|---|---:|
| SEM_IDENTIDADE | 1.549 |
| SOMENTE_LEAD | 51 |
| **SOMENTE_DEAL** | **9** |
| AMBAS_IGUAIS | 0 |
| **CONTRADICAO** | **0** |

Quando lead e deal discordam, `pessoa_id` e `cliente_key` ficam **NULL**,
`status_resolucao = 'CONTRADICAO'` e a linha **sai do agregado economico**.
Nao ha `COALESCE` silencioso em lugar nenhum.

## §6 — Fallback: nenhum comprador desapareceu

`cliente_key` = `pessoa_id` quando existe, senao `LEAD:<lead_id>`.
**Isso nao cria identidade no banco** — e agrupamento de leitura.

| agrupamento | clientes |
|---|---:|
| por `pessoa_id` materializada | **10** |
| por `LEAD:<lead_id>` (fallback) | **500** |
| **total** | **510** |

O universo atual e reproduzido integralmente; o que colapsa sao **somente
equivalencias ja provadas**.

## §7 — Clientes: cada delta explicado

| conceito | valor | delta |
|---|---:|---|
| **A** — `COUNT(DISTINCT lead_id)` comprador | **505** | — |
| **B** — apos equivalencias R49, sem os 9 | **503** | **−2**: 5 leads compradores da R49 colapsam em 3 identidades |
| **C** — canario (R49 + R57) | **510** | **+7**: as 7 pessoas novas da R57 |

A R56 previu ≈504 / ≈502 / ≈509. Hoje e 505 / 503 / 510 — **cada numero um a mais**,
porque a base ganhou um comprador novo no dia. Os **deltas** sao exatamente os
previstos: **−2** e **+7**.

O −2 nao e perda: e **correcao de contagem dupla que ja existia**.

## §8 — Receita reconciliada

| medida | valor |
|---|---:|
| perna A (Purchase) | R$639.973,39 (1.600) |
| perna B (deal sem Purchase) | **R$5.250,41** (9) |
| **receita comercial canario** | **R$645.223,80** (1.609) |
| soma por cliente = soma do fato | **SIM** |
| nenhum deal contado duas vezes | **SIM** |

## §9 — Gabriela

| prova | resultado |
|---|---|
| clientes | **1** |
| compras | **3** |
| receita | **R$2.939,50** |
| dias de relacionamento | **43** |
| recompra | **true** |
| `possui_lead` | **false** |
| leads artificiais | **0** |

Nao virou 3 clientes. Receita nao duplicou.

## §10 — Vanessa

| prova | resultado |
|---|---|
| clientes | **1** |
| compras | **26** |
| receita | **R$12.694,90** |
| linhas no fato sob a mesma pessoa | **26** — os dois leads juntos |
| alias removido na R53 | **nao ressuscitado** |

Bate exatamente com o fechamento da R53. Nao voltou a ser 2 clientes.

## §11 — Aquisicao

| medida | valor |
|---|---:|
| receita atribuivel | **R$74.744,86** — **identica** a de hoje |
| receita sem atribuicao | R$570.478,94 |
| clientes com deal sem lead **e** receita atribuivel > 0 | **0** |

Os 9 entram em **receita comercial**, nunca em **receita atribuivel**. Nenhuma
campanha, UTM ou CAC nasceu.

## §12 — Ticket: dois nomes diferentes, de proposito

| metrica | definicao | valor |
|---|---|---:|
| **ticket por venda** | receita / vendas | **R$401,01** |
| **ticket por cliente** | receita / clientes | **R$1.265,14** |
| ticket por cliente, como hoje | receita / `COUNT(DISTINCT lead_id)` | R$1.267,27 |

Cai R$2,13. **Correcao, nao deterioracao**: o denominador passou a contar clientes
reais em vez de registros de lead.

## §13 — Recompra e LTV

**Recompra** = mesma identidade economica com **≥ 2 vendas canonicas distintas** —
nunca ≥2 leads, nunca ≥2 Purchase sem canonicalizacao. Resultado: **216 clientes
com recompra**.

**LTV_OBSERVADO** = soma historica conhecida das vendas da identidade. Nome
explicito de proposito: **nao projeta futuro e nao e margem**.

## §14 — Coorte

Nao implementada coorte de aquisicao. A view expoe apenas `first_purchase_at`
por identidade, base futura de **COORTE_DE_CLIENTE**. `lead_t0` continua
conceito separado e nao foi tocado.

## §15 — Performance

`EXPLAIN ANALYZE` do agregado completo de clientes:

```
Execution Time: 13.243 ms · Planning 3.290 ms
Buffers: shared hit=1574  (100% cache, zero leitura de disco)
HashAggregate -> 510 clientes
```

- `identidade_comercial_deals` e `_leads`: **Bitmap Index Scan** nos indices
  parciais criados na R49/R57.
- `propostas_rd`: **Index Scan** em `propostas_rd_deal_id_key`, 9 loops.
- `pixel_events`: **Seq Scan** filtrando `event_name='Purchase'` (1.600 de 30.544),
  1.526 dos 1.574 buffers.

O Seq Scan e o custo dominante e **e o mesmo que as 34 views atuais ja pagam** —
nao ha indice em `event_name`. **Nenhum indice novo foi criado**: criar um teria
efeito em toda a base para beneficiar um canario, o que nao esta provado.

13 ms e aceitavel. `PERFORMANCE_INACEITAVEL` descartado.

## §16 — Preservacao

| item | resultado |
|---|---|
| **hash das 34 views** | **`f7e6cf306f04305ef91cbf9163c30911` — identico ao da R57** |
| quantidade de views existentes | **34** |
| `pixel_events` | 30.544 linhas, inalterado |
| Purchase | 1.600 / R$639.973,39 — inalterado |
| `leads_marketing` | inalterado por mim (16.040, cresceu por inbound organico) |
| `identidade_comercial` | **10** |
| vinculos R49 | **6 / 3** |
| vinculos R57 | **9 / 7** |
| views novas criadas | **3** (as 2 desta rodada + a de teste da R57) |
| MAPA / scorecards / CAC / campanha | **nao tocados** |

## §17 — Auto-refutacao

| tentativa de refutar | resultado |
|---|---|
| algum deal entra duas vezes? | **0** duplicados; perna A confere centavo a centavo com `pixel_events` |
| algum Purchase nao tem deal canonico? | **216** — e correto: entram por `EVT:<event_id>`, sao vendas reais |
| fallback por lead cria cliente duplicado? | nao: 500 + 10 = **510**, e o colapso e so das equivalencias provadas |
| identidade colapsa pessoas diferentes? | Vanessa 1, Gabriela 1; **0 contradicoes**; os 7 da R57 tem documento e telefone unicos (R57 §1) |
| deal sem lead ganha aquisicao? | **0** clientes com `possui_deal_sem_lead` e receita atribuivel |
| valor local diverge da RD? | **9/9 iguais** |
| `closed_at` diverge? | **9/9 iguais ao microssegundo** |
| cliente desaparece? | nao: **510 ≥ 505** |
| Gabriela duplica? | nao: 1 cliente, 3 compras |
| Vanessa divide? | nao: 1 cliente, 26 compras |
| os 9 mudam receita atribuivel? | **nao**: R$74.744,86 antes e depois |
| contagem cai por cobertura incompleta? | nao — foi o gate do §6, e o fallback resolve |

Nenhuma refutacao sobreviveu.

## §18 — Rollback

Puramente aditivo, sem tabela:

```sql
drop view public.vw_cliente_economico_canario;
drop view public.vw_fato_comercial_identidade_canario;
-- opcional: drop view public.vw_teste_resolucao_identidade;  (R57)
```

Nada mais foi tocado.

## §19 — Proximo passo

**R59 — decidir se o canario vira producao, e para qual consumidor primeiro.**
A leitura esta provada; o que falta e escolha de negocio:

1. Qual view existente de cliente passa a apontar para
   `vw_cliente_economico_canario` — e o antes/depois dela medido individualmente.
2. Se o MAPA passa a publicar **dois** numeros (comercial R$645.223,80 e
   atribuivel R$74.744,86) em vez de um.
3. Se `LEAD:<lead_id>` continua fallback permanente ou se as ~500 identidades
   passam a ser materializadas — o que **nao** recomendo por varredura automatica,
   pela mesma razao da R49.

Nao substituir nada antes disso.

Registrados, sem mudanca: os 3 PROVAVEL (R$1.859,23); os 12 SEM_EVIDENCIA
(R$7.392,95); as 2 views indeterminadas da R56; a divida do indice unico em
`erp_pessoa_id`; o `lead_t0` de 2025-08-22 da Vanessa/Alean; os pares suspeitos
da Igreja e do Kleberson; `fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa;
`crm_deals_cache` congelado desde 16/08.
