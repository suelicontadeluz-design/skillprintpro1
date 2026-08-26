# R71 — Contrato de validade da audiência de reativação

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY.
Nenhuma campanha ativada, nenhuma audiência expirada, nenhuma mensagem enviada, canário intocado.

**Regra central:**
> Campanha antiga não significa cliente ainda elegível. No momento de enviar, a realidade do
> cliente precisa ser verdadeira novamente.

---

## §0 — Reancoragem R70

`policy.ativo = false` · 21 rascunho / 1 pausada / 1 em_execucao · produtor ≥ v1.5.0 compliant ·
0 mensagens, audiências ou envios desde a R70 · canário `tiago-brevo-luciana-resultado`
**em_andamento** com espera `evento_organico` aberta desde 21/08.

---

## §4 — O achado que decide a rodada

Dos **694 leads distintos** com linha pendente:

| | leads |
|---|---|
| **nunca compraram nada** | **561 (81%)** |
| já compraram alguma vez | 133 |
| ⤷ **já voltaram a comprar DEPOIS de entrar na audiência, sem receber nada** | **33 (24,8% dos 133)** |

Confirmado por dupla via: `_r68_lead_fatos` e `pixel_events` dão os mesmos 133.

**Uma audiência chamada "reativação" é 81% composta de gente que nunca foi cliente.** Reativar quem?

E os 33 que voltaram sozinhos são **os melhores clientes da lista**:

| | |
|---|---|
| compras médias | **5,1** |
| LTV observado médio | **R$ 2.726,73** |
| receita histórica somada | R$ 89.982,05 |
| mediana de dias até voltarem, após entrar na fila | **15,6 dias** |
| mediana de dias desde a última compra, **hoje** | **12 dias** |

Se a fila disparasse agora, essas pessoas receberiam *"ainda tem interesse na estamparia?"*
estando a 12 dias da última compra.

---

## §6 — O ciclo natural de recompra é curto

1.096 intervalos entre compras consecutivas:

| população | n | p25 | mediana | p75 | **p90** |
|---|---|---|---|---|---|
| todos | 1.096 | 3,1 d | **7,4 d** | 18,7 d | **35,2 d** |
| clientes 2–3 compras | 157 | 4,0 d | 13,8 d | 34,6 d | **83,7 d** |
| clientes 4+ compras | 939 | 3,1 d | 7,0 d | 16,2 d | **31,2 d** |

Isso cross-valida a R68: o degrau de recência que ela achou entre 31–60 dias coincide com o
**p90 de 31,2 dias** dos compradores frequentes.

E mata a ideia de TTL único: **p90 de 83,7 dias para quem tem 2–3 compras contra 31,2 para quem
tem 4+.** Um prazo só estaria errado para uma das duas populações.

---

## §13 — Simulação da regra candidata sobre os pendentes de hoje

| classe | leads | com consentimento | **contatáveis** | receita histórica | compras médias |
|---|---|---|---|---|---|
| **A — nunca comprou** (não é reativação) | **561** | 166 | 166 | — | — |
| **B — comprou depois de entrar** (deve sair) | 33 | 10 | 10 | R$ 89.982,05 | 5,1 |
| C — ainda no ciclo (≤ p75, 19 d) | **0** | — | — | — | — |
| D — esfriando (19–35 d) | **0** | — | — | — | — |
| **E — fora do ciclo (> 35 d) = alvo real** | **100** | 32 | **32** | R$ 87.999,80 | **1,6** |

**A população realmente testável hoje é 32 leads.** Não 1.879, não 1.099, não 686.

E há uma ressalva que o Worker Econômico precisa ouvir: a classe E tem **1,6 compras em média**
— são compradores de uma vez só, **não** o segmento valioso esfriando que a R68 identificou.
Aquele segmento **não está nesta fila**.

---

## §10 — Elegível economicamente ≠ contatável

`consentimento` é booleano e **só ~30% dos leads pendentes têm `true`**: 166 de 561, 10 de 33,
32 de 100. Existe `crm_contact_optouts` (1 lead pendente listado). Telefone existe para todos em
`leads_marketing`.

As audiências foram montadas **sem filtrar consentimento** — ele só aparece no guardrail final.
É por isso que o número contatável cai a um terço em toda classe.

---

## §12 — TTL fixo × revalidação dinâmica: **B vence, e por medição**

A hipótese do enunciado era que B fosse superior. **Confirmada, com três provas independentes:**

1. **33 leads voltaram sozinhos** com mediana de 15,6 dias após entrar. Qualquer TTL de 30 dias
   os teria mantido "válidos" enquanto já estavam de volta.
2. **O p90 varia 2,7× por frequência** (31,2 vs 83,7 dias). TTL único erra uma das populações.
3. **As classes C e D estão vazias.** Idade da audiência sozinha não separa nada: quem tinha
   compra ou já voltou (B) ou está muito longe (E). O que discrimina é o **estado atual**, não o
   tempo decorrido.

### Tentativa de refutar B (§17)

*"Revalidação dinâmica é cara demais?"* — **não.** A função de enfileiramento **já** faz uma
chamada por lead (`fn_tiago_guardrail_whatsapp_v2`), e a frente `tiago-guardrail-performance`
documenta que esse custo por lead foi diagnosticado (~25 s por causa de um `uuid::TEXT`
destruindo índice) e **corrigido**. O padrão de trabalho por lead no momento do envio já é o
desenho aceito. Acrescentar duas checagens ali não muda a ordem de grandeza.

---

## §11/§14 — O contrato proposto

Não é um TTL. É uma condição avaliada **no instante do envio**:

```
audiencia_valida(lead) =
      tem compra canônica alguma vez                     -- senão não é reativação
  AND não comprou depois de entrar na audiência          -- senão já voltou
  AND dias_desde_ultima_compra > p90 da sua faixa
        de frequência (31 d para 4+, 84 d para 2–3)      -- senão ainda está no ciclo
  AND consentimento = true
  AND não está em crm_contact_optouts
  AND tem telefone
```

E para **campanha nova** (§14), a ordem correta é:
gerar audiência → **revalidar no envio** → validar contato/compliance → policy → envio.
Assim o lixo histórico não é carregado.

---

## §9 — As 21 campanhas legadas

Não é preciso avaliá-las uma a uma para responder a pergunta da §9. A simulação já responde de
forma agregada: das 2.124 linhas pendentes, **as classes C e D estão vazias e 81% dos leads nunca
compraram**. Nenhuma das 21 representa uma população econômica atual — não porque a mensagem
esteja inválida (isso é a R70), mas porque **a audiência descreve uma realidade que já passou**.

---

## §15 — Checklist para 04/09, quando a janela fechar

Nada foi alterado no canário. Registro o que medir:

- **exposição**: quantos destinatários reais, por canal
- **entrega**: entregues / bounce / suprimidos (hoje 4 entregues, 1 hard bounce)
- **resposta**: abertura e clique — hoje **0 e 0**
- **outcome comercial**: pela `vw_objecao_outcome_comercial` (R67) e pelo fato canônico posterior,
  **nunca** por `converteu_em` da audiência, que está zerado
- **controle × tratamento**: com n=5 expostos não existe controle; registrar isso como limite,
  não preencher com comparação inventada
- **efeitos externos e incidentes**: reconferir se houve mutação sem claim, como a de 10/08

---

## §17 — Auto-refutação

| tentativa | resultado |
|---|---|
| a audiência não envelhece? | **envelhece** — 24,8% dos que tinham compra já voltaram sozinhos |
| recompra espontânea é rara demais para importar? | **não** — são justamente os melhores clientes (5,1 compras, LTV R$ 2.726) |
| TTL fixo é suficiente? | **não** — p90 varia 2,7× por frequência e as classes de idade média ficaram vazias |
| revalidação dinâmica é cara demais? | **não** — o custo por lead já existe e já foi otimizado |
| produto muda o ciclo? | **não medido** — `content_category` segue sendo segmento de cliente (R65), e não há fonte de produto confiável. Limite declarado, não contornado |
| dados antigos permitem estimar a janela? | **sim** — 1.096 intervalos observados |
| opt-out impede boa parte da população? | **o opt-out não; o consentimento sim** — só ~30% têm `true` |
| campanha antiga ainda é válida? | **não**, e por dois motivos independentes: mensagem (R70) e audiência (R71) |

---

## §18 — Veredito

**`REVALIDACAO_DINAMICA_RECOMENDADA`** — provada por medição, não por preferência.

E junto, uma verdade desconfortável: **`AUDIENCIA_LEGADA_INVALIDA`**. As 21 filas não descrevem
mais a realidade econômica de ninguém.

---

## §16/§19 — Devolução ao Worker Econômico

**`POPULACAO_TESTAVEL_ATUAL = 32 leads`** contatáveis, fora do ciclo (> 35 dias), com **1,6
compras médias** e R$ 87.999,80 de receita histórica na classe.

**Zero uplift presumido.** E o alerta que importa: esses 32 **não são** o segmento valioso
esfriando da R68 (108 clientes, ≥2 compras). Se o experimento quiser aquele segmento, a audiência
precisa ser **gerada nova**, não herdada.

Nada é executado até 04/09, quando a janela de observação do canário fecha.

---

## Objetos desta rodada

**Criados:** nenhum. **Alterados:** nenhum. **Enviados:** nenhum.
**Registrados:** 2 linhas em `gap_do_mapa` (contrato de revalidação; população testável real).

Gate de segurança: `policy=false` · 0 envios · 0 WABA novo · 0 audiências/mensagens tocadas ·
campanhas 21/1/1 inalteradas · canário `em_andamento` com espera aberta · 93 crons · 0 frentes tocadas.
