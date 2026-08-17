# Executor — evidência append-only e progresso independente

**Rodada 3 · 17/08/2026 · frente `fn-frente-finalizar-chat-overwrite-destrutivo` (fechada)**
Chat: `claude-executor-evidencia-20260817` · trilha `governanca` · GPS não alterado.

---

## 1. Causa raiz

`fn_frente_finalizar_chat` grava:

```sql
evidencia = coalesce(nullif(btrim(p_evidencia),''), evidencia)
```

Isso **substitui**. O `coalesce` só protege contra entrada vazia — evidência nova não-vazia apaga a anterior.

O trigger de auditoria `fn_frentes_auditar` registrava apenas o booleano `evidencia_alterada`, sem o conteúdo. Resultado medido: **556 alterações de evidência sem valor anterior recuperável**. Duas perdas reais já documentadas (10/08 e 13/08, esta última em `criterios-midia-inconsistentes` por `UPDATE` direto).

O `UPDATE` direto é parte essencial do problema: qualquer correção só na função deixaria esse caminho aberto.

## 2. Objetos criados

| Objeto | Papel |
|---|---|
| `frentes_campos_versoes` | Tabela append-only e imutável. `valor_anterior` + `valor_novo` de `evidencia`, `onde_paramos`, `proximo_passo`, `criterio_aceite`, `bloqueio` |
| `fn_trg_frentes_campos_versoes_imutavel` + `trg_fcv_imutavel` | Bloqueia `UPDATE` e `DELETE` na tabela de versões |
| `fn_frentes_versionar_campos` + `trg_frentes_versionar_campos` | `AFTER UPDATE` em `frentes`. Grava só quando o valor **muda de fato** |
| `fn_frente_checkpoint(text)` | Checkpoint cego a texto autoral do executor |
| `fn_frente_progresso(text,jsonb)` | Classifica `FORTE` / `FRACO` / `SEM_PROGRESSO` |
| `vw_frentes_evidencia_historico` | Leitura auditável |
| `backup_executor_evidencia_20260817` | Rollback |

**Nenhum objeto do GPS foi tocado.** `fn_frente_finalizar_chat` e `fn_frentes_auditar` seguem exatamente como estavam.

## 3. Mecanismo escolhido

Trigger de versionamento, **não** concatenação. Três razões:

1. O critério de aceite pedia proteção por **estrutura**, não por disciplina de quem escreve — e citava explicitamente `microloops-23-agentes`, com ~290 mil caracteres num único campo, como o que *não* fazer.
2. Um trigger cobre `fn_frente_finalizar_chat` **e** `UPDATE` direto. Corrigir só a função deixaria metade do buraco.
3. Zero mudança de assinatura → zero quebra de chamador.

## 4. Compatibilidade

Levantamento de chamadores: **nenhuma função SQL chama** `fn_frente_finalizar_chat`. A única menção é o texto de protocolo dentro de `fn_contexto_codex_frentes`. Os chamadores reais são externos, via `service_role` RPC — sessões de chat.

Assinatura intacta, semântica de retorno intacta, nenhum chamador alterado.

Grants da tabela nova conferidos: `anon` e `authenticated` **não leem**; só `service_role` — mesma postura de `frentes`, `frentes_espera` e `frentes_historico`.

## 5. Provas E1 / E2 / E3

Baseline seed preservou **839 valores vigentes em 227 frentes**, 189 deles evidências. Fidelidade conferida byte a byte:

| Frente | Chars atuais | Chars versionados | Fiel |
|---|---|---|---|
| `criterios-midia-inconsistentes` | 75.389 | 75.389 | sim |
| `gps-acionabilidade-espera-externa` | 3.867 | 3.867 | sim |
| `microloops-23-agentes` | 483 | 483 | sim |

Três sobrescritas sucessivas por `UPDATE` direto na frente reivindicada, e a baixa como quarta:

| Ordem | Origem | Preservada |
|---|---|---|
| 1 | E1 — `UPDATE` direto | sim |
| 2 | E2 — `UPDATE` direto | sim |
| 3 | E3 — `UPDATE` direto | sim |
| 4 | baixa via `fn_frente_finalizar_chat` | sim |

A quarta linha é a prova do caminho da função, e não de teste sintético: é a própria baixa desta frente.

**Imutabilidade:** `UPDATE` e `DELETE` na tabela de versões bloqueados com `check_violation`.

Nenhuma evidência real foi destruída para produzir estas provas.

## 6. Progresso independente

Princípio: *quem executa não pode ser a única fonte que prova que executou.*

`fn_frente_checkpoint` monta o hash **apenas** com fatos que o executor não fabrica escrevendo texto sobre si:

- `estado` — portão de `fn_frente_finalizar_chat` exige `criterio_aceite` + `evidencia` para fechar;
- `esperas_abertas` — tabela append-only, encerramento exige `evidencia_encerramento`;
- `estado_alteracoes` — contagem escrita por trigger;
- `passos_versionados` — contagem escrita pelo trigger de versionamento, e **só quando o valor muda**.

**Fora do checkpoint, de propósito:** `evidencia` e `onde_paramos`. São o que o executor escreve sobre o próprio trabalho.

O executor nunca insere na tabela de versões — quem insere é o trigger.

## 7. Provas do checkpoint

| Teste | Resultado |
|---|---|
| Alterar `estado` | `FORTE` (moveu `estado` + `estado_alteracoes`) |
| Alterar `proximo_passo` | `FRACO` (checkpoint `f5511be3…` → `5f086fd3…`) |
| Nenhuma mudança | `SEM_PROGRESSO` |
| **Reescrever só `evidencia`** | **checkpoint idêntico antes e depois de E1 — `SEM_PROGRESSO`** |
| Espera aberta/encerrada | componente cabeado e populado com ids reais; transição ao vivo **não exercitada** — ver limite |

A quarta linha é a que corrige a falha da rodada 1: antes, escrever evidência movia o hash e o anti-loop lia progresso do próprio ruído.

## 8. Riscos

| Risco | Situação |
|---|---|
| Crescimento da tabela de versões | 846 linhas. Cresce só com alteração real; sem rotação por ora |
| Passivo de concatenação existente | `microloops-23-agentes` segue com ~290 mil chars num campo. O patch impede crescimento futuro, **não encolhe o passado** |
| `FRACO` explorável em loop | `proximo_passo` é autodeclarado. Mitigação é regra de anti-loop (N rodadas só com `FRACO` → `SEM_PROGRESSO`), ainda **não implementada** |
| RLS `false` na tabela nova | Não é exposição: grants negam `anon`/`authenticated`. Consistente com a família `frentes_*` |

## 9. Rollback

`backup_executor_evidencia_20260817` guarda a definição vigente dos objetos tocados; o script de reversão está no comentário da tabela:

```sql
drop trigger trg_frentes_versionar_campos on public.frentes;
drop function public.fn_frentes_versionar_campos();
drop function public.fn_frente_checkpoint(text);
drop function public.fn_frente_progresso(text,jsonb);
drop view public.vw_frentes_evidencia_historico;
drop table public.frentes_campos_versoes;
```

Reverter **não** destrói nada em `frentes`: o patch só acrescenta.

## 10. Estado da frente

`fn-frente-finalizar-chat-overwrite-destrutivo` → **fechada**, com os quatro pontos do critério comprovados, inclusive o item 4 (histórico estruturado em vez de concatenação infinita). Claim liberado, zero claims ativos meus.

## 11. `CONTRATO_GPS_INSUFICIENTE`

**Nenhum novo nesta rodada.** Os três já reportados seguem com a sessão do GPS ou comigo, conforme a fronteira acordada:

- predicado estruturado de espera — GPS;
- frentes acionáveis cujo próximo passo é esperar — GPS;
- custódia durável do `claim_token` — executor, fora do escopo desta rodada.

## 12. Gate do canário

| Condição | Estado |
|---|---|
| Evidência não destrutiva | **atendida e provada** |
| Progresso independente do executor | **atendido e provado** |
| Regra de anti-loop sobre `FRACO` | pendente (executor) |
| `CONTRATO_GPS_ATENDIDO` + 4 verificações | pendente (GPS) |

Canário **não executado**. `diego-timeout-fn-contexto-midia-ouro` não foi tocada. Nenhum cron criado ou habilitado, nenhuma flag `allow_*` aberta, nenhum orçamento alterado, `frentes_claims_segredo` não lida.
