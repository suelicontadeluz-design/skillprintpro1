# P0 João — parâmetro financeiro sem proveniência

Frente: `joao-parametro-financeiro-sem-proveniencia` (P0, trilha `conversao_joao`).
Issue: #3. **Nada foi deployado, nada foi mergeado, produção intacta.**

## Baseline provado antes de editar

| item | valor |
|---|---|
| artefato | `.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts` |
| bytes | 244.094 |
| linhas | 3.215 |
| sha256 | `6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764` |

Alvo de edição: `supabase/functions/agente-noturno/index.ts` no HEAD do PR #2
(`a671529`), que é o v166 original **mais** o único hunk do manifesto já revisado
naquele PR. Diferença medida entre os dois arquivos antes deste patch: **1 hunk,
1 linha**, sha `6e2116e26d44f0d6bf901a9f563fdeec1b72d036d3c4d4271653024c1edccdf3`
— exatamente o declarado pelo PR #2. O fonte não foi reconstruído a partir de
texto e nenhum patch histórico foi reaplicado por memória.

## Causa raiz

A calculadora estava certa; a **premissa** não tinha origem.

`fn_precificar_dtf_uv_v2` recebeu `quantidade=50, largura=10, altura=21` e
devolveu `consumo_m=5.15` e `preco_total=437.75`. Os três números não vieram do
cliente: vieram da frase `Referência: arte de caneca costuma ser 10 x 21cm`, que
vivia no SYSTEM. Nenhum inbound do cliente continha `10x21`. O executor da tool
não perguntava de onde vinha o argumento, e a guarda P14 era apenas SHADOW
(`enforcement_ativo=false`).

Os outros três defeitos são da mesma família — o sistema aceitava como fato
aquilo que ele mesmo produziu, ou perdia o rastro do que já tinha consumido.

## Prova de que o replay pega o defeito

`tests/prova_do_defeito.test.mjs` roda o **mesmo roteiro** contra o artefato v166
original preservado. Lá os asserts são invertidos e os quatro defeitos aparecem:
preço de R$437,75 emitido sobre premissa inventada, `slots.arte="10x21cm"`
persistido, rajada de cortesia reabrindo o turno, ID pendente virando segundo
turno no sweep, e `calcular_frete` chamando a Edge externa sem CEP de origem.

O mesmo roteiro contra o arquivo corrigido (`tests/sentinela_incidente.test.mjs`)
passa em todos os pontos.

## Harness

Os testes carregam o **artefato real** num processo Node e trocam apenas a
fronteira de runtime: o único import remoto (supabase-js) vira um cliente em
memória, `Deno.serve(fn)` vira um handler exportado, e `Deno.env`/`fetch` são
instalados antes do import. Cada substituição é verificada por contagem — se o
artefato mudar de forma que o shim não case exatamente uma vez, o harness falha
em vez de testar outra coisa. Nenhum teste toca Supabase, Z-API ou Anthropic
reais: qualquer URL não prevista devolve 500 e fica registrada.

`npm run test:agente-noturno`
