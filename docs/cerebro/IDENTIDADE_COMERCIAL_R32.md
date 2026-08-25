# R32 — Identidade comercial: fechando a camada antes de tocar nos produtores

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero deploy, zero
INSERT/UPDATE/DELETE, zero merge, zero correção das 41 vendas.

## VEREDITOS

### `PRECISA_CAMADA_IDENTIDADE_COMERCIAL` — mas mínima, não arquitetural
### `PROPOSTAS_RD_LEAD_ID_PARCIAL`

Dois resultados desta rodada empurram em direções opostas, e os dois importam:

**A escala do problema é muito menor do que eu supunha.** Apenas **70 identidades têm 2 leads
(0,4%)** e **nenhuma tem 3 ou mais**. Isso refuta a necessidade de uma arquitetura de identidade
de cliente — seria construir catedral para 0,4%.

**Mas `fn_merge_leads` — a solução aparentemente pronta — destrói exatamente o que o MAPA
precisa.** Ele faz `DELETE FROM leads_marketing` do lead duplicado, e **105 dos 159 merges já
executados (66%) não gravaram snapshot.** A origem de aquisição desses leads foi apagada sem
registro.

---

## 1. CONTAMINAÇÃO DE `propostas_rd.lead_id`

Comparando o telefone do `deal_nome` com o telefone do lead atribuído, separado por
compartilhamento de contato:

| grupo | propostas | `won` | corretos | **prov. errados** | valor `won` errado |
|---|---|---|---|---|---|
| **contato COMPARTILHADO** | 80 | 59 | 65 (81,3%) | **15 (18,8%)** | **R$ 2.323,65** |
| contato único ou nulo | 11.831 | 934 | 9.617 | **29 (0,3%)** | R$ 1.142,14 |
| **total avaliável** | 9.726 | | | **44 (0,45%)** | **R$ 3.465,79** |

Classificação:

| classe | n |
|---|---|
| **CORRETO** | 9.682 |
| **PROVAVELMENTE_ERRADO** | **44** |
| NAO_AVALIAVEL (sem telefone em algum lado) | 15 |
| sem lead atribuído | 2.170 |

**`propostas_rd.lead_id` erra em 0,45% — e o erro se concentra 62× mais onde o contato é
compartilhado (18,8% contra 0,3%).**

Isso é melhor do que eu temia na R31, e valida a hierarquia proposta lá: **`propostas_rd.lead_id`
é usável como evidência, desde que se exclua os casos de `contact_rdstation_id` compartilhado.**

## 2. ESCALA DAS IDENTIDADES COM N LEADS

Agrupando os 16.000 leads pela chave DDD + últimos 8 dígitos:

| | identidades | leads |
|---|---|---|
| **1 lead** | **15.855 (99,6%)** | 15.855 |
| **2 leads** | **70 (0,4%)** | 140 |
| **3 ou mais** | **0** | 0 |

Dos 70 pares: 39 com o mesmo nome, 29 com nomes diferentes, gap médio de **10,2 dias** entre a
criação dos dois.

Leads com telefone inutilizável (< 10 dígitos): **5**, com **2 compras** no total — um deles é o
fragmento do Kleberson. Não são chaveáveis e ficam fora dessa contagem.

**Escala total do problema de identidade: ~75 casos em 16.000 leads (0,47%).**

**A hipótese "uma identidade comercial pode ter N leads" é verdadeira — mas N nunca passa de 2, e
só em 0,4% dos casos.** Isso não sustenta uma camada arquitetural nova.

## 3. SEMÂNTICA — validada com uma ressalva

| conceito | definição | validado? |
|---|---|---|
| **IDENTIDADE COMERCIAL** | pessoa ou empresa real que compra | **sim**, mas quase sempre 1:1 com lead |
| **LEAD** | registro de aquisição/conversa referente a essa identidade | **sim** |
| **DEAL** | negócio pertencente à identidade | **sim** — `deal_id` já é terminal e estável (R29) |

A ressalva importa: **a identidade não é sempre a mesma pessoa.** Dos 70 pares, **29 têm nomes
diferentes** — telefone compartilhado por empresa ou família é uma explicação tão plausível
quanto duplicata. Tratá-los todos como "mesma pessoa" seria fundir clientes distintos.

## 4. AUDITORIA DE `fn_merge_leads` — o achado que decide a rodada

O que ele faz: repointa **~40 tabelas** de `duplicado` → `canônico` (conversas, propostas,
`pixel_events`, `pixel_crm_sync_map`, tasks, scores, memórias, orçamentos, logs), grava em
`lead_merge_log` e então:

```sql
DELETE FROM leads_marketing WHERE lead_id = p_duplicado_id;
```

**`leads_marketing` é onde moram `utm_campaign_id`, `utm_source`, `utm_medium`, `utm_ad_id`,
`content_category` e o `created_at` que serve de T0 de aquisição.** O merge apaga a origem do
lead duplicado.

### Resposta à pergunta crítica: NÃO, o merge não preserva múltiplas origens

Dos 70 pares:

| situação | pares | efeito do merge |
|---|---|---|
| ambos sem campanha | 34 (49%) | inócuo |
| só um tem campanha | 20 (29%) | **destrói se o duplicado for o que tem** |
| **campanhas DIFERENTES** | **13 (19%)** | **destrói uma origem de aquisição** |
| mesma campanha nos dois | 3 | inócuo |

**Em 19% dos casos, o cenário que você levantou é real: lead A veio de uma campanha, lead B de
outra, e fundir apaga uma das duas.**

### E já aconteceu — 159 vezes

| | |
|---|---|
| merges executados | **159** (2026-05-11 a 2026-05-25) |
| **com `snapshot_duplicado`** | **54 (34%)** |
| **SEM snapshot — origem destruída sem registro** | **105 (66%)** |
| dos 54 com snapshot, tinham campanha | 52 |
| marcados `flag_revisao` | 53 |

**105 leads foram deletados sem qualquer registro de sua origem de aquisição.** Isso é perda
irreversível.

Os motivos registrados são informativos e honestos — e um deles muda a leitura dos dois casos da
R30/R31:

> *"Troca de telefone: empresa Aleanuniformes (mesmo CNPJ 72460561000184, mesmo email)
> consolidando do telefone antigo 5541998207823 para o novo 554195338939."*

**A Vanessa/Aleanuniformes não é duplicata por erro — é troca de telefone real, com CNPJ e
e-mail confirmando.** E o Kleberson já foi mergeado uma vez, consolidando 18 compras.

**Veredito sobre o merge: não usar como canonicalização econômica.** Serve para limpeza
operacional (unificar conversas, tasks, atendimento). Não serve para verdade de aquisição,
porque destrói a linha que carrega a origem.

## 5. REGRA DO RESOLVER DE NOVO DEAL

```
resolver(deal) → RESOLVIDO | AMBIGUO | SEM_IDENTIDADE

1. telefone do deal_nome → chave DDD+8
2. leads com essa chave:
     exatamente 1                      → RESOLVIDO (evidencia: telefone_deal)
     2+, e são a MESMA identidade      → RESOLVIDO no lead_ativo (§7), evidência registrada
     2+, e são identidades DIFERENTES  → AMBIGUO
     0                                 → passo 3
3. propostas_rd.lead_id, se preenchido
     E o contact_rdstation_id NÃO for compartilhado   → RESOLVIDO (evidencia: proposta)
     senão                                            → passo 4
4. e-mail exato do deal → leads_marketing.em
     exatamente 1                      → RESOLVIDO (evidencia: email)
5. contact_rdstation_id / deal_rdstation_id
     SOMENTE se mapear para exatamente 1 lead → RESOLVIDO (evidencia: rd_id_unico)
     senão                                    → AMBIGUO
6. nada resolveu                       → SEM_IDENTIDADE
```

**`AMBIGUO` e `SEM_IDENTIDADE` não inserem evento.** Vão para fila de revisão. O custo de não
registrar uma venda é recuperável; o de registrá-la no cliente errado não é.

**`lead_ativo`** (passo 2, caso de 2 leads da mesma identidade): o lead com **mais conversas**,
desempate por `created_at` mais antigo. Kleberson (4.000 conversas contra 0) e Vanessa (2.097
contra 0) mostram que o critério é inequívoco onde importa — e é o oposto do que a regra do
telefone puro escolheria (R31 §8).

## 6. O PAPEL DE `lead_identificadores`

Hoje ele serve a dois papéis incompatíveis. Os dados decidem a separação:

| papel | veredito |
|---|---|
| **B. índice/resolver operacional** | **não pode** — sem `UNIQUE` em `contact_rdstation_id` nem em `deal_rdstation_id`; 37 e 29 compartilhados |
| **A. evidência de identidade** | **sim, e é útil** — nos 5 casos "mesmo nome, telefones diferentes" é a única pista |

**Resposta: `contact_rdstation_id` e `deal_rdstation_id` não devem resolver lead diretamente.
Só podem confirmar uma identidade já resolvida por outra evidência, ou resolver quando o
mapeamento for comprovadamente 1:1** — e isso precisa ser verificado em tempo de consulta, não
assumido.

## 7. CLASSIFICAÇÃO DOS 41 CASOS HISTÓRICOS

Aplicando a regra do §5:

| classe | n | valor | por quê |
|---|---|---|---|
| **CORRIGIVEL_AUTOMATICAMENTE** | **38** | R$ 12.075,70 | telefone do `deal_nome` resolve para 1 lead único |
| **PRECISA_IDENTIDADE_COMERCIAL** | **3** | R$ 843,75 | Vanessa (2) e Kleberson (1): 2 leads da mesma identidade |
| PRECISA_MERGE | 0 | — | nenhum exige merge para ser corrigido |
| AMBIGUO | 0 | — | — |

**Os 38 do primeiro grupo não precisam de nenhuma camada nova.** Basta o resolver correto.

## 8. CLASSIFICAÇÃO DOS 23 GRUPOS DUPLICADOS

Não simulei `fn_merge_leads(dry_run)` — e explico por quê: o dry-run **conta linhas**, não avalia
perda de origem. A avaliação que importa é a do §4, e ela já foi feita sobre os 70 pares:

| classe | pares | critério |
|---|---|---|
| **MERGE_SEGURO** | **34** | ambos sem campanha — nada de origem a perder |
| **PRECISA_REVISAO** | **20** | só um tem campanha; seguro **se** o canônico for o que a tem |
| **NAO_MERGIR** | **13** | campanhas diferentes — merge apaga uma origem de aquisição |
| **NAO_MERGIR (identidades distintas)** | **29 dos 70** | nomes diferentes: pode ser telefone compartilhado, não duplicata |

Os grupos se sobrepõem; a regra que vale é a mais restritiva. **Nenhum merge deve ser executado
sem `snapshot_duplicado` gravado** — 66% dos 159 anteriores não têm.

## 9. CONTRATO DO MAPA ECONÔMICO

| conceito | pertence a | por quê |
|---|---|---|
| **AQUISIÇÃO** | **LEAD** | o T0, a campanha e o `content_category` são propriedades do registro de aquisição. Fundir leads apaga isso |
| **CLIENTE** | **IDENTIDADE COMERCIAL** | quem compra |
| **DEAL / COMPRA** | identidade, via `deal_id` | `deal_id` é o fato; a identidade é o dono |
| **RECOMPRA** | **IDENTIDADE COMERCIAL** | **confirmado** — Kleberson tem 18 compras em um lead e 2 em outro. Contar por lead subestima |
| **LTV** | **IDENTIDADE COMERCIAL** | consequência direta da linha acima |
| **CAC** | **LEAD** (a aquisição) ÷ identidades novas | o custo é de adquirir o contato; o resultado é do cliente |

**A regra central da sua pergunta está validada: recompra pertence à identidade comercial, não
ao registro que recebeu a última UTM.** Kleberson prova: sem consolidar, ele aparece como dois
clientes, um com 18 compras e outro com 2.

**Mas a consequência não é fundir leads — é agregar na leitura.** Fundir resolve a recompra e
destrói a aquisição. Agregar resolve as duas.

Impacto quantificado: com 70 pares em 492 compradores, consolidar afeta no máximo ~14% dos
compradores e move a taxa de recompra para cima, não para baixo.

## 10. CONTRATO FUTURO DO ERP

A R26 propôs `cliente_id (ERP) ↔ lead_id`, imutável.

**Validado que isso herdaria o defeito** — Kleberson e Vanessa têm dois `lead_id` cada. Mas a
correção é menor do que a R31 sugeriu:

```
ERP cliente_id  ↔  identidade_comercial  →  1..2 leads
```

Implicação mínima, e só ela: **a ponte precisa aceitar cardinalidade 1:N, não 1:1.** Não exige
tabela de cliente hoje — exige que a chave estrangeira não seja declarada como única do lado do
lead, e que o join de leitura agregue.

**Não desenho o ERP.** Aponto que uma ponte 1:1 quebraria em 0,4% dos clientes — e esses 0,4%
incluem clientes de R$ 11.477 e R$ 9.621, que estão entre os maiores da base.

## 11. PATCH MÍNIMO DESENHADO

| alvo | mudança |
|---|---|
| **`rd-won-pixel-sync`** | trocar a resolução por `lead_identificadores` pela regra do §5. Em `AMBIGUO`/`SEM_IDENTIDADE`: **não inserir**, registrar em fila |
| **`fn_linkar_propostas_leads`** | adicionar `AND (select count(*) from lead_identificadores li2 where li2.contact_rdstation_id = pr.contact_rdstation_id) = 1` — o `UPDATE…FROM` passa a ignorar contatos compartilhados |
| `fn_joao_lost_classificar`, `fn_contexto_crm_etapa_base_v1` | mesma guarda de unicidade antes do `LIMIT 1` |
| `fn_merge_leads` | **tornar `snapshot_duplicado` obrigatório** — falhar se não conseguir gravá-lo |
| todos | gravar a **evidência usada** (`telefone_deal`, `proposta`, `email`, `rd_id_unico`) junto com o `lead_id` resolvido |

Nenhuma tabela nova. Nenhuma coluna nova em `pixel_events` além do `deal_id` já desenhado na R29.

## 12. ORDEM DE IMPLEMENTAÇÃO — validada com duas correções

| # | passo | veredito |
|---|---|---|
| 1 | corrigir resolvers | **confirmado — é a torneira** |
| 2 | impedir nova atribuição não determinística | **funde com o 1** — é a mesma mudança de código, não dois passos |
| 3 | tratar leads duplicados quando seguro | **mover para o fim, e opcional** — só 34 dos 70 são seguros, e nada depende disso |
| 4 | corrigir 41 vendas históricas | confirmado, **depois** do 1 |
| 5 | resolver 44 duplicações econômicas | confirmado |
| 6–11 | `deal_id` → backfill → unique → produtores → paginação → 118 legítimos | confirmado (R29/R31) |

**Correção 1:** os passos 1 e 2 são o mesmo trabalho. Separá-los sugere duas janelas de deploy
onde há uma.

**Correção 2:** o passo 3 (merge) **não é pré-requisito de nada** e destrói origem em 19% dos
casos. Deve sair do caminho crítico — e talvez nunca ser executado, se a agregação na leitura
(§9) resolver a recompra sem apagar a aquisição.

## 13. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| **Telefone compartilhado por empresa?** | **Sim — 29 dos 70 pares têm nomes diferentes.** Por isso o passo 2 do resolver separa "mesma identidade" de "identidades diferentes", e a segunda vira `AMBIGUO` |
| **Mesma pessoa com vários números?** | **Sim, e está documentado**: o merge da Aleanuniformes registra troca de `5541998207823` para `554195338939`, confirmada por CNPJ e e-mail. O telefone **não** é identidade permanente |
| **Lead novo pode ser aquisição legítima nova?** | **Sim** — gap médio de 10,2 dias entre os pares é curto, mas 13 pares têm campanhas diferentes. Tratar como duplicata apagaria uma aquisição real |
| **Merge apaga origem histórica?** | **Sim, provado**: `DELETE FROM leads_marketing`, e 105 de 159 sem snapshot |
| **Recompra pertence ao cliente?** | **Sim, confirmado** (§9). Kleberson: 18 + 2 compras em dois leads |
| **Empresa B2B com vários compradores?** | Não observável — não há CNPJ em `leads_marketing`. Só em `lead_identificadores.cpf_cnpj` e no CalcMe. **Lacuna aberta** |
| **Identidade pessoa ≠ empresa?** | Não modelado em lugar nenhum. Os nomes misturam pessoas ("João Galdino") e empresas ("Beats Estamparia") no mesmo campo |
| **Telefone do `deal_nome` pode estar desatualizado?** | **Sim** — é o telefone no momento da criação do deal. Para deals antigos de um cliente que trocou de número, aponta para o lead antigo. Nesse caso aponta para o lead **certo à época**, o que é defensável |
| **Contato RD pode voltar a ser confiável se único?** | **Sim, e é o passo 5 do resolver.** Não o elimino — condiciono |
| **A escala de 0,4% justifica alguma mudança?** | Para o merge, **não**. Para o resolver, **sim** — o erro do resolver é 11,9%, não 0,4% |
| **E se a chave DDD+8 estiver subestimando os duplicados?** | **Está**: o fragmento do Kleberson tem telefone de 9 dígitos e não entra na contagem. São 5 leads assim, com 2 compras. Subestimação conhecida e pequena |

## 14. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é a mesma da R31, agora com o desenho fechado: **corrigir o resolver do
`rd-won-pixel-sync` e a guarda de unicidade do `fn_linkar_propostas_leads`, no mesmo deploy.**

O que esta rodada acrescenta é o que **não** fazer junto:

- **Não executar merges.** Não são pré-requisito de nada, destroem origem em 19% dos casos, e
  66% dos 159 já feitos não têm snapshot. A recompra pode ser resolvida agregando na leitura,
  sem apagar aquisição.
- **Não construir camada de identidade comercial.** 70 pares, nenhum com 3+ leads. Uma tabela
  nova para 0,4% seria o erro que `calcme_itens_pedido` monumentaliza.
- **Não usar telefone puro como identidade.** Ele resolve *quem o RD registrou*, e a
  Aleanuniformes prova que o número muda.

E uma lacuna que esta rodada abriu e não fechou: **não existe CNPJ em `leads_marketing`.** Ele
existe em `lead_identificadores.cpf_cnpj` e no CalcMe. Para uma empresa que vende B2B — onde
"Beats Estamparia" e "Aleanuniformes" são clientes — documento é a única identidade que não muda
com o telefone. Vale medir a cobertura antes de decidir se a identidade comercial precisa dele.
