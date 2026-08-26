# P0 João — fluxo de CEP canônico: confirmar, reutilizar, persistir com guarda

**Frente:** `joao-correcao-contexto-intencao` (a mesma; complemento absorvido, sem frente nova)
**Trilha:** `conversao_joao` · **claim:** `claude-20260826-joao-modalidade-logistica-01`
**Edge:** `agente-noturno` (projeto `ldrdtaibazplvrbwyrvx`)

> **PUBLICADO em 26/08/2026 23:11:34 UTC — Edge version 178, `ACTIVE`, `verify_jwt=false`.**
> Shim: `.../skillprintpro1/81527b80e85677d5df2c5a6b2b5e359f51bc17ce/patches/joao-cep-canonico-confirmar-reutilizar/candidato/index.ts`
> `ezbr_sha256` do shim: `cb95ef866f34a6beeb81748475122c4608ca5169ad44e80597afd61ec9c71d1c`.
> A frente **não fecha por deploy**: falta canário orgânico (ver RUNBOOK).

## Âncora

| item | valor |
|---|---|
| LIVE de partida | Edge **177**, `ACTIVE`, `verify_jwt=false`, lógica `agente-noturno-v4.34.0` |
| `sha256` da lógica viva | `c8fd20f16f32c7bd851a6cddb88cfbf68d2386cac2285782a1654935b117ba70` |
| conferência | o arquivo servido pela Edge 177 foi baixado da URL bruta e é **byte-idêntico** à base deste patch |
| candidato | `agente-noturno-v4.35.0`, `sha256 33a4ec1287c97f20bd60b9565029f1a7152b4e1a4180a273a249052a487b7311` |

`aplicar_patch.py` aborta se o `sha256` da base não for o da v4.34.0, e exige cada uma das 12
âncoras **exatamente uma vez**.

## A v4.34.0 não regride — é pré-condição, não vizinha

A ordem continua sendo **modalidade primeiro, CEP depois**. Todo o fluxo desta rodada vive
atrás de `!estadoLog.bloqueia_frete`: sob retirada, motoboy ou produto digital o cadastro
**nem chega a ser lido**. "CEP salvo no cadastro não interfere" é propriedade estrutural, não
promessa de prompt — provado por T7.b, T8.b e T9.d.

## Onde o cadastro canônico realmente vive — medido, não presumido

| medição | resultado |
|---|---|
| `public.pessoas` **deste** projeto (agente) | 1.754 linhas, **0 com CEP** — não é o cadastro |
| `public.pessoas` do **ERP** (`ynjsflvdfftcopibzxyo`) | 144 linhas, **136 com CEP** — é o cadastro |
| casamento por telefone (sufixo de 8 dígitos) | 137 sufixos, **137 distintos → zero ambiguidade hoje** |
| formato real | telefone `(11) 91857-0605`, CEP `11688-602` |
| cobertura | dos **1.525** telefones que o João atendeu em 90 dias, **64 (4,2%)** têm pessoa no ERP |
| pior grupo por 4 últimos dígitos | 7 linhas (limite do filtro: 20) |

O caminho de confirmação serve o **cliente recorrente** — que é exatamente onde ele importa.

## Ordem das fontes do CEP (só vale para ENVIO)

1. CEP informado explicitamente no pedido atual (turno + inbounds) → `cep_fonte='pedido'`
2. CEP já confirmado no estado do pedido → `estado_confirmado`
3. `pessoas.cep` do ERP → `pessoas`
4. frete já calculado / histórico → `frete_anterior` | `historico`
5. nenhum → pede **uma** vez

Mudança em relação à v4.34.0: o que o cliente **acabou de escrever** passa à frente do slot
salvo. Antes um CEP novo digitado perdia para um slot velho.

## Comportamento

| situação | o que o João faz |
|---|---|
| envio + cadastro tem CEP | **confirma antes de usar**: `"Vai ser enviado para o mesmo CEP final 3000?"` — nunca pede o CEP inteiro, nunca expõe o endereço |
| cliente confirma | reutiliza, não repergunta, calcula frete |
| cliente diz que é outro | descarta o do cadastro e pede o novo |
| envio sem cadastro | pede o CEP **uma** vez, valida 8 dígitos |
| CEP ≠ cadastro, intenção indefinida | usa no pedido e pergunta uma vez: `"Esse é seu novo CEP padrão ou é só para este pedido?"` — **não grava nada antes da resposta** |
| retirada / motoboy / digital | zero CEP, zero frete, cadastro nem lido |

Enforcement, não só prompt: `calcular_frete` é **interceptada antes da execução** quando o CEP
veio do cadastro e ainda não foi confirmado (`cep_do_cadastro_nao_confirmado`), somando-se ao
bloqueio por modalidade da v4.34.0, que segue intacto.

## Risco de sobrescrita de cadastro — e por que a escrita é escalonada

`pessoas.cep` **é campo fiscal**: `fn_montar_payload_spedy_nfe` monta o destinatário da NF-e a
partir de `pessoas` (`cep`, `logradouro`, `numero`, `bairro`, `cidade`, `estado`,
`municipio_ibge`). Trocar **só** o CEP deixa logradouro/número/bairro/cidade apontando para o
endereço **antigo** — um endereço que parece completo e está errado.

Medido: das 144 pessoas, **136 têm CEP com logradouro/cidade** e apenas **8 estão sem CEP**.

Por isso a persistência é escalonada:

| caso | ação |
|---|---|
| pessoa **sem** CEP (ou com CEP e sem endereço) | **grava** — preenche lacuna, risco zero |
| pessoa com CEP **e** endereço, cliente declarou novo padrão | **não grava.** Registra `cep_nao_persistido_motivo='endereco_fiscal_coerente_exige_atualizacao_completa'` e **abre tarefa humana** para atualizar o endereço completo no ERP |

`PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO = false` liga a sobrescrita literal. Vem desligado de
propósito: ligar significa aceitar emitir NF-e com endereço incoerente.

### Garantias de escrita (cumulativas, fail-closed em qualquer uma)
1. **exatamente uma** pessoa ativa casa com o telefone — 0 ou ≥2 não grava;
2. CEP com 8 dígitos válidos;
3. o cliente declarou **explicitamente** que é o novo padrão;
4. a guarda de coerência de endereço permite.

Nunca cria pessoa. Nunca escreve campo que não seja `cep`. Nunca roda sob retirada/motoboy.
Nunca roda em dry-run.

## Telemetria (`error_log`, evento `cep_fluxo`)

`cep_fonte` · `cep_confirmacao_solicitada` · `cep_reutilizado` · `cep_novo_informado` ·
`cep_diferente_do_cadastro` · `intencao_cep_padrao` · `cep_persistido` ·
`cep_nao_persistido_motivo` · `pessoa_id` · `cadastro_ambiguo` · `cadastro_tem_endereco`.

Eventos próprios: `guardrail_frete_com_cep_nao_confirmado`, `cep_cadastro_ambiguo`,
`cep_cadastro_filtro_recusado`, `cep_cadastro_http_erro`, `cep_persistencia_http_erro`.

## Provas

```
node ../out/testes_cep.js          # T1..T10 + 6 invariantes + 10 refutações = 68 PASS / 0 FAIL
node ../out/testes_modalidade.js   # v4.34.0 inteira contra este candidato = 73 PASS / 0 FAIL
node ../out/testes.js              # financeira v4.33.0 = 14/14 + 14/14 refutação
python3 provas/regressao_diff.py base434 candidato435   # 14 hunks, 7 linhas removidas
```

O núcleo é **recorte verbatim** do candidato (`provas/extrair.py`); só o *mundo* (HTTP do ERP
e log) é mocado, num preâmbulo delimitado. **169 asserções, zero falhas.**

### Degradação provada
- ERP fora do ar → volta a pedir o CEP, turno não quebra (`R4`);
- filtro PostgREST recusado → releitura sem filtro, feature não some em silêncio;
- dois casamentos de telefone → fail-closed, nenhum cadastro usado, nenhuma escrita (`R1`,`R2`);
- `"isso mesmo"` sem o João ter perguntado CEP **não** confirma CEP (`R6`).

## Rollback

Republicar o shim com o commit da v4.34.0 (`99e2c35d5eaa153769efc12905a2bcd75d7bf1c4`,
`sha256 c8fd20f1…7ba70`), `verify_jwt=false`. Sem migração. `slots.cep_origem` e
`slots.cep_confirmado_para_envio` são ignorados por versões anteriores.
