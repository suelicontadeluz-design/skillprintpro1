# R16 — População T0 do EXP-001 congelada (tratamento + controle)

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `EXP001_POPULACAO_CONGELADA`

456 participantes congelados de **uma única leitura**, com braço preservado e hash
reconstruído idêntico ao de T0. Zero fila, zero envio, campanha em `rascunho`.

---

## 1. BASELINE

| Objeto | `md5(prosrc)` |
|---|---|
| `fn_exp001_coorte(integer)` | `4390732e59e29c7b0b63bceca2215828` |
| `fn_exp001_registrar_intervencao` | `4b3c979bf5adf5484f302d5631d85b29` → **`f18172cd15b57676e77e0940e3618a0e`** |
| `fn_agente_automatico_pode_atender` | `d22ac0fd2e6d57c4fd183c717272ae59` (intacto) |
| `fn_mapa_cerebro_v0` | `226944645b3f715d75b9a82b33211f28` (intacto) |
| `fn_tiago_autorizar_e_enfileirar` | `40b5287ea8cf04fc744f01a0dfe75da5` (intacto) |
| `fn_fila_disparos_pendentes` | `8eeebb25371cb903eda1455103ed23f6` (intacto) |

## 2. SEMÂNTICA DA AUDIÊNCIA — resposta (A), provada

`crm_campaign_audiences` é **audiência**, não intervenção:

| Evidência | Valor |
|---|---|
| linhas totais | 1982 |
| com `disparo_id` (viraram intervenção) | **5** |
| `excluido = true` | **941** (47%) |
| `canal_recomendado = 'nenhum'` | 92 |
| nunca enviadas | 1977 |

Metade da tabela é gente que foi **considerada e descartada**. Existem `incluido`,
`motivo_inclusao`, `excluido`, `motivo_exclusao` — vocabulário de audiência. E
`crm_campaigns.estimativa_bloqueados` conta quem não será contatado.

**Mas eu não usei essa tabela para o controle.** Motivo no item 7.

## 3. MODELO ESCOLHIDO — `lab_atribuicoes`, reutilizado, não criado

Procurei antes de criar. Achei um subsistema de experimentos já existente, e dentro dele
a tabela exata:

```
lab_experimentos (agente_slug, dominio, variacao_id, status, config, ...)
  └─ lab_atribuicoes  UNIQUE(lead_id, experimento_id)
                      variacao_id text NOT NULL   ← o braço
                      assigned_at timestamptz     ← o T0
                      metadata jsonb              ← o carimbo da leitura
```

Por que ela é a escolha certa:

- **`UNIQUE(lead_id, experimento_id)`** dá "um braço por lead por experimento", estruturalmente;
- **estava vazia** (0 linhas) — zero risco de colidir com dado existente;
- é **inerte quanto a envio**: nenhuma das 8 funções `fn_lab_*` insere em
  `waba_disparos_lista` ou faz HTTP, e **nenhum cron** toca o subsistema `lab_*`.

Descartei `crm_campaign_audiences.segmento` para guardar o braço: ele já carrega
significado de negócio real (`impressao_dtf_textil` 1003, `uniformes` 212, …). Sobrecarregá-lo
corromperia um campo em uso.

### Isolamento do snapshot dentro do `lab_*`

Os dois únicos escritores de `lab_atribuicoes` — `fn_lab_sortear_variacao` e
`fn_lab_atribuir_v2` — filtram **`status='ativo'` E `agente_slug` E `dominio`**.
Gravei o experimento como:

```
agente_slug = 'cerebro-exp001'
dominio     = 'exp001_reaquecimento'
status      = 'nunca_executado'      ← valor válido do CHECK, e literalmente verdadeiro
pct_trafego = 0
```

Tripla isolação: nenhum dos dois consegue sortear variação e poluir o snapshot.

## 4–5. LEITURA T0

**Uma única chamada** a `fn_exp001_coorte(5000)`, dentro da transação do congelamento.
Nenhuma rechamada durante o loop, nenhum recálculo por lead.

```
gerado_em    : 2026-08-25T15:36:16.997066+00:00
hash_divisao : 865e8672701086630817a1a3c6119f42
total        : 456   ·   tratamento 244   ·   controle 212
```

Antes de escrever qualquer linha, a transação validou que a própria leitura era
consistente (contagem por braço = `resumo`, sem `lead_id` duplicado) e abortaria se não.

## 6. COMO O BRAÇO FOI PERSISTIDO

`lab_atribuicoes.variacao_id` = `'TRATAMENTO'` | `'CONTROLE'`, com `assigned_at` = T0 e
`metadata` carregando `hash_divisao_t0`, `gerado_em_t0`, `dias_desde_ultimo_inbound` e o
elemento inteiro da coorte. `segmento` recebeu o estrato (`31-35d`/`36-40d`/`41-45d`).

O braço está **persistido e também recomputável** — as duas coisas batem (item 12, T5).

## 7. PROVA DE CONTROLE NÃO ENFILEIRÁVEL

Duas barreiras independentes, nenhuma dependente de flag mutável:

**Barreira 1 — ausência.** Controle **não existe** em `crm_campaign_audiences`
(medido: 0 linhas). `fn_tiago_autorizar_e_enfileirar` só consegue enfileirar linhas que
existem naquela tabela para aquela campanha. Sem linha, não há o que enfileirar. Isso vale
mesmo se a campanha virar `aprovada`.

**Barreira 2 — guarda de braço (nova).** `fn_exp001_registrar_intervencao` agora recusa
qualquer lead cujo braço derivado seja CONTROLE, usando a **mesma fórmula determinística**
de `fn_exp001_coorte`:

```sql
IF (get_byte(decode(md5(p_lead_id::text || c_slug),'hex'),0) & 1) <> 1 THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'lead_e_do_braco_controle', ...);
END IF;
```

Isso fecha o único caminho que restava. Testado no LIVE:

| Chamada | Resposta |
|---|---|
| controle, `p_enfileirar=false` | `{"ok":false,"erro":"lead_e_do_braco_controle","braco":"CONTROLE"}` |
| controle, `p_enfileirar=true` + mensagem | `{"ok":false,"erro":"lead_e_do_braco_controle","enfileirado":false}` |

Não é flag, não é status, não é disciplina humana: é uma função de `lead_id`.

## 8. CONGELAMENTO

Tudo em **uma transação única** — sem snapshot parcial possível. O loop de tratamento
aborta a transação inteira se qualquer chamada retornar `enfileirado=true` ou erro.

| Escrito | Quantidade |
|---|---|
| `lab_experimentos` | 1 (status `nunca_executado`) |
| `lab_atribuicoes` | **456** (244 TRATAMENTO + 212 CONTROLE) |
| `crm_campaign_audiences` (EXP-001) | **244** (só tratamento) |
| `waba_disparos_lista` | **0** |

## 9. HASH RECONSTRUÍDO

Reconstruí o hash **a partir do snapshot armazenado**, com a mesma fórmula da função:

```sql
md5(string_agg(lead_id||':'||variacao_id, ',' order by lead_id::uuid))
```

| | valor |
|---|---|
| reconstruído do snapshot | `865e8672701086630817a1a3c6119f42` |
| `hash_divisao` de T0 | `865e8672701086630817a1a3c6119f42` |

**Idênticos.** É a prova de que o snapshot é fiel à leitura T0, lead a lead e braço a braço.

## 10. ZERO FILA / ZERO ENVIO

| Medida | Valor |
|---|---|
| fila do EXP-001 (via `campaign_audience_id`) | **0** |
| fila por `origem_agente='cerebro-exp001'` ou `segmentacao='exp001_reaquecimento'` | **0** |
| audiências do EXP-001 com `disparo_id` | **0** |
| envios com `segmentacao='exp001_reaquecimento'` (toda a história) | **0** |
| `crm_campaign_messages` da campanha | **0** |
| status da campanha / `criado_por` | `rascunho` / `cerebro-exp001` |
| `waba_disparos_lista` total | 907 antes, **907** depois |

## 11. DERIVA

A janela continua se movendo. Medido hoje, em três instantes:

| Instante | total | tratamento | controle |
|---|---|---|---|
| 15:16 | 460 | 246 | 214 |
| ~15:25 | 459 | 246 | 213 |
| **15:36 (T0)** | **456** | **244** | **212** |

Perdeu 4 leads em 20 minutos. **É exatamente por isso que o snapshot precisava existir.**

Ressalva honesta sobre T14: relendo agora, LIVE e SNAPSHOT coincidem (456, 0 entradas, 0
saídas, mesmo hash) — a janela ainda não voltou a tombar nos poucos minutos desde T0.
Então a *imutabilidade* do snapshot está garantida por construção (são linhas gravadas,
nenhum recálculo as toca), **não** por uma divergência observada agora. A deriva em si já
está comprovada pela tabela acima.

## 12. TESTES

| # | Teste | Resultado |
|---|---|---|
| T1 | snapshot vem de uma única leitura | `count(distinct assigned_at) = 1` |
| T2 | total = T0 | 456 = 456 |
| T3 | tratamento = T0 | 244 = 244 |
| T4 | controle = T0 | 212 = 212 |
| T5 | braço de cada lead = T0 | bate com a fórmula em 456/456 |
| T6 | zero duplicidades | 456 `lead_id` distintos |
| T7 | hash reconstruído = `hash_divisao` T0 | **`865e8672…` = `865e8672…`** |
| T8 | controle estruturalmente não enfileirável | recusado nas duas formas; 0 linhas na audiência |
| T9 | tratamento não enfileirado | 0 audiências com `disparo_id` |
| T10 | campanha permanece `rascunho` | `rascunho`, 0 mensagens |
| T11 | zero fila EXP-001 | 0 |
| T12 | zero mensagem EXP-001 | 0 |
| T13 | segunda tentativa não duplica | 244 → 244, `lab_atribuicoes` 456 → 456, fila 0 |
| T14 | deriva não altera snapshot | imutável por construção (ressalva no item 11) |
| T15 | MAPA/coorte/fila/Tiago intactos | hashes conferem |
| T16 | opt-out intacto | `d22ac0fd…`, 1 linha |
| T17 | rollback | artefato em `ops/cerebro/`, com Parte B marcada como destrutiva |

## 13. REFUTAÇÃO

| Ataque | Resposta |
|---|---|
| Audiência é população ou intervenção? | **População** — 941 excluídos, 5 com disparo. Provado por dados |
| Registrar controle pode fazê-lo ser enviado depois? | Não registrei controle na audiência. E a guarda de braço recusa mesmo se alguém tentar |
| Existe consumidor que lê toda audiência sem olhar braço? | Sim — `fn_tiago_autorizar_e_enfileirar`. Por isso o controle **não está lá**. Barreira por ausência, não por filtro |
| `metadata` é confiável para enforcement? | **Não.** Só documentação. O enforcement é a fórmula na guarda de braço |
| Campanha aprovada pode consumir controles? | Não — não há linha de controle para consumir |
| Snapshot parcial se falhar no meio? | Impossível — transação única, com `RAISE EXCEPTION` abortando tudo |
| Precisa ser transação única? | Sim, e foi |
| Dá para reconstruir T0 depois? | Sim — `lab_atribuicoes` + hash conferido. **Sem** rechamar a coorte |
| `hash_divisao` sozinho basta? | **Não.** Ele detecta que mudou, mas não reconstrói IDs. Por isso guardei os 456 |
| Pode alguém sortear variação e poluir o snapshot? | Não — os dois escritores exigem `status='ativo'`; o meu é `nunca_executado` |

## 14. PRÓXIMO PASSO MÍNIMO

A pergunta de daqui a 6 meses já tem resposta exata, sem depender da janela:

```sql
select a.lead_id, a.variacao_id as braco, a.assigned_at as t0, a.segmento as estrato
from lab_atribuicoes a join lab_experimentos le on le.id = a.experimento_id
where le.agente_slug='cerebro-exp001' and le.dominio='exp001_reaquecimento';
```

Próximo passo, uma coisa só: **definir e aprovar o texto da mensagem do EXP-001**, que é
hoje o único artefato que falta para o experimento poder rodar. Ele não existe
(`crm_campaign_messages` = 0) e é deliberadamente o último item — enquanto não existir,
não há o que enviar nem por engano.

Só depois, e como decisão separada e explícita: mudar a campanha para `aprovada`.

EXP-001 continua sem execução. Zero mensagens nesta rodada.
