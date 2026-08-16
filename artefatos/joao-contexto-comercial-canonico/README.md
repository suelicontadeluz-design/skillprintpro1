# Cofre do candidato v163 — `agente-noturno`

> **ISTO É UM COFRE, NÃO UMA PUBLICAÇÃO.**
> Este commit **não** altera a versão ACTIVE, **não** significa aprovação do Gate 1,
> **não** autoriza merge e **não** autoriza o Gate 2.

Frente: `joao-contexto-comercial-canonico` · trilha `conversao_joao` · Supabase `ldrdtaibazplvrbwyrvx`

## O que está aqui

| arquivo | o que é |
|---|---|
| `agente_noturno_v163.ts` | candidato completo, byte a byte, **229.212 bytes** |
| `camada3_v163.diff` | diff contra o ACTIVE v162 — 5 hunks, +68 / −2 |

## Identidade exigida

O artefato só vale como preservação se o SHA bater **exatamente**:

```
sha256  4119a8a4d465e3f01367ff926a5854df12acec228471afbba16cd81b19cbdce7
```

Conferir com:

```bash
sha256sum artefatos/joao-contexto-comercial-canonico/agente_noturno_v163.ts
git show HEAD:artefatos/joao-contexto-comercial-canonico/agente_noturno_v163.ts | sha256sum
```

Se divergir, **não vale como preservação** e o Gate 1 continua preso ao original.

Âncora do ACTIVE de origem: `agente-noturno` version **162**, 223.073 caracteres,
sha256 `1e3f74d72fa1392f610049fe4e29aadad1916cb99cc7ff3d27f1a011a2b7d7f4`.

Candidato anterior `ad422655…` está **MORTO** (era a versão sem a trava dura sob `fail_closed`).

## Gate 1 — a única coisa autorizada a seguir

```bash
deno check artefatos/joao-contexto-comercial-canonico/agente_noturno_v163.ts
```

- **PASS** → autoriza *somente*: deploy com `joao_contexto_canonico_ativo = false`,
  confirmar versão ACTIVE, confirmar identidade do artefato publicado, **parar**.
- **FAIL** → o `4119a8a4` morre. Corrigir, gerar candidato **novo** com SHA **novo**,
  e o Gate 1 recomeça sobre o arquivo novo. Nunca publicar o `4119a8a4` mesmo assim.

**Gate 2** (ligar o kill switch e rodar canários) é decisão separada e **não está autorizado**.

## O que a v163 muda

Introduz o gate comercial canônico: antes de montar o briefing, a edge chama
`fn_contexto_comercial_do_lead` e o campo `comportamento` funciona como gate determinístico
(`usar_deal_vigente` | `iniciar_negociacao_nova` | `fail_closed`).

O kill switch `sistema_config.joao_contexto_canonico_ativo` está **FALSE**: com ele desligado,
o comportamento é idêntico ao da v162. Publicar é ato de infraestrutura, não de mudança.

### Limitação conhecida, assumida por decisão

Sob `fail_closed`, `execucoes.cobrancaPendente` continua alimentando ramos determinísticos de código
(reenvio de Pix, cortesia pós-cobrança) que o gate **não** cobre — existe uma identidade paralela.
Não foi corrigido para não inflar os 5 hunks.

**Consequência vinculante:** no canário de `unknown` é obrigatório provar que esses ramos não produzem
efeito externo. Se produzirem, o kill switch **não** abre e a cirurgia no fluxo de Pix passa a ser
etapa obrigatória.

## Não empilhar

Não incorporar aqui o patch de preço (`joao-preco-guarda-cega-produto`), a metade edge de
`joao-silencio-vazamento-quente`, nem o PATCH 2 de `voz-natural-joao-tts`. Todos tocam o mesmo arquivo
e todos aguardam este Gate 1. Empilhar destrói a identidade do artefato e mistura gates.
