# Canário do executor — uma iteração

**17/08/2026 · frente `diego-timeout-fn-contexto-midia-ouro` · trilha `midia`**
Chat `claude-canario-executor-20260817`.

---

## Gates verificados antes de executar

| Gate | Estado |
|---|---|
| P1 avaliador determinístico e read-only | passa |
| P2 cadeia fecha (espera → `acionavel=true`) | passa, **com ressalva** (§ Ressalvas) |
| P3 `decisao_humana` → `NAO_AVALIAVEL` | passa |
| P4 espera legada segue válida e manual | passa |
| Evidência append-only ativa | trigger presente, 855 versões |
| Progresso independente | `fn_frente_checkpoint` operante |
| Anti-loop `FRACO` | implementado e provado nesta rodada |
| Claims concorrentes | zero |
| Autonomia | `allow_*` todos `false`, `mode=observe`, orçamento 20 BRL — **intocados** |
| Crons de executor | zero |

## Escolha da frente

Não reusei a escolha antiga. `fn_gps_proxima('midia')` devolveu `UNICA`, candidata única, `melhor_prioridade=1`, zero bloqueadores — **o GPS atual confirmou a mesma frente**.

## Ciclo executado

```
GPS (UNICA) → anti-loop (SEM_BASE → PROSSEGUIR) → CLAIM → heartbeat
  → trabalho real (reconferência read-only de 6 critérios)
  → evidência + veredito AGUARDANDO → release → GPS
```

## Trabalho real e resultado

Reconferência dos 6 itens sobre os ciclos orgânicos de 15/08 e 16/08. Nenhum cron disparado à mão, nenhum run fabricado, nenhum participante injetado.

| Item | Resultado |
|---|---|
| 1. cron 131 → `obs:cron:20260815/16` em `midia_shadow.avaliacao` | PASS |
| 2. `agente_execution_log` `modo=analisar`, `status=ok`, `erros=[]` | PASS |
| 3. `agente_decisoes_log` `resultado=executada` | PASS |
| 4. `agente_memoria` `recomendacao_midia` chaves 15 e 16/08 | PASS |
| 5. `midia_shadow.participante` correlacionado (36 participantes) | PASS |
| 6. **tempo da coleta em cache frio** | **NÃO PROVÁVEL** |

**Veredito: AGUARDANDO. A frente não fechou.**

`agente_execution_log.metricas` está vazio; o `duracao_ms` registrado (16.755 e 18.765 ms) é o tempo total da edge function incluindo LLM, não isola `fn_contexto_midia_ouro`; e `cron.job_run_details` do job 80 mede só o enfileiramento (22–28 ms). **O tempo de coleta não está persistido em lugar nenhum.**

Não medi por `EXPLAIN ANALYZE` de propósito: seria medição quente, e o critério de aceite abre com *"ACEITE ANTERIOR INVALIDADO. Nao aceitar medicao quente como prova de producao"*.

Este é o resultado que mais importava do canário: **o executor fez trabalho real e recusou declarar PASS.**

## Provas do mecanismo

**Evidência não destrutiva, em frente real.** A evidência original desta frente — **29.236 caracteres** — está íntegra na versão 1 da tabela append-only; a minha entrou como versão 2 (2.434 chars). Sobrescrita sem perda, num caso com histórico real e volumoso.

**Progresso por sinal independente.** Pós-trabalho o anti-loop classificou `FRACO` (`rodadas_fracas=1`, `PROSSEGUIR`) — correto, porque a rodada mudou `proximo_passo` mas não produziu mudança de estado nem espera. Uma segunda rodada equivalente dispararia `SEM_PROGRESSO` com quarentena de 24h. **O executor não conseguiria moer esta frente indefinidamente.**

**Espera:** nenhuma aberta. O bloqueio não é evento orgânico faltante (houve dois ciclos), é instrumentação ausente — que é trabalho, não espera. Não fabriquei espera para exercitar o mecanismo.

## Fechamento do ciclo

GPS reconsultado: `midia` segue `UNICA` na mesma frente (correto — o trabalho não terminou). Zero claims ativos, frente `em_andamento`, zero crons novos. **Não capturei o próximo trabalho.**

## Ressalvas honestas

1. **P2 foi provada com a espera temporal**, hospedada na frente do GPS, não com Bruno ou Vera — que seguem `NAO_SATISFEITA` aguardando evento orgânico. Foi o plano acordado (não falsificar fenômeno comercial), mas minha formulação original dizia "com uma das duas esperas reais". Registro a diferença.
2. **Chamei `fn_executor_registrar_rodada` duas vezes** nesta iteração — uma como portão antes do trabalho, outra para registrar o desfecho. Isso contou `rodadas_total=2` para uma iteração. O uso canônico é **uma chamada por rodada, no início**; ajustar quando o loop for implementado.
3. Eu construí tanto o contrato do GPS quanto o executor que o consome. A revalidação é mecânica e re-executável, mas não substitui revisão independente.
