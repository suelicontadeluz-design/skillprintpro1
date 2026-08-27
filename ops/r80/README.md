# R80 — Capability Router em shadow, sobre necessidades reais

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** SHADOW / zero efeito externo.
Nenhum agente acionado, criado, fundido ou morto. Nenhum cron, edge, prompt, GPS ou frente tocado.
A view do router continua **sem consumidor**.

**Regra central:** o router não precisa saber tudo. Precisa saber **quando não sabe**.

---

## Veredito

```
ROUTER_SHADOW_COM_COBERTURA_INSUFICIENTE
```

E o gate da §18 **falha em um item**, o mais importante:

| critério do gate | resultado |
|---|---|
| **falso positivo crítico = 0** | **FALHA — 1 de 2** |
| falso negativo de cobertura baixo e conhecido | passa — 0 de 14 |
| Camila continua corretamente bloqueada | passa |
| não-agentes incluídos | passa — 6 de 21 executores |
| estado/bloqueio confiável | passa |
| ABSTER funciona | passa — 18 de 20 necessidades caíram em abstenção |
| autoria suficiente para medir resultado | passa **para o que está no mapa**, não em geral (§10) |

**O router não sai de shadow.**

---

## §20.1–2 — 20 necessidades reais avaliadas

Nenhuma inventada. Origem: `gap_do_mapa` (6), `candidato_acao_economica` (2) e as 12 frentes
elegíveis e acionáveis de maior prioridade em `vw_frentes_elegiveis`.

| resultado | n | % |
|---|---|---|
| `CAPACIDADE_AUSENTE` | **14** | 70% |
| `NAO_TRADUZIVEL` | 4 | 20% |
| `EXECUTOR_APTO` | **2** | 10% |
| `EVIDENCIA_INSUFICIENTE` | 0 | 0% |
| `MULTIPLOS_CANDIDATOS` | 0 | 0% |

Registrado em `router_shadow_execucao` (append-only). O `resultado_router` **não foi digitado**:
vem de um `join` com `vw_capacidade_roteamento_shadow`. Quem escreveu foi o mapa.

---

## §13 — Falso positivo: **1 de 2**, e ele é instrutivo

Só dois casos saíram como `EXECUTOR_APTO`. Um sobreviveu à auditoria, o outro não.

**Sobreviveu.** Necessidade R68: *"ligar a maquinaria de reativação para um segmento definido"*.
→ `ENVIAR_WHATSAPP_REATIVACAO` → **`fn_vigia_ciclo_compra`**.
A necessidade original pedia `crm_campaigns`, que está `BLOQUEADA`. **O router apontou um executor
diferente do que o humano tinha em mente, e o dele funciona** — 29 envios em 30 dias contra zero.
É o primeiro caso em toda a série em que o mapa corrige a premissa de quem escreveu a necessidade.

**Não sobreviveu.** Frente `crons-sucesso-sem-efeito`: *"reler `http_chamada_log` por jobid e
subir o timeout dos que derem timeout"*.
→ eu traduzi para `MONITORAR_SAUDE_DE_EXECUTOR` → router devolveu **`agente-observacao`**.
Errado: o Fábio monitora saúde de **agente** por `cron_execution_log` e `error_log`; a necessidade
é timeout de HTTP por `jobid` em `http_chamada_log`. São coisas diferentes com nome parecido.

**`FPR_ROTEAMENTO = 1/2 = 50%.`** O ideal da §13 é zero. Não é.

E a §11 exige separar de quem é a culpa. Não é `ERRO_DO_ROUTER`: dada a capacidade, ele respondeu
certo. É **`TAXONOMIA_ERRADA` na tradução** — `MONITORAR_SAUDE_DE_EXECUTOR` é grossa demais e
engole uma necessidade que não é dela.

Isso expõe o que a rodada realmente descobriu: **o elo fraco não é o router, é a tradução
necessidade → capacidade**, e essa etapa hoje é feita por julgamento humano, fora do mapa. Um
router com FPR zero na consulta pode ter FPR alto no sistema inteiro se a tradução errar antes.

---

## §12 — Falso negativo de cobertura: **0 de 14**

Para cada uma das 14 `CAPACIDADE_AUSENTE` fui procurar executor em agentes, funções SQL, crons,
edges e humanos. Todas as 14 são `AUSENCIA_REAL`.

| capacidade ausente | quantas necessidades | o que a busca encontrou |
|---|---|---|
| **`PUBLICAR_EDGE_FUNCTION`** | **3** | nada. `go` seria o candidato declarado e tem **0 decisões na história**, contido desde 14/08 |
| `CURAR_BASE_DE_CONHECIMENTO_PRODUTO` | 2 | nada mantém fato canônico de produto |
| `DEFINIR_REGRA_DE_DOMINIO` | 2 | `agente_aprovacoes` aprova ação proposta; não define regra nova |
| `MEDIR_RESULTADO_REATIVACAO` | 1 | `vera_retencao_ciclos` guarda o ciclo, não o desfecho |
| `MEDIR_CUSTO_MARGEM_POR_PEDIDO` | 1 | CalcMe dá preço, não custo |
| `REVALIDAR_AUDIENCIA_NO_ENVIO` | 1 | a vigia revalida a própria fila; o enfileiramento de campanha não |
| `OBTER_FONTE_EXATA_DE_EDGE` | 1 | nenhum executor lê fonte de edge — **o operador humano lê, via Management API** |
| `EXECUTAR_SCRIPT_COM_ACESSO_AO_BANCO` | 1 | a prova existe e ninguém consegue rodá-la |
| `ATRIBUIR_AUTORIA_DE_MENSAGEM` | 1 | ver §10 |

Duas observações que valem mais que a métrica:

**`PUBLICAR_EDGE_FUNCTION` é o maior bloqueio do sistema.** Aparece em 3 das 20 necessidades e
trava **21 frentes abertas**, incluindo 3 das 6 de prioridade 1 — entre elas
`ricardo-saude-observabilidade-canonica`, cujo texto diz "BLOQUEADOR ÚNICO E EXCLUSIVO". A fila
técnica inteira está esperando uma capacidade que o Cérebro não tem.

**Convergência entre territórios.** A frente `atrib-instrumentar-execucao`, aberta muito antes
desta série, nomeia exatamente `ATRIBUIR_AUTORIA_DE_MENSAGEM` — a mesma capacidade que a R79
marcou ausente por outro caminho. Duas rotas independentes chegaram ao mesmo buraco.

---

## §5 — A falha de cobertura estava no mapa, não no roteamento

A auditoria das ausências não achou falso negativo. Mas a auditoria **do mapa** achou: a R79
registrou 13 executores e deixou de fora executores com efeito externo comprovado e alto volume.

Corrigido nesta rodada, **só com prova** (§8), priorizando pela §9 — efeito externo, volume, risco:

| capacidade nova | executor | status | evidência |
|---|---|---|---|
| `MONITORAR_SAUDE_DE_EXECUTOR` | `agente-observacao` | COMPROVADA | 256 `alerta_enviado` + 21 críticos + 111 `sem_anomalias` em 30d; 22 executores em `agente_saude_config` |
| `RESPONDER_DIRECT_SOCIAL` | `agente-direct` | COMPROVADA | 99 respostas; **98,3% das 8.747 decisões são `nenhum`** |
| `RESPONDER_COMENTARIO_PUBLICO` | `agente-comentario` | COMPROVADA | 60 respostas públicas — maior risco reputacional do sistema |
| `CLASSIFICAR_OBJECAO_COMERCIAL` | `agente-objecoes` | COMPROVADA | 221 sugestões supervisionadas em 30d, zero execuções |
| `PROPOR_PUBLICO_META_ADS` | `agente-midia` | COMPROVADA | 434 propostas |
| **`OPERAR_META_ADS`** | `agente-midia` | **PARCIAL** | **272 `analisar/ok` contra 6 `executar/ok`** |
| `CORRIGIR_ATRIBUICAO_DE_LEAD` | `agente-atribuicao` | PARCIAL | 780 `nenhum`, 6 correções em 30d |
| `CONSOLIDAR_APRENDIZADO` | `agente-memoria` | COMPROVADA | 34 consolidações, 100% das decisões |
| `ENVIAR_MENSAGEM_DE_FECHAMENTO` | `agente-fechamento` | COMPROVADA | 81 mensagens; **inalcançável pelo orquestrador** (ramo morto da R77) |

### O segundo caso Camila

`agente-midia` declara *"Opera campanhas no Meta Ads. **Pausa o que não performa, escala o que
funciona**"*. O log diz outra coisa: **434 propostas, 6 execuções na história inteira.**

Registrado partido em dois — `PROPOR_PUBLICO_META_ADS` COMPROVADA, `OPERAR_META_ADS` **PARCIAL**.
Registrar "opera Meta Ads = COMPROVADA" teria sido um falso positivo em cima de um executor que
mexe em dinheiro. É a mesma regra que a R79 usou para partir a reativação, aplicada a mídia.

---

## §14 — Camila sentinela

```
CRIAR_CRIATIVO -> EVIDENCIA_INSUFICIENTE
```

Sem nova evidência, sem promoção. **PASS.**

---

## §7 — O que falta em cada `EVIDENCIA_INSUFICIENTE`

Nenhuma foi promovida para aumentar cobertura. O que falta, caso a caso:

| capacidade | falta | por quê |
|---|---|---|
| `CRIAR_CRIATIVO` | **CÓDIGO** | o código publicado não tem o caminho; nenhuma execução mudaria isso |
| `GERAR_REATIVACAO` | **desbloqueio** | policy `false`, cron 65 off, nível 0 — não é falta de evidência, é bloqueio |
| `ESCALAR_TASK_RETENCAO` | **EFEITO** | 12 concluídas contra 128 descartadas |
| `CRIAR_TASK_HUMANA` | **EFEITO** | 272 concluídas contra 2.039 descartadas |
| `APROVAR_ACAO_DE_RISCO` | **EFEITO** | 82% expira |
| `OPERAR_META_ADS` | **EXECUÇÃO** | 6 execuções contra 272 análises |
| `CORRIGIR_ATRIBUICAO_DE_LEAD` | **EXECUÇÃO** | 6 correções em 786 decisões |
| `ROTEAR_NECESSIDADE_PARA_EXECUTOR` | **CONSUMIDOR** | alcança 2 de 23 |
| `EXECUTAR_AB_DE_COMPORTAMENTO` | **CONSUMIDOR** | ninguém chama |

---

## §10 — Os 79% sem autoria **não** bloqueiam a validação de capacidades

Medido por canal, em 30 dias:

| canal | efeitos | atribuíveis a executor | cobertura |
|---|---|---|---|
| `joao_envios` | 2.271 | 2.271 | **100%** |
| `waba_disparos_lista` (enviado) | 239 | 215 | **90%** |
| `mensagem_envio` | 15.325 | 3.082 | **20,1%** |

A conclusão honesta é mais estreita do que o número assustador sugere. **Todas as 9 capacidades
registradas com efeito externo foram provadas em canais com ≥90% de atribuição.** O buraco de
80% está em `mensagem_envio`, que é tabela de **observação** do canal (15.220 das 15.325 linhas
têm `status='observada'`), não fila de envio.

Então: o gap **não impede** validar quem consegue fazer. Ele impede outra coisa — **medir
resultado por executor sobre o que trafega no canal**. Que é exatamente o que
`MEDIR_RESULTADO_REATIVACAO` pede, e por isso as duas ausências são a mesma ausência vista de
dois ângulos.

Não corrigi nada: a §10 só autoriza correção determinística de baixo risco **já autorizada**, e
essa não está.

---

## §11 — De quem é a culpa em cada erro

| classe | n | casos |
|---|---|---|
| `AUSENCIA_REAL` | 14 | o mapa está certo: ninguém sabe fazer |
| `NECESSIDADE_MAL_TRADUZIDA` | 4 | **a fonte não continha necessidade**: duas ordens de parar, uma espera deliberada, uma correção de fato |
| `TAXONOMIA_ERRADA` | 1 | `MONITORAR_SAUDE_DE_EXECUTOR` grossa demais |
| `CONFIRMADO` | 1 | rota boa |
| `FALHA_DE_COBERTURA` | **0** no roteamento | mas **9 executores** faltavam no mapa (§5) |
| `ERRO_DO_ROUTER` | **0** | nenhum caso em que o router errou dada a capacidade correta |

Os 4 `NAO_TRADUZIVEL` merecem atenção: `gap_do_mapa` e `frentes.proximo_passo` **misturam
necessidade com decisão de não agir**. "PARAR conforme instrução do dono" e "não criar o consumidor
antes de 04/09" são ordens, não pedidos de execução. Um router ligado a essas fontes cruas
tentaria rotear uma ordem de parada.

---

## §15 e §16 — Cobertura por território

| | econômico | sistema |
|---|---|---|
| necessidades | 8 | 12 |
| traduzíveis para capacidade | 6 (75%) | 10 (83%) |
| `EXECUTOR_APTO` | **1** (12,5%) | **1** (8,3%) |
| `CAPACIDADE_AUSENTE` | 5 | 9 |
| falso positivo | 0 | **1** |

**A cobertura é ruim nos dois territórios e por motivos diferentes.** No econômico faltam
capacidades de **medição** (custo, margem, desfecho). No sistema falta uma capacidade de
**engenharia** — publicar edge — que sozinha trava 21 frentes.

Sobre a pergunta da §15 — *o mapa responde "quem sabe fazer isso?" sem depender de memória
humana?* — **em 1 dos 8 casos econômicos, sim.** Nos outros 7 a resposta honesta do mapa é
"ninguém" ou "isso não é uma necessidade". Responder "ninguém" **é** responder; o que ainda
depende de memória humana é a tradução, não a consulta.

---

## §17 — Cobertura não foi otimizada

O mapa foi de 13 para **21 executores** e de 18 para **34 capacidades**, e a distribuição
**piorou** de propósito: as capacidades novas trouxeram 7 ausências novas junto. Se o objetivo
fosse número, eu não teria adicionado `PUBLICAR_EDGE_FUNCTION` nem
`CURAR_BASE_DE_CONHECIMENTO_PRODUTO` — capacidades sem nenhum executor, que só fazem o mapa
parecer pior.

| mapa | R79 | R80 |
|---|---|---|
| capacidades no vocabulário | 18 | **34** |
| registros vigentes | 15 | **24** |
| executores | 13 | **21** (6 não-agentes) |
| `EXECUTOR_APTO` | 8 | 15 |
| `CAPACIDADE_AUSENTE` | 3 | **10** |
| `EVIDENCIA_INSUFICIENTE` | 7 | 9 |

Nenhuma linha foi registrada por descrição. Todas as 9 novas têm consulta de contagem ou de log
como `evidence_ref`, e os guards do banco recusariam o contrário.

---

## §20.14 — Próximo passo

Duas coisas precisam acontecer antes de qualquer roteamento real, nesta ordem:

1. **Reduzir o FPR de tradução, não o do router.** A taxonomia precisa de granularidade onde
   errou: `MONITORAR_SAUDE_DE_EXECUTOR` não cobre saúde de cron/HTTP. E as fontes de necessidade
   precisam separar pedido de execução de ordem de parada — 4 de 20 hoje não são necessidades.
2. **Decidir sobre `PUBLICAR_EDGE_FUNCTION`.** Não é assunto de router: é a capacidade ausente
   que trava 21 frentes e 3 das 6 de prioridade 1. Enquanto ela não existir, o Cérebro sabe
   perfeitamente o que precisa fazer e continua sem conseguir fazer.

Nada disso foi iniciado nesta rodada.

---

## Gate de segurança

| verificação | observado |
|---|---|
| agentes acionados / criados / fundidos / mortos | **0** (23, inalterados) |
| crons alterados | **0** (106 / 93 ativos) |
| edges, prompts, GPS, executor, frentes | **0** |
| efeito externo produzido | **0** |
| consumidor da view do router | **(nenhum)** |
| `crm_campaign_autonomy_policy.ativo` | `false` |
| pré-registros | V1 e V2 intactos, sem V3; desenho congelado até 04/09 |
| objetos criados | 1 tabela append-only (`router_shadow_execucao`) + 1 trigger; 16 linhas de vocabulário e 9 de registro, todas com evidência |
