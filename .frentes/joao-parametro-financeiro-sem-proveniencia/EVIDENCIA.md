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

---

# Suplemento de frete — classificação dos achados

Auditoria feita sobre o HEAD `a2cd284` (patch da Issue #3 original já aplicado).
Cada item foi reproduzido no código antes de qualquer edição.

| # | achado | veredito | prova mecânica |
|---|---|---|---|
| 1 | `null` destrói slot protegido | **CONFIRMADO** | o merge era `{...slotsAnteriores, ...slotsRecebidos}` e a limpeza `delete slotsNovos[k] se null` rodava **antes** da guarda P0-B; com `cep=null` o valor herdado virava `null`, era apagado, e a guarda só removia o carimbo |
| 2 | `calcular_frete` pré-seleciona Sedex | **CONFIRMADO** | `const melhor = sedex \|\| [...].sort(...)[0]` seguido de uma única `emitirAutorizacao(..., melhor.preco, ...)` |
| 3 | `envio_retirada` fora da proteção | **CONFIRMADO** | `SLOTS_PROTEGIDOS` não continha o campo, embora o schema do prompt o exponha como slot livre |
| 4 | cotação não vira estado reutilizável | **CONFIRMADO** | `freteJa` vem de `orcamentos.valor_frete`, e o único `insert` em `orcamentos` desta Edge (dentro de `gerar_pix`) não preenche frete algum — o desvio "NÃO recalcule" praticamente nunca armava |
| 5 | proveniência de saída é numérica, não semântica; bypass com lista vazia | **CONFIRMADO** | a validação era `new Set(precosAutorizados.map(p => p.centavos))` (o `tipo` só entrava no texto do retry), sob a condição `temPreco && ctx.precosAutorizados.length > 0`; e `calcular_frete` não declarava `precos_verbalizaveis`, então após cotar frete a lista ficava vazia — essa guarda não rodava, e a outra também não, porque exige `toolsUsadas.length === 0` |
| 5b | eliminar por completo a condição `length > 0` | **PARCIAL** | a condição foi neutralizada na origem (toda autorização vira fonte tipada) e uma guarda semântica que **não** depende dela passa a rodar; tornar a whitelist plana incondicional foi rejeitado com prova: `consultar_tabela_dtf` e `consultar_catalogo` devolvem preços legítimos com `financial_authorizations: []`, e passariam a ser bloqueados |
| 5c | eliminar `preco_sem_fonte_liberado` | **PARCIAL** | eliminado para afirmações de **frete e total**, que agora são fail-closed; afirmações de produto seguem sob a guarda histórica v4.24.0, cuja permissividade é deliberada e está fora do incidente |
| 6 | PAC/Sedex sem tipo semântico e sem `operation_id` próprios | **CONFIRMADO** | só `melhor` recebia autorização; as demais opções existiam apenas como texto de display |
| 7 | detector de pedido de CEP superficial | **CONFIRMADO** | `RX_PEDE_CEP = /(qual\|me passa\|me manda\|informe)[\s\S]{0,20}cep/i` não casa "Preciso do seu CEP" nem "CEP, por favor" |
| 7b | o detector dependia de `?` | **REFUTADO** | a regex nunca exigiu interrogação; o defeito real é o vocabulário curto de verbos |
| 8 | `metros: 1` e `valor_declarado: 60` fixos | **CONFIRMADO como defeito, frente separada** | o literal está na chamada e não representa o pedido (o turno já conhece `consumo_m` e o subtotal). Não corrigido aqui: o contrato da Edge `calcular-frete` — o que significam `metros` e `valor_declarado` para os Correios — não vive neste repositório, e chutar as unidades arriscaria **cobrar frete errado em produção**, que é pior que o defeito atual. Passou a ser medível: cada cotação registra `frete_parametros_fixos` com os valores enviados ao lado da composição real, e um teste pina os literais para que mudá-los seja deliberado |

## O que foi corrigido

- **P0-G** `null` em slot protegido = sem atualização. Remoção só por invalidação explícita.
- **P0-H** modalidade de envio é escolha do cliente, provada lexicalmente no inbound dele.
- **P0-I** cotação de frete é estado canônico (`slots._cotacao_frete`) com CEP, composição,
  fingerprint, opções tipadas e timestamp; PAC e Sedex com autorização própria; reuso sem
  chamada externa enquanto CEP e composição não mudam; invalidação explícita quando mudam.
- **P0-J** proveniência financeira de saída semântica e fail-closed, inclusive no retry de
  recuperação — que era a porta dos fundos da guarda.
- **P0-K** detector de pedido de CEP realista, corrigindo guarda e telemetria de uma vez;
  CEP confirmado não é pedido de novo.

## Limite conhecido da guarda semântica

A classificação usa o rótulo que **precede** o valor ("PAC R$31,96", "Total R$72,33"),
cortado na fronteira da frase, e só olha para frente quando há cópula explícita
("R$31,96 é o PAC"). É deliberado: uma janela mais larga lia "O produto fica R$40,37 e o
PAC R$31,96" como se `40,37` fosse frete e derrubava a frase correta. Valor sem rótulo fica
indeterminado e segue com as guardas históricas — esta camada nunca inventa uma acusação.
