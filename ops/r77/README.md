# R77 — Censo forense de capacidades do Cérebro

**Data:** 2026-08-26/27 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY / SHADOW. Nenhum agente, prompt, cron, GPS, Worker ou frente foi tocado.
Nenhum efeito externo produzido. Zero writes de produção.

**Regra da rodada:** nome, prompt ou descrição não provam capacidade.
Separar `CAPACIDADE_DECLARADA` / `CAPACIDADE_IMPLEMENTADA` / `CAPACIDADE_COMPROVADA`.

**Regra central:** agentes não são patrimônio. Capacidades são.

---

## Resumo executivo — o que o censo achou que nove rodadas não tinham visto

1. **A máquina de reativação nunca esteve desligada.** As R68–R76 concluíram "exposição
   econômica praticamente zero" ancorando tudo em `crm_campaigns`. Fora desse universo,
   o sistema enviou **239 WhatsApp em 30 dias** por duas funções SQL que não são agentes,
   não têm dono no registro e nunca entraram em nenhum inventário.
2. **21 dos 45 clientes contatáveis da audiência V2 já receberam WhatsApp nos últimos
   60 dias** — inclusive **11 dos 29 `FREQ_2_3`**, que são exatamente a população do
   experimento pré-registrado. O último foi **25/08**, ontem.
3. **Camila não está parada.** Roda toda segunda, no horário, e se abstém corretamente.
   O código v3.5.0 **não tem caminho que gere criativo**. Reativá-la não é ligar uma flag.
4. **O único roteador que existe alcança 2 dos 23 executores**, por string fixa no prompt.
5. **`org_agente_habilidades` tem 0 linhas.** A camada de capacidade declarada não existe
   como dado — só como texto em `agentes.descricao`.

---

## §1 — Inventário

| classe | quantos | evidência |
|---|---|---|
| agentes registrados | **23** | `agentes` |
| crons | **106** (93 ativos, 13 desligados) | `cron.job` |
| edge functions executoras vinculadas a agente | 21 | `agentes.edge_function` |
| funções SQL que produzem efeito externo | **2** (`fn_vigia_ciclo_compra`, `fn_vigia_leads_mornos`) | `cron.job` 107 e 118 |
| humano explicitamente no fluxo | **1** (Alessandro, via `agente-aprovacao`) | `agente_aprovacoes` |

Retenção de `cron.job_run_details`: **03/08 a 26/08** (~23 dias, 42.593 execuções). Os 13 crons
desligados não têm nenhuma execução nessa janela — estão parados há pelo menos 23 dias.

### Atividade real por agente (30 dias)

| agente | pessoa | decisões 30d | efeito externo 30d | acionado por |
|---|---|---|---|---|
| `agente-direct` | Felipe | 8.747 | 0 | cron 5min |
| `agente-comentario` | Larissa | 4.407 | 0 | cron 10min |
| **`agente-noturno`** | **João** | **4.129** | **1.957** | cron 2min |
| `agente-exploracao` | Júlia | 3.689 | 0 *(ver §4)* | webhook inbound, **sem cron** |
| `agente-objecoes` | Isabela | 3.023 | 0 | cron 2h |
| `agente-conversacao` | Bruno | 1.201 | 30 | orquestrador + cron |
| `agente-pipeline` | Rafael | 1.006 | 0 | orquestrador, **sem cron** |
| `orquestrador` | Caio | 900 | 0 | 3 crons |
| `agente-atribuicao` | Luciana | 786 | 0 | 2 crons |
| `agente-observacao` | Fábio | 388 | 0 | 2 crons |
| `agente-midia` | Gustavo | 157 | 0 | 2 crons |
| `agente-autonomia` | André | 146 | 0 | 1 cron (o de avaliação está OFF) |
| **`agente-retencao`** | **Vera** | **117** | **13** | **cron SQL 107, sem edge** |
| `agente-fechamento` | Marcos | 79 | 0 | 2 crons |
| `agente-insights` | Diego | 36 | 0 | 2 crons |
| `agente-memoria` | Renata | 34 | 0 | 2 crons |
| `agente-campanhas-crm` | Tiago | 9 | 1 | cron **OFF** |
| `agente-supervisor` | Ricardo | 7 | 0 | 4 crons ativos *(ver §4)* |
| `agente-criativo` | **Camila** | 5 | 0 | cron semanal ativo |
| `agente-mercado` | Dora | 5 | 0 | cron SQL 108, **sem edge** |
| `agente-aprovacao` | Patrícia | **0** | 0 | 1 cron ativo |
| `agente-laboratorio` | Henrique | **0** | 0 | cron **OFF**, sem decisão autoritativa |
| `go` | GO | **0** | 0 | contido deliberadamente em 14/08 |

---

## §2 — A matriz executor × capacidade não pôde ser lida de `org_agente_habilidades`

```sql
select count(*) from org_agente_habilidades;  -- 0
```

**A tabela de habilidades está vazia.** Existem 31 linhas em `autonomia_capacidades_agente`,
mas elas descrevem **nível de autonomia**, não capacidade — "pode executar / precisa aprovar /
limite financeiro", para 13 dos 23 agentes. Nenhuma responde "o que este executor sabe fazer".

Logo, toda capacidade abaixo foi derivada de **código publicado + evidência de produção**, nunca
de descrição. Foi possível fazê-lo para os 23 — e é por isso que o veredito não é
`TAXONOMIA_INSUFICIENTE`. Mas ver §4: a evidência de *efeito* é que não é confiável.

---

## §3 — Acionamento: "pode ser chamado" ≠ "é chamado"

| classe | executores |
|---|---|
| `ACIONADO_ATUALMENTE` | 20 dos 23 |
| `BLOQUEADO` | `agente-campanhas-crm` (cron OFF + nível 0 + dry_run + policy `false`), `go` (contido 14/08) |
| `ORFAO` | `agente-laboratorio` — cron 88 OFF e `estado_operacional = 'estado_nao_documentado'`, com o próprio motivo dizendo *"não existe decisão autoritativa localizada que prove pausa deliberada ou falha"* |
| `SOB_DEMANDA_HUMANA` | `agente-aprovacao` |

Dois agentes **não têm edge function nenhuma** e mesmo assim decidem todo dia: `agente-retencao`
e `agente-mercado`. Não são agentes — são funções SQL com nome de gente (§10).

---

## §4 — Decisão ≠ execução ≠ efeito externo ≠ resultado

Esta separação derrubou três leituras que pareciam óbvias:

**Ricardo executa e é invisível.** 4 crons ativos, **33 execuções `succeeded`** na janela de
retenção, e só 7 decisões em 30 dias, a última em 19/08. Se o censo tivesse parado em
`agente_decisoes_log`, teria declarado Ricardo inativo. Ele escreveu **hoje**:
`supervisor_log` 23:00:40, `ricardo_recomendacoes` 10:00:31, `supervisor_metas_dia` 10:00:14 —
cada um casando ao segundo com o cron correspondente. **`agente_decisoes_log` não é censo de
atividade.**

**`efeito_externo` é sub-preenchido.** Júlia tem 3.689 decisões em 30 dias e **zero**
`efeito_externo` — sendo a atendente de vendas do WhatsApp. O flag só é populado por João, Vera,
Bruno e Tiago. Não serve para medir efeito no sistema todo.

**79% das mensagens de saída não têm autor conhecido.** Em `mensagem_envio` (30 dias):

| autor | linhas | observação |
|---|---|---|
| **`desconhecido`** | **12.243** | não atribuível a nenhum executor |
| `agente-exploracao` | 1.760 | Júlia |
| `agente-noturno` | 1.286 | João |
| `agente-conversacao` | 25 | Bruno |
| `agente-fechamento` | 2 | Marcos |

Ressalva honesta: 15.220 dessas 15.316 linhas têm `status='observada'` — a tabela é de
**reconciliação**, não de fila de envio. Ela não prova 15 mil envios de agente. Prova que, do
que trafega no canal, **79% não é atribuível a executor nenhum**.

---

## §5 — Caso Camila

| pergunta | resposta com evidência |
|---|---|
| o que **deveria** fazer? | `agentes.descricao`: *"Gera copy e imagem de anúncios usando dados reais de conversão. Copy via Claude Sonnet, imagem via DALL-E 3."* Ferramentas declaradas: DALL-E 3 API, Anthropic API, Meta Ads API. |
| o que **consegue** fazer pelo código? | **Nada disso.** O cabeçalho do `agente-criativo` v3.5.0 diz: *"Contrato: zero Meta, zero geracao externa, zero WhatsApp, zero aprovacao, zero experimento. A Camila registra manter/abster e nao executa criativo."* Não há chamada a DALL-E, Anthropic ou Meta em lugar nenhum do arquivo. |
| ela é chamada? | **Sim.** `agente-criativo-semanal`, segundas 09:00, ativo. Última execução **24/08 09:00:01, `succeeded`**. |
| o que fez de verdade? | 11/08, 17/08 e 24/08: `abstido_sem_criterio`, motivo `solicitacao_criativa_sem_campanha_e_segmento`. Antes disso (v3.4.1): `criativo_proposto` → `pendente_aprovacao` (nunca aprovado) e `criativo_standalone` → `falhou`. |
| decisões por mês | mai **17** → jun **37** → jul **8** → ago **5** |
| existe necessidade compatível? | **Não comprovada.** Gustavo (mídia) opera 157 decisões/mês sem pedir criativo; Tiago está bloqueado. Ninguém emite briefing com `campaign_id` + `segmento`. |

**O ponto que impede a conclusão preguiçosa:** mesmo se alguém mandasse `campaign_id` e
`segmento`, o código v3.5.0 responde `acao = 'manter'` com `geracao_disponivel: false` e
`publicacao_disponivel: false`. **Não existe caminho de geração.** Portanto:

- `CAPACIDADE_DECLARADA` = gerar copy + imagem de anúncio
- `CAPACIDADE_IMPLEMENTADA` = **nenhuma** (só registra abstenção)
- `CAPACIDADE_COMPROVADA` = **nenhuma** (0 criativos aprovados, 0 publicados, 0 efeito externo)

Camila não é um agente parado esperando ser chamado. É um agente **esvaziado por decisão**
(frente `kpis-decisivos-midia`, fail-closed durante o shadow) que continua sendo chamado e
abstendo-se corretamente. Ressuscitá-la exige **redeploy de capacidade**, não religar flag —
e antes disso exige provar necessidade, que hoje não existe.

---

## §6 e §12.A — `AGENTE_NECESSARIO_MAS_PARADO`: **NAO_ENCONTRADO** — e o inverso é verdade

Procurei o caso pedido: necessidade provada + capacidade + executor apto + não acionado.
Não existe. O que existe é o contrário, e é grave.

A necessidade "reativar cliente que passou do próprio ciclo de compra" **já tem executor ativo**:
`fn_vigia_ciclo_compra` (cron 107, dias úteis 15:20), que registra como `agente-retencao`.

O que ela faz, lido do código:

```sql
where dias_sem_comprar > cadencia_dias * 1.5 and dias_sem_comprar >= 10
  and not exists (... waba_disparos_lista nos últimos 21 dias ...)
  and not exists (... crm_tasks pendente ...)
  and not exists (... fact_conversations nas últimas 48h ...)
order by compras desc, ratio desc limit 15
```

e então **insere mensagem real** em `waba_disparos_lista`:

> "Oi {nome}! Bruno da Skillprint aqui 😊 Faz uns {N} dias que não vejo pedido teu."

Isto é a mesma população econômica da R72 (cliente com ≥2 compras, silêncio além da cadência
própria), atingida por outro caminho, com guardrails próprios, **enquanto as R68–R76 concluíam
que a reativação estava parada**.

### Envios reais, 30 dias, fora de `crm_campaigns`

| origem | disparos | status |
|---|---|---|
| `vigia_leads_mornos` (cron 118) | **220** (186 enviados) | função SQL **sem agente dono** |
| `vigia_ciclo_compra` (cron 107) | **50** | Vera |
| `crm_campaign` | 5 | canário do Tiago |
| **total 30d** | **300** (239 `enviado`) | |

### Contaminação da população pré-registrada

| | n |
|---|---|
| contatáveis V2 | 45 |
| **com WhatsApp `enviado` nos últimos 60 dias** | **21** |
| **`FREQ_2_3` (braço do experimento) com WhatsApp enviado** | **11 de 29 (38%)** |
| origem | `vigia_ciclo_compra` 22, `winback_churn_julho` 4 |
| envio mais recente | **25/08 15:20** |

Vera produziu 13 efeitos externos entre 14/08 e 26/08, **4 deles sobre clientes contatáveis da
V2**, e três desses terminaram `convertida`.

**Isto é informação, não autorização.** A R76 congelou o desenho até 04/09 e este censo não o
altera: não mexi no pré-registro, não criei V3, não parei cron nenhum. O fato fica registrado
para o dono decidir — e ele é material, porque um experimento que randomiza pessoas já sob
tratamento ativo não mede o que promete medir.

---

## §7 — Redundância

| par | classe | por quê |
|---|---|---|
| `fn_vigia_ciclo_compra` (Vera) × `agente-campanhas-crm` (Tiago) | **SOBREPOSICAO_PARCIAL** | Mesma pergunta decisória ("quem devo reativar agora?"), mesmo canal (WhatsApp), mesmo universo econômico — 25 dos 45 contatáveis V2 tocados por Vera. Divergem em unidade (Vera: lead com cadência própria; Tiago: campanha com audiência e política) e em governança (Vera não passa por `crm_campaign_autonomy_policy`). Não é redundância plena: é **a mesma capacidade com dois donos e um só sujeito a governança.** |
| `fn_vigia_leads_mornos` × `agente-conversacao` (Bruno) | **UPSTREAM_DOWNSTREAM** | A função enfileira; o canal e a voz são os mesmos do Bruno. Não competem. |
| `agente-direct` (Felipe) × `agente-comentario` (Larissa) | **ESPECIALIZACAO** | Superfícies distintas do Meta: DM vs comentário público. 13k e 8.7k decisões sem colisão. |
| `agente-noturno` (João) × `agente-exploracao` (Júlia) | **ESPECIALIZACAO** | Recorte temporal declarado (madrugada/fim de semana vs horário comercial). |
| `agente-retencao` × `agente-mercado` | **SEM_EVIDENCIA** | Ambos são funções SQL, mas em domínios disjuntos. |

Deliberadamente **não** repeti o erro playbooks × Isabela: a sobreposição Vera × Tiago só foi
classificada como tal depois de medir os 25 clientes em comum, não por semelhança de nome.

---

## §8 e §12.C — Candidato a deprecar

**`agente-laboratorio` (Henrique) — `CANDIDATO_A_DEPRECAR`, confiança MÉDIA.**

- 0 decisões em 30 dias, última em **23/07**; 234 no total.
- Cron 88 (`agente-laboratorio-monitorar`) desligado, sem execução na janela de retenção.
- `estado_operacional = 'estado_nao_documentado'` — a própria anotação diz que **não existe
  decisão autoritativa** provando pausa deliberada nem falha.
- `responsabilidades` vazio, `ferramentas` vazio: é o único agente sem nenhuma das duas.
- `lab_experimentos` tem 7 linhas.

**Contraevidência que impede matar:** a capacidade dele (A/B de comportamento de agente) é
justamente a que faltará quando o experimento de reativação sair do papel. Deprecar o executor
sem realocar a capacidade seria destruir patrimônio pela regra central desta rodada.

**Não é candidato:** `go` (contenção deliberada e documentada em 14/08, com telemetria em outro
projeto Supabase — evidência fora do escopo, classificar como UNKNOWN, não como inútil) e
`agente-aprovacao` (ver §9 — ela funciona; quem falha é o humano).

---

## §9 e §12.D — Capacidades ausentes

Partindo de necessidades reais em aberto:

| necessidade | quem executa hoje | classe |
|---|---|---|
| atribuir autor a mensagem de saída | ninguém — 79% `desconhecido` | **CAPACIDADE_AUSENTE** |
| responder "quem sabe fazer X?" | ninguém — `org_agente_habilidades` vazia | **CAPACIDADE_AUSENTE** |
| impedir que dois executores toquem o mesmo cliente | parcial: cada `vigia_*` tem guardrail próprio, mas **nenhum coordenador entre eles** | **CAPACIDADE_AUSENTE** |
| gerar criativo de anúncio | Camila declara, não implementa | **APENAS_DECLARADA** |
| aprovar ação de risco (humano) | Patrícia + Alessandro — **existe e é medível** | `COMPROVADA`, com desempenho ruim: **602 expirados / 76 aprovados / 46 rejeitados = 82% morre por timeout** |

A terceira linha é a que dói: a sobreposição do §7 não é acidente de desenho, é **ausência de
um coordenador**. Cada função sabe evitar a si mesma (`not exists ... 21 dias`), nenhuma sabe da
outra.

E não: nada disso pede agente novo. Ver §10.

---

## §10 — Agente, Worker, função ou humano?

| capacidade | executor adequado | hoje |
|---|---|---|
| vigiar ciclo de compra | **FUNCAO_DETERMINISTICA** | já é — e funciona. O nome "agente-retencao" é rótulo, não arquitetura |
| radar de demanda | **FUNCAO_DETERMINISTICA** | já é (`fn_dora_radar_executar`) |
| atribuir autoria de mensagem | **FUNCAO_DETERMINISTICA** | ausente |
| coordenar quem fala com o cliente | **FUNCAO_DETERMINISTICA** (lock por cliente, não LLM) | ausente |
| gerar criativo | **AGENTE** | esvaziado |
| aprovar risco | **HUMANO** | existe, 82% expira |
| roteirizar necessidade → executor | **MISTO** (registro determinístico + escolha) | ver §14 |

Duas das cinco lacunas se resolvem com função SQL e trigger. **Nenhuma pede agente novo.**
Vera e Dora provam que o sistema já sabe entregar capacidade sem LLM — e que chamar isso de
"agente" no registro é o que faz o inventário mentir.

---

## §11 — Três testes NECESSIDADE → EXECUTOR

**1. "Reativar 29 clientes `FREQ_2_3` esfriando."**
capacidade: contato WhatsApp segmentado por ciclo · executores: Vera (ativa), Tiago (bloqueado),
`vigia_leads_mornos` (ativa, sem dono) · acionável: **sim, e já está acionada** ·
**gap: ninguém no sistema sabe que os três disputam o mesmo cliente.**

**2. "Gerar criativo para uma campanha de reativação."**
capacidade: copy + imagem · executor: Camila · estado: chamada semanalmente, abstendo-se ·
acionável: **não** — o código não tem caminho de geração · **gap: capacidade removida, contrato
declarado não atualizado.**

**3. "Aprovar um envio de risco em menos de 6 horas."**
capacidade: decisão humana · executor: Patrícia + Alessandro · acionável: **sim** ·
**gap: 82% expira.** A capacidade existe; a latência humana é o gargalo, e ela é medível.

O sistema **não** conseguiu raciocinar nenhum dos três sozinho. Em todos, quem ligou necessidade
a executor fui eu, lendo código. Não há objeto no banco que faça isso.

---

## §12 — Os quatro casos

| caso | veredito | confiança |
|---|---|---|
| **A. AGENTE_NECESSARIO_MAS_PARADO** | **NAO_ENCONTRADO.** Encontrado o inverso: executor ativo e não contabilizado (Vera) atuando sobre população que outra frente tratava como intocada | **ALTA** — 21/45 e 11/29 com `status='enviado'`, último 25/08 |
| **B. REDUNDANCIA_CANDIDATA** | **SOBREPOSICAO_PARCIAL** Vera × Tiago | ALTA (25 clientes em comum medidos) |
| **C. AGENTE_SEM_UTILIDADE_PROVADA** | `agente-laboratorio` — `CANDIDATO_A_DEPRECAR` | MÉDIA (contraevidência: capacidade futura necessária) |
| **D. CAPACIDADE_IMPORTANTE_AUSENTE** | coordenação entre executores que falam com o mesmo cliente | ALTA (é a causa provada de B) |

### Auto-refutação

| tentativa | resultado |
|---|---|
| Vera só *decide*, não contata? | **Refutado.** O código insere em `waba_disparos_lista` com texto de mensagem; 239 `enviado` em 30 dias na tabela. |
| A contaminação é antiga? | **Refutado.** Envios de 14/08 a 25/08; a V2 foi construída em 21–22/08. |
| Os 25 em comum são coincidência de universo? | **Parcialmente aceito** — os dois partem da mesma definição econômica. Por isso classifiquei `SOBREPOSICAO_PARCIAL` e não `REDUNDANCIA_REAL`. |
| Camila está só sem input? | **Refutado pelo código.** Com input completo ela responde `manter` + `geracao_disponivel: false`. |
| Ricardo está parado? | **Refutado.** 33 crons `succeeded` e três tabelas escritas hoje. |
| `agente_decisoes_log` cobre tudo? | **Refutado.** Ricardo é invisível nele; Júlia tem `efeito_externo=0` sendo a atendente do WhatsApp. |
| O roteador alcança todos? | **Refutado empiricamente.** 3.299 decisões históricas, só `agente-conversacao` (620) e `agente-pipeline` (84) já foram roteados. |

---

## §13 — Contrato mínimo proposto (**não criado nesta rodada**)

```
capability_id      text
capacidade         text        -- verbo + objeto, nunca nome de pessoa
executor           text
tipo_executor      text        -- AGENTE | WORKER | FUNCAO | HUMANO | MISTO
status             text        -- COMPROVADA | PARCIAL | IMPLEMENTADA_NAO_PROVADA
                               -- | APENAS_DECLARADA | BLOQUEADA | INATIVA | NAO_POSSUI
evidencia          jsonb       -- consulta que prova, não descrição
confidence         text        -- ALTA | MEDIA | BAIXA | UNKNOWN
last_verified_at   timestamptz
estado_executor    text
acionavel          boolean
bloqueio           text
```

Duas exigências que este censo mostrou serem indispensáveis:

1. `evidencia` guarda **a consulta**, não a frase. Toda linha desta rodada que resistiu foi a que
   tinha consulta; toda que caiu foi a que tinha descrição.
2. `status` precisa de `NAO_POSSUI` **explícito**. Camila declarada como "gera criativo" com
   `status` vazio seria pior do que não ter tabela.

---

## §14 — `CAPABILITY_ROUTER_PODE_IR_PARA_SHADOW?` → **AINDA_NÃO**

O que existe hoje como roteador é o `orquestrador` v3.5.2. O universo dele é **uma string fixa
no system prompt**:

```
AGENTES: agente-conversacao (WhatsApp) | agente-pipeline (task Tamires) | nenhum
```

e o JSON forçado repete `"agente":"agente-conversacao|agente-pipeline|nenhum"`.

- Alcança **2 dos 23** executores. Confirmado em 3.299 decisões: nunca roteou para outro.
- Em 30 dias: 695 `nenhum`, 137 conversação, 5 pipeline — **decide "nenhum" em 78% dos casos**.
- Contém um ramo morto: o guardrail `agenteEscolhido === 'agente-fechamento' && bloquearMarcos`
  nunca pode disparar, porque `agente-fechamento` não está no conjunto permitido. Zero
  ocorrências no histórico.
- Não lê `agentes`, não lê capacidade, não lê estado. Lê **nível de autonomia** de dois slugs
  fixos (`getAgenteNivel`).

Três bloqueios objetivos para o shadow, nesta ordem:

1. **Não há registro de capacidade.** `org_agente_habilidades` = 0 linhas. Um roteador em shadow
   hoje rotearia por `agentes.descricao` — capacidade **declarada**, exatamente o que a regra
   desta rodada proíbe. Camila seria roteada para gerar criativo e não geraria nada.
2. **A telemetria de efeito não sustenta a decisão.** `efeito_externo` é sub-preenchido e
   `agente_decisoes_log` não cobre Ricardo. Um roteador que aprende com esses sinais aprende
   errado.
3. **Falta o coordenador do §9.** Rotear antes de saber quem já está falando com o cliente
   multiplica o problema Vera × Tiago em vez de resolvê-lo.

O primeiro é o único que precisa existir antes: **popular o registro de capacidade com evidência
executável** — o contrato do §13, preenchido pelo método desta rodada. Os outros dois se medem
depois. Nada disso é uma proposta para executar agora.

---

## §15 — Veredito

```
MAPA_DE_CAPACIDADES_PARCIAL
```

**Parcial, e não viável**, porque foi possível derivar capacidade real para os 23 executores a
partir de código publicado e evidência de produção — mas as duas fontes que um mapa automático
usaria estão quebradas na dimensão que mais importa: `org_agente_habilidades` está **vazia** e
`efeito_externo` é **sub-preenchido**. O mapa é construível por auditoria; ainda não é
construível por consulta.

**Parcial, e não insuficiente**, porque a taxonomia pedida funcionou: separar declarada /
implementada / comprovada foi o que revelou Camila, e separar decisão / execução / efeito foi o
que revelou Ricardo e, sobretudo, Vera.

O achado que justifica a rodada é o do §6. Nove rodadas concluíram que a reativação estava
parada porque todas ancoraram no mesmo lugar — `crm_campaigns`. O censo, ao perguntar
"quem **consegue** enviar WhatsApp?" em vez de "a campanha disparou?", encontrou **239 envios em
30 dias** por duas funções sem dono, tocando **11 dos 29 clientes** do experimento pré-registrado,
o mais recente **ontem**.

Agentes não são patrimônio. Capacidades são — e a capacidade mais cara deste sistema estava
funcionando o tempo todo, sem nome, sem dono e sem aparecer em nenhum inventário.

---

## Gate de segurança

| verificação | observado |
|---|---|
| agentes alterados | **0** |
| prompts alterados | **0** |
| crons alterados | **0** (93 ativos / 13 inativos, idênticos ao início) |
| GPS / executor / frentes | **não tocados** |
| agente reativado ou pausado | **0** |
| agente criado, fundido ou removido | **0** |
| objetos criados no banco | **0** — a rodada é somente leitura |
| efeito externo produzido | **0** |
| pré-registro V1 / V2 | intactos; nenhuma V3 |
| desenho do experimento | **congelado**, como a R76 determinou até 04/09 |
