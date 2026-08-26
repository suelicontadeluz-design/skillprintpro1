# P0 João — modalidade logística resolvida **antes** do CEP

**Frente:** `joao-correcao-contexto-intencao` (retomada; nenhuma frente nova foi criada)
**Trilha:** `conversao_joao` · **claim:** `claude-20260826-joao-modalidade-logistica-01`
**Edge:** `agente-noturno` (projeto `ldrdtaibazplvrbwyrvx`)

> **PUBLICADO em 26/08/2026 22:30:47 UTC — Edge version 177, `ACTIVE`, `verify_jwt=false`.**
> Shim: `.../skillprintpro1/99e2c35d5eaa153769efc12905a2bcd75d7bf1c4/patches/joao-modalidade-logistica-antes-do-cep/candidato/index.ts`
> `ezbr_sha256` do shim: `f689a586d880128fbea32b6e4db8d8251c6eb50ef2546749c58f382d9cbc4dc6`.
> A frente **não fecha por deploy**: falta canário orgânico (ver RUNBOOK).

## Âncora na fonte EXATAMENTE viva

| item | valor |
|---|---|
| Edge LIVE | `agente-noturno` **version 176**, `ACTIVE`, `verify_jwt=false`, atualizada 2026-08-25 06:43 UTC |
| `ezbr_sha256` do shim | `2cbb2008f0cabec4b7d3e225b5f6d14a78b271cdc1d2ab9ff9207f915fccff67` |
| conteúdo do shim | `import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/d89a441b1a0d3bf2fdf6416a5bacb29117a2a01f/patches/joao-egresso-identificador-financeiro-interno/candidato/index.ts";` |
| lógica realmente executada | esse arquivo, `const V = 'agente-noturno-v4.33.0'` |
| `sha256` da lógica viva | `a9a4aaf143a1188b0308ec459cda69d6d4479ead95704ddf61664db3401b91b4` |
| candidato desta frente | `candidato/index.ts`, `const V = 'agente-noturno-v4.34.0'`, `sha256 c8fd20f16f32c7bd851a6cddb88cfbf68d2386cac2285782a1654935b117ba70` |

`agente-noturno-v4.33.0` estava documentada como **"NÃO PUBLICADO"** no README da frente
anterior, mas o shim da Edge 176 aponta para exatamente aquele commit: **ela está viva**. O
candidato daqui nasce do byte exato que roda hoje — `aplicar_patch.py` recusa rodar se o
`sha256` da base não for `a9a4aaf1…b91b4`, e cada uma das 14 âncoras tem de aparecer
**exatamente uma vez**. Não há reaproveitamento de candidato antigo.

## Defeito — confirmado, não hipótese

Lead `5511952315439` (Carolina), cliente recorrente, 26/08/2026, `fact_conversations`:

| horário UTC | quem | mensagem |
|---|---|---|
| 21:00:35 | cliente | `Retirar` |
| 21:00:58 | João | `Para gerar a cobrança correta, preciso primeiro concluir o valor do pedido. Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?` |
| 21:03:31 | João | *(a mesma frase de novo)* |
| 21:05:33 | cliente | `A quantidade é 14` / `Forma de retirada : retirada presencial` |
| 21:08:08 | João | **`Preciso do seu CEP para gerar a cobrança correta, mesmo sendo retirada.`** |
| 21:08:24 | cliente | `05893-000` |
| 21:08:38 | João | `Tá bem, mas você quer mesmo retirar aqui ou quer envio? Vi que o Sedex sai por R$11,93 ou PAC por R$18,54.` |
| 21:09:11 | cliente | `Vamos retirar` |
| 21:09:27 | João | *(de novo a lista fixa)* |
| 21:09:53 | cliente | **`Ja passei essas informações`** |
| 21:16:06 | João | *(a lista fixa pela quarta vez, já depois de "Cartão")* |

E o histórico dela é de retirada: `A retirada vai ser amanhã` (18/08), `Meu pedido está pronto
para retirada?` (19/08), `Conseguimos retirar ainda hoje ?` (19/08).

### Causa estrutural (três peças empurrando na mesma direção)

1. `SLOTS: produto -> arte -> quantidade -> envio/retirada + CEP -> orçamento` — CEP e
   modalidade eram **um slot só**.
2. `FECHAMENTO 2. CEP -> calcular_frete -> TOTAL = produto + frete` — o fechamento **abria**
   pelo CEP, então cobrança sem CEP virava caminho inexistente.
3. `blocoLocalizacao` mandava, para todo DDD ≠ 11: `ASSUMA ENVIO: peça o CEP completo, 8
   dígitos.` — um DDD, que não é endereço nem escolha, virava ordem de pedir CEP.

E nada era determinístico: `calcular_frete` executava sempre que o modelo pedisse, e nenhuma
barreira olhava a resposta. Prova da ausência: `provas/testes_modalidade_base.ts` → **9 de 9
barreiras ausentes na LIVE**.

## Correção

### Estado canônico
`modalidade_logistica ∈ { retirada, motoboy, envio, desconhecida }`, resolvido por
**precedência de fontes** (`resolverModalidadeLogistica`):

| nível | fonte | vira fato? |
|---|---|---|
| 1 | declaração explícita do cliente **neste turno** | sim |
| 2 | declaração explícita mais recente do cliente na conversa do pedido; depois `slots` já confirmado | sim |
| 3 | histórico confiável do próprio cliente (só inbound, 180 dias) | sim, **com `confirmar_com_cliente=true`** |
| 4 | localização/DDD | **não** — pista |
| 5 | nada | `desconhecida` |

### Regra dura
`retirada` / `motoboy` (e produto digital, e `desconhecida` com retirada plausível na Grande SP):
**proibido pedir CEP, proibido chamar `calcular_frete`, proibido oferecer PAC/Sedex.** CEP
existente **não** altera isso.

`envio`: CEP conhecido é **reutilizado** (slot → inbound do pedido → frete já calculado →
histórico); só se pede quando realmente falta; então o frete é calculado normalmente.

### Onde a regra é aplicada — três sítios, nenhum só de prompt
1. **Laço de ferramentas** (`chamarCerebro`): `calcular_frete` é **interceptada antes da
   execução**, no mesmo ponto em que a v4.21.9 já intercepta `calcular_dtf_metro`. Registra
   `guardrail_frete_bloqueado_modalidade` e grava em `joao_tool_guard_shadow` com
   `executada=false, enforcement_ativo=true`. Como nenhuma autorização de frete nasce,
   `compor_total`/`gerar_pix` não têm frete para somar.
2. **Validação da resposta**: com modalidade sem frete, pedido de CEP ou menção a
   PAC/Sedex/Correios derruba a mensagem. O retry só é aceito se **não apagar valor já
   calculado** (invariante de subconjunto da v4.21.6); sem retry válido, a frase ofensora é
   removida cirurgicamente; sem texto aproveitável, sai mensagem determinística **sem número
   novo**.
3. **Fallback terminal**: a lista fixa `quantidade, medida, CEP ou forma de retirada?` saiu.
   `perguntaDoQueFaltaFechamento` pergunta **só o que falta** e nunca cita CEP fora de envio.

### Roteiro corrigido
```
produto -> arte -> quantidade -> MODALIDADE LOGÍSTICA
   ├─ retirada / motoboy : fecha SEM frete e SEM CEP
   └─ envio              : reutiliza ou pede o CEP -> calcular_frete
-> orçamento -> pagamento
```
`GERAR COBRANÇA NÃO EXIGE CEP` está agora escrito em `SLOTS`, em `FECHAMENTO`, em
`REGRAS_EXTRA` e no bloco dinâmico de modalidade — e é imposto por código nos três sítios.

## Provas

```bash
tsc -p provas                       # compila
node ../out/testes_modalidade.js       # T1..T10 + 12 invariantes + 10 refutações = 73 PASS / 0 FAIL
node ../out/testes_modalidade_base.js  # ANTES: 9 de 9 barreiras ausentes na LIVE
node ../out/testes.js                  # suíte financeira v4.33.0: 14/14 + 14/14 refutação
python3 provas/regressao_diff.py base candidato   # 14 hunks, 11 linhas removidas, 12 blocos financeiros byte-idênticos
```

O núcleo de decisão exercitado pelos testes é **recorte verbatim** de `candidato/index.ts`
(`provas/extrair.py` → `provas/modalidade_gerado.ts`). Os testes não reimplementam a guarda.

## Não-regressão — por diff, não por declaração

`provas/regressao_diff.py` impõe três invariantes sobre `LIVE → candidato`:
1. **segmento perdido**: todo pedaço que sai do fonte tem de reaparecer no que entra, salvo os
   11 segmentos que esta frente altera de propósito (listados no script);
2. **termo crítico**: nenhum de 27 termos (`emitirAutorizacao`, `operation_id`, `gerar_pix`,
   `compor_total`, `mp_pix_cobrancas`, `qr_code`, `checkoutMercadoPago`,
   `guardaEgressoFinanceiro`, `fn_valor_e_legitimo`, `calcme`, `blocoArquivos`, `joao_envios`,
   `owned_inbound_ids`, `adquirirLock`, …) perde ocorrência — nem por hunk, nem no arquivo;
3. **bloco byte-idêntico**: 12 funções financeiras conferidas byte a byte
   (`guardaEgressoFinanceiro`, `idsInternosNoTexto`, `expurgarIdsInternos`,
   `emitirAutorizacao`, `envelope`, os ramos `calcular_frete`/`gerar_pix`/`compor_total` de
   `executarTool`, `checkoutMercadoPago`, `valoresDaMensagem`, `RX_HOLD_ARTE_PAGAMENTO`,
   `lerExecucoes`).

Diff total: **14 hunks, 11 linhas removidas, 424 adicionadas** — sendo 210 delas o módulo novo
e 46 o cabeçalho de versão.

## Estado novo

Só a chave `slots.modalidade_logistica` dentro do jsonb já existente de
`agente_noturno_estado`. **Sem migration, sem tabela nova, sem coluna nova.** Persistida
apenas quando a fonte é explícita (níveis 1 e 2). Versões anteriores ignoram a chave.

## Rollback

Republicar o shim apontando para o commit `d89a441b1a0d3bf2fdf6416a5bacb29117a2a01f`
(`agente-noturno-v4.33.0`, `sha256 a9a4aaf1…b91b4`), preservando `verify_jwt=false`.
Reverter a Edge restaura o comportamento anterior por completo.
