# R57 — materializar as identidades comerciais provadas sem lead

Executada em 2026-08-26. **7 identidades criadas, 9 deals vinculados,
R$5.250,41. Zero lead criado, zero Purchase escrito, zero view economica
alterada.**

## Veredito

**DEAL_IDENTIDADE_IMPLEMENTADO**

| pergunta | resposta |
|---|---|
| identidades novas criadas | **7** |
| identidades existentes reutilizadas | **0** (nenhuma das 7 pessoas ja tinha) |
| deals vinculados | **9** |
| valor | **R$5.250,41** |
| casos retirados por gate | **0** |
| `pixel_events` alterado? | **NAO** |
| leads criados? | **NAO** |
| views economicas alteradas? | **NAO** |

## §0 — Reancoragem

| bloco | deals | valor | autorizado |
|---|---:|---:|:--:|
| **PESSOA_PROVADA** | **9** (7 pessoas) | **R$5.250,41** | **sim** |
| PESSOA_PROVAVEL | 3 | R$1.859,23 | nao |
| SEM_EVIDENCIA | 12 | R$7.392,95 | nao |

RD ao vivo, `GET api.rd.services/crm/v2/deals/<id>` um por deal:
**9/9 HTTP 200 · won · pipeline de vendas · `total_price` estavel · `closed_at`
presente · 0 ja representados.** Sem deriva desde a R56.

## §1 — Nenhuma das 7 ja tinha identidade

| pessoa | leads por telefone | ja em identidade | doc unico no ERP | tel unico no ERP | classe |
|---|---:|---:|:--:|:--:|---|
| Gabriela Anjos | 0 | 0 | sim | sim | **NOVA_IDENTIDADE_NECESSARIA** |
| Evaldo de Melo Correa | 0 | 0 | sim | sim | NOVA |
| Mateus Rodrigues Amorim | 0 | 0 | sim | sim | NOVA |
| Guilherme França | 0 | 0 | sim | sim | NOVA |
| Bozzi Transportes | 0 | 0 | sim | sim | NOVA |
| Thiago Cardoso Couto | 0 | 0 | sim | sim | NOVA |
| Victória Homercher | 0 | 0 | sim | sim | NOVA |

**CONFLITO = 0 · INDETERMINADO = 0.** Nenhuma pessoa ERP compartilha documento
ou telefone com outra — as 7 sao 7 pessoas distintas, nao 7 registros da mesma.
Busca tambem por `lead_identificadores.cpf_cnpj`: **0**.

Nenhum `pessoa_id` duplicado foi criado para pessoa que ja existia.

## §2/§3 — Invariante preservada

`identidade_comercial.pessoa_id` continua sendo **a identidade logica soberana**.
Lead e deal sao **dois caminhos independentes** ate ela:

```
lead  -> identidade_comercial_leads -> pessoa_id
deal  -> identidade_comercial_deals -> pessoa_id
```

`pessoas.id` (ERP) **nao virou** conceito soberano: entrou como
`erp_pessoa_id`, coluna de **evidencia** dentro do vinculo, com a confianca
daquele vinculo. Esta escrito em `comment on column`:

> *"E EVIDENCIA desta linha, com a confianca desta linha — nao e a identidade.
> `pessoas.id` NUNCA e igual a `identidade_comercial.pessoa_id`."*

## §4/§5 — DDL minimo

```sql
identidade_comercial_deals
  pessoa_id       uuid NOT NULL -> identidade_comercial(pessoa_id) ON DELETE RESTRICT
  deal_id         text NOT NULL
  erp_pessoa_id   uuid          -> pessoas(id)                     ON DELETE RESTRICT
  evidencia_tipo  text NOT NULL
  evidencia_valor text NOT NULL
  confidence      text NOT NULL CHECK (provada|provavel|indeterminada)
  validado_em     timestamptz NOT NULL
  validado_por    text NOT NULL
  valid_from      timestamptz NOT NULL
  valid_to        timestamptz
  PRIMARY KEY (pessoa_id, deal_id, valid_from)
  CHECK (valid_to IS NULL OR valid_to > valid_from)

-- um deal ativo -> no maximo UMA identidade
CREATE UNIQUE INDEX ... ON (deal_id) WHERE valid_to IS NULL;
```

Cardinalidades garantidas:

- **um deal ativo → no maximo uma identidade**: indice unico parcial.
- **uma identidade → N deals**: PK composta permite.
- **uma pessoa ERP → duas identidades ativas**: nao ha constraint que impeca no
  banco, entao virou **guarda de abort na transacao** (`0` medido). Registrado
  como divida: um indice unico parcial em `erp_pessoa_id` so seria correto se a
  regra "uma pessoa ERP = uma identidade" for sempre verdadeira, e isso ainda
  nao esta provado para a base inteira.

FKs `ON DELETE RESTRICT`, sem cascata destrutiva. Zero coluna ornamental.

### Uma coluna que decidi NAO criar

O item §6 pedia registrar que a origem da identidade e `ERP + DEAL_PROVADO`.
**Nao criei coluna `origem`**: ela e integralmente derivavel — identidade com
zero vinculos de lead abertos e ≥1 vinculo de deal **e**, por construcao,
originada de ERP+deal. E uma coluna armazenada ficaria **errada** no dia em que
um lead historico aparecer e for vinculado. Derivar acompanha a verdade; gravar
congela uma foto.

## §6/§7 — O que foi escrito

**7 linhas-pai** em `identidade_comercial` (so `pessoa_id`, `created_at`,
`status='ativa'`). **Nenhum vinculo com lead**, porque nao existe lead historico.

**9 linhas** em `identidade_comercial_deals`, todas `confidence='provada'`,
todas com `erp_pessoa_id` preenchido.

Os 3 PROVAVEL (**Autera R$1.780,00, Marcos Protec R$59,23, Dudalippe
R$20,00**) **nao entraram** — guarda de abort explicita conferiu `0`.

## §8 — Cadeia de evidencia de cada vinculo

`evidencia_tipo` = `telefone_deal_nome + documento_erp + nome` nos 9.
`evidencia_valor` grava a cadeia concreta, por exemplo:

```
chave 1161705746 = ERP +5511961705746 | doc 414.974.548-08
```

Ou seja: o telefone extraido do **nome do deal na RD** casa com o telefone do
**ERP**, e o ERP carrega **documento**. Tres atributos independentes.

**Nome sozinho: nunca.** Guarda `vinculo_so_por_nome = 0`. E a resolucao
pessoa↔ERP no INSERT foi feita **por documento**, nao por nome — se algum
documento nao casasse, a transacao abortaria (`7` exigidos, `7` obtidos).

## §9 — Contradicao lead × deal

Guarda na transacao: todo deal que tenha identidade por lead **e** por deal
precisa apontar para a mesma `pessoa_id`.

**Resultado: 0 contradicoes.** (Esperado: os 9 nao tem Purchase nenhum, entao
nao ha caminho por lead. A guarda fica valendo para o futuro.)

## §10 — View de teste isolada

Criada `vw_teste_resolucao_identidade` — **nova, isolada, nenhuma das 34 tocada**.

| `status_resolucao` | linhas | receita |
|---|---:|---:|
| SEM_IDENTIDADE | 1.548 | R$613.002,93 |
| SOMENTE_LEAD | 51 | R$26.906,10 |
| **SOMENTE_DEAL** | **9** | *sem `value` — nao estao em `pixel_events`* |
| AMBAS_IGUAIS | 0 | — |
| **CONTRADICAO** | **0** | — |

O `SOMENTE_DEAL` sem `value` **e o comportamento correto**: essas vendas nao
foram escritas em `pixel_events`. O valor continua na RD, que e a fonte.

**Nao ha `COALESCE` silencioso**: quando lead e deal discordam, a view devolve
`pessoa_id_resolvida = NULL` e `status_resolucao = 'CONTRADICAO'`. A divergencia
aparece, nao e escolhida.

## §11 — Aquisicao permanece UNKNOWN

A view expoe `status_aquisicao`, separado de `status_resolucao`.
**9/9 = `AQUISICAO_DESCONHECIDA`.**

Criar identidade comercial **nao criou aquisicao retroativa**: nenhum
`campaign_id`, nenhuma UTM, nenhum first-touch, nenhum CAC imputado. O ERP
provou **quem comprou**, nunca **por onde chegou**.

## §12 — Simulacao economica, recalculada ao vivo

| metrica | antes | com os 9 | delta |
|---|---:|---:|---:|
| receita comercial | 639.909,03 | **645.159,44** | **+5.250,41** |
| **receita atribuivel** | 74.744,86 | **74.744,86** | **0** |
| receita nao atribuida | 565.164,17 | 570.414,58 | +5.250,41 |
| canonical deals | 1.400 | **1.409** | **+9** |
| clientes por identidade | 502 | **509** | **+7** |
| repeat buyers | 215 | **216** | +1 (Gabriela) |

Bate exatamente com a R56. **Receita atribuivel: delta zero**, como previsto.

Nota: nenhum consumidor atual enxerga esses numeros ainda — a camada existe, a
leitura muda na R58.

## §13 — Gabriela, o canario

| prova | resultado |
|---|---|
| deals resolvendo para ela | **3** |
| identidades distintas para os 3 deals | **1** |
| receita reconstruida | **R$2.939,50** |
| intervalo de recompra | 10/02 → 25/03 = **43 dias** |
| leads artificiais criados | **0** |

Os tres deals (`69a70498`, `698b9095`, `69c2efe7`) resolvem para **uma unica**
`pessoa_id`. Numero de deals, receita e intervalo de recompra saem inteiros da
camada, sem nenhum lead.

## §14 — Preservacao

| item | resultado |
|---|---|
| **hash das definicoes das 34 views** | **inalterado** (guarda em transacao) |
| `pixel_events` (contagem + soma) | **inalterado** |
| Purchase | **1.599**, R$639.909,03 — inalterado |
| `leads_marketing` | **inalterado dentro da transacao** |
| vinculos R49 | **6 vinculos / 3 pessoas — preservados** |
| identidades totais | 3 → **10** (3 da R49 + 7 novas) |

Sobre `leads_marketing`: o total absoluto subiu de 16.031 (R52) para 16.039,
por **leads inbound organicos** que chegaram durante o dia. A prova de que **eu
nao criei nenhum** e a guarda **dentro da transacao**, que comparou antes/depois
no mesmo instante e exigiu igualdade — exatamente a disciplina de delta que a
R52 estabeleceu depois de eu ter errado isso na R35 e na R38.

## §15 — Ensaio revertido

Cirurgia completa executada e abortada por `raise exception` antes do commit:

```
identidades 7 · vinculos 9 · purchase 1599->1599 · leads 16038->16038
r49 6/3 -> 6/3 · views_hash_igual true · pixel_hash_igual true
Gabriela 3 deals / 1 identidade
```

## §16 — Rollback

`public._r57_rollback` (9 linhas: `nome`, `doc`, `erp_pessoa_id`, `pessoa_id`,
`deal_id`, `congelado_em`).

```sql
begin;
-- 1) remover os vinculos criados
delete from identidade_comercial_deals d
 using public._r57_rollback r
 where d.pessoa_id = r.pessoa_id and d.deal_id = r.deal_id;   -- esperar 9

-- 2) remover SOMENTE identidades-pai novas que ficaram sem qualquer vinculo
delete from identidade_comercial ic
 where ic.pessoa_id in (select distinct pessoa_id from public._r57_rollback)
   and not exists (select 1 from identidade_comercial_leads l where l.pessoa_id = ic.pessoa_id)
   and not exists (select 1 from identidade_comercial_deals d where d.pessoa_id = ic.pessoa_id);  -- esperar 7
commit;

-- opcional: drop view public.vw_teste_resolucao_identidade;
--           drop table public.identidade_comercial_deals;
```

As 3 identidades da R49 **nao sao alcancadas** por nenhum passo: o filtro usa
apenas `pessoa_id` presentes em `_r57_rollback`. A ordem importa — vinculos
primeiro, por causa do `RESTRICT`.

## §17 — Auto-refutacao

| tentativa de refutar | resultado |
|---|---|
| alguma das 7 ja tinha identidade? | **nao** — 0 leads por telefone, 0 em `identidade_comercial_leads`, 0 por documento |
| duas pessoas ERP sao a mesma? | **nao** — documento unico em 7/7, telefone unico em 7/7 |
| documento reciclado/incorreto? | cada documento retorna exatamente 1 linha no ERP; a resolucao do INSERT foi **por documento** e exigiu 7/7 |
| algum dos 9 depende so de nome? | **0** — guarda `vinculo_so_por_nome = 0`; e os 3 casos que dependiam de nome sao justamente os PROVAVEL, que ficaram de fora |
| algum deal aponta para identidade diferente via lead? | **0 contradicoes** |
| `deal_id` nao e estavel? | os 9 responderam 200 na RD com o mesmo id usado desde a R43 |
| a camada nova duplica estrutura existente? | **nao** — a R55 verificou que `pixel_crm_sync_map` liga deal a **evento**, `propostas_rd` tem `lead_id` nulo em 24/24 e `pessoas` nao tem lead |
| estamos transformando ERP em fonte de aquisicao? | **nao** — 9/9 `AQUISICAO_DESCONHECIDA`, zero campanha, zero UTM |
| Gabriela vira duas pessoas? | **nao** — 3 deals, **1** `pessoa_id` |

Nenhuma refutacao sobreviveu. Nenhum caso retirado.

## Nada anterior foi desfeito

R35: **37/37** · R44: **17/17** · R49: **6 vinculos / 3 pessoas** ·
R52: **8/8** · R53: duplicacao **0** · `pixel_events` intacto.

## §18 — Proximo passo

**R58 — escolher UMA primeira leitura economica** para consumir
`deal → identidade`, com canario antes de expandir.

Nao expandir para as 34. A recomendacao de candidata, a ser decidida na R58 e
nao aqui: uma view de **cliente** (recompra/LTV), porque e onde o erro ja e
mensuravel hoje — **504 clientes por lead contra 502 por identidade** — e onde
os +7 aparecem com significado.

Registrados, sem mudanca: os 3 PROVAVEL (R$1.859,23); os 12 SEM_EVIDENCIA
(R$7.392,95); as 2 views indeterminadas da R56; a divida do indice unico em
`erp_pessoa_id`; o `lead_t0` de 2025-08-22 da Vanessa/Alean; os pares suspeitos
da Igreja e do Kleberson; `fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa;
`crm_deals_cache` congelado desde 16/08.
