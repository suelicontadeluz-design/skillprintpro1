# Frenet order automation — 2026-09-24

Fluxo:
1. ERP entra em Envio Correios.
2. ERP materializa snapshot de destinatário, itens, volumes e serviço.
3. Dispatcher Córtex resolve o ServiceCode usando a cotação canônica do João.
4. POST /v1/orders cria o pedido no painel Frenet sem OneClick e sem débito automático.
5. Webhooks Frenet são persistidos append-only e reconciliados no ERP.
6. Todos os volumes postados => venda Enviado => outbox Z-API envia rastreio ao cliente.

Segurança:
- Não usa /orders/oneclick.
- Outcome HTTP indeterminado nunca é reexecutado automaticamente.
- Pedido com dados incompletos falha fechado.
- Múltiplos volumes só promovem Enviado quando todos estiverem postados.
- Webhook Frenet recebe 2xx depois da persistência local; reconciliação ERP tem retry por cron.

Dependência externa ainda necessária:
- FRENET_TOKEN_ENVIO
- FRENET_PARTNER_TOKEN

O token de cotação TOKEN_FRENET não substitui o token Whitelabel de envio.
