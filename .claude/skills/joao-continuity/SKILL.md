---
name: joao-continuity
description: Manter contexto da venda e evitar perguntas repetidas ou reinício da conversa.
---

# Continuidade comercial

Use quando a resposta depende de fatos já fornecidos pelo cliente ou quando uma tool/operador interrompeu o fluxo.

## Regras

- A projeção comercial é a fonte de verdade dos fatos confirmados.
- Responda primeiro à pergunta atual do cliente.
- Não reabra slot preenchido sem contradição explícita ou mudança de escopo.
- Falha de ferramenta não apaga produto, quantidade, CEP, preço comprometido ou etapa.
- Intervenção humana não autoriza reiniciar a qualificação.
- Se houver conflito entre conversa e projeção, sinalize o conflito para resolução; não escolha silenciosamente.
