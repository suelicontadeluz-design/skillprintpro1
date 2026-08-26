# R48 — camada de identidade: Vanessa, Kleberson, Igreja Batista

Rodada READ-ONLY de 2026-08-26. **Nenhuma escrita.** Zero merge, zero delete,
zero update, zero insert, zero backfill, zero deploy.

As simulacoes usaram `fn_merge_leads(..., p_dry_run := true)`, que retorna antes
do bloco `-- EXECUCAO REAL`. Verificado no corpo da funcao, nao presumido.

## Gate de ambiente: a RD ao vivo caiu

Todas as chamadas a `crm.rdstation.com` retornam **HTTP 401 `Permission denied`**
com o token de `token_crm` — `/api/v1/deals/<id>`, `/api/v1/deals`,
`/api/v1/deal_stages`, e 403 nginx em `/api/v2/*`. Reproduzido 3x. Nao e caminho
errado: a mesma URL respondia 200 na R47, ha ~3h.

Nao existe token RD alternativo no banco (varredura de todas as colunas
`%token%`/`%secret%`/`%api_key%`: so `token_crm`).

**Consequencia declarada:** esta rodada NAO reancorou na RD ao vivo. A evidencia
comercial vem de replicas locais, e uma delas e um snapshot ao vivo desta mesma
engenharia: `_r34_rd_deals_live` (1331 deals won, coletado hoje), mais
`crm_deals_cache` e `deal_produtos_rd_obs`. Onde a conclusao dependeria da RD
agora, ela esta marcada **INDETERMINADO**, nao afirmada.

---

## §1 — Verdade da identidade: 3/3 PROVADA, e nao pelo telefone

O telefone era a pista fraca. A prova esta em `lead_identificadores`, que ja
carrega a chave compartilhada:

| caso | canonico | fragmento | chave que prova | veredito |
|---|---|---|---|---|
| Kleberson | `ac931260` | `93c70a4f` | **mesmo `contact_rdstation_id` = `699c8952ffd31d00174adbdc`** | MESMA_IDENTIDADE_PROVADA |
| Igreja | `e218bcbb` | `559c601d` | **mesmo `contact_rdstation_id` = `698f1c4caae4d30013f84425`** | MESMA_IDENTIDADE_PROVADA |
| Vanessa | `9abb20c2` | `336a959d` | **mesmo `contact_botconversa_id` = `824326325`** | MESMA_IDENTIDADE_PROVADA |

`contact_rdstation_id` e a PK do contato na RD. Dois leads apontando para o mesmo
contato nao sao "parecidos": sao o mesmo cadastro de origem, fragmentado aqui.

Vanessa tem **dois** contatos RD distintos, mas o mesmo assinante BotConversa —
e `bc_subscriber_lookup` confirma por um terceiro caminho:
`336a959d / 554195338939 → subscriber_id 824326325`, o mesmo do canonico.

N_MESMA_IDENTIDADE_PROVADA = **3**
N_PROVAVEL = 0 · N_IDENTIDADES_DISTINTAS = 0 · N_INDETERMINADO = 0

### O telefone da Vanessa nunca mudou

`5541995338939` e `554195338939` sao **a mesma linha**: 41 9533-8939 com e sem o
nono digito obrigatorio. A propria chave da v56 (DDD + 8 ultimos) da
`4195338939` para as duas. Nao ha "troca de telefone" entre os dois cadastros da
Vanessa — ha uma variante de formatacao virando cadastro novo.

Os dois formatos existem **dentro dos nomes de deal da RD**, entao a
malformacao nao nasceu aqui.

### O telefone do Kleberson tambem nasceu quebrado na RD

O deal `6a3d88c74dc0900020c5d44c` se chama, na RD, **`Kleberson | 119724914`** —
o truncamento esta no nome do deal, nao so no lead. Ja o canonico:
`Kleberson | 5511972491479`.

### O telefone da Igreja e corrupcao local

Os dois deals da Igreja (`698f1c4d`, `699c9548`) carregam o telefone **correto**
`5511972394278` no nome. O `511972394278` (sem o 5 inicial) do fragmento nao
existe na RD e **nao existe no BotConversa**: `bc_subscriber_lookup` registrou
`status = nao_encontrado`, `erro = http 404`.

---

## §1b — O `lead_merge_log` responde a pergunta da Alean

O evento `rd_won_697913d5445e57001374e0fa` (R$243,66) esta no lead da Vanessa,
mas o deal se chama `Alean Uniformes | 554198207823` — um terceiro telefone.
Parecia atribuicao errada. Nao e:

> `02ab766d` → `9abb20c2`, 2026-05-25 21:00:49, motivo:
> *"Troca de telefone: empresa Aleanuniformes (mesmo CNPJ 72460561000184, mesmo
> email) consolidando do telefone antigo 5541998207823 para o novo 554195338939.
> Causa do loop infinito reportado."*

**Vanessa Büher = Alean Uniformes**, provado por CNPJ e email num merge ja
executado e registrado. O evento esta no lead certo.

E o dado mais importante desse log e o que veio **depois**: o fragmento
`336a959d` foi criado em **2026-06-02**, oito dias apos esse merge, com o mesmo
email `aleanuniformes@outlook.com` e a forma de 12 digitos do mesmo telefone.

**O merge de 25/05 nao resolveu — a fragmentacao voltou em 8 dias.** Merge
fisico, aqui, ja se provou nao ser cura.

`lead_merge_log` tem 159 linhas, todas entre 2026-05-11 e 2026-05-25. Nenhum
merge ha 3 meses.

---

## §2 — Gate de aquisicao: o merge destruiria historia?

| caso | veredito |
|---|---|
| Igreja | **MERGE_DESTRUIRIA_AQUISICAO** |
| Kleberson | **MERGE_DESTRUIRIA_AQUISICAO** |
| Vanessa | MERGE_PRESERVA_AQUISICAO (mas com orfaos, §4) |

Nenhum dos 6 leads tem campanha, adset, ad, source ou medium validos. Se
"aquisicao" fosse so UTM, o gate seria SEM_ORIGEM_RELEVANTE nos tres. Nao e.

### Igreja — o fragmento e mais velho que o canonico

| campo | canonico `e218bcbb` | fragmento `559c601d` |
|---|---|---|
| `created_at` | 2026-03-16 10:25 | **2026-02-24 13:17** |
| `ct` | `''` (vazio) | **embu das artes** |
| `zip_code` | `''` (vazio) | **06818-190** |
| `em` | NULL | luciane.eternityliss@hotmail.com |
| `consentimento` | **false** | **true** |
| `is_organic` | false | true |

O fragmento e o **T0 verdadeiro**, 21 dias antes. Apagar o fragmento move a
primeira aparicao dessa igreja em 3 semanas — e joga fora o unico CEP real, a
unica cidade real e o unico `consentimento = true`.

### Kleberson — cupom de aquisicao exclusivo

O fragmento carrega `lead_coupon = 'SKILLULCDH8'` e
`canal_conversao = 'Formulário Site'`. O canonico nao tem cupom e e
`WhatsApp Business`. **Sao duas aquisicoes distintas da mesma pessoa** — chat e
formulario com cupom. O cupom e evidencia de campanha mesmo sem UTM.

### O que `fn_merge_leads` faz com isso: destroi

Auditoria do corpo vivo (§3) contra os dados reais:

| caso | campo | fica | perde | por que |
|---|---|---|---|---|
| Igreja | `ct` | `''` | `embu das artes` | **COALESCE trata `''` como valor** |
| Igreja | `zip_code` | `''` | `06818-190` | **mesmo bug** |
| Igreja | `created_at` | 2026-03-16 | 2026-02-24 | campo **nao esta** na lista de merge |
| Igreja | `consentimento` | false | true | campo **nao esta** na lista |
| Kleberson | `lead_coupon` | NULL | `SKILLULCDH8` | campo **nao esta** na lista |
| Kleberson | `canal_conversao` | WhatsApp | Formulário Site | campo **nao esta** na lista |
| Kleberson | `fbp` | canonico | `fb.2.1775820300882…` | COALESCE |
| todos | `external_id` | canonico | o do fragmento | campo **nao esta** na lista |

**Dois defeitos distintos, os dois fatais para estes casos:**

1. **`COALESCE(canonico, fragmento)` nao distingue `''` de NULL.** O canonico da
   Igreja tem `ct=''`, `zip_code=''`, `utm_*=''`, `fbc=''`, `client_ip_address=''`.
   Todos vencem o COALESCE. O CEP real e a cidade real do fragmento **nao entram**.
   Perda silenciosa: nem erro, nem log.
2. **`created_at`, `canal_conversao`, `is_organic`, `segmento`, `product_type`,
   `lead_coupon`, `external_id`, `consentimento` e `indicado_por` nao aparecem em
   lugar nenhum do merge.** O canonico simplesmente mantem os seus.

Traduzido: na Igreja, o merge apagaria o fragmento e ficaria **so com o `em`**.
Todo o resto da contribuicao exclusiva dele evapora. Isso e exatamente
*"apagar historia de aquisicao para deixar o cadastro bonito"*.

---

## §3 — Auditoria do `fn_merge_leads(uuid,uuid,boolean,text)` vivo

Existe tambem `fn_merge_lead` (singular, 2448 bytes). O usado seria o plural
(14590 bytes). Ordem real: limpa `ph`/`em` do duplicado (libera UNIQUE) → funde
campos por COALESCE → move 41 tabelas → grava `lead_merge_log` → `DELETE` do lead.

### Tabelas que a funcao NAO conhece

A funcao move 41 tabelas. O banco tem **126 tabelas base com `lead_id`**. As que
tem linha nos nossos fragmentos e ficariam **apontando para um lead deletado**:

| caso | tabela fora do merge | linhas orfas |
|---|---|---:|
| Vanessa | `bc_subscriber_lookup` | 1 |
| Vanessa | `debug_pixel_events_inserts` | 3 |
| Vanessa | `taxonomia_snapshot_leads` | 1 |
| Vanessa | `lead_score_refresh_queue` | 1 |
| Kleberson | `debug_pixel_events_inserts` | 6 |
| Kleberson | `taxonomia_snapshot_leads` | 1 |
| Igreja | `bc_subscriber_lookup` | 1 |
| Igreja | `taxonomia_snapshot_leads` | 1 |

**15 linhas orfas.** Nenhuma delas tem FK, entao nao quebra — fica pendurada.

O `dry_run` **nao mostra nenhuma dessas**: ele so conta as 41 que a funcao ja
sabe mover. O raio real e maior que o raio reportado.

### Perda por regra, nao por esquecimento

`lead_score_comercial` e `agente_exploracao_estado`, `resumos_conversa_lead`,
`perfil_comportamental_lead`: quando **ambos** os leads tem linha, a funcao
**DELETA a do duplicado**. Kleberson cai nesse caso (B1 tem 1, B2 tem 1): o
score comercial do fragmento e descartado, nao fundido.

### Mina terrestre latente

`marketing_touches` e `marketing_touch_lead_resolution` tem FK
**ON DELETE RESTRICT** e **nao estao** na lista de UPDATE. Se o duplicado tiver
uma linha ali, o `DELETE` final aborta a transacao inteira. Nos nossos 3 casos
sao 0 linhas — nao bloqueia hoje, mas bloquearia outro merge sem aviso.

`pixel_events` tem FK **ON DELETE CASCADE**. Esta na lista e e movida antes, mas
qualquer caminho de merge que erre a ordem apaga vendas em silencio.

---

## §4 — Simulacao dos 3 merges (dry-run real)

| caso | canonico | fragmento | tabelas que a funcao moveria |
|---|---|---|---|
| Vanessa | `9abb20c2` ph `5541995338939` | `336a959d` ph `554195338939` | pixel_events 3, propostas_rd 4, capi_eventos_log 117, pixel_crm_sync_map 1, zapi_webhook_inbox 158, lead_identificadores 1 |
| Kleberson | `ac931260` ph `5511972491479` | `93c70a4f` ph `119724914` | arte_uploads 3, pixel_events 5, capi_eventos_log 3, lead_identificadores 1, lead_score_comercial 1, anthropic_token_usage 1 |
| Igreja | `e218bcbb` ph `5511972394278` | `559c601d` ph `511972394278` | bc_sync_log 1, pixel_crm_sync_map 2, lead_identificadores 1 |

Somar as 15 orfas do §3, que o dry-run omite.

**O fragmento da Vanessa nao e casca.** 3 Purchase, 4 propostas, 117 eventos CAPI
e 158 mensagens de WhatsApp. Chamar isso de "duplicata a limpar" seria apagar
operacao real.

---

## §5 — Alternativa sem merge: a camada logica ja existe no banco

A chave que prova a identidade (§1) **ja esta persistida**. Nao e preciso
deletar lead nenhum para saber quem e quem:

```sql
-- pessoa = leads que compartilham contato de origem
select coalesce('rd:'||li.contact_rdstation_id,
                'bc:'||li.contact_botconversa_id::text,
                'lead:'||li.lead_id::text) as pessoa_id,
       li.lead_id
  from lead_identificadores li;
```

Isso resolve os 3 casos sem escrever uma linha de historia a menos, e sem
depender do telefone — que e justamente o campo corrompido nos tres.

`vw_venda_identidade` **nao** cobre isso: ela resolve identidade **da venda**
(qual produtor, qual deal), nao **da pessoa**. Nao ha view de pessoa hoje.

### E nao sao 3 casos isolados

| chave | grupos com 2+ leads | leads envolvidos |
|---|---:|---:|
| mesmo `contact_rdstation_id` | **37** | 82 |
| mesmo `contact_botconversa_id` | **38** | 76 |
| mesma chave v56 (DDD+8) | **55** | 110 |

Base: 16.029 leads, 504 compradores. Uma frente de merge caso a caso teria ~55
casos pela frente; uma camada logica cobre todos de uma vez e nao apaga nada.

---

## §6 — Historia exclusiva do fragmento da Igreja

Depois da R46 o fragmento ficou com **0 Purchase**. O que ele ainda tem de
exclusivo:

| item | valor |
|---|---|
| `created_at` | **2026-02-24** — 21 dias antes do canonico |
| `zip_code` | **06818-190** (canonico: `''`) |
| `ct` | **embu das artes** (canonico: `''`) |
| `em` | luciane.eternityliss@hotmail.com (canonico: NULL) |
| `consentimento` | **true** (canonico: false) |
| `external_id` | `75b784dc-…` |
| `pixel_crm_sync_map` | **2 linhas** — deals `698f1c4d` e `699c9548` |
| `bc_sync_log` | 1 |
| `bc_subscriber_lookup` | 1, `nao_encontrado` / http 404 |
| conversas, propostas, tarefas, arquivos | **0** |

Os dois deals do mapa **ja estao representados no canonico** (`rd_won_698f1c4d`
R$466,68 e `rd_won_699c9548` R$466,80). O fragmento so guarda os ponteiros
antigos — `pixel_crm_sync_map` e ledger de idempotencia por `deal_id`, e seu
`lead_id` e recibo, nao GPS (R39).

**Nada de operacional se perde deletando o fragmento. O que se perde e cadastral
e temporal — e e justamente o que o `fn_merge_leads` nao preserva.**

---

## §7 — Gate Kleberson: o Purchase que sobrou

**Qual deal:** `won_6a3d88c74dc0900020c5d44c`, R$1.800,00, `event_time`
2026-07-20 13:57:03.

**Mesma pessoa?** Sim, provado: mesmo `contact_rdstation_id` do canonico, e o
proprio nome do deal na RD e `Kleberson | 119724914`.

**Mas o repontamento esta BLOQUEADO por outra pergunta.** O canonico ja tem
`won_6a3d88c9db321b001d6bff57`, **tambem R$1.800,00**:

| | canonico | fragmento |
|---|---|---|
| deal_id | `6a3d88c9db321b001d6bff57` | `6a3d88c74dc0900020c5d44c` |
| criacao do deal (ObjectId) | 2026-06-30 | 2026-06-30, **~2s depois** |
| `closed_at` | 2026-06-30 14:32 | **2026-07-20 13:56** |
| `total_price` | 1799.79 | 1799.79 |
| linha de produto | `6972584f…` · 51,0 × R$35,29 | `6972584f…` · 51,0 × R$35,29 |
| `rd_created_at` do produto | **2026-06-30 17:16** | **2026-07-20 17:23** |

Dois deals nascidos com 2 segundos de diferenca, com produto identico, fechados
com 20 dias de distancia.

A leitura que a evidencia sustenta: **a linha de produto do segundo foi criada
em 20/07, nao em 30/06.** Um clone teria nascido com o produto junto. Isso
aponta para **pedido repetido real** — 51 unidades do mesmo item, cliente de
`revenda_dtf`. Mas os 2 segundos entre as criacoes apontam para duplicacao.

**Veredito: INDETERMINADO.** Nao repontar. Resolver isso e cirurgia de
duplicacao de deal na RD, nao de identidade — e exige a RD ao vivo, que hoje
esta 401.

Registro: o canonico tem o mesmo padrao em `won_6a0b71b8…` e `won_6a15e574…`,
**ambos R$1.830,90**, 18/05 e 26/05. Mesma classe de duvida, fora de escopo.

---

## §8 — Vanessa: reconstrucao

Nao houve troca de telefone entre os dois cadastros. Houve:

1. **2026-01/03** — deals fechados no nome `Vanessa Büher | 554195338939`
   (forma de 8 digitos). Lead `02ab766d` = *Alean Uniformes*, ph `5541998207823`.
2. **2026-03-31** — nasce `9abb20c2`, ph `5541995338939` (forma de 9 digitos),
   com `fbc` de clique pago real (`PAZXh0bgNhZW0…`).
3. **2026-05-25** — merge documentado: `02ab766d` → `9abb20c2`, por CNPJ e email.
4. **2026-06-02** — **oito dias depois**, nasce `336a959d`, ph `554195338939`,
   email `aleanuniformes@outlook.com`. A fragmentacao voltou.
5. **2026-06-02 15:05** — o mapa ja grava uma linha para o lead novo.

O fragmento acumulou 3 Purchase, dos quais **2 sao vendas exclusivas dele**:

| event_id | data | valor | deal na RD |
|---|---|---:|---|
| `203a53bd…` (uuid) | 2026-05-08 | 310,15 | `69f3ac56` — **duplicata** do `rd_won_` no canonico |
| `won_6a296a5f78b740001ecb44ee` | 2026-06-12 | 275,25 | `Vanessa Büher \| 554195338939` |
| `won_6a4d53bc27d4e1002477e0a8` | 2026-07-15 | 240,19 | `Vanessa Büher \| 554195338939` |

**R$515,44 de venda real vive so no fragmento.** Deletar o lead sem mover isso
apagaria duas vendas. O unico grupo de duplicacao restante das R37–R47
(`69f3ac56`) esta aqui dentro — e nao se resolve por consolidacao de linha, so
depois da identidade.

Observacao contraditoria registrada: o canonico tem `fbc` de clique pago **e**
`is_organic = true`. Um dos dois esta errado. Nao investigado nesta rodada.

---

## §9 — Quanto isso desbloqueia dos deals ainda sem representacao

Populacao reconstruida do zero: 329 orfaos do mapa → **37 deals sem
representacao, R$19.131,80**. Reproduz exatamente o numero da R44.

### Reconciliacao com o "24 SEM_LEAD + 8 AMBIGUO" do enunciado

Rodando a regra da v56 **hoje**, ao vivo:

| classe | deals | valor |
|---|---:|---:|
| SEM_LEAD | **22** | 12.702,59 |
| AMBIGUO | **8** | 2.801,51 |
| RESOLVE_UNICO | 5 | 1.827,70 |
| sem telefone no nome | 2 | 1.800,00 |

Sao **22**, nao 24. Os 5 `RESOLVE_UNICO` sao os que a R43 ja tinha classificado
a parte: 4 com Purchase `csv_backfill_*` equivalente e 1 que a RD respondeu 404
(`69b19ad9`, R$1.330,80 — e o unico com `na_rd_live = false`). Nao sao deals
novos.

### E a resposta:

| resolver | deals desbloqueados | valor |
|---|---:|---:|
| **A. Vanessa** | **8** | **R$2.801,51** |
| B. Kleberson | **0** | — |
| C. Igreja | **0** | — |

**Os 8 AMBIGUO sao, todos os 8, Vanessa Büher.** A classe AMBIGUO inteira e um
unico caso de identidade:

| deal | nome na RD | valor |
|---|---|---:|
| `69aeec24` | Vanessa Büher \| 554195338939 | 764,73 |
| `698b4051` | Vanessa Büher \| 554195338939 | 418,31 |
| `698c879a` | Vanessa Büher \| 554195338939 | 308,51 |
| `69c18a38` | Vanessa \| 554195338939 | 308,51 |
| `69930e83` | Vanessa Büher \| 554195338939 | 308,51 |
| `69b93ac9` | Vanessa Buher \| 554195338939 | 303,60 |
| `69bae06e` | Vanessa \| 554195338939 | 209,64 |
| `69b031db` | Vanessa Buher \| 554195338939 | 179,70 |

Sao AMBIGUO **so porque existem dois leads Vanessa**. Um unico ato de identidade
zera a classe inteira.

### Refutacao de uma hipotese minha

Levantei que o merge de 25/05 tivesse orfanado esses 8 ao deletar `02ab766d`.
**Falso.** 7 das 8 linhas de mapa **ja apontam para `9abb20c2`, que existe** — a
funcao repontou o mapa corretamente. So `698b4051` (R$418,31) tem `lead_id`
NULL. O merge nao e a causa; o mecanismo de sumico dos UUID continua o mesmo nao
provado da R40.

Ressalva honesta: esse `9abb20c2` no mapa e **compativel** com o merge de 25/05
(a funcao faz `UPDATE pixel_crm_sync_map SET lead_id = canonico`), mas nao provei
que foi ele quem escreveu. O `right(ph,11) = right(telefone,11)` do
`fn_sync_crm_pixel_insert` original nao casa com nenhum dos dois leads.

### A armadilha que recusei

Um dos 2 "sem telefone no nome" e **`Autera Áudio e Vídeo | Cleberson`,
R$1.780,00**. `Cleberson` ≈ `Kleberson`. Uma camada de identidade por nome
casaria os dois. **Nao casei.** Nenhuma chave compartilhada, telefone nenhum,
empresa diferente. Corrigir um fato verdadeiro criando outro inventado seria
exatamente isso.

O outro e `Dudalippe Personaliados | 123458`, R$20,00 — `123458` nao e telefone.

---

## §10 — Contrato minimo de identidade

O que a evidencia sustenta:

1. **`pessoa_id` e derivado, nao escrito.** Chave, em ordem:
   `contact_rdstation_id` → `contact_botconversa_id` → `lead_id`. Os tres casos
   fecham nessa ordem.
2. **Telefone nunca e chave primaria de identidade.** Nos tres casos ele e o
   campo corrompido: truncado (Kleberson), sem o 5 (Igreja), sem o nono digito
   (Vanessa).
3. **Nome nunca e chave.** Ver `Cleberson` no §9.
4. **`lead` e evento de aquisicao, nao registro de cliente.** Dois leads da mesma
   pessoa sao duas aquisicoes — a da Igreja (chat 24/02 e chat 16/03) e a do
   Kleberson (chat e formulario com cupom) sao historias distintas e verdadeiras.
5. **T0 da pessoa = `min(created_at)` do grupo**, nao o `created_at` do
   sobrevivente. Na Igreja isso e a diferenca entre 24/02 e 16/03.

---

## §11 — Contrato com o ERP

1. O ERP consome **`pessoa_id` derivado**, nunca `lead_id` cru.
2. Um `pessoa_id` agrega N leads; cada venda continua ancorada em
   `canonical_deal_id`, que ja e a chave que nao duplica (R36–R47).
3. `leads_marketing.ph` **nao** e chave de cliente no ERP.
4. Se o ERP exigir 1 linha por cliente, isso e projecao de leitura — nao
   autoriza `DELETE` em `leads_marketing`.
5. Sem `pessoa_id`, o ERP herda 37 grupos RD + 38 BotConversa + 55 por telefone.

---

## §12 — Auto-refutacao

- *E a mesma pessoa mesmo, ou dois clientes parecidos?* Kleberson e Igreja
  compartilham a **PK do contato na RD**; Vanessa compartilha o assinante
  BotConversa e tem merge por CNPJ registrado. Nao e semelhanca de nome.
- *E o telefone da Vanessa mudou de verdade?* Nao. `4195338939` e a chave dos
  dois. E o nono digito.
- *O fragmento e casca vazia?* Nao, em 2 dos 3. Vanessa: **R$515,44 de venda so
  dele**. Igreja: o **T0 verdadeiro** e o unico CEP real.
- *Entao merge resolve?* Nao. O merge de 25/05 na Vanessa foi refeito pela
  realidade em **8 dias**, e o `fn_merge_leads` atual perderia CEP, cidade,
  `created_at`, `consentimento` e cupom — e deixaria 15 linhas orfas.
- *O `dry_run` mede o estrago?* Nao. Ele so conta as 41 tabelas que a funcao ja
  conhece. Faltam 4 tabelas com linha nos nossos fragmentos.
- *Repontar o Purchase do Kleberson resolve sem merge?* Talvez, mas nao provado:
  o canonico ja tem outro deal de R$1.799,79 e nao sei dizer se sao um pedido ou
  dois. INDETERMINADO.
- *Os 8 AMBIGUO sao mesmo da Vanessa?* Sim, 8/8 pelo nome do deal na RD e pela
  chave de telefone. Nenhum e do Kleberson ou da Igreja.
- *Resolver identidade cria venda?* Nao. Os 8 continuam ausentes ate um backfill
  proprio, que **nao** faz parte desta rodada.
- *A RD ao vivo mudaria alguma conclusao?* Do §1 ao §9 nao — sao chaves locais e
  snapshot ja coletado. Mudaria o §7, que por isso ficou INDETERMINADO.

---

## §13 — Vereditos

| item | veredito |
|---|---|
| Identidade Vanessa | **MESMA_IDENTIDADE_PROVADA** (botconversa 824326325 + merge por CNPJ) |
| Identidade Kleberson | **MESMA_IDENTIDADE_PROVADA** (contact_rdstation_id) |
| Identidade Igreja | **MESMA_IDENTIDADE_PROVADA** (contact_rdstation_id) |
| Aquisicao — Vanessa | MERGE_PRESERVA_AQUISICAO, com 6 orfas |
| Aquisicao — Kleberson | **MERGE_DESTRUIRIA_AQUISICAO** (cupom + canal) |
| Aquisicao — Igreja | **MERGE_DESTRUIRIA_AQUISICAO** (T0 + CEP + cidade + consentimento) |
| `fn_merge_leads` | **NAO_SEGURO_COMO_ESTA** — bug do `''`, 9 campos ausentes, 4 tabelas ausentes, RESTRICT latente |
| Purchase orfao do Kleberson | **INDETERMINADO** — nao repontar |
| Desbloqueio pela Vanessa | **8 deals, R$2.801,51** (100% da classe AMBIGUO) |
| Desbloqueio por Kleberson/Igreja | **0** |
| RD ao vivo | **INDISPONIVEL** (401 em todos os caminhos) |

---

## §14 — Proximo passo recomendado

**Nao e merge.** E camada logica de leitura, que:

- resolve os 3 casos sem apagar linha nenhuma;
- nao depende do telefone, que e o campo quebrado nos tres;
- cobre os outros ~52 grupos de graca;
- e reversivel (`DROP VIEW`), ao contrario de `DELETE FROM leads_marketing`;
- ja tem toda a evidencia persistida — nada a inventar.

Ordem sugerida, uma rodada por vez e cada uma com seus gates:

1. **R49 (read-only)** — desenhar `vw_pessoa_identidade`, medir os ~55 grupos,
   provar que nao colide com `vw_venda_identidade` nem com o MAPA/GPS.
2. **R50** — se e so quando `fn_merge_leads` for corrigido (`nullif(x,'')`, os 9
   campos, as 4 tabelas, `min(created_at)`), reavaliar merge fisico. Antes disso,
   nao.
3. **R51** — backfill dos 8 deals da Vanessa, **depois** da identidade, com os
   mesmos gates da R44, incluindo o gate obrigatorio de
   `fn_cancelar_disparos_apos_compra` / `fn_trigger_feedback_purchase`.

Fora de escopo, registrados e nao tocados:

- **Igreja `698f1c4d` R$466,68 vs `699c9548` R$466,80** — mesmo produto, mesma
  quantidade (12), preco de R$38,89 vs R$38,90, criados com 10 dias de
  diferenca, **fechados com 19 minutos de diferenca**. Candidato forte a
  duplicacao no nivel da RD. Ambos ja representados no canonico. Nao e
  duplicacao de `canonical_deal_id`, entao nunca entrou nos 47 grupos.
- **Kleberson `won_6a0b71b8` e `won_6a15e574`**, ambos R$1.830,90.
- **Vanessa canonico com `fbc` de clique pago e `is_organic = true`.**
- Os 22 SEM_LEAD (R$12.702,59) e os 329 orfaos do mapa seguem intocados.
