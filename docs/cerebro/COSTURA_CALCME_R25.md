# R25 — Costura CalcMe × Cérebro: identidade de compra é recuperável?

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY

**Prova de não-escrita:** `pg_current_xact_id_if_assigned()` = `NULL`. Zero deploy, zero DDL,
zero tabela nova, zero update, zero alteração no shadow.

## VEREDITOS

### Identidade: `MATCH_INSUFICIENTE`
### Atribuição: `ATRIBUICAO_CONTINUA_FRACA`

E um terceiro achado que não estava nas opções e é o mais importante da rodada: **a costura, se
usada para atribuição, não seria apenas fraca — seria ativamente corruptora.** 99,4% da receita
que ela recupera pertence a clientes que **já compravam antes de o lead existir**.

---

## 1. FONTES E IDENTIFICADORES

| tabela | linhas | identificadores | observação |
|---|---|---|---|
| `calcme_pedidos` | **3.730** | `ID_Cliente`, `Cliente` (nome), `Contato` | `Origem` **100% NULL** |
| `clientes_calcme` | **241** | `Id`, `Nome`, `Email`, `Cnpj`, `Cpf`, `Telefone_1/2`, `telefone_canonico` | snapshot único |
| `calcme_itens_pedido` | **0** | — | schema de custo existe, **sem dado** |
| `_staging_clientes_calcme` | **0** | — | vazia |
| `leads_marketing` | 15.993 | `lead_id`, `ph`, `em`, `fullname`, `external_id` | `ph` é chave única de fato |
| `pixel_events` | 1.561 Purchase | `lead_id`, `visitor_id` | já ligada a leads |
| `fact_conversations` | 270.247 | `lead_id`, telefone | começa em 2026-03-30 |

### A hipótese morre na primeira medição

> `clientes_calcme.telefone_canonico` pode ligar CalcMe a `leads_marketing`.

**`telefone_canonico` é NULL em 241 de 241 linhas. A coluna existe e está inteiramente vazia.**

E o problema maior está atrás dela: `calcme_pedidos` tem **1.135 `ID_Cliente` distintos**, mas
`clientes_calcme` tem **241 linhas**, das quais **109 aparecem nos pedidos**.

**A tabela de clientes cobre 9,6% dos clientes que têm pedido.**

`atualizado_em` é `2026-05-18` em **todas** as 241 linhas: um export parcial, tirado uma vez e
nunca reprocessado. Não é o cadastro do CalcMe — é uma amostra dele.

O caminho alternativo por pedido também não existe: `calcme_pedidos.Contato` está preenchido em
**7 de 3.730 linhas (0,19%)**.

### Teto antes de qualquer matching

| filtro | pedidos | clientes | receita | % receita |
|---|---|---|---|---|
| **todo o CalcMe** | 3.730 | 1.135 | **R$ 1.885.528,94** | 100% |
| cliente existe em `clientes_calcme` | 395 | 109 | R$ 186.894,11 | 9,9% |
| **+ tem `Telefone_1` com ≥10 dígitos** | **268** | **85** | **R$ 135.320,61** | **7,2%** |

**O teto máximo teórico da costura por telefone é 7,2% da receita — antes de testar se algum
desses telefones existe entre os leads.**

### Qualidade dos identificadores

| medida | valor |
|---|---|
| `clientes_calcme` tipo `Cliente` | 220 (21 são Fornecedor/Parceiro) |
| com telefone utilizável | **153 (69,5%)** |
| telefone ausente ou inválido | **67 (30,5%)** |
| chaves distintas entre clientes | 152 → **1 telefone para 2 clientes** |
| leads com telefone utilizável | 15.988 de 15.993 |
| chaves distintas entre leads | 15.918 → **70 colisões (0,44%)** |
| vários telefones para o mesmo cliente | `Telefone_2` em **3 de 241** — não observável na prática |

Normalização usada: remover não-dígitos, remover prefixo `55`, chave = `DDD + últimos 8 dígitos`
(tolerante ao nono dígito). Sem fuzzy, conforme instruído. As 70 colisões de lead são efeito
colateral dessa tolerância e estão contabilizadas como ambiguidade.

## 2. TAXA DE MATCH

Por telefone, sobre os 220 registros `Cliente`:

| classe | clientes | % |
|---|---|---|
| **MATCH_EXATO_UNICO** | **42** | 19,1% |
| MATCH_EXATO_AMBIGUO | **0** | 0% |
| SEM_MATCH | 111 | 50,5% |
| DADO_INVALIDO | 67 | 30,5% |

Chaves secundárias (exatas, não fuzzy) testadas para dar um teto honesto:

| chave | único | ambíguo | sem match |
|---|---|---|---|
| telefone | **42** | 0 | 111 |
| e-mail (texto puro nos dois lados) | 22 | 0 | 152 |
| nome exato normalizado | 21 | **6** | 117 |
| **união das três** | **46** | **7** | — |

**27 dos 46 (59%) são confirmados por duas ou mais chaves independentes.** A qualidade do que
casa é boa. O problema é o volume.

Sobre a população que importa — os **1.135 clientes com pedido**:

**42/1.135 = 3,7% por telefone. 46/1.135 = 4,1% na melhor hipótese.**

## 3. PEDIDOS COBERTOS

| | pedidos | clientes | receita | % da receita |
|---|---|---|---|---|
| **total CalcMe** | 3.730 | 1.135 | R$ 1.885.528,94 | 100% |
| match único por **telefone** | 111 | 30 | R$ 32.793,00 | **1,74%** |
| match único pelas **3 chaves** | **227** | **33** | **R$ 63.344,49** | **3,36%** |

Só 33 dos 46 matches únicos têm algum pedido — 13 casaram com registros de cliente sem pedido.

### A separação que você pediu

| classe | veredito |
|---|---|
| **IDENTIDADE_RECUPERADA** | **33 clientes, 227 pedidos, R$ 63.344,49** — 6,1% dos pedidos, 3,36% da receita |
| **ATRIBUICAO_RECUPERADA** | **2 clientes, 4 pedidos, R$ 375,27** — 0,02% da receita (§4) |
| **ORIGEM_CONTINUA_DESCONHECIDA** | **1.102 clientes, 3.503 pedidos, R$ 1.822.184,45 — 96,6% da receita** |

## 4. ATRIBUIÇÃO — o achado que decide a rodada

Dos 33 clientes casados que têm pedido:

| | clientes | pedidos | receita | com `utm_campaign_id` |
|---|---|---|---|---|
| **já era cliente ANTES do lead existir** | **31** | 222 | **R$ 62.909,32** | **15** |
| primeiro pedido depois do lead | **2** | 4 | **R$ 375,27** | 1 |

**Os 31 já compravam, em média, 239 dias antes de o lead ser criado.**

E **15 deles carregam um `utm_campaign_id`** — 14 reconhecidos em `meta_ads_insights`. Ou seja:
a campanha foi gravada num contato que já era cliente havia oito meses. Isso não é atribuição
de aquisição; é **remarketing sobre carteira existente, carimbado como aquisição.**

Respondendo à sua pergunta central — *dos pedidos hoje sem campanha, quantos passam a ter uma
campanha defensável depois da costura?*

**Quatro pedidos. R$ 375,27. 0,02% da receita do CalcMe.**

E dos dois clientes, apenas **um** tem `utm_campaign_id`. A resposta honesta é: **praticamente
nenhum.**

Risco de sobrescrita/enriquecimento posterior: **confirmado, não hipotético.** Os 15 casos acima
são a prova direta de que `utm_campaign_id` é preenchido em contatos cuja aquisição real
antecede a campanha em centenas de dias.

## 5. HISTÓRICO DE CLIENTE — `valor_receita_coorte_observado`

Com n=33, a coorte casada não sustenta nenhuma estatística. Reporto a base CalcMe inteira, que
não depende de match nenhum e responde melhor à pergunta "quem comprou o quê e por quanto tempo".

Base: 3.716 pedidos (excluídos 14 `Cancelado`), 1.130 clientes. 53 pedidos têm valor ≤ 0.

| pedidos do cliente | clientes | % | pedidos | receita | **% receita** | receita média | P50 até 2ª | P50 span |
|---|---|---|---|---|---|---|---|---|
| **1** | **661** | **58,4%** | 661 | 423.705,31 | 22,5% | R$ 641,01 | — | 0 |
| 2–4 | 321 | 28,4% | 828 | 564.931,80 | **30,1%** | R$ 1.759,91 | **44 d** | 85 d |
| 5–9 | 78 | 6,9% | 492 | 334.975,04 | 17,8% | R$ 4.294,55 | 26 d | 249 d |
| 10–24 | 51 | 4,5% | 728 | 268.870,74 | 14,3% | R$ 5.271,98 | 19 d | 260 d |
| **25+** | **20** | **1,8%** | 1.007 | 286.723,48 | **15,3%** | **R$ 14.336,17** | 12,5 d | 393 d |

**58,4% dos clientes compram uma vez só.** Quem recompra, recompra rápido — e quanto mais
compra, mais rápido volta (44 → 26 → 19 → 12,5 dias).

### Receita acumulada por dias desde o primeiro pedido

`valor_receita_coorte_observado` — **não é LTV, não é margem, não é lucro.**

| coorte | clientes | 30d | 60d | 90d | 180d | **365d** | total |
|---|---|---|---|---|---|---|---|
| todos | 1.130 | 874.357 | 970.768 | 1.052.490 | 1.265.959 | 1.627.113 | 1.874.847 |
| **maturidade ≥365d** | **614** | **526.938** | 577.966 | 624.628 | 769.329 | **1.056.027** | 1.303.761 |

Na coorte madura — a única legível: **R$ 858 por cliente aos 30 dias → R$ 1.720 aos 365 dias.**

**Um cliente vale 2,00× aos 365 dias o que valia aos 30.** Esse multiplicador é o resultado
economicamente útil da rodada, e não depende de match nenhum.

Corrobora a R24: recorrência rápida (P50 12 dias no gap), relacionamento longo (span 393 dias
nos recorrentes), aquisição em dias.

## 6. COORTES POR ORIGEM — impossível

**`calcme_pedidos.Origem` é NULL em 3.730 de 3.730 linhas.** O CalcMe não carrega canal.

E pela costura, as coortes seriam: campanha conhecida n=16, sem campanha n=17, outros canais
n=0 — dos quais 31 de 33 já eram clientes. **Comparar essas coortes seria comparar ruído com
ruído.** Não reporto números por origem. Nenhum seria defensável.

## 7. CAC — não calculado

As três condições que você impôs:

| condição | atende? |
|---|---|
| origem defensável | **não** — 31 de 33 já eram clientes |
| primeira compra identificada | **parcialmente** — só para os 2 pós-lead |
| campanha resolvida | **não** — 1 dos 2 tem `utm_campaign_id` |

**Nenhuma campanha tem clientes novos identificados em número suficiente.** O universo inteiro de
aquisição defensável recuperada pela costura é **2 clientes e R$ 375,27**.

**CAC via costura CalcMe: NÃO CALCULÁVEL.** Confiança: nula. Não simulo.

## 8. CUSTOS FALTANTES — o que existe e o que não existe

Varredura de todas as tabelas do schema `public` com colunas de custo/frete/imposto/taxa/margem:

| tabela | linhas | conteúdo | serve? |
|---|---|---|---|
| **`calcme_itens_pedido`** | **0** | `valor_custo_unit`, `valor_custo_total`, `valor_lucro_total`, `margem_pct` | **schema perfeito, zero dado** |
| **`catalogo_produtos`** | 104 | `custo_unitario` em **66 (63%)**, `margem_alvo_pct` em 104 | **parcialmente** — ver abaixo |
| `fornecedor_produtos` | 23 | `custo_unitario`, `custo_caixa` | insumo, não pedido |
| `orcamentos` | 101 | `valor_frete` | orçamento, não venda |
| `cotacoes_fornecedor` | **0** | `custo_fornecedor` | vazia |
| `dora_experimento_medicoes` | **0** | `custo_variavel` | vazia |
| **imposto / tributo** | — | **nenhuma tabela em todo o banco** | — |

Sobre `catalogo_produtos`, o único custo real com dado: as 104 linhas têm **uma única fonte,
declarada manualmente por Alessandro em 2026-07-19**, com `custo_vigencia_inicio` preenchido em
**5 de 104** e vigência mínima = máxima = 2026-07-19. **Não há histórico de custo.**

E não há caminho do pedido ao custo: o custo é por SKU, e o SKU do pedido mora em
`calcme_itens_pedido`, que está vazia. `calcme_pedidos` só tem valor total.

### Declaração exata do que falta

- **custo de produto por pedido:** existe como schema, **zero linhas**
- **custo histórico:** inexistente — um snapshot de 2026-07-19, aplicado a pedidos de 2024–2026
- **imposto:** nenhum objeto no banco
- **taxa de pagamento/adquirência:** nenhum objeto
- **frete subsidiado realizado:** só em `orcamentos` (101 linhas), não em pedido
- **custo de mão de obra e produção:** inexistente (já era o bloqueio da R20)

**NÃO calculo payback econômico. NÃO calculo LTV de margem. Receita acumulada permanece
receita acumulada.**

## 9. RISCOS

1. **Corrupção de atribuição** — usar a costura para creditar campanhas atribuiria R$ 62.909 de
   carteira pré-existente a campanhas de aquisição. Risco **alto e imediato** se alguém
   implementar sem ler o §4.
2. **Falsa sensação de cobertura** — 46 matches soam bem até se dividir por 1.135.
3. **`clientes_calcme` congelada em 2026-05-18** — a cobertura não melhora sozinha; degrada.
4. **PII em texto puro** — `leads_marketing.em` guarda 8.792 e-mails legíveis e `fullname`
   15.633 nomes; `clientes_calcme` guarda CPF (110) e CNPJ (107). Fora do escopo desta rodada,
   registrado porque a costura aumenta o valor desse conjunto para quem o obtiver.

## 10. AUTO-REFUTAÇÃO

| tentativa de matar o match | resultado medido |
|---|---|
| telefone reciclado? | Não testável — sem histórico de telefone em nenhum dos lados. **Risco aberto** |
| telefone compartilhado por empresa/família? | **Sim, observado.** 1 chave para 2 clientes; 70 chaves de lead colidem (0,44%) |
| cliente mudou de telefone? | `Telefone_2` em 3 de 241. Se mudou, some — e cai em SEM_MATCH. **Parte dos 111 não-matches** |
| lead duplicado? | **Não.** `ph` é chave única de fato: 15.988 telefones, 15.918 chaves distintas — as 70 colisões vêm da minha tolerância ao nono dígito, não de duplicação |
| importação criou leads duplicados? | Não por telefone (acima). A importação de ago/2025 (R24) distorce **data**, não identidade |
| campanha preenchida depois da aquisição? | **Confirmado, com prova direta.** 15 clientes com `utm_campaign_id` cuja primeira compra antecede o lead em ~239 dias |
| primeira compra CalcMe antecede a campanha? | **Sim, em 31 de 33 (94%), R$ 62.909 de R$ 63.344** |
| mesma empresa compra por vários contatos? | Provável e não observável: `clientes_calcme` não tem hierarquia; CNPJ em 107 de 241 |
| pedido cancelado entra? | 14 `Cancelado` — excluídos das §5 e §7, mantidos na §3 (declarado) |
| pedidos sem valor? | 53 com valor ≤ 0. Zero ilegíveis. Mantidos e declarados |
| cliente B2B recorrente domina a receita? | **Parcialmente.** 20 clientes (1,8%) = 15,3% da receita; os 10+ pedidos (6,3%) = 29,6%. Concentração real, não esmagadora |
| o e-mail/nome salvaria o match? | **Não.** Testados: +4 matches únicos sobre o telefone, e 6 ambiguidades novas |
| o problema é a normalização do telefone? | **Não.** O teto era 85 clientes antes de normalizar qualquer coisa: `clientes_calcme` só cobre 109 de 1.135 |

## 11. VEREDITOS

### `MATCH_INSUFICIENTE`

3,7% dos clientes com pedido por telefone; 4,1% na união das três chaves exatas; **6,1% dos
pedidos e 3,36% da receita**. A causa raiz não é a técnica de matching — é que
`clientes_calcme` é um export parcial de 241 linhas com `telefone_canonico` 100% vazio, cobrindo
9,6% dos clientes que têm pedido. Nenhuma melhoria de algoritmo move um teto de 7,2%.

O que casa, casa bem: zero ambiguidade por telefone, 59% confirmado por duas chaves. **A
qualidade é boa; a cobertura é irrelevante.**

### `ATRIBUICAO_CONTINUA_FRACA`

Identidade recuperada **não virou** atribuição recuperada, exatamente como você antecipou.
Pior: 94% dos clientes recuperados **já eram clientes antes do lead**. A costura, no estado
atual, não adiciona atribuição — ela adicionaria erro de atribuição.

**Resposta à regra central:** ainda **não** sabemos "quem comprou o quê e ao longo de quanto
tempo" ligando ao Cérebro. Sabemos, com boa qualidade e sem precisar de match nenhum, **quanto e
por quanto tempo os clientes do CalcMe compram** (§5) — e isso é o único ativo desta rodada.

## 12. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e não é construir nem modelar: **obter o cadastro completo de clientes do CalcMe.**

`clientes_calcme` tem 241 linhas para 1.135 clientes com pedido. Tudo nesta rodada — cobertura,
CAC, coorte por origem — está travado nesse único fato. Um export completo com telefone e
`ID_Cliente` transforma um teto de 7,2% em algo mensurável; **sem ele, nenhuma técnica de
matching melhora nada**, e voltaríamos a medir os mesmos 3,36%.

Ao pedir esse export, pedir junto **`calcme_itens_pedido`** — a tabela existe com as colunas de
custo e margem certas e zero linhas. Ela é o único caminho conhecido para custo por pedido, e
sem custo por pedido não há payback nem LTV de margem, com ou sem costura.

Duas coisas que **não** recomendo agora: fuzzy matching (o teto é de cadastro, não de algoritmo)
e qualquer uso da costura atual para atribuição (§9, risco 1).
