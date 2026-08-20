# Rodada `cerebro-autonomia-fechamento` — 2026-08-20

Projeto Supabase: `ldrdtaibazplvrbwyrvx`.
Objetivo: aumentar a taxa de frentes fechadas autonomamente pelo Cérebro, atacando
autoridade, esperas, ambiguidade, superfície de segurança e custo observável.

GPS V1 (`fn_gps_proxima`) **não foi alterado**. `fn_gps_autoteste()` retorna `ok=true`
com `decisao_atomica_pass`, `rota_auto_revoga_pass` e `executor_precedencia_persistida` verdadeiros.

---

## P0 — Baseline (antes) vs Depois

| Métrica | Antes | Depois |
|---|---|---|
| Trilhas AMBIGUA | 2 (`conversao_julia`, `funil`) | 2 (as mesmas) |
| Ticks 48h com alguma trilha descartada por AMBIGUA | 115 / 192 (59,9%) | inalterado nesta rodada |
| Decisões humanas abertas | 16 | 15 |
| Esperas `evento_organico` com predicado | 3 de 20 (1 media a coisa errada) | 7 de 21, todas revisadas |
| Predicado que podia auto-encerrar medindo criação | 1 (chave `ricardo_recomendacoes`) | 0 — bloqueado por trigger |
| Claims residuais | 0 | 0 |
| Leases residuais | 0 | 0 |
| Tabelas de `public` com escrita `anon` | 255 | 2 (`pageview`, `pixel_events`) |
| Funções SECURITY DEFINER executáveis por `anon` | 84 | 0 |
| Frentes com política de autoridade | 1 de 142 abertas | 4 |
| Cobertura de custo por agente | 3 `tracked` / 25, sem relatório publicado | publicado: 2 CUSTO_REAL, 10 CUSTO_ZERO_PROVADO, 13 CUSTO_DESCONHECIDO |
| Cobertura de custo por frente | 0% (ausente) | 0% medido, mas **publicado como `NAO_MENSURAVEL`**, nunca US$0 |

---

## P1 — Segurança

**Prova reunida antes de revogar (nenhuma revogação às cegas):**

1. `anon` e `authenticated` são `NOLOGIN` — só alcançam o banco via PostgREST, e todo esse
   tráfego aparece em `edge_logs`.
2. Quatro janelas independentes de 24h (15/08, 17/08, 18/08, 19–20/08): o **único** tráfego
   `/rest/v1` sem a chave `service_role` é `POST` em `pageview` e `pixel_events` (pixel do site).
3. `julia_config` recebeu 876 GET e `waba_disparos_lista` 2 GET — todos `service_role`, zero escrita.
4. `auth.users`: 5 usuários, nenhum login desde 2026-04-04.
5. Default privileges do papel `postgres` em `public` já **não** concediam nada a anon/authenticated —
   tabela nova não nasce aberta.

**Executado:**
- `REVOKE INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES` de `anon` e `authenticated` em todas as
  tabelas de `public`, exceto `pageview` e `pixel_events`.
- `REVOKE EXECUTE ... FROM PUBLIC` nas 84 funções `SECURITY DEFINER` que `anon` alcançava.
  *(Revogar de `anon` era no-op: o privilégio era herdado de `PUBLIC`.)*
  `service_role` e `postgres` foram garantidos explicitamente antes da revogação.
- `SELECT` preservado. `service_role` e `postgres` intocados.

**Rollback:** `public.backup_grants_seguranca_20260820` guarda o `GRANT` exato de cada um dos
2.766 privilégios revogados, em `rollback_sql`.

**Pós-prova (20 min após a mudança):** 70 execuções de cron, 0 falhas, 0 linhas em `error_log`,
`fact_conversations` seguindo ingerindo, REST só com 200/201/204, e 8 claims de outros Workers
capturados e liberados normalmente.

---

## P2 — Ambiguidade residual do GPS

**Causa concreta:** `gps_frente_precedencia` foi populada uma única vez, em 19/08/2026, pela
decisão do dono (`fonte = decisao_dono_fechamento_gps_v1_2026-08-19`), cobrindo apenas as frentes
que estavam acionáveis naquele instante. É um **snapshot**, não uma ordem total da trilha.
Quando uma frente volta de espera, muda de prioridade ou entra nova no patamar de menor
prioridade, o conjunto empatado passa a incluir frentes que a decisão nunca cobriu →
cobertura parcial → fail-closed → AMBIGUA.

**Não existe fonte determinística para herdar posição:**
- `ordem_execucao` tem empates (4 frentes de `conversao_julia` com o mesmo valor 9) e 70 nulos.
- `depende_de` não relaciona as empatadas em nenhum dos dois casos vivos.
- slug / uuid / data / alfabético são proibidos.

Logo `funil` e `conversao_julia` **permanecem AMBIGUA, corretamente**.

**Entregue — detecção antes do travamento:**
- `vw_gps_precedencia_cobertura` — por frente elegível: `COBERTA`,
  `LACUNA_BLOQUEIA_AGORA`, `LACUNA_BLOQUEIA_AO_VOLTAR`, `LACUNA_LATENTE`, `SEM_EMPATE`.
- `vw_gps_precedencia_lacunas` — uma linha por trilha, com `frentes_sem_fundamento`.

**Achado:** hoje só 2 trilhas estão travadas, mas **19 frentes sem fundamento canônico** vão
travar quando as esperas fecharem — `conversao_joao` sozinha tem 6, com cobertura zero.

Consistência verificada: `situacao = AMBIGUA` ⟺ `lacunas_bloqueando_agora > 0` em todas as 16 trilhas.

---

## P3 — Autoridade

A máquina de autoridade (`fn_gps_autoridade_avaliar` + `gps_autoridade_frente`) já existia e é
fail-closed correta. O gargalo era **cobertura**: 1 linha de política para 142 frentes abertas —
toda frente caía em `sem_politica_de_autoridade`.

**Inventário das 16 decisões (`gps_decisao_classificacao`): 15 classe A, 1 classe C, 0 classe B.**

Classe A com o gate exato que falha registrado. Os três casos de "patch pronto, falta SIM"
(`julia-pagamento-grounded`, `julia-briefing-multiartes`, `contrato-orcamento-contexto-aprendizado`)
têm rollback ancorado e teste determinístico, mas **são deploy de edge que fala com cliente real**:
uma mensagem entregue não volta. Ficam classe A por regra explícita da missão.

**Política de classe B aplicada** (interna, reversível, sem cliente/dinheiro/segredo/deploy):
`custo-observavel-por-agente-e-por-frente`, `painel-decisao-operacao`, `lid-novos-sem-cadastro-na-ponte`.

Testado ponta a ponta:

| Caso | Resultado |
|---|---|
| Frente B, decisão interna, `execucao_requerida=[nenhuma]` | `decisao_autorizada=true`, `execucao_autorizada=true` |
| Frente B tentando `deploy` | bloqueado: `deploy_nao_permitido` + `allow_edge_function_patch_false` |
| Frente B com `impacto_financeiro_brl=50` | `decisao_nao_autorizada` |
| Frente A (`julia-briefing-multiartes`) | `sem_politica_de_autoridade` — fail-closed preservado |

**Pipeline de gates:** `gps_classe_b_execucao` registra `EXECUTA → TESTA → CANARIO → POS_PROVA → ROLLBACK`
com CHECK que **rejeita gravar `FALHOU` sem `rollback_sql`**.

---

## P4 — Esperas que acordam sozinhas

**Guarda estrutural contra o erro do `ricardo_recomendacoes`:** `espera_observavel_whitelist` ganhou
`mede` / `seguro_para_auto_encerramento` / `motivo_seguranca`, e nasceu
`espera_verificador_catalogo`. O trigger `trg_espera_predicado_guarda` recusa
`permite_encerramento_automatico=true` sobre fonte que não é declarada segura, e é fail-closed
para verificador não catalogado.

Teste de falso positivo: reinserir exatamente o predicado que causou o falso encerramento de 19/08
é **rejeitado**.

**Verificadores novos, que medem o evento real:**
- `ricardo_recomendacao_exercitada` — `aprovacao_id` E `executada_em` E `avaliacao` E `score`.
  Criação não prova execução.
- `memoria_elo_completo` — contexto entregue **E** (primeira resposta OU compra).
  Registro não prova aprendizado.
- `operacao_produto_e_frete_no_mesmo_lead` — mesmo `lead_id` com `kind=produto` e `kind=frete`.

**Dois achados vivos:** duas esperas dormiam sobre condição que **já aconteceu**:
- `guardrail-financeiro-joao` dizia "ZERO leads elegíveis" — há **4** desde 2026-08-18 04:28.
- `renata-loop-memoria-resultado` apontava para `agente_decisoes_log` (fonte errada);
  o elo real tem **523** ocorrências desde 2026-08-17.

Nenhum predicado recebeu `auto=true`: cada um documenta o que **não** prova.
`decisao_humana` continua sem predicado por construção de `fn_espera_avaliar`.

**Classe 2 (observável, falta fonte) — bloqueio registrado:** `joao-silencio-vazamento-quente`
exige "36 inbounds elegíveis consecutivos sem silêncio ilegítimo". Não existe fonte canônica de
"inbound elegível" nem de "silêncio ilegítimo"; reconstruir a definição seria inventar.

---

## P5 — Custo observável

`fn_ai_usage_log` já aceita `frente_slug`, `work_unit_key`, `chat_id`, `worker_instance_id`.
O contrato está completo; **nenhum emissor preenche**: 0 de 3.049 linhas têm qualquer chave de
unidade de trabalho. `anthropic_token_usage` também não carrega frente. Portanto atribuir custo a
frente por janela de claim seria invenção — e não foi feito.

**Entregue:**
- `vw_ai_custo_cobertura_publicada` — critério (10): CUSTO_REAL / CUSTO_ZERO_PROVADO / CUSTO_DESCONHECIDO.
- `vw_frente_tempo_worker` — unidade de rateio declarada e derivável: tempo de posse por claim
  (190,3 h em 180 frentes). **Mede tempo, não custo** — converter exigiria preço/hora que não existe medido.
- `vw_frente_custo_observavel` — publica `NAO_MENSURAVEL_SEM_CHAVE_DE_UNIDADE` com o motivo, nunca US$0.
- `ai_usage_ledger`: colunas de token deixaram de ser `NOT NULL` (obrigavam gravar 0 onde a verdade
  é UNKNOWN, violando o critério 9). Novo CHECK: token nulo **só** com `measurement_status='unknown'`.
- Custo desta rodada registrado como `unknown` — o Cérebro deixou de sumir do próprio custo.

Medido em 30 dias: **US$ 19,10** em 1.468 chamadas, 2 consumidores com custo real.

---

## Objetos criados/alterados

Tabelas: `backup_grants_seguranca_20260820`, `gps_decisao_classificacao`, `gps_classe_b_execucao`,
`espera_verificador_catalogo`.
Views: `vw_gps_precedencia_cobertura`, `vw_gps_precedencia_lacunas`,
`vw_ai_custo_cobertura_publicada`, `vw_frente_tempo_worker`, `vw_frente_custo_observavel`.
Funções: `fn_espera_avaliar_um` (3 ramos novos, ramos existentes preservados),
`fn_espera_predicado_guarda` (nova).
Alterações: `espera_observavel_whitelist` (+3 colunas), `frentes_espera_predicado` (CHECK ampliado
+ trigger), `ai_usage_ledger` (NOT NULL relaxado + CHECK de coerência).

Não tocado: `fn_gps_proxima`, `vw_frentes_elegiveis`, `executor_config`, `go_ai_dev_config`,
qualquer edge function, qualquer objeto do João.
