# GPS — cobertura autônoma: diagnóstico determinístico

**17/08/2026 · frente `gps-cobertura-autonoma-diagnostico` (fechada)**
Chat `claude-gps-cobertura-20260817` · trilha `governanca`.

**Veredito: `GPS_BLOQUEADO_POR_POLITICA`.**
Nenhuma regra de desempate foi aplicada — **por prova contrária, não por omissão.**

---

## 1. O que este diagnóstico procurava

A pergunta central: *existe informação já presente no sistema que permita determinar a rota sem Alessandro?*

Resposta medida: **não, para 9 das 10 trilhas ambíguas.** O que falta não é algoritmo — é dado.

## 2. As três regras candidatas e o poder de resolução de cada uma

Derivadas **só** de campos estruturados de `frentes`, sem prosa, sem regex, sem LLM:

| Regra | Campo | Resolve |
|---|---|---|
| **onda** | `ordem_execucao` asc, nulls por último | 6/10 |
| **WIP** | `estado = em_andamento` primeiro | 6/10 |
| **DAG** | quantas frentes abertas dependem dela | 2/10 |

Isoladamente qualquer uma pareceria um ganho. Juntas, refutam-se.

## 3. Por que nenhuma foi aplicada

**As regras discordam entre si na mesma trilha.**

| Trilha | onda | DAG | WIP |
|---|---|---|---|
| `conversao_julia` | `julia-uv-nesting-fonte-verdade` | `julia-falha-tool-nao-vira-fato` | `julia-instrucao-tecnica-e-mensagem-concorrente` |
| `retencao` | `compra-unica-vazamento` | — | `fidelimax-ligar-fidelidade` |
| `governanca` | `governanca-worktrees-integracao` | — | `varrer-json-nulo-logica-ternaria` |

Três regras determinísticas, três respostas para a mesma pergunta, e nenhuma evidência para arbitrar entre elas.

**E a única decisão humana de rota registrada refuta a regra da onda.** Em `gps_rota_decisao` há um registro: 17/08 03:03, Alessandro escolheu `edges-fonte-canonica-versionada` na trilha `governanca`, entre 6 candidatas empatadas em P2. Essa frente tem `ordem_execucao = NULL` — a regra da onda teria escolhido `governanca-worktrees-integracao` (ordem 4). **A regra erra o único caso em que existe gabarito.**

O motivo que ele registrou não usa nenhum campo do schema: *"remove um bloqueio técnico JÁ OBSERVADO em pelo menos dois trabalhos reais no mesmo dia"*. O critério real de decisão dele não está modelado.

Concordância histórica da onda com a ordem de fechamento: **n = 7 pares, 85,7%** — amostra pequena demais para validar coisa alguma, e mede fechamento, não escolha.

> Três heurísticas não validadas concordando continuam sendo zero validação. Aplicar qualquer uma seria fabricar confiança e trocar "Alessandro, manda a próxima" por decisões erradas silenciosas.

## 4. Causa objetiva de cada trilha ambígua

Persistido em `vw_gps_ambiguidade_causa` (read-only, derivado).

| Trilha | Cand. | Causa |
|---|---|---|
| `atribuicao` | 10 | `NENHUM_SINAL_ESTRUTURADO` — as 10 têm `ordem_execucao = 11` e `macro_fase = F4`. É carimbo de fase, não sequência. DAG vazio |
| `conversao_joao` | 7 | `NENHUM_SINAL_ESTRUTURADO` — 3 empatam em `ordem = 1`; DAG vazio; todas `em_andamento` |
| `conversao_julia` | 4 | `REGRAS_DISCORDAM` (3 respostas distintas) |
| `governanca` | 4 | `REGRAS_DISCORDAM` (2 respostas distintas) |
| `retencao` | 2 | `REGRAS_DISCORDAM` (2 respostas distintas) |
| `aprendizado` | 4 | `SINAL_UNICO_NAO_VALIDADO` |
| `identidade` | 4 | `SINAL_UNICO_NAO_VALIDADO` — as 3 regras convergem em `reconciliacao-crm-pixel` |
| `operacao_humana` | 4 | `SINAL_UNICO_NAO_VALIDADO` |
| `erp` | 3 | `SINAL_UNICO_NAO_VALIDADO` |
| `funil` | 2 | `SINAL_UNICO_NAO_VALIDADO` |

O protocolo diz *"ONDA: `ordem_execucao` igual só significa paralelo se a trilha for diferente"*. Em `atribuicao` e `conversao_joao` o próprio modelo declara um conflito que ele não resolve: frentes marcadas com a mesma onda, na mesma trilha, que portanto **não** podem rodar em paralelo — e sem nada que diga qual vem primeiro.

## 5. Dinheiro

**Não criei fórmula financeira nem atribuí ROI.** O motivo é simples: não há base.

| Campo | Preenchido em |
|---|---|
| `impacto_mes_estimado` **com** `impacto_fonte` | **3 de 152** frentes abertas (2,0%) — e uma delas vale `0` |
| `prazo` | **2 de 152** (1,3%) |

As duas medições reais são de 01–02/08 — 15 dias atrás:

- `contas-grandes-encolhidas` — R$ 19.828/mês, *"medido 02/08 no pixel_events por faixa de valor"*, **prazo vencido em 08/08**
- `compra-unica-vazamento` — R$ 3.084/mês, *"decomposição 01/08, 5% de retorno"*

Rankear 152 frentes por um campo preenchido em 2 delas seria inventar. Registro o fato para você: **`contas-grandes-encolhidas` é a maior cifra medida do sistema e está com prazo vencido há 9 dias.** É informação, não regra que apliquei.

## 6. As 9 esperas `decisao_humana`

Contexto estruturado em `vw_gps_espera_humana`. Classificação A/B/C/D:

| Frente | Classe | Fato estruturado |
|---|---|---|
| `edges-fonte-canonica-versionada` | **A** | PAT + liberação de `api.supabase.com`; ambos fora do alcance de qualquer sessão |
| `erp-privilegios-latentes-rls` | **A** | GO/NO-GO de RLS em produção; e o E2E autenticado exige credencial de usuário do ERP |
| `henrique-loop-fechado` | **A** | Flag é env var da Edge; **zero** funções e views do banco a leem; nenhum cron a alterna; o critério exige alguém acompanhando ao vivo |
| `joao-arquivo-lead-canva-producao` | **A** | 4 pré-requisitos na conta Canva da Skillprint, incluindo segredos. **Trava a trilha inteira e tem 7 filhas abertas** |
| `logistica-frenet-fonte-canonica` | **A** | Secrets + painel da Frenet. **Maior alavanca do DAG: desbloqueia 5 frentes** |
| `pack-entrega-sem-confirmacao` | **A** | Toca o caminho de todo pagamento Pix, não só do pack |
| `tiago-execucao-perda-silenciosa` | **A** | Reativar cron 65 tem `dry_run:false`. **Verifiquei: `active=false` confirmado.** O `proximo_passo` da frente aguarda uma rodada que não pode ocorrer — premissa obsoleta |
| `vera-loop-retencao-observavel` | **B** | Escolha entre desenhos já apresentados. Sem credencial, sem risco de produção, sem dado faltante — falta **política escrita** |
| `mapeamento-funil-cerebro` | **D** | Não é decisão sua: é espera por uma *condição* (existir meio seguro de obter o fonte da Edge), a jusante de `edges-fonte-canonica-versionada`. A própria frente argumenta por que não declarou `depende_de` |

**Nenhuma classe C.** Não encontrei falso gate humano — as sessões anteriores classificaram bem. Não forcei uma reclassificação para produzir número melhor.

**5 das 9 travam a trilha inteira:** `joao-arquivo-lead-canva-producao` (P1), `edges-fonte-canonica-versionada`, `pack-entrega-sem-confirmacao`, `tiago-execucao-perda-silenciosa`, `henrique-loop-fechado`. As outras 4 não bloqueiam autonomia — a trilha tem outro trabalho acionável.

## 7. `microloops-23-agentes` — causa raiz medida

Não é uma frente difícil. É **uma frente que não pode fechar**.

- É `macrofrente` guarda-chuva pelo próprio texto: *"Frente guarda-chuva dos loops locais"*
- **11 filhas em 6 trilhas diferentes**, 1 fechada — mas ela mesma mora em `aprendizado`, então capturá-la tranca `aprendizado` enquanto o trabalho real está em outras 5 trilhas
- `criterio_aceite` é conjunção sobre **23 agentes** — estruturalmente não fechável por uma sessão
- O `proximo_passo` declara espera por você (*"Alessandro publica a 151"*, *"aguardando SIM"*) **sem nenhuma espera aberta** — logo `acionavel = true` para sempre

O padrão vale para a classe inteira:

| `tipo_frente` | Frentes | Claims | Claims que mudaram estado |
|---|---|---|---|
| `governanca` | 24 | 38 | **42,1%** |
| `execucao` | 100 | 175 | 31,4% |
| `diagnostico` | 68 | 180 | 25,6% |
| **`macrofrente`** | **15** | **158** | **5,7%** |

**Macrofrentes são 5,5% das frentes e absorvem 28% de todos os 561 claims — com a pior taxa de progresso do sistema, 5,5× abaixo da penúltima. E nenhuma macrofrente jamais foi fechada.** Zero, em toda a história.

Os três maiores sumidouros de claim do sistema são macrofrentes: `microloops-23-agentes` (68), `mapeamento-funil-cerebro` (27), `seguranca-funcoes-anon` (17).

**Correção não aplicada, e por quê.** Excluir macrofrente com filhas abertas do conjunto de candidatas é determinístico e bem evidenciado, mas muda a elegibilidade de 15 frentes e é decisão de modelagem sua, não minha. Fica medida e pronta, não ligada.

## 8. A única correção aplicada

**Uma decisão de rota que você já tomou estava sendo descartada em silêncio.**

`vw_gps_rota_vigente` exige `acionavel`. Quando o alvo escolhido abre uma espera, a rota some da view, e `fn_gps_proxima` volta a responder `AMBIGUA` — isto é, **o GPS pede de novo uma decisão que já foi tomada**. É exatamente a regressão que a missão proíbe.

`fn_gps_proxima` ganhou a chave **aditiva** `rota_registrada`:

```json
"rota_registrada": {
  "frente": "edges-fonte-canonica-versionada",
  "decidido_por": "alessandro",
  "decidido_em": "2026-08-17T03:03:13Z",
  "vigente": false,
  "motivo_nao_vigente": "aguardando:decisao_humana",
  "observacao": "... NAO pedir nova decisao de rota sem revogar a anterior."
}
```

**Prova de aditividade:** nas 18 trilhas ativas, `fn_gps_proxima(t) - 'rota_registrada'` é **igual** à saída da função anterior restaurada do backup. **18/18 idênticas.** Nenhuma situação mudou, nenhum consumidor existente lê nada diferente — o executor inclusive.

## 9. Panorama antes/depois

| Métrica | Antes | Depois |
|---|---|---|
| Trilhas ativas | 18 | 18 |
| `UNICA` | 3 | 3 |
| `AMBIGUA` | 10 | 10 |
| `TODAS_AGUARDANDO` | 4 | 4 |
| `NENHUMA` | 1 | 1 |
| `ROTA_ESCOLHIDA` | 0 | 0 |
| Esperas `decisao_humana` abertas | 9 | 9 |
| Claims ativos | 0 | 0 |

**sha256 do panorama: idêntico ao snapshot anterior.** Isso é o resultado correto — eu não deveria mudar número nenhum sem prova, e não tinha prova.

Post-flight: `vw_frentes_elegiveis` e `fn_frente_claim` com sha256 intacto; executor não alterado; cron 143 `active=false`; `executor_config.habilitado=false`; `go_ai_dev_config` com `allow_*` todos `false`, `mode=observe`, orçamento 20 BRL; `anon`/`authenticated` sem privilégio nos 3 objetos novos; zero advertências novas nos advisors; `frentes_claims_segredo` não lida.

## 10. O que de fato tira você do loop

O mecanismo já existe e foi usado **uma vez**: `gps_rota_decisao`. Uma decisão de rota por trilha, registrada, **persistente** — não precisa ser repetida. As 10 trilhas estão `AMBIGUA` porque 10 decisões nunca foram registradas, não porque o GPS não saiba decidir.

Dois caminhos, ambos seus:

1. **Registrar a rota** de cada trilha ambígua — 10 decisões, uma vez cada, e o executor passa a alcançá-las para sempre.
2. **Tornar a rota derivável**: dar `ordem_execucao` distinta dentro da trilha, ou declarar `depende_de` entre as candidatas. Em `atribuicao` (10 frentes com a mesma onda e DAG vazio) qualquer um dos dois resolve sozinho.

O caminho 2 escala melhor: elimina a decisão em vez de registrá-la.

## 11. Objetos criados e rollback

| Objeto | Papel |
|---|---|
| `vw_gps_ambiguidade_causa` | Read-only. Mede as 3 regras por trilha e diz se concordam |
| `vw_gps_espera_humana` | Read-only. Contexto estruturado das esperas humanas; não interpreta prosa |
| `backup_gps_cobertura_20260817` | Definição anterior de `fn_gps_proxima` + panorama antes |

```sql
-- reverter
drop view public.vw_gps_ambiguidade_causa;
drop view public.vw_gps_espera_humana;
-- restaurar a definicao guardada em backup_gps_cobertura_20260817.obj='fn_gps_proxima'
```

Reverter não altera frente, espera, claim ou rota alguma.

## 12. Limites honestos

1. O gabarito de decisão de rota tem **n = 1**. Ele refuta a regra da onda; não valida nenhuma outra.
2. `identidade` é o único caso em que as três regras convergem (`reconciliacao-crm-pixel`). Não apliquei: convergência entre heurísticas minhas não é corroboração pelo sistema. Registro como o candidato mais forte caso você queira ratificar.
3. A medição de progresso por `estado` do claim é confundida por sobrevivência — uma frente vira `em_andamento` *porque* foi capturada. Por isso não usei essa comparação para sustentar nem para refutar a regra WIP.
4. A classificação A/B/C/D é leitura minha das descrições, apoiada em fatos que verifiquei por estrutura (cron 65 `active=false`, flag ausente de funções e views, 7 filhas abertas). Não a persisti no banco: não vou gravar julgamento meu como se fosse derivação.
