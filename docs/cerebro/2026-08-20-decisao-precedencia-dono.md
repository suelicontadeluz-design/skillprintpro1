# Decisão de precedência do dono — 2026-08-20

Rodada de **governança de ordem**. Nenhum código de agente, nenhuma Edge publicada,
nenhuma prioridade alterada, nenhuma frente criada ou fechada, `max_workers` intocado em 1.

`fn_gps_proxima` não foi tocada: os cinco objetos do GPS V1 batem sha256 com
`backup_objetos_gps_20260820`.

---

## A história não foi reescrita

A auditoria `gps_precedencia_auditoria`, de 20/08 às 10h, concluiu **"SEM FUNDAMENTO"** para
estas mesmas frentes. **Aquela conclusão continua correta** para o momento em que foi feita:
naquele instante não existia decisão humana ordenando-as, e o sistema corretamente se recusou
a inventar uma.

O que mudou não foi a auditoria — foi a **existência de uma fonte canônica nova**:
`decisao_dono_precedencia_2026-08-20`. As linhas da auditoria foram preservadas verbatim e
apenas ganharam três colunas de carimbo (`resolvida_em`, `resolvida_por_fonte`,
`resolucao_observacao`) dizendo exatamente isso.

---

## FUNIL

Decisão: `handoff-tem-validade` **antes de** `ingestao-message-log-sobrescrita`.

Fundamento do dono: handoff interfere diretamente em quem pode atender/vender; a ingestão é
defeito real mas já rebaixada para P3 pela severidade medida. **Decisão nova e explícita** —
não se deve inferir que o rebaixamento anterior já significava precedência, porque não
significava.

`handoff-tem-validade` já ocupava precedência 2 e **não foi tocado**.
`ingestao-message-log-sobrescrita` recebeu **4**, não 3, porque existe índice único parcial
`(trilha, precedencia) WHERE ativo` e o valor 3 está ocupado. Escolher 4 não afirma ordem nova
sobre nada vivo: as posições 1 e 3 de `funil` pertencem a frentes **já fechadas**
(`venda-invisivel-guarda-recorrente`, `julia-leads-bloqueados`), e as únicas P3 vivas na trilha
são exatamente as duas desta decisão.

## CONVERSAO_JULIA

Decisão, **por severidade de negócio**:

| # | Frente | Precedência | Fundamento do dono |
|---|---|---|---|
| 1 | `saida-de-agente-com-conteudo-interno-ao-cliente` | 3 | maior risco de confiança, exposição de texto de sistema, segurança comercial |
| 2 | `julia-mensagem-duplicada` | 4 | defeito objetivo de saída já medido em tráfego |
| 3 | `julia-verborragia-respostas-comerciais` | 5 | problema comercial real, concentrado na cauda, menor severidade |

Registrado no `motivo` de cada linha como **ORDEM POR DECISÃO DO DONO / SEVERIDADE DE NEGÓCIO**,
explicitamente **não** como ordem técnica derivada — a investigação já provou que deduplicação
não é pré-requisito da verborragia, que os escopos são independentes e que não há `depende_de`
entre elas.

Faixa 3–5 porque 1 e 2 pertencem às P1 `julia-uv-nesting-fonte-verdade` e
`julia-briefing-multiartes`, que **não foram tocadas**. A faixa acima delas apenas acompanha a
prioridade, que já é soberana.

---

## Testes

| # | Teste | Resultado |
|---|---|---|
| 1 | `fn_gps_proxima('funil')` | **UNICA**, `PRECEDENCIA_INTRA_TRILHA`, escolhida `handoff-tem-validade`, cobertura 2/2 |
| 2 | `fn_gps_proxima('conversao_julia')` | **UNICA**, `PRECEDENCIA_INTRA_TRILHA`, escolhida `saida-de-agente-com-conteudo-interno-ao-cliente`, cobertura 3/3 |
| 3a | rota humana continua soberana | inseri rota apontando para `ingestao`: virou `ROTA_ESCOLHIDA` / `ROTA_HUMANA` sobrepondo a precedência. Revertido |
| 3b | prioridade continua soberana | liberei a espera de `mapeamento-funil-cerebro` (P1, **sem** precedência): venceu as duas P3 **com** precedência. Revertido |
| 3c | nenhuma espera forçada | `aguardando` continua com 2 em funil e 4 em conversao_julia |
| 3d | sem fallback implícito | ver contraprova abaixo |
| 4 | `fn_gps_autoteste()` | `ok=true`, `rotas_stale=0`, `residuo_teste=0` |
| 5 | hashes do GPS V1 | 5 de 5 inalterados |
| 6 | claims / leases residuais | 0 / 0 |

### Contraprova de que não houve ordem alfabética, data ou UUID

Ordem decidida em `conversao_julia`:
`saida-de-agente... < julia-mensagem-duplicada < julia-verborragia...`

| Se fosse | Resultado |
|---|---|
| alfabética | `julia-mensagem-duplicada < julia-verborragia... < saida-de-agente...` |
| `criada_em` | `julia-mensagem-duplicada < julia-verborragia... < saida-de-agente...` |
| `atualizada_em` | `julia-mensagem-duplicada < julia-verborragia... < saida-de-agente...` |
| `uuid` | `julia-mensagem-duplicada < saida-de-agente... < julia-verborragia...` |

A frente que o dono colocou em **primeiro** seria a **última** em três dos quatro critérios
proibidos. Nenhum deles produz a ordem decidida.

---

## Pós-flight

| Trilha | Antes | Depois | Frente escolhida | Fonte da ordem |
|---|---|---|---|---|
| funil | AMBIGUA | **UNICA** | `handoff-tem-validade` | `decisao_dono_precedencia_2026-08-20` |
| conversao_julia | AMBIGUA | **UNICA** | `saida-de-agente-com-conteudo-interno-ao-cliente` | `decisao_dono_precedencia_2026-08-20` |

| Métrica | Antes | Depois |
|---|---|---|
| Trilhas AMBIGUA | 2 | **0** |
| Lacunas bloqueando agora | 4 | **0** |
| Lacunas ao voltar | 18 | 20 (*) |
| Lacunas latentes | 13 | 13 |
| Precedências ativas | 37 | 41 |
| Frentes fechadas com espera aberta | 0 | 0 |
| Esperas abertas | 46 | 46 |
| Claims / leases | 0 / 0 | 0 / 0 |
| `max_workers` | 1 | **1 (não alterado)** |

(*) O +2 não vem desta decisão: é a trilha `identidade` voltando a aparecer no detector depois
que um claim de outro Worker foi liberado. As 4 lacunas que bloqueavam agora foram todas cobertas.

**Rollback:** `backup_gps_precedencia_20260820` guarda o estado anterior linha a linha com o
`INSERT ... ON CONFLICT` de volta. Reverter = executar esses `rollback_sql` e apagar as 4 linhas
com `fonte='decisao_dono_precedencia_2026-08-20'`.

---

## conversao_joao — ficha de decisão (NÃO persistida como ordem)

As 6 continuam **sem precedência**: `gps_frente_precedencia` tem **zero** linhas para
`conversao_joao`. A trilha continuará AMBIGUA quando acordarem, até haver decisão explícita.

Ficha em `public.gps_ficha_decisao_conversao_joao`, com
`status = 'RECOMENDACAO_PARA_DECISAO_DO_DONO'`.

### Recomendação (não é fato canônico)

| # | Frente | Preço | Continuidade | Funil | Contrato | Deploy | Por quê nesta posição |
|---|---|---|---|---|---|---|---|
| 1 | `joao-contexto-comercial-canonico` | – | sim | sim | sim | não | É a fonte de verdade que as outras leem. Risco baixo, já ativo, rollback por flag |
| 2 | `joao-desistencia-lost-canonico` | – | sim | sim | – | não | Patch já publicado; só aguarda evento. Não consome nada nem trava arquivo |
| 3 | `joao-continuidade-orcamento-fechamento` | sim | sim | sim | sim | não | Dinheiro direto, mas precisa dos termos vigentes de (1) para julgar |
| 4 | `joao-correcao-contexto-intencao` | – | sim | – | – | não | "Estado explicitamente corrigido" só é verificável sobre estado confiável |
| 5 | `joao-preco-guarda-cega-produto` | sim | – | – | sim | sim | É o pai e fixa o escopo do patch; precisa vir antes da filha |
| 6 | `guarda-preco-contrato-por-produto` | sim | sim | – | sim | sim | Mesmo arquivo do pai: adjacente no fim minimiza reancoragem |

**Alerta que o dono precisa ver antes de decidir:** `guarda-preco-contrato-por-produto` está
congelada desde 14/08 ancorada em `agente-noturno` **version 150** (sha `ce9258ff`, diff de 6
edições). A plataforma está na **version 166** desde 16/08. O patch **precisa ser reancorado**
antes de subir, seja qual for a posição na fila. E o pré-flight mediu **6 falsos bloqueios em
10 derrubadas** — falso bloqueio pode virar silêncio ao cliente.
