# R55 — como representar venda de cliente que nunca teve lead

Rodada READ-ONLY de 2026-08-26. **Nenhuma escrita: zero INSERT, UPDATE, DELETE,
DDL, backfill e criacao de lead.** Nem ensaio revertido — a rodada proibia
INSERT, entao a analise dos consumidores foi feita por **semantica de SQL sobre
as definicoes vivas**, nao por simulacao de escrita. Onde a leitura do codigo nao
decide, esta marcado como indeterminado.

## Veredito

**PRECISA_DEAL_IDENTIDADE**

E o achado que forca esse veredito: **PURCHASE_SEM_LEAD_INSEGURO**, provado em
tres frentes independentes (§5, §6, §7).

**Desenho recomendado: C** — fato comercial `deal → identidade`, **fora** de
`pixel_events`.

## §1 — Os 12 reancorados

12 deals, **R$7.109,64**, **10 pessoas** (Gabriela Anjos tem 3). RD ao vivo:
**12/12 won**, pipeline de vendas, `closed_at` presente, **0 ja representados**.
Conjunto identico ao da R54, sem deriva.

| deal | pessoa (ERP) | documento | valor | fechou |
|---|---|---|---:|---|
| `6977f916` | AUTERA AUDIO E VIDEO | CNPJ 50.156.978/0001-15 | 1.780,00 | 26/01 |
| `69a70498` | Gabriela Anjos | CPF 414.974.548-08 | 1.173,20 | 04/03 |
| `698b9095` | Gabriela Anjos | idem | 1.044,20 | 10/02 |
| `698204ff` | Evaldo de Melo Correa | CPF 313.088.148-44 | 739,00 | 06/02 |
| `69c2efe7` | Gabriela Anjos | idem | 722,10 | 25/03 |
| `6985ecae` | Mateus Rodrigues Amorim | CPF 112.217.686-46 | 442,35 | 09/02 |
| `6978a925` | Guilherme França | CNPJ 03.534.706/0001-21 | 389,80 | 27/01 |
| `6983382c` | Bozzi Transportes | CNPJ 46.894.261/0001-01 | 389,40 | 04/02 |
| `69820cc4` | Thiago Cardoso Couto | CPF 710.675.431-55 | 219,88 | 03/02 |
| `698a2a75` | Victória Homercher | CPF 858.451.080-04 | 130,48 | 12/02 |
| `6977f82d` | Marcos Protec | CPF 100.009.774-97 | 59,23 | 26/01 |
| `6979e75b` | Dudalippe Personaliados | — | 20,00 | 28/01 |

`lead_id` inexistente em 12/12 (R54: nao existe hoje, nao existia em 05/05 nem
em 12/07, e nenhum foi apagado por merge).

## §2 — A camada R49 ja aceita identidade sem lead. A leitura, nao.

Estrutura viva:

| objeto | dependencia de lead |
|---|---|
| `identidade_comercial` (`pessoa_id`, `created_at`, `status`) | **nenhuma** |
| `identidade_comercial_leads` | `lead_id` **NOT NULL**, FK → `leads_marketing` `ON DELETE RESTRICT` |
| `vw_pessoa_identidade` | **INNER JOIN** com `identidade_comercial_leads` e `leads_marketing` |

Ou seja:

- **armazenamento: SIM**, uma identidade pode existir hoje com zero leads. A
  tabela-pai nao tem nenhuma coluna de lead. (Hoje ha 0 identidades assim.)
- **leitura: NAO.** `vw_pessoa_identidade` faz INNER JOIN e **descartaria** essa
  identidade — ela existiria no banco e sumiria da view.
- **ligacao a `pessoas` (ERP): NAO EXISTE.** Nenhuma coluna liga
  `identidade_comercial` ao ERP.
- **ligacao a deal: NAO EXISTE.**

**Menor extensao necessaria: duas relacoes, nenhuma alteracao destrutiva.**
Nenhuma foi criada.

## §3 — Relacao com `pessoas` (ERP)

`pessoas` tem 1.754 linhas e **nenhuma coluna de lead** (verificado). Nao ha
ponte hoje.

A R49 ja gravou como comentario que `identidade_comercial.pessoa_id` **nao e**
`pessoas.id` — sao universos distintos e juntar por igualdade de id daria
resultado silenciosamente errado. Isso continua valendo.

Chave explicita proposta (nao criada): uma coluna nova
`identidade_comercial.erp_pessoa_id uuid REFERENCES pessoas(id)`, **nullable**,
com UNIQUE parcial para impedir duas identidades apontando para a mesma pessoa
do ERP. Nullable porque as 3 identidades da R49 nao tem contrapartida no ERP e
nao devem passar a ter por decreto.

## §4 — Tres desenhos comparados

| criterio | **A** criar leads artificiais | **B** identidade → `pessoas`, lead opcional | **C** fato `deal → identidade`, sem lead |
|---|---|---|---|
| fidelidade historica | **falsifica**: inventa aquisicao que nunca houve | preserva | **preserva** |
| impacto em CAC | **contamina**: 10 leads entram em coortes e em `vw_cac_por_segmento` | neutro | **neutro** |
| impacto em LTV | funciona, mas sobre base falsa | funciona | **funciona** (§10) |
| simplicidade | 1 tabela existente, 10 inserts | 1 coluna + 1 relacao | **1 relacao** |
| reversibilidade | **baixa**: lead deletado cascateia `pixel_events` | alta | **alta** (`DROP TABLE`) |
| compatibilidade ERP | indireta | **direta** | direta via identidade |
| compatibilidade MAPA/GPS | risco: leads novos entram em filas e disparos | neutro | **neutro** |
| exige mexer em `pixel_events` | sim | sim | **nao** |

**A esta descartado por §9**: um lead e registro de aquisicao. Criar 10 leads
cuja unica origem e uma importacao de ERP de 03/04/2026 e escrever aquisicao
inventada em jan-mar. E exatamente o que a R48 recusou fazer com T0.

**B e C convergem** no que falta: a relacao `deal → identidade`. B adiciona a
ponte com o ERP. A diferenca real e **onde a venda vive** — e o §5 decide isso.

## §5 — Purchase com `lead_id` NULL: os consumidores

34 views/MVs consomem `pixel_events` com `Purchase`. Classificacao por semantica
de SQL (INNER JOIN nunca casa com NULL; `lead_id IS NOT NULL` exclui):

| comportamento | n | exemplos |
|---|---:|---|
| **IGNORA_EVENTO (certo)** | **21** | `mv_qualidade_campanha`, `vw_cac_por_segmento`, `vw_clientes_recorrentes_chat`, `vw_performance_por_campanha`, `vw_midia_coorte_aquisicao_shadow`, os 4 scorecards `vw_org_*`, `vw_agente_metas_realizadas`, `vw_churn_recovery_atual`, `vw_fila_do_dia`… |
| **INDETERMINADO** | 2 | `vw_org_caio_fila_dia_auditoria`, `vw_org_isabela_leads_prioritarios` (tem LEFT e INNER; o regex nao decide qual carrega o lead) |
| **FUNCIONA** | 11 | `vw_venda_identidade`, `vw_dora_bcg`, `vw_dora_venda_produto`, `vw_conferencia_vendas_campanha`, `vw_fila_produtos_deal_won`… |
| **QUEBRA** | **0** | nenhuma view lanca erro |
| **ATRIBUI_ERRADO** | **0** | nenhuma atribui a lead errado |

Detalhe economico decisivo:

- **receita** — calculada como `sum(value)` direto na tabela: **subiria** R$7.109,64
- **compradores unicos / recompra / LTV** — calculados como
  `count(distinct lead_id)`: **NAO** contam NULL, entao o cliente **nao apareceria**
- **canonical deals** — `vw_venda_identidade` resolve por prefixo ∪ mapa, sem
  lead: **subiria** +12

**Resultado: receita e canonical deals sobem, comprador nao existe.** Os dois
lados param de reconciliar — e foi exatamente reconciliar esses dois lados que
sustentou as guardas das R44, R52 e R53.

## §6 — Triggers com `lead_id` NULL

Auditados os 15 triggers de `pixel_events`:

| trigger | com lead NULL |
|---|---|
| `pixel_events_normalize_nulls` | no-op (`IF NEW.lead_id IS NOT NULL`) — `state` e `content_category` ficam NULL |
| `fn_pixel_derivar_product_type` | deriva de `content_category`, que fica NULL → `product_type` NULL |
| `fn_cancelar_disparos_apos_compra` | no-op (`lead_id = NULL` nunca e TRUE) |
| `fn_trigger_feedback_purchase` | no-op |
| `fn_fechar_tasks_apos_compra` | no-op: `v_phone` vem NULL e as duas comparacoes falham |
| `fn_fechar_decisao_com_conversao` | no-op (exige lead) |
| `fn_trg_marcar_refresh` | no-op |
| `fn_vera_observar_eventos` | no-op (`if new.lead_id is null then return`) |
| `fn_debug_log_pixel_insert` | grava normalmente |
| `fn_lab_trigger_purchase` | desabilitado |
| **`prevent_pixel_event_duplicate`** | **ver abaixo — o unico problema real** |

### A protecao anti-duplicata falha em silencio

O dedup tem tres casos. O terceiro existe justamente para linha sem lead:

```sql
ELSE
  IF NEW.event_name = 'Purchase' AND EXISTS (
    SELECT 1 FROM pixel_events
    WHERE lead_id IS NULL AND visitor_id IS NULL
      AND event_name = NEW.event_name
      AND value = NEW.value
      AND state  = NEW.state          -- <<<
      AND event_time BETWEEN NEW.event_time - 2h AND + 2h
```

Mas `state` **deriva do lead** (`pixel_events_normalize_nulls`). Sem lead, `state`
fica NULL, e `state = NEW.state` vira `NULL = NULL`, que **nao e TRUE** —
confirmado no banco. O `EXISTS` nunca casa.

**Ou seja: a unica trava anti-duplicacao que cobriria esses eventos depende de um
campo que so existe quando ha lead.** Depois de 47 grupos de duplicacao tratados
nas R38–R53, introduzir linhas sem trava e um retrocesso direto.

(Nao e absoluto: 6.038 dos 8.987 eventos com `lead_id` NULL **tem** `state`,
gravado pelo proprio produtor. Um produtor que preenchesse `state`
explicitamente restauraria a protecao. Nenhum dos nossos 12 teria de onde tirar
UF confiavel.)

### Alguma rotina viva apagaria essas linhas?

| verificacao | resultado |
|---|---|
| funcoes com `DELETE FROM pixel_events` | **0** |
| `fn_sync_crm_pixel_remove` | **desarmada em 02/08**, corpo so faz `RETURN 0` |
| `fn_sync_crm_pixel_insert` | **esvaziada em 16/08**, so faz `RETURN 0` |
| crons tocando `pixel_events` | 3 `crm-pixel-sync` **inativos** + `rd-won-pixel-sync-diario` (so insere `rd_won_`) |

**Nenhum mecanismo vivo apagaria.** Mas isto e um "nao encontrei", nao um "nao
pode acontecer": a R40 nunca provou o mecanismo que sumiu com a populacao
historica, e a R43 mediu que hoje existem **0 Purchase com `lead_id` NULL** na
tabela inteira — a forma que sumiu e exatamente a que se propoe criar.

## §7 — Views canonicas

`vw_venda_identidade` **nao junta com `leads_marketing` e nao filtra por lead**.
Ela resolveria um Purchase sem lead normalmente: `deal_id` sai do prefixo do
`event_id` ou do `pixel_crm_sync_map`, e a coluna `lead_id` sairia NULL.

Ela ja e, portanto, a view mais preparada para o caso. O que falta nela nao e
tolerar lead nulo — e **saber de quem e a venda**. Menor fallback possivel, se
um dia a venda for representada:

```
lead_id  -> pessoa_id   (via identidade_comercial_leads, ja existe)
deal_id  -> pessoa_id   (via identidade_comercial_deals, NAO existe)
```

`COALESCE` entre os dois resolve, sem inventar lead. **Nao implementado.**

## §8 — `deal → identidade`: nao ha estrutura que ja resolva

Verificado: `pixel_crm_sync_map` liga deal a **evento**, nao a pessoa, e seu
`lead_id` e recibo (R39/R53). `propostas_rd` tem `lead_id` nulo em 24/24.
`pessoas` nao tem lead. `identidade_comercial_leads` exige lead.

**Nenhuma estrutura existente permite dizer "este deal pertence a esta pessoa".**
E a lacuna real. Forma minima proposta, **nao criada**:

```
identidade_comercial_deals
  pessoa_id   uuid  -> identidade_comercial(pessoa_id)
  deal_id     text  PK
  evidencia_tipo  text     -- 'erp_cpf_cnpj_telefone'
  evidencia_valor text
  confidence  text         -- provada | provavel | indeterminada
  validado_em timestamptz
  validado_por text
```

Mesmo formato da R49, mesma disciplina: uma linha por caso, provada a mao,
sem varredura automatica.

## §9 — Aquisicao: UNKNOWN, e por regra

Deal sem lead **nao tem aquisicao conhecida**. Para os 12:

`campaign_id`, `adset_id`, `ad_id`, `source`, `medium`, UTM e first-touch
permanecem **SEM_ATRIBUICAO**. As 24 linhas de `propostas_rd` tem UTM vazio, e
nao existe lead de onde copiar — o risco de transformar venda em aquisicao paga
e **zero por construcao**.

O cadastro do ERP prova **quem comprou**, nunca **por onde chegou**. E foi
importado em 03/04/2026, depois dos fatos.

## §10 — LTV e recompra sem lead: funcionam

Simulado apenas com `deal → pessoa`, sem lead nenhum:

| pessoa | deals | LTV | perfil |
|---|---:|---:|---|
| **Gabriela Anjos** | **3** | **R$2.939,50** | **RECOMPRA em 43 dias** |
| AUTERA AUDIO E VIDEO | 1 | 1.780,00 | compra unica |
| Evaldo de Melo Correa | 1 | 739,00 | compra unica |
| Mateus Rodrigues Amorim | 1 | 442,35 | compra unica |
| Guilherme França | 1 | 389,80 | compra unica |
| Bozzi Transportes | 1 | 389,40 | compra unica |
| Thiago Cardoso Couto | 1 | 219,88 | compra unica |
| Victória Homercher | 1 | 130,48 | compra unica |
| Marcos Protec | 1 | 59,23 | compra unica |
| Dudalippe Personaliados | 1 | 20,00 | compra unica |

Receita por cliente, frequencia, recompra e LTV **saem todos** da relacao
`deal → identidade`. **Nenhum depende de lead.** Hoje a Gabriela e uma cliente
de R$2.939,50 com recompra que o sistema simplesmente nao enxerga.

## §11 — Contrato ERP

```
ERP cliente (pessoas)
  └── identidade_comercial (1:1, via erp_pessoa_id)
        ├── 0..N leads    (identidade_comercial_leads)   -- aquisicao
        └── 1..N deals    (identidade_comercial_deals)   -- fato comercial
```

Cobre os tres casos sem falsificar nada:

| caso | leads | deals | exemplo real |
|---|---:|---:|---|
| cliente **sem lead** | **0** | 1..N | os 10 desta rodada |
| cliente com um lead | 1 | N | maioria da base |
| cliente com multiplos leads | 2 | N | Vanessa, Kleberson, Igreja (R49) |

E separa o que a base vinha misturando: **lead responde "por onde chegou",
deal responde "o que comprou"**. Um cliente pode ter o segundo sem o primeiro.

## §12 — Backfill simulado

Com o desenho C, **os 12 nao entram em `pixel_events`**. O candidato e:

```
identidade_comercial_deals
  pessoa_id  <nova identidade ancorada em pessoas.id>
  deal_id    <os 12>
  evidencia  'erp_cpf_cnpj + telefone + nome'
  confidence 'provada'
```

e o valor e a data continuam onde ja estao e ja sao verdade: `total_price` e
`closed_at` da RD, lidos ao vivo. **Nao ha o que copiar para lugar nenhum.**

Se, ao contrario, fossem para `pixel_events` com `lead_id` NULL:
`event_time` = `closed_at`, `value` = `total_price`, campanha NULL — validado
12/12 ao vivo. **Nao recomendado**, pelos §5 e §6.

**Nada inserido.**

## §13 — Auto-refutacao

- *Purchase sem lead desaparece?* Nenhum mecanismo vivo apaga — verificado em
  funcoes, triggers e crons. Mas **hoje ha 0 Purchase com lead nulo na tabela**,
  e a R43 mediu que essa e exatamente a forma que sumiu antes. Nao consigo
  provar que nao voltaria a sumir.
- *KPI ignora?* **Sim: 21 das 34 views descartam a linha**, entre elas CAC,
  coorte, campanha, recompra e os scorecards.
- *View exige lead?* A canonica (`vw_venda_identidade`) **nao** exige. As de
  cliente e campanha, sim.
- *Trigger quebra?* Nao — todos viram no-op. Mas **a trava anti-duplicata vira
  no-op junto**, e essa e a perda real.
- *Pessoa do ERP pode representar entidade errada?* Pode: `Marcos Protec
  Segurança Eletrônica` esta cadastrada com **CPF**, e `Junior - Bozzi
  transportes` virou **`Bozzi Transportes`** com CNPJ. Nome comercial e razao
  social nao coincidem, e por isso a evidencia usada e telefone + documento,
  nunca nome. Os dois seguem `provada` so porque o telefone bate.
- *Documento nao e confiavel?* `Dudalippe Personaliados` **nao tem documento** —
  so nome e telefone. E o mais fraco dos 12 e deve entrar como `provavel`, nao
  `provada`.
- *Criar `deal → pessoa` duplica informacao?* Nao: essa relacao **nao existe em
  lugar nenhum** hoje (§8).
- *Da para resolver sem mexer em `pixel_events`?* **Sim — e essa e a
  recomendacao.** O desenho C nao toca em `pixel_events`.
- *Criar lead seria mais correto em algum caso?* Sim, num: se a operacao
  **quiser** passar a atender esses clientes por WhatsApp, um lead novo e
  legitimo — mas ai ele nasce **hoje**, com `created_at` de hoje, e nao
  representa a venda de janeiro. Isso e cadastro novo, nao correcao historica.

## §14 — Veredito

**PRECISA_DEAL_IDENTIDADE**, e o caminho para chegar la e **PURCHASE_SEM_LEAD_INSEGURO**.

**Desenho recomendado: C.**

1. Uma coluna: `identidade_comercial.erp_pessoa_id` → `pessoas(id)`, nullable,
   com UNIQUE parcial.
2. Uma tabela: `identidade_comercial_deals` (`pessoa_id`, `deal_id`, evidencia,
   confidence, validacao).
3. `pixel_events` **nao muda**. Nenhum Purchase sem lead e criado.
4. A leitura economica de cliente passa a fazer `COALESCE` entre
   `lead → pessoa` e `deal → pessoa`.

O sistema passa a poder dizer exatamente a frase pedida: **"sei quem comprou,
sei quanto e quando, e nao tenho evidencia de aquisicao"** — sem inventar um
lead para isso.

Descartado: **A** (falsifica aquisicao) e **Purchase com `lead_id` NULL**
(receita sobe sem comprador, 21 views descartam, trava anti-duplicata morre).

## §15 — Proximo passo minimo

**R56, ainda READ-ONLY:** especificar o contrato de leitura antes de qualquer
DDL. Concretamente: qual view economica passa a usar `COALESCE(lead→pessoa,
deal→pessoa)`, o que acontece com `compradores unicos` e `repeat buyers` quando
10 clientes novos aparecem sem lead, e como cada scorecard `vw_org_*` deve se
comportar — porque hoje 21 deles nao enxergam a linha por construcao e
**mudar isso muda numero de gente**.

So depois disso, uma rodada de escrita com os gates de sempre.

Registrados, sem mudanca: os 12 SEM_EVIDENCIA (R$7.392,95); o T0 de 2025-08-22
da Vanessa/Alean; os pares suspeitos da Igreja e do Kleberson;
`fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa; `crm_deals_cache`
congelado desde 16/08.
