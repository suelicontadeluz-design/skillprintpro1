# Iniciativa `microloops-23-agentes` — mapa verificável e contrato de fechamento

Rodada de 17/08/2026. Frente de governança: `gps-microloops-23-membresia-fechamento`
(trilha `governanca`, claim `claude-20260817-gps-microloops23-4k8m2p`).

Projeto Supabase: `ldrdtaibazplvrbwyrvx` (Cérebro).

---

## 1. Causa-raiz da ambiguidade

A iniciativa mede **agentes**; o GPS só modela **frentes**; não existia relação entre os dois.

| Fato | Verificação |
|---|---|
| "23" é a contagem de agentes, não de frentes | `select count(*) from public.agentes` → 23, todas `status='ativo'` |
| A macro tinha 11 filhas, mas 3 não são microloop de agente algum | `contrato-orcamento-contexto-aprendizado` declara na descrição: *"Frente do CONTRATO DE ENTREGA, nao do Joao nem da Julia"*; `agente-chat-sem-autenticacao` e `ricardo-edge-sem-autenticacao` são endurecimento de autenticação |
| As 8 filhas restantes cobrem apenas 4 agentes | João (agente-noturno), Júlia (agente-exploracao), Vera (agente-retencao), Ricardo (agente-supervisor) |
| O único inventário dos 23 vivia em prosa | `frentes.onde_paramos` = 10.857 chars; `fn_frente_checkpoint` lista `onde_paramos` e `evidencia` em `nao_contam` |

Consequência: o fechamento da macro era **improvável por construção** — o critério é conjuntivo
sobre 23 agentes e a única medição era texto autoral do executor.

---

## 2. Atribuição agente ↔ frente: provada por dado, não por nome

Registrada em `public.microloops_23_frente.atribuicao_fonte` + `evidencia`.

| Fonte | Agente | Prova |
|---|---|---|
| `ligacao_estruturada` | `agente-noturno` | `joao_envios.decision_id → agente_decisoes_log.agente_slug` = `agente-noturno` em **1006/1006** linhas, valor único |
| `ligacao_estruturada` | `agente-retencao` | `vera_retencao_ciclos.decision_id → agente_decisoes_log.agente_slug` = `agente-retencao` em **19/19** |
| `artefato_declarado` | `agente-supervisor` | o campo `bloqueio` nomeia a edge `agente-supervisor` v5.8.2 / version 61, que é o `agentes.edge_function` do Ricardo Neves |
| `nome_unico_dominio` | `agente-exploracao` | único "Julia" em `public.agentes`; descrição cobre DTF Têxtil/UV, domínio do incidente. **Limitação registrada:** `julia_tool_audit_log` não tem coluna de decisão, então não há ligação estruturada |

> A atribuição de "João" **não** veio do primeiro nome. `agente-noturno` é descrito como
> plantonista noturno, mas responde 6.764 decisões com pico às 17–21 BRT — a descrição está
> desatualizada. Só o join resolveu.

Os **19 agentes sem frente portadora** ficam explícitos como `nao_inventariado`. A lacuna é
visível em vez de ser confundida com loop pronto.

---

## 3. Objetos criados (aditivos)

| Objeto | Papel |
|---|---|
| `public.microloops_23_membro` | 23 linhas, uma por agente. Torna a membresia contável. Carrega `classificacao_loop` (completo/parcial/quebrado/inexistente), exigida literalmente pelo `criterio_aceite` da macro |
| `public.microloops_23_frente` | Liga agente → frente portadora, com `papel` (microloop/suporte), `atribuicao_fonte` e `evidencia` |
| `public.vw_microloops_23_frente_prova` | Prova de fechamento por frente, incluindo `validacao_independente` |
| `public.vw_microloops_23` | Estado por agente |
| `public.fn_microloops_23_fechamento()` | Condição objetiva de fechamento, nas duas leituras (ver §5) |
| `public.fn_microloops_23_proxima()` | Navegador **escopado à iniciativa** |

RLS habilitada; zero grants a `anon`/`authenticated`.

### Por que `validacao_independente` existe

`fn_frente_finalizar_chat` faz `validada_por = coalesce(p_validada_por, p_chat_id)` — o executor
pode assinar a própria validação. Logo `estado='fechada'` **não** prova aprovação de terceiro.
A view compara `validada_por` com o `chat_id` do claim concluinte e marca
`fechado_sem_validacao_independente` quando coincidem.

---

## 4. Correções de dado

- `joao-loop-desfecho-avaliacao-aprendizado.depende_de` → `{joao-contexto-comercial-canonico}`.
  Transcrição da decisão já registrada em prosa no campo `bloqueio`:
  *"CONGELADA por decisao do Alessandro em 16/08/2026: depende de joao-contexto-comercial-canonico fechar primeiro."*
  Vira DAG, não decisão de rota.

- 4 esperas estruturadas abertas para frentes que estavam `acionavel=true` **declarando espera
  no próprio `proximo_passo`**:

  | Frente | Tipo |
  |---|---|
  | `joao-desistencia-lost-canonico` | `evento_organico` |
  | `julia-instrucao-tecnica-e-mensagem-concorrente` | `evento_organico` |
  | `ricardo-livro-recomendacoes-inerte` | `evento_organico` |
  | `contrato-orcamento-contexto-aprendizado` | `decisao_humana` (dono = alessandro) |

### Efeito medido no GPS

| Trilha | Candidatas antes | Depois |
|---|---|---|
| `aprendizado` | 4 | 2 |
| `conversao_joao` | 7 | 5 |
| `conversao_julia` | 4 | 3 |

`conversao_joao` mudou de `NENHUM_SINAL_ESTRUTURADO` / `DAG_VAZIO` para
`SINAL_UNICO_NAO_VALIDADO` / `DAG_DISTINGUE`, com
`venceria_por_dag = joao-contexto-comercial-canonico`, `regras_que_resolvem=1` e
`respostas_distintas=1` — nenhuma discordância entre regras.

---

## 5. Fechamento: duas leituras, e a diferença é do proprietário

`fn_microloops_23_fechamento()` devolve as duas sem escolher:

- **`criterio_registrado`** — o `criterio_aceite` validado por Alessandro em 15/08/2026 é de
  **medição**: os 23 inventariados com classificação + evidência, e todo loop não-completo com
  frente portadora. Não exige que os 23 loops estejam completos.
- **`contrato_estrito`** — o contrato pedido em 17/08/2026: os 23 **comprovados**.

Enquanto `criterio_aceite` não for emendado, vale a leitura registrada — `fn_frente_finalizar_chat`
cobra `criterio_aceite`, não esta função.

Estado atual: 0 comprovados, 4 em aberto, 19 não inventariados, `macro_fechavel = false` nas duas leituras.

---

## 6. Paralelismo não é ambiguidade

Microloops de agentes diferentes vivem em **trilhas diferentes**, e a regra `TRILHA` do protocolo
já permite trilhas distintas em paralelo. Por isso `fn_microloops_23_proxima()` devolve
`MULTIPLAS_ACIONAVEIS` — não `AMBIGUA` — quando há mais de um acionável.

Quem ordena é **`depende_de`**, já aplicado por `vw_frentes_elegiveis`. `ordem_execucao` é
informativo, **não** gate.

> **Correção feita nesta mesma rodada, em auto-revisão.** A primeira versão de
> `fn_microloops_23_proxima` gateava pela menor `ordem_execucao` pendente do agente. Era
> heurística inventada — justamente o que a rodada proibia — e tinha erro demonstrável: ao fechar
> `joao-contexto-comercial-canonico` (ordem 1), a vez passaria para
> `joao-desistencia-lost-canonico` (ordem 2), que está em espera de evento orgânico, e
> `joao-loop-desfecho-avaliacao-aprendizado` (ordem 3) — cuja única dependência declarada é a
> ordem 1 — ficaria escondido. Uma espera externa bloquearia trabalho realmente disponível.

## 6.1 Simulação determinística até o fechamento

Executada em transação abortada (`begin … rollback`), não é projeção de prosa.

| Passo | Estado do navegador | Próxima frente | O que destrava |
|---|---|---|---|
| **1 — agora** | `UNICA` | `joao-contexto-comercial-canonico` (trilha `conversao_joao`) | Trabalho de engenharia disponível: cron 132 rodou 14/14 com sucesso desde 16/08 21:42, então a remedição orgânica read-only é executável |
| **2 — após fechar o passo 1** | `UNICA` | `joao-loop-desfecho-avaliacao-aprendizado` (ordem 3) | Dependência declarada satisfeita. A ordem 2 continua corretamente em `aguardando:evento_organico` e **não** bloqueia a 3 |
| **3+** | `NENHUMA_ACIONAVEL` até um release | — | Tudo o mais depende de evento externo ou decisão humana (ver tabela abaixo) |

### O que cada microloop restante espera

| Agente | Frente | Depende de | Natureza |
|---|---|---|---|
| `agente-noturno` | `joao-desistencia-lost-canonico` | primeira desistência orgânica pós-v162 | **evento orgânico** |
| `agente-noturno` | `joao-arquivo-lead-canva-producao` | 4 pré-requisitos Canva (client id/secret, plano, design de teste) | **decisão humana** |
| `agente-exploracao` | `julia-instrucao-tecnica-e-mensagem-concorrente` | primeira mensagem orgânica sobre ferro/prensa/DTF UV | **evento orgânico** |
| `agente-supervisor` | `ricardo-livro-recomendacoes-inerte` | Alessandro exercitar 1 recomendação real | **evento orgânico** |
| `agente-supervisor` | `ricardo-encerramento-semantica` | fechar `ricardo-livro-recomendacoes-inerte` (DAG) + canal de deploy seguro da edge v5.8.2 | **DAG + engenharia bloqueada** |
| `agente-retencao` | `vera-loop-retencao-observavel` | desfecho do ciclo do Jean + escolha de quem escreve o aprendizado | **evento orgânico + decisão humana** |
| 19 agentes | — | classificação do loop (`completo`/`parcial`/`quebrado`/`inexistente`) | **engenharia — é o próximo grande lote de trabalho da iniciativa** |

O inventário dos 19 é trabalho técnico normal e não depende de ninguém: é o que o
`criterio_aceite` registrado exige e o que mais aproxima a macro do fechamento.

---

## 7. Limites do contrato GPS atual (reportados, não alterados)

1. **`fn_gps_proxima` não consulta o DAG.** Ele desempata só por `prioridade`. Em
   `conversao_joao` o DAG já resolve, mas o GPS continua dizendo `AMBIGUA`.
   Instalar "DAG primeiro" globalmente **não** se sustenta: em `aprendizado` DAG e onda
   discordam (2 respostas distintas). Regra global não corroborada não foi criada.
2. **Pai competindo com filha** em 4 de 12 trilhas com candidatas (`atribuicao`,
   `conversao_joao`, `operacao_humana`, `erp`). Não afeta esta iniciativa —
   `microloops-23-agentes` está inelegível por `dependencia_insatisfeita` —, mas mudar isso
   alteraria 4 trilhas fora do escopo.
3. **Auto-release de espera orgânica.** `fn_espera_avaliar_um` só conhece as famílias
   `tempo`/`composta` e os verificadores `mensagem_envio_autor_apos` e `vera_ciclo_estado_mudou`.
   Não há verificador capaz de observar linha nova em `joao_lost_eventos` ou
   `ricardo_recomendacoes`, então as 3 esperas de `evento_organico` ficam sem predicado e exigem
   encerramento explícito.

---

## 8. Rollback

- `public.backup_gps_microloops23_20260817` guarda `depende_de` e `proximo_passo` originais.
- As 4 esperas se encerram por `fn_espera_encerrar`.
- As tabelas/views/funções `microloops_23_*` são aditivas e podem ser dropadas sem tocar o GPS.

Nada foi alterado em `fn_gps_proxima`, `vw_frentes_elegiveis`, autonomia de deploy, flags `allow_*`
ou schedulers. `gps_rota_decisao` segue **sem linha nova** — nenhuma decisão humana falsa foi registrada.

---

# ADENDO — Contrato ponto a ponto (decisão do proprietário, 17/08/2026)

O contrato binário `0/23` foi substituído. Unidade mínima: **AGENTE → PONTO → ESTADO + PROVA**.
Progresso parcial é preservado; nada é zerado.

## Os 8 pontos obrigatórios não foram inventados

São os itens enumerados **literalmente** no `criterio_aceite` da macrofrente, validado por
Alessandro em 15/08/2026:

| # | Ponto | Observável declarado |
|---|---|---|
| 1 | `etapa_crm` | etapa de pipeline CRM no contexto da decisão |
| 2 | `entrada_observada` | `agente_decisoes_log.contexto` não vazio |
| 3 | `kpi_meta` | linha ativa em `agente_metas` |
| 4 | `acao` | `acao_executada` preenchida |
| 5 | `prova_externa` | `efeito_externo` + `envio_provider_id`, ou `mensagem_envio.autor_id` |
| 6 | `resultado_comercial` | `source_conversion_id` + `regra_atribuicao` |
| 7 | `aprendizado` | `agente_aprendizados` ativo (validada/aplicada) |
| 8 | `ajuste_proxima` | `origem_decision_id` ligando decisão a decisão anterior |

23 agentes × 8 = **184 pontos obrigatórios**.

## Imutabilidade lógica

`microloops_23_ponto_evento` é **append-only**, com trigger que recusa `UPDATE` e `DELETE`
(testado: ambos bloqueados, 190 eventos intactos). Refutação entra como **evento novo** com
`refuta_evento_id` — nunca como apagamento.

### Auto-refutação real, ocorrida nesta rodada

A reconciliação inicial marcou `etapa_crm` como COMPROVADO para João e Júlia por presença da
chave `contexto->etapa`. Conferindo os **valores**, são vocabulário conversacional do agente —
`sondagem` 772, `orcamento` 265, `fechamento` 119, `pos_pagamento` 104, `despedida` 31, `NULL` 394
— e não etapa de pipeline CRM. É exatamente o defeito que `mapeamento-funil-cerebro` declara,
com `fn_contexto_crm_etapa_prompt` implantada e a flag `crm_etapa_no_contexto=off`.
A refutação virou evento novo; o evento anterior segue no histórico.

## Progresso real (reconciliado do runtime, não de prosa)

**184 pontos · 75 comprovados · 103 pendentes · 4 aguardando · 2 refutados · 0 agentes fechados**

| Agente | Nome | Progresso |
|---|---|---|
| `agente-exploracao` | Julia Bitencourt | 5/8 |
| `agente-fechamento` | Marcos Vieira | 5/8 |
| `agente-noturno` | João Barros | **4/8** |
| `agente-atribuicao`, `agente-conversacao`, `agente-memoria`, `agente-midia`, `agente-objecoes`, `agente-observacao`, `agente-pipeline`, `agente-retencao`, `orquestrador` | — | 4/8 |
| `agente-criativo`, `agente-insights`, `agente-laboratorio`, `agente-mercado`, `agente-supervisor` | — | 3/8 |
| `agente-aprovacao`, `agente-autonomia`, `agente-campanhas-crm`, `agente-comentario`, `agente-direct` | — | 2/8 |
| `go` | GO | 0/8 (zero decisões em `agente_decisoes_log`) |

## João detalhado — caso de prova

Agente resolvido por `joao_envios → agente_decisoes_log` em 1006/1006 linhas.

| Ponto | Estado | Evidência |
|---|---|---|
| `entrada_observada` | ✅ COMPROVADO | 6.764 decisões com contexto |
| `acao` | ✅ COMPROVADO | 6.764 com `acao_executada` |
| `prova_externa` | ✅ COMPROVADO | 711 com `efeito_externo`+`envio_provider_id`; 1.006 envios, 791 com callback do provider |
| `aprendizado` | ✅ COMPROVADO | 21 aprendizados ativos (validada/aplicada) |
| `etapa_crm` | ❌ REFUTADO | vocabulário conversacional, não etapa CRM (ver acima) |
| `kpi_meta` | ❌ PENDENTE | `agente_metas` para `agente-noturno` = **0 linhas**, nem inativas — enquanto 14 outros agentes têm meta ativa |
| `resultado_comercial` | ❌ PENDENTE | `source_conversion_id`+`regra_atribuicao` = 0. Os 1.551 `atribuicao_tipo` isolados são justamente o que o guardrail vinculante de `joao-loop-desfecho` proíbe tratar como verdade histórica |
| `ajuste_proxima` | ❌ PENDENTE | `origem_decision_id` = 0 |

**Os 4 comprovados não devem ser refeitos.**

## Próximo ponto acionável

`fn_microloops_23_proxima()` → `UNICO` → **`agente-noturno` / `etapa_crm`**, via
`joao-contexto-comercial-canonico` (trilha `conversao_joao`).

### Simulação da navegação (transação abortada)

Provando `etapa_crm` e fechando a frente: João **4/8 → 5/8**, global **75 → 76**, e o navegador
recalcula sozinho para `resultado_comercial` e `ajuste_proxima`, ambos via
`joao-loop-desfecho`, destravado pelo DAG. Rollback conferido.

## Gaps de contrato restantes

1. **103 pontos pendentes não têm frente portadora registrada.** O navegador os expõe em
   `pontos_sem_frente_portadora`; criar essas frentes é trabalho da iniciativa.
2. **Observáveis uniformes podem não servir a agentes de infraestrutura.** `resultado_comercial`
   e `ajuste_proxima` usam o mesmo observável para os 23. Para `go`, `orquestrador` e
   `agente-autonomia` talvez caiba `NAO_APLICAVEL` com fundamento — decisão do proprietário.
3. **Auto-release de espera orgânica** continua sem verificador em `fn_espera_avaliar_um`.
