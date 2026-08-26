# R64 — Contrato econômico das frentes

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx`
**Modo:** READ-ONLY para descobrir; estrutura NOVA e isolada depois dos gates.
**Zero** alteração em `frentes.prioridade`, executor, `fn_gps_proxima`, filas, agentes, gating ou dinheiro.

**Regra central:**
> Não perguntar apenas "quanto vale esta frente?" — perguntar qual realidade econômica ela
> altera, quanto vale, em qual horizonte, com que confiança, e se pode ser executada agora.

---

## §0 — Reancoragem R63 (LIVE, tudo confirmado)

Seleção real em `fn_executor_proxima_tarefa` (hash `7a261cf2…` inalterado) · `fn_gps_proxima`
(`b23bbec4…`) e `fn_executor_tick` (`f59aa14e…`) inalteradas · ordenação real segue sendo
`prioridade, precedencia_trilha` · `fn_mapa_cerebro_v0` intacta · gating intacto · shadow da
R63 isolado · 0 objetos existentes alterados.

---

## §2 — A hipótese B foi testada contra A, e A caiu

**A. Campos em `frentes` — refutado por evidência, não por preferência.**
O trigger `fn_frentes_versionar_campos` versiona **exatamente 5 campos**, todos hardcoded:
`bloqueio`, `criterio_aceite`, `evidencia`, `onde_paramos`, `proximo_passo`.
`impacto_mes_estimado` **não está entre eles** — qualquer reavaliação seria um UPDATE
destrutivo sem histórico, e a R64 precisa exatamente do contrário. Uma coluna também só
comporta uma métrica por frente.

**Tentei reutilizar `ricardo_recomendacoes`** (que já tem `impacto_esperado`,
`impacto_unidade`, `horizonte_dias`, `confianca`, `evidencias`). Também caiu:
42 linhas, todas `status='proposta'`, `impacto_esperado` preenchido em **0 de 42**,
`resultado_real` em 0 de 42, e **0 linhas referenciam qualquer frente**. É uma fila de
propostas de um agente, não um livro econômico das frentes.

**Achado colateral que importa:** a palavra "impacto" já tem dois sentidos no schema.
`gps_autoridade_frente.impacto_financeiro_max_brl` é **teto de autoridade** (quanto um worker
pode arriscar), não avaliação de impacto. Por isso o contrato novo não usa a palavra sozinha.

→ **B vence.** Tabela separada, append-only, com histórico.

---

## §3 — `frente_economia`

```
frente_id → frentes(id)         territorio      metrica         direcao
valor · unidade · horizonte     confianca + confianca_motivo
evidencia_tipo · evidencia_ref  metrica_mapa (a ponte §14)
medido_em · valido_ate          status · refuta_id
```

Nenhum campo decorativo: cada um é usado por uma regra ou por uma view.

### As regras são do banco, não da convenção

Seis guardas testadas contra inserções inválidas — **todas rejeitaram**:

| tentativa | resultado |
|---|---|
| `UPDATE` de um valor já registrado | rejeitado (append-only) |
| `DELETE` | rejeitado (append-only) |
| valor monetário com `horizonte='INDETERMINADO'` | rejeitado (`ck_valor_exige_horizonte`) |
| `ESTIMATIVA_HUMANA` declarada `confianca='ALTA'` | rejeitado (`ck_estimativa_nao_e_alta`) |
| `territorio='VENDAS'` (fora do vocabulário) | rejeitado (CHECK) |
| `status='REFUTA'` sem `refuta_id` | rejeitado (`ck_refuta_aponta`) |

Reavaliar = INSERT de nova linha. Refutar = INSERT com `status='REFUTA'` apontando o que refuta.

**Vocabulários controlados (§4/§5/§6/§7/§8):**
território `CLIENTE MARKETING PRODUTO MARGEM FINANCEIRO PRODUCAO LOGISTICA SISTEMA` ·
métrica `RECEITA_EM_RISCO RECEITA_POTENCIAL MARGEM_POTENCIAL CUSTO_EVITAVEL RECEITA_RECORRENTE CAPACIDADE_OCIOSA PERDA_OPERACIONAL` ·
direção `GANHO_POTENCIAL PERDA_ATUAL RISCO CUSTO EFICIENCIA` ·
horizonte `D7 D30 D90 ONE_OFF INDETERMINADO` · confiança `ALTA MEDIA BAIXA`.

---

## §11/§15 — O canário `contas-grandes-encolhidas`

A tabela responde literalmente a pergunta da §15:

| medido_em | valor | horizonte | confiança | evidência |
|---|---|---|---|---|
| **02/08** | R$ 19.828 | D30 | BAIXA | `ESTIMATIVA_HUMANA` |
| **26/08** | R$ 23.204,88 | **ONE_OFF** | MEDIA | `QUERY_MEDIDA` |

A linha de 02/08 **não foi sobrescrita**. E a mudança que mais importa não é o valor — é o
**horizonte**: R$ 19.828 estava declarado como *mensal* sem modelo causal; a medição da R63/R64
mostra uma **diferença pontual acumulada**, não um fluxo que se repete. Por isso `ONE_OFF`.

Reancorado: 123 clientes já compraram ≥ R$ 800; dos 62 que voltaram, **31 encolheram e 31
mantiveram** (50/50); soma (maior − última) entre os 19 encolhidos ativos em 90d = R$ 23.204,88.

**FENÔMENO: PROVADO. MAGNITUDE MENSAL: NÃO PROVADA.** O contrato registra os dois separados,
sem inflar.

---

## §12 — Caso de controle: `taxonomia-produto`

| | `taxonomia-produto` | `contas-grandes-encolhidas` |
|---|---|---|
| território / métrica | MARGEM / MARGEM_POTENCIAL | CLIENTE / RECEITA_EM_RISCO |
| direção | RISCO | PERDA_ATUAL |
| valor | R$ 38.231,32 | R$ 23.204,88 |
| **horizonte** | **D30 (fluxo)** | **ONE_OFF (pontual)** |
| comparabilidade | `FLUXO_D30` | `NAO_COMPARAVEL_COM_FLUXO` |
| **acionabilidade** | **EXECUTAVEL** | **BLOQUEADO_HUMANO** |

**O contrato distingue exatamente o que a §12 pediu.** Os dois valores são da mesma ordem de
grandeza e o contrato ainda assim os separa — por horizonte e por acionabilidade, não por
tamanho.

Medição do controle: nos últimos 30 dias, **46 de 300 compras (R$ 38.231,32 de R$ 114.471,72,
33,4%) estão sem `product_type`** e portanto sem margem calculável.

### Por que a confiança é MEDIA e não ALTA

O **valor** é canônico (ALTA). A **ponte causal** é que é parcial, e isso rebaixa a avaliação:
das 46 compras, **0** são copo, caneca ou brinde — a entrega descrita no título da frente
responde por **zero** do dinheiro medido. As 41 que têm `content_category` preenchido trazem
**segmento de cliente** (`catolicos`, `evangelicos`, `terceirao`, `uniformes`, `dono_de_marca`,
`diversos`), **não produto**: a causa real é falha da cadeia derivada
`product_type ← content_category`, não item fora de cadastro.

O `criterio_aceite` da frente ("pixel_events deixando de receber valor fora do domínio") cobre
o domínio — por isso a ponte é parcial e não inexistente.

---

## §13 — Cobertura (127 frentes vivas)

| classe | n |
|---|---|
| acionáveis | 28 |
| com valor econômico declarado | **2** |
| com valor declarado **e** acionáveis | **1** (e seu valor declarado é R$ 0) |
| citam R$ no texto livre, sem valor estruturado | 27 |
| citam economia sem número | 82 |
| sem relação econômica no texto | 16 |
| **acionáveis sem nenhum dado econômico** | **27 de 28** |

`UNKNOWN` é a resposta majoritária, e ela fica registrada como tal. Nada foi preenchido
automaticamente.

---

## §14 — A ponte é declarada, não inferida

Cada avaliação aponta `metrica_mapa` (`estado.cliente_economico.concentracao`,
`estado.margem_por_familia.receita_sem_margem`) e `evidencia_ref` com a medição reproduzível.

**Casamento lexical foi usado exatamente uma vez — como teste, e falhou.** Buscar `%campanha%`
(R63) elegeu um bug de timeout de cron; buscar copo/caneca/brinde nos R$ 38.231,32 devolveu
**0**. Por isso a ponte agora é um campo, não uma busca.

---

## §16/§17 — Views

`vw_frentes_economia_atual` — só a avaliação vigente por (frente, métrica), com `idade_dias`,
`expirada`, `acionavel` e `situacao_execucao`.

`vw_frentes_economia_componentes` — **os quatro componentes separados, sem score agregado**:
`c_valor` · `c_confianca` (+ordem) · `c_frescor` · `c_acionabilidade`, mais
`c_comparabilidade`. A regra de ordenação vai escrita dentro da própria view:

> ordenar por confiança primeiro, depois valor, e só entre horizontes iguais.
> **BAIXA nunca vence ALTA por valor maior. ONE_OFF nunca compara com D30.**

Nenhum score mágico foi criado.

---

## §18 — Replay OLD × shadow econômico estruturado

Candidato executável = tem economia vigente **e** `acionavel=true` → hoje só `taxonomia-produto`.

| | |
|---|---|
| ticks (10d) | 931 |
| decisões com escolha | 798 |
| OLD escolheu o candidato | **0** |
| divergências | **798 (100%)** |
| bloqueados economicamente relevantes | 1 · R$ 23.204,88 |
| acionáveis sem dados econômicos | 27 |

**Causa exata, provada agora:** há 9 frentes elegíveis simultaneamente.
`fn_gps_proxima('erp')` retorna `situacao=UNICA, frente=taxonomia-produto` — ela é hoje a única
acionável da trilha `erp` (as de prioridade 1 e 2 estão fechadas, bloqueadas ou aguardando
humano). Mas `fn_executor_proxima_tarefa` ordena **por `prioridade` antes de tudo**, e
`gps-microloops-23-membresia-fechamento` tem prioridade **1** contra **3**.

**Esta divergência é diferente da R63.** Lá o candidato estava bloqueado e a divergência era
inválida. Aqui o candidato **é executável agora** e foi preterido apenas por um `smallint`
gravado à mão.

---

## §19 — `BLOQUEIO_HUMANO_COM_IMPACTO_ECONOMICO`

Saída separada (`vw_bloqueio_humano_com_impacto`), gerencial, que **não vira prioridade**:

`contas-grandes-encolhidas` · CLIENTE / RECEITA_EM_RISCO · R$ 23.204,88 ONE_OFF ·
espera `acao_humana` aberta em 19/08 · **7,0 dias** · *"HUMANO: Tamires contata os 4…"*.

---

## §20 — Auto-refutação

| tentativa de matar | resultado |
|---|---|
| valores não são comparáveis? | **PROCEDE, e o contrato já trata**: D30 e ONE_OFF ficam marcados `NAO_COMPARAVEL_COM_FLUXO` |
| horizonte está errado? | **PROCEDIA na leitura antiga**: R$ 19.828 estava como mensal sem modelo causal → corrigido para ONE_OFF |
| impacto é só diferença pontual? | **SIM** para contas-grandes; registrado como tal, não como fluxo |
| frente não é causalmente ligada ao gap? | **PROCEDE PARCIALMENTE** para `taxonomia-produto`: 0 dos R$ 38.231,32 vêm de copo/caneca/brinde → confiança rebaixada para MEDIA com o motivo escrito |
| dado velho? | não: ambas com 0,0 dia, `valido_ate` em 30 dias |
| confiança inflada? | não: o único candidato ALTA possível seria a estimativa humana, e o CHECK do banco proíbe |
| outra frente resolve o mesmo gap? | não: só `loop-global-vendas-previsiveis` toca o domínio, e está **não acionável** |
| frente está bloqueada? | contas-grandes **sim** (7 dias); taxonomia **não** |
| impacto realmente mensurável? | sim nos dois casos, com query reproduzível |
| **o candidato vence por mérito econômico?** | **NÃO — e este é o achado mais importante.** `taxonomia-produto` é a única das 28 acionáveis com qualquer dado econômico (27 sem). Ela ganha por **viés de cobertura**, não por ser a maior. Chamar isso de "melhor frente econômica" hoje seria falso. |

---

## §21 — Veredito

**`CONTRATO_ECONOMICO_FRENTES_VALIDADO`** — a estrutura sustenta o que a rodada pediu: métrica,
direção, horizonte, confiança, evidência, ponte explícita e histórico, com as regras impostas
pelo banco (6 de 6 guardas rejeitando) e não por disciplina.

**`PONTE_MAPA_FRENTE_INSUFICIENTE`** — em cobertura. 1 frente de 28 acionáveis tem economia
medida. Com 27 vazias, qualquer ordenação econômica hoje é ordenação de amostra de uma.
O contrato está pronto; os dados não.

---

## §22 — Próximo passo

R65 pode conectar a chave ao GPS **em shadow** — mas só depois de cobrir mais frentes
acionáveis, senão o shadow vai "escolher" a única que foi medida. Ordem sugerida:

1. Avaliar economicamente as **27 acionáveis sem dado** (ou marcá-las explicitamente
   `SEM_RELACAO_ECONOMICA_DIRETA` — `UNKNOWN` registrado vale mais que vazio).
2. Corrigir a causa real do gap de margem: a cadeia `product_type ← content_category` está
   recebendo **segmento de cliente** onde deveria haver produto. Isso é maior que a frente
   `taxonomia-produto` como está escrita hoje.
3. Só então ordenar em shadow por confiança → valor → frescor, entre horizontes iguais e só
   entre frentes acionáveis.

---

## Objetos desta rodada

**Criados:** `frente_economia` (tabela append-only), `fn_frente_economia_append_only()` +
trigger, `vw_frentes_economia_atual`, `vw_frentes_economia_componentes`,
`vw_bloqueio_humano_com_impacto`. 3 linhas de avaliação registradas.

**Alterados:** nenhum. **Removidos:** nenhum.

Verificado após a escrita: 0 frentes criadas, 0 atualizadas, 0 versões de campo geradas,
0 esperas encerradas, 0 crons novos, 0 consumidores de produção;
`fn_executor_proxima_tarefa`, `fn_gps_proxima`, `fn_executor_tick`, `fn_mapa_cerebro_v0` e o
gating com hashes idênticos.

Rollback: `DROP VIEW vw_bloqueio_humano_com_impacto, vw_frentes_economia_componentes,
vw_frentes_economia_atual; DROP TABLE frente_economia; DROP FUNCTION fn_frente_economia_append_only();`
