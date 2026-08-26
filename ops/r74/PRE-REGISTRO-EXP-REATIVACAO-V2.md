# PRÉ-REGISTRO — Experimento sequencial de reativação
**versão:** `EXP-REATIV-V2` · **congelado em:** 2026-08-26 · **estado:** `NAO_INICIADO`
**substitui:** `EXP-REATIV-V1` (sha256 `9a9ece2577b49591f330d73d82cbce98c1d48bba85b42e6230b33c8e6be59b56`),
que permanece íntegro e não foi sobrescrito.

Escrito **antes de qualquer exposição e antes de qualquer randomização**. Alterá-lo depois do
primeiro cliente randomizado exige V3 com delta declarado.

---

## 0. Delta em relação à V1 — o que mudou e por quê

A V1 continha um elemento adaptativo informal. Três correções:

### D1 — §13 permitia refazer o dimensionamento com dado do controle

V1 dizia: *"reestimar o baseline a partir do próprio braço de controle em cada checkpoint e
reportar o N recalculado. Se o baseline observado no controle sair do IC atual, o dimensionamento
é refeito"*.

Isso é **reestimação não-cega de tamanho amostral sem método formal** — exatamente a adaptação
informal que não pode existir num pré-registro. Pior: era autocontraditório, porque prometia
"sem alterar regras de parada" enquanto movia o N do qual as paradas dependem.

**Corrigido:** ver §13, opção **A. BASELINE_DESCRITIVO**.

### D2 — a V1 nunca declarava um N máximo

A tabela de cenários listava N por cenário; "N realista de 120 (60×60)" aparecia só num cálculo
de poder; e o checkpoint de futilidade era n=60. Não havia nenhuma linha fixando o teto. Sem teto,
"refazer o dimensionamento" não tinha limite.

**Corrigido:** `N_MAX = 70 por braço = 140 total`, imutável.

### D3 — os checkpoints não terminavam no N máximo

V1 fixava 20/40/60 e, ao mesmo tempo, o cenário-alvo (+20 pp) exigia 70 por braço. O desenho não
fechava: a última análise não era a análise final.

**Corrigido:** checkpoints `20 / 40 / 70`, sendo 70 a análise final. Poder no final, para a
alternativa pinada: **82,7%** (contra 75,5% que a V1 teria em 60/braço — abaixo do próprio alvo
de 80% que ela declarava).

### D4 — FUTILITY usava alternativa móvel

"poder condicional para +20 pp" não dizia +20 pp **sobre qual baseline**. Se o baseline fosse
reestimado (D1), o alvo se moveria junto.

**Corrigido:** alternativa **pinada** em 10,2% → 30,2%, fixa para sempre.

**Não mudou:** população, exclusões, FREQ_4_PLUS fora, tratamento, controle, randomização por
cliente econômico 1:1, outcome primário, janela D30, outcomes secundários, α global 0,05,
α por checkpoint 0,0294, teste Fisher exato unilateral, ITT, revalidação pré-envio, contaminação,
regra de HARM, entrada contínua, proibição de usar a fila legada.

---

## 1. População

Cliente econômico (`cliente_key` de `vw_fato_comercial_identidade_canario`) que, no instante da
avaliação, satisfaz todas as condições:

- `n_compras` entre 2 e 3 → classe **FREQ_2_3**
- `dias_desde_ultima_compra` em `(83,5 ; 250,5]` — entre p90 e 3×p90 da classe → **ESFRIANDO**
- ao menos um lead com telefone, `consentimento = true` e sem registro em `crm_contact_optouts`

**Excluídos:** FREQ_4_PLUS (§2) · FREQ_1 · `MUITO_ANTIGO` · `AINDA_NO_CICLO` ·
`RECOMPROU_RECENTEMENTE` · sem consentimento, opt-out ou sem canal · task humana aberta, conversa
nos últimos 7 dias, objeção aberta.

**Nunca** selecionar por resultado futuro. **Nunca** usar `crm_campaign_audiences` legado como
fonte — a fonte é o cliente econômico V2 (R72), e a fila legada foi provada quase disjunta
(680 de 694 sem correspondência).

## 2. FREQ_4_PLUS: `NAO_INTERVIR_NESTE_EXPERIMENTO`

Baseline D30 de **59,4%** (IC95% 49,9–68,3) após cruzar o próprio p90 de 30,9 dias. Não significa
"nunca reativar": significa que a hipótese atual não justifica intervenção nessa classe.

## 3. Fase 1 — `RUN_IN_SEGURANCA`

Só depois de 04/09/2026, com o canário `tiago-brevo-luciana-resultado` fechado e revisado, e com
liberação de governança. **5 a 8 clientes.** Objetivo exclusivo: entrega, opt-out, compliance,
provider, copy, revalidação, ausência de incidente. **Proibido medir uplift.** Estes clientes
**não entram** na inferência causal da Fase 2.

**PASS** — 100% dos envios com opt-out no texto · 0 envios a quem recomprou entre seleção e envio ·
0 duplicados · 0 contatos fora da população · opt-out ≤ limite da política · 0 reclamações ·
0 falhas de provider sem terminal observável.
**FAIL** — qualquer item violado uma vez → corrigir e repetir.
**STOP** — reclamação relevante · incidente de compliance · envio durante conversa ou task
incompatível → interromper e escalar.

Tolerância não pode ser redefinida depois de observar.

## 4. Fase 2 — Experimento causal

Só após PASS. Tratamento recebe uma intervenção de reativação padronizada; controle não recebe
intervenção nova; **ambos** seguem recebendo a operação normal. Copy não faz parte deste
pré-registro.

## 5. Randomização

Unidade **cliente econômico**, nunca lead. Alocação **1:1**. Um cliente entra **uma única vez**.
A persistir: `cliente_key`, `grupo`, `randomizado_em`, `versao_experimento`. Sem estratificação
além da restrição a FREQ_2_3.

## 6. Outcome primário

**Compra canônica em D30** após a randomização, em `vw_fato_comercial_identidade_canario`, por
cliente econômico. Janela D30 porque em FREQ_2_3 as janelas D7 e D14 capturam **2,0% cada** —
seriam cegas.

**Nunca** como primário: resposta, clique, proposta, `resolvido`, `converteu_depois`,
`converteu_em`.

**Secundários (não substituíveis):** resposta · conversa retomada · proposta · receita observada ·
opt-out · reclamação · bloqueio · tempo até compra.

---

## 7. Estatística — congelada

| parâmetro | valor |
|---|---|
| teste | Fisher exato, **unilateral** |
| α global | **0,05** |
| α por checkpoint | **0,0294** (tipo Pocock, 3 análises) |
| **checkpoints** | **n = 20, 40, 70 por braço** — 70 é a análise final |
| **N_MAX** | **70 por braço · 140 total** — imutável |
| poder no N_MAX, alternativa pinada | **82,7%** |

**Alternativa pinada:** controle **10,2%** → tratamento **30,2%** (+20 pp). Este par é o alvo de
planejamento e **não se move**, aconteça o que acontecer com o baseline observado.

Cenários de planejamento — **nenhum é uplift esperado** (baseline 10%, α ajustado):

| cenário | N/grupo | N total | meses a ~12 novos/mês |
|---|---|---|---|
| 10% → 15% | 700 | 1.400 | ~114 |
| 10% → 20% | 225 | 450 | ~35 |
| 10% → 25% | 105 | 210 | ~15 |
| **10% → 30%** | **70** | **140** | **~9** |

**Consequência aceita:** se o efeito real for menor que +20 pp, este desenho provavelmente
**não o detectará** e terminará por futilidade ou por N_MAX sem significância. Isso é o preço de
um N limitado pelo fluxo, e é informação — não fracasso.

---

## 8. Regras de parada — congeladas

**EFFICACY.** Fisher unilateral com p ≤ 0,0294 em qualquer um dos três checkpoints. Nunca parar
porque "parece bom".

**FUTILITY.** Avaliada em **n=20 e n=40** por braço (não na análise final, onde seria inócua).
Parar se o **poder condicional** de rejeitar em n=70, sob a **alternativa pinada 10,2% → 30,2%**,
cair **abaixo de 20%**. Poder condicional calculado por enumeração exata
(`ops/r74/conditional_power.py`), reproduzível. Exemplos pré-calculados:

| checkpoint | trat × ctrl | poder condicional | dispara? |
|---|---|---|---|
| n=20 | 0 × 4 | 18,6% | **sim** |
| n=20 | 1 × 4 | 25,5% | não |
| n=40 | 0 × 2 | 9,4% | **sim** |
| n=40 | 1 × 2 | 15,2% | **sim** |
| n=40 | 2 × 2 | 23,1% | não |
| n=40 | 2 × 4 | 5,9% | **sim** |

Parada por futilidade é conservadora para o erro tipo I — só reduz a chance de rejeitar H₀.

**HARM — vence significância.** Interrompe independentemente do outcome econômico: opt-out acima
do limite da política · qualquer reclamação · bloqueio de número · contato fora da população ·
qualquer incidente de compliance.

---

## 9. ITT e revalidação

**Análise principal: intention-to-treat.** Quem for randomizado permanece no grupo original.

No braço tratamento, imediatamente antes de enviar: ainda FREQ_2_3? ainda fora do ciclo? não
recomprou? consentimento válido? sem opt-out? canal válido? sem conversa ou task bloqueante?
policy liberada?

**Se falhar: não enviar — e o cliente permanece no grupo tratamento**, marcado
`randomizado_nao_exposto` com o motivo. Regra escrita antes de qualquer dado existir, para que a
amostra não seja escolhida depois. Per-protocol só como análise secundária.

## 10. Entrada contínua

A audiência não é congelada. Na entrada: revalidar R72 → verificar contatabilidade → randomizar.

## 11. Contaminação

Registrar por cliente, sem excluir retrospectivamente: campanha externa · mensagem humana · outra
automação · e-mail · remarketing · task comercial · atendimento ativo. Vira análise **secundária**,
nunca substitui a ITT. Atenção: **9 dos 45 contatáveis estão na fila legada** — se ela disparar,
contamina os dois braços.

## 12. Economia

**Podemos medir:** uplift em conversão · receita observada por grupo.
**Não podemos afirmar:** lucro incremental · ROI · payback.
`calcme_itens_pedido` vazia, `calcme_pedidos` congelada desde 10/02/2026. Se houver uplift,
**margem por pedido vira o gap bloqueante para escala**.

---

## 13. Baseline: **A. BASELINE_DESCRITIVO** — decisão congelada

O baseline pré-registrado é **10,2%**, de 5 eventos em 49 cruzamentos, IC95% de Wilson
**[4,4% ; 21,8%]**.

O baseline observado no braço de controle **será** calculado e reportado em cada checkpoint,
**exclusivamente para interpretação e relatório**.

**Ele NÃO pode alterar, em nenhuma hipótese:**

| congelado |
|---|
| α global (0,05) |
| α por checkpoint (0,0294) |
| boundaries de eficácia |
| checkpoints (20 / 40 / 70) |
| **N_MAX (70 por braço, 140 total)** |
| alternativa pinada da futilidade (10,2% → 30,2%) |
| limiar de futilidade (poder condicional < 20%) |
| regra de HARM |
| outcome primário, janela, alocação, população |

**Por que A e não B.** A opção adaptativa formal (promising zone tipo Mehta-Pocock, ou estatística
ponderada tipo Cui-Hung-Wang) existe e é legítima, mas: com N_MAX de 140 e desfecho binário raro,
o ganho é marginal; e exigiria implementação e auditoria de uma estatística ponderada que ninguém
neste sistema poderia verificar de forma independente hoje. Complexidade não auditável já se
provou fonte de defeito nas rodadas anteriores. **A opção A preserva o erro tipo I trivialmente e
mantém a prova imutável.**

**Custo aceito e declarado:** se o baseline verdadeiro estiver perto do piso do IC (4,4%), o
desenho fica subdimensionado e provavelmente encerra por futilidade. Se estiver perto do teto
(21,8%), +20 pp absolutos passam a ser um efeito relativo menor e igualmente difícil. Nos dois
casos o resultado é reportado como é, e o aprendizado sobre o baseline entra na próxima versão —
**depois** do experimento, nunca durante.

## 14. Versão

`EXP-REATIV-V2`. Substitui a V1 sem apagá-la. Qualquer alteração após o primeiro cliente
randomizado exige V3 com delta declarado.
