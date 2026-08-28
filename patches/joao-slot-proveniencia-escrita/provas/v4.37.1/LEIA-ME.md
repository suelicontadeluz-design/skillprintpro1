# Replay dry-run — defeito `adesivo_dtf_uv` (lead 5553984545499)

Roda com `./run.sh`. Precisa de Node >= 22 (`--experimental-strip-types`).
Nao acessa rede, nao chama modelo, nao envia mensagem: recorta as funcoes puras
do proprio `index.ts` e as executa com os dados reais da conversa.

## O defeito

`normalizarProdutoMacro` reconhece o token UV por `/\buv\b/`. Em JavaScript `_`
e caractere de palavra, entao **nao existe fronteira `\b` entre `_` e `uv`**:

```js
/\buv\b/.test('adesivo_dtf_uv')   // false
```

O modelo escreveu `slots.produto = "adesivo_dtf_uv"` nos 7 turnos do lead. O
macro saiu `null` em todos e o produto desapareceu das guardas.

## O que cada script prova

| script | prova |
|---|---|
| `regressao-produto.mjs` | Roda o normalizador antes/depois sobre **todo** valor de `slots.produto` ja emitido em producao (147 distintos, 3.573 ocorrencias). Zero reclassificacao; 9 aliases saem de `null` para `dtf_uv`. |
| `regressao-quantidade.mjs` | Roda a porta de proveniencia sobre **todas** as recusas reais de `quantidade_sem_evidencia_de_unidade` ja registradas em `error_log`, mais adversarios derivados da razao de ser da guarda. So a recusa-alvo muda de veredito. |
| `replay-lead.mjs` | Replay dos 3 turnos reais do lead, com estado encadeado turno a turno. |
| `prova-preco.mjs` | Mostra a ferramenta de preco do UV saindo de `produto_indeterminado_fail_open` para `compativel`. |

## Procedencia dos dados

Nada aqui foi inventado. Origem de cada fixture, no projeto `ldrdtaibazplvrbwyrvx`:

- `corpus-produto.json` — `joao_slots_observacao.slots_antes/slots_depois->>'produto'`
  e `agente_noturno_estado.slots->>'produto'`, agregados por valor.
- `turnos-5553984545499.json` — `fact_conversations` (falas), `joao_slots_observacao`
  (slots antes/depois e `turn_id`), `error_log` (ferramentas do turno e o JSON cru
  do modelo em `modelo_sem_resposta_valida`), `leads_marketing.content_category`
  (`impressao_dtf_textil`, de onde sai `prodOrigem = dtf_textil`).
- Casos de `regressao-quantidade.mjs` — `error_log.payload->rejeitados` cruzado com
  `fact_conversations` para recuperar a fala do cliente e a ultima mensagem do Joao.

## O que este replay NAO prova

O par de mensagens identicas que o cliente recebeu as 20:36 e as 21:04
("Qual informacao voce precisa agora: valor, prazo, pagamento ou entrega?")
saiu do fallback terminal, disparado por `promessa_sem_conclusao_bloqueada_terminal`
depois de o modelo se enrolar com 50x75 em cm x mm. Naquele bloco o roteamento
testa `!produtoSlot`, o valor **cru** do slot — que e verdadeiro tanto com
`adesivo_dtf_uv` quanto com `dtf_uv`. Corrigir o normalizador nao muda esse
caminho. Esta correcao devolve identidade de produto as guardas; ela nao e a
correcao do fallback terminal.
