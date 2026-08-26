# Runbook de publicação — v4.34.0

> **NÃO PUBLICADO ATÉ AQUI.** Produção segue na Edge **176** (`agente-noturno-v4.33.0`).
> A publicação exige decisão humana explícita.

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
