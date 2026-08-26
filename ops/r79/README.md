# R79 — Mapa canônico de capacidades, em shadow

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** SHADOW.
Criada estrutura append-only. Nenhum agente reativado, morto, fundido ou criado.
Nenhum cron, prompt ou roteamento automático. **Zero efeito externo.**

**Regra central:** o Cérebro não escolhe "um agente". Ele identifica a capacidade que a
realidade exige e procura um executor com **evidência** de conseguir executá-la.

---

## O que a rodada entregou

| objeto | o que é |
|---|---|
| `capacidade_vocabulario` | 18 capacidades nomeadas, append-only. É o que torna **ausência provável**: sem vocabulário, "ninguém sabe fazer" é indistinguível de "ninguém mapeou". |
| `capacidade_registro` | 16 linhas (15 vigentes), append-only, **8 guards no banco**, FK para o vocabulário. |
| `capacidade_substituicao` | correção sem sobrescrita: a linha errada permanece como histórico e sai da projeção corrente. |
| `vw_capacidade_roteamento_shadow` | leitura que devolve exatamente os 4 resultados permitidos pela §12. **Sem consumidor, sem roteamento.** |

**13 executores, dos quais 6 não são agentes:**

| tipo | n |
|---|---|
| `AGENTE` | 7 |
| `FUNCAO_SQL` | 3 |
| `EDGE` | 1 |
| `HUMANO` | 1 |
| `MISTO` | 1 |

A §1 estava certa: "agente" não é a unidade suficiente. **quase metade dos executores registrados (6 de 13) não
são agentes** — e entre eles está o maior emissor de mensagens do sistema.

---

## §2 — Os 8 guards, e o que cada um impede

| guard | impede |
|---|---|
| `ck_comprovada_exige_execucao` | **COMPROVADA só com `EXECUCAO`, `EFEITO_EXTERNO` ou `CONTAGEM`.** Código nunca prova capacidade comprovada |
| `ck_ausencia_nao_vira_capacidade` | `AUSENCIA_DE_EVIDENCIA` só pode gerar `APENAS_DECLARADA`, `INATIVA` ou `BLOQUEADA` |
| `ck_efeito_exige_status` | efeito externo só em `COMPROVADA` ou `PARCIAL` |
| `ck_declarada_sem_efeito` | `APENAS_DECLARADA` nunca tem efeito externo |
| `ck_bloqueio_exige_motivo` | `acionavel = false` exige `bloqueio` escrito |
| `ck_ninguem_nao_e_acionavel` | consumidor `NINGUEM` não pode ser acionável |
| `ck_evidence_ref_executavel` | `evidence_ref` com ≥25 caracteres: consulta ou caminho de código, não frase |
| `ck_alta_exige_evidencia_dura` | confiança `ALTA` exige evidência dura |

Os 8 foram testados antes de popular: **6 tentativas de inserção inválida, 6 rejeitadas, 0 linhas
gravadas.** `UPDATE` e `DELETE` também foram tentados nas três tabelas e rejeitados pelos triggers.

---

## §4 — O gate Camila, e como ele quase falhou

O gate funcionou, mas não do jeito que eu tinha desenhado. Ao popular, o banco rejeitou a linha
da Camila por `ck_alta_exige_evidencia_dura`: eu havia escrito `evidence_type =
'AUSENCIA_DE_EVIDENCIA'` com `confidence = 'ALTA'`.

A rejeição estava certa e o meu enquadramento estava errado. Não é ausência de evidência: é
**evidência positiva de ausência**. Li a fonte publicada do `agente-criativo` v3.5.0 e não há
nenhuma chamada a DALL-E, Anthropic ou Meta Ads — `geracao_disponivel: false` em todos os
caminhos. Isso é `CODIGO`, e código pode sustentar `ALTA`.

Registrado corretamente:

```
capability_id   CRIAR_CRIATIVO
executor_id     agente-criativo
status          APENAS_DECLARADA          <- nunca COMPROVADA
evidence_type   CODIGO
evidence_valor  3 aprovacoes historicas, todas expiradas; 0 criativos publicados
acionavel       false
bloqueio        Contrato shadow_criativo_v1 fail-closed
```

**O guard que efetivamente segura a Camila é o `ck_comprovada_exige_execucao`:** `CODIGO` jamais
pode virar `COMPROVADA`. Código prova o que está implementado — nunca que funciona.

E a leitura em shadow confirma ponta a ponta:

```
CRIAR_CRIATIVO -> EVIDENCIA_INSUFICIENTE
motivo: executor existe mas NAO e acionavel: ver bloqueio
```

O mapa **não** expõe `CRIAR_CRIATIVO = COMPROVADA`. Gate passou.

---

## §5, §9 — A reativação partida em capacidades, e o erro que o próprio registro pegou

Registrei `fn_vigia_ciclo_compra` e `fn_vigia_leads_mornos` sob o mesmo `capability_id`
`ENVIAR_WHATSAPP_REATIVACAO`. A view devolveu `MULTIPLOS_CANDIDATOS` — e a §9 proíbe marcar
redundância sem provar **mesma população**. Ao medir:

| | `vigia_ciclo_compra` | `vigia_leads_mornos` |
|---|---|---|
| leads distintos, 90d | 70 | 238 |
| **média de compras por lead** | **10,83** | **0,06** |
| nunca compraram | — | **96,2%** |
| **interseção entre os dois** | **0 leads** | |

**Interseção zero.** Um reativa quem já comprou dez vezes; o outro persegue quem nunca comprou.
Chamar os dois de "reativação" seria repetir exatamente o erro que a R64 proibiu: **lead não é
cliente**.

Corrigido pelo mecanismo append-only, sem sobrescrever nada: nova capacidade
`REENGAJAR_LEAD_QUE_NUNCA_COMPROU` no vocabulário (rodada `R79-C`), nova linha no registro, e uma
linha em `capacidade_substituicao` apontando a antiga. A projeção corrente passou a devolver:

```
ENVIAR_WHATSAPP_REATIVACAO        -> EXECUTOR_APTO (fn_vigia_ciclo_compra)
REENGAJAR_LEAD_QUE_NUNCA_COMPROU  -> EXECUTOR_APTO (fn_vigia_leads_mornos)
```

**Veredito §9: `SEM_REDUNDANCIA`.** Não é sobreposição parcial nem redundância — é
`ESPECIALIZACAO`, com populações disjuntas provadas.

Isto é o resultado mais importante da rodada: **o registro forçou a correção de uma taxonomia que
eu mesmo tinha acabado de escrever**, porque exigiu medir a população antes de aceitar o rótulo.

As cinco capacidades da reativação ficaram assim:

| capacidade | executor | status | efeito externo |
|---|---|---|---|
| `DETECTAR_CLIENTE_FORA_DO_CICLO` | `fn_vigia_ciclo_compra` | COMPROVADA | não |
| `ENVIAR_WHATSAPP_REATIVACAO` | `fn_vigia_ciclo_compra` | COMPROVADA | **sim** — 29 em 30d |
| `ESCALAR_TASK_RETENCAO` | `fn_vigia_ciclo_compra` | **PARCIAL** | não — 12 concluída / 128 descartada |
| `GERAR_REATIVACAO` | `agente-campanhas-crm` | **BLOQUEADA** | não |
| `MEDIR_RESULTADO_REATIVACAO` | **nenhum** | — | **CAPACIDADE_AUSENTE** |

---

## §6 — Autoria

Quatro linhas carregam autoria degradada, nenhuma preenchida no chute:

| executor | autoria | por quê |
|---|---|---|
| `orquestrador+agente-conversacao` | **`AUTORIA_INCOMPLETA`** | grava `evento` vazio; só foi identificado por correlação de horário com os crons de 11h/15h/21h |
| `fn_vigia_leads_mornos` | `PARCIAL` | mensagem atribuível pelo `evento`; **executor sem dono no registro de agentes** |
| `agente-exploracao` | `PARCIAL` | sem cron, acionada por webhook; `efeito_externo` zerado no log apesar de 1.760 mensagens |
| `agente-criativo` | `NAO_APLICA` | não produz mensagem |

`ATRIBUIR_AUTORIA_DE_MENSAGEM` está no vocabulário e **não tem executor**: 20,1% de cobertura em
`mensagem_envio` é gap de observabilidade, não licença para inventar dono.

---

## §7 — Consumidor: existir ≠ ser usada

| consumidor | capacidades |
|---|---|
| `CRON` | 10 |
| `ORQUESTRADOR` | 2 |
| `HUMANO` | 1 |
| `OUTRO_EXECUTOR` | 1 (webhook inbound → Júlia) |
| **`NINGUEM`** | **1** (`agente-laboratorio`) |

O guard `ck_ninguem_nao_e_acionavel` transforma isso em regra: quem ninguém chama **não pode** ser
marcado acionável. A distinção entre `CAPACIDADE_EXISTE` e `CAPACIDADE_E_USADA` deixou de depender
de leitura humana.

---

## §8 — Necessário mas inativo: **`NAO_ENCONTRADO`**

Testei a regra completa da R77 sobre o mapa novo — gap real + capacidade necessária + executor
comprovado + não acionado + ausência bloqueia progresso.

O único executor `INATIVA` com consumidor `NINGUEM` é o `agente-laboratorio`. Ele falha o último
critério: nenhum A/B está pendente, o desenho do experimento está congelado até 04/09, e a
ausência dele **não bloqueia nada hoje**.

**Camila não foi forçada para dentro desta categoria.** Ela é `APENAS_DECLARADA`, o que significa
que nem executor apto é — e a §8 exige executor **comprovado**.

---

## §10 — Candidato a deprecar: **nenhum**, e o mapa reverteu a R77

A R77 marcou `agente-laboratorio` como `CANDIDATO_A_DEPRECAR` com confiança MÉDIA. Sob os
critérios mais estritos da §10, ele **falha o primeiro**: é o **único** executor registrado para
`EXECUTAR_AB_DE_COMPORTAMENTO`. Tem capacidade exclusiva relevante e nenhuma alternativa
comprovada cobre a função.

A candidatura cai. Foi o mapa, e não uma nova opinião, que derrubou a conclusão anterior — que é
exatamente o que ele deveria fazer.

---

## §11 — Capacidades ausentes: **3**

Ausência agora é **consulta**, não impressão: capacidade no vocabulário com zero executores.

| capacidade | por que importa | precisa de agente? |
|---|---|---|
| `MEDIR_RESULTADO_REATIVACAO` | a R78 mediu 1/13 em `FREQ_2_3` **na mão**; nenhum executor liga envio a desfecho | **não** — função SQL sobre `waba_disparos_lista` × `pixel_events` |
| `ISOLAR_POPULACAO_EXPERIMENTAL` | R78 §7: 3 clientes elegíveis hoje e ninguém saberia impedir | **não** — lock por cliente, determinístico |
| `ATRIBUIR_AUTORIA_DE_MENSAGEM` | 20,1% de cobertura | **não** — preencher `evento`/`autor_tipo` na origem |

**Nenhuma das três pede agente novo.** As três são função determinística. Registrar isso é o
antídoto contra o reflexo "falta capacidade → criar agente".

---

## §12 — Três roteamentos em shadow (nada executado)

**A. "Preciso reativar cliente `FREQ_2_3` fora do ciclo."**
→ `ENVIAR_WHATSAPP_REATIVACAO` → **`EXECUTOR_APTO`**: `fn_vigia_ciclo_compra`.
Com a ressalva registrada na própria linha: a janela de 180 dias dela exclui 26 dos 29.

**B. "Preciso saber se a reativação funcionou."**
→ `MEDIR_RESULTADO_REATIVACAO` → **`CAPACIDADE_AUSENTE`**.

**C. "Preciso garantir que ninguém toque quem está no experimento."**
→ `ISOLAR_POPULACAO_EXPERIMENTAL` → **`CAPACIDADE_AUSENTE`**.

Distribuição completa das 18 capacidades:

| resultado | n | quais |
|---|---|---|
| `EXECUTOR_APTO` | **8** | reativação, reengajamento, plantão noturno, inbound, followup, detecção de ciclo, demanda de mercado, supervisão |
| `EVIDENCIA_INSUFICIENTE` | **7** | criar criativo, gerar reativação, escalar task, criar task humana, aprovar risco, rotear, A/B |
| `CAPACIDADE_AUSENTE` | **3** | medir resultado, isolar população, atribuir autoria |
| `MULTIPLOS_CANDIDATOS` | 0 | *(era 1 antes da correção da §9)* |

Nenhuma escolha automática foi feita. A view devolve candidatos e motivo; quem decide é humano.

---

## §13 — Router gate

| critério mínimo | atende | como |
|---|---|---|
| não roteia por descrição | **sim** | `evidence_ref` obrigatório e executável; `ck_comprovada_exige_execucao` impede que código ou descrição virem capacidade comprovada |
| diferencia declarada / implementada / comprovada | **sim** | 6 status distintos, com `APENAS_DECLARADA` e `IMPLEMENTADA_NAO_PROVADA` separados de `COMPROVADA` |
| inclui não-agentes | **sim** | 6 dos 14 executores: `FUNCAO_SQL`, `EDGE`, `HUMANO`, `MISTO` |
| conhece estado e bloqueio | **sim** | `acionavel` + `bloqueio`, com `ck_bloqueio_exige_motivo` |
| conhece consumidor | **sim** | 6 valores, com `NINGUEM` proibido de ser acionável |
| **permite abster** | **sim** | `CAPACIDADE_AUSENTE` e `EVIDENCIA_INSUFICIENTE` são resultados de primeira classe — 10 das 18 caem neles |

**Os 6 critérios passam.** E há uma prova de comportamento que vale mais que a tabela: o registro
**recusou** rotear para a Camila e **forçou** a correção da minha própria taxonomia dos dois
`vigia_*`. Um roteador por descrição teria feito as duas coisas erradas.

Ressalva que precisa ficar junto da autorização: o registro cobre **13 executores**, contra 23
agentes, 106 crons e 302 edge functions no ambiente. Fora das 18 capacidades do vocabulário, a
resposta correta do router é `CAPACIDADE_AUSENTE` **por não estar mapeada** — que é diferente de
"ninguém sabe fazer". Enquanto a cobertura for parcial, essa ambiguidade é real e o shadow serve
justamente para medi-la.

---

## §14 — Vereditos

```
MAPA_CAPACIDADES_PRECISA_MAIS_EVIDENCIA
CAPABILITY_ROUTER_SHADOW = AUTORIZADO
```

**Por que o mapa não é "validado":** o contrato está validado — ele pegou a Camila e pegou o meu
erro de taxonomia. A **cobertura** não está: 7 das 18 capacidades saem como
`EVIDENCIA_INSUFICIENTE`, 3 não têm executor, e 13 executores é uma fatia pequena do ambiente.
Chamar isso de mapa canônico validado seria o mesmo tipo de otimismo que o próprio contrato
existe para bloquear.

**Por que o router está autorizado mesmo assim:** os 6 critérios do gate passam, shadow não
produz efeito, e a alternativa — continuar com o `orquestrador`, que alcança 2 de 23 por string
fixa no prompt — é estritamente pior. A R77 tinha dito `AINDA_NÃO` por três bloqueios; o
primeiro (não existe registro de capacidade) foi resolvido nesta rodada. Os outros dois
(telemetria de efeito e coordenador entre executores) bloqueiam **agir**, não **consultar** — e
consultar em shadow é como se mede se eles bloqueiam mesmo.

---

## Estado final e gate de segurança

| | |
|---|---|
| `capacidade_vocabulario` | 18 |
| `capacidade_registro` | 16 linhas, **15 vigentes**, 1 substituída |
| `capacidade_substituicao` | 1 |
| executores distintos | **13** · 6 não-agentes (46%) |
| status (vigentes) | COMPROVADA 8 · PARCIAL 4 · APENAS_DECLARADA 1 · BLOQUEADA 1 · INATIVA 1 |
| com efeito externo comprovado | **5** |
| autoria degradada | 4 |
| **`COMPROVADA` com evidência só de código ou ausência** | **0** ✅ |
| **efeito externo sem status que sustente** | **0** ✅ |

| verificação | observado |
|---|---|
| agentes reativados / mortos / fundidos / criados | **0** (23, inalterados) |
| crons alterados | **0** (106 / 93 ativos) |
| prompts alterados | **0** |
| roteamento automático criado | **0** — a view não tem consumidor |
| efeito externo produzido | **0** (último WhatsApp 26/08 15:20, do cron 107) |
| `crm_campaign_autonomy_policy.ativo` | `false` |
| pré-registros | V1 e V2 intactos, **sem V3**; desenho congelado até 04/09 |
| objetos criados | 3 tabelas append-only, 3 triggers, 1 view de leitura, 1 FK |

Rollback: `drop view vw_capacidade_roteamento_shadow; drop table capacidade_substituicao,
capacidade_registro, capacidade_vocabulario cascade;` — nenhum objeto de produção depende deles.
