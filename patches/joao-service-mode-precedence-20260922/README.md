# P0 João — precedência de modo de serviço (22/09/2026)

Caso orgânico sentinela: `5511993546694`.

## Falha provada

O estado estava `produto=camiseta` com `_produto_fonte=mensagem_cliente`. No turno `36e34d1b-e313-486a-b8a7-61154d4267f7`, o modelo devolveu `produto=dtf_textil` e a persistência aceitou `_produto_fonte=modelo / modelo_slot`. Em seguida `calcular_dtf_por_arte` passou a ser considerado compatível e o cliente recebeu preço de DTF avulso em vez de preço de camiseta.

## Regra

Produto físico e técnica não são a mesma decisão.

- `FINISHED_PERSONALIZED`: cliente compra a peça pronta/personalizada.
- `TRANSFER_ONLY`: cliente compra somente impressão/transfer para aplicar numa peça que já possui.
- Menção curta a `DTF têxtil` depois de `FINISHED_PERSONALIZED` é técnica, não troca de modo.
- Troca de modo exige evidência forte do próprio cliente.

## Enforcement

Em `FINISHED_PERSONALIZED`:
- produto macro canônico = `camiseta`;
- `consultar_tabela_dtf`, `calcular_dtf_por_arte` e `calcular_dtf_metro` são removidas antes da inferência;
- `orcar_camisetas` e `consultar_modelos` continuam disponíveis;
- slot final contraditório é corrigido;
- preço de DTF produzido sob modo camiseta é descartado fail-closed, nunca renomeado como preço de camiseta.

Troca explícita para transfer-only continua permitida.

## Replay

A sequência real `DTF -> pergunta preço de cada camiseta -> camiseta -> 28 P/M -> FTP têxtil -> Dft têxtil` deve terminar em `FINISHED_PERSONALIZED / camiseta`, sem cálculo/preço de DTF avulso.

Regressões: finished -> transfer explícito; DTF fresco; transfer -> finished explícito.
