# FASE 2 — guarda de **saída**: fato sem lastro também não pode ser dito

**AGUARDANDO O CANÁRIO DA FASE 1. NÃO PUBLICAR AUTOMATICAMENTE.**

| item | valor |
|---|---|
| base | `agente-noturno-v4.37.0` (FASE 1), `sha256 58ecc6b5…4816` |
| candidato | `agente-noturno-v4.38.0`, `sha256 f61b5c00976224bc9e6017ab55a6b10c8889d7d02bcb1dcac2824e00848653ed` |
| diff | **3 hunks, 1 linha removida** (a versão) — todo o resto é inserção pura |

A porta da FASE 1 impede o fato de virar **estado**. `decisao.mensagem` nasce **antes**
dela, então o modelo ainda pode **falar** "os 300 adesivos" com os slots já recusados.

## Ponto

Imediatamente antes de `guardaEgressoFinanceiro`, no `INVARIANTE DE TRANSPORTE`: depois
de **todas** as reescritas (frete/CEP, preço, rendimento, hold de arte) e antes do
transporte. É o único ponto por onde passa prosa do modelo — os outros quatro transportes
carregam texto fixo, payload EMV ou `_direct_message` do operador.

## Refutação registrada

A metade do CEP **já está coberta** pela v4.34/v4.36: com o contexto orgânico do Vitor,
`bloqueia_frete=true` e a poda reduz a frase sentinela a `"Perfeito! Pagamento
confirmado."`. Não foi reimplementado. O que faltava era a mesma invenção **sem** token de
frete, que passava inteira.

## Regras (2, estreitadas por medição)

- **`quantidade_veio_de_dinheiro`** — o número afirmado nasceu **grudado** num marcador de
  dinheiro na fala do cliente. Adjacência, não a frase inteira.
- **`produto_contradiz_pedido`** — o texto nomeia família que o pedido não admite e que o
  cliente nunca nomeou. Compara com um **conjunto** de famílias (pedido multi-produto).

Sem lastro: retry explícito → revalida (preservando R$ e a guarda de frete) → poda
cirúrgica (a mesma da v4.34.0) → texto neutro. Nunca silêncio.

## Medição — 284 turnos com afirmação de pedido

| versão | disparos | falsos positivos |
|---|---|---|
| "todo número sem lastro" | **134/281 (47,7%)** | não publicável |
| final (2 regras) | **2/281 (0,7%)** | **0** |

`quantidade_contradiz_pedido` foi implementada, medida (10 disparos em 281, quase todos
legítimos) e **retirada**. O comentário no código registra o motivo.

Os 2 disparos são verdadeiros: o Vitor, e um achado novo — lead de **camisetas**
(`arte: "logo camisa.pdf"`, cliente pedindo *"acrescente mais uma camisa"*) em que o João
escreveu *"completar os 51 adesivos"*.

## Matriz — 228 asserções

FASE 2 **28/0** · v4.36 **35/0** · v4.35 **68/0** · v4.34 69/**4** (pré-existentes) ·
financeira 14/14 + 14/14 · 12 blocos financeiros byte-idênticos · candidato inteiro
**0 erros de tipo**.

## Reproduzir

```sh
sh provas/rodar.sh <caminho-do-v4.37.0.ts>
```
