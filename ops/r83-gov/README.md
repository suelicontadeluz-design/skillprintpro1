# R83-GOV — Seleção Worker-aware: canário passou, Worker voltou a executar

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** implementação mínima + canário reversível.

---

## VEREDITO

```
MODELO_D_CANARIO_VALIDADO
```

Primeiro trabalho real de Worker desde **17/08**. Cadeia completa provada:

```
portão → seleção → claim → trabalho → evidência → transição → postflight
  ✅       ✅        ✅       ✅          ✅          ✅          ✅
```

---

## §0 — Reancoragem (com uma divergência menor, registrada)

| | esperado | vivo |
|---|---|---|
| trilhas ativas | 18 | **18** ✅ |
| trilhas que liberam frente com **0 pontos** | 18/18 | **9 liberam frente, 9/9 com 0 pontos** |
| `governanca` | p1 sem ponto, `crons` p3 com 8 | idem ✅ |
| `aprendizado` | liberada sem ponto, 3 frentes com pontos | idem ✅ |
| `total_selecionaveis` | 0 | **0** ✅ |

**Divergência registrada:** a R82-GOV escreveu "0 pontos na liberada em 18/18". O número exato é
**9 trilhas liberam frente e todas as 9 têm 0 pontos**; as outras 9 não liberam nada
(`AMBIGUA`, `NENHUMA`, `TODAS_AGUARDANDO`). O fato material é o mesmo — nenhuma frente liberada
carrega trabalho de Worker — mas o "18/18" era uma contagem imprecisa.

---

## §3 — GATE: a rota humana **não** é barreira exclusiva (provado, não inferido)

Este era o gate de parada. Li o portão de execução, `fn_frente_claim`, inteiro. Ele exige, nesta
ordem:

1. frente existe e não está `fechada`/`arquivada`
2. claim exclusivo por frente
3. `chat_ja_possui_frente` — um chat, uma frente
4. `dependencia_insatisfeita` — deps resolvidas
5. `trilha_inexistente` / `trilha_inativa`
6. **`trilha_ocupada` — no máximo UMA frente ativa por trilha**
7. insere claim com token

**A palavra "rota" não aparece em `fn_frente_claim`, e ele não chama `fn_gps_proxima`.** A rota
existe apenas dentro de `fn_gps_proxima`, e o contrato lá é explícito sobre o que ela é:

> "ROTA_ESCOLHIDA é decisão humana e tem precedência sobre o **desempate automático**."

Desempate, não exclusividade. Rota responde "qual é a prioridade", não "ninguém mais trabalha
nesta trilha".

Bônus: o invariante da §10 (uma frente por trilha) **já é garantido pelo banco** — não precisei
implementar nada para isso.

---

## §1, §2, §5 — O que foi criado

Uma função nova, `fn_microloops_23_proxima_v2_canario()`. **`fn_gps_proxima` e
`fn_microloops_23_proxima` não foram tocadas.** A v2 **não tem nenhum consumidor** — o Worker
continua chamando a v1.

```
FASE 1  trilha precisa ter rota resolvida (UNICA ou ROTA_ESCOLHIDA). Senão ABSTÉM.
FASE 2  a frente liberada VENCE se tiver ponto endereçável;
        se não tiver, desce para a primeira frente acionável da MESMA trilha,
        por prioridade e precedência vigentes.
        Máximo UMA frente por trilha.
```

Ordenação exata (uma única cláusula, sem regra duplicada):

```sql
order by (frente_slug = frente_liberada) desc,  -- §9: rota com ponto vence
         prioridade asc,                        -- §7: não fura prioridade
         precedencia asc nulls last,            -- desempate vigente
         frente_slug asc
```

Ponto endereçável usa **apenas critérios já existentes**: `aplicabilidade='OBRIGATORIO'`, estado
em `PENDENTE/EM_TRABALHO/REFUTADO/AGUARDANDO`, frente `elegivel` e `acionavel`. Capability Router
não foi conectado.

---

## §7, §8, §9 — Testes sintéticos da regra de ordenação (nenhum dado tocado)

Apliquei a cláusula idêntica sobre um conjunto sintético:

| cenário | esperado | obtido | |
|---|---|---|---|
| **S7** liberada sem ponto; p2 e p3 têm ponto | `p2` | `p2` | **PASS** |
| **S8a** liberada p1 sem ponto | desce para `p3` | `p3` | **PASS** |
| **S8b** a mesma liberada p1 **ganha** ponto | **volta para p1** | `p1` | **PASS** |
| **S9** rota p3 com ponto vs p1 com ponto | rota vence | `rota-p3` | **PASS** |
| **S10** empate de prioridade | precedência menor | `frente-b` | **PASS** |

**S8b é o teste que importa:** D não abandona a prioridade superior. No instante em que a frente
prioritária ganha trabalho endereçável, ela volta sozinha para a frente.

---

## §6, §11 — Replay shadow das 18 trilhas

| status | trilhas |
|---|---|
| **IGUAL** | **17** |
| **DIVERGE** | **1** — `governanca` |

| | |
|---|---|
| `old_selection` | `(nenhuma)` |
| `new_selection` | **`crons-sucesso-sem-efeito`** |
| `divergence_reason` | "frente liberada não tem ponto endereçável; primeira acionável da trilha por prioridade" |

**Gate da §11: PASS.** A única divergência é explicável exatamente pela razão permitida. Nenhuma
frente extra liberada.

`aprendizado` continua abstendo apesar de ter 3 frentes com pontos — porque nenhuma delas é
`acionavel`. D não força trabalho onde há espera legítima.

---

## §12, §13 — Canário real

| elo | resultado |
|---|---|
| **portão** | v1 = **0** · v2 = **8** |
| **seleção** | `governanca` → `crons-sucesso-sem-efeito` (p3), 8 pontos, 17 trilhas abstidas |
| **claim** | `claim_criado`, token emitido, TTL 60 min |
| **trabalho** | 1 ponto: `agente-observacao` / `prova_externa` |
| **evidência** | `microloops_23_ponto_evento` id **195** |
| **transição** | `PENDENTE` → **`REFUTADO`** · refutados 2 → **3** · pendentes 39 → **38** |
| **postflight** | `claim: liberado`, frente segue `em_andamento` |

### O trabalho que foi feito de verdade

O contrato de `prova_externa` exige `efeito_externo`, `envio_provider_id`,
`terminal_operacional`, ou ledger de envio equivalente. Para `agente-observacao`:

| observável | resultado |
|---|---|
| `efeito_externo = true` | **0** de 1.874 decisões |
| `envio_provider_id` não nulo | **0** |
| `terminal_operacional` | **nulo em 1.874 de 1.874** |
| `mensagem_envio` com `autor_id='agente-observacao'` | **0** |
| `waba_disparos_lista` com evento de observação | **0** |
| `agente_execution_events` | **0** |

E ainda assim, em 30 dias: **256 `alerta_enviado` + 21 `alerta_critico_enviado`**, com o texto do
alerta no payload (*"agente-noturno: 23 erros nas últimas 2h"*).

**A ação se chama "enviado" e não há nenhum registro de que algo tenha saído.** É a tese da
frente `crons-sucesso-sem-efeito` confirmada em mais um agente.

`REFUTADO`, não `NAO_APLICAVEL`: o agente declara enviar alerta, então o ponto se aplica e a prova
falha.

### Um comportamento correto que parecia bug

Durante o claim, `fn_microloops_23_proxima_v2_canario()` devolveu **0**, não 8. Motivo:
`vw_frentes_elegiveis` marcou `elegivel=false, acionavel=false, claim_na_frente=true,
motivo=frente_ocupada`. A frente sob claim sai do pool — exclusividade funcionando. Depois do
postflight voltou a **8**.

---

## §13, §8-de-colaterais — O que permaneceu intacto

| verificação | estado |
|---|---|
| rota humana | **vigente**, `revogada_em` = **NULA** |
| prioridades | `crons`=p3, `gps-microloops`=p1, `ricardo-saude`=p1 — inalteradas |
| precedência | 49 linhas, **nenhuma criada** |
| esperas abertas | **54**, nenhuma encerrada |
| `max_workers` | **1** |
| Worker B | continua bloqueada |
| claims ativos ao fim | **(nenhum)** |
| `fn_gps_proxima` / `fn_microloops_23_proxima` | **não alteradas** |
| consumidores da v2 | **(nenhum)** — o Worker segue na v1 |
| frentes com acionabilidade alterada | **0** |
| `comprovados` | **76** — inalterado; o canário refutou, não carimbou |

Nenhum dos gatilhos de rollback da §14 ocorreu: a frente selecionada foi a esperada, nenhuma
frente endereçável mais prioritária foi pulada, houve uma só frente na trilha, a rota não foi
ignorada (ela simplesmente não tinha ponto), o claim foi respeitado, e nenhum efeito saiu do
ponto escolhido.

---

## §15 — Generalização: **não promover ainda**

O replay pós-canário das 18 trilhas devolve o mesmo quadro: 1 seleção, 17 abstenções. A v2
continua sem consumidor de propósito.

Promover globalmente exigiria: (a) trocar a chamada do Worker de v1 para v2, e (b) reobservar as
18 trilhas quando mais de uma tiver frente endereçável — cenário que **hoje não existe**, porque
`crons-sucesso-sem-efeito` é a única frente do sistema com ponto pendente e acionável. Validar D
com uma trilha só e promover para 18 seria generalizar de n=1.

---

## ROLLBACK

```sql
-- 1. remover a funcao canario (sem consumidor, seguro)
drop function if exists public.fn_microloops_23_proxima_v2_canario();

-- 2. desfazer a evidencia (append-only: refuta-se, nao se apaga)
insert into microloops_23_ponto_evento(agente_slug,codigo,estado,evidencia,fonte_observavel,refuta_evento_id,registrado_por)
values('agente-observacao','prova_externa','PENDENTE','<motivo>','<fonte>',195,'<quem>');

-- 3. restaurar os textos da frente (valores anteriores preservados abaixo)
```

`onde_paramos` anterior:
> "Nao e que todo cron falhe: 11 falham e 5 funcionam. A frente virou lista nominal. Criterios 1 e
> 2 seguem FAIL, mas a razao mudou: nao falta mais instrumento, falta VOLUME ORGANICO, porque
> muitos dos 58 chamadores sao diarios ou semanais. Isso e espera de evento organico, nao trabalho
> pendente."

`proximo_passo` foi **preservado byte-a-byte** no postflight — não precisa de restauração.

O claim já foi liberado; não há lease pendente.

---

## Próximo passo

Não iniciado. A decisão em aberto é se o Worker passa a consumir a v2 — e ela só deveria ser
tomada com pelo menos duas trilhas com frente endereçável simultânea, para que o invariante
"uma frente por trilha" seja exercitado em produção e não só no teste sintético.
