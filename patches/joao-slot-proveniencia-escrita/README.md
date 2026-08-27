# FASE 1 — porta de **escrita**: slot crítico só vira fato com proveniência

**Frente:** `joao-correcao-contexto-intencao` · **Trilha:** `conversao_joao`
**Edge:** `agente-noturno` (`ldrdtaibazplvrbwyrvx`)

| item | valor |
|---|---|
| LIVE de partida | Edge **179**, `agente-noturno-v4.36.0`, `sha256 132df0ca…be68` |
| candidato | `agente-noturno-v4.37.0`, `sha256 58ecc6b53aa9bca59ccf7d0398fba9c07d2488f75b3c4818bd72bd7f7b574816` |
| diff | **4 hunks, 3 linhas removidas** |
| migração | nenhuma. Sem coluna, sem tabela, sem estado novo. |

> **Escopo desta publicação:** só a porta de **escrita**. O modelo continua podendo
> **falar** fato errado no texto — isso é **esperado** aqui e é tratado na frente
> `joao-fato-comercial-na-saida` (FASE 2), que **não** é publicada junto.

## O defeito

`agente-noturno-v4.36.0`, linha 4010:

```ts
const slotsNovos: any = { ...slotsAnteriores, ...slotsRecebidos, grade: …, estampas: … };
```

`slotsRecebidos` é `decisao.slots` — o JSON que o modelo devolveu. `produto`,
`quantidade`, `pagamento`, `envio_retirada` e `modalidade_logistica` entravam **verbatim**.
No turno de 26/08 23:54 do lead `5511994088967` isso transformou
`{}` em `produto=adesivo_uv, quantidade=300, arte=pack_evangelicos, modalidade=envio`,
num cliente que negocia **camisetas** desde abril e nunca escreveu "adesivo".

## O contrato

> O modelo **propõe**. Slot crítico que **nasce ou muda** precisa de fonte verificável.
> Sem fonte, a proposta é descartada e o que já era fato permanece.

| slot | regra |
|---|---|
| `modalidade_logistica`, `envio_retirada` | **só** o resolvedor determinístico (`estadoLog`). O modelo perde a caneta — `resolverModalidadeLogistica` lê esse slot do estado **salvo**, então um palpite viraria "fonte" no turno seguinte. |
| `produto` | **contradição, não ausência.** Sem referência anterior nem canônica, aceita (descoberta). Com referência, ela manda. |
| `quantidade` | só para valor **numérico puro**: evidência de unidade na fala, soma da grade, ou número devolvido por ferramenta/CalcMe neste turno. |
| `cep` | os 8 dígitos aparecem na fala do cliente. |
| `pagamento` | eco na fala, mídia no turno, ou ferramenta de cobrança. |
| `grade` | só bloqueia o destrutivo: trocar grade conhecida sem o cliente falar de tamanho. |

`arte` **não entra** — ver limites.

## Medição que desenhou as regras — 1.273 turnos orgânicos

Replay em shadow (`provas/replay_escrita.ts`), turnos com slots nos últimos 30 dias:

| versão da regra | turnos com recusa efetiva |
|---|---|
| evidência textual para tudo | **395 (31,0%)** — não publicável |
| + produto por contradição, arte com refinamento/mídia, quantidade de ferramenta | 218 (17,1%) |
| + `arte` fora do conjunto crítico | 99 (7,8%) |
| + quantidade só para número puro, vocabulário de fala | **82 (6,4%)** |

O que a medição corrigiu, caso a caso:

- **216 recusas de `produto`** eram **descoberta legítima no primeiro turno**: o cliente
  só escreve `"Olá! Posso ter mais informações sobre isso?"` (clique de anúncio) e o
  produto vem do **anúncio**, não da mensagem. Virou regra de contradição → 31.
- **`quantidade` também chega como texto** (`"40 coletes (20 amarelo + 20 azul)"`,
  `"37.86m + 4.56m"`, `"100-200"`). O `replace(/\D/g,'')` fabricava um número que nunca
  existiu. A regra passou a valer só para número puro.
- **`produtoNaMensagem` perde sinal legítimo do cliente por vocabulário**: `"camisas"`
  (só conhece "camiseta") e `"Eu tenho uma de caneca"` (a regra de peça própria exige
  "que tenho"/"já tenho"). Entrou `familiasFaladasPeloCliente`, que **só aceita** —
  nunca recusa —, então não enfraquece nenhuma guarda.
  `normalizarProdutoMacro` e `produtoNaMensagem` seguem **intocados**: gating de
  ferramenta (`MATRIZ_TOOL`) idêntico.
- **`envio_retirada` (80), `cep` (13), `modalidade_logistica` (7)** aparecem como recusa
  no replay mas **não são mudança de comportamento**: o `estadoLog` reescreve os três
  logo depois da porta quando há evidência, e `slots_depois` do banco já contém essa
  escrita. O replay os separa como `(det)`.

## Limites declarados (testados)

1. **`arte` não é gateada.** Gateá-la custava 39 recusas (8,8% → 6,4% ao sair), quase
   todas legítimas: arte nasce de **imagem/áudio** e de descrição em conversa, coisa que
   checagem de texto não lastreia. Como `produto`, `quantidade` e modalidade são gateados
   por conta própria, arte sozinha não altera o pedido. **Consequência assumida: no turno
   do Vitor, `pack_evangelicos` ainda persiste** (`T-ORG-3`).
2. **A mensagem ainda pode conter fato errado.** É a FASE 2.

## Matriz — 245 asserções

| suíte | resultado |
|---|---|
| FASE 1 (caso orgânico + 15 adversariais + troca legítima + não-regressão) | **45 / 0** |
| v4.36.0 envio/remetente | 35 / 0 |
| v4.35.0 CEP canônico | 68 / 0 |
| v4.34.0 modalidade | 69 / **4** (pré-existentes) |
| v4.33.0 financeira | 14/14 + 14/14 |
| `regressao_diff.py` | 12 blocos financeiros **byte-idênticos** |
| candidato inteiro | **0 erros de tipo** |

Os 4 FAIL reproduzem-se idênticos rodando a mesma suíte contra a v4.36.0 sem tocar em
nada (`T10.e`, `E9`, `E10`, `E11` — asserções de texto de prompt que envelheceram na
v4.34.0). Não são regressão desta frente.

## Reproduzir

```sh
sh provas/rodar.sh <caminho-do-v4.36.0.ts>          # matriz completa
node ../out/replay_escrita.js <dataset.json>        # replay em shadow
```

O dataset do replay **não é versionado** (este repo é público e ele contém conversa real
de cliente). `provas/replay_dataset.sql` o regenera.

## Rollback

Redeploy da v4.36.0 (Edge 179, `sha256 132df0ca…be68`). Sem migração e sem resíduo: o que
a porta recusou **não foi gravado**, então voltar não precisa desfazer nada.
