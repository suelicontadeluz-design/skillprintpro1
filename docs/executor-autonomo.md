# Executor Produtivo Autônomo — Cérebro

Projeto Supabase: `ldrdtaibazplvrbwyrvx`.

## O problema que isto resolve

O executor determinístico já existia e funcionava. O cron `executor-tick-deterministico`
(pg_cron jobid 143, `*/15 * * * *` → `fn_executor_tick()`) faz três coisas sem gastar
um único token de LLM:

1. encerra esperas observáveis cuja condição foi satisfeita (`fn_espera_encerrar`,
   só quando `permite_encerramento_automatico = true`);
2. observa claims sem heartbeat (apenas observa — nunca libera à força);
3. escolhe a próxima frente via `fn_executor_proxima_tarefa()`.

O próprio corpo da função declarava a lacuna:

> "Se ha frente escolhida, ela so sera trabalhada quando uma sessao Claude acordar
> — ver lacuna de wake-up."

Faltava o **trabalhador**: alguém que acordasse sozinho, pegasse a frente escolhida
e a executasse. E faltava **prova, no banco**, de que essa rodada aconteceu de ponta
a ponta sem humano no circuito.

## As duas peças adicionadas

### 1. Ledger de cadeia (migration `executor_rodada_cadeia_v1`)

- `public.executor_rodada_etapa` — append-only (trigger recusa UPDATE e DELETE),
  RLS ligada, zero grant para `anon`/`authenticated`. Uma linha por elo da rodada.
- `public.fn_executor_rodada_etapa(rodada_id, chat_id, origem, etapa, detalhe)` —
  registra um elo.
- `public.fn_executor_rodada_cadeia(rodada_id)` — devolve o veredito `PASS`/`FAIL`.
- `public.vw_executor_rodada` — panorama de todas as rodadas.

**O ponto central:** a auto-declaração da sessão não prova nada. Cinco dos quinze
elos só passam por **prova independente**, escrita por outra função canônica em
outra tabela:

| Elo | Prova independente exigida |
|-----|----------------------------|
| 6 — claim | linha em `frentes_claims` escrita por `fn_frente_claim` |
| 7 — heartbeat | evento em `frentes_historico` escrito por `fn_frente_heartbeat` |
| 12 — evidência | linha em `microloops_23_ponto_evento` ou `frentes.validada_por` |
| 13 — desfecho | espera em `frentes_espera` ou post-flight em `frentes_historico` |
| 14 — release | `frentes_claims.liberada_em` preenchido **e** zero claim ativo |

Uma rodada que declarar `release`, `evidencia_ledger` e `fechamento` sem ter feito
os atos correspondentes recebe `FAIL` nesses três elos. Isso foi testado
explicitamente (ver abaixo).

### 2. Wake-up recorrente

Routine `Cérebro — Executor Produtivo Autônomo (1x/hora)`
(`trig_013hD8ae3DsH5nUCSqaHXgTF`, cron `53 * * * *`, 1×/hora — a maior frequência
suportada pelo scheduler). Ela dispara na sessão persistente
`session_011wFDWmt4L2BUnir9aLcZkW`, que é a que retém o connector do Supabase.

O prompt é autocontido e manda a sessão **descobrir** o protocolo no banco
(`fn_contexto_codex_frentes`), não presumi-lo.

## O ciclo de uma rodada

```
wake-up agendado
  → Supabase
  → protocolo            fn_contexto_codex_frentes(1)
  → GPS                  fn_gps_panorama + fn_executor_proxima_tarefa
  → seleção legítima     só UNICA ou ROTA_ESCOLHIDA; AMBIGUA nunca é desempatada
  → claim                fn_frente_claim (guarda o claim_token)
  → heartbeat            fn_frente_heartbeat
  → reconciliar runtime  anotação antiga não é prova
  → trabalho             só o gap restante, nunca reiniciar um agente
  → teste                transação revertida, resíduo zero
  → prova independente   observável + contagem medida
  → evidência/ledger     microloops_23_ponto_evento (append-only)
  → fechamento OU espera estruturada (com predicado determinístico quando observável)
  → release              fn_frente_finalizar_chat, claims ativos = 0
  → GPS de novo          e, havendo trabalho/tempo/orçamento, outra frente
```

## Limites que a rodada não pode tocar

Invioláveis, e nenhum deles foi alterado por esta ativação:

- `allow_schema_patch`, `allow_edge_function_patch`, `allow_production_write`
- orçamento e kill switch (`executor_config.habilitado`)
- scheduler e crons existentes
- autoridade de deploy e política de produção
- regras globais do GPS e rotas em `gps_rota_decisao`

Ausência de permissão nunca é autorização implícita. Autoridade faltando é
bloqueio, e bloqueio vira espera do tipo `decisao_humana` — que nunca recebe
predicado nem vira espera temporal falsa.

## Esperas e watchers

Quando o trabalho chega legitimamente a uma condição externa, a rodada:

1. registra espera estruturada em `frentes_espera`;
2. quando a condição é observável por máquina, cria o predicado em
   `frentes_espera_predicado` — família `tempo` com `instante_alvo`, ou
   verificador `linhas_apos` com chave da whitelist `espera_observavel_whitelist`;
3. **libera o claim** — nunca segura a trilha esperando.

O watcher determinístico (`fn_executor_tick`) encerra a espera sozinho quando a
condição é satisfeita, e a frente volta a ser selecionável no GPS na rodada
seguinte. `decisao_humana` não é observável por máquina e permanece aberta até
Alessandro decidir — é exatamente esse o único caminho de volta dele ao circuito.

## Testes executados na ativação

Ambos em transação revertida, com resíduo conferido em zero
(`executor_rodada_etapa` = 0 linhas, nenhum claim, espera ou histórico de teste
sobrevivente; `frentes.validada_por` de `kpis-decisivos-midia` inalterado):

- **Caso positivo** — rodada completa com claim, heartbeat, espera e post-flight
  reais: `veredito=PASS`, `elos_ok=15/15`.
- **Caso negativo** — mesma rodada declarando `evidencia_ledger`, `fechamento` e
  `release` **sem nenhum ato real**: `veredito=FAIL`, `elos_ok=12/15`,
  faltando `["12_evidencia_ledger", "13_fechamento_ou_espera", "14_release"]`.

O verificador recusa auto-declaração. Era esse o requisito.

## Primeira execução produtiva — comprovada

Rodada `46024b6f-bcb8-40a4-9b64-6a27878b6eb8`, chat `cowork-auto-20260817-1300-2e8518`,
`origem = sessao_agendada`, 493 segundos (13:00:08Z → 13:08:21Z).
Disparada por Routine, sem humano no circuito. **Veredito: `PASS`, 15/15 elos.**

- **Seleção**: o GPS escolheu `joao-contexto-comercial-canonico` (trilha
  `conversao_joao`, autoridade UNICA, prioridade 1, `esperas_abertas: 0`) via
  `fn_executor_proxima_tarefa()->escolhida`. Nenhuma frente foi indicada por
  humano nem pelo texto do disparo.
- **Claim real**: `e50b73e3-c6c1-4554-9944-34a1495c10be`, capturado 13:01:54,
  liberado 13:07:54, desfecho `postflight_em_andamento`.
- **Reconciliação**: achou divergência real — a evidência afirmava
  `joao_tts_ativo = true` e intocado; medido `false`, alterado em 16/08 23:30 por
  outro chat, posterior ao checkpoint. Anotação antiga não era prova.
- **Trabalho**: read-only, 8 itens medidos sobre dado orgânico. Zero migration,
  zero deploy, zero cron, zero flag, zero dado operacional.
- **Prova independente**: 16 execuções do cron 132 desde 16/08 21:42, 0 falhas,
  222 deals, 0 HTTP 429, 13 lotes fora da janela antiga e 3 em domingo à noite —
  contra 43 execuções anteriores com 0 fora da janela e 0 em fim de semana. Os
  lotes de 11:42 e 12:42 bateram o teto de 50, sinal de saturação; a rodada
  **não** alterou frequência nem limite, porque o `proximo_passo` proíbe.
  Registrou também uma ressalva honesta: a coorte do baseline de frescor não é
  reproduzível pelo texto registrado, logo 15,6% vs 7,0% não é comparação
  like-for-like.
- **Desfecho**: espera `288cd90c-2a83-4e4a-b811-face61b3c31c`, tipo
  `decisao_humana` — o contrato de ativação do Gate 2 não está especificado e
  inventar era proibido. Sem predicado, como manda a regra.
- **Release**: claim liberado, zero claim ativo.
- **GPS novamente**: indicou `gps-microloops-23-membresia-fechamento`
  (governança, UNICA, prioridade 1) e **parou**, porque
  `executor_config.max_frentes_por_rodada = 1` já havia sido consumido — o limite
  do banco prevaleceu sobre os ~50 minutos sugeridos no texto do disparo. É a
  precedência correta: a autoridade é o banco.

Preservação conferida depois da rodada: ledger `microloops_23_ponto_evento` em
192 eventos e 76 pontos COMPROVADOS — ambos **inalterados**; kill switch ligado;
91 crons ativos; 18 trilhas; 3 rotas vigentes; zero claims ativos.

## Como auditar

```sql
-- panorama de todas as rodadas
select * from public.vw_executor_rodada order by iniciada_em desc;

-- veredito detalhado de uma rodada
select jsonb_pretty(public.fn_executor_rodada_cadeia('<rodada_id>'));

-- o que o GPS indica agora
select jsonb_pretty(public.fn_executor_proxima_tarefa());

-- ninguém pode estar segurando trilha
select * from public.frentes_claims where status='ativo' and expira_em > now();
```

## Como desligar

O kill switch continua sendo do banco e não do scheduler:

```sql
update public.executor_config set habilitado = false;
```

Com ele desligado, `fn_executor_tick` para e a rodada acordada registra
`parada_sem_trabalho` com motivo `KILL_SWITCH_DESLIGADO` e encerra sem tocar em nada.
Para parar também o wake-up, desative a Routine `trig_013hD8ae3DsH5nUCSqaHXgTF`.
