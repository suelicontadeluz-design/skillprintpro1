# Relatório de purge — NÃO EXECUTAR AINDA

Levantamento do que seria preciso para remover a PII do histórico público, e
por que o purge **não pode** vir antes da migração do pointer live.

Nada aqui foi executado: sem `git filter-repo`, sem BFG, sem rewrite de branch
principal, sem exclusão de refs, sem remoção do objeto live.

## Escopo medido (2026-08-30)

| Métrica | Valor |
|---|---|
| PII distintas no repositório | **88** (46 telefones com DDI, 4 formatados, 11 e-mails, 7 CPFs, CNPJs, CEPs) |
| Blobs contaminados | **120** |
| Caminhos distintos afetados | **91** |
| Commits alcançáveis | 176 |
| **Commits afetados** | **107** (61%) |
| **Refs afetadas** | **14** |

### REFS_AFETADAS

| ref | commits afetados |
|---|---|
| `claude/fix-37-wrong-lead-ids-1jn9ry` | 40 |
| `claude/cerebro-mapa-v0-audit-70wp69` | 27 |
| `claude/financial-params-provenance-6kk14g` | 13 |
| `kaizen/replay-hermetico-joao` | 13 |
| `claude/vitor-state-corruption-1wrttu` | 11 |
| `claude/joao-lead-loop-fix-oount3` | 10 |
| `fix/joao-historico-fetch-igualdade` | 10 |
| `claude/joao-modalidade-logistica-antes-do-cep` | 6 |
| `claude/frenet-label-creation-37cc8v` | 3 |
| `claude/joao-contexto-comercial-canonico-v163` | 3 |
| `claude/agente-noturno-manifesto-rpc-idhfl4` | 2 |
| `claude/joao-correlacao-inbound-outbound-j7jb4x` | 2 |
| `claude/joao-operation-id-leak-xprmd9` | 2 |
| `claude/shadow-cycle-effect-zero-audit-2khoa9` | 1 |

`main` está **limpo**. As branches `kaizen/pii-sanitizacao-joao` e
`kaizen/replay-hermetico-isabela` também.

## RISCO_DE_QUEBRAR_RUNTIME — **ALTO**

O commit que a Edge live importa, `58f64326271f3a38e5b92ee322ff5dfcd0866816`,
é o **tip de duas branches**: `claude/joao-lead-loop-fix-oount3` e
`fix/joao-historico-fetch-igualdade`.

O `agente-noturno` v183 busca esse objeto por URL `raw.githubusercontent.com`
**a cada cold start**. Qualquer rewrite dessas branches muda o SHA; o objeto
antigo deixa de ser alcançável por ref e o `import` passa a dar 404 no próximo
cold start — o João para de atender, sem aviso e sem rollback.

Por isso o purge é o **último** passo, nunca o primeiro.

## RISCO_DE_QUEBRAR_ROLLBACK — **ALTO**

`58f64326` também é o rollback de tudo que existe hoje: do candidato A1 e da
própria sanitização. Purgar antes de haver um SHA sanitizado publicado e
validado deixa o sistema sem para onde voltar.

## PASSOS_GITHUB_NECESSARIOS

1. Migrar o pointer live para o SHA sanitizado e provar o pós-flight
   (ver README, "Sequência governada"). **Só depois disso** o objeto antigo
   deixa de ser necessário ao runtime.
2. Reescrever as 14 refs com `git filter-repo` (não use BFG aqui: o filtro
   precisa ser por conteúdo, substituindo literais, não por caminho —
   apagar arquivos inteiros destruiria histórico técnico legítimo).
   Use `--replace-text` com o mapa de substituições — o mesmo
   `provas/sanitizar.py` gera os pares de forma determinística.
3. Force-push das 14 refs. Isso invalida clones e forks existentes: avisar
   quem tiver cópia antes.
4. **Contato com o GitHub Support é necessário.** Um force-push torna os
   commits antigos inalcançáveis por ref, mas o GitHub mantém os objetos
   servíveis por SHA (e em caches de PR, comparações e a API) por tempo
   indeterminado. Só o Support remove de fato. Abrir chamado listando os
   SHAs a expurgar e pedindo limpeza de caches. Referência:
   *"Removing sensitive data from a repository"* na documentação do GitHub.
5. Rotacionar o que for rotacionável. Telefones e CPFs não se rotacionam —
   assuma que já foram indexados por terceiros e trate como vazamento
   consumado, o que pode ter implicações de LGPD (notificação a titulares e
   à ANPD é decisão do controlador, não desta rodada técnica).
6. Só então revalidar o inventário: `provas/` + a varredura deste relatório
   devem voltar zero.

## Prevenção (recomendada, fora do escopo desta rodada)

- Hook de pré-commit barrando `\b55[1-9]\d{9,10}\b`, CPF, CNPJ e e-mail de
  cliente.
- Convenção para anotação de casos: usar `lead_id` (UUID interno) ou rótulos
  (`cliente A`), nunca telefone.
- `PHONE_ADMIN` da Isabela deve sair do código para secret
  (ver `baselines/isabela-agente-objecoes/v5.6.1_edge-v70/LEIA-ME.md`).
