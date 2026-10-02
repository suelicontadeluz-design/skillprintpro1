# Cofre de candidatos do `agente-noturno`

> **ISTO É UM COFRE, NÃO UMA PUBLICAÇÃO.**
> Nenhum commit aqui altera a versão ACTIVE, aprova publicação, autoriza merge ou autoriza o **Gate 2**.

Supabase `ldrdtaibazplvrbwyrvx` · trilha `conversao_joao`

## Linhagem

| candidato | sha256 | bytes | Gate 1 (`deno check`) | estado |
|---|---|---|---|---|
| `agente_noturno_v163.ts` | `4119a8a4…bdce7` | 229.212 | 3 erros — **idênticos ao baseline v162** | **inconclusivo por defeito herdado; demonstrado não-regressivo.** NÃO rejeitado |
| `agente_noturno_v164.ts` | `2662a218…e880` | 229.929 | **0 erros, exit 0** | candidato corrente |

Baseline de comparação: `agente-noturno` **v162 ACTIVE**, sha256 `1e3f74d7…d7f4` — `deno check` retorna
**3 erros** `TS2304 Cannot find name 'produtoSlot'`. O defeito **já está em produção**.

### Por que o v163 não é um FAIL

Rodar o `deno check` no **v162 ACTIVE** produz exatamente os mesmos 3 erros, nas mesmas construções.
O v163 não introduz nenhum erro novo — o deslocamento de linhas corresponde ao bloco de helpers que ele insere.
Matá-lo não corrigiria nada: qualquer candidato gerado do mesmo ACTIVE herdaria os mesmos 3 erros.

Semântica registrada: **Gate 1 inconclusivo por defeito herdado do baseline; candidato demonstrado
não-regressivo.** Preservado como artefato histórico.

## Conteúdo

| arquivo | o que é |
|---|---|
| `agente_noturno_v163.ts` | candidato camada 3 (gate comercial canônico), byte a byte |
| `camada3_v163.diff` | v162 → v163 · 5 hunks, +68 / −2 |
| `agente_noturno_v164.ts` | v163 + correção de escopo do `produtoSlot` |
| `delta_v163_para_v164.diff` | v163 → v164 · **1 hunk, +7 / −0** |

## Dupla proveniência do v164 — leia antes de publicar

O v164 é **um arquivo com mudanças de duas frentes**, porque a edge é um arquivo só:

- **camada 3** (`joao-contexto-comercial-canonico`) — herdada do v163, kill switch `joao_contexto_canonico_ativo` em `false`
- **correção do `produtoSlot`** (`joao-silencio-vazamento-quente`) — o delta `+7/−0` acima

O delta isolado existe justamente para tornar essa mistura auditável linha a linha.

### O que a correção do `produtoSlot` conserta

No v162 ACTIVE, o bloco de **promessa sem conclusão** usa `produtoSlot` antes de ele existir naquele escopo
(declarado ~93 linhas adiante, em bloco irmão). Não é TDZ: o nome não existe ali, então a avaliação lança
`ReferenceError`.

Provado em produção, 2 ocorrências em 24h (15/08 23:29, 16/08 00:36):

```
ReferenceError: produtoSlot is not defined
    at atenderClienteInterno (index.ts:4073:12)
    at async atenderCliente (index.ts:2621:12)
```

Esse bloco existe para **impedir** silêncio e, ao quebrar, **produz** silêncio. Até o fallback genérico era
inalcançável, porque o motor precisa avaliar as três comparações para chegar ao `else`.

## Verificar

```bash
sha256sum artefatos/joao-contexto-comercial-canonico/agente_noturno_v164.ts
# 2662a2186bfdcdcd69b7c2c8fd1b3ed6f448bd6b65de500833fed0693941e880

deno check artefatos/joao-contexto-comercial-canonico/agente_noturno_v164.ts   # esperado: exit 0
```

O `deno check` desta sessão rodou com `esm.sh` bloqueado pelo proxy; o import foi redirecionado por import map
para `npm:@supabase/supabase-js@2` — mesma biblioteca, **fonte do candidato inalterado**. Isso valida o
TypeScript do candidato, não o build específico do `esm.sh`.

## O que ainda NÃO está autorizado

- Publicar o v164 — decisão pendente, e quando ocorrer é com `joao_contexto_canonico_ativo = false`.
- **Gate 2**: ligar o kill switch, rodar canários ou fabricar evento orgânico. **Proibido.**
- Empilhar aqui o patch de preço (`joao-preco-guarda-cega-produto`), a metade edge restante de
  `joao-silencio-vazamento-quente` ou o PATCH 2 de `voz-natural-joao-tts`.

### Limitação conhecida que sobrevive no v164

Sob `fail_closed`, `execucoes.cobrancaPendente` continua alimentando ramos determinísticos (reenvio de Pix,
cortesia pós-cobrança) que o gate não cobre. No canário de `unknown` é obrigatório provar que esses ramos não
produzem efeito externo; se produzirem, o kill switch não abre e a cirurgia no fluxo de Pix vira obrigatória.
