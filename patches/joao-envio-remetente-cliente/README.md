# P0 João — "enviar" com o **cliente** como remetente não é modalidade logística

**Frente:** `joao-correcao-contexto-intencao` (a mesma) · **Trilha:** `conversao_joao`
**Edge:** `agente-noturno` (`ldrdtaibazplvrbwyrvx`)

| item | valor |
|---|---|
| LIVE de partida | Edge **178**, `agente-noturno-v4.35.0`, `sha256 33a4ec12…b7311` |
| candidato | `agente-noturno-v4.36.0`, `sha256 132df0ca90d39dfd83bf8116f432babaef09b2dbe9134e8a336fa0d8c132be68` |
| diff | **3 hunks, 3 linhas removidas, 46 adicionadas** |

## O defeito — encontrado pelo canário orgânico da própria v4.35.0

Lead `5511994088967` (Vitor, **DDD 11 / Grande SP**), 26/08 às 12:04:

> `posso enviar 300 agora ? e o restante daqui a 5 dias?`

Isso é o cliente falando de **dinheiro** — pagar 300 agora, o resto em 5 dias. `RX_LOG_ENVIO`
casou o verbo `enviar` e declarou `modalidade_logistica = envio` no nível 2. Com isso o
bloqueio de Grande SP da v4.34.0 caiu, e às 23:54 o João escreveu:

> `Pagamento confirmado. Qual é o seu CEP para a gente calcular o frete dos 300 adesivos?`

Pediu CEP a um cliente da Grande SP **sem nunca ter perguntado retirada ou envio** — a mesma
família de defeito do caso Carolina, entrando por outra porta.

### A causa nasceu na v4.34.0. Rollback não corrige.

`RX_LOG_ENVIO` já era assim quando foi criada. O que a v4.35.0 acrescentou foi a **telemetria
que tornou o defeito visível**: o evento `modalidade_logistica_resolvida` gravou
`evidencia: "posso enviar 300 agora"` ao lado de `proveniencia: declaracao_recente_do_cliente`.
Sem esse campo, o erro seria invisível. Voltar para a v4.34.0 traria o mesmo bug **sem** o
instrumento que o revela — por isso a correção é para a frente.

## A correção — o verbo sozinho deixa de decidir

| nível | sinal | decide? |
|---|---|---|
| **FORTE** | `correios`, `sedex`, `pac`, `transportadora`, `postagem`, `postar`, `frete` | sim, sempre — nomeia o meio de transporte |
| **VERBO** | `enviar/envio/…`, `mandar pelo/por/via/pra/para`, `entregar em casa`, `receber em casa` | só se passar nos dois filtros abaixo |

Filtros do nível VERBO:
- **remetente cliente** — `posso/vou/eu/consigo/acabei de/estou/já … envi|mand` → não é modalidade;
- **objeto não-logístico** — `arquivo, arte, foto, print, comprovante, pix, pagamento, dinheiro, valor, depósito, número solto` → não é modalidade.

## Matriz

| suíte | resultado |
|---|---|
| **v4.36.0** (caso orgânico + 10 continua-envio + 8 deixa-de-ser + 8 modalidade + 3 invariantes) | **35 PASS / 0 FAIL** |
| **v4.35.0** CEP canônico | **68 PASS / 0 FAIL** |
| **v4.34.0** modalidade antes do CEP | **73 PASS / 0 FAIL** |
| **v4.33.0** financeira | **14/14 + 14/14** |
| diff | 3 hunks, 12 blocos financeiros byte-idênticos |

**204 asserções, zero falhas.** `T-ORG` usa a frase orgânica literal, copiada de
`fact_conversations`, e prova os dois lados: a v4.35.0 tinha o verbo solto como sinal; a
v4.36.0 volta a `desconhecida`, bloqueia o frete e não pede CEP.

## Rollback

Shim → commit da v4.35.0 (`81527b80e85677d5df2c5a6b2b5e359f51bc17ce`, `sha256 33a4ec12…b7311`),
`verify_jwt=false`. Mas note: a v4.35.0 tem o defeito acima.
