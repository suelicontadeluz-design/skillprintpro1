# EXP-001 — Proatividade cria conversa? (desenho read-only, nao executado)

Projeto: Supabase `ldrdtaibazplvrbwyrvx` · Coleta 2026-08-25 · Somente `SELECT`.
Fecha ou nao a incerteza **U9b** do `fn_mapa_cerebro_v0()` v2.

## VEREDITO: EXPERIMENTO_AJUSTAVEL

Isolamento, amostra, metrica e randomizacao estao provados. O que falta e uma
decisao humana sobre risco de canal (WhatsApp nao-oficial) e sobre a definicao
de coorte, nao mais dado.

## Numeros medidos

| | |
|---|---|
| Coorte elegivel (todos os gates) | **13.658 leads** |
| Contaminacao observada (outbound alheio em 7d sobre dormentes) | **0,27%** (36 de 13.368) |
| Baseline inbound espontaneo 7d | **0,000%** (0 de 13.332) |
| Baseline venda espontanea 7d | **0,052%** (7 de 13.368) |
| Efeito historico em base fria (30+ dias) | **39,1%** de resposta (43 de 110) |
| Outbound total que e proativo puro | 6,9% do zapi; 0,8% Joao; 0,5% Julia |

## A refutacao que quase matou o experimento

O primeiro numero de efeito foi 56,9% (186 de 327). Estratificando por idade do
lead no momento do contato:

| idade do lead | n | responderam | taxa |
|---|---|---|---|
| < 1 dia | 177 | 136 | **76,8%** |
| 1-7 dias | 39 | 6 | 15,4% |
| 7-30 dias | 1 | 1 | - |
| **30+ dias (base fria)** | **110** | **43** | **39,1%** |

Os 76,8% sao leads que acabaram de chegar por CTWA/formulario: a empresa manda a
primeira mensagem porque o lead pediu. Isso e atender intencao, nao criar conversa.
Contar isso como "efeito da proatividade" seria repetir o erro do U9.
**A coorte do experimento exclui leads com menos de 30 dias.**

## Randomizacao (simulada, nao persistida)

`get_byte(decode(md5(lead_id::text || 'exp-proatividade-001'),'hex'),0) & 1`

| | CONTROLE | TRATAMENTO |
|---|---|---|
| n | 6.842 | 6.816 |
| organico | 8,11% | 7,75% |
| com campanha | 85,31% | 85,86% |
| idade media (dias) | 240,6 | 241,2 |
| idade mediana | 212,3 | 212,4 |
| criados ate 90d | 18,68% | 18,63% |
| ja comprou | 1,90% | 1,60% |
| com score | 11,28% | 11,53% |
| morno / frio | 4,14% / 6,49% | 4,24% / 6,60% |

Determinista, reproduzivel, sem `random()`, sem persistencia necessaria.

## Janela (derivada do historico, nao arbitrada)

Das 186 respostas a contato proativo: 171 em 24h (91,9%), 182 em 72h (97,8%),
186 em 7d (100%). Vendas: 12 em 7d, 15 em 30d (80% em 7d).

- Desfecho primario `iniciou_conversa`: **72h** (captura 97,8%)
- Desfecho de venda: **7 dias** (captura 80%)
- Observacao estendida: 30 dias, so para registro

## Poder

Controle ~0 torna o teste "houve algum sucesso no tratamento?". Com 0 sucessos no
controle, ~5-6 sucessos no tratamento ja dao p<0,05 (Fisher).

| taxa real de resposta | n/braco necessario |
|---|---|
| 39% (historico) | ~20 |
| 10% | ~100 |
| 5% | ~200 |
| 2% | ~400 |
| 1% | ~600 |

Venda (baseline 0,052%): efeito de 1,5% detectavel com n=500/braco; efeito de
0,5% exigiria ~2.000/braco.

**Recomendado: 600 por braco (1.200 leads).** A coorte tem 13.658 - 11x o
necessario. Nao ha razao para disparar para a base inteira.

## Contaminacoes mapeadas

93 cron jobs ativos. Os que podem tocar um lead:
`joao-sweep-2min` (*/2min), `resgate-leads-vacuo-30min`, `vigia-leads-mornos-diario`,
`vigia-ciclo-compra-diario`, `reativar-leads-fora-horario`, `whatsapp-executor-15min`,
`julia-session-manager-tick` (*/1min), `agente-fechamento-manha/tarde`,
`fidelimax-aniversario-daily`, `expirar-disparos-vencidos`, `refresh-universo-frio-horario`.

Medido empiricamente: sobre 13.368 dormentes, **apenas 36 (0,27%)** receberam
outbound de qualquer origem em 7 dias. O sistema hoje quase nao e proativo com
base fria, entao o controle nao seria contaminado na pratica.

## Guardrails obrigatorios

- opt-out honrado (`crm_contact_optouts`, revogado_em is null) - **tem apenas 1 registro
  hoje: a estrutura existe mas nunca foi exercitada em volume**
- exatamente 1 mensagem por lead na janela principal; zero segunda intervencao
- inbound que chegar e atendido normalmente nos DOIS bracos (controle nao nega atendimento)
- horario comercial; sem desconto, sem preco, sem mudanca de campanha
- limite de volume por hora e por numero de origem
- kill switch: parar se opt-out/bloqueio no tratamento exceder 2%, se houver
  duplicidade de envio, se atendimento humano degradar, ou ao primeiro sinal de
  restricao do canal

## Como o resultado volta ao MAPA

Formato consumivel pelo GPS, sem estrutura nova (caberia como uma linha de
aprendizado lida por `fn_mapa_cerebro_v0()` no bloco `incertezas`/U9b):

```json
{
  "hipotese": "outbound_proativo_cria_conversa",
  "experimento_id": "exp-proatividade-001",
  "coorte": "lead >=30d sem atividade 30d, telefone unico, sem optout, sem compra 30d",
  "tratamento_n": 600, "controle_n": 600,
  "janela_primaria": "72h", "janela_venda": "7d",
  "taxa_tratamento": null, "taxa_controle": null,
  "efeito_incremental_pp": null,
  "vendas_tratamento": null, "vendas_controle": null,
  "optouts_tratamento": null,
  "confianca": null,
  "resultado": "MELHOROU|PIOROU|INCONCLUSIVO",
  "contaminacao_observada_pct": null,
  "validade": "interna ao segmento base fria 30+ dias; NAO extrapolar para lead novo"
}
```

## O risco que nao e de dado

O canal e Z-API/BotConversa (nao-oficial), nao WhatsApp Business API com template
aprovado. Disparo proativo para numeros dormentes ha ~241 dias em media e o padrao
classico que leva a bloqueio de numero. Isso nao aparece em nenhuma tabela e nao e
mensuravel aqui - e a razao principal do veredito ser AJUSTAVEL e nao PRONTO.
600 por braco, em ritmo controlado, existe tambem para limitar esse risco.
