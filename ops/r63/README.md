# R63 — Conectar o MAPA econômico ao loop de decisão, em shadow

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY para descobrir a cadeia; objetos NOVOS e isolados para o shadow.
**Zero** alteração em GPS, prioridade, frentes, agentes, gating, campanha ou dinheiro.

**Regra central:**
> Não basta o MAPA saber. Precisamos provar que a informação do MAPA chega ao ponto onde
> uma decisão é tomada.

---

## §0 — Reancoragem R62 (LIVE, confirmada)

`fn_mapa_cerebro_v0` intacta · `fn_mapa_cerebro_econ_v2` válida e superset · `cliente_economico`
presente · gating intacto (`fn_lead_eh_recorrente`, `fn_julia_pode_atender`,
`fn_agente_automatico_pode_atender`, `vw_clientes_recorrentes_chat`,
`julia_atende_recorrentes=false`) · GPS não consome V2.

> **Deriva viva durante a rodada:** no início da R63 a base estava em 181 ALTA / 33 BAIXA /
> R$ 645.223,80. Ao fim: **182 ALTA / 32 BAIXA / R$ 645.340,00**, piso 184. Uma venda nova
> promoveu um cliente de BAIXA para ALTA. Não é erro: é a base viva.

---

## §1/§2 — A cadeia real que decide "o que atacar agora"

Provada por código e por uso, não por arquitetura desenhada:

```
cron `executor-tick-deterministico`   */15 * * * *   (950 execuções em 10 dias)
  └─ fn_executor_tick()
       1. encerra esperas observáveis satisfeitas
       2. recolhe claims sem heartbeat
       3. v_sel := fn_executor_proxima_tarefa()      ←── AQUI a prioridade é escolhida
            └─ para cada trilha ativa, por gps_trilha_precedencia:
                 fn_gps_proxima(trilha)
                   └─ vw_frentes_elegiveis  → frentes.prioridade (smallint GRAVADO)
                   └─ gps_frente_precedencia / vw_gps_rota_vigente  (desempate)
                 fn_executor_pode_prosseguir(frente)  (quarentena / progresso)
            └─ ORDER BY prioridade, precedencia_trilha  LIMIT 1
       4. grava a decisão em `executor_ticks`
```

O próprio corpo da função declara: *"Tick determinístico: zero token de LLM."*
**Nenhum modelo participa da escolha de prioridade.**

---

## §3 — O MAPA é órfão: **MAPA_ORFAO**

| onde procurei | resultado |
|---|---|
| funções que citam `fn_mapa_cerebro_v0` / `_econ_v2` | **0** |
| views | **0** |
| crons ativos | **0** |
| `pg_stat_statements` (10 dias) | 28 chamadas, **todas pela role `postgres`** — nenhuma por `authenticator`/`service_role`, que é como toda edge function chega ao banco |
| repositório (37 arquivos) | só o próprio runbook da R62 |
| `prompt_rules`, `prompt_versions`, `prompt_proposals`, `agentes`, `agente_prompt_backup`, `sistema_mapa`, `sistema_config`, `cerebro_futuro`, `agente_memoria` (447), `memoria_contexto_uso` (1652), `agente_chat_comandos`, `webhook_configs`, `frentes` (268) | **0 ocorrências** |
| `cerebro-vendas` (edge, lida por inteiro) | usa `fn_contexto_meta_cerebro`, `fn_prompt_rules_ativas`, `fn_contexto_real_cliente`, `fn_calcular_score_base` — **não** o MAPA |

Função existente ≠ função operacionalmente usada. **O MAPA econômico nunca chegou a nenhuma decisão.**

---

## §4 — O GPS é de backlog: **GPS_DE_BACKLOG**

`vw_frentes_elegiveis` lê `frentes.prioridade` **como está gravado**. Todo o resto da view é
portão: estado, trilha, claims, dependências, esperas, `retomar_em`. Zero receita, zero
cliente, zero LTV, zero gap.

`prioridade` é **parâmetro de entrada** de `fn_frente_canonica_criar(..., p_prioridade smallint, ...)`.
Quem cria escolhe o número.

Origem das 268 frentes: `auditoria` 136 · `alessandro` 107 · `incidente` 25. **Nenhuma econômica.**

**A prova mais dura do desacoplamento:** o schema já tem `frentes.impacto_mes_estimado`.
Só **6 das 268** o preenchem (2 vivas), variando de R$ 0 a R$ 19.828 — e **todas as 6 têm
`prioridade = 3`**. Impacto econômico declarado não move a prioridade em nenhum caso.

`GPS_ECONOMICO` não existe.

---

## §5/§6 — Entrada econômica mínima, com confiança embutida

`fn_mapa_econ_minimo()` — derivada de UMA chamada materializada de `fn_mapa_cerebro_econ_v2()`.
Não entrega o JSON gigante; entrega o necessário, e **nunca** a recorrência como número único:

```
recorrencia: { total 216, ALTA 182, MEDIA 2, BAIXA 32, NAO_RECORRENTE 294,
               taxa_pct 42.35, receita_ALTA 412859.89, receita_MEDIA 1888.28,
               receita_BAIXA 38644.17, piso_se_so_deal_canonico 184 }
```

Mais: receita comercial / atribuível / %, LTV observado médio e mediano com
`ltv_nao_e_previsao: true`, concentração, recompra por coorte, e cinco `ressalvas`
explícitas — incluindo os 32 BAIXA, a Igreja MEDIA e a contradição C6.

`fora_do_escopo_deste_dado`: margem por pedido, capacidade produtiva, estoque, caixa.

---

## §7 — Shadow conectado

Objetos novos, todos isolados, nenhum consumidor de produção:

| objeto | papel |
|---|---|
| `fn_mapa_econ_minimo()` (plpgsql) + `_sql` | entrada econômica mínima |
| `_r63_econ_snapshot` + `fn_r63_econ_snapshot_atualizar()` | snapshot periódico |
| `fn_r63_gaps(jsonb)` | os 4 gaps estruturados |
| `fn_r63_ponte_territorio(text)` | ponte gap ↔ backlog, com qualidade declarada |
| `fn_r63_shadow_rodada()` | `DECISAO_OLD` × `DECISAO_COM_MAPA_V2_SHADOW` |
| `_r63_shadow_decisoes` | registro append-only do que o shadow escolheria |

O shadow **não executa, não prioriza produção, não cria frente, não muda fila**.

---

## §8/§9 — A primeira pergunta é o GAP, não a ação

Cada gap sai estruturado: `fato`, `evidencia`, `valor_envolvido`, `valor_e`, `confianca`,
`hipoteses_concorrentes`, `dados_faltantes`, `razao_para_nao_agir_ainda`.

| gap | território | valor envolvido | o valor **é** | confiança |
|---|---|---|---|---|
| G3 receita sem campanha | aquisição | R$ 570.595,14 | receita **sem explicação de origem** | MÉDIA |
| G4 concentração | cliente | R$ 348.483,60 | receita **concentrada = exposição** | ALTA |
| G1 compra única | cliente | R$ 191.947,66 | receita **já observada**, não incremental | ALTA |
| G2 recorrência sem prova | cliente | R$ 38.644,17 | receita **com classificação incerta** | ALTA sobre a incerteza |

`criterio_de_ordenacao_dos_gaps`: *valor_envolvido é dinheiro em jogo observado, nunca
retorno esperado. Um gap maior em R$ não é um gap mais urgente.*

Nenhum gap vira ação. FATO, HIPÓTESE e AÇÃO CANDIDATA ficam separados no JSON.

---

## §10 — Território cliente

- top 10% dos clientes = **54,0%** da receita; top 20% = 71,1%
- **294 clientes de 1 compra** = R$ 191.947,66, ticket médio R$ 652,88
- **63 clientes com 6+ compras** = 35,5% da receita
- recompra em **janela fechada de 30d** (Jan–Jun): 69,0 · 39,1 · 25,0 · 37,1 · 21,4 · 34,8

---

## §11 — OLD × SHADOW

| | |
|---|---|
| **OLD escolheu** | `gps-microloops-23-membresia-fechamento` (trilha `governanca`, prioridade 1) |
| **SHADOW apontaria** | gap **G4_CONCENTRACAO** → frente `contas-grandes-encolhidas` |
| **tipo** | `DIVERGENCIA_COM_PONTE_FORTE` |
| **custo** | 257 ms (247 ms são do OLD; a economia custa ~2 ms) |

**Por que divergem:** a ordenação OLD usa `frentes.prioridade` + `gps_trilha_precedencia`.
Nenhum dos dois deriva de receita, cliente ou recorrência. A divergência não é o GPS errando
a própria regra — é o shadow olhando um eixo que o GPS não tem.

### A primeira versão do shadow estava errada e foi corrigida

A primeira rodada apontou `score-leads-campanha-timeout` — um bug de timeout de cron —
como candidato do gap de atribuição. A ponte era **palavra no título** (`%campanha%`), que
puxou 13 frentes sem relação. Corrigido: a ponte agora declara sua própria qualidade
(`FORTE_IMPACTO_DECLARADO` × `FRACA_SO_TEXTO` × `INEXISTENTE`) e **só ponte forte elege
candidato**. Com a regra corrigida, o território `aquisicao` volta `candidato = null`.

---

## §12 — Auto-refutação

1. **"A recorrência está caindo"** — **REFUTADO.** A leitura por coorte aberta mostra
   86,2 → 60,9 → 50,0 → 50,0 → 28,6 → 42,0 → 32,5 → 15,1 e parece uma queda. É artefato de
   janela: janeiro teve 7 meses para recomprar, agosto teve dias. Em **janela fechada de
   30 dias** a série é 69,0 · 39,1 · 25,0 · 37,1 · 21,4 · 34,8 — **oscila, não cai**.
2. **"Compra única piorou"** — **REFUTADO.** A frente `compra-unica-vazamento` foi fechada
   com 236/429 (55,0%). Hoje são 294/510 (57,6%). A **taxa é praticamente a mesma**; o
   absoluto cresceu porque a base cresceu. Não houve deterioração.
3. **"O maior gap é o de R$ 570 mil"** — **não sobrevive como prioridade.** É receita sem
   explicação de origem, com C6 aberto: o denominador nem está acordado. O próprio gap
   carrega `razao_para_nao_agir_ainda`.
4. **"`contas-grandes-encolhidas` vale R$ 19.828/mês"** — **sobrevive parcialmente.**
   Verificação independente hoje: 123 clientes já compraram ≥ R$ 800; dos 62 que voltaram,
   **31 encolheram e 31 mantiveram**. Queda somada R$ 49.064,69; entre os ativos nos últimos
   90 dias, **19 clientes e R$ 23.204,88** — mesma ordem de grandeza da estimativa manual de
   02/08. **Mas** "maior − última compra" é uma diferença pontual, não uma perda mensal
   recorrente: o fenômeno está confirmado, a **taxa mensal não está**.
5. **"Então o GPS deveria estar atacando essa frente"** — **REFUTADO**, e este é o achado
   principal (§14).

Dados que faltam para qualquer ação: **margem por pedido, capacidade produtiva, estoque,
caixa** — todos `FORA_DO_ESCOPO` no próprio MAPA. Sem eles, todo gap do território cliente é
`GAP_NAO_ACIONAVEL_AINDA` no sentido econômico.

---

## §13 — Nenhuma frente criada

O shadow emite `CANDIDATO_DE_PRIORIDADE`, nunca uma frente. Verificado após a rodada:
0 frentes criadas, 0 frentes atualizadas, 0 crons apontando para objetos R63.

---

## §14 — O MAPA muda a decisão? Sim, mas não por mérito do GPS

Replay sobre os ticks reais dos últimos 10 dias:

| | |
|---|---|
| ticks | 930 |
| decisões com escolha | 797 |
| KILL_SWITCH | 92 |
| SEM_TRABALHO | 41 |
| frentes distintas escolhidas | 47 |
| vezes que o OLD escolheu o candidato do shadow | **0** |
| divergência | **797 / 797 = 100%** |

**E a causa não é econômica.** `contas-grandes-encolhidas` está
`elegivel = true` mas **`acionavel = false`**, com `motivo_nao_acionavel = "aguardando:acao_humana"`
— uma espera aberta há **7,0 dias** (*"HUMANO: Tamires contata os 4…"*, aberta em 19/08).

O executor **não podia** tê-la escolhido. A divergência de 100% é artefato de
disponibilidade, não prova de que o GPS priorizou mal.

O que o MAPA acrescenta de verdade, então, é isto: **a frente de maior impacto econômico
declarado e independentemente verificado está parada há 7 dias esperando uma pessoa, enquanto
o loop determinístico gastou 797 ticks em trabalho de governança.** Há **12 esperas
`acao_humana` abertas em 11 frentes**, a mais antiga há 8,1 dias. Isso é informação
decisória real, e nenhuma leitura atual do sistema a expunha ligada a dinheiro.

O shadow foi corrigido para nunca esconder isso: agora carrega
`candidato_acionavel` e `candidato_motivo_nao_acionavel`.

---

## §15 — Performance

| chamada | custo |
|---|---|
| `fn_mapa_cerebro_v0()` quente | 28 ms |
| `fn_mapa_econ_minimo()` quente | 50 ms |
| `fn_executor_proxima_tarefa()` | 38–247 ms |
| **`fn_r63_shadow_rodada()` completa** | **245–257 ms**, dos quais ~2 ms de economia |
| **captura do snapshot econômico (frio, sob carga)** | **38.202 ms** |

**`fn_mapa_cerebro_v0` custa 28 ms quente e dezenas de segundos frio** (observados nesta
rodada e na R62: 589 ms, 2,9 s, 18,2 s, 38,2 s, 58,5 s, >90 s). Chamá-la em linha dentro de um
tick de 15 minutos que se anuncia determinístico seria risco operacional real.

Por isso o shadow **não calcula economia no caminho de decisão**: lê
`_r63_econ_snapshot` e publica `idade_seg` junto — dado velho é aceitável, dado velho
escondido não é.

Três armadilhas registradas, todas encontradas nesta rodada:

1. **CTE não materializada dentro de EXISTS correlacionado.** O bloco de coorte sem
   `AS MATERIALIZED` reexecutava `vw_fato_comercial_identidade_canario` uma vez por cliente
   (~1020 vezes) e passava de 90 s. Com `materialized`: **896 ms**.
2. **Inline de função `LANGUAGE sql`.** Referenciar o resultado N vezes no SELECT duplica o
   corpo N vezes. Resolvido com wrapper `plpgsql` e variáveis.
3. **Medição injusta** (já vista na R59): sem materializar o `jsonb`, o planner elimina a
   chamada e o cronômetro marca 3 ms.

---

## §16 — Veredito

**`MAPA_ESTAVA_ORFAO`** — 0 consumidores em banco, cron, repo, prompts e edges.

**`SHADOW_ECONOMICO_CONECTADO`** — o ponto real de decisão foi encontrado
(`fn_executor_tick → fn_executor_proxima_tarefa`) e existe hoje um caminho paralelo que lê o
MAPA e registra o que escolheria, sem tocar em produção.

**`MAPA_MUDA_DECISAO_COM_EVIDENCIA`, com uma ressalva que não pode ser omitida:** o MAPA
aponta consistentemente para um alvo diferente do que o executor escolhe (100% em 797
decisões), com ponte forte e valor verificado de forma independente — mas o alvo está
**bloqueado por ação humana**, não preterido. O MAPA não provou que o GPS erra; provou que
existe dinheiro parado num eixo que o GPS não enxerga.

**`DADOS_AINDA_INSUFICIENTES`** para agir: sem margem, capacidade e estoque, todo gap do
território cliente permanece `GAP_NAO_ACIONAVEL_AINDA`.

---

## §17 — Próximo passo (proposta, não execução)

1. **Expor esperas `acao_humana` ligadas a dinheiro.** 12 esperas em 11 frentes, a mais antiga
   há 8,1 dias, uma delas com R$ 19.828/mês declarado. É a única coisa desta rodada que já
   tem evidência para virar decisão — e é decisão humana, não automática.
2. **Dar chave econômica à frente** antes de qualquer promoção: `territorio`, `valor`,
   `confianca`, `medido_em`. Hoje `impacto_mes_estimado` é preenchido em 6 de 268 e tem
   `impacto_fonte` em texto livre. Sem essa chave, ponte por palavra é o que sobra, e ponte
   por palavra já errou uma vez nesta rodada.
3. **Não promover o shadow** enquanto (2) não existir e enquanto `fn_mapa_cerebro_v0` puder
   custar 38 s. Snapshot com idade declarada é o contrato mínimo.
4. Resolver **C6** antes de qualquer uso do percentual de atribuição.

---

## Objetos desta rodada

**Criados:** `fn_mapa_econ_minimo()`, `fn_mapa_econ_minimo_sql()`, `fn_r63_gaps(jsonb)`,
`fn_r63_ponte_territorio(text)`, `fn_r63_shadow_rodada()`, `fn_r63_econ_snapshot_atualizar()`,
`_r63_econ_snapshot`, `_r63_shadow_decisoes`.

**Alterados:** nenhum. **Removidos:** nenhum.

Hashes de baseline registrados agora para as próximas rodadas:
`fn_executor_proxima_tarefa` `7a261cf22f21e80e8629dd94146a0b42` (2389 B) ·
`fn_executor_tick` `f59aa14eaa60e8adf4b25dbc686df5d1` (2309 B) ·
`fn_gps_proxima` `b23bbec4b25df7808a60a09c6988cc0a` (5074 B).
Os três foram apenas lidos nesta rodada; nenhum `CREATE OR REPLACE` os alcançou e os
tamanhos batem com a leitura inicial.

Rollback: `DROP FUNCTION fn_r63_shadow_rodada, fn_r63_ponte_territorio, fn_r63_gaps,
fn_r63_econ_snapshot_atualizar, fn_mapa_econ_minimo, fn_mapa_econ_minimo_sql;
DROP TABLE _r63_shadow_decisoes, _r63_econ_snapshot;` — sem efeito colateral, porque nada
em produção os consome.
