# PRÉ-REGISTRO — Experimento sequencial de reativação
**versão:** `EXP-REATIV-V1` · **congelado em:** 2026-08-26 · **estado:** `NAO_INICIADO`

Este documento é o contrato do experimento. Foi escrito **antes de qualquer exposição** e antes
de qualquer resultado existir. Alterá-lo depois do primeiro randomizado invalida o pré-registro.

---

## 1. População

**Incluídos.** Cliente econômico (`cliente_key` de `vw_fato_comercial_identidade_canario`) que,
no instante da avaliação, satisfaz todas as condições:

- `n_compras` entre 2 e 3 → classe **FREQ_2_3**
- `dias_desde_ultima_compra` no intervalo `(83,5 ; 250,5]` — isto é, entre o p90 e 3×p90 da
  própria classe → estado **ESFRIANDO** (R72)
- existe ao menos um lead com telefone, `consentimento = true` e sem registro em
  `crm_contact_optouts`

**Excluídos.**

| exclusão | motivo |
|---|---|
| **FREQ_4_PLUS** | baseline espontâneo D30 de 59,4% (IC95% 49,9–68,3). Ver §2 |
| FREQ_1 | não é cliente recorrente |
| `MUITO_ANTIGO` (> 250,5 d) | retorno espontâneo medido em 0,0% acima de 3×p90 |
| `AINDA_NO_CICLO` / `RECOMPROU_RECENTEMENTE` | não está fora do ciclo |
| sem consentimento, opt-out, sem canal | não contatável |
| task humana aberta, conversa nos últimos 7 dias, objeção aberta | contaminação operacional |

**Nunca** selecionar por resultado futuro. **Nunca** usar `crm_campaign_audiences` legado como
fonte — a fonte é o cliente econômico (R72), e a fila legada foi provada quase disjunta
(680 de 694 sem correspondência).

---

## 2. FREQ_4_PLUS: `NAO_INTERVIR_NESTE_EXPERIMENTO`

Baseline D30 de **59,4%** após cruzar o próprio p90 (30,9 dias). Seis em dez voltam sozinhos.
Headroom pequeno e alto risco de falar com quem já ia comprar.

Isto **não** significa "nunca reativar FREQ_4_PLUS". Significa que **a hipótese atual não
justifica intervenção** nessa classe.

---

## 3. Fase 1 — `RUN_IN_SEGURANCA` (canário operacional)

**Quando:** apenas depois de 04/09/2026, com o canário `tiago-brevo-luciana-resultado` fechado e
revisado, e apenas se a governança liberar.

**Quem:** 5 a 8 clientes elegíveis.

**Objetivo exclusivo:** entrega, opt-out funcionando, compliance, provider, copy, revalidação,
ausência de incidente.

**Proibido:** medir uplift. Estes clientes **não entram** na inferência causal da Fase 2.

### Gate do canário — decidido agora

| resultado | condição |
|---|---|
| **PASS** | 100% dos envios com opt-out no texto · 0 envios a cliente que recomprou entre seleção e envio · 0 envios duplicados · 0 contatos fora da população · opt-out ≤ limite da política · 0 reclamações · 0 falhas de provider sem terminal observável |
| **FAIL** | qualquer item acima violado uma vez → corrigir e repetir o canário |
| **STOP** | reclamação relevante · incidente de compliance · envio durante conversa ou task incompatível → interromper e escalar para decisão humana |

Tolerância **não** pode ser redefinida depois de observar o resultado.

---

## 4. Fase 2 — Experimento causal

Só começa após **PASS**. Novos elegíveis entram continuamente (§10) e são randomizados na entrada.

- **Tratamento:** recebe uma intervenção de reativação padronizada.
- **Controle:** não recebe intervenção nova.
- **Ambos** continuam recebendo a operação normal da empresa.

Copy não faz parte deste pré-registro: o que está congelado é *que existe uma intervenção*, não
seu texto.

---

## 5. Randomização

- **Unidade: cliente econômico** (`cliente_key`). Nunca lead. A R72 já garante 1 cliente = 1 linha
  e mediu 0 clientes com mais de um lead na população-alvo.
- Alocação **1:1**.
- Um cliente entra **uma única vez**, para sempre.
- A persistir, quando implementado: `cliente_key`, `grupo`, `randomizado_em`, `versao_experimento`.
- Sem estratificação além da própria restrição a FREQ_2_3 — o N não suporta células adicionais.

---

## 6. Outcome primário

**Compra canônica em D30** após a randomização, medida em `vw_fato_comercial_identidade_canario`,
por cliente econômico.

**Justificativa da janela D30:** na classe FREQ_2_3, D7 e D14 capturam **2,0% cada** — seriam
janelas cegas. D30 captura 10,2%.

**Nunca** como outcome primário: resposta, clique, proposta, `resolvido`, `converteu_depois`,
`converteu_em` da audiência.

### Outcomes secundários (pré-definidos, não substituíveis)

resposta · conversa retomada · proposta · receita observada · opt-out · reclamação ·
bloqueio · tempo até compra.

Se um secundário parecer melhor durante a execução, **o primário não muda**.

---

## 7. Estatística

| parâmetro | valor | justificativa |
|---|---|---|
| teste | **Fisher exato, unilateral** | N pequeno inviabiliza aproximação normal; unilateral porque a hipótese de dano é tratada pela regra de HARM (§9), não pelo teste de eficácia |
| α global | **0,05** | |
| α por checkpoint | **0,0294** | correção tipo Pocock para 3 análises |
| poder alvo | **80%** | |
| checkpoints | n = 20, 40, 60 por grupo | fixos, definidos agora |

O teste unilateral **não** foi escolhido para ganhar poder: o dano possível está coberto por uma
regra de parada independente do outcome econômico (§9).

### Cenários de planejamento — **nenhum é uplift esperado**

Baseline 10%, com α ajustado:

| cenário | N/grupo | N total | meses a ~12 novos/mês |
|---|---|---|---|
| 10% → 15% | 700 | 1.400 | ~114 |
| 10% → 20% | 225 | 450 | ~35 |
| 10% → 25% | 105 | 210 | ~15 |
| **10% → 30%** | **70** | **140** | **~9** |

Poder num N realista de 120 (60×60): **9,6%** (+5 pp) · **28,1%** (+10 pp) · **53,2%** (+15 pp) ·
**75,8%** (+20 pp).

---

## 8. Regras de parada

**EFFICACY.** Parar por benefício apenas se o Fisher unilateral atingir p ≤ 0,0294 num dos três
checkpoints. Probabilidade de parar por eficácia, se o efeito real for +20 pp: 24% em n=20,
54% em n=40, 76% em n=60.

**FUTILITY.** Parar por futilidade quando, no checkpoint n=60 por grupo, o resultado não atingir
p ≤ 0,0294 **e** o poder condicional restante para +20 pp cair abaixo de 20%. Motivo: sustentar o
experimento além disso significa esperar mais de 15 meses para detectar efeitos menores que
+15 pp — prazo incompatível com decisão de negócio.

**HARM — vence significância.** Interromper imediatamente, independentemente do outcome econômico,
por: opt-out acima do limite da política · qualquer reclamação · bloqueio de número · erro de
targeting (contato fora da população) · qualquer incidente de compliance.

---

## 9. ITT e revalidação

**Análise principal: intention-to-treat.** Quem foi randomizado permanece no grupo original.

No braço tratamento, imediatamente antes de enviar, revalidar (R71/R72): ainda FREQ_2_3? ainda
fora do ciclo? não recomprou? consentimento válido? sem opt-out? canal válido? sem conversa ou
task bloqueante? policy liberada?

**Se falhar: não enviar — e o cliente permanece no grupo tratamento para a análise ITT**,
registrado como `randomizado_nao_exposto` com o motivo. Esta regra está escrita **antes** de
qualquer dado existir, precisamente para que a amostra não seja escolhida depois.

Análise per-protocol pode ser reportada como **secundária**, nunca no lugar da ITT.

---

## 10. Entrada contínua

A audiência não é congelada. Um cliente entra quando cruza o limiar econômico. Na entrada:
revalidar a regra R72 → verificar contatabilidade → randomizar.

---

## 11. Contaminação

Registrar por cliente, sem excluir retrospectivamente: campanha externa · mensagem humana ·
outra automação · e-mail · remarketing · task comercial · atendimento ativo.

Contaminação vira **análise secundária**, nunca substitui a ITT. Atenção específica: **9 dos 45
contatáveis estão na fila de campanha legada** — se ela um dia disparar, contamina os dois braços.

---

## 12. Economia

**Podemos medir:** uplift em conversão · receita observada por grupo.
**Não podemos afirmar:** lucro incremental · ROI · payback.

`calcme_itens_pedido` está vazia e `calcme_pedidos` congelada desde 10/02/2026. Se o experimento
mostrar uplift real, **margem por pedido passa a ser o gap bloqueante para qualquer decisão de
escala** — escalar sem ela seria decidir no escuro.

---

## 13. Risco dominante declarado: **o baseline é incerto**

O baseline de 10,2% vem de **5 eventos em 49 cruzamentos**. IC95% de Wilson:
**[4,4% ; 21,8%]** — um intervalo de cinco vezes.

Todo o dimensionamento acima depende dele. Regra pré-registrada: **reestimar o baseline a partir
do próprio braço de controle em cada checkpoint** e reportar o N recalculado. Se o baseline
observado no controle sair do IC atual, o dimensionamento é refeito e declarado — sem alterar
outcome, alocação ou regras de parada.

---

## 14. Versão

`EXP-REATIV-V1`. Qualquer alteração após o primeiro cliente randomizado exige nova versão e
declaração explícita do que mudou e por quê.
