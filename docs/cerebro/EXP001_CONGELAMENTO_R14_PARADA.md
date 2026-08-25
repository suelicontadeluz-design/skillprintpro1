# R14 — Congelamento do braço TRATAMENTO do EXP-001: PARADO antes de escrever

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `EXP001_POPULACAO_DIVERGIU`

**Nada foi escrito no banco.** Zero linhas, zero DDL, zero envio.

Parei na etapa 1 (reancorar), pela condição de parada que você mesmo definiu:
*"Se a diferença não for explicável pelos gates atuais: PARAR."*

Há **dois** problemas de população, e o segundo é maior que o que você antecipou.

---

## 1. BASELINE

| Objeto | `md5(prosrc)` | Confere |
|---|---|---|
| `fn_exp001_coorte(integer)` | `8be3ea0aa38a813c40591138624904a8` | sim |
| `fn_exp001_registrar_intervencao(uuid,boolean,text)` | `4b3c979bf5adf5484f302d5631d85b29` | sim |
| `fn_agente_automatico_pode_atender(...7 args)` | `d22ac0fd2e6d57c4fd183c717272ae59` | sim |
| `fn_mapa_cerebro_v0()` | `226944645b3f715d75b9a82b33211f28` | sim |

Estado: campanha EXP-001 **não existe** (0), audiências 1982, fila 906,
fila do EXP-001 **0**, opt-outs 1. Tudo idêntico ao fim de R13.

Leitura de agora (`2026-08-25T15:16Z`):

```
resumo: { total_elegivel: 460, tratamento: 246, controle: 214, desbalanceamento_pct: 6.957 }
randomizacao: { deterministica: true, usa_random: false,
                metodo: "get_byte(decode(md5(lead_id::text || experiment_id),'hex'),0) & 1",
                hash_divisao: "4bfc4f190609fe009974e5c99264c0b1" }
estratos: 31-35d = 142 · 36-40d = 117 · 41-45d = 201
```

## 2. BLOQUEIO PRINCIPAL — a função não consegue nomear os 246

Este é o achado que impede a rodada, e ele **não** estava no enunciado.

`fn_exp001_coorte` tem um teto interno:

```sql
cfg as (select 'EXP-001-REAQUECIMENTO-31-45D'::text experimento_id,
               least(greatest(coalesce(p_amostra,20),0),200) n_amostra)
```

Chamei com `p_amostra = 100000`. Medido:

| | valor |
|---|---|
| `resumo.tratamento` | **246** |
| `resumo.controle` | **214** |
| `amostra` — braço TRATAMENTO | **200** |
| `amostra` — braço CONTROLE | **200** |

O array `amostra` é uma **amostra de 200 por braço**, não a população. O `resumo`
conta 460 porque é calculado antes do corte.

**Consequência: 46 dos 246 leads de tratamento não têm como ser nomeados.** Não existe
outra saída — verifiquei `populacao`, `metricas`, `balanceamento_por_estrato`,
`baseline_espontaneo` e `fora_exp001_motivo`: são todos metadados descritivos, nenhum
carrega lista de `lead_id`.

Congelar 200 de 246 seria **pior do que não congelar**: redefiniria silenciosamente o
braço de tratamento para 81% dele, e o registro passaria a ser a referência histórica
oficial de uma população que nunca foi a coorte. Não fiz.

## 3. EXPLICAÇÃO 250 → 246 (e por que o número esconde o problema real)

O critério da população é **janela móvel**: "último inbound entre 31 e 45 dias".
Ela muda sozinha todo dia, sem ninguém mexer em nada.

O estrato `41-45d` tem **201 leads** — é o que envelhece para fora. O estrato `31-35d`
tem 142 — é o que entra. Assumindo distribuição aproximadamente uniforme dentro de cada
faixa de 5 dias (estimativa, não medição direta):

- saem ~**40 leads/dia** (201 ÷ 5)
- entram ~**28 leads/dia** (142 ÷ 5)
- saldo líquido ≈ **−12/dia**

**Por isso o "250 → 246" engana.** A diferença líquida é 4, mas a rotatividade bruta é
de dezenas por dia. Os 246 de agora não são "os 250 menos 4": podem diferir por muito
mais que 4 leads, com entradas e saídas se cancelando no total.

E aqui está o ponto honesto: **eu não consigo dizer quais leads saíram.** A leitura de
250/215/465 nunca foi persistida em lugar nenhum — foi um retorno de função, e a função
é `STABLE`, recalculada a cada chamada. Não há histórico para comparar.

Ou seja: a diferença **é** explicável pelo mecanismo (janela móvel), mas **não é
auditável lead a lead**. Sob a sua regra ("quero saber exatamente quais leads saíram"),
isso é parada.

Isso não é um defeito do trabalho anterior — é exatamente o problema que esta rodada
existe para resolver. Só que ele precisa ser resolvido *antes* de declarar qualquer
população como oficial, não depois.

## 4. CONTROLE — identidade preservada sem criar nada (item 3 do enunciado)

Verificado empiricamente: recalculei o braço fora da função para os 400 leads da amostra
e comparei com o que ela retorna.

```sql
case when (get_byte(decode(md5(lead_id::text || 'EXP-001-REAQUECIMENTO-31-45D'),'hex'),0) & 1) = 1
     then 'TRATAMENTO' else 'CONTROLE' end
```

| total | batem | divergem |
|---|---|---|
| 400 | **400** | **0** |

**Conclusão: não crie nada para o controle.** Dado um `lead_id`, o braço é recomputável
para sempre, sem armazenar nada. O que precisa ser congelado é a **população** — quem
estava elegível naquele instante — não a atribuição.

Registrar o controle em `crm_campaign_audiences` seria exatamente a confusão semântica
que você quis evitar: transformaria "não recebeu intervenção por desenho" em "intervenção
registrada que não foi enviada". Não fiz.

## 5. REFUTAÇÃO — a parte de segurança passou inteira

Testei se registrar audiências poderia disparar algo. **Não pode:**

| Pergunta | Resposta |
|---|---|
| Algum cron consome `crm_campaign_audiences`? | Não. Único que lê e enfileira é `fn_tiago_autorizar_e_enfileirar`, e **nenhum cron o chama** (varri os 90 jobs ativos) |
| Algum trigger transforma audiência em fila? | **Zero triggers** em `crm_campaign_audiences` e em `crm_campaigns` |
| `rascunho` basta para impedir execução? | Sim, em dois pontos: `fn_exp001_registrar_intervencao` exige `status='aprovada'` para enfileirar, e o Tiago exige `rascunho` **mais** os gates abaixo |
| `criado_por='cerebro-exp001'` isola do Tiago? | Sim — ele rejeita com `autor_invalido` quando não casa `agente-campanhas-crm-%`; e pararia também em `mensagem_ausente`, pois a campanha não teria `crm_campaign_messages` |
| Registrar altera score/status do lead? | Não. A função só escreve em `crm_campaigns` e `crm_campaign_audiences` |
| A coorte pode mudar durante o loop dos registros? | **Sim** — e é o item 3. Por isso o congelamento tem de ler a população **uma vez** e registrar a partir dessa leitura, não chamar a função por lead |

Ou seja: **o congelamento é seguro. Ele só não é fiel.** Parei pela fidelidade, não por risco.

## 6. TESTES

| # | Teste | Resultado |
|---|---|---|
| T1 | total congelado = tratamento | **não executado** — não é possível nomear 246 (item 2) |
| T2–T3 | 1 por lead / não duplica | não executado |
| T4 | zero audiência para controle | **satisfeito por não agir** — e comprovado desnecessário (item 4) |
| T5 | zero linha de fila | **0** para o EXP-001, antes e depois |
| T6 | campanha permanece rascunho | campanha **nem existe** (0 linhas) |
| T7 | nenhum cron autoriza sozinho | provado — nenhum cron chama o Tiago |
| T8 | nenhum trigger enfileira | provado — zero triggers nas duas tabelas |
| T9 | zero mensagem criada pelo EXP-001 | 0 |
| T10 | zero envio causado pela rodada | 0 — só executei `SELECT`; `pg_current_xact_id_if_assigned()` nulo em todas as chamadas |
| T11 | opt-out intacto | `d22ac0fd…`, 1 linha em `crm_contact_optouts` |
| T12 | MAPA/agentes intactos | `226944645b…` e demais hashes conferem |
| T13 | hash/divisão documentados | `hash_divisao=4bfc4f19…`, fórmula reproduzida 400/400 |
| T14 | lista congelada reconstruível | **não** — é justamente o que falta |
| T15 | nenhuma intervenção fora do tratamento | 0 intervenções criadas |
| T16 | idempotência em 2ª execução | não executado |

## 7. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é de um caractere.

O teto `200` **não participa da seleção**. `n_amostra` aparece em exatamente dois lugares
no corpo da função: a definição (linha 4) e um filtro pós-seleção (linha 141):

```sql
) y where ord <= (select n_amostra from cfg)
```

`ord` é um `row_number()` aplicado **depois** de a elegibilidade, a estratificação e a
randomização já estarem resolvidas. Prova empírica de que o teto não afeta seleção: o
`resumo` já reporta 460/246/214 **enquanto** a `amostra` emite 400. Os dois números saem
da mesma execução.

Patch proposto (não aplicado):

```diff
- least(greatest(coalesce(p_amostra,20),0),200) n_amostra
+ least(greatest(coalesce(p_amostra,20),0),5000) n_amostra
```

| | `md5(prosrc)` | bytes |
|---|---|---|
| atual | `8be3ea0aa38a813c40591138624904a8` | 11564 |
| com teto 5000 | `4390732e59e29c7b0b63bceca2215828` | 11565 |

Com isso, `fn_exp001_coorte(5000)` emite os 460, e o congelamento vira: **uma** leitura,
`ON CONFLICT` idempotente por lead, `p_enfileirar=false`.

Preciso da sua autorização para tocar em `fn_exp001_coorte`, porque nas rodadas anteriores
o hash dela foi tratado como âncora de integridade e a regra vigente é não alterar a
seleção da coorte. O patch **não** altera a seleção — altera quantas linhas já
selecionadas a função devolve —, mas a decisão de mexer nela é sua.

**Alternativa, se preferir não tocar na função:** registrar a partir da leitura atual
declarando explicitamente que o braço congelado é `min(246, 200)` = 200 leads. Não
recomendo: redefine o experimento e o desbalanceamento medido (6,96%) deixa de valer.

EXP-001 continua congelado, sem campanha, sem audiência, sem fila. Zero mensagens.
