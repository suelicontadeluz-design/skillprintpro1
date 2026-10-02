# Mapa de migração v288 → João v5

Inventário inicial derivado da composição v288. A classificação abaixo é provisória até revisão do código de cada módulo; ela existe para impedir que conhecimento útil seja descartado durante a reconstrução.

## Vai para código/invariantes determinísticas

- dry-run effect zero
- idempotência de operação UV
- autorização financeira/Pix
- output guard / human takeover
- Gate 7C e identidade de efeito
- validações de preço e proveniência
- regras de capacidade e formato quando calculáveis

## Vai para estado/projeções

- produto atual e precedência
- quantidade e grade
- CEP e modalidade logística
- preço comprometido e origem
- contexto de pedido repetido
- contexto de arte/arquivo
- status de pagamento/pedido/fiscal
- escolha e falha de frete

## Vai para skills

- qualificação
- fechamento
- negociação
- objeções
- follow-up
- educação de cliente leigo
- pricing strategy
- freight conversation
- artwork intake
- repeat order
- proposta comercial
- continuidade conversacional

## Vai para executores de efeito

- envio WhatsApp/Z-API ou canal oficial
- geração de Pix
- criação/sincronização de orçamento no ERP
- criação de pedido de frete
- sincronização de venda

O cérebro v5 não chama esses efeitos diretamente; ele produz intenção com `decision_id` e o executor autorizado decide executar, bloquear ou falhar.

## Vai para eval/regressão

Cada cicatriz que motivou um preload vira caso de teste quando houver evidência real. Prioridade inicial:

1. Recife: frete falha sem perder produto/quantidade/CEP/preço.
2. preço pedido e resposta sem número.
3. preço comprometido mudando sem mudança do cliente.
4. Pix prometido e não gerado / valor financeiro inventado.
5. pergunta repetida após slot já preenchido.
6. duas mensagens concorrentes para uma decisão.
7. fallback absurdo de retirada local para cliente remoto.

## Não migra automaticamente

Nenhum preload entra em v5 só porque existe. Antes de migrar, responder: é conhecimento, estado, regra determinística, efeito ou apenas remendo histórico? Duplicações e cicatrizes cobertas por uma invariante única são descartadas.
