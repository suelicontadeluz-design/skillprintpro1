# R67 — Desfecho comercial canônico para objeções

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY para auditar; uma view NOVA de leitura.
**Zero** alteração em `converteu_depois`, `resolvido`, playbooks, agentes, frentes ou GPS.

**Regra central:**
> "objeção resolvida" não é "venda aconteceu". E "venda aconteceu depois" ainda não significa
> "o playbook causou a venda".

---

## §0 — Reancoragem R66

Censo 28/28 · nenhum par comparável · playbooks × Isabela = cadeia upstream/downstream ·
executor, GPS, tick e gating com hashes idênticos ·
`resolvido ≡ converteu_depois` em **toda a base**: 572 linhas, 187/187, **zero divergência**.

---

## §1 — Quem grava, quando e com base em quê

Nenhum trigger em `lead_objections`. Dois produtores, ambos com cron ativo:

**`fn_isabela_atualizar_resultado_objecoes`** (cron `isabela-fechar-ciclo-objecoes`) — o que
importa:

```sql
UPDATE lead_objections SET converteu_depois = true, resolvido = true,
       resolvido_em = purchase_em, horas_ate_venda = ...
FROM (… JOIN pixel_events pe ON pe.lead_id = lo.lead_id
        AND pe.event_name='Purchase' AND pe.value > 0
        AND pe.event_time > lo.created_at
      WHERE lo.created_at >= NOW() - INTERVAL '30 days' …)
```

**`fn_classificar_desfecho_objecao`** (cron `isabela-classificar-desfecho`) — grava `desfecho`
em 7 classes e trata `converteu` como **uma** delas; sua própria nota diz *"converteu e UM dos
sete, nao a definicao de resolucao"*.

### Correção da leitura que fiz na R66

Eu disse que `converteu_depois` era "cópia de `resolvido`". A causalidade é a inversa: **os dois
são escritos pelo mesmo UPDATE**, e `converteu_depois` **já é derivado de Purchase real
posterior**. Não é um proxy interno inventado.

A equivalência é, portanto, **intencional na implementação** — e é aí que está o defeito real:
uma compra posterior marca `resolvido = true`, ou seja, **"a objeção foi resolvida" passou a
significar "o lead comprou"**, independentemente de alguém ter tratado a objeção.

### Os quatro defeitos medíveis do campo legado

1. **Janela de seleção de 30 dias**: `lo.created_at >= NOW() - 30 days`. Objeção mais velha que
   isso **nunca mais é reavaliada**.
2. **Sem janela de atribuição**: qualquer Purchase posterior conta, a qualquer distância.
3. **Purchase bruto**, não a camada canônica R58–R62.
4. **Regra A implícita**: a mesma venda marca **todas** as objeções anteriores do lead.

---

## §2 — Blast radius: não mexer no campo

**9 views** consomem `converteu_depois` (`vw_org_isabela_scorecard`,
`vw_org_isabela_playbooks_performance`, `vw_playbook_evidencia`, `vw_objecoes_playbooks_status`,
`vw_isabela_objecoes_classificadas_ricardo`, entre outras). Alterar a semântica atingiria todas.
→ **contrato novo, campo intocado.**

---

## §4/§5 — Unidade e timeline

A objeção pertence ao **lead** (`lead_objections.lead_id`, e é assim que ambos os produtores a
tratam). O desfecho respeita a mesma unidade, com `pessoa_id` exposto quando a identidade
comercial existe.

**§6:** compra anterior não conta — só `ocorrido_em > ocorreu_em`.

---

## §7 — A janela D30 veio do dado, não da conveniência

572 objeções em 180 dias; **222 (38,8%)** têm fato comercial canônico posterior:

| janela | conversões | % das 222 |
|---|---|---|
| D1 | 74 | 33% |
| D3 | 108 | 49% |
| D7 | 140 | 63% |
| D14 | 162 | 73% |
| **D30** | **202** | **91%** |
| D90 | 222 | 100% |

Mediana: **88,6 h (3,7 dias)** · **p90: 28,0 dias**.
D30 captura 91% e cobre o p90. Escolhida por isso, não por hábito.

---

## §8 — Múltiplas objeções: a regra precisa ser declarada

**202 objeções convertidas em D30 correspondem a apenas 125 vendas distintas**, em 99 leads.

| regra | n |
|---|---|
| A — toda objeção anterior recebe o outcome | 202 |
| B — última objeção antes da venda | **125** |
| C — primeira objeção antes da venda | 125 |

**Inflação de A sobre B: 1,62×.** O campo legado usa a regra A sem declarar.

A view expõe as duas coisas separadas: `converteu_pos_objecao_d30` (relação temporal, regra D,
por objeção) e `e_ultima_objecao_antes_do_fato` (regra B, para atribuição sem duplicar).

---

## §10 — `vw_objecao_outcome_comercial`

572 linhas · 202 com fato em D30 · **125 atribuíveis pela regra B** ·
**198 confiança ALTA / 4 MEDIA** (97,3% das conversões têm deal canônico).

Campos: `objecao_id`, `lead_id`, `pessoa_id`, `ocorreu_em`, `tipo_objecao`, `forca`,
`playbook_sugerido_id`, `tem_playbook_ativo`, `resolvido_legado`, `converteu_depois_legado`,
`houve_fato_posterior`, `primeiro_fato_em`, `primeiro_deal_won_posterior`,
`valor_primeiro_fato`, `tempo_ate_conversao_horas`, `janela`, `converteu_pos_objecao_d30`,
**`janela_fechada`**, `e_ultima_objecao_antes_do_fato`, `confidence`, `motivo`, e um campo
`semantica` que carrega a regra dentro do próprio dado:

> `CONVERSAO_POS_OBJECAO. Relação TEMPORAL, nunca causal. Não significa que o playbook causou a venda.`

**§11:** fonte é `vw_fato_comercial_identidade_canario` (R58–R62). Fato sem deal canônico
recebe `confidence = MEDIA`, nunca ALTA.

**§9:** a view mede `CONVERSAO_POS_OBJECAO`, jamais `CONVERSAO_CAUSADA_PELO_PLAYBOOK`.

---

## §12 — Replay com o desfecho verdadeiro

Só objeções com **janela D30 fechada** (maturidade), 90 dias:

| grupo | objeções | leads | conversões D30 | taxa |
|---|---|---|---|---|
| COM playbook | 172 | 116 | 70 | **40,7%** |
| SEM playbook | 107 | 85 | 43 | **40,2%** |

**Diferença: 0,5 pp** · erro-padrão ≈ **6,0 pp**.

A R66 havia medido **3,8 pp** com desfecho ingênuo ("qualquer Purchase, a qualquer distância").
Com o desfecho verdadeiro, o efeito aparente **encolhe para praticamente zero**.

---

## §13 — Os grupos são comparáveis

| | COM playbook | SEM playbook |
|---|---|---|
| já era cliente | 38,4% | 37,4% |
| objeções por lead | 3,26 | 2,87 |
| tipos distintos | 8 | 8 |
| idade média (dias) | 59,8 | 60,0 |

Balanceados. O nulo não é artefato de confusão.

---

## §14 — Desagregar não revela efeito escondido — revela o contrário

| tipo | COM (n, taxa) | SEM (n, taxa) | diferença |
|---|---|---|---|
| `qualidade_confianca` | 40 · 35,0% | 37 · 56,8% | **−21,8 pp** |
| `prazo` | 31 · 45,2% | 16 · 56,3% | **−11,1 pp** |
| `pagamento` | 18 · 61,1% | 9 · 55,6% | +5,5 pp |
| `frete` | 4 · 25,0% | 12 · 25,0% | 0,0 pp |
| `preco` | 63 · 39,7% | **0** | sem controle |

Nenhum efeito positivo localizado. Onde há grupo de controle, o playbook está associado a
conversão **menor** — quase certamente porque playbooks existem justamente onde a objeção é
comum ou difícil, não porque piorem algo.

---

## §15 — Isabela: **SIM**, o outcome é reutilizável

394 objeções têm `oferta_sugerida_id`; **152 delas converteram em D30**. A view já expõe a
ligação `objecao → oferta → fato canônico`, então quando a frente da Isabela for implantada
haverá desfecho para medir antes e depois — sem construir nada novo.

---

## §16 — Destino de `converteu_depois`: **A. CAMPO_LEGADO_MANTER_COM_NOME**

A matriz legado × canônico, sobre as 572 linhas:

| legado | canônico D30 | n |
|---|---|---|
| false | false | 370 |
| true | true | 187 |
| **false** | **true** | **15** |
| **true** | **false** | **0** |

**Zero falsos positivos.** 15 falsos negativos (2,6%), dos quais **13 são objeções com mais de
30 dias** que o cron nunca reavalia — exatamente o defeito da janela de seleção.

O campo está **correto porém incompleto**, e tem 9 consumidores. Mantê-lo é o certo.
**O campo que está semanticamente errado é `resolvido`**, que passou a significar "comprou".
Ele é o candidato real a depreciação — em outra rodada, com migração.

---

## §17 — Impacto na R66: **REFORÇADA**

A conclusão "playbook sem retorno demonstrado" não só sobrevive como fica mais forte: 3,8 pp
viraram **0,5 pp** quando o desfecho passou a ser verdadeiro. `playbooks-cobrir-buracos-forca`
**não** volta a ter hipótese econômica.

---

## §18 — Auto-refutação

| tentativa | resultado |
|---|---|
| Purchase posterior já estava em negociação? | **plausível e não descartável** — não há campo de estágio comercial no momento da objeção. Limite declarado. |
| mesma venda atribuída a várias objeções? | **SIM no legado** (regra A, 1,62×). Corrigido na view com `e_ultima_objecao_antes_do_fato`. |
| janela cria resultado artificial? | **não**: D30 captura 91% e cobre o p90 de 28 dias; o resultado é estável de D14 a D90. |
| clientes antigos convertem mais? | **SIM, e é o confundidor dominante**: já-cliente **59,4%** contra novo **28,9%** — **30,5 pp**, sessenta vezes o efeito do playbook. Os grupos com/sem playbook estão balanceados nessa variável, o que sustenta o nulo. |
| playbook vai para os casos fáceis? | **não, o contrário**: força `forte` tem apenas 37 cobertas contra 42 sem (48%), enquanto `moderada` tem 101 contra 47 (68%). Os casos duros são os menos cobertos. |
| ausência de playbook ocorre em objeções diferentes? | **SIM** — `preco` tem 63 com playbook e **zero** sem: não há grupo de controle para o tipo mais volumoso. |
| outcome depende de EVT sem deal? | **não**: 110 de 113 conversões (97,3%) têm deal canônico. |

---

## §19 — Veredito

**`OUTCOME_COMERCIAL_CANONICO_VALIDADO`**

A view mede fato comercial canônico posterior, com janela justificada pelo dado, regra de
atribuição declarada, confiança separada por origem do fato e a advertência causal embutida no
próprio registro. Nada foi alterado nas fontes.

E o campo legado sai da rodada **melhor compreendido, não condenado**: `converteu_depois` é
correto e incompleto; quem está semanticamente quebrado é `resolvido`.

---

## §20 — Próximo passo

1. **Não voltar a procurar pares no backlog.** A R66 já mostrou que ele não contém alternativas
   econômicas, e a R67 acabou de tirar do playbooks a última hipótese econômica que restava.
2. A arquitetura proposta na §20 do enunciado é a leitura correta do que estas cinco rodadas
   mostraram: **MAPA → gap econômico → worker econômico investiga → candidato de ação**, em
   paralelo com **GPS Sistema → backlog técnico → worker sistema**. As duas filas não competem
   porque não medem a mesma coisa — foi exatamente isso que a R66 provou ao falhar.
3. O confundidor "já é cliente" (30,5 pp) é o achado mais forte desta rodada e não pertence a
   nenhuma frente atual. Vale uma pergunta econômica própria.
4. `resolvido` precisa de migração antes de qualquer leitura que dependa dele.

---

## Objetos desta rodada

**Criados:** `vw_objecao_outcome_comercial` (view de leitura, sem consumidor).
**Registrados:** 1 avaliação em `frente_economia` (efeito remedido: **0,5 PCT, D30, BAIXA**),
que substitui a leitura da R66 por medição melhor — sem apagá-la, porque o contrato é
append-only.
**Alterados:** nenhum. **Removidos:** nenhum.

Verificado após a escrita: `lead_objections` intacta (572 linhas, 187/187, zero divergência),
`objection_playbooks` não tocada, 0 frentes tocadas, executor/GPS/tick com hashes idênticos,
funções produtoras intactas, nenhum cron ou view consumindo a view nova.

Rollback: `DROP VIEW vw_objecao_outcome_comercial;`
