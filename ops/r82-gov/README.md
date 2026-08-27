# R82-GOV — O deadlock não é de bootstrap. É de acoplamento, e vale para 18/18 trilhas.

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY. **Zero escritas.**

---

## VEREDITO

```
ACOPLAMENTO_GLOBAL_DEFEITUOSO
```

Remédio implicado: **modelo D (seletor em duas fases)** — o único dos quatro que destrava sem
furar prioridade humana e que funciona fora da trilha `governanca`.

---

## §1 — Reancoragem (tudo confirmado ao vivo)

| | |
|---|---|
| rota vigente `governanca` | `gps-microloops-23-membresia-fechamento` |
| candidatas prioridade 1 | `gps-microloops-23-membresia-fechamento` (0 pontos) e `ricardo-saude-observabilidade-canonica` (0 pontos) |
| `crons-sucesso-sem-efeito` | prioridade 3, **8 pontos** |
| portão | `total_selecionaveis = 0`, `pode_rodar = false` |

---

## §2 e §7 — O ciclo, e por que ele não é sobre membresia

### O que a busca por "quem concede membresia" encontrou

```sql
-- funções que LEEM microloops_23_frente:   (NENHUMA)
-- funções que ESCREVEM microloops_23_frente: (NENHUMA)
-- funções que LEEM microloops_23_membro:   (NENHUMA)
-- triggers em qualquer das duas:            (nenhum)
```

**As tabelas de membresia são código morto.** `microloops_23_frente` (11 linhas) e
`microloops_23_membro` (23 linhas) não são lidas por nenhuma função do sistema. Elas documentam;
não governam.

O portão real é **`microloops_23_ponto_frente`** (52 linhas), lida por exatamente **uma** função —
`fn_microloops_23_proxima` — e **escrita por nenhuma**. As 11 linhas de `microloops_23_frente`
foram todas criadas em 17/08 por uma única sessão (`claude-20260817-gps-microloops23-4k8m2p`).

**Resposta à §3 — como a primeira membresia deveria nascer?** Ela nunca foi projetada para nascer
por código. Foi escrita à mão, uma vez, por um operador. Não existe bootstrap ausente: **nunca
existiu bootstrap, porque nunca existiu concessão automática.**

Isso refuta a premissa do enunciado: `gps-microloops-23-membresia-fechamento` não é, em nenhum
sentido mecânico, "a frente que concede membresia". Nada concede membresia.

### O ciclo real

```
fn_gps_proxima(trilha)
  → candidatas = SÓ as frentes de MELHOR PRIORIDADE da trilha
  → frente_liberada = rota_escolhida (ROTA_ESCOLHIDA) ou candidatas[0] (UNICA), senão NULL

fn_microloops_23_proxima()
  → selecionavel = (frente_liberada IS NOT NULL AND frente_liberada = ponto.frente_slug)
```

O ponto só é selecionável se **a frente que o carrega for exatamente a frente de melhor
prioridade da trilha**. Não há fallback.

---

## §7 — Generalidade: o defeito é de 18 em 18

Rodei `fn_gps_proxima` em todas as trilhas ativas e cruzei com os pontos pendentes:

| trilha | situação | frente liberada | **pontos na liberada** | frentes com pontos na trilha |
|---|---|---|---|---|
| `aprendizado` | UNICA | `pipeline-memoria-clientes` | **0** | **3** |
| `atribuicao` | UNICA | `atrib-instrumentar-execucao` | **0** | 1 |
| `funil` | UNICA | `joao-shadow-fase-vivo` | **0** | 1 |
| **`governanca`** | ROTA_ESCOLHIDA | `gps-microloops-23-membresia-fechamento` | **0** | 1 |
| `identidade` | UNICA | `religar-calcme-fonte-canonica` | **0** | 1 |
| `retencao` | UNICA | `fidelimax-ligar-fidelidade` | **0** | 1 |
| `conversao_isabela`, `erp`, `operacao_humana` | UNICA | (várias) | **0** | 0 |
| `conversao_joao`, `conversao_julia` | AMBIGUA | (nenhuma) | 0 | 1 / 0 |
| `campanhas_crm` e mais 4 | TODAS_AGUARDANDO | (nenhuma) | 0 | 1 / 0 |

**`pontos_na_liberada = 0` em 18 de 18 trilhas.** Oito trilhas liberam uma frente; nenhuma delas
libera uma frente que tenha trabalho para o Worker.

`governanca` **não é um caso especial**. `aprendizado` tem **três** frentes com pontos e libera
uma com zero. O que a rota humana fez em `governanca` foi apenas tornar o caso visível.

### E já funcionou

`microloops_23_wakeup_canario` guarda três medições de **17/08**, todas com
**`selecionaveis: 9`** e `comprovados: 76`.

Hoje: `selecionaveis: 0`, **`comprovados: 76`**.

A coincidência entre "frente que o GPS libera" e "frente que carrega pontos" existia e acabou.
**Zero pontos comprovados em dez dias.** O sistema não regrediu por decisão: parou porque a
coincidência de que ele dependia deixou de ocorrer.

---

## §4, §5 e §6 — Os quatro modelos, replayed contra o estado vivo

| modelo | selecionáveis **hoje** | frentes | **cenário futuro** (esperas resolvidas) | fura prioridade? | múltiplas frentes/trilha? | fail-closed? | serve às outras 17 trilhas? |
|---|---|---|---|---|---|---|---|
| **ANTES** | **0** | 0 | 0 | não | não | sim | — |
| **A** remover acoplamento | **8** | 1 | **39 pontos, 7 frentes, 6 trilhas** | **SIM** | **SIM** | sim | sim |
| **B** bootstrap especial | 0 | 0 | 0 | não | não | sim | **NÃO** — só `governanca` |
| **C** ponto de bootstrap | 0 | 0 | 0 | não | não | sim | **NÃO** — só `governanca` |
| **D** duas fases | **8** | 1 | **31 pontos, 5 frentes, 5 trilhas — 1 por trilha** | não | **não** | sim | sim |

### Por que B e C não resolvem nada

Ambos partem da premissa refutada na §2. **B** exigiria classificar quais frentes são "de
bootstrap" — conceito sem nenhum dado que o sustente. **C** exigiria dar um ponto a
`gps-microloops-23-membresia-fechamento`; mas ponto é um par `(agente, código)` de um catálogo
fechado de 8 códigos (`acao`, `entrada_observada`, `kpi_meta`, `prova_externa`, …), sempre ligado
à prova de **um agente**. Não há agente cuja prova pertença a uma meta-frente. Inventar um seria
fabricar o fato.

E o decisivo: **os dois consertariam 1 trilha de 18.**

### A e D dão o mesmo número hoje — e são muito diferentes

Hoje ambos liberam os mesmos 8 pontos, porque `crons-sucesso-sem-efeito` é a **única** frente do
sistema com pontos pendentes e acionáveis. A diferença aparece no cenário futuro:

- **A** libera **39 pontos em 7 frentes e 6 trilhas de uma vez**, ignorando rota e prioridade.
  Fura explicitamente a decisão humana — o que a regra central desta rodada proíbe.
- **D** libera **31 pontos, uma frente por trilha**, e só em trilhas cuja rota está resolvida
  (`UNICA` ou `ROTA_ESCOLHIDA`); trilhas `AMBIGUA`, `NENHUMA` e `TODAS_AGUARDANDO` continuam
  fechadas. Mantém o invariante de uma frente por trilha e continua fail-closed.

### O ponto que legitima D

A frente roteada pede, no próprio `proximo_passo`:

> "AÇÃO DE EXECUÇÃO, NÃO DECISÃO: materializar o fonte byte-exato da edge `agente-pipeline`
> ACTIVE v59"

A R80 e a R81 já provaram que `OBTER_FONTE_EXATA_DE_EDGE` **não tem executor no Cérebro**. Ou
seja: a frente de prioridade 1 não está esperando o Worker — ela espera uma capacidade que o
sistema não tem, e que hoje só um humano exerce.

Segurar todo o resto atrás dela não é respeitar prioridade. É **parada permanente**. D não pula a
decisão humana: reconhece que, quando a frente liberada não tem trabalho em formato de ponto, o
Worker simplesmente não é o executor daquela frente — e desce para a próxima frente **da mesma
trilha, por ordem de prioridade**, que tenha.

### O critério "não liberar arbitrariamente os 8 só porque existem"

D não os libera por existirem. Libera porque, nesta ordem: (1) a trilha `governanca` tem rota
resolvida; (2) a frente liberada não é endereçável pelo Worker; (3) `crons-sucesso-sem-efeito` é
a frente **de maior prioridade dentre as acionáveis da mesma trilha** que carrega ponto. Em
qualquer trilha `AMBIGUA` ou sem rota, D não libera nada.

---

## §6 — Antes × depois (simulado, nada aplicado)

| | selecionáveis | frente | ponto | motivo |
|---|---|---|---|---|
| **ANTES** | **0** | — | — | `frente_liberada` ≠ frente de todo ponto |
| **D** | **8** | `crons-sucesso-sem-efeito` | 8 `prova_externa` (aprovacao, atribuicao, autonomia, insights, laboratorio, memoria, mercado, observacao) | trilha com rota resolvida → frente liberada sem ponto → primeira acionável por prioridade com ponto |

---

## §8 — Veredito e por que não é bootstrap

`BOOTSTRAP_AUSENTE_PROVADO` e `PONTO_BOOTSTRAP_AUSENTE` foram descartados por evidência, não por
preferência: **nenhuma função lê ou escreve as tabelas de membresia**, então não há mecanismo de
concessão que pudesse ter um bootstrap faltando. A primeira elegibilidade nasceu à mão, em 17/08,
e o loop funcionou (9 selecionáveis) enquanto a frente roteada por acaso coincidia com uma frente
com pontos.

`SELETOR_DUAS_FASES_NECESSARIO` descreve o remédio, mas o **defeito** provado é anterior a ele:

```
ACOPLAMENTO_GLOBAL_DEFEITUOSO
```

`selecionavel = (frente_liberada = ponto.frente_slug)` amarra duas noções independentes — "a
frente mais prioritária da trilha" e "a frente que carrega trabalho do Worker" — e depende de
elas coincidirem. Hoje coincidem **0 vezes em 18**.

---

## Próximo passo (não iniciado)

Desenhar e testar o modelo D em shadow, com três invariantes que o replay já mostrou serem
verificáveis: uma frente por trilha, só em trilha com rota resolvida, e ordem de prioridade
dentro da trilha. Nada disso foi implementado nesta rodada.

---

## Gate de segurança

| verificação | observado |
|---|---|
| escritas | **0** — rodada inteiramente READ-ONLY |
| rota humana revogada | **0** (`revogada_em` da `749cfa92` segue NULA) |
| prioridades alteradas | **0** |
| precedência criada | **0** (49 linhas, intactas) |
| pontos liberados | **0** (`total_selecionaveis` segue 0) |
| guard global removido | **0** |
| Worker/GPS alterados | **0** |
