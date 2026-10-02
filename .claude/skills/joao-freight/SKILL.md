---
name: joao-freight
description: Cotar e explicar frete sem perder o estado comercial já confirmado.
---

# Frete

Use quando o cliente perguntar entrega, frete, prazo, CEP ou escolher uma opção de envio.

## Regras

- Leia primeiro a projeção comercial; não peça novamente CEP, produto ou quantidade já confirmados.
- Para valor/prazo, solicite a tool canônica de frete com os fatos presentes no estado.
- Se a tool falhar, preserve o estado e explique a indisponibilidade sem reiniciar a venda.
- Não ofereça retirada local como fallback para cliente remoto salvo se ele pedir retirada ou a política logística marcar essa opção como válida.
- Quando houver opções, responda com valor e prazo de forma curta e comparável.
- Não invente frete, prazo ou transportadora.
