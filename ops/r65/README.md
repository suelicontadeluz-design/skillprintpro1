# R65 — Censo econômico das frentes acionáveis

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY para classificar; registro pelo contrato append-only da R64.
**Zero** alteração em `frentes.prioridade`, executor, GPS, filas, agentes, esperas ou dinheiro.

**Regra central:**
> Não precisamos saber quanto vale toda frente. Precisamos saber, para TODA frente, se há
> impacto econômico direto, indireto, incerto, ou nenhum diretamente mensurável.

---

## §0 — Reancoragem R64 (LIVE)

Contrato íntegro (3 linhas, trigger append-only ativo) · `fn_executor_proxima_tarefa`
`7a261cf2…`, `fn_gps_proxima` `b23bbec4…`, `fn_executor_tick` `f59aa14e…`,
`fn_mapa_cerebro_v0` `001b8bd6…` e o gating **todos inalterados** · nenhuma priorização
econômica em produção · **28 frentes acionáveis** (mesmo número da R64; o conjunto foi
reconstruído do zero, não assumido).

---

## §14 — Cobertura: **28/28 = 100% classificadas**

| classificação | n |
|---|---|
| SEM_RELACAO_ECONOMICA_DIRETA_PROVADA | **15** |
| ECONOMICA_PARCIAL | **6** |
| UNKNOWN | **5** |
| ECONOMICA_MEDIDA | **2** |

Nenhuma frente sumiu do censo. `UNKNOWN` foi registrado como `UNKNOWN`, com o motivo escrito
— nunca como `NULL`, e nunca como "sem relação".

---

## §15 — Onde a classificação vive

O contrato da R64 não sabia dizer "isto não é econômico" nem "isto não foi investigado" sem
falsificar uma avaliação. Criei a forma mínima auditável:

`frente_economia_censo` — append-only, uma linha por (rodada, frente), com `classificacao`,
`territorio_primario/secundario`, `grandeza_primeira`, `ligacao_ao_dinheiro`
(`DIRETA` / `INDIRETA` / `NAO_PROVADA`), `base_da_classificacao`, `justificativa` e
`avaliacao_id` apontando para a medição no contrato R64 quando ela existe.

Duas guardas de banco impedem a falsificação:
- `ck_medida_exige_avaliacao` — `ECONOMICA_MEDIDA` sem avaliação registrada é rejeitado.
- `ck_unknown_sem_ficcao` — `UNKNOWN` não pode receber território nem ligação inventada.

**§6 também exigiu ampliar o vocabulário de métrica**, para não forçar reais onde eles não
existem: acrescentados `CAPACIDADE_LIBERADA`, `CONVERSAO`, `RETENCAO`, `QUALIDADE_DO_DADO`,
`RISCO_OPERACIONAL`; unidades `LEADS` e `EVENTOS`. Foi a única mudança no contrato R64.

---

## §2/§4/§5 — As classes, com a cadeia causal

### ECONOMICA_MEDIDA (2)

| frente | grandeza primeira | métrica | valor | horizonte | conf. | → dinheiro |
|---|---|---|---|---|---|---|
| `playbooks-cobrir-buracos-forca` | fração de objeções tratadas com playbook | CONVERSAO | **112** EVENTOS | D30 | ALTA | INDIRETA |
| `isabela-ofertas-nao-chegam` | cobertura de oferta na objeção | CONVERSAO | **187** LEADS | D30 | ALTA | INDIRETA |

Medições: em 30 dias houve **221 objeções de 187 leads**; **109 (49,3%) receberam playbook e
112 não**; ocorreram **27 combinações tipo×força** e existem **14 playbooks ativos** → 13
buracos. Eficácia observada dos playbooks: 539 usos, 105 conversões (**19,5%**).
Para `isabela`: 187 de 1237 leads criados em 30d = **15,1%**; o critério da própria frente
declara 152/1127 = 13,5% — a ordem de grandeza confere.

**Nenhuma das duas virou reais.** Não há modelo causal provado de "objeção tratada → receita",
e §6 proíbe inventar a conversão.

### ECONOMICA_PARCIAL (6)

`taxonomia-produto` (MARGEM) · `atrib-instrumentar-execucao` (MARKETING) ·
`religar-calcme-fonte-canonica` (FINANCEIRO) · `previsibilidade-de-vendas` (FINANCEIRO) ·
`fidelimax-ligar-fidelidade` (CLIENTE) · `joao-parametro-financeiro-sem-proveniencia` (MARGEM)

### SEM_RELACAO_ECONOMICA_DIRETA_PROVADA (15)

Governança, observabilidade, invariantes e dívida técnica. Três delas **com grandeza medida**,
porque medir não obriga a monetizar:

- `crons-sucesso-sem-efeito`: 93 crons ativos, **38.030 execuções em 7 dias, 38.030
  `succeeded` (100%)**. A premissa da frente medida e confirmada — e é exatamente por não se
  saber quanto efeito de negócio há por trás que monetizar seria inventar.
- `metas-sem-formula`: **85 de 131 metas ativas sem `formula_sql` (64,9%)**. A frente declara
  89/128; a diferença é deriva da base, não discordância.
- `atrib-instrumentar-execucao` (esta ficou em PARCIAL): **28.898 decisões de agente em 30
  dias, ZERO com `execution_event_id`**.

### UNKNOWN (5)

`joao-dtf-textil-jeans-compatibilidade` · `joao-polo-composicao-piquet-50-50` ·
`joao-shadow-fase-vivo` · `julia-end-turn-sem-guardrail` · `julia-pivot-produto-errado`

Li o critério de aceite de todas. Não medi o fenômeno de nenhuma. `joao-shadow-fase-vivo` nem
critério de aceite tem. **Não classifico como econômica sem medir.**

---

## §11 — `taxonomia-produto` foi rebaixada

Era o canário da R64 com R$ 38.231,32 D30. **Não foi protegido.**

O valor continua medido em fonte canônica, mas a cadeia causal derrubou a atribuição à frente:
das 46 compras sem `product_type`, **zero** são copo, caneca ou brinde. As 41 que têm
`content_category` preenchido trazem **segmento de cliente** (`catolicos`, `evangelicos`,
`terceirao`, `uniformes`, `dono_de_marca`), não produto. A causa medida é falha da cadeia
derivada, não item fora de cadastro.

→ **ECONOMICA_PARCIAL**: fenômeno provado, causa da frente parcial.

---

## §12 — `contas-grandes-encolhidas` preservada como controle

Fora do universo R65 por não ser acionável (`aguardando:acao_humana` há 7 dias). O registro da
R64 continua íntegro: fenômeno **provado**, R$ 23.204,88 como observação **ONE_OFF**, magnitude
mensal **não provada**, e a crença de 02/08 (R$ 19.828/D30, `ESTIMATIVA_HUMANA`, BAIXA)
preservada ao lado da medição de 26/08.

---

## §13 — Contraexemplos: 3 de 4 encontrados

| pedido | encontrado |
|---|---|
| comercial aparente **sem** impacto mensurável | **sim** — `joao-dtf-textil-jeans-compatibilidade` e `joao-polo-composicao-piquet-50-50` são "P0 COMERCIAL" no título e terminaram `UNKNOWN` |
| valor alto, confiança BAIXA | **sim** — `contas-grandes-encolhidas` em 02/08: R$ 19.828 com `ESTIMATIVA_HUMANA`/BAIXA, hoje superada por uma medição menor e mais confiável |
| valor menor, confiança ALTA | **sim** — `playbooks` (112 EVENTOS, ALTA) contra `taxonomia-produto` (R$ 38.231,32, MEDIA) |
| técnica aparente com impacto econômico **direto provado** | **NÃO ENCONTRADO** |

O quarto não existe nesta base. `taxonomia-produto` é a mais próxima — técnica, com valor em
reais medido — mas a ponte causal é parcial, então não serve como prova. Registro a ausência
em vez de forçar um exemplo.

---

## §16/§18 — Comparabilidade: **zero pares**

Seis avaliações com valor, e cada uma sozinha no seu grupo `métrica|unidade|horizonte`:

| grupo | n |
|---|---|
| `MARGEM_POTENCIAL｜BRL｜D30` | 1 |
| `CONVERSAO｜EVENTOS｜D30` | 1 |
| `CONVERSAO｜LEADS｜D30` | 1 |
| `QUALIDADE_DO_DADO｜EVENTOS｜D30` | 1 |
| `QUALIDADE_DO_DADO｜UNIDADES｜ONE_OFF` | 1 |
| `RISCO_OPERACIONAL｜EVENTOS｜D7` | 1 |

`COMPARAVEL_FORTE = 0` · `COMPARAVEL_PARCIAL = 0` · `NAO_COMPARAVEL = 23` · `UNKNOWN = 5`

**Seis medições, seis grupos de um.** Não existe competição econômica hoje — nem entre duas
frentes.

O par mais próximo: `playbooks` e `isabela` são ambas CONVERSAO, D30, ALTA, e diferem **só na
unidade** (EVENTOS × LEADS). Medir as duas na mesma unidade é o caminho mais curto para o
primeiro par legítimo.

---

## §17 — Nenhum score criado

Componentes continuam separados (`vw_censo_comparabilidade` expõe métrica, valor, unidade,
horizonte, confiança, idade e acionabilidade lado a lado). Com seis pontos em seis grupos, uma
fórmula `valor × confiança × frescor` só produziria ordenação de amostra de um.

---

## §20 — Auto-refutação

| tentativa | resultado |
|---|---|
| impacto não pertence à frente? | **PROCEDE** em `taxonomia-produto` → rebaixada a PARCIAL |
| valor inflado? | **PROCEDE** no histórico: R$ 19.828/mês era estimativa humana sem modelo causal |
| horizonte arbitrário? | corrigido: `metas-sem-formula` é ONE_OFF (estoque de cadastro), não fluxo mensal |
| métrica deveria ser operacional, não financeira? | **PROCEDE em 5 das 6 medições** — só `taxonomia-produto` ficou em BRL |
| outra frente é a causa verdadeira? | **PROCEDE parcialmente**: `playbooks` e `isabela` medem a mesma tabela (`lead_objections`) na mesma janela — 112 objeções sem playbook, 101 leads. Há risco de dupla contagem se um dia forem somadas. Registrado. |
| dado velho? | não: todas as 6 medições com 0,0 dia e `valido_ate` em 30 dias |
| confiança alta demais? | as 5 medições ALTA são contagens diretas e reproduzíveis; a única em BRL ficou MEDIA |
| `religar-calcme` tem os ~11% que declara? | **NÃO VERIFICÁVEL** — o lado pixel confere exatamente (R$ 86.077,25 em 244 compras, julho), mas `calcme_pedidos` está **congelada desde 10/02/2026** (0 pedidos nos últimos 90 dias). Fenômeno plausível, magnitude irreprodutível → PARCIAL, sem valor. |

---

## §21 — Gate para a R66: **NÃO AUTORIZADO**

| condição | exigido | obtido |
|---|---|---|
| cobertura de classificação | 100% | **100% (28/28)** ✓ |
| frentes acionáveis com avaliações comparáveis | ≥ 2 | **0** ✗ |

A primeira condição passou. A segunda falhou por completo — não há sequer um par.

---

## §22 — Veredito

**`COBERTURA_CLASSIFICADA_MAS_NAO_COMPARAVEL`**

Toda frente acionável agora tem uma resposta explícita para "há impacto econômico direto,
indireto, incerto ou nenhum mensurável?". Nenhuma resposta foi inventada e nenhum valor foi
preenchido para inflar cobertura — 22 das 28 seguem sem valor, de propósito.

Mas classificar não é comparar. Com seis medições em seis unidades e horizontes diferentes, um
GPS econômico ainda não tem o que ordenar.

---

## Próximo passo

1. **Fechar o primeiro par comparável.** `playbooks` e `isabela` já compartilham métrica,
   horizonte e confiança — falta unidade comum. É a menor distância até dois pontos
   ordenáveis, e resolve de passagem o risco de dupla contagem entre elas.
2. **Investigar os 5 UNKNOWN**, começando pelos dois "P0 COMERCIAL" do João: se o fenômeno for
   real e frequente, sai da classe UNKNOWN com métrica de conversão medida.
3. **Não converter nada em reais** sem modelo causal. Cinco das seis medições desta rodada são
   operacionais e devem continuar assim até haver conversão provada.
4. `religar-calcme-fonte-canonica` precisa da fonte de volta antes de qualquer avaliação: sem
   `calcme_pedidos` viva, o critério da frente não é verificável.

---

## Objetos desta rodada

**Criados:** `frente_economia_censo` (append-only) + `fn_censo_append_only()` e trigger ·
`vw_censo_comparabilidade`.
**Alterados:** `frente_economia` — apenas os CHECKs de `metrica` e `unidade`, ampliados (§6).
**Registrados:** 5 novas avaliações em `frente_economia`, 28 classificações em
`frente_economia_censo`.

Verificado após a escrita: 0 frentes criadas ou atualizadas, 0 versões de campo, 0 esperas
encerradas, 0 crons novos, executor/GPS/tick com hashes idênticos, nada ligado à produção.

Rollback: `DROP VIEW vw_censo_comparabilidade; DROP TABLE frente_economia_censo;
DROP FUNCTION fn_censo_append_only();` — as 5 avaliações novas permanecem no contrato R64 por
serem append-only e verdadeiras.
