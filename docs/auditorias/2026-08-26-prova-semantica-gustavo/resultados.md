# Resultados — prova semântica Gustavo

Data: 26/08/2026 · Projeto `ldrdtaibazplvrbwyrvx` · read-only (0 escritas)

## Veredito

**CRITERIO_REPROVADO**

Falha na régua primária por margem máxima, e a falha é explicada.

## O que foi testado

O "critério" não é uma função única. É a cadeia que produz o veredito por decisão:

| Camada | Objeto | Papel |
|---|---|---|
| 1 | `trg_auto_acerto` | `resultado` → `acerto` mecânico |
| 2 | `fn_ricardo_fechar_acertos` | status da aprovação → `acerto` |
| 3 | `fn_sinal_qualidade_decisoes` | filtro de "julgável" |
| 4 | `fn_avaliar_autonomia_proposta` | agregação (não aplicável por decisão) |

Camadas 1–3 foram **reproduzidas verbatim** dos corpos vivos das funções, não simuladas.
Camada 4 é agregadora e herda integralmente os rótulos das camadas 1–3.

## Régua de passagem (definida antes de ver o resultado)

| Condição | Exigido | Obtido | |
|---|---|---|---|
| BOM_ANCHOR reconhecidas como BOM | ≥ 15 de 18 | **0 de 18** | ✗ |
| BOM_ANCHOR classificadas RUIM | ≤ 1 | **18** | ✗ |
| Separa BOM de RUIM nos demais conclusivos | sim | não | ✗ |
| Independe de resposta/aprovação/expiração/execução | sim | **100% dependente** | ✗ |
| Exemplos positivos e negativos suficientes | sim | 0 RUIM humano | ✗ |

## Matriz de confusão (40 casos)

| humano ↓ / critério → | BOM | RUIM | INCONCLUSIVO | total |
|---|---|---|---|---|
| **BOM** | 2 | **22** | 0 | 24 |
| **RUIM** | 0 | 0 | 0 | **0** |
| **INCONCLUSIVO** | 0 | 6 | 10 | 16 |
| total | 2 | 28 | 10 | 40 |

## Métricas

| Métrica | Valor | Nota |
|---|---|---|
| Recall BOM | **8,3%** (2/24) | os 2 vieram por "aprovada" |
| Precisão BOM | 100% (2/2) | n=2, sem poder |
| Precisão RUIM | **0%** (0/28) | não existe RUIM humano |
| Recall RUIM | indefinido | classe vazia |
| Taxa INCONCLUSIVO | 25% (10/40) | por ausência de regra, não por incerteza |
| **BOM_ANCHOR recall** | **0% (0/18)** | régua exigia ≥83% |

## Teste de degeneração

| Baseline trivial | Recall BOM | Precisão RUIM | Erros conclusivos |
|---|---|---|---|
| "BOM para tudo" | **100%** | — | 16 |
| "RUIM para tudo" | 0% | 0% | 40 |
| "INCONCLUSIVO para tudo" | 0% | — | **0** |
| **Critério atual** | **8,3%** | **0%** | **28** |

O critério é **dominado por dois dos três baselines triviais**. "BOM para tudo" tem recall 12×
melhor; "INCONCLUSIVO para tudo" não erra nenhuma afirmação conclusiva. No BOM_ANCHOR o critério
é **indistinguível de "RUIM para tudo"** (ambos 18/18 RUIM).

Não há prova de discriminação. Há prova de ausência de discriminação.

## Teste dos velhos proxies (655 decisões, não só as 40)

| Variável procedimental | → label do critério | Cobertura | Exceções |
|---|---|---|---|
| `expirou` | RUIM | 114/114 | **0** |
| `aprovada` | BOM | 5/5 | **0** |
| `dry_run` | INCONCLUSIVO | 16/16 | **0** |
| `sem_veredito` | INCONCLUSIVO | 520/520 | **0** |

O label do critério é uma **função determinística da variável procedimental**, sem uma única
exceção em 655 decisões. Poder explicativo = 100%.

Poder explicativo da economia sobre o mesmo label:

| Bucket do critério | ROAS mín | ROAS máx | ROAS médio |
|---|---|---|---|
| RUIM | 0,00 | **5,64** | 1,70 |
| BOM | **0,15** | 6,21 | 3,56 |

Os intervalos se sobrepõem quase por completo. O bucket RUIM contém a melhor campanha da base
(ROAS 5,64) e o bucket BOM contém uma de ROAS 0,15. A economia **não explica nada** do label.

**Declaração de falha:** as variáveis proibidas explicam o julgamento integralmente; o resultado
econômico não explica parte alguma.

## Correções à auditoria de 25/08

Dois erros meus, encontrados ao reproduzir a partir das fontes vivas:

1. **A classe não tinha 18 casos, tem 55.** O número anterior era artefato duplo: (a) filtrei por
   `feedback ILIKE 'Proposta expirou%'`, contaminando a classe com a variável procedimental que
   eu queria testar; (b) o regex de gasto cobria só o formato `gasto R$605` e ignorava
   `com R$2798.8 gastos`.
2. **A exposição não era R$22.952, é R$12.201.** Eu somei snapshots diários cumulativos da mesma
   campanha. O valor correto: R$12.201 de gasto no último aviso e **R$3.077 queimados após o
   primeiro aviso ignorado**, distribuídos em 6 campanhas.

A conclusão de 25/08 não muda — mas os números que a sustentavam estavam inflados.

## Economia por campanha (BOM_ANCHOR, população de 55)

| Campanha | Avisos | 1º aviso | Último | Queimado depois | Atribuição verificável |
|---|---|---|---|---|---|
| 470257 | 6 | R$953 | R$2.799 | **R$1.846** | não |
| 910257 | 17 | R$2.056 | R$2.840 | R$784 | **sim** (pico 8,61x) |
| 560257 | 8 | R$625 | R$981 | R$356 | não |
| 090257 | 3 | R$605 | R$696 | R$91 | não |
| 230052 | 9 | R$2.467 | R$2.467 | R$0 | **sim** (pico 4,33x) |
| 970257 | 12 | R$2.418 | R$2.418 | R$0 | **sim** (pico 2,11x) |
| **Total** | **55** | **R$9.124** | **R$12.201** | **R$3.077** | 3 de 6 |
