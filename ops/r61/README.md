# R61 — recorrencia economica oficial, sem tocar no gating

Executada em 2026-08-26. **Uma view nova de leitura. Nenhum objeto operacional
alterado.**

## Veredito

**RECORRENCIA_ECONOMICA_OFICIAL_VALIDADA**

## §0 — Reancoragem da R60

| verificacao | resultado |
|---|---|
| `fn_lead_eh_recorrente` hash | `b8013b03…` — **inalterado** |
| `vw_clientes_recorrentes_chat` hash | `8637ee58…` — **inalterado** |
| perna 2 da view decide sozinha? | **0 casos** — segue sendo codigo morto |
| `julia_atende_recorrentes` | **`false`** — gate ativo |
| consumidores de `fn_lead_eh_recorrente` | **2**, os mesmos dois gates |

## §1 — Vocabulario fixado

Escrito no `comment on view`, para nao voltar a se perder:

| conceito | definicao | onde vive |
|---|---|---|
| **CLIENTE_COM_HISTORICO_DE_COMPRA** | cliente economico com **≥1** venda canonica | `vw_clientes_recorrentes_economico` |
| **CLIENTE_RECORRENTE_ECONOMICO** | cliente economico com **≥2** vendas canonicas distintas | idem |
| **LEAD_JA_COMPROU** | lead especifico com ≥1 Purchase | `fn_lead_eh_recorrente` (nao tocada) |
| **LEAD_BLOQUEADO_POR_POLITICA** | decisao operacional do agente | `fn_*_pode_atender` (nao tocadas) |

## §2/§3 — A regra `>=2`, depois de tentar derruba-la

Distribuicao real dos 510 clientes economicos:

| compras | clientes | receita |
|---:|---:|---:|
| 1 | 294 | R$191.947,66 |
| 2 | 89 | R$99.742,13 |
| 3 | 34 | R$44.019,18 |
| 4 | 15 | R$47.381,07 |
| 5 | 15 | R$33.316,05 |
| 6+ | 63 | R$228.817,71 |

Tentativas de refutacao **antes** de implementar:

| ataque | medida | sobreviveu? |
|---|---:|---|
| "≥2 e artefato de duplicacao" | duplicacao canonica = **0** (R53); **183** dos 216 tem ≥2 **deals** canonicos | **sim** |
| "duas compras no mesmo dia sao um pedido so" | **11** clientes tem todas as compras num unico dia (R$8.157,09); **10** deles com exatamente 2 | **sim, com ressalva** |
| "recorrencia sustentada so por evento sem deal_id" | **33** clientes (R$38.925,81); **6** deles sem nenhum deal canonico | **sim, com ressalva** |
| "usar ≥3, como o legado" | ≥3 daria 127 e **descartaria 89 clientes com recompra real** | ≥3 refutada |

A regra sobrevive. As duas ressalvas **nao foram escondidas** — viraram coluna.

### `recorrencia_confianca`, em vez de fingir certeza

| nivel | criterio | clientes | receita |
|---|---|---:|---:|
| **ALTA** | ≥2 deals canonicos, em dias distintos | **181** | R$412.462,05 |
| **MEDIA** | ≥2 deals canonicos, **todos no mesmo dia** | **2** | R$1.888,28 |
| **BAIXA** | recorrencia depende de evento **sem** `deal_id` | **33** | R$38.925,81 |
| NAO_RECORRENTE | <2 compras | 294 | R$191.947,66 |

Os niveis sao **em cascata** (BAIXA tem precedencia sobre MEDIA), por isso
MEDIA = 2 e nao 11: os outros 9 do "mesmo dia" ja caem em BAIXA por falta de
deal canonico. Preferi a classificacao mais conservadora.

**A validacao mais bonita disso:** a **Igreja Batista** caiu sozinha em
**MEDIA** — 2 compras, R$933,48, ambas em 23/02, com 19 minutos de diferenca.
E exatamente o par que a R48 marcou como suspeita de duplicacao **na propria
RD**. A coluna de confianca encontrou o caso sem que eu apontasse para ele.

## §4 — `vw_clientes_recorrentes_economico`

Campos: `cliente_key`, `pessoa_id`, `lead_id_fallback`, `qtde_compras`,
`receita_total`, `primeira_compra`, `ultima_compra`,
`dias_entre_primeira_ultima`, `cliente_com_historico_de_compra`,
`recorrente_economico`, `possui_identidade_materializada`,
`possui_deal_sem_lead`, `dias_distintos_de_compra`,
`compras_com_deal_canonico`, `compras_sem_deal_canonico`,
`receita_atribuivel`, `receita_sem_atribuicao`, `ltv_observado`,
`recorrencia_confianca`.

Consome a camada canonica da R58. Nao toca em nada.

## §5 — Funcao: **nao criei**, de proposito

O enunciado admitia `fn_cliente_eh_recorrente(p_cliente_key text)` e dizia
*"view suficiente e preferivel"*. Uma consulta pontual e
`select recorrente_economico from vw_clientes_recorrentes_economico where cliente_key = $1`
— a view **e** o contrato. Criar a funcao adicionaria uma superficie a manter e,
pior, **um segundo lugar onde a regra `>=2` poderia divergir**.

## §6/§7/§8 — Canarios

| cliente | compras | receita | recorrente | confianca | `lead_id_fallback` |
|---|---:|---:|:--:|---|---|
| **Gabriela Anjos** | **3** | **R$2.939,50** | **true** | **ALTA** | **NULL** |
| **Vanessa Büher** | **26** | **R$12.694,90** | true | ALTA | preenchido |
| **Kleberson** | **23** | **R$13.277,72** | true | ALTA | preenchido |
| Igreja Batista | 2 | R$933,48 | true | **MEDIA** | preenchido |

Gabriela: `lead_id_fallback = NULL` — **zero leads artificiais**, exatamente
como exigido. Vanessa: dois leads vivos, uma cliente, alias da R53 nao
reapareceu. Kleberson: agregado pela identidade; a duvida dos possiveis deals
duplicados na propria RD **nao foi resolvida aqui** — a leitura reflete apenas
os fatos hoje canonicos.

## §9 — Fallbacks

| grupo | clientes |
|---|---:|
| recorrentes **sem** identidade materializada | **212** |
| nao recorrentes sem identidade | **288** |
| identidades no banco | **10 — inalterado** |

Os 500 compradores sem identidade continuam aparecendo, com ≥2 compras
classificados como recorrentes e 1 compra como nao recorrentes. **Nenhuma
identidade foi criada.**

## §10 — Comparacao com o legado

| medida | valor |
|---|---:|
| OLD (`>=3` por lead) | **126** |
| NEW (`>=2` por cliente economico) | **216** |
| **intersecao** | **126** |
| **so OLD** | **0** |
| so NEW | **90** |

**OLD e subconjunto perfeito de NEW.** Ninguem sumiu.

Os 90 novos, por semantica:

- **89** clientes com exatamente **2** compras — o legado exigia 3;
- **1** Gabriela — o legado exige `lead_id`, e ela nao tem.

## §11 — Nao e gating: provado

| consumidor da view nova | contagem |
|---|---:|
| views | **0** |
| funcoes | **0** |
| triggers | **0** |
| crons | **0** |

Zero superficie operacional. A leitura e economica e so.

## §12 — Metricas

| indicador | valor |
|---|---:|
| clientes economicos | **510** |
| com historico de compra (≥1) | 510 — R$645.223,80 |
| **recorrentes (≥2)** | **216** — R$453.276,14 |
| apenas primeira compra | 294 — R$191.947,66 |
| **taxa de recompra** | **42,4%** |
| LTV observado medio | R$1.265,14 |
| LTV observado **mediano** | **R$487,78** |
| LTV observado medio dos recorrentes | **R$2.098,50** |

A distancia entre media (R$1.265,14) e mediana (R$487,78) diz que a receita e
concentrada: os 63 clientes com 6+ compras respondem por R$228.817,71, mais de
um terco do total.

**Nenhuma projecao de lifetime futuro.** `ltv_observado` e soma historica.

## §13 — Os 216 eventos sem `deal_id`

Nao reaberto. Medido o que a rodada pedia:

| medida | valor |
|---|---:|
| clientes recorrentes com **menos de 2** deals canonicos | **33** — R$38.925,81 |
| clientes recorrentes com **zero** deal canonico | **6** — R$7.145,78 |

Sao os **BAIXA**. Ficam visiveis e classificados, nao removidos: sao vendas
reais, so nao ha `deal_id` para checar duplicacao pelo mecanismo canonico.

## §14 — Performance

| | tempo | buffers |
|---|---:|---:|
| `vw_clientes_recorrentes_chat` (OLD) | 38,5 ms | 2.800 |
| `vw_cliente_economico_canario` (R58) | 13,2 ms | 1.574 |
| **`vw_clientes_recorrentes_economico`** | **17,6 ms** | **1.581** |

100% em cache, zero leitura de disco. O custo dominante segue sendo o Seq Scan
em `pixel_events` filtrando `event_name`, **o mesmo que as 34 views atuais ja
pagam**. **Nenhum indice criado** — nao ha necessidade demonstrada.

## §15 — Preservacao

| objeto | resultado |
|---|---|
| `fn_lead_eh_recorrente` | `b8013b03…` **inalterada** |
| `vw_clientes_recorrentes_chat` | `8637ee58…` **inalterada** |
| `fn_julia_pode_atender` | `0582ae31…` inalterada |
| `fn_agente_automatico_pode_atender` | `d22ac0fd…` inalterada |
| `julia_atende_recorrentes` | **`false`** inalterada |
| hash das 34 views | `f7e6cf30…` **identico desde a R57** |
| `pixel_events` / Purchase | 1.600 / R$639.973,39 |
| identidades | **10** (3 R49 + 7 R57) |

## §16 — Divida operacional registrada, **nao corrigida**

1. **`fn_lead_eh_recorrente` tem nome semanticamente enganoso.** Hoje significa
   `LEAD_JA_COMPROU_RECENTEMENTE` (≥1 compra em 2 anos) e e usada como **gate**.
2. **Perna morta:** o `OR EXISTS (vw_clientes_recorrentes_chat …)` nunca decide,
   porque a perna 1 ja cobre todos os casos.
3. **`julia_atende_recorrentes = false`** — o gate esta ativo, entao quem ja
   comprou **nao** e atendido pelos agentes.
4. **Caso `559c601d`** (fragmento da Igreja): unico lead onde pessoa e lead
   divergem. Hoje `pode=true`; sob semantica de pessoa seria `pode=false`.

Nenhum dos quatro foi alterado nesta rodada.

## §17 — Auto-refutacao

| tentativa | resultado |
|---|---|
| `>=2` nao e recompra? | 183 dos 216 tem ≥2 **deals** canonicos; os demais estao marcados BAIXA/MEDIA |
| canonicalizacao ainda duplica? | duplicacao canonica = 0 (R53); o residuo conhecido esta nos EVT e esta classificado |
| fallback distorce cliente? | nao: OLD ⊂ NEW, **so OLD = 0**; 500 fallbacks preservados |
| Gabriela errada? | 3 compras, R$2.939,50, ALTA, `lead_id_fallback` **NULL** |
| Vanessa errada? | 26 compras, R$12.694,90, uma cliente |
| EVT cria recorrencia falsa? | **pode** — sao os 33 BAIXA e os 6 sem deal nenhum. Por isso a coluna existe |
| a nova leitura esta sendo consumida por operacao? | **0** views, funcoes, triggers e crons |
| alguma pessoa diferente foi colapsada? | so as equivalencias ja provadas (R49/R57); `CONTRADICAO` = 0 |

Nenhuma refutacao derrubou o veredito. Duas viraram coluna em vez de nota de
rodape.

## §18 — Rollback

```sql
drop view public.vw_clientes_recorrentes_economico;
```

Nada mais foi tocado.

## §19 — Proximo passo

**R62 pode promover a recorrencia economica como fonte do MAPA, sem tocar no
gating.** O que ja esta pronto para isso:

- **receita comercial observada**: R$645.223,80
- **receita atribuivel**: R$74.744,86
- **clientes economicos**: 510
- **recorrentes**: 216 (42,4%)
- **LTV observado**: medio R$1.265,14 / mediano R$487,78

Recomendo que o MAPA exiba **`recorrencia_confianca`** junto do numero de
recorrentes — 33 dos 216 sao BAIXA, e esconder isso seria repetir o erro que
esta rodada acabou de desfazer.

Registrados, sem mudanca: a divida operacional do §16; os 3 PROVAVEL
(R$1.859,23); os 12 SEM_EVIDENCIA (R$7.392,95); os 216 eventos sem deal e seus
2 sinais residuais; as 2 views indeterminadas da R56; a divida do indice unico
em `erp_pessoa_id`; o `lead_t0` de 2025-08-22 da Vanessa/Alean; os pares
suspeitos da Igreja e do Kleberson; `fn_fechar_tasks_apos_compra`; os 329
orfaos do mapa; `crm_deals_cache` congelado desde 16/08.
