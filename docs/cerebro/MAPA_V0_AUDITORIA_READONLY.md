# MAPA V0 do Cérebro — Auditoria READ-ONLY

Projeto Supabase: `ldrdtaibazplvrbwyrvx`
Data da coleta: 2026-08-25 (~05:30 BRT)
Modo: SOMENTE LEITURA. Nenhum DDL, DML, deploy, migration ou alteração de configuração.
Método: `SELECT` sobre catálogo e tabelas + execução de `fn_gps_panorama()` (declarada `STABLE`,
o que o Postgres garante como livre de escrita).

---

## 1. VEREDITO

**MAPA_PARCIAL.**

O Cérebro consegue hoje responder com prova 3 das 9 perguntas do MAPA (onde estamos,
quais capacidades existem no papel, quais restrições internas estão registradas).
Não consegue responder, com prova, as perguntas de destino econômico, relação causal
e rota — que são exatamente as que transformam backlog em GPS.

Não é MAPA_INSUFICIENTE porque existe um núcleo de fatos empresariais reais, frescos e
auditáveis (receita, meta, funil, mídia, cobertura de contato, margem parcial).
Não é MAPA_POSSIVEL porque o destino da empresa não é medível pela estrutura que o
declara, a cadeia causal econômica não existe em lugar nenhum, e a fonte de receita é
um proxy de marketing que a própria casa já registrou como não reconciliado.

---

## 2. O QUE O CÉREBRO JÁ SABE (fatos comprovados)

### 2.1 Escala do sistema
| Item | Valor |
|---|---|
| Tabelas (public) | 494 |
| Views | 286 |
| Funções | 810 |
| Edge functions ACTIVE | 302 |
| Cron jobs ativos | 93 |
| Execuções de cron em 24h | 5.438 — 100% `succeeded` |

### 2.2 Resultado comercial do mês (fresco)
Fonte: `meta_comercial`, atualizada 2026-08-24 18:00 UTC por `fn_atualizar_meta_comercial()`.

| Campo | Valor |
|---|---|
| Meta faturamento ago/2026 | R$ 118.000,00 |
| Realizado | R$ 94.376,06 |
| **Gap** | **R$ 23.623,94** |
| Meta vendas | 300 |
| Vendas realizadas | 234 |
| Gap vendas | 66 |
| Status | `no_ritmo` |
| Oportunidades ativas | 3.278 |
| Mornos / Quentes / Fechamento | 1.377 / 120 / 2 |

### 2.3 Série histórica de receita (`pixel_events`, evento `Purchase`)
| Mês | Compras | Receita |
|---|---|---|
| 2026-08 (até 25) | 235 | R$ 94.445,96 |
| 2026-07 | 244 | R$ 86.077,25 |
| 2026-06 | 211 | R$ 81.098,34 |
| 2026-05 | 245 | R$ 117.552,16 |
| 2026-04 | 240 | R$ 104.046,60 |

Ticket 90d: média R$ 390,35 / **mediana R$ 119,80** (n=719) — distribuição fortemente
assimétrica; a mediana é a base honesta para estimar impacto.

### 2.4 Mídia paga (`meta_ads_insights`, sync 2026-08-25)
| Mês | Gasto | Ads distintos |
|---|---|---|
| 2026-08 (até 24) | R$ 2.329,45 | 13 |
| 2026-07 | R$ 5.980,12 | 39 |
| 2026-06 | R$ 7.797,86 | 28 |
| 2026-05 | R$ 4.518,11 | 29 |

**O investimento em mídia caiu ~61% de julho para agosto.**

### 2.5 Leads (`leads_marketing`)
ago 1.014 (24 dias) · jul 1.474 · jun 1.499 · mai 1.180 · abr 1.257.

### 2.6 Margem — parcial e real
Fonte: `vw_margem_por_produto` (acumulado, sem janela de período; cobre apenas famílias
elegíveis BCG ≈ 65% da receita observada).

| Produto | Receita | Custo/m | Margem pior–melhor |
|---|---|---|---|
| dtf_textil | R$ 158.011,48 | R$ 8,00 | 77,7% – 86,6% |
| **vestuario_personalizado** | **R$ 148.957,05** | **null** | **SEM CUSTO CADASTRADO** |
| dtf_uv | R$ 10.227,71 | R$ 40,00 | 46,7% – 59,6% |
| objeto_personalizado | R$ 143,60 | null | SEM CUSTO CADASTRADO |

**~47% da receita coberta pela view não tem margem calculável.**

### 2.7 Cobertura de contato — o fato mais acionável do mapa
Cruzamento `lead_score_comercial` × `mensagem_envio` com `provider_message_id` não nulo
(prova de envio real), janela 30 dias. Score é fresco: 1.030 leads reavaliados em 7 dias,
último em 2026-08-25 07:15 UTC.

| Classificação | Leads | Tocados 30d | Cobertura |
|---|---|---|---|
| **fechamento** | **2** | **0** | **0,0%** |
| quente | 121 | 40 | 33,1% |
| morno | 1.394 | 412 | 29,6% |
| cliente_ativo | 237 | 35 | 14,8% |
| frio | 1.541 | 49 | 3,2% |

### 2.8 Fila de aprovação humana (`agente_aprovacoes`, 724 registros)
| Status | N | % |
|---|---|---|
| **expirado** | **602** | **83%** |
| aprovado | 76 | 10% |
| rejeitado | 46 | 6% |
| pendente | 0 | 0% |

Última aprovação concedida: **2026-07-25** (há ~1 mês).
Por agente: Isabela 457 pedidos / 89% expirados · Gustavo 76 / 93% expirados ·
Ricardo 144 / 63% · Camila 3 / 100%.

### 2.9 Frentes e esperas
265 frentes: 123 fechadas, 70 em andamento, 27 abertas, **27 bloqueadas**, 18 arquivadas.
54 esperas abertas, das quais **26 dependem de humano** (14 `decisao_humana`, 12 `acao_humana`),
3–6 dias em média.

---

## 3. O QUE ELE ACHA QUE SABE, MAS NÃO PROVA

1. **"Receita" é evento de pixel, não financeiro.** `fn_atualizar_meta_comercial()` lê
   `pixel_events_br WHERE event_name='Purchase'`. Não há conferência contra caixa, nota ou
   recebimento. A própria casa registrou a dúvida em `cerebro_futuro`:
   *"Reconciliar vendas reais (CalcMe 289 vs pixel 238)"* — aberto desde 29/04/2026.

2. **`efeito_externo` é subnotificado, não é medida de efeito.** Em 30 dias apenas 4 dos 23
   agentes têm `efeito_externo=true`. Mas `agente-exploracao` (Julia) aparece com **0**
   efeitos enquanto enviou **1.425 mensagens reais com `provider_message_id`**. O campo é
   nullable sem default e cada agente preenche como quer. Ele mede *disciplina de logging*,
   não efeito.

3. **"Sistema saudável" mede infra, não missão.** `vw_agentes_saude` conta execuções, erros e
   duração. 5.438 crons `succeeded` em 24h dizem que a máquina liga — não que a empresa avança.

4. **Impacto financeiro das frentes é estimativa, e quase inexistente.** Apenas **6 de 265**
   frentes têm `impacto_mes_estimado`. O campo `impacto_fonte` existe mas o backlog é
   priorizado sem valor econômico.

5. **`sistema_mapa` é apresentado como mapa e não é.** 21 componentes, todos com
   `status='ativo'` fixo, `ultima_revisao` congelada em **2026-05-10**, cobrindo **7%** das
   302 edge functions. É um diagrama técnico velho.

6. **`org_metas` parece uma árvore de metas e não é.** 131 metas ativas, **127 vencidas**
   (período terminou), 130 de 131 são KPIs de processo de agente
   (`dry_run_respeitado_pct`, `aprovacoes_expiradas_pct`). **`org_meta_resultados` tem 0 linhas:
   nenhuma meta jamais teve realizado gravado.**

7. **Metas se contradizem entre si.** Para ago/2026, `meta_comercial` diz realizado
   R$ 94.376,06 e `metas_crescimento` diz R$ 0,00 — a mesma meta de R$ 118.000 em duas
   tabelas, uma viva e uma morta (última escrita 2026-08-05).

8. **`reltuples` mente.** `list_tables` reportou `agentes (0)`, `org_metas (0)`,
   `sistema_mapa (0)`. Contagem real: 23, 131, 21. Qualquer mapa construído sobre estimativas
   de catálogo nasce errado.

9. **Funções de ERP são código órfão.** `fn_baixa_estoque_venda` declara `vendas%ROWTYPE`;
   a tabela `vendas` **não existe em nenhum schema**. `get_daily_revenue`,
   `get_resumo_producao`, `get_produtos_com_estoque_atual` idem. São capacidades declaradas
   que falham em runtime.

10. **Cadastro de agente contradiz a operação.** `agente-retencao` (Vera) tem
    `edge_function = null` mas produziu 127 decisões e 11 efeitos externos em 30 dias.
    O cadastro não descreve como ela executa.

---

## 4. O QUE ELE NÃO SABE (DESCONHECIDO)

| # | Pergunta | Por que importa | Fonte que falta | Confiança | Ação mínima |
|---|---|---|---|---|---|
| U1 | Qual a receita **contábil** do mês? | Toda decisão de meta usa proxy de pixel | ERP / financeiro / conciliação bancária | baixa | Reconciliar 1 mês fechado: pixel × CalcMe × ERP |
| U2 | Qual a **margem real** da empresa? | 47% da receita coberta sem custo; nenhuma margem consolidada | custo de `vestuario_personalizado` em `catalogo_produtos` | baixa | Cadastrar custo da família de maior ticket (R$ 954,85) |
| U3 | Qual o **caixa**? | Objetivo C do MAPA não tem nenhuma fonte | não existe tabela financeira no projeto | nula | Definir fonte antes de prometer o bloco |
| U4 | Qual a **capacidade produtiva** e a ociosidade? | "capacidade operacional" é objetivo pedido | sem produção/PCP neste banco (está no repo `skillprint-erp`) | nula | Decidir se o ERP entra no mapa ou fica fora do V0 |
| U5 | Qual o **estoque**? | idem | idem | nula | idem |
| U6 | Quais agentes de fato produzem **efeito externo**? | `efeito_externo` é subnotificado | contrato único de "efeito" por canal | média | Derivar efeito de provas por canal, não do campo |
| U7 | Quem enviou **68% das mensagens**? | 9.069 envios zapi/30d com `autor_tipo='desconhecido'` | carimbo de autoria no ingest zapi | baixa | Medir a lacuna antes de atribuir resultado a agente |
| U8 | Os **93 crons** fazem o que dizem? | 5.438 execuções OK, mas só **3 job_names** logam em `cron_execution_log` | log de negócio por job | baixa | Não concluir nada: hoje é indistinguível de silêncio |
| U9 | **Meta Ads → venda** existe como cadeia? | é a relação causal central do negócio | nenhuma tabela liga campanha→lead→venda→receita ponta a ponta | baixa | Ver `crm_campaign_attributions` / `atribuicao_*` (vazias) |
| U10 | Cortar mídia 61% **causou** algo? | decisão de maior valor financeiro do mês | série contrafactual / experimento | baixa | Não afirmar causalidade; só correlação registrada |

---

## 5. CAPACIDADES REAIS — declarada vs operacional vs comprovada

Critério aplicado:
- **DECLARADA** = existe em `agentes` com `status='ativo'`.
- **OPERACIONAL** = decidiu nos últimos 30 dias E não está em `dry_run`.
- **COMPROVADA** = tem prova de efeito externo em 30 dias por evidência independente
  (`mensagem_envio.provider_message_id`, ou `agente_decisoes_log.efeito_externo`, ou
  registro de execução no canal).

| Agente | Papel | Decl. | Oper. | Compr. | Evidência / bloqueio |
|---|---|---|---|---|---|
| João (`agente-noturno`) | vende / conduz | ✅ | ✅ | ✅ | 1.775 efeitos, 719 conversões, 1.095 envios zapi, 255 leads |
| Julia (`agente-exploracao`) | atende / orça | ✅ | ✅ | ✅ | 1.425 envios botconversa, 378 leads — **apesar de `efeito_externo=0`** |
| Bruno (`agente-conversacao`) | conversa | ✅ | ✅ | ✅ | 16 envios, 12 leads — volume marginal |
| Vera (`agente-retencao`) | retenção | ✅ | ✅ | ✅ | 11 efeitos, 35 conversões — **sem `edge_function` cadastrada** |
| Gustavo (`agente-midia`) | gerencia mídia | ✅ | ⚠️ decide | ❌ | 154 decisões, **`gustavo_meta_acoes` = 0 linhas**, 93% das aprovações expiradas |
| Camila (`agente-criativo`) | cria | ✅ | ❌ | ❌ | 6 decisões/30d, `canva_arte_exportacoes` = 1, 100% aprovações expiradas |
| Tiago (`agente-campanhas-crm`) | CRM/e-mail | ✅ | ❌ `dry_run` | ❌ | `crm_email_send_attempts` = 1, `crm_campaign_results` = 1 |
| Isabela (`agente-objecoes`) | objeções | ✅ | ❌ `dry_run` | ❌ | 2.972 decisões, 457 aprovações, **89% expiradas** |
| Felipe (`agente-direct`) | direct | ✅ | ❌ `dry_run` | ❌ | 8.747 decisões, 0 efeito |
| Larissa (`agente-comentario`) | comentários | ✅ | ❌ `dry_run` | ❌ | 4.407 decisões, 0 efeito |
| Luciana (`agente-atribuicao`) | atribui | ✅ | ✅ | ⚠️ interno | 786 decisões; efeito é interno ao dado |
| Rafael, Caio, Fábio, Renata, André, Diego, Marcos, Ricardo, Patrícia, Dora, Henrique, GO | infra/gestão | ✅ | parcial | ❌ | nenhum efeito externo em 30d |

**Resumo: de 23 agentes declarados, 4 têm efeito externo comprovado. 6 estão em `dry_run`.
2 não têm `edge_function`. A capacidade real de agir sobre o cliente está concentrada em
João e Julia.**

Capacidades não-agente:
- **WhatsApp (zapi + botconversa)**: COMPROVADA — 12.959 envios observados/30d.
- **Meta Ads (leitura)**: COMPROVADA — sync diário, dados até 24/08.
- **Meta Ads (escrita/execução)**: **NÃO COMPROVADA** — zero ações registradas.
- **Brevo/e-mail**: DECLARADA, praticamente não executada (1 tentativa).
- **Canva**: DECLARADA, 1 exportação.
- **ERP (produção/estoque/fiscal)**: DECLARADA em 11 edge functions e ~40 funções SQL;
  **as tabelas não existem neste banco** → NÃO OPERACIONAL aqui.

---

## 6. GARGALOS REAIS (com evidência, não opinião)

**G1 — Fila de aprovação humana morta.** 602 de 724 aprovações expiraram (83%). Nenhuma
aprovação desde 25/07. Consequência causal direta: os 6 agentes em `dry_run` não têm caminho
de saída, porque a saída depende de aprovação. *Evidência: `agente_aprovacoes`.*

**G2 — Base de oportunidades não é trabalhada.** 3.278 oportunidades ativas; **os 2 leads em
estágio `fechamento` não receberam nenhuma mensagem em 30 dias**; 81 dos 121 quentes intocados;
982 mornos intocados; 202 de 237 clientes ativos sem contato. *Evidência: cruzamento
`lead_score_comercial` × `mensagem_envio` com prova de provider.*

**G3 — Mídia declarada e não executada.** Gustavo decide, não age (`gustavo_meta_acoes`=0), e
93% dos seus pedidos de aprovação expiram. Em paralelo o gasto caiu 61%. *Evidência:
`meta_ads_insights` + `agente_aprovacoes`.*

**G4 — Backlog sem valor econômico.** 6 de 265 frentes têm impacto estimado. O GPS ordena
265 frentes por prioridade e precedência sem saber quanto vale nenhuma. *Evidência: `frentes`.*

**G5 — Autoria de efeito perdida.** 9.069 envios (68% do total) sem autor. Impossível atribuir
resultado a capacidade. *Evidência: `mensagem_envio`.*

**G6 — Margem cega no produto de maior ticket.** `vestuario_personalizado`: R$ 148.957 de
receita, ticket R$ 954,85, custo não cadastrado. *Evidência: `vw_margem_por_produto`.*

**G7 — 26 esperas humanas abertas** bloqueando frentes, além de 27 frentes `bloqueada`.

---

## 7. DESENHO MÍNIMO DO MAPA V0 (reutilizando o que existe)

Nada novo precisa ser criado para 5 dos 6 blocos.

| Bloco | Reutiliza | Estado |
|---|---|---|
| **A. Objetivos** | `meta_comercial` (meta, realizado, gap, período, status, `updated_at`) | ✅ pronto e fresco. `org_metas`/`metas_crescimento` ficam **fora do V0** (vencidas, sem resultado, contraditórias) |
| **B. Estado** | `pixel_events` (receita/vendas), `leads_marketing` (leads), `meta_ads_insights` (gasto), `lead_score_comercial` (funil), `vw_margem_por_produto` (margem parcial) | ✅ pronto |
| **C. Capacidades** | `agentes` (declarada) + `agente_decisoes_log` (operacional) + `mensagem_envio.provider_message_id` (comprovada) | ⚠️ precisa da regra de 3 níveis; os dados existem |
| **D. Gargalos** | `agente_aprovacoes` (expiradas), `frentes` (bloqueada), `frentes_espera` (aberta), cobertura de contato | ✅ pronto |
| **E. Relações** | `agente_relacionamentos` (22, sendo 12 `implementado=false`, todas técnicas), `sistema_mapa` (stale) | ❌ **não existe cadeia causal econômica.** Ver proposta abaixo |
| **F. Incertezas** | `cerebro_futuro` (30 abertas, congeladas em 29/04) | ⚠️ estrutura certa, conteúdo morto |

### Representação mínima proposta para RELAÇÕES (bloco E)
Não criar tabela nova nesta fase. A cadeia mínima já é derivável como 5 arestas, cada uma
com uma fonte real e um estado de prova:

```
meta_ads_insights.spend  --[gera]-->  leads_marketing         (prova: PARCIAL — sem chave campanha→lead confiável)
leads_marketing          --[vira]-->  lead_score_comercial    (prova: FORTE — lead_id)
lead_score_comercial     --[é tocado por]--> mensagem_envio   (prova: FORTE — lead_id + provider_message_id)
mensagem_envio           --[precede]--> pixel_events.Purchase (prova: FRACA — apenas temporal)
pixel_events.Purchase    --[compõe]--> meta_comercial.realizado (prova: FORTE — mesma função)
```

Cada aresta carrega `prova ∈ {FORTE, PARCIAL, FRACA, AUSENTE}`. O honesto no V0 é publicar as
arestas **com o rótulo de prova visível**, em vez de desenhar um funil bonito que finge
causalidade onde só há sequência temporal.

### Formato de saída
O schema proposto pelo usuário serve. Uma correção: `qualidade_mapa` não deve ser cosmético —
deve carregar o que reprova o mapa:

```json
{
  "objetivos": [...], "estado": {...}, "capacidades": [...],
  "gargalos": [...], "relacoes": [...], "incertezas": [...],
  "atualizado_em": "...",
  "qualidade_mapa": {
    "blocos_com_fonte": 5, "blocos_totais": 6,
    "fatos": 0, "hipoteses": 0, "desconhecidos": 0,
    "fontes_stale": [...],
    "contradicoes": [...],
    "confianca_global": "media"
  }
}
```

---

## 8. PRIMEIRA SIMULAÇÃO DE GPS GLOBAL

**Pergunta:** qual é hoje o maior gap para o resultado global da Skillprint e quais as 3 rotas
mais plausíveis para reduzi-lo?

**Maior gap medido:** R$ 23.623,94 para a meta de agosto, com ~5 dias úteis restantes.
Estrutural: a empresa tem 3.278 oportunidades vivas e capacidade de contato aplicada a menos
de 1/3 delas.

Antes das rotas, o contraste que define a simulação:

> O GPS live (`fn_gps_panorama()`) devolveu 18 trilhas e frentes como
> `pipeline-memoria-clientes`, `taxonomia-produto`, `gestao-de-segredos`.
> **Nenhuma das 265 frentes é "reduzir o gap de R$ 23,6k".** O GPS não errou a prioridade —
> ele não tem o gap no campo de visão.

### ROTA 1 — Cobrir os leads quentes e de fechamento não tocados
- **Gap atacado:** R$ 23,6k / 66 vendas.
- **Evidência:** 2 leads `fechamento` com 0% de contato em 30d; 81 de 121 quentes intocados.
- **Mecanismo:** lead já qualificado + contato = maior probabilidade de fechar no mês corrente.
- **Capacidades necessárias:** seleção por score, canal WhatsApp, agente de fechamento.
- **Disponíveis:** score fresco (07:15 de hoje); WhatsApp comprovado; João comprovado (255 leads/30d).
- **Faltante/quebrada:** Marcos (`agente-fechamento`) tocou **1 lead em 30 dias**. A capacidade
  de fechamento existe no papel e não opera.
- **Impacto esperado:** 81 quentes × conversão desconhecida × mediana R$ 119,80.
  **Não estimo cifra** — a taxa de conversão quente→venda não está medida (U9).
- **Risco:** baixo (leads já em relacionamento). Saturação se o mesmo lead já falou com Julia.
- **Tempo para observar:** 3–10 dias.
- **Confiança:** **alta** na existência do gap; média no tamanho do ganho.
- **Hipótese que pode estar errada:** que "não tocado por agente" signifique "não atendido" —
  68% dos envios não têm autoria (U7), então parte desses leads pode ter sido atendida por
  humano sem registro.

### ROTA 2 — Destravar a fila de aprovação humana
- **Gap atacado:** capacidade instalada e desligada.
- **Evidência:** 602/724 aprovações expiradas; nenhuma desde 25/07; 6 agentes presos em `dry_run`.
- **Mecanismo:** aprovação concedida → agente sai de `dry_run` → executa → efeito externo.
- **Necessárias:** decisão humana; `agente-aprovacao` (Patrícia).
- **Disponíveis:** Patrícia está ativa; a fila funciona tecnicamente (registra e expira).
- **Faltante:** **o humano.** Não é falha de software.
- **Impacto esperado:** desbloqueia Gustavo (mídia) e Isabela (objeções) — os dois maiores
  volumes de decisão represada. **Cifra desconhecida.**
- **Risco:** médio-alto. Ligar agentes nunca validados externamente, em massa, é risco real.
- **Tempo:** 1–4 semanas para ver efeito.
- **Confiança:** alta no diagnóstico, **baixa no ganho** — nunca operaram; não há baseline.
- **Hipótese que pode estar errada:** que expirado = negligência. Pode ser rejeição tácita
  deliberada, e nesse caso "destravar" é ignorar uma decisão de negócio já tomada.

### ROTA 3 — Fechar a cegueira de margem no produto de maior ticket
- **Gap atacado:** margem/lucro (objetivo B), não faturamento.
- **Evidência:** `vestuario_personalizado` — R$ 148.957 de receita, ticket R$ 954,85,
  `custo_metro = null`, obs `SEM CUSTO CADASTRADO`.
- **Mecanismo:** sem custo não há decisão de mix, desconto ou prioridade de campanha.
- **Necessárias:** custo em `catalogo_produtos`; a view já calcula sozinha depois.
- **Disponíveis:** `vw_margem_por_produto` funciona e já entrega dtf_textil (77,7–86,6%).
- **Faltante:** **um dado humano** — o custo.
- **Impacto:** nenhum em receita. Alto em qualidade de decisão.
- **Risco:** mínimo.
- **Tempo:** imediato ao cadastrar.
- **Confiança:** **alta** — é o item mais barato e mais certo dos três.
- **Hipótese que pode estar errada:** que `vestuario_personalizado` seja custeável por metro;
  se for peça comprada, o modelo da view não serve e o número sairia errado.

### Escolha
**Não há rota vencedora com evidência suficiente para o objetivo de receita.**

Rotas 1 e 2 atacam o gap financeiro mas **nenhuma tem taxa de conversão medida** — eu
conseguiria justificar qualquer uma com uma narrativa, e nenhuma com um número. Escolher
seria fazer exatamente o que esta auditoria condena.

**VEREDITO DA SIMULAÇÃO: MAPA_INSUFICIENTE PARA ESCOLHA DE ROTA.**

O que o mapa sustenta hoje: a Rota 3 como ação de **redução de incerteza** (barata, certa,
sem risco), e a Rota 1 como candidata forte **assim que a conversão quente→venda for medida**.

---

## 9. REFUTAÇÃO — onde esta análise pode estar errada

1. **A receita pode estar errada na origem.** Tudo aqui se apoia em `pixel_events.Purchase`.
   Se o pixel duplica, perde venda de balcão ou registra valor de pedido em vez de pago,
   o gap de R$ 23,6k é ficção. A casa já registrou a divergência (CalcMe 289 × pixel 238).
   **Fonte mais autoritativa existe (ERP/CalcMe) e não foi consultada** — está fora deste banco.

2. **Cortei mídia como causa sem prova.** Gasto caiu 61% e a receita **subiu** (86k→94k).
   Isso refuta a leitura intuitiva. Pode ser sazonalidade, recompra ou atraso de atribuição.
   **Registro como correlação; não afirmo causalidade.**

3. **"Leads = 3 em agosto" no `meta_ads_insights` é implausível** (441 em julho) e contradiz
   `leads_marketing` (1.014 em agosto). Provável quebra de atribuição na coluna, não colapso
   de captação. Não usei esse número em nenhuma conclusão.

4. **Cobertura de contato pode estar subestimada.** Só contei `mensagem_envio` com
   `provider_message_id` e `autor_tipo='agente'`. Os 9.069 envios sem autor podem incluir
   contato real aos leads que classifiquei como intocados. **G2 pode ser menos grave do que
   parece** — mas continua verdadeiro que o sistema não sabe quem foi contatado.

5. **"93 crons mas só 3 logam" não prova cron parado.** `cron_execution_log` só recebe de jobs
   que chamam `fn_cron_log_start/finish`. `cron.job_run_details` mostra 5.438 execuções
   `succeeded`/24h. **Corrigido para DESCONHECIDO (U8); não é gargalo.**

6. **`efeito_externo=0` não prova agente inerte** — provado pelo caso Julia. Por isso
   reclassifiquei capacidade por evidência independente. Mas a inversa também vale:
   **Gustavo pode estar executando mídia por fora sem registro.** O que afirmo é que
   *o Cérebro não tem prova* — não que ele não aja.

7. **Aprovações expiradas podem ser decisão, não omissão.** Se o dono decidiu conscientemente
   não ligar esses agentes, G1 não é gargalo — é política. Não há campo que distinga
   "esqueceu" de "recusou por silêncio".

8. **`vw_margem_por_produto` não tem janela de período.** Apresentei a receita dela como
   acumulada e ela cobre ~65% da receita total do pixel (só famílias elegíveis BCG). Não é
   receita da empresa; é receita de um subconjunto.

9. **Rota 2 é a mais frágil das três.** Recomendar "aprovar mais" quando 83% expira pode ser
   ler sintoma como causa. A causa pode ser que os pedidos não valem a pena — 457 pedidos de
   um único agente (Isabela) sugere ruído, não represamento de valor.

10. **Fiz este mapa com metade da empresa fora de alcance.** Produção, estoque, PCP, fiscal e
    caixa vivem em `skillprint-erp`. Um MAPA V0 que se declara "o estado global da empresa"
    sem essa metade **está estruturalmente incompleto** — e deve dizer isso na própria saída,
    não em rodapé.

---

## 10. PRÓXIMO PASSO MÍNIMO — exatamente UMA implementação

**Criar `fn_mapa_cerebro_v0()` como função SQL `STABLE`, sem nenhuma tabela, view, coluna,
cron ou edge nova.**

Escopo exato:
- Lê apenas o que já existe: `meta_comercial`, `pixel_events`, `leads_marketing`,
  `meta_ads_insights`, `lead_score_comercial`, `vw_margem_por_produto`, `agentes`,
  `agente_decisoes_log`, `mensagem_envio`, `agente_aprovacoes`, `frentes`, `frentes_espera`,
  `cerebro_futuro`.
- Devolve um `jsonb` com os 6 blocos.
- Toda métrica carrega `fonte`, `atualizado_em` e `confianca`.
- O bloco `relacoes` publica as 5 arestas **com o rótulo de prova** (FORTE/PARCIAL/FRACA).
- `incertezas` já nasce com U1–U10 desta auditoria.
- `qualidade_mapa` publica as contradições conhecidas (pixel × CalcMe; `meta_comercial` ×
  `metas_crescimento`; `efeito_externo` subnotificado) e declara explicitamente
  **`escopo: "sem ERP — produção, estoque e caixa fora do alcance"`**.

Por que exatamente isto:
- É reversível: `DROP FUNCTION` e nada muda.
- `STABLE` garante, no nível do Postgres, que não escreve.
- Não altera GPS, agentes, Worker, frentes ou cron.
- Torna o mapa **consultável e refutável** — é o único jeito de descobrir se ele erra.

**Não implementado nesta rodada, conforme instruído.**

O que **não** fazer agora: não criar tabela de mapa, não criar frente de mapa, não mexer em
`fn_gps_proxima`, não ligar agente em `dry_run`, não "consertar" `org_metas`.
Primeiro o Cérebro precisa conseguir se olhar e estar errado em público.

---

## Anexo — garantia de leitura
Todas as operações desta auditoria foram `SELECT` sobre catálogo/tabelas, mais uma chamada a
`fn_gps_panorama()`, declarada `STABLE` no catálogo (`pg_proc.provolatile = 's'`), o que o
Postgres impede de escrever. Nenhum `INSERT`/`UPDATE`/`DELETE`/DDL, nenhum deploy de edge,
nenhuma migration, nenhuma alteração de configuração, nenhuma frente criada.
