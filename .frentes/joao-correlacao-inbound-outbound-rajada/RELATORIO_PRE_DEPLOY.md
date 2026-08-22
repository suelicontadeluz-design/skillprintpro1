# P0 — joao-correlacao-inbound-outbound-rajada — pre-deploy

Frente: `joao-correlacao-inbound-outbound-rajada` (`a2ae2455-0441-481b-9613-30a006d9feff`)
Claim: `fn_frente_claim_v2` -> `claim_criado`, chat_id `claude-code-cli-j7jb4x`, trilha `conversao_joao`.

## BASE
| item | valor |
|---|---|
| Edge version | 172 (ACTIVE) |
| versao logica | agente-noturno-v4.30.0 |
| bundle ezbr_sha256 | `4afd32c20e306a8e63fc94a619b7586462a02910dd4d86f486d3effeba872f30` |
| verify_jwt | false |
| entrypoint | `supabase/functions/agente-noturno/index.ts` |
| index.ts baseline sha256 | `6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764` |
| bytes | 244094 |
| linhas | 3215 |

Fonte baixada do Supabase ACTIVE (nao do GitHub, que nao continha a function).
O sha256 acima e do `index.ts` local e NAO se compara ao `ezbr_sha256` do bundle.

## ROLLBACK
Artefato imutavel: `.frentes/joao-correlacao-inbound-outbound-rajada/v172_original_ROLLBACK.index.ts`
sha256 `6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764` (identico ao baseline).
Procedimento: redeploy byte-exato desse arquivo como `supabase/functions/agente-noturno/index.ts`, verify_jwt=false.

## PATCH
Arquivo unico: `supabase/functions/agente-noturno/index.ts`.
+134 / -19. Diff completo em `patch_v4.31.0.diff`.

Blocos:
1. cabecalho + `const V = 'agente-noturno-v4.31.0'`.
2. `finalizarDecisaoSuperseded` — terminal do superseded no ledger que ja existe.
3. `FILTRO_INBOUND_COM_CONTEUDO` + `inboundMaisNovoQue` + `maxCreatedAtDoLote` — regra unica de frescor.
4. `atenderCliente`/`atenderClienteInterno` ganham `loteCreatedAtMax`.
5. remocao da heuristica temporal `ja_respondida`.
6. `contextoDecisao` ganha `turn_id` e `owned_inbound_ids`.
7. BARREIRA FINAL antes de `prepararEnvio`/`entregarComoJoao`.
8. sweep passa `loteMax`.
9. webhook forma `ownedIds`/`loteCreatedAtMax` a partir da rajada real.
10. debounce passa a usar o helper unico.
11. dedup causal por estado terminal da propria linha (`inbound_ja_terminal`).

Prova de ausencia de mudanca comercial: a unica linha alterada que menciona termo
comercial e `contextoDecisao`, e a alteracao e puramente aditiva
(`turn_id`, `owned_inbound_ids`); `objecao_preco`, `tools`, `tema`, `mudou_produto`
e `fechamento_forcado` seguem identicos. Nenhuma linha de preco, Pix, frete, DTF,
catalogo, modelos, TTS, LOST, slots, prompt ou guards financeiros foi tocada.

## SWEEP (prova mecanica, nao "o cron esta ativo")
Cron `joao-sweep-2min`, jobid 113, `active = true`, schedule `*/2 * * * *`:
```
SELECT net.http_post(
  url := 'https://ldrdtaibazplvrbwyrvx.supabase.co/functions/v1/agente-noturno',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{"_sweep": true}'::jsonb,
  timeout_milliseconds := 150000)
```
`cron.job_run_details`: 60 execucoes `succeeded` nas ultimas 2 horas (= 1 a cada 2 min).

Query real de selecao (index.ts, ramo `body._sweep === true`):
```ts
const { data: rows } = await sb.from('inbound_fora_horario')
  .select('id, phone, chat_name, body, created_at')
  .eq('status', 'pendente')
  .gte('created_at', new Date(Date.now() - 4 * 3600000).toISOString())
  .lte('created_at', new Date(Date.now() - 30000).toISOString())
  .order('created_at', { ascending: true }).limit(40);
```
1. cron ativo: sim. 2. periodicidade real: 2 min, confirmada em job_run_details.
3. chama agente-noturno: sim, pela URL acima. 4. seleciona `status='pendente'`: sim.
5. nao exclui superseded: as unicas condicoes extras sao idade (30s..4h); o caminho
   superseded NAO escreve nada em `inbound_fora_horario`. 6. nao exige campo novo:
   idem — zero escrita, a linha continua como o webhook a inseriu. 7/8. A e B seguem
   `pendente` e elegiveis. 9. o agrupamento e por telefone e devolve todos os ids do
   lote. 10. o carimbo so ocorre depois do envio confirmado, sobre `owned_inbound_ids`.
Coberto por T3/T4/T4b sobre a query literal extraida do arquivo.

## TESTES
`deno test --allow-read .frentes/joao-correlacao-inbound-outbound-rajada/testes/p0_test.ts`
13 passed / 0 failed. `deno check` do index.ts: EXIT=0, zero erro TypeScript.
Nenhum cliente real usado. Telefones sinteticos `5500...`. Transporte stubado.
