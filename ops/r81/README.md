# R81 — O elo que faltava: necessidade → capacidade

**Data:** 2026-08-27 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** SHADOW / zero efeito externo.
Nenhum executor acionado, nenhum agente criado, nenhuma capability criada automaticamente,
nenhuma edge publicada, nenhum cron ou frente alterado.

**Regra central:** o router responde "quem sabe fazer isso?". Antes disso o Cérebro precisa
provar "o que é esse *isso*?".

---

## Vereditos

```
TRADUTOR_SHADOW_VALIDADO
PIPELINE NECESSIDADE → CAPACIDADE → EXECUTOR em SHADOW end-to-end: SIM
```

O gate da §17 passa nos 6 itens — **e o número que sustenta isso é
`FALSO_POSITIVO_DE_TRADUCAO = 0` contra uma régua de 14 pares auditados**, com o falso positivo
da R80 corrigido na sentinela.

Mas a leitura honesta vem junto: o tradutor passa **abstendo-se em 51,5% dos casos, e em 84,6%
dos casos que nunca viu**. Ele é seguro porque cala, não porque sabe.

---

## §8 — A correção mais séria: a R80 contou por palavra-chave

A R80 afirmou que **21 frentes estão travadas em `PUBLICAR_EDGE_FUNCTION`**. Esse número veio de
`proximo_passo ilike '%publicar%'`. É exatamente a ponte lexical que a §3 proíbe e que a R63 já
tinha provado defeituosa — e fui eu quem a fez.

Lendo as 21 uma a uma:

| a necessidade imediata é publicar edge? | n | exemplos |
|---|---|---|
| **sim** | **5** | `joao-egresso`, `joao-parametro-financeiro`, `ricardo-saude-observabilidade`, `ricardo-encerramento-semantica`, `microloops-23-agentes` |
| condicional | 1 | `julia-mensagem-duplicada` — o texto diz "publicar **ou descartar** formalmente": é decisão antes de ação |
| **não — outra capacidade vem antes** | 9 | `julia-briefing-multiartes` (reconciliar hash), `julia-pagamento-grounded` (colisão de baseline), `edges-fonte-canonica-versionada` (definir regra de hash), `claim-recusa` (rodar script), `julia-pivot-produto-errado` (medir denominador), `pipeline-memoria-clientes` (migrations), `patricia-governanca-autonoma` (ler fonte), `agente-logistica-criar-etiqueta` (cadastrar segredos), `isabela-remover-aprovacao` (não acionável) |
| **não — nem é edge** | 4 | `erp-raio-x-backend` ("publicar via OPR oficial" = ordem de produção no ERP), `gustavo-dora-experimento-shadow` ("publicar na `espera_observavel_whitelist`" = INSERT), `joao-dtf-jeans` e `joao-polo` ("regressões **antes de publicar**" — publicar é o último passo) |
| não — objeto diferente | 2 | `gps-microloops-23` (**materializar** fonte = leitura), `joao-rendimento-dtf-uv` (artefato de ambiente) |

**São 5, não 21.** E `julia-pagamento-grounded` diz literalmente *"não falta SIM para o
artefato"* — publicar ali sobrescreveria a linhagem viva.

Transformar "bloqueada em deploy" em "precisa publicar" teria mandado o Cérebro publicar por
cima de nove frentes que precisavam de outra coisa primeiro.

---

## §1 e §2 — Contrato do tradutor

Cinco unidades, e só uma delas é traduzível direto:

| unidade | exemplo real | tratamento |
|---|---|---|
| **SINTOMA** | "crons succeeded sem efeito" | nunca traduzir direto — procurar a ação por trás |
| **PROBLEMA** | "não dá para dizer se reativar paga o esforço" | traduzível se o objeto estiver nomeado |
| **RESULTADO_DESEJADO** | "ligar a maquinaria de reativação" | decompor; quase nunca é uma capacidade |
| **AÇÃO** | "publicar `supervisor_candidato.ts` na edge X" | traduzível |
| **CAPACIDADE** | raro nas fontes reais | direto |

Saídas permitidas, todas com direito a abster: `CAPABILITY_EXATA`,
`MULTIPLAS_CAPABILITIES_PLAUSIVEIS`, `CAPABILITY_NAO_CATALOGADA`, `NECESSIDADE_AMBIGUA`,
`NECESSIDADE_NAO_ACIONAVEL`.

Guards no banco, todos testados e rejeitando (4 de 4):
- capability fora do vocabulário → **exceção** (`CAPABILITY_INVENTADA`, §14)
- abstenção com capability preenchida → rejeitada
- `CAPABILITY_EXATA` com ≠1 capacidade → rejeitada
- cadeia causal com menos de 40 caracteres → rejeitada (obriga a escrever o porquê, não a palavra)

---

## §5 e §6 — Sentinelas

| sentinela | esperado | obtido |
|---|---|---|
| `crons-sucesso-sem-efeito` | **não** pode virar `MONITORAR_SAUDE_DE_EXECUTOR` | **`CAPABILITY_NAO_CATALOGADA`** ✅ |
| R68 "ligar a maquinaria" | decompor, não escolher uma por semelhança | **`MULTIPLAS`, 4 capacidades** ✅ |
| Camila | `EVIDENCIA_INSUFICIENTE` | **`EVIDENCIA_INSUFICIENTE`** ✅ |

A cadeia causal registrada para a primeira: *"agente-observacao monitora saúde de AGENTE por
`cron_execution_log` e `error_log`, que são outras tabelas e outro objeto"*. O falso positivo da
R80 morreu por leitura de código, não por regra nova.

---

## §4, §11 e §12 — Replay e teste cego

| conjunto | n | `ACERTO_EXATO` | `ABSTENCAO_CORRETA` | `COMPOSTA_RECONHECIDA` | `CAPABILITY_ERRADA` | `CAPABILITY_INVENTADA` |
|---|---|---|---|---|---|---|
| replay das 20 da R80 | 20 | 11 | 6 | 3 | **0** | **0** |
| **cego** (13 necessidades novas) | 13 | **2** | **11** | 0 | **0** | **0** |
| total | 33 | 13 | 17 | 3 | **0** | **0** |

**`FALSO_POSITIVO_DE_TRADUCAO = 0`** contra a régua vigente de 14 pares (8 positivos, 6 negativos).
Os 8 positivos conferem 8 de 8.

O contraste entre os conjuntos é o resultado, não um detalhe: **no replay o tradutor resolve 70%;
no cego, 15%.** A diferença mede exatamente quanto do desempenho vinha de ter desenhado a
taxonomia olhando aqueles casos.

---

## A régua tinha um defeito, e foi ela que acusou

A verificação automática apontou **1 negativo violado de 6**: o par
`R68-candidato ✗ ENVIAR_WHATSAPP_REATIVACAO`. O tradutor devolveu essa capacidade — como **uma de
quatro**, que é o que o positivo correspondente prescreve.

Erro da régua, não do tradutor: `capability_proibida` não dizia **como** era proibida. Corrigido
append-only com a coluna `proibida_como` (`UNICA` / `QUALQUER`) e uma linha nova em `R81-C`; a
linha errada fica como histórico. Sob a régua corrigida: **0 violações**.

Vale registrar que só apareceu porque a verificação é consulta, não leitura minha.

---

## §13 — Pipeline end-to-end

| desfecho | n |
|---|---|
| `ABSTENCAO_CORRETA` | **17** |
| `COBERTURA_INSUFICIENTE` | 18 |
| `ROTA_CORRETA` | **3** |
| **`ERRO_TRADUCAO`** | **0** |
| **`ERRO_ROUTER`** | **0** |

As 3 rotas corretas são todas de reativação: `ENVIAR_WHATSAPP_REATIVACAO` (duas necessidades) e
`DETECTAR_CLIENTE_FORA_DO_CICLO` — todas apontando `fn_vigia_ciclo_compra`.

A responsabilidade dos elos ficou separada, que era o pedido da §13: **os dois elos estão
corretos, a cobertura é que não existe.** 18 de 38 caem em capacidade sem executor.

---

## §9 — As ausências nasceram de necessidades bem interpretadas?

| capacidade ausente | classificação | por quê |
|---|---|---|
| `PUBLICAR_EDGE_FUNCTION` | **AUSENCIA_REAL_E_NECESSARIA** | mas para **5 frentes**, não 21 |
| `CURAR_BASE_DE_CONHECIMENTO_PRODUTO` | AUSENCIA_REAL_E_NECESSARIA | 2 frentes de prioridade 1 |
| `DEFINIR_REGRA_DE_DOMINIO` | AUSENCIA_REAL_E_NECESSARIA | apareceu em **4** necessidades independentes, 2 delas no teste cego |
| `MEDIR_RESULTADO_REATIVACAO` | **NECESSIDADE_COMPOSTA** | as duas necessidades que a pedem também pedem enviar |
| `OBTER_FONTE_EXATA_DE_EDGE` | AUSENCIA_REAL_E_NECESSARIA | e é o par de verificação do publicar |
| `ATRIBUIR_AUTORIA_DE_MENSAGEM` | AUSENCIA_REAL_E_NECESSARIA | convergiu por duas rotas |
| `MEDIR_CUSTO_MARGEM_POR_PEDIDO` | AUSENCIA_REAL_E_NECESSARIA | — |
| `REVALIDAR_AUDIENCIA_NO_ENVIO` | AUSENCIA_REAL_E_NECESSARIA | — |
| `EXECUTAR_SCRIPT_COM_ACESSO_AO_BANCO` | AUSENCIA_REAL_E_NECESSARIA | — |
| `ISOLAR_POPULACAO_EXPERIMENTAL` | AUSENCIA_REAL_E_NECESSARIA | R78 §7 |

Nenhuma `CAPABILITY_MAL_DEFINIDA`. `DEFINIR_REGRA_DE_DOMINIO` é a mais recorrente do sistema:
**quatro frentes independentes travadas esperando alguém fixar uma regra**, não escrever código.

---

## §15 — Tipo de executor para as ausências (só conceito)

| capacidade | tipo adequado | risco |
|---|---|---|
| **`PUBLICAR_EDGE_FUNCTION`** | **MISTO com gate humano** | **ALTO** |
| `OBTER_FONTE_EXATA_DE_EDGE` | FUNCAO_DETERMINISTICA | baixo |
| `CURAR_BASE_DE_CONHECIMENTO_PRODUTO` | MISTO (humano define, função valida) | médio |
| `DEFINIR_REGRA_DE_DOMINIO` | **HUMANO** | — |
| `MEDIR_RESULTADO_REATIVACAO` | FUNCAO_DETERMINISTICA | baixo |
| `ATRIBUIR_AUTORIA_DE_MENSAGEM` | FUNCAO_DETERMINISTICA | baixo |
| `ISOLAR_POPULACAO_EXPERIMENTAL` | FUNCAO_DETERMINISTICA | baixo |
| `MEDIR_CUSTO_MARGEM_POR_PEDIDO` | FUNCAO_DETERMINISTICA | baixo |
| `REVALIDAR_AUDIENCIA_NO_ENVIO` | FUNCAO_DETERMINISTICA | médio |
| `EXECUTAR_SCRIPT_COM_ACESSO_AO_BANCO` | HUMANO | alto |

**`PUBLICAR_EDGE_FUNCTION` é a de maior risco do conjunto** — escreve código em produção,
sobrescreve linhagem viva e, como a §8 mostrou, é a que mais atrai tradução errada. A §7 já
indica que ela não é uma capacidade solta: `joao-parametro-financeiro` pede publicar **e reobter
a fonte**, e `julia-briefing-multiartes` exige reconciliar hash antes. Qualquer executor futuro
precisa da sequência, não do verbo.

E há um fato desta madrugada que muda o enquadramento: **enquanto esta rodada corria, um operador
publicou a edge `agente-noturno` v4.36.0 (version 179) e atualizou `joao-correcao-contexto-intencao`
às 00:27 UTC.** Não fui eu. A capacidade não é ausente do mundo — é ausente do **Cérebro**. Existe
e é exercida por gente.

---

## §16 — Auto-refutação

| tentativa | resultado |
|---|---|
| o erro da R80 foi isolado? | **não.** A mesma ponte lexical produziu o número "21 frentes" da §8 |
| outras necessidades foram mal traduzidas? | **sim, quatro**: os dois `publicar` que não são edge e os dois `joao-*` onde publicar é o último passo |
| vocabulário granular demais? | **não** — nenhuma necessidade precisou de duas capacidades quase-iguais |
| vocabulário genérico demais? | **sim, em um ponto**: `MONITORAR_SAUDE_DE_EXECUTOR` engoliu saúde de cron. Foi o falso positivo da R80 |
| alguma necessidade exige sequência? | **sim, 3** reconhecidas como compostas; e `pipeline-memoria-clientes` tem 3 elos com só 1 catalogado |
| território influencia a semântica? | **sim.** No econômico as necessidades vêm de `gap_do_mapa`, escritas como problema. No sistema vêm de `proximo_passo`, escritas como ordem — e já misturadas com decisões de não agir |
| a descrição da frente induz erro? | **sim, e é a maior fonte**: `proximo_passo` mistura pedido, ordem de parada, histórico e condicional no mesmo campo |
| falta o resultado desejado? | **sim** em `painel-decisao-operacao`, cujo próprio texto admite que o critério de aceite ainda não existe |
| **o tradutor é código?** | **não.** É um contrato aplicado por operador, avaliado contra uma régua que o mesmo operador escreveu. É a fraqueza central desta avaliação e nenhum número aqui a compensa |

---

## §17 — Gate

| critério | resultado |
|---|---|
| 0 falso positivo crítico | **passa** — 0 de 14 pares |
| abstenção funciona | **passa** — 51,5% geral, 84,6% no cego |
| casos compostos reconhecidos | **passa** — 3 |
| não cria capability automaticamente | **passa** — 0 criadas; trigger testado e rejeitando |
| distingue sintoma de ação | **passa** — sentinela `crons-sucesso-sem-efeito` |
| `PUBLICAR_EDGE_FUNCTION` não vira solução universal | **passa** — 5 de 21, e a §8 mostra as 16 que não são |

---

## Próximo passo

1. **`DEFINIR_REGRA_DE_DOMINIO` é o gargalo mais barato de destravar.** Quatro frentes
   independentes esperam por ele, duas descobertas às cegas. Não é código: é alguém decidir.
2. **`PUBLICAR_EDGE_FUNCTION` precisa ser desenhada como sequência**, não como verbo — e o fato
   de um operador tê-la exercido às 00:27 desta madrugada mostra que o desenho é sobre governança
   e rastreabilidade, não sobre viabilidade técnica.
3. **A fonte de necessidade precisa separar pedido de ordem de parada.** Hoje `proximo_passo`
   mistura os dois, e 6 das 33 traduções terminaram em `NECESSIDADE_NAO_ACIONAVEL` por isso.

Nada disso foi iniciado.

---

## Gate de segurança

| verificação | observado |
|---|---|
| executores acionados | **0** |
| capabilities criadas no automático | **0** (§14 — trigger testado) |
| capabilities ou executores registrados nesta rodada | **0** — o vocabulário segue em 34 e o registro em 24 |
| edges publicadas por mim | **0** (a de 00:27 é de outro operador, ver §15) |
| crons, GPS, prompts, frentes alterados | **0** |
| agentes criados, fundidos ou mortos | **0** (23) |
| efeito externo | **0** (último WhatsApp 26/08 15:20) |
| consumidor da view do router | **(nenhum)** |
| `crm_campaign_autonomy_policy.ativo` | `false` |
| pré-registros | V1 e V2 intactos, sem V3; congelado até 04/09 |
| objetos criados | 2 tabelas append-only (`traducao_gold`, `traducao_shadow`), 1 view de leitura (`vw_pipeline_shadow_e2e`), 3 triggers |
