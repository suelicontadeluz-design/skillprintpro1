# R66 — Provar o primeiro par economicamente comparável

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY para investigar; registro append-only dos testes de par.
**Zero** alteração em prioridade, GPS, executor, filas ou produção. Nenhum score criado.

**Regra central:**
> Não precisamos fazer dois números caberem na mesma unidade. Precisamos provar que duas
> frentes são alternativas reais para melhorar a mesma realidade.

---

## §0 — Reancoragem R65 (LIVE, exata)

28 acionáveis · 28 classificadas · **15 SEM_RELACAO / 6 PARCIAL / 5 UNKNOWN / 2 MEDIDA** ·
**0 pares comparáveis** · executor, GPS e tick com hashes idênticos · nada ligado à produção.
As 28 do censo continuam acionáveis — o conjunto foi reconstruído, não assumido.

---

## §3/§4 — Cadeia causal de cada frente

### `playbooks-cobrir-buracos-forca`

```
AÇÃO           criar playbooks para as combinações tipo × força descobertas
→ OPERACIONAL  objeção passa a ter script/estratégia disponível        [PROVADO: 112 de 221 sem]
→ COMERCIAL    objeção tratada → conversa continua                     [PARCIAL]
→ ECONÔMICO    venda                                                    [REFUTADO — ver §9]
```

### `isabela-ofertas-nao-chegam`

```
AÇÃO           fn_objecao_contexto_lead devolve o bloco e ele chega na Julia
→ OPERACIONAL  Julia responde a objeção com recurso em mãos            [UNKNOWN: não implantado]
→ COMERCIAL    —                                                       [UNKNOWN]
→ ECONÔMICO    —                                                       [UNKNOWN]
```

**Li a função, não o nome.** `fn_objecao_contexto_lead` (2.458 bytes) devolve exatamente:
`playbook_id`, `playbook_titulo`, `script_sugerido`, `taxa_conversao`, `vezes_usado`,
`vezes_converteu`.

Duas consequências:

1. **A frente da Isabela entrega um PLAYBOOK.** Se a combinação tipo × força não tiver playbook
   ativo, a função devolve `playbook_id` nulo **mesmo funcionando perfeitamente**.
   `playbooks` cria o objeto que `isabela` entrega — a primeira é **upstream** da segunda.
2. O critério da frente diz que a função devolve "a oferta e as restrições comerciais". Ela
   **não lê `oferta_sugerida_id`** (preenchido em 345 de 500 objeções em 90d). O critério e o
   código discordam — registrado, não corrigido.

---

## §5/§6 — Universos e sobreposição

| | |
|---|---|
| objeções em 30d | 221 |
| leads com objeção em 30d | 187 |
| leads criados em 30d | 1.237 |
| **universo Playbooks** (lead cuja combinação tipo×força não tem playbook ativo) | **94 leads** |
| **universo Isabela** (lead com objeção não resolvida) | **149 leads** |
| **ambos** | **77** |
| só Playbooks | 17 |
| só Isabela | 72 |
| nenhum dos dois | 21 |

**77 dos 94 leads do universo Playbooks (82%) estão dentro do universo Isabela.** Somar
oportunidades seria dupla contagem — e a R65 já havia sinalizado o risco.

---

## §9 — Efeito observado: o teste que mais importa

Medi o efeito incremental de Playbooks em **Purchase real** (`pixel_events`), não no campo
interno, sobre 90 dias:

| grupo | objeções | com Purchase depois | taxa |
|---|---|---|---|
| combinação **COM** playbook ativo | 288 | 106 | **36,8%** |
| combinação **SEM** playbook ativo | 212 | 70 | **33,0%** |

Diferença: **3,8 pontos percentuais**. Erro-padrão da diferença ≈ **4,3 pp**.
**O efeito é menor que um erro-padrão — indistinguível de zero.**

No campo interno a diferença é ainda menor: 30,6% contra 29,2% (**1,4 pp**).

### E o campo interno não serve como desfecho

`resolvido` e `converteu_depois` são o **mesmo conjunto**: 150 verdadeiros para os dois,
**zero** divergência em qualquer direção. `converteu_depois` não é uma medida independente de
conversão — é uma cópia de `resolvido`. Usá-lo como resultado comercial teria produzido um
número falso.

Para `isabela` **não existe grupo de comparação**: a intervenção não foi implantada
(`tratado_por` preenchido em 83 de 500). Efeito observado = zero por construção, não por
medição.

---

## §10 — Downstream comum

Existe um: **Purchase posterior à objeção**, canônico e medido igual para qualquer frente que
toque `lead_objections`. Está disponível para Playbooks — e é justamente ele que mostra
ausência de efeito. Para Isabela não há variável de intervenção para cruzar com ele.

---

## §15/§17 — Classes e teste decisório

| par | classe | teste decisório |
|---|---|---|
| `playbooks` × `isabela` | **NAO_COMPARAVEL** | DADOS_INSUFICIENTES |
| `crons-sucesso-sem-efeito` × `atrib-instrumentar-execucao` | **MESMA_UNIDADE_MAS_SEMANTICA_DIFERENTE** | DADOS_INSUFICIENTES |

### Por que o segundo par também cai

Parecia o melhor candidato restante: mesma unidade (EVENTOS), mesmo horizonte depois de
normalizar para D30, ambas ECONOMICA_PARCIAL/SEM_RELACAO com medição direta.

- `crons`: **42.075 execuções em 30d, 99,998% `succeeded`** — o problema é **ausência de prova**.
- `atrib`: **28.894 decisões sem `execution_event_id`**, embora **3.697 execution events
  existam** desacoplados no mesmo período — o problema é **ausência de ligação**.

Mesma unidade, grandezas diferentes. E as populações não são disjuntas: parte das decisões de
agente é disparada pelos próprios crons.

---

## §13/§14 — O que mais foi testado

Entre as 6 `ECONOMICA_PARCIAL`, só duas têm valor (`taxonomia-produto` MARGEM/BRL/D30 e
`atrib` QUALIDADE_DO_DADO/EVENTOS/D30) — métricas e unidades diferentes, nenhum par.

Os 5 `UNKNOWN` **continuam UNKNOWN**. Verifiquei se algum sairia com evidência já existente:
`agente_decisoes_log` não tem `agente_slug` de João nem de Júlia (os 20 slugs ativos são
`agente-direct`, `agente-exploracao`, `agente-objecoes`…). Resolvê-los exige investigar outra
superfície de log — investigação nova e grande, que §14 proíbe fazer só para fabricar um par.

`taxonomia-produto` **segue rebaixada** e não foi trazida para nenhuma comparação.

---

## §18 — Auto-refutação

| tentativa | resultado |
|---|---|
| denominadores diferentes? | **SIM**: 94/187/221/1237 são universos distintos e nenhum é o denominador natural das duas |
| mesma unidade, significado diferente? | **SIM**, no par crons × atrib |
| populações sobrepostas? | **SIM**: 82% do universo Playbooks está dentro do de Isabela |
| uma frente é upstream da outra? | **SIM, provado por código**: a função da Isabela devolve um playbook |
| uma é causa e outra sintoma? | sim, na mesma direção do item acima |
| efeito medido é só correlação? | pior: **não há efeito** — 3,8 pp com erro-padrão de 4,3 pp |
| horizonte diferente? | sim entre crons (D7 original) e atrib (D30) |
| intervenção não é alternativa real? | **SIM** — não dá para escolher entre criar o playbook e entregar o playbook |
| não temos efeito incremental? | **correto, para as duas** |

Nove tentativas, nove procedem em pelo menos um dos pares. Nenhum par sobrevive.

---

## §19 — Gate para o GPS shadow: **NÃO AUTORIZADO**

| condição | exigido | obtido |
|---|---|---|
| ≥ 2 frentes acionáveis | sim | 28 ✓ |
| ≥ 1 par ECONOMICAMENTE_COMPARAVEL | 1 | **0** ✗ |
| ou ≥ 1 par OPERACIONALMENTE_COMPARAVEL com decisão suportada | 1 | **0** ✗ |

Nenhum par chegou sequer a `OPERACIONALMENTE_COMPARAVEL`.

---

## §20 — Veredito

**`PLAYBOOKS_ISABELA_NAO_COMPARAVEIS`** — provado por código (upstream/downstream) e por dado
(82% de sobreposição), não por semântica de nome.

**`NENHUM_PAR_COMPARAVEL_AINDA`** — o segundo candidato também caiu, e não há terceiro entre as
28 sem inventar unidade.

O resultado mais útil da rodada não é o veredito: é que **a premissa econômica de
`playbooks-cobrir-buracos-forca` foi testada contra a fonte canônica e não sobreviveu.** Ter
playbook para a combinação da objeção não muda a taxa de compra posterior de forma
distinguível de ruído. A R65 mediu corretamente a lacuna (112 objeções sem cobertura); a R66
mostra que fechá-la não tem retorno de conversão demonstrado. As duas coisas são verdadeiras
ao mesmo tempo, e ambas ficam registradas.

---

## Próximo passo

1. **Parar de procurar par entre as frentes atuais.** Nove refutações independentes é sinal de
   que o backlog acionável de hoje não contém alternativas econômicas — contém uma cadeia
   (playbooks → isabela) e um conjunto de trabalho de infraestrutura.
2. **`converteu_depois` precisa virar desfecho de verdade** ou ser retirado. Hoje é cópia de
   `resolvido` e induz qualquer leitor ao erro.
3. **Reconciliar o critério da Isabela com o código**: a frente promete oferta e restrições
   comerciais; a função devolve playbook e ignora `oferta_sugerida_id`, preenchido em 345 de
   500 objeções.
4. Um par legítimo provavelmente só aparece quando duas frentes **independentes** tiverem
   efeito incremental medido sobre o mesmo desfecho canônico. Nenhuma das 28 tem isso hoje.

---

## Objetos desta rodada

**Criados:** `frente_par_teste` (append-only) + `fn_par_teste_append_only()` e trigger.
**Registrados:** 2 testes de par; 1 nova avaliação em `frente_economia` (efeito incremental de
playbooks: 3,8 PCT, D90, **BAIXA**) — que **não refuta** a medição da R65, apenas acrescenta
que a lacuna não tem retorno demonstrado.
**Alterados:** nenhum. **Removidos:** nenhum.

Verificado após a escrita: 0 frentes criadas ou atualizadas, 0 versões de campo, 0 esperas
encerradas, 0 crons novos, 0 scores criados, executor/GPS/tick com hashes idênticos,
`taxonomia-produto` ainda rebaixada, censo 28/28 intacto.

Rollback: `DROP TABLE frente_par_teste; DROP FUNCTION fn_par_teste_append_only();` — a
avaliação nova permanece no contrato R64 por ser append-only e verdadeira.
