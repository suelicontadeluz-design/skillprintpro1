# Executor autônomo V1 — tentativa de ativação

**17/08/2026 · chat `claude-gps-cobertura-20260817`**

**Veredito: `V1_BLOQUEADA`.**
Causa objetiva: **uma sessão criada por Routine não recebe conectores MCP, e o parâmetro `connectors` está desabilitado para esta organização.** Sem MCP Supabase a sessão não alcança o banco, e sem banco não existe GPS, claim, evidência nem release.

A camada determinística **foi ativada e está operando.** O que falta é exclusivamente o despertar com acesso.

---

## 1. Pre-flight (tudo verde)

| Item | Estado |
|---|---|
| Protocolo canônico (10 regras) | lido via `fn_contexto_codex_frentes()` |
| Claims conflitantes | **0** |
| Cron 143 | `active=false` (antes) |
| `executor_config.habilitado` | `false` (antes) |
| Limites V1 | `max_frentes=1`, `max_segundos=900`, `limite_fraco=2`, quarentena 24 h, heartbeat 30 min — **já corretos, não alterados** |
| `allow_*` / orçamento | `false/false/false`, `mode=observe`, 20 BRL |
| Canário | `diego-timeout-fn-contexto-midia-ouro` segue estacionada em `SEM_PROGRESSO / sem_fato_novo` — comportamento intacto |
| Regressão desde a última rodada | nenhuma |

`fn_contexto_codex_frentes()` mede **657.528 bytes**. É exatamente por isso que o primeiro ato da sessão não pode ser essa chamada.

## 2. Camada SQL — ativada após verificação

Antes de ligar, li `fn_executor_tick()` inteira e confirmei:

- **não faz HTTP, não usa `pg_net`, não tenta acordar Claude**;
- kill switch desligado retorna imediatamente;
- o watchdog de heartbeat **apenas conta**, não libera claim à força;
- a única mutação possível é encerrar espera que tenha predicado **e** `permite_encerramento_automatico`.

Medi esse último ponto: **zero esperas auto-encerráveis hoje** (4 predicados, todos com a trava ligada — Bruno e Vera inclusive). Ou seja, o tick não pode encerrar espera nenhuma agora.

Com isso, ativei:

```
cron.alter_job(143, active := true)          -- */15 * * * *
executor_config.habilitado = true
```

Tick manual de verificação: `ok=true`, `esperas_encerradas=0`, `claims_sem_heartbeat=0`.

**Isto funciona 24/7, sem token:** detecção de trabalho, varredura do GPS, avaliação de esperas, watchdog, log de ticks.

## 3. Routine — criada, testada, removida

Criei a Routine com `create_new_session_on_fire = true`, 1×/hora, prompt curto e estável, ambiente `env_01HXFVw4PKXiN7dE9jouHnYf`.

A própria criação devolveu o aviso:

> *this trigger stores no MCP connectors, so the sessions it fires will run without connector (`mcp__<server>__*`) tools.*

### O disparo de prova

Disparei uma vez (autorizado pelo item 12). Resultado:

| Medida | Valor |
|---|---|
| Sessão criada | `session_01GdZhZikWCBcdJ2AvrLECea`, origem `force_run_trigger` |
| Estado | RUNNING → IDLE em **~24 s** |
| Consumo | 269.018 cache read · 46.476 cache write · 931 output |
| Claims novos | **0** |
| Linhas em `frentes_historico` | **0** |
| Trabalho disponível no momento | **sim** — `erp-seguranca-autorizacao-go-live` (P1) |

**O despertar funciona. A execução não.** A sessão acordou, gastou contexto e não tocou no banco, com trabalho disponível na fila.

### Por que — três confirmações independentes

1. O aviso na criação da Routine, citado acima.
2. `ListConnectors` mostra **Supabase `connected: true`, `enabledInChat: true`** — esta sessão tem o conector, mas o grant **não é herdado** pela sessão nova.
3. Recriar a Routine passando `connectors: ["Supabase"]` foi **recusado pelo servidor**: *"the connectors parameter is not available for this organization."*

E não há caminho alternativo até o banco: nenhuma variável `SUPABASE_*`/`POSTGRES_*`/`DATABASE_*` no ambiente, e `curl https://ldrdtaibazplvrbwyrvx.supabase.co` retorna **HTTP 000** — o proxy nega o domínio, o mesmo achado da rodada 2. `psql` existe no container, mas sem string de conexão e sem credencial.

**Removi a Routine** (`delete_trigger`). Mantê-la armada custaria ~315 mil tokens de contexto por hora para não fazer nada.

## 4. Como destravar

O erro do servidor indica o caminho: *"ask the user to create it from the claude.ai routines UI"*.

**O que só o Alessandro pode fazer** — criar a Routine pela UI de Routines do claude.ai, onde o conector Supabase pode ser anexado. O prompt operacional está pronto abaixo; é copiar, colar, marcar Supabase e agendar 1×/hora.

É provisionamento, feito uma vez — não é entrar no loop operacional.

Alternativa que **não** recomendo: Routine ligada a sessão persistente. Funciona hoje (as 6 Routines `send_later` desta conta fizeram trabalho real no banco exatamente assim, porque herdam o conector da sessão-mãe), mas exige manter uma sessão Claude permanentemente aberta — o oposto do que a V1 pede.

### Prompt operacional da Routine

```
EXECUTOR AUTONOMO V1 — uma frente por disparo, sessao descartavel.

Projeto Supabase: ldrdtaibazplvrbwyrvx (use o MCP Supabase).

PRIMEIRO ATO, BARATO. Rode apenas:
  select public.fn_executor_proxima_tarefa();
NAO carregue fn_contexto_codex_frentes() so para descobrir se ha trabalho — ~650 KB.

Se 'escolhida' vier null: ENCERRE A SESSAO IMEDIATAMENTE. Nao investigue as
trilhas descartadas, nao proponha melhorias, nao escreva no banco. Responda uma
linha: SEM_TRABALHO + motivo_parada.

Se 'escolhida' vier preenchida, execute NA ORDEM:
1. fn_executor_pode_prosseguir('<frente>'). Se pode=false, ENCERRE — quarentena ou
   sem fato novo. Nao insista nela e nao pule para outra frente nesta sessao.
2. fn_frente_claim('<frente>','claude-exec-v1-<AAAAMMDDHHMM>','Executor autonomo V1',180).
   Guarde o claim_token: nao e mostrado de novo.
3. So agora leia o contexto da frente: descricao, criterio_aceite, proximo_passo,
   onde_paramos, evidencia, depende_de.
4. Trabalhe no maximo 15 minutos. Renove com fn_frente_heartbeat em trabalho longo.
5. Prove o resultado por evidencia independente do seu proprio texto: leia o estado
   real do banco. Anotacao antiga nao e prova.
6. Finalize com fn_frente_finalizar_chat. 'fechada' SOMENTE com criterio_aceite
   comprovado; senao 'em_andamento'. Se o proximo trabalho verdadeiro for ESPERAR,
   registre a espera em frentes_espera com o tipo correto ANTES de liberar.
7. Libere o claim. Consulte fn_executor_proxima_tarefa() uma unica vez so para
   registrar continuidade. NAO capture a proxima frente.
8. ENCERRE a sessao.

LIMITES INEGOCIAVEIS
- Uma frente por disparo. Nunca duas.
- Nao desempate AMBIGUA. Use gps_rota_decisao apenas se ja existir rota registrada —
  a chave rota_registrada de fn_gps_proxima mostra qual e.
- Nao altere allow_schema_patch, allow_edge_function_patch, allow_production_write
  nem orcamento em go_ai_dev_config.
- Se a frente exigir acao bloqueada pela politica: pare, registre RISCO na evidencia,
  abra espera decisao_humana, libere o claim e encerre. NAO peca aprovacao
  operacional ao Alessandro.
- Nunca leia frentes_claims_segredo. Nunca force liberacao de claim alheio.
- Nao crie Routine nova, nao crie cron novo, nao crie sessao filha.
- Nao deixe claim preso: se encerrar por qualquer motivo, libere antes.

Ao final, uma linha: frente, desfecho, estado final, claim liberado sim/nao.
```

## 5. Estado final

| Item | Valor |
|---|---|
| Routine do executor | **nenhuma armada** (criada, disparada, removida) |
| Cron 143 `executor-tick-deterministico` | **`active=true`**, `*/15 * * * *` |
| `executor_config.habilitado` | **`true`** |
| Ticks registrados | 4 |
| Claims ativos | **0** — nenhum órfão |
| Claims desde o disparo | 0 |
| `allow_schema_patch` / `allow_edge_function_patch` / `allow_production_write` | `false` / `false` / `false` — **inalterados** |
| `mode` / orçamento | `observe` / 20 BRL — **inalterados** |
| Executor paralelo | nenhum criado |
| Trabalho selecionável agora | `erp-seguranca-autorizacao-go-live` (`seguranca`, P1) |

Desligamento continua em duas camadas independentes: `cron.alter_job(143, active := false)` e `executor_config.habilitado = false`.

## 6. Riscos remanescentes

1. **O despertar depende de uma ação de provisionamento humana.** Enquanto a Routine não for criada pela UI com o conector, o tick detecta trabalho que ninguém executa.
2. **Custo do despertar ocioso.** Cada disparo custou ~315 mil tokens de contexto mesmo sem fazer nada. Com 24 disparos/dia e a fila frequentemente vazia, vale medir antes de manter 1×/hora — o tick SQL já sabe se há trabalho, mas não consegue evitar o disparo.
3. **`rate_limit_info` da sessão disparada:** janela `five_hour`, `status=allowed`. Não medi comportamento sob fila cheia.
4. **A V1 nunca executou o fluxo real ponta a ponta.** O ciclo GPS→claim→trabalho→prova→release foi provado manualmente no canário e na rodada de expansão, não por sessão acordada sozinha.
