# R18 — Desfecho primário do EXP-001 corrigido

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `METRICA_EXP001_CORRIGIDA`

Zero envio, zero fila, campanha `rascunho`, snapshot e mensagem intactos.

---

## 1. DEFINIÇÃO ATUAL — e o achado que muda o enquadramento

Procurei em todo lugar, não só em `fn_exp001_coorte`:

| Onde procurei | `retomou_conversa_72h` |
|---|---|
| funções (`pg_proc`, todos os schemas) | só menção em `fn_exp001_coorte` e `fn_exp001_registrar_intervencao` |
| views | **nenhuma** |
| materialized views | **nenhuma** |
| crons | **nenhum** |
| colunas de tabela | **nenhuma** |

**Não existia nada calculando a métrica.** Ela era só uma string descritiva devolvida
dentro do jsonb de `fn_exp001_coorte` (linha 197):

> `'>=1 inbound em fact_conversations posterior ao instante da intervencao, em ate 72h'`

Então não havia código errado rodando — havia um **contrato** errado, e o cálculo ainda
por nascer. Isso muda o trabalho: não era um patch, era criar o cálculo já certo, e
consertar o contrato para os dois não se contradizerem.

## 2. BUG PROVADO

Com dados sintéticos e a função real, em transação revertida:

| caso | texto do inbound | `retomou` | `optout` |
|---|---|---|---|
| A | "Oi, quero continuar" | **true** | false |
| B | "SAIR" | **false** | **true** |
| C | "não quero receber" | **false** | **true** |
| D | "não quero essa camiseta" | **true** | false |
| E | (sem resposta) | false | false |

Pela definição antiga, B e C dariam `retomou = true` — duas rejeições contadas como
sucesso. E como o CONTROLE não recebe mensagem, ele não tem como produzir esse inbound:
o viés era **assimétrico**, inflando só o tratamento.

## 3. FONTE CANÔNICA ESCOLHIDA

`crm_contact_optouts` (`canal='whatsapp'`), gravada por `trg_crm_capturar_optout_inbound`.

Escolhi ela — e **não** reinterpretação de texto — porque a sua própria refutação estava
certa, e a verificação confirmou as duas condições:

**É temporalmente confiável.** O trigger é:

```
CREATE TRIGGER trg_crm_capturar_optout_inbound
AFTER INSERT ON public.fact_conversations FOR EACH ROW
```

`AFTER INSERT … FOR EACH ROW` roda na **mesma transação** do inbound. Não há atraso: a
linha de opt-out é commitada junto com a mensagem. Zero janela de inconsistência.

**Dá para ligar ao inbound exato.** O trigger grava
`evidencia->>'conversation_id' = new.id`. Testei ponta a ponta e o campo **casa byte a
byte** com `fact_conversations.id`. Isso permite excluir da retomada **exatamente** o
inbound que a produção reconheceu como opt-out — sem criar uma segunda semântica.

Consequência direta: **eu não repito a lista de tokens em lugar nenhum.** Se amanhã a
captura mudar de vocabulário, a métrica acompanha sozinha.

## 4. NOVA DEFINIÇÃO

```
retomou_conversa = >=1 inbound em (t0, t0 + janela]
                   cujo id NÃO seja o conversation_id de um opt-out
                   de whatsapp registrado para aquele lead

optout           = >=1 opt-out de whatsapp com solicitado_em em (t0, t0 + janela]

nao_respondeu    = tem t0, e nem retomou nem optou por sair
```

Os três são mutuamente informativos e o resultado distingue os três estados, como pedido.

**Âncora t0:** TRATAMENTO usa `crm_campaign_audiences.enviado_em` (preenchido por
`fn_marcar_disparo_enviado`, que é quem carimba o envio real).

**Simetria:** a regra de classificação de inbound é **idêntica** nos dois braços. A única
diferença é a âncora da janela, e ela é inerente — o controle não recebe mensagem, logo
não tem `enviado_em`. Por isso `p_t0_controle` é parâmetro **obrigatório na prática**: sem
ele o braço volta com `sem_t0` e taxas nulas, em vez de um número inventado. Não criei
regra especial para o tratamento além da exclusão de opt-out.

**Coluna de tempo:** `fact_conversations.created_at`, a mesma usada pela coorte e pela
política. Ressalva medida: `solicitado_em` do opt-out prefere `timestamp`, que difere de
`created_at` em **4,3 s em média, 656 s no pior caso** (27.882 inbounds/30d). Irrelevante
numa janela de 72 h, mas registrado.

## 5. PATCH

**(a) Função nova** `fn_exp001_resultado(p_horas integer DEFAULT 72, p_t0_controle timestamptz DEFAULT NULL)`,
`STABLE`, `md5(prosrc) = 9fa6afb4851e8aed3008ed89fa6f512f`. Devolve por braço: `n`,
`com_t0`, `sem_t0`, `retomou_conversa`, `optout`, `nao_respondeu`, taxas, mais a definição
e a fonte declaradas no próprio retorno.

**(b) Contrato corrigido** em `fn_exp001_coorte`, string única na linha 197:

```diff
- 'definicao','>=1 inbound ... em ate 72h'),
+ 'definicao','>=1 inbound ... em ate 72h, EXCLUINDO o inbound registrado como opt-out
+   de whatsapp em crm_contact_optouts. Calculo canonico: fn_exp001_resultado(...).
+   Opt-out NUNCA conta como retomada.'),
```

| | md5 | bytes |
|---|---|---|
| baseline | `4390732e59e29c7b0b63bceca2215828` | 11565 |
| candidato pré-computado | `195f25dadb6370a297d4c400beec34e1` | 11744 |
| **LIVE** | **`195f25dadb6370a297d4c400beec34e1`** | **11744** |

A alteração está inteiramente dentro do `jsonb_build_object('metricas', …)` — texto
devolvido ao chamador. Seleção, estratos, randomização e amostra continuam intocados
(`resumo` segue respondendo normalmente).

## 6. SEGURANÇA DO PRÓPRIO TESTE

`fact_conversations` tem 8 triggers. Um deles, `fn_trigger_enrich_botconversa`, **faz
chamada HTTP** — e `pg_net` **não** volta atrás com `ROLLBACK`. Seria um efeito externo
real escapando de um teste supostamente reversível.

Sua condição é `WHEN (lead_id IS NOT NULL AND phone IS NOT NULL)`. Inseri os inbounds
sintéticos com `phone` nulo e medi:

| | valor |
|---|---|
| `phone` ficou nulo após os BEFORE triggers | **true** |
| `net.http_request_queue` antes → depois | **0 → 0** |
| opt-out criado pelo trigger canônico | **1** |
| `evidencia->>'conversation_id'` == `fact_conversations.id` | **true** |

Zero HTTP disparado. E o teste ainda exercitou o mecanismo real de opt-out ponta a ponta.

## 7. TESTES

| # | Teste | Resultado |
|---|---|---|
| T1 | mensagem normal conta como retomada | A: `retomou=true` |
| T2 | SAIR não conta como retomada | B: `retomou=false` |
| T3 | SAIR conta como opt-out | B: `optout=true` |
| T4 | demais tokens reais funcionam | C ("não quero receber"): `optout=true` |
| T5 | rejeição de produto não vira opt-out | D ("não quero essa camiseta"): `optout=false`, `retomou=true` |
| T6 | ausência de resposta segue negativa | E: ambos `false` |
| T7 | snapshot 456 = 244 + 212 | **456 = 244 + 212** |
| T8 | hash T0 intacto | `865e8672…` gravado = `865e8672…` reconstruído |
| T9 | mensagem congelada igual | `1c389fe45c074b24626f45fa18060e7e`, `aprovado=false` |
| T10 | campanha `rascunho` | `rascunho` |
| T11 | fila EXP-001 = 0 | **0** |
| T12 | envio EXP-001 = 0 | **0** |
| T13 | nada em seleção/braços | `resumo` funciona; snapshot inalterado; guards com hash intacto |
| T14 | rollback provado | coorte volta a `4390732e…`; `DROP` deixa 0 funções |

## 8. REFUTAÇÃO

| Pergunta | Resposta |
|---|---|
| Resposta curta legítima pode coincidir com token? | Sim — "parar" e "cancelar" são ambíguos. **Mas eu não classifico texto**: uso só o que a produção registrou. Se a captura errar, métrica e operação erram *igual*, nunca em direções opostas |
| "cancelar" pode ser cancelar pedido, não contato? | Pode. É um falso positivo **da captura**, não da métrica. Consertar isso é mexer no opt-out — outra rodada, e você já decidiu manter a captura estreita de propósito |
| Devemos usar todos os tokens atuais? | A pergunta não se aplica ao meu desenho: não uso lista nenhuma |
| Excluir só o opt-out registrado, em vez de reinterpretar texto? | **Sim, foi o que fiz** — sua preferência estava certa e é verificável |
| Há atraso entre inbound e gravação? | **Não.** `AFTER INSERT FOR EACH ROW`, mesma transação |
| Dá para classificar com a mesma verdade da produção sem duplicar regra? | **Sim** — via `evidencia->>'conversation_id'`, provado idêntico ao `fact_conversations.id` |

**Limite honesto que fica aberto:** se um lead der opt-out **duas vezes**, o `ON CONFLICT
DO UPDATE` sobrescreve `evidencia` com o último `conversation_id` e mantém o
`solicitado_em` mais antigo. Aí o inbound antigo deixaria de ser excluído. Hoje isso é
inócuo — nenhum dos 244 tem opt-out ativo, então o primeiro opt-out sempre cai no caminho
de INSERT, e opt-outs posteriores já estão fora da janela do primeiro. Registrado, não
escondido.

## 9. PROVAS DE INTOCADO

| Medida | Valor |
|---|---|
| snapshot total / tratamento / controle | **456 / 244 / 212** |
| hash T0 gravado vs reconstruído | `865e8672…` = `865e8672…` |
| mensagem `md5` / `aprovado` | `1c389fe4…` / **false** |
| campanha status | **`rascunho`** |
| fila EXP-001 | **0** |
| envios EXP-001 (toda a história) | **0** |
| `fn_agente_automatico_pode_atender` | `d22ac0fd…` (intacto) |
| `fn_exp001_registrar_intervencao` | `f18172cd…` (intacto) |
| resíduo dos testes | **0** conversas, **1** opt-out (o de e-mail, pré-existente) |

A coorte LIVE já derivou para 455/243/212 — e **isso não afeta nada**: a verdade do
EXP-001 é o snapshot T0, exatamente como projetado na R16.

## 10. PRÓXIMO PASSO MÍNIMO

Agora sabemos medir. Volta a valer o único bloqueio real, que segue de pé desde a R9:

**decidir o canal.** Existe um único número de WhatsApp e ele também atende clientes
ativos. Ou você aceita usá-lo para 244 mensagens de dose única — e aí precisamos fixar
teto diário e janela —, ou o experimento espera um número separado.

Uma coisa só, e é decisão sua, não técnica.

Depois disso, e só depois: definir `p_t0_controle` (o instante de referência do controle),
aprovar a campanha e registrar com `p_enfileirar=true`.

EXP-001 continua sem execução. Zero mensagens nesta rodada.
