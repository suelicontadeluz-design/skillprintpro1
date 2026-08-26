# Prova semântica — caso Gustavo

**VEREDITO: `CRITERIO_REPROVADO`**

Read-only. 12 consultas `SELECT`, zero `INSERT`/`UPDATE`/`DELETE`, zero deploy,
zero alteração de prompt, cron, função, policy, nível ou autonomia.

## A pergunta

> O critério consegue reconhecer decisões economicamente corretas sem usar resposta do
> WhatsApp, expiração ou mera execução sem erro como proxy de qualidade?

**Não.** E a prova é mais forte do que "erra às vezes": o rótulo do critério é uma
**função determinística da variável procedimental**, com zero exceções em 655 decisões.

| Variável procedimental | → rótulo | Exceções |
|---|---|---|
| `expirou` | RUIM | 0 de 114 |
| `aprovada` | BOM | 0 de 5 |
| `dry_run` | INCONCLUSIVO | 0 de 16 |
| `sem_veredito` | INCONCLUSIVO | 0 de 520 |

Não é correlação indevida. É identidade. O critério não é um juiz que às vezes se apoia
no proxy — ele **é** o proxy, renomeado.

## O resultado central

Das 18 decisões da classe `BOM_ANCHOR` — pausas de campanha com ROAS < 0,5 e gasto acima
de R$300, rotuladas por razão **econômica**, nunca procedimental:

- reconhecidas como BOM: **0**
- classificadas como RUIM: **18**
- régua exigia: ≥ 15 BOM e ≤ 1 RUIM

Falha por margem máxima. No mesmo conjunto o critério é **indistinguível de um classificador
que diz RUIM para tudo**, e tem recall 12× pior que um que diz BOM para tudo.

## Segundo achado, independente

A classe **RUIM humana ficou vazia**: 0 de 40. Mesmo que o critério tivesse ido bem no
`BOM_ANCHOR`, não seria possível validar sua precisão para RUIM.

Isso qualificaria como `INCONCLUSIVO_FALTA_CONTRACLASSE` — mas não substitui o veredito,
porque a reprovação no `BOM_ANCHOR` é decisiva, não indeterminada: o critério **emitiu**
rótulo conclusivo em 18 de 18 e errou em 18 de 18.

## Correções à auditoria de 25/08

Reproduzir a partir das fontes vivas expôs dois erros meus:

1. **A classe tem 55 casos, não 18.** O 18 era artefato duplo — filtro por
   `feedback ILIKE 'Proposta expirou%'` (que contamina a classe com exatamente a variável
   sob teste) e regex de gasto cobrindo só um dos dois formatos de `motivo`.
2. **A exposição é R$12.201, não R$22.952.** Eu somei snapshots diários cumulativos da mesma
   campanha. O dano real demonstrável: **R$3.077 queimados após o primeiro aviso ignorado**.

A conclusão de 25/08 se mantém; os números que a sustentavam estavam inflados.

## Método

**Passo 1 — Ancoragem econômica.** `pausar_campanha AND roas < 0.5 AND gasto > 300`.
Nenhum termo procedimental na definição. População: 55, em 6 campanhas.
Amostra de 18: `row_number() OVER (PARTITION BY camp ORDER BY md5(id::text)) <= 3`
— 3 por campanha, determinístico, sem `random()`.

**Passo 2 — 22 casos.** Sete estratos disjuntos, mesma ordenação por `md5(id)`, cotas fixas
antes de olhar o conteúdo. Cobre 3 ações, 7 campanhas, aprovadas, expiradas, sem resposta,
dry_run e abstenções. Rejeitadas não existem na base (0 de 76 aprovações do Gustavo).
O estrato S1 previsto esvaziou após a correção do regex; as 5 vagas foram para S6 e S8.

**Passo 3 — Verdade semântica.** Rótulo por razão econômica/operacional, com justificativa
auditável por caso em `amostra-40.csv`. Proibido usar como prova: resposta humana, expiração,
aprovação, execução sem erro, ausência de reclamação.

**Passo 4 — Teste às cegas.** Camadas 1–3 do critério reproduzidas verbatim dos corpos vivos
das funções. Rótulos humanos não entraram no cálculo.

## Refutação da própria conclusão

**Hipótese alternativa mais forte:** *"ROAS 0 é falha de atribuição, não campanha ruim.
Então pausar estava errado e o critério estava certo por acaso."*

Teste: se a atribuição estivesse quebrada na campanha, ela nunca registraria ROAS positivo.

| Campanha | Pico de ROAS | Atribuição funciona? | Casos no anchor |
|---|---|---|---|
| 910257 | 8,61x | **sim** | 3 |
| 230052 | 4,33x | **sim** | 3 |
| 970257 | 2,11x | **sim** | 3 |
| 470257 | 0,72x | não verificável | 3 |
| 090257 | 0,00x | não verificável | 3 |
| 560257 | 0,01x | não verificável | 3 |

**Refutada em 9 de 18 casos, sobrevive nos outros 9.** Nas três campanhas que já registraram
ROAS alto, o zero é real e a pausa era correta — sem dúvida possível.

Isso **não salva o critério**: restringindo o teste apenas aos 9 casos com atribuição
verificada, ele rotula **9 de 9 como RUIM**. Recall BOM continua 0%.

**Segunda auto-crítica, mais séria:** meu rótulo humano do anchor é, em essência, a regra
"ROAS < 0,5 ⇒ pausar é certo". Isso é economia simples, não semântica profunda — estou
comparando uma regra econômica trivial contra uma regra procedimental.

Aceito a crítica e ela **estreita** a conclusão: esta prova não demonstra que minha régua é
um bom juiz geral. Demonstra que o critério atual é **pior que uma linha de base econômica
trivial** na única classe com verdade defensável. Para autonomia isso basta para reprovar.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `README.md` | veredito, método, refutação |
| `amostra-40.csv` | 40 casos: rótulo humano, rótulo do critério, justificativa |
| `resultados.md` | métricas, degeneração, proxies, economia por campanha |
| `consultas.sql` | consultas reproduzíveis, todas `SELECT` |

## Próximo passo único

**Construir o produtor de veredito econômico e rodá-lo em shadow sobre as mesmas 55 pausas** —
uma função que rotule a partir de ROAS, gasto e reversibilidade, sem ler status de aprovação.

É a menor peça que muda o resultado. Enquanto o veredito nascer de
`fn_ricardo_fechar_acertos`, nenhum ajuste em `fn_sinal_qualidade_decisoes`, em limiar ou em
escada altera nada: as camadas de cima só filtram e agregam um rótulo que já vem sendo
copiado do status da aprovação.

**Componente que precisa mudar primeiro:** a camada 2 (`fn_ricardo_fechar_acertos`), não a
camada 3 nem a 4. Não implementar nesta rodada.

## Restrições honradas

Não liguei o André. Não promovi nem rebaixei ninguém. Não criei frente. Não consertei o
circuito órfão. Rotulagem e artefatos ficaram fora do banco, em arquivos versionáveis.
