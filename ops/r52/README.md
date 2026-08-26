# R52 — backfill dos 8 deals da Vanessa

Executado em 2026-08-26. **8 Purchase criados, R$2.801,51, zero efeito
operacional, zero atribuicao fabricada.**

## Veredito

**8_VANESSA_BACKFILL_APLICADOS**

## §1 — RD LIVE: 8/8 reancorados

`GET api.rd.services/crm/v2/deals/<id>` com Bearer, um por deal:

| deal | status | pipeline | `total_price` | esperado | `closed_at` | Purchase pre-existente |
|---|---|:--:|---:|---:|---|:--:|
| `698b4051` | won | ok | 418,31 | 418,31 | 2026-02-10 | 0 |
| `698c879a` | won | ok | 308,51 | 308,51 | 2026-02-11 | 0 |
| `69930e83` | won | ok | 308,51 | 308,51 | 2026-02-16 | 0 |
| `69aeec24` | won | ok | 764,73 | 764,73 | 2026-03-09 | 0 |
| `69b031db` | won | ok | 179,70 | 179,70 | 2026-03-10 | 0 |
| `69b93ac9` | won | ok | 303,60 | 303,60 | 2026-03-17 | 0 |
| `69bae06e` | won | ok | 209,64 | 209,64 | 2026-03-18 | 0 |
| `69c18a38` | won | ok | 308,51 | 308,51 | 2026-03-23 | 0 |

**8/8 HTTP 200 · 8/8 won · 8/8 pipeline `63191f7dd02b2e000cb1805b` ·
8/8 valor = congelado · 8/8 closed_at = esperado · 0 Purchase existentes.**
Lead historico `9abb20c2` existe.

## §2 — Gate critico: APROVADO, e por pouco

| gate | medido | exigido |
|---|---:|---:|
| **`fn_cancelar_disparos_apos_compra`** — `waba_disparos_lista` em `pendente_envio`/`ativo` | **0** | 0 |
| **`fn_trigger_feedback_purchase`** — `crm_tasks` em `pendente`/`em_andamento` | **0** | 0 |

O lead tem 2 disparos (`enviado`, `removido`) e 3 tarefas (todas `descartada`) —
nenhum nos estados que os triggers tocam.

## §3 — Um terceiro trigger que rodadas anteriores nao nomearam

Auditando os 15 triggers de `pixel_events` encontrei
**`trg_fechar_tasks_apos_compra` → `fn_fechar_tasks_apos_compra`**, que a R44 e a
R45 nao registraram. Ele e **mais perigoso** que os dois ja conhecidos:

```sql
-- ramo 1: casa por lead_id OU TELEFONE — alcanca tarefas de OUTROS leads
WHERE status IN ('pendente','em_andamento') AND convertido_em_venda=false
  AND etapa_funil NOT IN ('pos_venda','suporte','producao')
  AND (lead_id = NEW.lead_id OR phone = v_phone)

-- ramo 2: REABRE tarefa ja descartada, ate 7 dias apos a expiracao
WHERE status='descartada' AND resultado_final='sem_resposta'
  AND resultado_registrado_por='automatico_expiracao'
  AND NEW.event_time >  resultado_registrado_at
  AND NEW.event_time <= resultado_registrado_at + INTERVAL '7 days'
```

**As 3 tarefas do lead sao exatamente do tipo reabrivel** — `descartada` /
`sem_resposta` / `automatico_expiracao` / `resgate_vacuo`. O que salvou foi so a
janela temporal:

| tarefa | expirou em | janela de reabertura |
|---|---|---|
| `87adea19` | 2026-07-28 | ate 2026-08-04 |
| `4b87244f` | 2026-07-29 | ate 2026-08-05 |
| `b3d1c892` | 2026-07-30 | ate 2026-08-06 |

Os 8 `event_time` sao de **fevereiro e marco**, anteriores a `resultado_registrado_at`,
entao `NEW.event_time > resultado_registrado_at` e falso. Medido, nao presumido:
ramo direto **0**, ramo de reabertura **0**, tarefas por telefone em outros leads **0**.

**Registro de risco permanente:** um backfill com data mais recente, ou com um
lead cujas tarefas tenham expirado nos 7 dias anteriores, **reabriria tarefas
operacionais**. O casamento por `phone` tambem pode alcancar o fragmento. Gate
obrigatorio para qualquer backfill futuro, junto com os dois ja conhecidos.

### Demais AFTER INSERT

| trigger | efeito nos 8 | classe |
|---|---|---|
| `fn_fechar_decisao_com_conversao` | inerte — exige `event_time > now() - 30 min` | BENIGNO |
| `fn_vera_observar_eventos` | 0 ciclos elegiveis; `vera_retencao_eventos` 177 → 177 | BENIGNO |
| `fn_trg_marcar_refresh` | `lead_score_refresh_queue` **+1**, fila drenada por cron, recalculo idempotente | BENIGNO_IDEMPOTENTE |
| `fn_debug_log_pixel_insert` | `debug_pixel_events_inserts` **+8**, log append-only de auditoria | BENIGNO_IDEMPOTENTE |
| `fn_lab_trigger_purchase` | **desabilitado** (`tgenabled='D'`) | INERTE |
| `fn_cancelar_disparos_apos_compra` | 0 | BENIGNO |
| `fn_trigger_feedback_purchase` | 0 | BENIGNO |
| `fn_fechar_tasks_apos_compra` | 0 (ver acima) | BENIGNO |

**Zero BLOQUEANTE, zero EFEITO_OPERACIONAL.** Os dois efeitos nao-nulos sao
exatamente os ja provados benignos na R44.

## §4 — Idempotencia

`event_id = 'rd_won_' || deal_id`. A v56 faz, antes de decidir:

```js
.in("event_id", dealIds.map(id => `rd_won_${id}`));
if (existingSet.has(eventId)) { ja_existia++; continue; }
```

Verificado apos a escrita: **8/8 encontram `rd_won_<deal_id>`** — a v56
classificara os 8 como `ja_existia` e nao criara segunda representacao.

Protecao dupla: a v56 le so a pagina 1 (100 deals mais recentes por
`closed_at`) e estes fecharam entre 10/02 e 23/03.

O `prevent_pixel_event_duplicate` (BEFORE INSERT, `lead+event_name+value+-10min`)
tambem nao engoliu nenhuma linha: os tres valores repetidos de R$308,51 estao em
11/02, 16/02 e 23/03. `rowcount = 8` era guarda de abort exatamente para isso.

## §5–§8 — Semantica gravada

| campo | valor | origem |
|---|---|---|
| `lead_id` | **`9abb20c2`** nos 8 | provado na R51, nunca telefone atual, nunca `LIMIT 1`, nunca `pessoa_id` |
| `event_time` | `closed_at` da RD | fato comercial, nunca `now()` |
| `value` | `total_price` da RD | 8/8 iguais ao congelado |
| `event_id` | `rd_won_<deal_id>` | idempotencia com a v56 |
| `event_source` | `chat` | igual a v56 |
| `currency` | `BRL` | igual a v56 |
| `campaign_id`/`adset_id`/`ad_id`/`source`/`medium` | **NULL nos 8** | nao existe UTM nesta cadeia (R51 §6) |

**`event_time` anterior ao `created_at` do lead em 8/8** — os deals fecharam
entre 10/02 e 23/03, o lead nasceu em 31/03. Isso e representado como e:
o fato comercial ocorreu antes de o registro local existir. Nenhuma data
artificial foi usada para disfarcar.

## §9 — Candidato = v56, coluna a coluna

```sql
insert into pixel_events (lead_id, event_name, event_time, event_id, event_source, value, currency)
select c.lead_id,'Purchase',c.rd_closed_at,c.event_id_futuro,'chat',c.rd_total_price,'BRL'
from _r52_candidatos c;
```

| coluna | v56 | backfill | diferenca |
|---|---|---|---|
| `lead_id` | resolver por telefone | provado na R51 | **explicada**: a v56 resolveria AMBIGUO nestes 8; a R51 provou o lead por 4 evidencias pre-fragmento |
| `event_name` | `Purchase` | idem | nenhuma |
| `event_time` | `closed_at` | idem | nenhuma |
| `event_id` | `rd_won_${id}` | idem | nenhuma |
| `event_source` | `chat` | idem | nenhuma |
| `value` | `deal.amount ?? deal.total_price` | `total_price` | **nenhuma na pratica** |
| `currency` | `BRL` | idem | nenhuma |

Conferido na RD ao vivo: **o campo `amount` nao existe no payload** (8/8
`data ? 'amount'` = false). O `??` da v56 sempre cai em `total_price`. Nao ha
segundo formato de Purchase.

Campos derivados nao foram escritos. Os triggers derivaram: `state` = `pr` 8/8,
`content_category` = `impressao_dtf_textil` 8/8, `product_type` = `dtf_textil`
8/8. Seguem **desqualificados como evidencia canonica** (politica da R41).

## §10 — Ensaio revertido

Transacao completa executada e abortada por `raise exception` antes do commit:

```
insert 8 · receita +2801.51 · purchase 1591->1599 · canonical 1391->1399
compradores 504->504 · waba 1->1 · tasks 52->52 · ade 15->15
vera 177->177 · agente_log 98328->98328 · fila_refresh +1 · debug_log +8
```

## §11 — Transacao real

Executada em transacao unica, com as mesmas guardas de abort. `INSERT = 8`.

| guarda | resultado |
|---|---|
| revalidacao (won + pipeline + closed_at + valor>0 + lead certo + sem Purchase) | **8** |
| lead historico existe | ok |
| `INSERT` rowcount | **8** |
| campos (lead + value + event_time) | **8** |
| **campanha inventada** | **0** |
| exatamente 1 Purchase por deal | **8** |
| Purchase (delta) | 1591 → **1599** (+8) |
| **receita (delta exata)** | **+2.801,51** |
| canonical deals (delta) | 1391 → **1399** (+8) |
| **`waba_disparos_lista` operacional** | **1 → 1** |
| **`crm_tasks` operacional** | **52 → 52** |
| `ai_decision_evaluations` convertidas | 15 → 15 |
| `vera_retencao_eventos` | 177 → 177 |
| `agente_decisoes_log` | 98328 → 98328 |

A guarda de receita nao usa faixa: exige **exatamente** R$2.801,51.

## §12 — Prova pos-insert: 8/8

8/8 com `event_id = rd_won_<deal_id>`, `lead_id = 9abb20c2`,
`value` = RD, `event_time` = `closed_at`, campanha NULL, **1 Purchase por deal**,
e **8/8 resolvem para `pessoa_id = cbfe9287`** (Vanessa) pela camada da R49.

## §13 — Efeito na identidade

| | antes | depois |
|---|---:|---:|
| lead `9abb20c2` | 16 / R$9.377,95 | **24 / R$12.179,46** |
| lead fragmento `336a959d` | **3 / R$825,59** | **3 / R$825,59** |
| **pessoa Vanessa** | **19 / R$10.203,54** | **27 / R$13.005,05** |

Recalculado ao vivo. **O fragmento nao foi tocado** — mantem suas 3 compras
exclusivas. A pessoa agrega os dois leads na leitura, sem que nada fosse movido.

## §14 — Subcontagem restante, recalculada do zero

| classe | antes | depois | valor |
|---|---:|---:|---:|
| **AMBIGUO (Vanessa)** | **8** | **0** | — |
| SEM_LEAD | 22 | **22** | R$12.702,59 |
| RESOLVE_UNICO (4 em `csv_backfill` + 1 deal 404) | 5 | 5 | R$1.827,70 |
| SEM_TELEFONE no nome | 2 | 2 | R$1.800,00 |

A classe AMBIGUO **desapareceu**. Os 22 SEM_LEAD nao foram tocados.

Globais: Purchase **1599**, receita **R$640.130,28**, canonical deals **1399**,
compradores **504** (inalterado — o lead ja era comprador).

## §15 — Divida semantica registrada, NAO corrigida

`vw_pessoa_identidade` diz `pessoa_t0 = 2026-03-31`, porque so enxerga leads
vivos. A R51 provou que o primeiro registro real desta cliente e
**2025-08-22**, do lead `02ab766d` (Alean Uniformes), apagado pelo merge de
25/05 e sobrevivente apenas em `leads_marketing_bk_normalizacao_20260505`.

**`pessoa_t0` ainda nao e o T0 historico completo.** Nao corrigido nesta rodada.

## §16 — Auto-refutacao

| tentativa de refutar | resultado |
|---|---|
| algum deal deixou de ser won / mudou valor / mudou `closed_at`? | **0** (reconsultado na RD apos o commit) |
| ja existe outra representacao? | **0** deals com 2+ Purchase |
| lead historico errado? | **0** eventos com lead != `9abb20c2` |
| trigger fechou tarefa atual? | **0** tarefas com `automatico_purchase`/`pixel_events_auto` na ultima hora |
| trigger cancelou disparo atual? | `removido` = 1, **pre-existente**, medido antes da escrita |
| campanha inventada? | **0** |
| v56 recriaria duplicata? | **8/8** ja marcam `ja_existia` |
| identidade R49 agrega? | **1** pessoa distinta para os 8 |
| fragmento alterado? | **3 Purchase**, intacto |

Nenhuma refutacao sobreviveu.

### Anomalia investigada e explicada

`leads_marketing` foi de **16029 para 16031** entre o baseline da R49 e agora.
**Nao fui eu.** Sao dois leads inbound organicos que chegaram durante a rodada:
`Sheila` (`5583981710811`, 15:59) e `Janna de Paula Campos` (`5511987432938`,
16:10), ambos `WhatsApp Business`, criados pelo pipeline normal.

E precisamente por isso que as guardas comparam **delta dentro da transacao**, e
nunca zero absoluto medido antes — a base esta viva. Foi esse mesmo erro que
abortou indevidamente a R35 e a R38.

## Nada anterior foi desfeito

R35: **37/37** · R44: **17/17** · R49: **6 vinculos / 3 pessoas**.

## Rollback

`public._r52_candidatos` (8 linhas, PK `deal_id`) com deal, `event_id_futuro`,
lead, `rd_closed_at`, `rd_total_price` e a evidencia RD congelada.

```sql
delete from pixel_events p using public._r52_candidatos c
 where p.event_id = c.event_id_futuro and p.event_name = 'Purchase';
-- esperar rowcount 8
```

Ressalva honesta, igual a da R44: o rollback e exato em `pixel_events`, mas
**nao desfaz** dois residuos benignos — 1 linha em `lead_score_refresh_queue`
(fila drenada por cron, recalculo idempotente) e 8 em
`debug_pixel_events_inserts` (log append-only, que deve mesmo permanecer).

## Proximo passo

Nao ha proximo passo obrigatorio nesta frente: a subcontagem acionavel da
Vanessa chegou a zero.

Em aberto, registrados e nao trabalhados:

- **22 SEM_LEAD**, R$12.702,59 — exigem identidade que hoje nao existe;
- **2 sem telefone no nome**, R$1.800,00 — inclui `Autera Áudio e Vídeo |
  Cleberson`, que a R48 recusou casar com Kleberson;
- **T0 de 2025-08-22** perdido no merge de 25/05 (§15);
- par da Igreja `466,68` / `466,80` e par de R$1.799,79 do Kleberson —
  candidatos a duplicacao no nivel da RD, agora investigaveis com a RD live;
- **`fn_fechar_tasks_apos_compra`** — risco permanente descoberto aqui, hoje
  inofensivo, obrigatorio em qualquer backfill futuro;
- `crm_deals_cache` congelado desde 16/08.
