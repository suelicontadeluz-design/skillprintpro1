# joao-replay-hermetico — contrato a1_replay_hermetico_v1

Candidato que adiciona ao Joao real (agente-noturno) o contrato de execucao
hermetica exigido pelo A1_REPLAY_HERMETICO, sem alterar uma linha do caminho live.

## Identidade

- Baseline: `patches/joao-slot-proveniencia-escrita/candidato/index.ts` no commit
  `58f64326271f3a38e5b92ee322ff5dfcd0866816` (exatamente o arquivo que a Edge ACTIVE
  `agente-noturno` v183 importa via wrapper de uma linha).
  - sha256 do baseline: `1d8385891f12daaa609d3cf4a8bb5a9a24aea91b47dd63251a0a27dcbe49967b`
- Candidato: `candidato/index.ts` (este diretorio).
- Diff completo: `candidato/v4.37.1__replay-hermetico.1.diff`
  (+272 linhas inseridas, 1 linha trocada: `const sb = createClient(...)` →
  `const sbLive = createClient(...)`; todas as demais linhas do baseline sao
  byte-identicas — provado por `provas/verificar.sh`).

## Contrato

Modo explicito por requisicao, decidido uma unica vez no gate de entrada:

- `mode: "live"` (ou ausente) → fluxo byte-identico ao v4.37.1. O proxy `sb`
  devolve os metodos do cliente service-role original e o `fetch` global nunca
  e trocado enquanto o isolate so serviu live.
- `mode: "shadow"` → turno completo sobre dados correntes, zero efeito real.
- `mode: "replay"` → turno historico: exige `replay_case_id` (replay_caso.id);
  `as_of` vem do proprio caso via `fn_replay_snapshot` (ou do body).

Garantias nos modos hermeticos:

1. **Papel replay_runner obrigatorio** — o cliente hermetico e criado com
   `REPLAY_RUNNER_JWT` (JWT com claim `role=replay_runner`, NOLOGIN, sem nenhum
   INSERT/UPDATE/DELETE/TRUNCATE e com EXECUTE apenas em `fn_replay_snapshot*`).
   Sem a credencial o modo hermetico responde `503 replay_sem_credencial` e nada roda.
2. **Zero escrita real** — `insert/update/upsert/delete` e rpcs mutadoras
   (`fn_emitir_operacao_financeira`, `fn_consumir_operacao_financeira`,
   `fn_finalizar_operacao_financeira`, `fn_registrar_decisao_agente`,
   `fn_get_or_create_lead`, `fn_joao_adquirir_lock`, `fn_marcar_*`, etc.) sao
   interceptadas antes do transporte, registradas como acao hipotetica e
   respondidas com resultado sintetico. Se algo escapasse, o papel replay_runner
   morre em 42501 no banco (segunda camada, negacao estrutural).
3. **Zero transporte externo** — no primeiro pedido nao-live o `fetch` global vira
   gate hermetico e o isolate fica LACRADO (pedido live posterior recebe
   `409 isolate_hermetico`; producao nunca compartilha isolate com replay).
   Z-API, BotConversa, Mercado Pago (`mp-pix-criar`), TTS, `agente-pipeline`
   (task real), `joao-lost-canonico` (CRM), CalcMe, frete, transcricao OpenAI e
   download de midia sao bloqueados com resposta sintetica `hipotetico: true`.
   Passagens permitidas (leitura/computo sem efeito): inferencia Anthropic,
   GET no REST do ERP e rpcs de orcamento `fn_listar_modelos_disponiveis` /
   `fn_orcar_camisetas_agente`.
4. **Tools simuladas** — o turno roda o caminho REAL de decisao (nao o `_dry_run`
   legado); cada envio, Pix, task, LOST e escrita vira uma entrada em
   `acoes_hipoteticas` com o corpo do que TERIA acontecido.
5. **Telemetria hipotetica** — a resposta devolve `contrato`, `modo`, `role`,
   `replay_case_id`, `as_of`, `acoes_hipoteticas[]` e contadores
   (`leituras`, `escritas_interceptadas`, `http_bloqueado`), para o runner gravar
   em `replay_execucao.candidato_acoes_hipoteticas`.
6. **as_of** — leituras de tabelas-evento ganham `.lte` automatico
   (`inbound_fora_horario.created_at`, `fact_conversations.timestamp`,
   `pixel_events.event_time`, `mp_pix_cobrancas/orcamentos/operacoes_financeiras/`
   `joao_envios.created_at`) e o estado do agente em replay vem de
   `replay_caso.slots_antes` via `fn_replay_snapshot` — unica fonte confiavel
   (laudo r3: `agente_noturno_estado` nao e reconstituivel).

## Limitacoes documentadas (sem efeito real em nenhuma delas)

- Relogio corrente: saudacao/periodo usam a hora do turno de replay, nao a do caso.
- Tabelas fora do mapa AS_OF: leituras seguem apenas os filtros originais do fluxo.
- Rpcs de leitura (`fn_agente_pausado`, `fn_contexto_*`, ...) hoje sao negadas em
  42501 ao papel replay_runner; o codigo degrada como o live degrada em falha de rpc
  (contexto vazio, pausa=false). Conceder EXECUTE de leitura ao papel e decisao de
  governanca separada, fora deste patch.
- Concorrencia hermetica: um turno por vez (`429 replay_ocupado`).

## Como o Replay executa este candidato (sem deploy de producao)

O wrapper ACTIVE de producao continua pinado em `58f64326...` e NAO muda.
Para executar este SHA e preciso um slug de Edge separado (canario de replay,
ex.: `agente-noturno-replay`) com wrapper de uma linha importando
`raw.githubusercontent.com/.../<COMMIT_DESTE_CANDIDATO>/patches/joao-replay-hermetico/candidato/index.ts`
e o secret `REPLAY_RUNNER_JWT` provisionado. Este repo nao faz esse deploy;
a rodada para em ARTEFATO_PRONTO_PARA_CANARIO_REPLAY.

Chamada de replay (runner):

```json
{ "mode": "replay", "replay_case_id": "<replay_caso.id>", "as_of": "<opcional>" }
```

## Rollback

Rollback = o proprio baseline: commit `58f64326271f3a38e5b92ee322ff5dfcd0866816`.
Nada de producao aponta para este candidato; remover a branch desfaz tudo.

## Divida registrada (nao corrigida aqui, por ordem do briefing)

DIVIDA_SUPPLY_CHAIN_JOAO: o runtime do Joao depende de
`raw.githubusercontent.com` em cold start (wrapper importa URL raw pinada).
Este patch NAO amplia nem corrige esse padrao; GitHub aqui e so source control,
identidade imutavel e rollback.
