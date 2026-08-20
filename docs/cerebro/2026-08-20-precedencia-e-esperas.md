# Rodada `precedencia + esperas` — 2026-08-20

Projeto Supabase: `ldrdtaibazplvrbwyrvx`.

GPS V1 **não foi alterado**. Prova: `backup_objetos_gps_20260820` guarda o sha256 de
`fn_gps_proxima`, `fn_gps_panorama`, `fn_gps_autoteste`, `vw_frentes_elegiveis` e
`vw_gps_rota_vigente`; os cinco batem com o objeto vivo. Nenhuma das 18 migrations de
20/08 redefine objeto do GPS. `gps_frente_precedencia` continua com **as mesmas 37 linhas
ativas de antes** — nenhuma ordem foi inventada.

---

## MISSÃO 1 — Precedência

### Fontes varridas, para cada lacuna
`gps_frente_precedencia`, `gps_rota_decisao`, `gps_decisoes_humanas`, `frentes.depende_de`,
`frentes.frente_pai_slug`, `frentes.ordem_execucao`, `frentes.criterio_aceite`,
`frentes.proximo_passo`, `frentes.onde_paramos`, `frentes.bloqueio`, `frentes.evidencia`,
`frentes_espera.descricao` — busca textual cruzada de cada slug contra todos os outros.

Resultado persistido em `public.gps_precedencia_auditoria` (35 linhas).

### Resultado por trilha

| Trilha | Frente | Antes | Depois | Fundamento | Fonte |
|---|---|---|---|---|---|
| funil | `ingestao-message-log-sobrescrita` | sem precedência | **sem precedência** | C — nenhuma referência cruzada com `handoff-tem-validade`; artefatos distintos. A única decisão do dono (19/08) foi **rebaixar** P2→P3 "com base na severidade medida", o que a colocou empatada, não abaixo | `frentes.proximo_passo`, varredura cruzada |
| conversao_julia | `julia-mensagem-duplicada`, `julia-verborragia-respostas-comerciais`, `saida-de-agente-com-conteudo-interno-ao-cliente` | sem precedência | **sem precedência** | C — hipótese "dedup antes de verborragia" **refutada pela medição da própria frente vizinha** | `frentes.evidencia` de `julia-verborragia` |
| conversao_julia | `julia-instrucao-tecnica-e-mensagem-concorrente`, `julia-pagamento-grounded` | sem precedência | **sem precedência** | C — **decisão do Alessandro em 14/08 nega a ordem**: "não é preciso terminar a frente concorrente para começar o grounding" | `frentes.evidencia` de `julia-falha-tool-nao-vira-fato` |
| conversao_joao | `guarda-preco-contrato-por-produto` | sem precedência | **sem precedência** | C — ordem canônica existe ("a 151 sobe PRIMEIRO") mas é **cruzada entre trilhas** e a **premissa morreu** | `microloops-23-agentes.onde_paramos` item (O) + leitura da plataforma |
| conversao_joao | `joao-preco-guarda-cega-produto` | sem precedência | **sem precedência** | C — `frente_pai_slug` existe mas não tem semântica de ordem declarada em lugar nenhum | schema + 69 casos de pai/filha |
| conversao_joao | os outros 4 | sem precedência | **sem precedência** | C — as 6 estão todas em prioridade 1; `depende_de` vazio nas seis; `ordem_execucao` = {1,1,1,2,3,NULL} | varredura completa |
| aprendizado, atribuicao, governanca, erp, operacao_humana, midia, seguranca | 22 restantes | sem precedência | **sem precedência** | C — nenhuma afirmação de ordem em nenhuma fonte | varredura completa |

**Resolvidas por decisão existente: 0. Resolvidas por dependência objetiva: 0. Continuam sem fundamento: 35.**

### Dois achados que fecham a investigação

1. **`depende_de` é estruturalmente inerte para desempate.** `vw_frentes_elegiveis` torna
   inelegível toda frente com dependência pendente. Logo duas frentes ligadas por `depende_de`
   nunca podem empatar. Medido: 0 arestas entre frentes empatadas.
2. **`ordem_execucao` não representa precedência.** 70 nulos entre as frentes vivas e empates
   diretos — quatro frentes de `conversao_julia` com o mesmo valor 9, três de `conversao_joao`
   com o mesmo valor 1. Não é ordem total.

### Achado operacional entregue ao dono

`guarda-preco-contrato-por-produto` diz "Aguarda o deploy da 151". A ordem segura registrada
em 16/08 ancorava esse patch num diff de 6 edições contra `agente-noturno` **version 150**,
sha `ce9258ff`. Leitura da plataforma em 20/08: `agente-noturno` está **ACTIVE na version 166**,
publicada em 2026-08-16 20:03 UTC. **A âncora venceu por 16 publicações** — o patch congelado
perdeu a base e precisa ser reancorado antes de subir. Registrado como evidência na frente;
nada operacional foi tocado.

### Métricas

| Métrica | Antes | Depois |
|---|---|---|
| Trilhas AMBIGUA | 2 | 2 |
| Lacunas bloqueando agora | 4 | 4 |
| Lacunas ao voltar | 18 | 18 |
| Lacunas latentes | 13 | 13 |
| Precedências ativas | 37 | **37 (zero inventada)** |
| Lacunas com fundamento auditado e registrado | 0 | **35** |

---

## MISSÃO 2 — Frente fechada não pode deixar espera aberta

### Investigação do fechamento

**Não existe função canônica que feche frente.** Nenhuma função SQL do schema faz
`UPDATE public.frentes`. Existem dois caminhos:

1. `fn_frente_finalizar_chat(slug, chat_id, 'fechada', ...)` — exige claim ativo com token,
   `criterio_aceite` e `evidencia`; atualiza `frentes` e o claim, e **não toca `frentes_espera`**.
2. `UPDATE` direto via PostgREST com `service_role`.

`fn_frentes_touch` (BEFORE UPDATE) preenche `fechada_em` e o limpa na reabertura.
Já existia o precedente `trg_gps_revogar_rota_ao_encerrar_frente` — AFTER UPDATE em `frentes`,
que revoga a rota ao encerrar. **A correção segue exatamente esse padrão**, e por isso pega
os dois caminhos de fechamento.

### Correção

- `fn_frentes_superar_esperas_ao_encerrar()` + `trg_frentes_superar_esperas_ao_encerrar`
  (AFTER UPDATE em `frentes`, mesma transação).
- `fn_espera_recusa_frente_encerrada()` + `trg_frentes_espera_frente_encerrada`
  (BEFORE INSERT em `frentes_espera`): fecha o invariante na outra direção.
- `vw_frentes_espera_orfa`: invariante consultável, deve estar sempre vazia.

**Semântica preservada no dado, não só no comentário.** A evidência gravada diz
`SUPERADA_POR_FECHAMENTO_DA_FRENTE` e, em texto, que a condição declarada **não ocorreu e não
foi avaliada** — a espera perdeu objeto. Para `decisao_humana` a evidência afirma explicitamente
que **nenhuma decisão foi registrada em `gps_decisoes_humanas` por este caminho**.

### Testes — 8/8, com rollback total (nada persistiu)

| # | Teste | Resultado |
|---|---|---|
| 1 | frente aberta + espera aberta → nada acontece | passou |
| 2 | frente fecha → espera encerra atomicamente, sem "condição satisfeita" | passou |
| 3 | falha durante o fechamento → rollback completo (frente `em_andamento`, 3 esperas abertas) | passou |
| 4 | duas esperas abertas → ambas superadas | passou |
| 5 | espera já encerrada → não reescrita | passou |
| 6 | `decisao_humana` superada, **0** linhas em `gps_decisoes_humanas` | passou |
| 7 | GPS após fechamento: frente não reaparece, contagem de esperas intacta, situação idêntica | passou |
| 8 | espera nova sobre frente encerrada é recusada | passou |

O teste apanhou um defeito real na primeira versão da trigger: `frentes_historico.evento` tem
lista fechada e não aceitava o evento novo. A trigger foi simplificada em vez de alargar aquela
restrição de governança.

### Backfill

Os 2 resíduos anteriores à trigger (`joao-silencio-vazamento-quente`,
`whatsapp-arquivo-ack-automatico-remover`) foram superados com a mesma semântica e marcados
como backfill. Nenhuma frente foi reaberta; a prova de 734 casos do silêncio continua válida.

### Métricas

| Métrica | Antes | Depois |
|---|---|---|
| Frentes encerradas com espera aberta | 2 | **0** |
| Esperas abertas (total) | 48 | 46 |
| Esperas `evento_organico` | 21 | 19 |
| Claims residuais | 0 | 0 (1 ativo, de outro Worker em trabalho normal) |
| Leases residuais | 0 | 0 |

### Rollback

```sql
drop trigger if exists trg_frentes_superar_esperas_ao_encerrar on public.frentes;
drop trigger if exists trg_frentes_espera_frente_encerrada on public.frentes_espera;
drop function if exists public.fn_frentes_superar_esperas_ao_encerrar();
drop function if exists public.fn_espera_recusa_frente_encerrada();
drop view if exists public.vw_frentes_espera_orfa;
```
As esperas já superadas permanecem: `frentes_espera` é append-only por decisão anterior do
sistema. Reverter uma superação significa reabrir a frente e abrir espera nova, não reescrever
a linha histórica.

---

## Objetos criados

Tabelas: `gps_precedencia_auditoria`, `backup_objetos_gps_20260820`.
Views: `vw_frentes_espera_orfa`.
Funções: `fn_frentes_superar_esperas_ao_encerrar`, `fn_espera_recusa_frente_encerrada`.
Triggers: `trg_frentes_superar_esperas_ao_encerrar`, `trg_frentes_espera_frente_encerrada`.

Não tocado: `fn_gps_proxima`, `vw_frentes_elegiveis`, `gps_frente_precedencia`,
`executor_config`, qualquer edge function, qualquer objeto operacional do João.
