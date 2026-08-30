# Prova A1 por EXECUÇÃO — harness do contrato hermético

Rodada de 2026-08-30. Prova por execução (não por leitura de código) do bloco
hermético do artefato **`3f1ecf3c24859b628c5baea1d17d2e7620c7faf1`**
(`candidato/index.ts`, sha256 `01cf12b8…`).

## Como reproduzir

```bash
# do diretorio patches/joao-replay-hermetico/
python3 - <<'EOF'
src = open('candidato/index.ts').read()
ini = src.index('const sbLive = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);')
fim = src.index('\n', src.index('// ═════ fim do bloco A1 REPLAY HERMETICO')) + 1
open('/tmp/bloco.ts','w').write(src[ini:fim])
EOF
cat provas/harness-a1/prefixo.ts /tmp/bloco.ts provas/harness-a1/sufixo.ts > /tmp/harness.ts
npx -y esbuild@0.24.0 /tmp/harness.ts --loader:.ts=ts --format=esm --platform=node --outfile=/tmp/harness.mjs

# cenario A — sem credencial (fail-closed)
SNAPSHOT_JSON="$(cat provas/harness-a1/snapshot-exemplo.json)" node /tmp/harness.mjs

# cenario B — com credencial
SNAPSHOT_JSON="$(cat provas/harness-a1/snapshot-exemplo.json)" \
  DENO_REPLAY_RUNNER_JWT=dummy node /tmp/harness.mjs
```

O bloco hermético é extraído **byte a byte** do candidato e não é editado. Tudo
que o cerca (`prefixo.ts`, `sufixo.ts`) é instrumentação de medição:

- `prefixo.ts` — espiona o `fetch` **nativo** (qualquer chamada que ESCAPE do gate
  é registrada), instrumenta o cliente de banco (registra tabela/op/args e todo
  `.lte()` aplicado) e planta um `ESTADO_ATUAL_PROIBIDO` para detectar
  contaminação por estado de hoje.
- `sufixo.ts` — um `atenderCliente` que reproduz a **sequência real de pontos de
  efeito** de um turno do agente-noturno v4.37.1, extraída do baseline
  `58f64326`: leituras de contexto, ledger de decisão e envio, transporte
  WhatsApp com fallback BotConversa, TTS, áudio, Pix, task, LOST, frete,
  transcrição, inferência, gravação de fio, carimbo de inbound e persistência
  de estado.

## Resultado medido (`resultado-2026-08-30.json`)

| Prova | Medição |
|---|---|
| Sem `REPLAY_RUNNER_JWT` | HTTP 503 `replay_sem_credencial`, **0** fetch, **0** op de banco, **0** rpc |
| `mode=replay` | HTTP 200, contrato `a1_replay_hermetico_v1`, role `replay_runner` |
| `mode=live` depois do lacre | HTTP 409 `isolate_hermetico` |
| `mode` inválido | HTTP 400 `modo_invalido` |
| Escritas de banco | **13 interceptadas, 0 executadas** |
| HTTP mutador externo | **12 bloqueados, 0 executados** |
| Fetch que passou o gate | só 3: Anthropic (inferência), ERP `GET`, ERP rpc de orçamento |
| ERP `PATCH` (mutador) | **bloqueado** |
| `agente_noturno_estado` | **nunca foi ao banco**; turno viu `slots_before` do snapshot |
| Contaminação por estado de hoje | **nenhuma** — `ESTADO_ATUAL_PROIBIDO` não apareceu |
| Corte `as_of` | aplicado em `fact_conversations`, `inbound_fora_horario`, `mp_pix_cobrancas`, `orcamentos`, `operacoes_financeiras`, `pixel_events` |
| `REPLAY_CONTEXTO_INCOMPLETO` | preservado e ecoado na telemetria, sem inventar estado |
| Ações hipotéticas | 27 (9 escritas, 12 HTTP, 4 rpc mutadora, 2 rpc de leitura negada) |

## O que esta prova cobre — e o que NÃO cobre

**Cobre:** o contrato hermético do artefato executando de verdade, com o snapshot
real do caso sentinela `b3c3aa96` (aqui publicado em versão redigida): decisão de
modo, lacre de isolate, fail-closed sem credencial, intercepção de toda escrita
e de todo transporte externo, corte `as_of` e proibição de estado corrente.

**NÃO cobre:** execução dentro do runtime Supabase contra o banco de produção
com um JWT `replay_runner` real. Isso exige o secret `REPLAY_RUNNER_JWT`, que
não pôde ser provisionado nesta rodada. A negação estrutural no banco (42501 em
INSERT/UPDATE/DELETE/UPSERT/rpc mutadora sob `SET ROLE replay_runner`) foi
provada separadamente, em SQL, na rodada anterior — é a **primeira** camada; esta
prova é a do **código**.

Dados de cliente foram redigidos: o repositório é público.
