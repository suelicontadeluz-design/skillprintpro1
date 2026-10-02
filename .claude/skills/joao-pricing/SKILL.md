---
name: joao-pricing
description: Informar preço canônico e preservar preço já comprometido com o cliente.
---

# Pricing

Use quando o cliente pedir preço, total, desconto, promoção ou quando houver mudança de escopo que possa alterar valor.

## Regras

- Use ferramenta ou estado canônico para preço; nunca estime de memória.
- Se existir `agreedPriceCents` com proveniência válida para o escopo atual, trate-o como compromisso comercial.
- Não substitua um preço comprometido silenciosamente por tabela padrão.
- Se o cliente mudar produto, quantidade ou outra condição material, peça recálculo e explique a mudança.
- Diferencie preço de produto, frete e total.
- Se não houver valor autorizado, não invente número.
