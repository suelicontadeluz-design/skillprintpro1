# R82 — Canário do portão do Worker: abortado antes de escrever

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Escritas realizadas: ZERO.**

---

## VEREDITO

```
ABORTADO — CORRECAO_INSEGURA
```

Nenhuma alteração foi aplicada. A cadeia causal proposta —
*"rota stale fechava o portão → removemos só essa trava → o Worker volta a receber trabalho"* —
**é falsa, e foi possível prová-lo lendo o contrato vivo, sem tocar em nada.**

Revogar a rota **não abre** o portão: **fecha ainda mais**.

---

## §0 — Reancoragem: todas as 7 premissas confirmadas ao vivo

| # | premissa | estado vivo |
|---|---|---|
| 1 | rota ativa da trilha `governanca` | `749cfa92-586f-4b86-acff-f4254ea384e3` → `gps-microloops-23-membresia-fechamento`, por `alessandro`, 18/08 18:25:41 ✅ |
| 2 | `revogada_em` nulo | **NULA** ✅ |
| 3 | frente escolhida | `gps-microloops-23-membresia-fechamento`, `em_andamento`, prioridade 1 ✅ |
| 4 | frente sem pontos `microloops-23` | **0 pontos** ✅ |
| 5 | `crons-sucesso-sem-efeito` | `em_andamento`, `acionavel=true`, `esperas_abertas=0`, **8 pontos obrigatórios pendentes** ✅ |
| 6 | `fn_microloops_23_pode_rodar()` | `total_selecionaveis: 0`, `pode_rodar: false`, parada `NENHUM_PONTO_SELECIONAVEL` ✅ |
| 7 | nada resolveu o impasse depois do diagnóstico | confirmado ✅ |

O estado **não divergiu**. O que não se sustenta é a inferência sobre a causa, não os fatos.

---

## §1 — O mecanismo exato, lido do código

`fn_microloops_23_proxima()` decide seleção com uma linha:

```sql
selecionavel = (g.frente_liberada is not null and g.frente_liberada = pf.frente_slug)
```

e `frente_liberada` só existe em duas situações:

```sql
case fn_gps_proxima(trilha)->>'situacao'
  when 'ROTA_ESCOLHIDA' then rota_escolhida->>'frente'
  when 'UNICA'          then candidatas->0->>'frente'
  else null end
```

`fn_gps_proxima` escolhe a situação assim:

```sql
when (select count(*) from cand) = 1 then 'UNICA'
when exists (select 1 from rota)     then 'ROTA_ESCOLHIDA'
when exists (select 1 from vencedora) then 'UNICA'
else 'AMBIGUA'
```

onde `cand` são apenas as frentes da **melhor prioridade** da trilha.

### O que a trilha `governanca` tem hoje

| frente | prioridade | acionável | **pontos microloops-23 pendentes** |
|---|---|---|---|
| `gps-microloops-23-membresia-fechamento` | **1** | sim | **0** |
| `ricardo-saude-observabilidade-canonica` | **1** | sim | **0** |
| `cerebro-shadow-v2-observador-passivo` | 3 | sim | 0 |
| `claim-recusa-sem-observabilidade` | 3 | sim | 0 |
| **`crons-sucesso-sem-efeito`** | **3** | sim | **8** |
| `qualidade-contexto-frentes-continua` | 3 | sim | 0 |
| `regra-fato-versus-interpretacao` | 3 | sim | 0 |
| `aposentar-trigger-legado-task-mensagem` | 4 | sim | 0 |

**A única frente da trilha que carrega pontos do Worker é prioridade 3.** As duas que o GPS pode
liberar têm zero.

---

## §1 — As três alternativas de rota, avaliadas

### A. Revogar a rota stale — **não funciona, e piora**

Com `revogada_em` preenchido: `cand = 2` (empate em prioridade 1), `rota` vazia, `vencedora`
vazia — o próprio GPS já reporta `cobertura_precedencia: {empatadas: 2, com_precedencia: 0,
todas_cobertas: false}`.

Cai no `else` → **`AMBIGUA`** → `frente_liberada = null` → `selecionavel = false` para **todos**
os pontos da trilha `governanca`, não só os 8.

E destrói uma decisão humana legítima e não revogada.

> A alternativa listada primeiro no pedido é a que fecha mais o portão.

### B. Apontar a rota para `crons-sucesso-sem-efeito` — **exigiria falsificar o registro**

`vw_gps_rota_vigente` só considera vigente uma rota que satisfaça:

```sql
AND (d.frente_slug = ANY (d.candidatas))
```

`candidatas` é o **snapshot do que o humano tinha diante de si** quando decidiu — hoje
`["gps-microloops-23-membresia-fechamento", "ricardo-severidade-kpi-contextual"]`. Para a rota
apontar para `crons-sucesso-sem-efeito`, eu teria de **inserir essa frente no array de candidatas
da decisão**, ou seja, reescrever o histórico do que foi decidido.

Além disso inverteria uma decisão de prioridade escrita pelo dono, cujo motivo é explícito:
*"Priorizar a frente estrutural do GPS antes das demais frentes de governança."*

Não é remover um conflito. É reverter a decisão e forjar a prova dela.

### C. Registrar precedência entre as duas empatadas — **não abre o portão**

Resolveria o empate e devolveria `UNICA`. Mas a vencedora seria uma das duas de prioridade 1, e
**ambas têm zero pontos**. `frente_liberada` passaria a existir e ainda assim não bateria com
`crons-sucesso-sem-efeito`. Portão continua fechado.

### Conclusão

**Não existe alteração no objeto rota que abra o portão sem efeito colateral inaceitável.**
As duas que abririam algo exigem falsificar registro histórico ou reverter prioridade do dono; a
que o pedido preferia não abre nada.

---

## §2 — A rota não está stale

Vale separar: a rota aponta para uma frente **viva, `em_andamento`, prioridade 1 e ainda entre as
candidatas de hoje**. Ela não caducou.

O que mudou desde 18/08 foi a *outra* candidata (`ricardo-severidade-kpi-contextual` saiu,
`ricardo-saude-observabilidade-canonica` entrou). Isso não invalida a escolha registrada.

**O portão está fechado pelo defeito estrutural que esta rodada mandou não tratar:**

> "GPS geral acionável ≠ Worker selecionável"

Concretamente: o GPS libera **apenas a frente de melhor prioridade da trilha**, e o Worker só
seleciona ponto cuja frente seja exatamente a liberada. Como a única frente de `governanca` com
pontos é prioridade 3, ela nunca é candidata, logo nunca é liberada, logo seus 8 pontos ficam
permanentemente `acionavel=true` e `selecionavel=false`.

E há um laço adicional que merece registro: a frente para a qual o dono roteou é justamente
**`gps-microloops-23-membresia-fechamento` — "a iniciativa dos 23 microloops não tem membresia
nem condição de fechamento deriváveis"**. O dono roteou a governança para a frente que existe
para consertar a membresia dos microloops; e o Worker só trabalha em frentes que já têm
membresia de microloop. Essa frente tem zero. **O conserto está atrás da própria trava.**

---

## §3–§5 — Não executados

Nenhuma escrita, nenhum canário. O gate da §10 exige "a mudança foi mínima" **e** "não houve
efeito colateral relevante". Como nenhuma alternativa passa nos dois, a rodada para em §1, que é
o comportamento pedido em §6 ("não force A") e §11 (`CORRECAO_INSEGURA`).

---

## §9 — Antes × depois

| | ANTES | DEPOIS |
|---|---|---|
| `total_selecionaveis` | **0** | **0** (inalterado — nada foi escrito) |
| `pode_rodar` | `false` | `false` |
| rota vigente `governanca` | `gps-microloops-23-membresia-fechamento` | idem |
| `revogada_em` da rota | NULA | **NULA** |
| Worker A | `wake_up → parada_sem_trabalho` | idem |

---

## §8 — Colaterais verificados (todos intactos)

| verificação | estado |
|---|---|
| rotas de outras trilhas | **nenhuma existe**; 1 rota não revogada no sistema inteiro, a de `governanca` |
| decisões humanas revogadas por mim | **0** |
| frentes com acionabilidade alterada | **0** |
| esperas removidas | **0** (54 abertas, intactas) |
| `gps_frente_precedencia` | 49 linhas, intactas |
| Worker B | continua bloqueada |
| `max_workers` | continua **1** |
| crons alterados | **0** |
| pontos de `crons-sucesso-sem-efeito` | continuam **8** |

---

## ROLLBACK

**Não se aplica.** Nenhuma escrita foi feita. Não há o que desfazer.

---

## PRÓXIMO PASSO

```
TRATAR_FALLBACK_GPS_GERAL
```

É a única saída que não exige nem falsificar registro nem reverter a prioridade do dono. O
defeito é o acoplamento `frente_liberada == ponto.frente_slug`: enquanto a seleção do Worker
depender de a frente do ponto ser exatamente a de melhor prioridade da trilha, os 8 pontos de
`crons-sucesso-sem-efeito` ficarão invisíveis por construção — e o mesmo valerá para qualquer
ponto que caia numa frente de prioridade menor.

Duas formas conceituais (nenhuma avaliada nem implementada aqui):
1. fallback: quando a frente liberada não tem pontos, permitir seleção na próxima frente
   acionável da mesma trilha que tenha;
2. dar membresia de microloop à frente roteada — que é literalmente o objetivo declarado de
   `gps-microloops-23-membresia-fechamento`.

A escolha entre as duas é decisão de desenho e não cabia nesta rodada.
