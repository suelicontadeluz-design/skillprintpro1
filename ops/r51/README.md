# R51 — qual `lead_id` historico representa os 8 deals da Vanessa

Rodada READ-ONLY de 2026-08-26. **Zero INSERT, zero UPDATE, zero DELETE, zero
backfill.**

## Veredito

**LEAD_HISTORICO_DOS_8_RESOLVIDO**

| classe | n | valor |
|---|---:|---:|
| **USAR_LEAD_9ABB20C2** | **8** | **R$2.801,51** |
| USAR_FRAGMENTO | 0 | — |
| OUTRO_LEAD | 0 | — |
| ABSTER | 0 | — |

A premissa que abriu esta rodada — *"o nome atual dos 8 deals contem
`554195338939`, associado hoje ao fragmento"* — **e verdadeira e irrelevante**.
O nome atual do deal nao e o nome que ele tinha quando fechou.

## §1 — Semantica fixada

- **`pessoa_id`** — identidade comercial permanente. Responde *"quem e o
  cliente?"*. Agrega. Nunca e gravado em `pixel_events`.
- **`lead_id`** — registro historico. Responde *"qual registro carregava esse
  fato?"*. E a coluna real de `pixel_events`.

Nenhum lead foi escolhido por ser "o canonico de hoje". A escolha e por
**evidencia contemporanea ao fato**.

## §2 — Timeline dos leads: existiam TRES, nao dois

O achado que reordena tudo esta em `leads_marketing_bk_normalizacao_20260505`,
snapshot de **2026-05-05**, anterior ao merge de 25/05:

| lead | ph em 05/05 | ph hoje | created_at | canal | UTM |
|---|---|---|---|---|---|
| `02ab766d` *(Alean, deletado)* | `554198207823` | — | **2025-08-22** | Formulário Site | nenhuma |
| `9abb20c2` | **`554195338939`** | `5541995338939` | 2026-03-31 | WhatsApp Business | nenhuma |
| `336a959d` *(fragmento)* | **nao existia** | `554195338939` | 2026-06-02 | — | nenhuma |

Duas coisas mudam o caso:

**1. Em 2026-05-05 o lead `9abb20c2` tinha `ph = 554195338939`** — exatamente a
forma de 12 digitos que hoje se atribui ao fragmento. O canonico foi
**normalizado depois** para `5541995338939`. O fragmento, criado em 02/06,
**herdou o telefone que o canonico largou**.

Ou seja: `554195338939` nao e "o telefone do fragmento". E o telefone que
**`9abb20c2` usava na epoca dos deals**.

**2. O T0 real deste cliente e 2025-08-22**, do lead Alean, sete meses antes do
canonico. Esse lead foi deletado pelo merge de 25/05.

### Linha do tempo consolidada

```
2025-08-22  nasce 02ab766d (Alean Uniformes, 554198207823)   <- T0 REAL
2026-02-10  fecha o 1o dos 8 deals
   ...      fecham os 8 (10/02 a 23/03)
2026-03-31  nasce 9abb20c2 com ph 554195338939
2026-04-09  pixel_crm_sync_map gravado (7 dos 8 -> 9abb20c2)
2026-04-13  propostas_rd gravadas (7 dos 8 -> 9abb20c2)
2026-05-05  SNAPSHOT: 9abb20c2 ainda com 554195338939
2026-05-25 17:33-17:35  SEIS dos 8 deals RENOMEADOS na RD
2026-05-25 21:00  merge 02ab766d -> 9abb20c2 (mesmo CNPJ, mesmo email)
2026-06-02  nasce 336a959d, o fragmento, com ph 554195338939
```

**Quando os 8 deals fecharam, nenhum dos dois leads de hoje existia.** O lead
vivo era o Alean. `9abb20c2` e o **sucessor legal** dele por merge documentado.

## §3 — Timeline dos 8 deals

| deal | criado RD | fechado | `updated_at` RD | tel no cache (pre-25/05) | mapa 09/04 | proposta 13/04 |
|---|---|---|---|---|---|---|
| `698b4051` | 2026-02-10 | 2026-02-10 | **2026-05-25 17:35:47** | **`554187139689`** | **NULL** | `9abb20c2` |
| `698c879a` | 2026-02-11 | 2026-02-11 | **2026-05-25 17:35:37** | `554195338939` | `9abb20c2` | `9abb20c2` |
| `69930e83` | 2026-02-16 | 2026-02-16 | **2026-05-25 17:35:25** | `554195338939` | `9abb20c2` | `9abb20c2` |
| `69aeec24` | 2026-03-09 | 2026-03-09 | **2026-05-25 17:34:53** | `554195338939` | `9abb20c2` | — |
| `69b031db` | 2026-03-10 | 2026-03-10 | **2026-05-25 17:33:34** | `554195338939` | `9abb20c2` | `9abb20c2` |
| `69b93ac9` | 2026-03-17 | 2026-03-17 | **2026-05-25 17:33:28** | `554195338939` | `9abb20c2` | `9abb20c2` |
| `69bae06e` | 2026-03-18 | 2026-03-18 | 2026-05-08 | `554195338939` | `9abb20c2` | `9abb20c2` |
| `69c18a38` | 2026-03-23 | 2026-03-23 | 2026-05-08 | `554195338939` | `9abb20c2` | `9abb20c2` |

**O fragmento nasceu em 02/06.** Nao existia quando os deals fecharam
(fev-mar), nem quando o mapa foi escrito (09/04), nem quando as propostas foram
gravadas (13/04), nem quando os deals foram renomeados (25/05).

**Nenhuma evidencia contemporanea pode apontar para ele. E nenhuma aponta.**

### Seis dos 8 deals foram reescritos na RD em 25/05

Entre **17:33 e 17:35 de 25/05**, numa rajada de dois minutos, seis deals tiveram
o nome alterado na RD — **25 minutos antes** do merge das 18:00 (BRT). O nome que
os 8 exibem hoje e resultado dessa limpeza, nao do fechamento.

Por isso a regra *"telefone do deal vence"* seria dupla­mente errada aqui:
venceria com um dado reescrito **e** apontaria para um lead que ainda nao
existia.

## §4 — Prova do mapa: EVIDENCIA_HISTORICA_FORTE

A duvida aberta desde a R48 era: o `9abb20c2` no mapa foi escrito em 09/04, ou
foi **repontado** pelo merge de 25/05 (que faz
`UPDATE pixel_crm_sync_map SET lead_id = canonico`)?

Resolvida reproduzindo a regra do produtor original,
`fn_sync_crm_pixel_insert`:

```sql
JOIN leads_marketing lm ON right(lm.ph,11) = right(d.telefone,11)
```

contra o snapshot de **05/05**:

| deal | `right(telefone,11)` | casa com quem em 05/05 | conclusao |
|---|---|---|---|
| os 7 | `54195338939` | **`9abb20c2` (`554195338939`)** | **escrito na origem** |
| `697913d5` *(Alean, fora dos 8)* | `54198207823` | `02ab766d` (`554198207823`) | **repontado pelo merge** |

O mapa contem os dois tipos, e eles se distinguem. Nos 7, o `lead_id` do mapa
**bate com a regra do produtor original** usando o telefone que o lead tinha
naquela data. Nao ha necessidade de invocar o merge para explica-lo.

Confirmado tambem que o match era unico: no snapshot de 05/05, exatamente **um**
lead satisfazia `right(ph,11) = '54195338939'`.

**Mapa criado em 09/04 + fragmento inexistente ate 02/06 = o telefone atual do
deal nao pode reescrever retroativamente o lead historico.**

## §5 — O oitavo deal: `698b4051`, R$418,31 — **LEAD_HISTORICO_PROVADO**

Este era o unico sem evidencia de mapa (`lead_id` NULL). E o mais interessante.

**Por que o mapa falhou:** no fechamento o deal se chamava
**`Vanessa Buher | 554187139689`** — nome certo, **telefone diferente**. A regra
`right(ph,11)` nao achou lead nenhum para `54187139689`. O NULL e coerente, nao
corrupcao.

**O que `554187139689` e:** uma linha real, mas nao a da Vanessa.

| linha | mensagens em `zapi_webhook_inbox` |
|---|---:|
| `…95338939` (Vanessa) | **1592** |
| `…87139689` | **2** |

As duas sao de **20/04**, dois meses **apos** o fechamento, e ambas de saida da
Skillprint ("*Tamires da Conceição: Vamos confirmar o seu pedido: 2,5 mt*").
Nao existe lead com esse telefone — nem hoje, nem no snapshot de 05/05.

**A prova veio de outro lugar — `propostas_rd`, gravada em 2026-04-13:**

```
deal_id  698b40511eeb9b0013d4e07a
deal_nome            "Vanessa Buher | 554187139689"
lead_id               9abb20c2
contact_rdstation_id  698338910b423c0013886deb
```

Esse `contact_rdstation_id` e **exatamente** o de
`lead_identificadores` do lead `9abb20c2`. O do fragmento e
`69cbd1631e738d001e397ee5`, e **nao aparece em nenhuma das 8 propostas**.

Ou seja: em 13/04 — **seis semanas antes da renomeacao e sete antes de o
fragmento existir** — a propria RD ja associava este deal ao contato da Vanessa
canonica, mesmo com o telefone divergente no titulo.

**Classificacao: LEAD_HISTORICO_PROVADO.** Nao foi preciso forcar, e nao foi
preciso abster.

## §6 — Aquisicao: nenhum risco, nos dois sentidos

**Escolher `9abb20c2` nao atribui campanha indevida:**

| fonte | campanha / source / medium |
|---|---|
| `9abb20c2` hoje | nenhuma |
| `9abb20c2` no snapshot de 05/05 | nenhuma (`'' / '' / ''`) |
| fragmento `336a959d` | nenhuma |
| `02ab766d` (Alean) em 05/05 | nenhuma |
| `propostas_rd` dos 8 (`utm_campaign/source/medium`) | **8/8 vazias** |

Nao existe UTM em lugar nenhum desta cadeia. Risco de transformar recompra em
aquisicao paga: **zero**, provado, nao presumido.

**Escolher o fragmento criaria um T0 artificial posterior:** o fragmento nasceu
em **02/06**, entre 71 e 112 dias **depois** de cada um dos 8 fechamentos.
Ancorar la faria vendas de fevereiro pertencerem a um registro de junho.

Ancorar em `9abb20c2` (31/03) tambem e posterior aos 8 fechamentos — e isso deve
ser dito com todas as letras: **o `event_time` do Purchase sera anterior ao
`created_at` do lead que o carrega.** Isso ja ocorre na base (a Igreja tem o
mesmo padrao) e e honesto: representa que o registro do lead foi criado depois
do fato comercial. O que **nao** e aceitavel e inventar um lead novo para
disfarcar isso.

### Registro obrigatorio: o T0 verdadeiro ja foi destruido

`identidade_comercial` diz `pessoa_t0 = 2026-03-31`, porque so consegue ver
leads vivos. O primeiro registro real desta cliente e **2025-08-22**, do lead
Alean, apagado pelo merge de 25/05.

**Sete meses de T0 foram perdidos por um merge fisico** — exatamente o dano que
a R48 previu e que a R49 se recusou a repetir. O dado sobrevive apenas em
`leads_marketing_bk_normalizacao_20260505`. Nao corrigido aqui: e outra rodada.

## §7 — `pessoa_id` na leitura: nao e preciso concentrar num lead

Simulacao, sem escrever nada:

| metrica | hoje | com os 8 em `9abb20c2` |
|---|---:|---:|
| compras do lead `9abb20c2` | 16 | 24 |
| compras do lead `336a959d` | **3** | **3** |
| **compras da pessoa Vanessa** | **19** | **27** |
| **LTV da pessoa** | R$10.203,54 | **R$13.005,05** |

O fragmento **mantem suas 3 compras exclusivas** e a pessoa continua sendo uma
so cliente. `lead_id → pessoa_id` faz a agregacao na leitura.

**Prova do principio:** nao e preciso gravar os 8 no mesmo lead para a Vanessa
ser um unico cliente — e nao e preciso mover os 3 Purchase do fragmento. A
identidade comercial **agrega**, nao reescreve.

Confirmado tambem: **0 Purchase ja existem** para qualquer um dos 8.

## §8 — Regra final

| deal | valor | decisao | evidencias independentes e pre-fragmento |
|---|---:|---|---|
| `69aeec24` | 764,73 | **USAR_LEAD_9ABB20C2** | mapa 09/04 + telefone do deal em 05/05 |
| `698b4051` | 418,31 | **USAR_LEAD_9ABB20C2** | proposta 13/04 + `contact_rdstation_id` da canonica |
| `698c879a` | 308,51 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta + contato |
| `69c18a38` | 308,51 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta |
| `69930e83` | 308,51 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta + contato |
| `69b93ac9` | 303,60 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta + contato |
| `69bae06e` | 209,64 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta + contato |
| `69b031db` | 179,70 | **USAR_LEAD_9ABB20C2** | mapa + telefone + proposta + contato |

**8/8 com no minimo duas evidencias independentes, todas anteriores ao
nascimento do fragmento.** Nenhuma decisao apoiada em "telefone do deal vence" —
essa regra foi explicitamente **rejeitada**, e teria acertado por acidente em 7
casos e errado no oitavo.

## §9 — Auto-refutacao

- *O mapa foi criado depois do fragmento?* Nao. Mapa 2026-04-09, fragmento
  2026-06-02. **54 dias antes.**
- *O `lead_id` do mapa ja estava contaminado pelo merge?* Nao nos 7: o
  `right(ph,11)` do telefone do deal casa com `9abb20c2` no snapshot de 05/05.
  O contraste esta no deal da Alean, onde o mesmo teste **falha** e revela um
  repontamento real. O teste distingue os dois casos.
- *O telefone no deal era diferente no fechamento?* **Sim — e essa foi a
  descoberta.** Seis dos 8 foram renomeados em 25/05. Em `698b4051` o telefone
  era outro (`554187139689`). Por isso o nome de hoje foi descartado como prova.
- *A proposta pertence ao fragmento?* Nao. 8/8 com `lead_id = 9abb20c2`; o
  `contact_rdstation_id` do fragmento nao aparece em nenhuma.
- *`9abb20c2` recebeu os deals por um resolver antigo defeituoso?* O resolver
  antigo era fraco (`right(ph,11)`), mas aqui produziu **match unico** contra o
  estado real da base em 05/05. O defeito historico da v55 era resolver por
  `lead_identificadores`, mecanismo diferente e nao usado nestas linhas.
- *Escolher o canonico apaga aquisicao legitima do fragmento?* Nao. O fragmento
  conserva `created_at`, email, `external_id` e **suas 3 compras exclusivas**.
  Nada dele e movido ou apagado.
- *O oitavo caso e diferente dos outros sete?* **Sim**, e foi tratado a parte:
  sem mapa, com telefone divergente, resolvido por uma quarta fonte
  (`propostas_rd.contact_rdstation_id`). Chegou ao mesmo lead por caminho
  independente.

Nenhuma refutacao sobreviveu.

## §10 — Proximo passo

**R52 — o backfill dos 8**, com `lead_id = 9abb20c2` nos oito. Gates que
continuam obrigatorios e **nao** foram cumpridos aqui:

- `event_id = 'rd_won_' || deal_id`, para idempotencia com a v56;
- `event_time = closed_at` da RD, nunca `now()`;
- `value = total_price` ao vivo (ja reancorado na R50: 8/8 `won`);
- **gate de `fn_cancelar_disparos_apos_compra` e `fn_trigger_feedback_purchase`**,
  que agem por `lead_id` **sem filtro de data** — medir o raio no lead
  `9abb20c2` antes de escrever, nao depois;
- zero atribuicao fabricada (o §6 ja provou que nao ha nada a copiar);
- guardas de delta, nunca de zero absoluto.

Registrados, fora de escopo: os 22 SEM_LEAD; o par da Igreja (466,68/466,80); o
par de R$1.799,79 do Kleberson; **o T0 de 2025-08-22 perdido no merge de 25/05**;
`crm_deals_cache` congelado desde 16/08.
