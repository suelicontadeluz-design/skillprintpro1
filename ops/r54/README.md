# R54 — os 24 deals won sem identidade suficiente

Rodada READ-ONLY de 2026-08-26. **Nenhuma escrita.**

## Veredito

**PRECISA_CAMADA_IDENTIDADE_ADICIONAL**

| classe | deals | valor |
|---|---:|---:|
| RESOLVE_LEAD_PROVADO | **0** | R$0,00 |
| **RESOLVE_PESSOA_PROVADA_MAS_LEAD_HISTORICO_AMBIGUO** | **12** | **R$7.109,64** |
| PROVAVEL | 0 | R$0,00 |
| **SEM_EVIDENCIA** | **12** | **R$7.392,95** |
| CONFLITO_DE_IDENTIDADE | 0 | R$0,00 |
| NAO_E_WON | **0** | R$0,00 |

**Nenhum dos 24 pode virar backfill.** Mas a razao mudou: em metade deles nao e
que nao sabemos quem e o cliente — **sabemos, com CPF ou CNPJ**. O que falta e
um `lead_id`, e ele nunca existiu.

## §0/§1 — Universo reancorado e RD LIVE

Reconstruido do zero: **24 deals, R$14.502,59** (22 com telefone no nome + 2
sem). Sem deriva apos a R53.

`GET api.rd.services/crm/v2/deals/<id>`, um por deal:

**24/24 WON_CONFIRMADO** — HTTP 200, `status = won`, pipeline de vendas
`63191f7dd02b2e000cb1805b`, `closed_at` presente, `total_price` **igual ao
`valor_sinc`** em 24/24. Fechamentos entre 26/01 e 26/03.

`NAO_WON = 0` · `INEXISTENTE = 0` · `ERRO_LEITURA = 0`.

Primeiro sinal forte: **24/24 tem `contacts = []` e `organization = null`** na
RD. Nenhum dos 24 deals tem contato ligado. A camada A pela via do deal esta
vazia por construcao.

## §2/§4 — Camada A e B: `propostas_rd` deu chave, e a chave nao existe aqui

**24/24 tem linha em `propostas_rd`**, gravada em 13/04 (uma em 24/08), com
`contact_rdstation_id` real. Mas:

| sonda | resultado |
|---|---:|
| `propostas_rd.lead_id` preenchido | **0 de 24** |
| `contact_rdstation_id` da proposta existe em `lead_identificadores` | **0 de 24** |
| `crm_deal_snapshot` | **0 de 24** |

Foi o que salvou o caso da Vanessa na R51 — la a proposta trazia
`lead_id` **e** o `contact_rdstation_id` da lead canonica. Aqui a mesma fonte
existe e **aponta para contatos RD que nao tem lead nenhum**.

## §3 — Nao generalizei chave CRM

Nao havia o que generalizar: os 24 `contact_rdstation_id` das propostas **nao
aparecem uma unica vez** em `lead_identificadores`. Nenhuma chave compartilhada
foi usada, e nenhuma varredura global por chave CRM foi feita.

## §5 — Snapshots historicos: o lead nunca existiu

Busca por telefone (chave DDD + 8 ultimos, nas 4 variantes) nas 20 chaves
distintas dos 22 deals com telefone:

| fonte | achados |
|---|---:|
| `leads_marketing` hoje | **0** |
| `leads_marketing_bk_normalizacao_20260505` | **0** |
| `leads_marketing_bk_ctwa_20260712` | **0** |
| `lead_identificadores.telefone` | **0** |
| `bc_subscriber_lookup.phone` | **0** |
| `lead_merge_log` (lead apagado por merge) | **0** |

Isso responde a pergunta central do §5 com um **nao** duro: o cliente **nao
estava ligado a lead nenhum na epoca do deal**, e nao e caso de lead apagado
depois. Diferente da Vanessa/Alean, onde o lead historico existia e sobrevivia
no backup de 05/05.

## §6 — E-mail / CNPJ: aqui a investigacao virou

A operacao e B2B e o ERP tem cadastro proprio. Buscando os mesmos telefones em
`public.pessoas`:

**8 pessoas encontradas, cobrindo 10 deals**, com documento e nome batendo:

| deal(s) | nome no deal | `pessoas` (ERP) | documento | e-mail |
|---|---|---|---|---|
| `69a70498`, `698b9095`, `69c2efe7` | Gabriela Anjos | Gabriela Anjos | CPF 414.974.548-08 | — |
| `698204ff` | Evaldo de Melo Correa | Evaldo de Melo Correa | CPF 313.088.148-44 | evaldomelo21@icloud.com |
| `6985ecae` | Mateus Rodrigues Amorim | Mateus Rodrigues Amorim | CPF 112.217.686-46 | rodriguesmateus800@gmail.com |
| `6978a925` | Guilherme França | Guilherme França | **CNPJ 03.534.706/0001-21** | guilherme@artenobre.com |
| `6983382c` | Junior - Bozzi transportes | **Bozzi Transportes** | **CNPJ 46.894.261/0001-01** | bozziodair1@gmail.com |
| `69820cc4` | Thiago Cardoso Couto | Thiago Cardoso Couto | CPF 710.675.431-55 | Thiagocardosocouto4@gmail.com |
| `698a2a75` | Victória | **Victória Homercher** | CPF 858.451.080-04 | atleticauniritter@gmail.com |
| `6977f82d` | Marcos Ferreira | **Marcos Protec Segurança Eletrônica** | CPF 100.009.774-97 | — |

Telefone, nome e documento corroboram. **PESSOA_PROVADA** nesses 10.

### O caso Autera, que so apareceu pelo CNPJ

O deal `6977f916` (**R$1.780,00**) nao tem telefone no nome:
`Autera Áudio e Vídeo | Cleberson`. Pelo nome:

```
deal  "Autera Áudio e Vídeo | Cleberson"
  -> pessoas  "AUTERA AUDIO E VIDEO", CNPJ 50.156.978/0001-15, tel 1195923977
      -> lead  9d323c6b  "Cleberson"  ph 5511995923977  (chave 1195923977)
```

A chave do telefone do ERP e a do lead **batem exatamente**. E o unico dos 24
que chega a um lead — e mesmo assim **nao serve**: o lead `9d323c6b` foi criado
em **2026-05-25**, e o deal fechou em **2026-01-26**. Quatro meses antes. Em
05/05 esse lead ainda nao existia.

**Pessoa provada, lead historico nao.**

E `Dudalippe Personaliados` (R$20,00, telefone literal `123458`) existe no ERP
com telefone `+5521964663532`, mas **sem CNPJ, sem e-mail e sem lead** por esse
telefone.

## §7 — Conversas

Apenas **3 das 20 chaves** tem historico em `fact_conversations`, e nas tres o
`lead_id` e **nulo**:

| chave | cliente | mensagens | periodo | deal fechou em |
|---|---|---:|---|---|
| `1178908920` | Loh | 29 | 10/04 | **26/03** |
| `1161705746` | Gabriela Anjos | 15 | 22–23/04 | 10/02 a 25/03 |
| `1159754004` | Lidia | 2 | 31/03 | **06/03** |

**Todas as conversas sao posteriores ao fechamento do deal** e nenhuma gerou
lead. Conversa aqui e contexto, nao identidade: nao aponta `lead_id` nenhum.

## §8 — `pessoa_id` da R49

**0 dos 24** alcanca a camada da R49, direta ou indiretamente. `9d323c6b` (o
lead da Autera) **nao esta** em `identidade_comercial_leads`. Nenhuma identidade
nova foi criada, e nenhum candidato foi promovido — a R49 continua manual.

## §9 — Classificacao final por deal

### RESOLVE_PESSOA_PROVADA_MAS_LEAD_HISTORICO_AMBIGUO — 12 deals, R$7.109,64

| deal | cliente | valor | prova da pessoa | por que o lead nao |
|---|---|---:|---|---|
| `69a70498` | Gabriela Anjos | 1.173,20 | ERP CPF + telefone + nome | nenhum lead, nunca houve |
| `698b9095` | Gabriela Anjos | 1.044,20 | idem | idem |
| `69c2efe7` | Gabriela Anjos | 722,10 | idem | idem |
| `6977f916` | Autera / Cleberson | **1.780,00** | ERP **CNPJ** + telefone → lead | **lead nasceu 4 meses depois** |
| `698204ff` | Evaldo de Melo Correa | 739,00 | ERP CPF + e-mail | nenhum lead |
| `6985ecae` | Mateus R. Amorim | 442,35 | ERP CPF + e-mail | nenhum lead |
| `6978a925` | Guilherme França | 389,80 | ERP **CNPJ** + e-mail | nenhum lead |
| `6983382c` | Bozzi Transportes | 389,40 | ERP **CNPJ** + e-mail | nenhum lead |
| `69820cc4` | Thiago Cardoso Couto | 219,88 | ERP CPF + e-mail | nenhum lead |
| `698a2a75` | Victória Homercher | 130,48 | ERP CPF + e-mail | nenhum lead |
| `6977f82d` | Marcos Protec | 59,23 | ERP CPF | nenhum lead |
| `6979e75b` | Dudalippe Personaliados | 20,00 | ERP nome + telefone (sem doc) | nenhum lead |

### SEM_EVIDENCIA — 12 deals, R$7.392,95

`6981fa33` Leandra **3.466,65** · `6986106b` Salem Oliveira 987,00 ·
`699c4c50` Lidia 805,87 · `698b6f6e` Loh 783,20 · `69849e1e` Cleber F. de Lima
406,10 · `698b3323` Daniele valim 401,04 · `698e016f` Mauricio Oliveira 167,73 ·
`698b3c60` Patrick Importados 92,55 · `698f71bc` Alex Nascimento 90,00 ·
`699c93a9` Leonardo Schmidt 83,91 · `69832ee8` Marcio Cedro 79,90 ·
`6985d918` Cleide Ferreira De Melo 29,00.

Sem lead, sem ERP, sem identificador. Lidia e Loh tem rastro de conversa, mas
sem `lead_id` e posterior ao fato — nao promove nada.

**Nenhum `RESOLVE_LEAD_PROVADO`. Nenhum `PROVAVEL`.** Nao promovi nada por nome,
e nao promovi a Autera so porque a cadeia CNPJ→telefone→lead fecha: **a cadeia
prova a pessoa, nao o lead da epoca.**

## §10 — Pessoa nao e lead: o bloqueio e estrutural

Para 12 deals o resultado e **PESSOA_PROVADA + LEAD_HISTORICO_NAO_PROVADO**.
Nenhum `lead_id` foi inventado.

Verificacao que importa para a recomendacao: **`pixel_events.lead_id` aceita
NULL** (8.987 eventos tem `lead_id` nulo). Mas **zero Purchase** tem — e a R43
mediu que a populacao de Purchase com `lead_id` nulo **e exatamente a que
desapareceu historicamente**. Entao o bloqueio nao e uma constraint do banco, e
**convencao mais risco medido**. Gravar Purchase sem lead seria escrever
justamente na forma que ja sumiu antes.

## §11 — `event_time` / `value` (validados, nao inseridos)

Para os 24, caso algum dia virem backfill:
`event_time` = `closed_at` da RD e `value` = `total_price` da RD, **conferidos
24/24 ao vivo**. Nenhum insert feito.

## §12 — Atribuicao

**SEM_ATRIBUICAO em 24/24.** As 24 linhas de `propostas_rd` tem
`utm_campaign`, `utm_source` e `utm_medium` vazios, e nao existe lead de onde
copiar UTM — o que elimina por construcao o risco de transformar venda em
aquisicao paga. `ATRIBUICAO_HISTORICA_PROVADA = 0`, `AMBIGUA = 0`.

## §13 — Risco de triggers

Sem caso pronto para backfill, nao ha o que simular em escala. Medi apenas o
unico lead alcancado, `9d323c6b` (Autera), como referencia:

| trigger | raio hoje |
|---|---:|
| `fn_cancelar_disparos_apos_compra` — WABA `pendente_envio`/`ativo` | **0** |
| `fn_trigger_feedback_purchase` — tasks `pendente`/`em_andamento` | **0** |
| `fn_fechar_tasks_apos_compra` — ramo direto (lead **ou telefone**) | **0** |
| `fn_fechar_tasks_apos_compra` — ramo de reabertura (janela de 7 dias) | **0** |
| `fn_vera_observar_eventos` — ciclos elegiveis | **0** |

Classe operacional: seria **BACKFILL_SEGURO** quanto a efeito colateral. O que
bloqueia a Autera nao e o trigger — e o lead nao existir na epoca.

## §14 — Quanto desbloqueamos

**Zero.** Nenhum dos 24 vira backfill nesta rodada.

| bloco | deals | valor |
|---|---:|---:|
| pronto para backfill | **0** | **R$0,00** |
| pessoa provada, lead ausente | 12 | R$7.109,64 |
| sem evidencia | 12 | R$7.392,95 |
| **total ainda ausente** | **24** | **R$14.502,59** |

## §15 — Nenhuma camada nova criada

Nenhuma `pessoa_id` foi criada, nenhum vinculo foi proposto para escrita,
nenhuma varredura global por chave CRM foi executada. A R49 segue com 3 pessoas
e 6 vinculos.

## §16 — Auto-refutacao

- *Chave CRM compartilhada por pessoas diferentes?* Nao se aplica: os 24
  `contact_rdstation_id` **nao existem** em `lead_identificadores`.
- *Telefone reciclado?* Nao ha lead com esses telefones em nenhuma epoca —
  nao ha o que reciclar.
- *Nome generico?* Sim, e por isso nao resolvi por nome. **Existem hoje 4 leads
  "Cleberson/Kleberson"**: `ac931260` (Kleberson, `…72491479`), `93c70a4f`
  (fragmento Kleberson), `9d323c6b` (Cleberson, `…95923977`) e `ac1d0fc4`
  (Cleberson Bilu Promotor, DDD 53). Se a Autera tivesse sido resolvida por
  nome, tinha 3 chances em 4 de errar. Foi o CNPJ do ERP mais a chave de
  telefone que apontou `9d323c6b` — **e ele mesmo assim nao foi promovido**.
- *Proposta ligada ao lead errado?* Nao ha lead nas propostas: 0 de 24.
- *Merge antigo contaminou o historico?* Nao: **0 merges** envolvendo esses
  telefones.
- *Lead nasceu depois do deal?* **Sim, no unico caso em que existe lead** — e foi
  exatamente por isso que a Autera nao virou `RESOLVE_LEAD_PROVADO`.
- *Pessoa e a mesma, mas o lead historico nao?* **Sim, em 12 deals.** E a
  conclusao da rodada.
- *Existe outro candidato igualmente forte?* Para a Autera, `ac1d0fc4`
  "Cleberson Bilu Promotor" e homonimo, mas o telefone (DDD 53) nao bate com o
  CNPJ do ERP. Descartado por dado, nao por preferencia.
- *Estamos usando dado atual para reescrever o passado?* E precisamente o risco
  que fez os 12 pararem: o ERP foi importado em **03/04/2026** e os deals sao de
  jan-mar. O cadastro atual prova quem e o cliente, **nao** o que existia na
  epoca.

## §17 — Veredito

**PRECISA_CAMADA_IDENTIDADE_ADICIONAL**

- realmente resolvidos (lead provado): **0**
- podem virar backfill agora: **0**
- pessoa provada, lead ausente: **12 — R$7.109,64**
- continuam UNKNOWN: **12 — R$7.392,95**
- total ainda ausente: **24 — R$14.502,59**

## §18 — Proximo passo minimo

O bloqueio nao e mais falta de investigacao: e falta de **um lead onde ancorar**.
Duas saidas possiveis, e **nenhuma delas e obvia** — decisao de negocio, nao
tecnica:

1. **Criar lead historico** para os 12 com pessoa provada, marcado como
   originado do ERP, com `created_at` declarando a data real de criacao do
   registro (nao a do deal). Cria cadastro que nao existia — precisa de
   autorizacao explicita e de regra sobre T0 e atribuicao.
2. **Estender `identidade_comercial`** para aceitar identidade ancorada em
   `pessoas` (ERP) sem lead, e so entao decidir se `pixel_events` pode
   representar venda de pessoa sem lead. Mexe no contrato da camada e no
   invariante "todo Purchase tem lead".

Nao recomendo escolher hoje. O que recomendo antes: decidir se **R$7.109,64 de
venda won confirmada valem criar 12 cadastros que a operacao nunca criou**.

Registrados, sem mudanca: os 12 SEM_EVIDENCIA; o T0 de 2025-08-22 da
Vanessa/Alean; os pares suspeitos da Igreja e do Kleberson; o
`fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa; `crm_deals_cache`
congelado desde 16/08.
