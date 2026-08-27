# P0 João — slot crítico só vira **fato** com proveniência verificável

**Frente:** `joao-correcao-contexto-intencao` (a mesma) · **Trilha:** `conversao_joao`
**Edge:** `agente-noturno` (`ldrdtaibazplvrbwyrvx`)

| item | valor |
|---|---|
| LIVE de partida | Edge **179**, `agente-noturno-v4.36.0`, `sha256 132df0ca…be68` |
| candidato | `agente-noturno-v4.37.0`, `sha256 7298d7efeade5958fbfc127447bee324d65977ebc816e7c7e98def74255e2915` |
| diff | **5 hunks, 3 linhas removidas, 352 adicionadas** |
| migração | nenhuma. Sem coluna nova, sem tabela nova, sem estado novo. |

> A LIVE 179 é um *loader* de uma linha que importa
> `patches/joao-envio-remetente-cliente/candidato/index.ts` fixado no commit `cd9276a6`.
> O fonte real de produção é esse arquivo — não `supabase/functions/` do `skillprint-erp`,
> que está parado na v4.21.6.

## O defeito — o mesmo turno do Vitor, uma **segunda** porta

A v4.36.0 corrigiu a modalidade logística (`"posso enviar 300 agora"` deixou de ser envio).
Ela **não** tocou no que persistiu o resto. No mesmo turno de 26/08 23:54:

```
agente_noturno_estado.slots   ANTES {}
                              DEPOIS { "produto": "adesivo_uv", "quantidade": 300,
                                       "arte": "pack_evangelicos", "pagamento": "pix",
                                       "envio_retirada": "envio",
                                       "modalidade_logistica": "envio" }
```

Medido no banco, não inferido:

| fato | evidência |
|---|---|
| o cliente negocia **camiseta** desde abril | `propostas_rd` 8630 e 9931, `produto_principal = "DTF Têxtil"`, itens "Camiseta básica 100% algodão" |
| grade real de 25/08 | `M 4 / G 7 / GG 3 / G3 1 / Infantil 1` = **16 peças** |
| a palavra "adesivo" na conversa | **zero** ocorrências, em toda a história do lead |
| o único "300" digitado | `"posso enviar 300 agora ? e o restante daqui a 5 dias?"` — **dinheiro** |
| ferramentas no turno | `tools = []` |
| `produto_macro` da observação | `null` |
| `mudou_produto` | `false` |
| resposta bruta do modelo | **não persistida** — ver "o que não existe" abaixo |

### A causa raiz

`agente-noturno-v4.36.0`, linha 4010:

```ts
const slotsNovos: any = {
  ...slotsAnteriores,
  ...slotsRecebidos,     // ← saída do modelo, sem nenhuma validação
  grade: ..., estampas: ...,
};
```

`slotsRecebidos` é `decisao.slots`, isto é, o JSON que o modelo devolveu. Só `grade` e
`estampas` tinham guarda (array não-vazio) e `cep` tinha checagem de formato. `produto`,
`quantidade`, `arte`, `pagamento`, `envio_retirada` e `modalidade_logistica` entravam
**verbatim**. O defeito estrutural não é "o modelo alucinou adesivo": é que **a saída
probabilística do modelo virava fato comercial sem precisar provar de onde veio**.

Três agravantes, todos medidos:

1. **`adesivo_uv` não é vocabulário de produto.** Esse token só existe no prompt como valor
   do enum `"tema": "copo|adesivo_uv|dtf_metro|…"` (linha 1773). Vazou de `tema` para
   `slots.produto`.
2. **`produto_macro` ficou `null` por um `\b` que não casa.** `normalizarProdutoMacro` testa
   `/\buv\b/`; em `adesivo_uv` o `_` é caractere de palavra, então não há fronteira e o teste
   falha. `"adesivo uv"` (com espaço) resolveria para `dtf_uv`. A observabilidade viu `null` e
   **não reclamou**.
3. **`mudou_produto` nunca olhou os slots.** Ele é
   `!!(prodMsg && prodOrigem && prodMsg !== prodOrigem)` — compara o produto detectado na
   *mensagem* com o do *anúncio*. Com `"Feito"`, `prodMsg = null` e o flag é `false` por
   construção. Ele jamais compara `slots.produto` com o estado anterior nem com o canônico.

E o canônico **estava calculado em memória, no mesmo escopo**:
`categoriaParaProduto("evangelicos") → "camiseta"` (linha 470), já usado para montar o bloco
`[ORIGEM]` do prompt. Ninguém o usou como guarda na escrita do slot.

### Incidência — 1.425 turnos, 30 dias (`joao_slots_observacao`)

| classe | turnos |
|---|---|
| `slots.produto` preenchido com `produto_macro = null` | **82** (9 leads em `adesivo_dtf_uv`, 9 em `adesivo_uv`) |
| produto **trocado** entre turnos | **56** |
| produto **criado do nada** | **271** |
| quantidade criada | **102** |
| quantidade trocada | **22** |
| estado inteiro reconstruído a partir de `{}` | **29** |
| `modalidade_logistica` gravada com `proveniencia = "sem_sinal"` | **16** |
| **valor monetário virando quantidade** (join com a fala do cliente) | **1 — o do Vitor** |

`slots.produto` **não tem vocabulário controlado**: o modelo escreve texto livre. Amostras
reais gravadas: `"linha e fio marrom"`, `"19 polos + 18 copos"`,
`"25 camisetas baby look terra"`, `"DTF UV - caneca, copo e garrafa"`.

### O que NÃO existe (dito explicitamente, não inferido)

**A resposta bruta do modelo não foi persistida.** `anthropic_token_usage` guarda o turno
(`claude-haiku-4-5`, 12.246 in / 224 out, 23:54:17.674) mas só contadores.
`agente_decisoes_log.decisao` guarda apenas `{"mensagem": "..."}`; `contexto` tem 524 bytes
de metadados — sem histórico, sem system prompt, sem o JSON devolvido. **Não há prova
direta do que o modelo emitiu**; o que existe é o `slots_depois` da observação, que é o
resultado já persistido. A imagem do comprovante também não foi guardada — só a URL do Z-API.

Além disso o `turn_id` **diverge** entre as duas tabelas do mesmo turno
(`joao_slots_observacao` = `69e484bc…`, `agente_decisoes_log` = `24a850d8…`) e
`decision_id` da observação é `null` — as duas não são "joináveis".

## A correção — contrato estrutural, não regra para "300"

Não há literal `300` nem literal `adesivo` em nenhuma regra nova.

> **O modelo PROPÕE interpretação. Ele não decreta FATO.**
> Todo slot crítico que **nasce ou muda** num turno precisa de fonte verificável.
> Sem fonte, a proposta é descartada e o que já era fato permanece.

| slot | fonte aceita |
|---|---|
| `modalidade_logistica`, `envio_retirada` | **só** o resolvedor determinístico (`estadoLog`). O modelo perde a caneta. |
| `quantidade` | o número aparece na fala do cliente **com marcador de unidade** (`300 camisetas`, `300 unidades`, `300 peças`) ou com verbo de pedido explícito. Frase de **dinheiro** ou com o **cliente como remetente** não cria quantidade — reusa `RX_ENVIO_REMETENTE_CLIENTE` da v4.36.0. |
| `produto` | o cliente falou o valor (eco de tokens), **ou** o macro bate com o que ele nomeou na frase, **ou** com o canônico (`content_category`), **ou** com o macro anterior (refino). |
| `arte` | eco na fala do cliente. |
| `cep` | os 8 dígitos aparecem na fala do cliente. |
| `pagamento` | eco na fala do cliente **ou** ferramenta de cobrança no turno. |
| `grade` | só bloqueia o caso destrutivo: trocar grade **já conhecida** sem o cliente ter falado de tamanho na janela do pedido. |

Slot **não-crítico** segue livre — superfície mínima.

Por que `modalidade` sai de vez das mãos do modelo: `resolverModalidadeLogistica` lê
`slots.modalidade_logistica` do estado **salvo**. Um palpite do modelo viraria "fonte" no
turno seguinte — laço de realimentação da própria contaminação.

**Observabilidade** (invariante 6): `slots.produto` preenchido com `produto_macro = null`
passa a emitir `slot_produto_fora_do_vocabulario`, e tudo que a porta recusa entra em
`invalidacoes_propostas` com `aplicada: true` + `slot_critico_sem_proveniencia` no
`error_log`. A divergência deixa de ser silêncio.

## Matriz

| suíte | resultado |
|---|---|
| **v4.37.0** proveniência + guarda de saída (orgânico, 15 adversariais, matriz A–H, falsos positivos) | **64 PASS / 0 FAIL** |
| **v4.36.0** envio/remetente | **35 PASS / 0 FAIL** |
| **v4.35.0** CEP canônico | **68 PASS / 0 FAIL** |
| **v4.34.0** modalidade antes do CEP | **69 PASS / 4 FAIL** |
| **v4.33.0** financeira | **14/14 + 14/14** |
| `regressao_diff.py` | 12 blocos financeiros **byte-idênticos** |

**264 asserções.** Os **4 FAIL** de `testes_modalidade` são **pré-existentes**: reproduzem-se
idênticos rodando a mesma suíte contra a v4.36.0 sem tocar em nada (`T10.e`, `E9`, `E10`,
`E11` — asserções de texto de prompt que envelheceram na v4.34.0). Não são regressão desta
frente. A única asserção que esta frente editou é `I1`, identidade de versão do candidato,
de `v4.36.0` para `v4.37.0`.

`T-ORG-*` usa a frase orgânica **literal**, copiada de `whatsapp_message_log`, e prova os dois
lados: com a porta, `produto`, `quantidade` e `arte` do Vitor não viram estado, e `pagamento:
"pix"` — que o cliente **escreveu** — continua valendo.

### Matriz adversarial dinheiro × quantidade

| fala do cliente | vira quantidade? |
|---|---|
| `posso enviar 300 agora ? e o restante daqui a 5 dias?` | não |
| `posso enviar 500 agora` · `vou mandar 200 e o restante amanhã` · `já enviei 300` | não |
| `entrada de 300` · `paguei 300` · `transferi 300 agora` · `são 300 reais` | não |
| `quero 300 camisetas` · `quero 300 adesivos` · `300 unidades` · `o pedido é de 300 peças` | **sim** |
| `quero 300 camisetas, pago no pix` | **sim** (unidade decide sobre dinheiro) |
| `na verdade não quero mais camiseta, quero adesivo UV` | troca de produto **aceita** |


---

# Segunda metade do contrato — o fato tambem nao pode ser **dito**

A porta acima impede o fato de virar **estado**. Mas `decisao.mensagem` nasce **antes**
dela: o modelo ainda podia **falar** "os 300 adesivos" mesmo com os slots recusados.

## Caminho da mensagem ate o envio

Cinco pontos de transporte no arquivo. So **um** carrega prosa do modelo:

| linha | o que sai | origem | vetor? |
|---|---|---|---|
| 2690 | cortesia / despedida | string fixa no codigo | nao |
| **4409** | **`resposta`** | **`decisao.mensagem` do modelo** | **sim — o unico** |
| 4424 | codigo Pix | payload EMV do provider | nao |
| 4524 | `_direct_message` | corpo HTTP (operador/sistema) | nao |
| 4530 | codigo Pix do DM | payload EMV | nao |

## Guardas de texto que ja existiam

| guarda | o que valida | linha |
|---|---|---|
| `precosAutorizados` | valor em R$ nao autorizado por ferramenta | 3455 |
| `RX_AFIRMA_RENDIMENTO` | "quantos cabem" divergente da tool | 3736 |
| `guardrail_negou_midia` | negar midia recebida | 3450 |
| **`RX_SAIDA_TERMO_FRETE` (v4.34.0)** | **pedir CEP / oferecer PAC-Sedex sem frete** | **3937** |
| `guardaEgressoFinanceiro` | identificador interno vazando | 4357 |

Faltava exatamente uma: **produto e quantidade**.

### Refutacao — a metade do CEP ja estava coberta

Rodei o modulo de modalidade **extraido do candidato** contra o contexto organico do Vitor:

```
modalidade     = desconhecida        bloqueia_frete = true
guarda v4.34 dispara? = true
podado         = "Perfeito! Pagamento confirmado."
```

Ou seja: **na LIVE v4.36 de hoje**, a frase sentinela ja seria podada exatamente para a
resposta segura. Nao reimplementei isso. O que **nao** estava coberto e a mesma invencao
sem token de frete:

```
"Perfeito! Pagamento confirmado. Vou separar os 300 adesivos e ja te aviso."
guarda v4.34 dispara? = false          <-- "300 adesivos" ia para o cliente
```

## Ponto escolhido

Imediatamente **antes** de `guardaEgressoFinanceiro`, no comentario `INVARIANTE DE
TRANSPORTE`. E o unico ponto depois de **todas** as reescritas (frete/CEP, preco,
rendimento, hold de arte) e antes do transporte — cobertura maxima, superficie minima. O
invariante documentado ("nada escreve em `resposta` depois da guarda financeira") continua
valendo, porque a nova guarda escreve **antes** dela.

## Contrato de fato verificado

`verifiedCommercialState` **e o proprio `slotsNovos`** — o snapshot que a porta de escrita
ja aprovou (estado anterior + slots com proveniencia + escrita deterministica do
`estadoLog`). Nao ha segunda logica de proveniencia, e **`decisao.slots` cru nao entra**.
Somam-se a ele as fontes que a guarda tambem aceita: numeros das ferramentas
(`ctx.rendimentosAutorizados`, `rendimentosAuxiliares`), quantidades e descricoes dos itens
do **orcamento CalcMe** (`calcmeVigente.itens`), e a grade (total **e** cada tamanho).

Uma "afirmacao de pedido" e um numero colado num substantivo de mercadoria
("300 adesivos", "16 camisetas"). Mencao solta de produto **nao** conta — o Joao precisa
poder oferecer catalogo.

Sem lastro: **retry explicito** -> revalida (incluindo preservacao de valor em R$ e a
guarda de frete) -> **poda cirurgica** (a mesma `removerSentencasComTermo` da v4.34.0) ->
**texto neutro**. Nunca silencio.

## Replay organico — foi a medicao que desenhou a regra

1.431 turnos / 30 dias; 284 com afirmacao de pedido no texto (o resto a guarda nem olha).

| versao da regra | disparos | falsos positivos |
|---|---|---|
| "todo numero sem lastro" | **134 / 281 (47,7%)** | tabela por metro, KIT do catalogo, grade por tamanho, `116,6` lido como `6` |
| + poda de tabela, macro-set, CalcMe | 5 | 4 |
| + adjacencia de dinheiro | 2 | 1 (audio: "19 blusas e **18** kits") |
| **final (2 regras)** | **2 / 281 (0,7%)** | **0** |

A versao ampla **nao era publicavel**. Sobraram as duas regras que a medicao sustentou:

- **`quantidade_veio_de_dinheiro`** — o numero afirmado nasceu **grudado** num marcador de
  dinheiro na fala do cliente (`R$`, entrada, sinal, paguei, ou o cliente como remetente).
  Adjacencia, nao a frase inteira: a frase inteira acusava "18" em *"o valor pedido para dar
  a entrada, sobre a questao do 19 blusas e 18 kits"* — porque "kits" nao esta no lexico.
- **`produto_contradiz_pedido`** — o texto nomeia familia de produto que o pedido nao
  admite, e o cliente nunca a nomeou. Compara com um **conjunto** de familias, nao uma so:
  pedido multi-produto ("19 polos + 18 copos") acusava contradicao falsa.

### Regra implementada, medida e RETIRADA

`quantidade_contradiz_pedido` (numero diferente do pedido conhecido) disparou **10 vezes em
281** e quase todas eram legitimas: o cliente revisa no meio da conversa, o Joao oferece
completar o filme ("cabem mais 2 adesivos"), a ferramenta calcula rendimento. Estado
verificado fica **velho** em relacao ao turno vivo. Foi removida. O comentario no codigo
registra o motivo para ninguem reintroduzi-la sem medir.

### Os 2 disparos — ambos verdadeiros

1. **Vitor** (`5511994088967`, 26/08): `"frete dos 300 adesivos"` -> `quantidade_veio_de_dinheiro`.
2. **Achado novo** (`06364000`, 24/08): pedido de **camisetas** (`arte: "logo camisa.pdf"`,
   grade basica, cliente pedindo *"acrescente mais uma camisa tamanho M"*) e o Joao escreveu
   `"completar os 51 adesivos + 1 que voce acrescentou hoje"` -> `produto_contradiz_pedido`.
   **Segunda instancia organica da mesma familia**, em outro lead e outro dia.

## Limites declarados desta metade

1. **Quantidade que apenas diverge nao e bloqueada** (testado em `B3`). Numero legitimo vem
   de fonte que a guarda nao enxerga. Quem impede o numero de virar **estado** e a porta de
   escrita — as duas metades cobrem coisas diferentes.
2. **`produtoNaMensagem` devolve `null` para plural** (`\bcamiseta\b` nao casa "camisetas").
   A guarda usa `macrosDoTexto`, extrator proprio; `normalizarProdutoMacro` e `MATRIZ_TOOL`
   ficam **intocados**, entao o gating de ferramenta nao muda.
3. **Vocabulario de mercadoria e finito** ("blusa", "kit", "bone" estao fora). Por isso a
   regra de dinheiro exige adjacencia: nao depende do lexico crescer.
4. O replay nao enxerga `ctx` (ferramentas/CalcMe do turno), entao **superestima** disparos;
   a guarda em producao recebe esses numeros.

## Reproduzir

```sh
sh provas/rodar.sh <caminho-do-v4.36.0.ts>
```

Requer `python3`, `tsc` e `node`. O `aplicar_patch.py` **exige** que a base tenha
`sha256 132df0ca…be68`; qualquer outra base aborta.

## Rollback

Redeploy da v4.36.0 (Edge 179, `sha256 132df0ca…be68`). Sem migração, sem estado novo:
o rollback é imediato e não deixa resíduo. O que a porta recusou **não foi gravado**, então
voltar não precisa desfazer nada.

## Limites conhecidos (não corrigidos aqui, de propósito)

1. **A porta protege a persistência, não a redação.** As leituras de `decisao.slots` nas
   linhas 3058/3845/3857/3950 acontecem **antes** do merge e ainda usam os slots crus para
   decidir o que perguntar no próprio turno. A frase `"os 300 adesivos"` do Vitor veio de
   `decisao.mensagem`, que é texto do modelo — nenhuma guarda de slot a impediria.
2. **`normalizarProdutoMacro` continua com 4 macros** e continua devolvendo `null` para
   `"jaleco"`, `"polo"`, `"panos_de_prato"`. Mudá-lo mexeria em `MATRIZ_TOOL` e no
   *gating* de ferramenta — outra frente. Aqui o `null` deixou de ser **silencioso**.
3. **`turn_id` divergente** entre `joao_slots_observacao` e `agente_decisoes_log` não foi
   unificado: é mudança de contrato de telemetria, com canário próprio.
