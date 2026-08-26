# R74 — Pré-registro do experimento sequencial de reativação

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY / SPEC.
Nenhuma mensagem, nenhuma randomização, `policy = false`, canário intocado.

**Regra central:**
> Canário responde "é seguro executar?". Experimento responde "a intervenção causa melhora?".
> Não usar um para responder o outro.

---

## §0 — Reancoragem: a população não derivou

Reconstruída do zero: **FREQ_2_3 = 47 elegíveis / 29 contatáveis** (R$ 29.515,53) ·
FREQ_4_PLUS = 21 / 16. Idêntico à R72/R73.

---

## §22 — O artefato

`ops/r74/PRE-REGISTRO-EXP-REATIVACAO-V1.md`
**sha256 `9a9ece2577b49591f330d73d82cbce98c1d48bba85b42e6230b33c8e6be59b56`**

Registrado em `experimento_preregistro` (append-only, trigger bloqueia UPDATE e DELETE),
versão `EXP-REATIV-V1`, estado **`NAO_INICIADO`**. Nova versão só por novo INSERT, declarando o
que mudou e por quê.

---

## §13/§14 — O que foi congelado, e o custo do desenho sequencial

| parâmetro | valor |
|---|---|
| teste | Fisher exato, **unilateral** |
| α global | 0,05 |
| **α por checkpoint** | **0,0294** (correção tipo Pocock, 3 análises) |
| poder alvo | 80% |
| checkpoints | n = 20, 40, 60 por grupo |

O unilateral **não** foi escolhido para ganhar poder: o dano possível está coberto por uma regra
de parada independente do outcome econômico (HARM), não pelo teste.

**Cenários de planejamento — nenhum é uplift esperado**, com α ajustado:

| cenário | N/grupo | N total | meses a ~12 novos/mês |
|---|---|---|---|
| 10% → 15% | 700 | 1.400 | ~114 |
| 10% → 20% | 225 | 450 | ~35 |
| 10% → 25% | 105 | 210 | ~15 |
| **10% → 30%** | **70** | **140** | **~9** |

**O desenho sequencial custa N, não economiza.** Para +10 pp: 175/grupo com α = 0,05 fixo contra
**225/grupo** com α = 0,0294 — cerca de 25% a mais. O que ele compra é outra coisa: poder parar
cedo se o efeito for grande, e acumular sem ter de fixar uma data antes de saber o fluxo. Dado
que a população chega a ~12/mês, isso vale o custo.

**Poder no N realista (60×60):** 9,6% (+5 pp) · 28,1% (+10 pp) · 53,2% (+15 pp) · **75,8% (+20 pp)**.

---

## §15/§16/§17 — As três paradas, decididas antes

**EFFICACY** — p ≤ 0,0294 no Fisher unilateral em um dos três checkpoints. Probabilidade de
parar cedo, se o efeito real for +20 pp: **24%** em n=20, **54%** em n=40, **76%** em n=60.
Nunca parar porque "parece bom".

**FUTILITY** — parar em n=60 se não atingir p ≤ 0,0294 **e** o poder condicional para +20 pp cair
abaixo de 20%. Sustentar além disso significa esperar **mais de 15 meses** para detectar efeitos
menores que +15 pp — prazo incompatível com a decisão que se quer tomar. Isso evita o experimento
eterno.

**HARM — vence significância.** Interrompe independentemente do outcome econômico: opt-out acima
do limite · qualquer reclamação · bloqueio de número · contato fora da população · qualquer
incidente de compliance.

---

## §9/§10 — ITT escrito antes de existir dado

Quem for randomizado permanece no grupo original. No braço tratamento, se a revalidação
pré-envio falhar (recomprou, perdeu consentimento, entrou em conversa), **não se envia — e o
cliente continua no grupo tratamento**, marcado `randomizado_nao_exposto` com o motivo.

Essa regra está congelada exatamente para que a amostra não seja escolhida depois de ver o
resultado. Per-protocol pode ser reportada, **nunca** no lugar da ITT.

---

## §23 — Auto-refutação: uma tentativa derrubou parte do desenho

| tentativa | resultado |
|---|---|
| **baseline 10,2% instável?** | **PROCEDE, e é o risco dominante** — ver abaixo |
| D30 inadequado? | **não** — em FREQ_2_3, D7 e D14 capturam 2,0% cada; seriam janelas cegas |
| FREQ_2_3 heterogêneo demais? | **não detectável**: 2 compras → 12,1% (4/33), 3 compras → 6,3% (1/16). Com esse n, indistinguíveis — e sem poder para afirmar homogeneidade |
| fluxo de ~12/mês se sustenta? | **parcialmente** — cruzamentos maduros por mês: 2, 11, 13, 23. Cresce, mas há só **76 clientes de 2–3 compras dentro do ciclo** hoje, e a inclinação inicial é artefato de truncamento |
| sequencial traz pouco ganho? | **procede em parte** — custa ~25% mais N; compra parada antecipada e acumulação sem data fixa |
| levaria tempo demais? | **sim para efeitos pequenos** — daí a regra de futility |
| controle sofre contaminação? | **risco real** — 9 dos 45 contatáveis estão na fila legada; se ela disparar, contamina |
| intervenção já ocorre por outra via? | **não** — R69/R70 provaram que a máquina nunca disparou |
| mesmo com uplift, dá para calcular retorno? | **não** — `calcme_itens_pedido` vazia |

### O risco dominante, declarado no próprio pré-registro

O baseline de 10,2% vem de **5 eventos em 49 cruzamentos**.
**IC95% de Wilson: [4,4% ; 21,8%]** — um intervalo de **cinco vezes**.

Todo o dimensionamento repousa nesse número. Por isso o pré-registro contém uma regra explícita:
**reestimar o baseline pelo próprio braço de controle em cada checkpoint** e reportar o N
recalculado — sem alterar outcome, alocação ou regras de parada.

(Para contraste, FREQ_4_PLUS tem baseline 59,4% com IC95% [49,9% ; 68,3%] — bem estimado, e é
justamente por ser alto que essa classe fica fora.)

---

## §2 — FREQ_4_PLUS: `NAO_INTERVIR_NESTE_EXPERIMENTO`

Formalizado. Seis em dez voltam sozinhos em 30 dias. **Não é "nunca reativar"** — é que a
hipótese atual não justifica intervenção nessa classe.

---

## §18/§19 — Economia

Podemos medir uplift em conversão e receita observada. **Não podemos afirmar lucro, ROI ou
payback.** Se houver uplift, **margem por pedido vira o gap bloqueante para escala** — escalar
sem ela é decidir no escuro. Registrado no pré-registro, não deixado implícito.

---

## §24 — Veredito

**`EXPERIMENTO_PREREGISTRADO`**, com **`BASELINE_INSUFICIENTE`** declarado como risco dominante
dentro do próprio pré-registro.

Não escolhi `EXPERIMENTO_ECONOMICO_NAO_VIAVEL`: o desenho é executável para efeitos de +20 pp em
~9 meses. Não escolhi `POPULACAO_INSUFICIENTE`: 29 hoje é insuficiente para rodar, e por isso o
desenho é sequencial, não fixo. Não escolhi `DESENHO_SEQUENCIAL_NAO_VANTAJOSO`: ele custa N, mas
é o único compatível com uma população que chega a ~12/mês.

---

## §25 — Próximo passo

**Nenhuma exposição antes de 04/09/2026.** Depois do fechamento do canário vigente:

1. revisar o resultado do canário `tiago-brevo-luciana-resultado`
2. se a governança liberar: `RUN_IN_SEGURANCA` com 5–8 pessoas — **entrega e compliance apenas**
3. se PASS: iniciar o experimento sequencial sob `EXP-REATIV-V1`
4. MAPA acompanha, Worker Econômico interpreta
5. **nenhuma escala sem margem**

---

## Objetos desta rodada

**Criados:** `experimento_preregistro` (append-only, com trigger) ·
`ops/r74/PRE-REGISTRO-EXP-REATIVACAO-V1.md` · `ops/r74/seq.py` (cálculo de N, poder e IC,
reproduzível) · `_r74_cliente` (artefato de reancoragem).
**Registrados:** 1 pré-registro `EXP-REATIV-V1`, estado `NAO_INICIADO`.
**Alterados:** nenhum. **Enviados:** nenhum. **Randomizações:** nenhuma.

Gate: 0 envios · 0 WABA novo · `policy = false` · campanhas 21/1/1 · canário `em_andamento` com
espera aberta · audiência V2 inalterada (45) · nenhuma tabela de randomização/tratamento criada.

> Nota: o gate acusou 1 frente atualizada nas últimas 2 h — `joao-correcao-contexto-intencao`,
> às 22:26, sobre um caso orgânico da Carolina em 26/08. Não tem relação com reativação e esta
> rodada não emitiu nenhuma escrita em `frentes`. É trabalho paralelo de outro operador.

Rollback: `DROP TABLE experimento_preregistro, _r74_cliente; DROP FUNCTION fn_preregistro_append_only();`
