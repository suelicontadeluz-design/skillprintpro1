# Runbook de publicação — v4.34.0

> **PUBLICADO.** Decisão humana dada em 26/08/2026: publicar pelo shim, com push em
> `skillprintpro1`. Executado às **22:30:47 UTC**.

## Publicação executada — registro

| item | valor |
|---|---|
| commit do candidato | `99e2c35d5eaa153769efc12905a2bcd75d7bf1c4` (`suelicontadeluz-design/skillprintpro1`, branch `claude/joao-modalidade-logistica-antes-do-cep`) |
| `sha256` do arquivo servido | `c8fd20f16f32c7bd851a6cddb88cfbf68d2386cac2285782a1654935b117ba70` |
| pré-flight da URL bruta | `HTTP 200`, 307.320 bytes, hash conferido **antes** do deploy |
| Edge resultante | **version 177**, `ACTIVE`, `verify_jwt=false`, `ezbr_sha256 f689a586d880128fbea32b6e4db8d8251c6eb50ef2546749c58f382d9cbc4dc6` |
| prova de boot | `POST {}` → `HTTP 400 {"ok":false,"motivo":"campos"}` — módulo de 307KB buscado, avaliado, `Deno.serve` registrado |

### Prova comportamental pós-deploy (dry-run, zero escrita)

Três execuções contra a Edge 177, todas com `_dry_run:true` e telefone sem lead — portanto
`emitirAutorizacao` devolve `null` e **nenhuma linha financeira nasce** (conferido:
`operacoes_financeiras` +0, `joao_envios` +0, `agente_noturno_estado` +0).

| entrada | `modalidade_logistica` | resposta |
|---|---|---|
| DDD 11 · "14 metros… Forma de retirada: retirada presencial. Pode já gerar a cobrança?" | `retirada` | `Para gerar a cobrança correta, me confirma só a forma de pagamento: Pix ou cartão?` — **sem CEP, sem PAC/Sedex** |
| DDD 11 · "Meu CEP é 05893-000. **Mas** a forma de retirada é retirada presencial…" | `retirada` | idem — **o CEP presente foi ignorado; `calcular_frete` não foi chamada** |
| DDD 31 · "14 metros, quanto fica com envio?" | `envio` | `…R$ 698,60… Agora me passa seu CEP com 8 dígitos para calcular o frete.` |

As duas primeiras passaram pelo `promessa_sem_conclusao_bloqueada_terminal` — exatamente o
ponto onde vivia a lista fixa `quantidade, medida, CEP ou forma de retirada?` que travou a
Carolina. O texto novo saiu correto nas duas.

## Como a Edge é publicada hoje (mecanismo real, verificado)

A Edge `agente-noturno` **não carrega o código**: ela é um *shim* de uma linha que importa o
arquivo por URL bruta, **fixado por commit**:

```ts
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/<COMMIT>/patches/<frente>/candidato/index.ts";
```

Publicar = (1) commitar o `candidato/index.ts` num repositório público alcançável por
`raw.githubusercontent.com`, (2) republicar o shim com o **SHA do commit novo**.

## Passos

1. **Conferir o hash do candidato antes de qualquer coisa**
   ```bash
   sha256sum patches/joao-modalidade-logistica-antes-do-cep/candidato/index.ts
   # deve ser: c8fd20f16f32c7bd851a6cddb88cfbf68d2386cac2285782a1654935b117ba70
   ```
2. **Reconferir que a LIVE ainda é a base deste patch.** Se a Edge tiver sido republicada por
   outra frente nesse meio-tempo, o candidato está desatualizado: rodar
   `aplicar_patch.py` de novo sobre a nova base (ele aborta sozinho se o `sha256` mudar).
3. **Publicar o arquivo** no repositório que serve o shim e anotar o SHA do commit.
4. **Republicar o shim** apontando para esse SHA, com `verify_jwt=false` preservado.
5. **Prova pós-deploy obrigatória**
   - reobter a Edge LIVE e conferir que o shim cita o commit novo;
   - conferir que a lógica servida tem `const V = 'agente-noturno-v4.34.0'`;
   - se o deploy disser sucesso e o commit/hash **não** bater → tratar como FAIL, fazer
     rollback e **não** fechar a frente.

## Canário organico obrigatório antes de fechar a frente

A frente **não fecha** por deploy. Depois de publicar, esperar turno orgânico e conferir em
`error_log`:

| evento | o que prova |
|---|---|
| `modalidade_logistica_resolvida` | a precedência de fontes rodou e com qual nível |
| `guardrail_frete_bloqueado_modalidade` | `calcular_frete` foi interceptada de verdade |
| `guardrail_cep_ou_correios_sem_frete` + `..._desfecho` | a saída foi barrada e com qual desfecho |

e em `joao_tool_guard_shadow`: linha com `enforcement_ativo=true, executada=false`.

Conferir também que **não** aparecem, no período: `pediu_preco_e_nao_recebeu` acima da média,
`pix_prometido_sem_autorizacao`, `operation_id_inventado`, `link_pagamento_nao_autorizado`.

## Rollback

Republicar o shim com o commit `d89a441b1a0d3bf2fdf6416a5bacb29117a2a01f`
(`agente-noturno-v4.33.0`, lógica `sha256 a9a4aaf1…b91b4`), `verify_jwt=false`.
Sem migração e sem estado novo — `slots.modalidade_logistica` é ignorada pela v4.33.0.
