# R75 — Fechar o último gate estatístico do pré-registro

**Data:** 2026-08-26 · **Modo:** READ-ONLY / SPEC. Nenhum envio, nenhuma randomização,
população intocada, outcome intocado, `policy = false`.

**Regra:**
> Podemos aprender o baseline durante o teste; não podemos aprender o resultado e depois mudar a
> prova que ele precisa passar.

---

## §2 — Onde a V1 usava baseline, poder, N, futility, efficacy e checkpoints

Auditei o documento inteiro. Sete pontos de uso, e **quatro deles estavam acoplados ao baseline**:

| linha | regra | acoplada ao baseline? |
|---|---|---|
| §7 α global / α por checkpoint | 0,05 / 0,0294 | não |
| §7 checkpoints | 20 / 40 / 60 | não diretamente |
| §7 poder alvo | 80% | **sim** — via cenários |
| §7 tabela de cenários | N por cenário | **sim** |
| §8 EFFICACY | p ≤ 0,0294 | não |
| §8 FUTILITY | "poder condicional para +20 pp" | **sim** — alternativa móvel |
| §13 | *"o dimensionamento é refeito"* | **sim** — e sem método |

---

## §3 — Decisão: **A. BASELINE_DESCRITIVO**

O baseline observado no controle será calculado e reportado em cada checkpoint,
**exclusivamente para interpretação**. Não pode alterar α, boundaries, checkpoints, N_MAX,
alternativa pinada, limiar de futilidade, HARM, outcome, janela, alocação ou população.

**Por que não B.** A adaptação formal existe e é legítima — promising zone tipo Mehta-Pocock, ou
estatística ponderada tipo Cui-Hung-Wang. Recusei por dois motivos concretos: com N_MAX de 140 e
desfecho binário raro o ganho é marginal; e exigiria uma estatística ponderada que ninguém neste
sistema conseguiria auditar de forma independente hoje. Complexidade não auditável já se provou
fonte de defeito nas rodadas anteriores.

A opção A preserva o erro tipo I trivialmente e mantém a prova imutável.

**Custo aceito e declarado:** se o baseline verdadeiro estiver perto do piso do IC (4,4%), o
desenho fica subdimensionado e encerra por futilidade. Se estiver perto do teto (21,8%), +20 pp
absolutos viram um efeito relativo menor e igualmente difícil. Nos dois casos reporta-se como é —
o aprendizado sobre o baseline entra numa próxima versão **depois** do experimento, nunca durante.

---

## §4/§5 — A V1 não estava só ambígua. Estava incoerente. **V2 criada.**

Ao fixar a regra do baseline, três defeitos apareceram e não dava para deixá-los passar:

| # | defeito na V1 | correção na V2 |
|---|---|---|
| **D1** | §13 mandava *"refazer o dimensionamento"* com dado não-cego do controle, sem método formal — e prometia "sem alterar regras de parada" enquanto movia o N do qual elas dependem | opção **A**, com lista explícita do que o baseline **não** pode tocar |
| **D2** | **nenhum N máximo era declarado.** A tabela listava cenários; "N realista de 120" aparecia só num cálculo de poder | **`N_MAX = 70 por braço = 140 total`**, imutável |
| **D3** | checkpoints em 20/40/**60**, mas o cenário-alvo exigia **70** por braço: a última análise não era a análise final | checkpoints **20 / 40 / 70**, com 70 como análise final |
| **D4** | FUTILITY dizia "poder condicional para +20 pp" sem dizer **sobre qual baseline** — se o baseline se movesse, o alvo se movia junto | alternativa **pinada** em **10,2% → 30,2%**, fixa para sempre |

**D3 tinha consequência numérica real:** o poder no último checkpoint da V1 (60/braço) era
**75,5%** — abaixo do próprio alvo de 80% que ela declarava. Com N_MAX = 70: **82,7%**.

### Futility recalculada e pré-tabulada

Avaliada em **n=20 e n=40** (não na análise final, onde seria inócua), por enumeração exata
(`ops/r74/conditional_power.py`):

| checkpoint | trat × ctrl | poder condicional | dispara futilidade? |
|---|---|---|---|
| n=20 | 0 × 4 | 18,6% | **sim** |
| n=20 | 1 × 4 | 25,5% | não |
| n=40 | 0 × 2 | 9,4% | **sim** |
| n=40 | 1 × 2 | 15,2% | **sim** |
| n=40 | 2 × 2 | 23,1% | não |
| n=40 | 2 × 4 | 5,9% | **sim** |

Em n=20 a regra só dispara em caso extremo — conservadora, não mata o estudo cedo. Em n=40
discrimina bem. E parada por futilidade é conservadora para o erro tipo I: só reduz a chance de
rejeitar H₀.

---

## §4 — O que permaneceu congelado

População · exclusões · FREQ_4_PLUS fora · tratamento · controle · randomização por cliente
econômico 1:1 · outcome primário · **janela D30** · outcomes secundários · **α 0,05 / 0,0294** ·
Fisher exato unilateral · **ITT** · revalidação pré-envio · contaminação · **HARM** · entrada
contínua · proibição de usar a fila legada.

---

## Veredito

**`PREREGISTRO_PRONTO_PARA_EXECUCAO`** — na versão **V2**.

A V1 **não** estava pronta: continha reestimação não-cega de N sem método, sem teto declarado, com
checkpoints que não fechavam no N máximo e com alternativa de futilidade móvel. Não era uma
ambiguidade de redação — era um caminho aberto para mudar a prova depois de ver o resultado.

---

## Objetos desta rodada

**Criados:** `ops/r74/PRE-REGISTRO-EXP-REATIVACAO-V2.md`
(sha256 `e8d4354083170d0b9aec521cf7c36e61de631408edab4ec70cec679da84d723b`) ·
`ops/r74/conditional_power.py` (poder condicional por enumeração exata, reproduzível).
**Registrado:** `EXP-REATIV-V2` em `experimento_preregistro`, estado `NAO_INICIADO`.

**V1 preservada, byte a byte** — arquivo e linha de banco intactos, hash
`9a9ece2577b49591…` conferido. A tabela é append-only com trigger bloqueando UPDATE e DELETE:
V2 é um INSERT, nunca uma sobrescrita.

Gate: 0 envios · 0 WABA novo · `policy = false` · campanhas 21/1/1 · 0 randomizações ·
população FREQ_2_3 contatável inalterada (29) · canário `em_andamento`.

---

## Próximo passo

Inalterado: **nenhuma exposição antes de 04/09/2026**. Depois do fechamento do canário vigente —
revisar resultado → `RUN_IN_SEGURANCA` de 5–8 se a governança liberar → se PASS, iniciar sob
**`EXP-REATIV-V2`** → nenhuma escala sem margem.
