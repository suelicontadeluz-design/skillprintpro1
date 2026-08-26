# Runbook de publicação — v4.35.0

Mesmo mecanismo de shim já usado pela Edge atual: a Edge importa o candidato por URL bruta,
fixada por commit, de `suelicontadeluz-design/skillprintpro1` (público).

## Publicação executada — registro

| item | valor |
|---|---|
| commit do candidato | `81527b80e85677d5df2c5a6b2b5e359f51bc17ce` (`skillprintpro1`, branch `claude/joao-modalidade-logistica-antes-do-cep`) |
| `sha256` do arquivo servido | `33a4ec1287c97f20bd60b9565029f1a7152b4e1a4180a273a249052a487b7311` |
| pré-flight | `HTTP 200`, 327.776 bytes, hash conferido **antes** do deploy, `v4.35.0` presente |
| Edge resultante | **version 178**, `ACTIVE`, `verify_jwt=false`, `ezbr_sha256 cb95ef866f34a6beeb81748475122c4608ca5169ad44e80597afd61ec9c71d1c` |
| prova de boot | `POST {}` → `HTTP 400 {"ok":false,"motivo":"campos"}` |

### Prova comportamental pós-deploy (dry-run contra o cadastro REAL do ERP)

Dois telefones que **de fato** têm pessoa com CEP no ERP. Zero escrita: `pessoas` do ERP
**+0 linhas alteradas**, `operacoes_financeiras` +0, `agente_noturno_estado` +0, `cep_*` erros +0.

| telefone | cadastro | resposta da Edge 178 | tools |
|---|---|---|---|
| DDD 11, CEP `…7530` | `cep_origem: pessoas`, `cep_confirmado_para_envio: false` | **"Claro, pode ser! Vai ser enviado para o mesmo CEP final 7530?"** | `[]` |
| DDD 35 (MG), CEP `…0000` | `cep_origem: pessoas`, `cep_confirmado_para_envio: false` | **"Vai ser enviado para o mesmo CEP final 0000?"** | `[]` |

`tools: []` nos dois é a prova do enforcement: `calcular_frete` **não roda** antes da
confirmação, e o CEP inteiro nunca é pedido nem exposto.

## Passos

1. `sha256sum candidato/index.ts` → deve ser
   `33a4ec1287c97f20bd60b9565029f1a7152b4e1a4180a273a249052a487b7311`.
2. Reconferir que a Edge LIVE ainda serve a v4.34.0 (`c8fd20f1…7ba70`). Se outra frente
   publicou nesse meio-tempo, rodar `aplicar_patch.py` sobre a nova base — ele aborta sozinho.
3. Commitar em `skillprintpro1` e anotar o SHA.
4. **Pré-flight obrigatório antes do deploy:** `GET` da URL bruta do commit novo → `HTTP 200`,
   `sha256` conferido, `const V = 'agente-noturno-v4.35.0'` presente. Só então republicar.
5. Republicar o shim com `verify_jwt=false`.
6. Prova de boot: `POST {}` → `HTTP 400 {"ok":false,"motivo":"campos"}`.

## Canário orgânico obrigatório antes de fechar a frente

| conferir em `error_log` | prova |
|---|---|
| `cep_fluxo` | o contrato rodou; ler `cep_fonte`, `cep_persistido`, `cep_nao_persistido_motivo` |
| `guardrail_frete_com_cep_nao_confirmado` | o frete esperou a confirmação |
| `guardrail_frete_bloqueado_modalidade` | a v4.34.0 segue de pé |
| `cep_cadastro_ambiguo` / `cep_cadastro_filtro_recusado` / `cep_cadastro_http_erro` | integração com o ERP |

No ERP, conferir que `pessoas` só mudou onde a guarda permitia:

```sql
select id, nome, cep, updated_at from public.pessoas
where updated_at > '<hora do deploy>' order by updated_at desc;
```

Toda linha que aparecer aí tem de ter, no `error_log` do agente, um `cep_fluxo` com
`cep_persistido=true` e motivo `lacuna_preenchida` ou `novo_padrao_declarado`.
**Qualquer outra alteração é regressão → rollback.**

Conferir também que não subiram: `pix_prometido_sem_autorizacao`, `operation_id_inventado`,
`link_pagamento_nao_autorizado`, `codigo_pix_sem_cobranca`, `pediu_preco_e_nao_recebeu`.
Ignorar `prompt_manifesto_joao_falhou` (pré-existente, ~866 em 7 dias, outra frente).

## Rollback

Republicar o shim com `99e2c35d5eaa153769efc12905a2bcd75d7bf1c4` (v4.34.0,
`sha256 c8fd20f1…7ba70`), `verify_jwt=false`. Sem migração, sem estado a desfazer.
Se algum `pessoas.cep` tiver sido gravado indevidamente, o valor anterior está no
`cep_fluxo` correspondente (`cep_diferente_do_cadastro` traz o contexto) — a reversão é manual
e pontual, por isso a guarda recusa sobrescrever endereço coerente.
