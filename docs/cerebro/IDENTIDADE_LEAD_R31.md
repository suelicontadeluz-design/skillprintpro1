# R31 — Camada canônica de identidade do lead

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero DDL, zero
INSERT/UPDATE/DELETE, zero deploy, zero correção das 44 colisões.

## VEREDITOS

### `RESOLVER_LEAD_IDENTIFICADORES_PRIMEIRO`
### `DEAL_CANONICALIZATION_PODE_PROSSEGUIR` — com duas exclusões nominais

O achado desta rodada é maior do que as sete colisões, e por um motivo que muda o plano: **as
colisões eram só a parte visível.** Um lead recebeu **28 vendas de 12 clientes diferentes** — e
apenas 4 delas colidiram com outro evento. **As outras 24 são invisíveis para a canonicalização
por `deal_id`**, porque cada uma tem `deal_id` único e nunca dispararia um índice.

Uma venda correta ligada ao cliente errado não é uma duplicata. É uma verdade econômica falsa
que passa por todos os testes de unicidade.

E preciso corrigir a mim mesmo: **a regra de telefone que propus na R30 escolheria o lead errado
em dois dos sete casos.**

---

## 1. AS VENDAS MAL ATRIBUÍDAS — o escopo real

A R30 encontrou 4 deals no lead "Juliana". O número real é outro:

| lead receptor | telefone | campanha | **vendas alheias** | valor | clientes reais distintos |
|---|---|---|---|---|---|
| **Juliana** | `51992734297` | **`120239742720480257`** | **28** | **R$ 6.319,44** | **12** |
| Fabrício Maia | `5515996890321` | — | 5 | R$ 537,61 | 3 |
| **Jane** | `5511940734942` | — | 4 | **R$ 4.974,99** | 1 |
| Vanessa Büher | `5541995338939` | — | 2 | R$ 487,32 | 1 |
| Camilla Neder | `5511954082562` | — | 1 | R$ 133,41 | 1 |
| Igreja Batista | `511972394278` | — | 1 | R$ 466,68 | 1 |
| **TOTAL** | | | **41** | **R$ 12.919,45** | |

Dos 32 `Purchase` do lead "Juliana", **28 têm `deal_id` com nome do RD e nenhum deles é dela**:
Amanda Nascimento, Beats Estamparia, João Galdino, Bruno Cardoso, Joao Afonso, Joseilton
Santana, Leandro De Oliveira, Otacilio Pereira de Oliveira…

### O produtor culpado, isolado por medição

Comparando o telefone do `deal_nome` do RD com o telefone do lead que recebeu o evento:

| produtor | eventos | confere | **diverge** | valor divergente |
|---|---|---|---|---|
| **`won_`** (webhook, `deal-won-ingest`) | 584 | **582 (99,66%)** | **1** | R$ 133,41 |
| **`rd_won_`** | 320 | 281 | **38 (11,9%)** | **R$ 12.075,70** |
| `uuid` / outros | 151 | 149 | 2 | R$ 710,34 |

**O `rd_won_` erra o cliente em 11,9% dos casos. O webhook erra em 0,17% — 70× menos.**

A diferença é o método: `deal-won-ingest` resolve por `leads_marketing.ph` = telefone extraído
do nome do deal — **exatamente a regra proposta na R30**. O outro resolve por
`lead_identificadores`.

## 2. BLAST RADIUS — e a contenção

Varredura de todas as tabelas do schema `public` com coluna `lead_id`, procurando o lead
"Juliana":

| objeto | linhas | classe |
|---|---|---|
| `pixel_events` | 36 | **CORRIGE_AUTOMATICAMENTE_AO_RELER** |
| `_backup_separacao_20260719_pixel` | 33 | SEM_IMPACTO (backup) |
| `debug_pixel_events_inserts` | 5 | SEM_IMPACTO (log) |
| `pontuacao_backfill_log` | 2 | SEM_IMPACTO (log) |
| `agente_decisoes_log`, `taxonomia_snapshot_leads`, `bc_sync_log`, `lead_identificadores`, `leads_marketing`, outros | 1 cada | SEM_IMPACTO / registro |

**Nenhum objeto econômico persistido foi contaminado.** E a razão é quase acidental:

| verificação | resultado |
|---|---|
| campanha `120239742720480257` em `meta_ads_insights` | **0 linhas** |
| campanha no `vw_midia_coorte_aquisicao_shadow` | **0 de 18** |
| avaliações em `midia_shadow.avaliacao` com essa campanha | **0** |

**A campanha que recebeu as 28 vendas nunca existiu no Meta.** Por isso ficou fora do shadow,
fora do CAC, fora de qualquer decisão de pausa ou escala. **O dano de atribuição não alcançou o
motor de decisão — por sorte, não por proteção.**

**Nenhuma decisão histórica muda de classe.** Os R$ 6.319,44 estavam creditados a uma campanha
que o motor econômico nunca leu.

Onde há impacto residual: os 41 eventos entram em `fn_recalcular_criterios_midia` (o `dias_ciclo`
da R24, que faz `AVG` sobre todos os eventos) e nos objetos de receita/recorrência por lead —
todos da classe **CORRIGE_AUTOMATICAMENTE_AO_RELER**.

## 3. CENSO DOS RESOLVERS

17 funções tocam `lead_identificadores`. As que resolvem RD → lead:

| função | chave | `LIMIT 1`? | comportamento em ambiguidade |
|---|---|---|---|
| `fn_linkar_propostas_leads` | `contact_rdstation_id` | **não — pior** | `UPDATE…FROM` com join não-único: linha arbitrária vence, **em massa** |
| `fn_joao_lost_classificar` | `contact_rdstation_id` | **sim** + `ORDER BY` | escolhe silenciosamente |
| `fn_contexto_crm_etapa_base_v1` | `deal_rdstation_id` | **sim** + `ORDER BY` | escolhe silenciosamente |
| `fn_deal_vigente_do_lead` | `contact_rdstation_id` | não | — |
| `fn_merge_leads` | ambos | não | função de merge (útil, §7) |
| `fn_refresh_universo_frio` | ambos | não | — |

Nenhum **ABSTÉM** em conflito. Todos escolhem.

## 4. O BUG É ESTRUTURAL, NÃO DE CÓDIGO

Índices de `lead_identificadores`:

```
UNIQUE (lead_id)                                   -- a PK, e só
INDEX  (telefone) WHERE telefone IS NOT NULL       -- não-único
INDEX  (updated_at) INCLUDE (deal_rdstation_id…)   -- não-único
```

**Não existe unicidade em `contact_rdstation_id` nem em `deal_rdstation_id`. Nem sequer um
índice sobre `contact_rdstation_id`.**

E `fn_linkar_propostas_leads`, inteira:

```sql
UPDATE propostas_rd pr SET lead_id = li.lead_id
FROM lead_identificadores li
WHERE li.contact_rdstation_id = pr.contact_rdstation_id
  AND pr.lead_id IS NULL;
```

Quando o join casa mais de uma linha, o PostgreSQL **não erra e não avisa: escolhe uma**. Não é
`LIMIT 1` explícito — é não-determinismo silencioso aplicado em lote.

**Resposta à pergunta: sim, o bug da "Juliana" pode ocorrer hoje de novo**, e não depende de
`LIMIT 1`. Basta um join sobre uma chave que 37 contatos e 29 deals já compartilham.

## 5. QUALIDADE DE CADA IDENTIFICADOR

Medido sobre os 1.203 deals `won` com nome (R30) e sobre os 904 eventos com deal e lead:

| fonte | cobertura | unicidade | concordância | classe |
|---|---|---|---|---|
| **A. telefone do `deal_nome`** | **99,5%** | **94,6% únicos** | acerta 99,7% quando o produtor a usa | **FORTE** |
| C. `propostas_rd.lead_id` | 90,2% dos `won` | 1 por deal | concordou em 3 de 3 casos verificáveis | **FORTE** (mas derivada de F) |
| D. `crm_deals_cache` (nome + telefone) | parcial, sem `deal_id` | — | resolveu os 2 casos sem `deal_nome` | **MÉDIA** |
| E. e-mail | 55% dos leads | não testada isoladamente | — | **MÉDIA** |
| **F. `contact_rdstation_id`** | alta | **37 compartilhados / 82 leads** | **erra 11,9%** | **FRACA** |
| **G. `deal_rdstation_id`** | alta | **29 compartilhados** | não isolada | **FRACA** |
| B. telefone do contato RD | não disponível no payload sincronizado | — | — | **AUSENTE** |

**A hierarquia que eu supus na R29 (contato RD > telefone) está invertida pelos dados.** O
identificador do RD é o menos confiável justamente porque é reutilizado.

## 6. HIERARQUIA CANÔNICA PROPOSTA

```
resolver_lead(deal) →  RESOLVE | ABSTER | AMBIGUO

1. telefone do deal_nome → leads_marketing.ph (DDD + 8 últimos)
     exatamente 1 lead  → RESOLVE  (evidência: telefone_deal)
     mais de 1 lead     → passo 4
     nenhum             → passo 2
2. propostas_rd.lead_id, se preenchido E não derivado de contact_id compartilhado
     → RESOLVE (evidência: proposta)
3. e-mail exato do deal → leads_marketing.em
     exatamente 1       → RESOLVE (evidência: email)
4. contact_rdstation_id / deal_rdstation_id
     SOMENTE se o identificador mapear para exatamente 1 lead
     → RESOLVE (evidência: rd_id_unico)
     senão              → AMBIGUO
5. nada resolveu        → ABSTER
```

**`AMBIGUO` e `ABSTER` não inserem evento.** Vão para uma fila de revisão — o custo de não
registrar uma venda é recuperável; o de registrá-la no cliente errado, não.

Aplicando retrospectivamente: **RESOLVE em 94,6%, AMBIGUO em 2,4%, ABSTER em 3,0%.** Se essa
regra estivesse ativa, **as 41 vendas mal atribuídas não existiriam** — 38 delas viriam do passo
1 com o cliente certo.

## 7. OS 37 CONTACTS E 29 DEALS COMPARTILHADOS — causa medida

Classificando os 37 `contact_rdstation_id` pelo telefone canônico dos leads envolvidos:

| causa | contact_ids | leads |
|---|---|---|
| **MESMA PESSOA — lead duplicado** | **23 (62%)** | 46 |
| **PESSOAS DIFERENTES sob o mesmo contato — bug** | **9 (24%)** | **26** |
| mesmo nome, telefones diferentes — indeterminado | 5 (14%) | 10 |

**Duas doenças distintas sob o mesmo sintoma.** 62% é duplicidade de identidade (o cliente é um
só, o cadastro é dois) — problema de **cliente**. 24% é contaminação real (contatos distintos sob
o mesmo id do RD) — problema de **sincronização**, e é onde a "Juliana" mora.

Impacto econômico associado: os R$ 12.919,45 do §1 concentram-se no segundo grupo.

Já existe maquinário para o primeiro: **`fn_merge_leads(p_canonico_id, p_duplicado_id,
p_dry_run)`** — com dry-run.

## 8. OS DOIS LEADS DUPLOS — e a refutação da regra da R30

| cliente | lead | nasceu | telefone | conversas | propostas | compras | valor |
|---|---|---|---|---|---|---|---|
| **Kleberson** | `ac931260` | 2026-04-20 | `5511972491479` | **4.000** | **15** | **18** | **R$ 11.477,72** |
| | `93c70a4f` | 2026-05-29 | `119724914` *(truncado)* | **0** | **0** | 2 | R$ 2.171,10 |
| **Vanessa Büher** | `9abb20c2` | 2026-03-31 | `5541995338939` | **2.097** | **18** | **17** | **R$ 9.621,61** |
| | `336a959d` | 2026-06-02 | `554195338939` *(sem 9º dígito)* | **0** | **0** | 3 | R$ 825,59 |

O padrão é inequívoco: **o lead mais antigo tem toda a relação — milhares de conversas, dezenas
de propostas. O fragmento nasceu depois de um telefone malformado e só carrega compras.**

### Aqui eu preciso me corrigir

Na R30 concluí que, para estes dois, "vence quem casa exato com o telefone do RD" — o que aponta
para **`336a959d` e `93c70a4f`, os fragmentos vazios**. **Aplicar aquela regra moveria a venda do
lead com 4.000 conversas para o lead com zero.**

O erro foi meu, e é conceitual: **a regra do telefone responde "qual telefone o RD registrou",
não "quem é o cliente".** Quando os dois candidatos são a mesma pessoa, ela escolhe pelo artefato
de digitação.

**Resposta à pergunta do item 8: isto não é problema de `deal_id`. É o problema de
canonicalização de CLIENTE**, e ele é anterior — e maior — que a canonicalização de deal.

**Consequência prática: estes dois casos devem ser excluídos nominalmente da regra automática.**
Vão para `fn_merge_leads`, com o lead antigo como canônico.

## 9. CONTRATO CANÔNICO DE IDENTIDADE — só desenho

Três camadas, hoje colapsadas em uma:

```
FATO COMERCIAL        deal_id            (R29/R30 — pronto)
        ↓
IDENTIDADE DE LEAD    lead_id            (mutável, duplicável — é o problema)
        ↓
IDENTIDADE COMERCIAL  cliente canônico   (NÃO EXISTE hoje)
```

Propriedades exigidas do resolver, todas ausentes hoje:

| propriedade | hoje |
|---|---|
| determinístico | **não** — join não-único |
| auditável (grava a evidência usada) | **não** |
| **fail-closed em conflito** | **não** — sempre escolhe |
| sem `LIMIT 1` arbitrário | **não** |
| preserva a origem da evidência | **não** |

Nenhuma tabela nova é necessária **para o resolver** — ele é uma função. A camada de cliente
canônico é que exigirá estrutura, e não nesta rodada.

## 10. IMPACTO NO ERP FUTURO

A R26 definiu a ponte como `cliente_id (ERP) ↔ lead_id`, "resolvida uma vez e imutável".

**Esta rodada mostra que essa ponte, como desenhada, herdaria o defeito.** Kleberson e Vanessa
têm **dois `lead_id` cada**. Ligar o ERP a um deles significaria: ou o ERP vê 18 compras e perde
2, ou vê 2 e perde 18.

**Implicação: a ponte não deve ser `cliente_id ↔ lead_id`, e sim
`cliente_id ↔ identidade_comercial`, com a identidade agregando um ou mais `lead_id`.** O lead
é um ponto de contato de marketing; o cliente é quem compra. São cardinalidades diferentes —
N leads para 1 cliente — e a R26 assumiu 1 para 1.

Só aponto. Não construo.

## 11. ORDEM SEGURA DE IMPLEMENTAÇÃO

Dependências explícitas:

| ordem | passo | depende de | por quê |
|---|---|---|---|
| **1** | **A. corrigir o resolver de identidade** | — | enquanto existir, novos eventos nascem no cliente errado. **É a torneira** |
| 2 | **B. resolver as 44 colisões** | A | corrigir com o resolver velho recria o erro |
| 3 | **C. adicionar `deal_id`** | B | o índice não pode ser criado com colisões |
| 4 | **D. backfill** | C | — |
| 5 | **E. unique parcial** | D | — |
| 6 | **F. adaptar os dois produtores** | E, A | os dois no mesmo deploy |
| 7 | **H. corrigir paginação** | F | sem chave, duplica |
| 8 | **I. trazer os 118 legítimos** | H | — |
| **fora da fila** | **G. reduzir a trigger heurística** | I + observação | ela ainda protege os 148 eventos sem `deal_id`. **Não remover** |
| **paralelo** | **merge dos 23 leads duplicados** | — | independente; usa `fn_merge_leads` com dry-run |

**A ordem muda em relação à R29: A vem antes de B.** A R29 mandava começar pelas colisões; esta
rodada prova que a causa continua ativa e produzindo.

## 12. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| **O telefone no nome pode estar errado?** | Sim, e está: 3 dos 7 casos têm telefone truncado ou sem nono dígito. Por isso a normalização usa DDD + últimos 8 |
| **Telefone pode pertencer a outra pessoa?** | 2,4% dos deals resolvem para múltiplos leads. Esses viram **AMBIGUO**, não resolvidos |
| **Empresa com telefone compartilhado?** | Risco real (R25). O passo 4 da hierarquia só resolve quando o mapeamento é 1:1 |
| **WhatsApp pode trocar de dono?** | Não observável. Nenhuma fonte tem histórico de telefone |
| **O contato do RD pode ser mais confiável em alguns casos?** | **Sim — nos 5 casos "mesmo nome, telefones diferentes"** (10 leads). Por isso ele fica no passo 4, não é eliminado |
| **`propostas_rd.lead_id` pode carregar erro antigo?** | **Sim, e provavelmente carrega**: foi preenchido por `fn_linkar_propostas_leads`, que é justamente o `UPDATE…FROM` não-determinístico. Por isso o passo 2 exige "não derivado de contato compartilhado" |
| **Um cliente real pode ter múltiplos leads legítimos?** | **Sim** — dois toques de campanhas diferentes. Canonicalizar cliente **não** deve apagar a origem de cada lead; é agregação, não fusão de atribuição |
| **Canonicalizar lead apaga história de campanhas diferentes?** | Se feito por merge cego, sim. É o argumento mais forte a favor de uma camada de cliente **acima** do lead, em vez de fundir leads |
| **As 4 vendas erradas contaminaram aprendizado persistido?** | **Não** — varredura completa: só `pixel_events`, backups e logs. Nenhum objeto de decisão. Mas por acaso: a campanha nunca existiu no Meta |
| **A regra do telefone é segura para os 2 leads duplos?** | **Não, e eu errei na R30.** Ela escolheria o fragmento vazio. Excluídos nominalmente (§8) |
| **`won_` acerta 99,66% — por que não usar só o webhook?** | Porque ele perde os 118 deals que só a paginação alcança. Precisão sem cobertura não resolve |
| **41 vendas em R$ 12.919 é grande?** | **2,0% da receita** — pequeno em dinheiro, e 12 clientes reais com histórico de compra atribuído a outra pessoa. O dano é de confiança, não de caixa |

## 13. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é a torneira, não o balde: **decidir se o produtor `rd_won_` passa a resolver
lead pelo telefone do `deal_nome`, com ABSTER em ambiguidade.**

É uma decisão, não um sistema. E os números que a sustentam são diretos: o produtor que usa
telefone erra **0,17%**; o que usa `lead_identificadores` erra **11,9%**. A regra já existe, já
está em produção no webhook, e já foi validada em 1.203 deals.

Duas coisas que **não** recomendo agora:

- **Corrigir as 41 vendas antes de fechar a torneira.** O resolver continua ativo; corrigir
  agora é limpar o chão com a água correndo.
- **Aplicar a regra do telefone aos dois leads duplos.** Ela moveria vendas de um lead com 4.000
  conversas para um lead com zero. Esses dois pertencem a `fn_merge_leads`, com o lead antigo
  como canônico — e essa fila tem 23 casos, não 2.

E uma verificação que esta rodada abriu: **`propostas_rd.lead_id` foi preenchido pelo mesmo
`UPDATE…FROM` não-determinístico.** Ela é a fonte C da minha própria hierarquia. Antes de
promovê-la a passo 2, vale medir quantas das suas 10.744 atribuições vieram de um
`contact_rdstation_id` compartilhado.
