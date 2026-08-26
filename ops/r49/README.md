# R49 — camada logica de identidade comercial (minima)

Executada em 2026-08-26. **3 identidades logicas criadas, 6 leads associados,
zero merge, zero delete, zero alteracao em historico.**

Escrita **puramente aditiva**: duas tabelas novas, uma view nova, um artefato de
rollback. Nada existente foi tocado.

## §1 — Reancoragem: 6/6 identicos a R48

`md5` dos 6 leads = `d9467ee783cbd9fca0361a088e1377ec`, conferido **duas vezes**:
na medicao e de novo **dentro da transacao de escrita**, como guarda de abort.
Nenhum dado mudou entre a R48 e esta rodada.

## §2 — Gate de nao-generalizacao: a chave CRM foi REFUTADA como regra global

Antes de escrever, procurei o contraexemplo. Achei, e forte.

### `contact_rdstation_id` NAO implica mesma pessoa

| contact_rdstation_id | leads | chaves de telefone distintas | nomes |
|---|---:|---:|---|
| `69758ada096bdd0013293060` | **6** | **6** | beats estamparia, bruno cardoso, francisco evaldo lima, joao galdino, leandro, otacilio pereira de oliveira |
| `6a19b577432a41002187b9d4` | **5** | **5** | cleber, lifejoy brazilian criative, lucas sousa, reynaldo paiva, silvinha |
| `6977590ced192200167c6da9` | 3 | 3 | adenilson lima dos santos, camilla neder de paula cintra, neide aparecida santos silva |

Seis pessoas diferentes, seis telefones diferentes, quatro emails diferentes,
**um unico contact_rdstation_id**. Uma regra `same contact_rdstation_id =>
same pessoa` fundiria seis clientes reais num so.

### `contact_botconversa_id` tambem nao

| contact_botconversa_id | nomes | telefones |
|---|---|---|
| `702319061` | cyzo collection / cyzo ferrera | `5511994655549` / `5521968674727` (DDD 11 e 21) |
| `887576410` | marcia / marcia | `5511949448159` / `5513978078425` (DDD 11 e 13) |
| `897946989` | helaine / helaine beraldo | `5511950553969` / `5511950556969` |

**Veredito: as duas chaves sao EVIDENCIA, nunca identidade soberana.**
Nenhuma regra automatica foi criada. A camada tem exatamente 6 linhas, escritas
uma a uma.

### O discriminador que separa nossos 3 casos do lixo

| grupo | chaves de telefone distintas |
|---|---:|
| Vanessa (`824326325`) | **1** — `4195338939`, os dois telefones colapsam |
| Kleberson / Igreja | 1 (o fragmento tem telefone quebrado, sem chave valida) |
| `cyzo`, `marcia`, `69758ada…` | **2 a 6** — linhas genuinamente diferentes |

Nos 3 casos autorizados a chave CRM **e** o telefone concordam. Nos
contraexemplos, discordam. Foi isso que virou guarda de abort, nao o "parece".

## §3 — Estrutura existente: procurei, nao serve

| candidata | o que e | por que nao |
|---|---|---|
| `lead_dedup_candidatos` | 156 linhas, **todas ja aplicadas** (103 `aplicado`, 53 `aplicado_com_revisao`) | E fila de merge: modela `canonico` + `duplicado`. Usa-la exigiria declarar um dos leads "duplicado a eliminar" — o oposto do pedido. Nossos 6 leads nao estao la. |
| `pessoas` (1754 linhas) | cadastro do **ERP** (CPF, CNPJ, IE, regime tributario, limite de credito) | **Nao tem `lead_id`.** Nao responde `lead_id -> pessoa`. E o ancoradouro do §12, nao a camada. |
| `vw_venda_identidade` | identidade **da venda** (produtor, deal) | Nao e identidade de pessoa. |
| `lead_merge_log` | log de merges fisicos | Registra destruicao, nao equivalencia. |

Achado lateral util para o §12: `pessoas` **ja contem** `Vanessa Büher` com
telefone `+554198207823` — o telefone **antigo da Alean**, que foi merjado em
25/05. E `Kleberson farias santos` com `+5511972491479`. O ERP esta ancorado em
telefones que aqui ja mudaram.

**Nenhuma estrutura representa equivalencia de leads sem deletar. Criei a menor.**

## §4 — Estrutura final

```sql
identidade_comercial
  pessoa_id  uuid pk default gen_random_uuid()
  created_at timestamptz not null default now()
  status     text not null default 'ativa' check (status in ('ativa','revogada'))

identidade_comercial_leads
  pessoa_id       uuid not null -> identidade_comercial  on delete restrict
  lead_id         uuid not null -> leads_marketing       on delete restrict
  evidencia_tipo  text not null
  evidencia_valor text not null
  confidence      text not null check (in ('provada','provavel','indeterminada'))
  validado_em     timestamptz not null default now()
  validado_por    text not null
  valid_from      timestamptz not null default now()
  valid_to        timestamptz
  pk (pessoa_id, lead_id, valid_from)
  check (valid_to is null or valid_to > valid_from)

-- um lead so pode ter UM vinculo aberto
create unique index identidade_comercial_leads_um_vinculo_aberto
  on identidade_comercial_leads (lead_id) where valid_to is null;
```

Zero campos alem do especificado.

### Duas decisoes de projeto que precisam ser ditas em voz alta

**1. O UNIQUE e parcial, nao total.** `where valid_to is null`. Um lead pode ter
vinculos **fechados** (historico da decisao) e no maximo **um aberto**. Fechar um
vinculo e setar `valid_to`, nunca deletar — senao a camada perde o rastro de por
que se decidiu o que se decidiu.

**2. As FKs sao `ON DELETE RESTRICT`, e isso muda comportamento.** Enquanto
existir vinculo aberto, **`fn_merge_leads` nao consegue deletar estes 6 leads** —
o `DELETE` final aborta. Isso e proposital: vira trilho de seguranca depois de a
R48 ter mostrado que aquela funcao destroi CEP, cidade, `created_at`,
`consentimento` e cupom.

Medido antes de decidir: **nada automatizado deleta leads.** Somente
`fn_merge_leads` e `fn_merge_lead` contem `DELETE FROM leads_marketing`, nenhum
cron as chama, e nenhum merge acontece desde 2026-05-25. Risco operacional hoje:
zero. Para um merge autorizado no futuro, fechar o vinculo (`valid_to = now()`)
e passo deliberado e auditavel.

### Aviso de nomenclatura, gravado como comentario na tabela

`identidade_comercial.pessoa_id` **nao e** `public.pessoas.id`. Sao universos
diferentes: um e camada logica de leads, o outro e cadastro do ERP. Juntar os
dois por igualdade de id daria resultado silenciosamente errado. Esta escrito em
`comment on table` e `comment on column`.

RLS: deixada **desabilitada**, igual as vizinhas diretas (`leads_marketing`,
`lead_identificadores`, `lead_merge_log`, `lead_dedup_candidatos` — todas sem
RLS). Nao inventei politica divergente. O advisor de seguranca retornou **0
lints** atribuiveis aos objetos novos — mas o snapshot pode ser anterior a eles,
entao registro isso como "nao acusou", nao como "esta provado limpo".

## §5 — As tres identidades e os seis leads

| pessoa_id | leads | evidencia | confidence |
|---|---|---|---|
| `cbfe9287-ea20-43d8-be44-7bd5bd1bb106` | `9abb20c2` + `336a959d` | `contact_botconversa_id = 824326325` | provada |
| `d74e8ace-2827-4406-84c5-df7830379c29` | `ac931260` + `93c70a4f` | `contact_rdstation_id = 699c8952ffd31d00174adbdc` | provada |
| `5b8083a4-d014-4fe6-a402-67265104134e` | `e218bcbb` + `559c601d` | `contact_rdstation_id = 698f1c4caae4d30013f84425` | provada |

**3 pessoas, 6 leads, 2 leads cada.** Nenhum setimo lead entrou. Guarda
`leads_fora_dos_6 = 0` aprovada.

## §6 — Escrita: ensaio antes, guardas dentro

Ensaio em transacao auto-abortada (`raise exception 'ENSAIO_OK'`) antes da
escrita real. Passou com hashes identicos. So depois a execucao definitiva, com
as mesmas guardas.

| guarda | resultado |
|---|---|
| gate A — hash dos 6 leads na transacao | **igual ao baseline** |
| gate B — Kleberson compartilha `contact_rdstation_id` | 1 |
| gate B — Igreja compartilha `contact_rdstation_id` | 1 |
| gate B — Vanessa compartilha `contact_botconversa_id` | 1 |
| gate B — telefones da Vanessa colapsam em 1 chave v56 | **1** |
| gate C — camada vazia para estes leads | 0 |
| pessoas criadas | **3** |
| vinculos criados | **6** |
| pessoa sem exatamente 2 leads | **0** |
| lead em duas pessoas ativas | **0** |
| `leads_marketing` (hash dos 6) | **inalterado** |
| `pixel_events` Purchase (hash dos 6) | **inalterado** |
| `lead_identificadores` (hash dos 6) | **inalterado** |
| leads totais | 16029 -> **16029** |
| Purchase totais | 1591 -> **1591** |
| `lead_merge_log` | 159 -> **159** |

## §7 — View de leitura

`vw_pessoa_identidade` responde as duas direcoes pedidas: `lead_id -> pessoa_id`
e `pessoa_id -> todos os leads historicos`. So expoe vinculos abertos de
identidades ativas.

`pessoa_t0 = min(lead.created_at) do grupo`, calculado **por janela**, sem
gravar nada. O `created_at` de cada lead continua exposto ao lado, intacto.

Nenhum consumidor atual foi alterado. A view so nasceu.

## §8 — Prova de preservacao: 25/25

| item | antes | depois |
|---|---|---|
| leads totais | 16029 | **16029** |
| hash dos 6 leads | `d9467ee7…` | **`d9467ee7…`** |
| `created_at` dos 6 | 6 timestamps | **os mesmos 6** |
| Purchase totais | 1591 | **1591** |
| receita representada | 637.328,77 | **637.328,77** |
| hash dos Purchase dos 6 | `1355fa7a…` | **`1355fa7a…`** |
| eventos pixel dos 6 | 198 | **198** |
| hash de `lead_identificadores` | `929c8dcc…` | **`929c8dcc…`** |
| propostas dos 6 | 41 | **41** |
| conversas dos 6 | 6097 | **6097** |
| zapi inbox dos 6 | 3384 | **3384** |
| linhas de mapa dos 6 | 22 | **22** |
| compradores unicos | 504 | **504** |
| canonical deals | 1391 | **1391** |
| `lead_merge_log` | 159 | **159** |

**0 delete, 0 update, 0 alteracao de UTM, 0 alteracao de T0.** Somente a
associacao logica nasceu.

## §9 — Vanessa: o teste principal

Reexecutei a resolucao dos 37 deals sem representacao, trocando "conta leads
distintos" por "conta `pessoa_id` distintos", **sem inserir nenhum Purchase**:

| antes | depois | deals | valor |
|---|---|---:|---:|
| **AMBIGUO** | **RESOLVE_UNICO** | **8** | **R$2.801,51** |
| SEM_LEAD | SEM_LEAD | 22 | 12.702,59 |
| RESOLVE_UNICO | RESOLVE_UNICO | 5 | 1.827,70 |
| SEM_TELEFONE | SEM_TELEFONE | 2 | 1.800,00 |

**8 desbloqueados, R$2.801,51 — exatamente o previsto pela R48.** A classe
AMBIGUO foi a zero. Nenhum deal migrou entre quaisquer outras classes: zero
colateral.

Nenhum Purchase foi inserido. Isso e a R51.

## §10 — Kleberson e Igreja: nada repontado

**Kleberson.** O Purchase do fragmento segue **exatamente onde estava**:
`won_6a3d88c74dc0900020c5d44c`, R$1.800,00, `lead_id = 93c70a4f`. Nao foi
movido, nao foi marcado duplicado, nao foi resolvido. A duvida da R48 — se ele e
o mesmo negocio do `won_6a3d88c9…` de R$1.799,79 — **continua aberta e
intocada**. A camada apenas permite ver os dois sob a mesma pessoa sem decidir.
O cupom `SKILLULCDH8` segue no fragmento.

**Igreja.** `pessoa_t0 = 2026-02-24` — o T0 do fragmento, 21 dias mais antigo que
o do canonico. Era exatamente o que o `fn_merge_leads` destruiria. O CEP
`06818-190` e a cidade `embu das artes` seguem no fragmento, intactos: a camada
os torna alcancaveis sem precisar copia-los para lugar nenhum.

## §11 — Os 22 SEM_LEAD: confirmado, 0 desbloqueados

22 deals, R$12.702,59, **inalterados**. A camada nao os toca e nao foi ampliada
para tentar. Continuam UNKNOWN.

## §12 — Contrato ERP simulado (nao implementado)

```
ERP cliente_id -> identidade_comercial.pessoa_id -> 1..N leads_marketing.lead_id
```

O que a camada ja entrega hoje, READ-ONLY:

| pessoa | leads | T0 | compras | LTV agregado |
|---|---:|---|---:|---:|
| Kleberson | 2 | 2026-04-20 | 23 | **R$13.277,72** |
| Vanessa Büher | 2 | 2026-03-31 | 19 | **R$10.203,54** |
| Igreja Batista | 2 | 2026-02-24 | 2 | R$933,48 |

Antes da camada esses numeros estavam partidos: Kleberson aparecia como
R$11.477,72 + R$1.800,00 em dois clientes, Vanessa como R$9.377,95 + R$825,59.

**Ressalva honesta:** as 2 compras da Igreja sao o par `466,68` / `466,80` que a
R48 marcou como candidato forte a duplicacao no nivel da RD. A camada diz
"2 compras" porque ha 2 Purchase; ela **nao** prova que houve recompra. Nao
transformar isso em fato.

Nenhuma integracao ERP foi implementada.

## §13 — Auto-refutacao

- *Algum par nao e a mesma identidade?* Kleberson e Igreja compartilham a **PK do
  contato na RD**; Vanessa compartilha o assinante BotConversa **e** a chave de
  telefone. Nos 3, chave CRM e telefone concordam.
- *A camada mistura pessoas diferentes?* Guarda `grupos_crm_colididos_na_camada
  = 0`: nenhum dos 3 grupos de colisao comprovada (`69758ada…`, `6a19b577…`,
  `6977590c…`) entrou.
- *Alguma UTM seria agregada indevidamente?* Guarda
  `utm_conflitante_por_pessoa = 0`. Nenhum dos 6 leads tem campanha, source ou
  medium validos — nao ha o que agregar errado. E a camada nao escreve UTM.
- *Um lead entra em duas pessoas?* Impossivel por indice unico parcial. Guarda
  `lead_em_2_pessoas = 0`.
- *Chave CRM virou regra global?* Nao. 6 linhas, escritas literal a literal.
  Existem 37 grupos RD e 38 BotConversa compartilhados na base; **nenhum** foi
  incluido automaticamente.
- *A camada modifica fato historico?* 25 guardas de preservacao, todas iguais ao
  baseline, incluindo hashes byte-a-byte.
- *Os 8 da Vanessa continuam ambiguos?* Nao: 8/8 viraram RESOLVE_UNICO.
- *A camada resolve os 22 SEM_LEAD?* Nao, e nao deve. Continuam 22.
- *`ON DELETE RESTRICT` quebra alguma rotina viva?* Nao: nada automatizado deleta
  lead, e nenhum merge ocorre desde 25/05. Mas **bloqueia** `fn_merge_leads`
  nestes 6 — proposital, e declarado.

Nenhuma refutacao passou. **Sem rollback.**

## §14 — Veredito

**IDENTIDADE_MINIMA_IMPLEMENTADA**

| pergunta | resposta |
|---|---|
| pessoas criadas | **3** |
| leads associados | **6** (2 por pessoa) |
| 8 da Vanessa desbloqueados? | **Sim — 8, R$2.801,51** |
| 22 SEM_LEAD permanecem? | **Sim, 22, R$12.702,59** |
| algum historico alterado? | **Nenhum — 25/25 guardas iguais ao baseline** |

## Rollback

`public._r49_rollback` (6 linhas: `pessoa_id`, `lead_id`, evidencia,
`valid_from`, `pessoa_created_at`).

Como a escrita foi so aditiva, o rollback e remover o que nasceu:

```sql
begin;
delete from identidade_comercial_leads icl
 using public._r49_rollback r
 where icl.pessoa_id = r.pessoa_id and icl.lead_id = r.lead_id;   -- esperar 6

delete from identidade_comercial ic
 where ic.pessoa_id in (select distinct pessoa_id from public._r49_rollback);  -- esperar 3
commit;

-- opcional, se quiser remover a estrutura tambem:
-- drop view public.vw_pessoa_identidade;
-- drop table public.identidade_comercial_leads;
-- drop table public.identidade_comercial;
```

Os leads originais nao sao tocados em nenhum passo. A ordem importa: os vinculos
saem primeiro, porque a FK e `RESTRICT`.

## Proximo passo

**R50 — backfill dos 8 deals da Vanessa.** Agora que a identidade e unica, os 8
deixaram de ser bloqueados por ambiguidade. Gates obrigatorios, herdados da R44:

- reancorar os 8 na RD ao vivo — **hoje impossivel, a RD esta retornando 401**;
- decidir a qual dos dois leads cada Purchase se ancora (a pessoa e unica, o lead
  historico nao — e o `lead_id` continua sendo a coluna real de `pixel_events`);
- gate obrigatorio de `fn_cancelar_disparos_apos_compra` e
  `fn_trigger_feedback_purchase`, que agem por `lead_id` **sem filtro de data**;
- zero atribuicao fabricada.

Enquanto a RD nao voltar, a R50 nao comeca.

Nao trabalhado, registrado: os 22 SEM_LEAD; o par duplicado da Igreja
(`466,68` / `466,80`); o par de R$1.799,79 do Kleberson; os ~52 outros grupos de
identidade que a camada **nao** absorveu por nao terem sido validados um a um.
