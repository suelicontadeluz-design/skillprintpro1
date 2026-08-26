# R56 — contrato de leitura economica para venda sem lead

Rodada READ-ONLY de 2026-08-26. **Zero DDL, INSERT, UPDATE, DELETE, deploy,
backfill e criacao de identidade.**

## Veredito

**CONTRATO_LEITURA_DEFINIDO**

Uma recomendacao, nao varias: **`pixel_events` nao muda; a venda sem lead vive
na camada de identidade; a leitura de CLIENTE passa a resolver por identidade,
e a leitura de AQUISICAO continua exigindo lead.**

---

## §0 — Reconciliacao da R55: eu estava errado em tres casos, nao em um

A R55 declarou "12 deals PESSOA_PROVADA, R$7.109,64" no §1 e depois, na propria
auto-refutacao, rebaixou Dudalippe para `provavel` **sem recalcular o bloco**.
Contradicao real, e ao reabrir descobri que **Dudalippe nao era o unico problema**.

Regra aplicada uniformemente, que a R55 nao tinha explicitado:

> **PROVADA** = ligacao deal→pessoa por **chave de maquina** (telefone do nome do
> deal casando com o telefone do ERP) **e** corroborada por documento **e** por nome.
> **PROVAVEL** = ligacao so por nome, ou sem documento, ou com nome divergente.

| caso | por que caiu |
|---|---|
| **Dudalippe Personaliados** | ERP **sem documento**; deal sem telefone (`123458`); so o nome liga |
| **AUTERA AUDIO E VIDEO** | deal **nao tem telefone**; a ligacao deal→ERP e **por nome de empresa**. A cadeia CNPJ→telefone→lead e *posterior* ao elo fraco, nao o reforca |
| **Marcos Protec** | telefone casa, mas o deal diz **"Marcos Ferreira"** e o ERP diz **"Marcos Protec Segurança Eletrônica"**. Sobrenome divergente. **A R43 ja tinha recusado exatamente esse padrao** (caso Promove Arte, telefone possivelmente compartilhado) — segui meu proprio precedente |

### Numeros corretos

| classe | deals | pessoas | valor |
|---|---:|---:|---:|
| **PESSOA_PROVADA** | **9** | **7** | **R$5.250,41** |
| **PESSOA_PROVAVEL** | **3** | 3 | R$1.859,23 |
| **SEM_EVIDENCIA** | **12** | — | R$7.392,95 |
| **total ainda ausente** | **24** | — | **R$14.502,59** |

PROVADAS: Gabriela Anjos (3 deals), Evaldo de Melo Correa, Mateus Rodrigues
Amorim, Guilherme França, Bozzi Transportes, Thiago Cardoso Couto, Victória
Homercher.

Consistencia que confirma a regra: **os 2 deals sem telefone no nome (Autera e
Dudalippe) sao exatamente 2 dos 3 PROVAVEL.** Nao e coincidencia — e a regra
funcionando.

**Nada nesta rodada usa "12 provados".**

---

## §1 — Semantica fixada

| conceito | responde | fonte |
|---|---|---|
| **LEAD** | *"por onde chegou?"* | `leads_marketing` — aquisicao, conversa, origem |
| **IDENTIDADE COMERCIAL** | *"quem e o cliente?"* | `identidade_comercial` |
| **DEAL** | *"o que comprou, quanto e quando?"* | RD, `canonical_deal_id` |

`deal + identidade + zero lead` e um estado **valido**. E nao autoriza inferir
campanha, first-touch, CAC, UTM nem origem.

---

## §2/§3 — Os 34 consumidores por dominio

| dominio | deal basta? | identidade necessaria? | lead necessario? | classe |
|---|:--:|:--:|:--:|---|
| receita comercial | **sim** | nao | **nao** | **A** |
| canonical deals | **sim** | nao | **nao** | **A** |
| clientes unicos | nao | **sim** | **nao** | **A** |
| recompra | nao | **sim** | **nao** | **A** |
| frequencia | nao | **sim** | **nao** | **A** |
| LTV | nao | **sim** | **nao** | **A** |
| ticket por cliente | nao | **sim** | **nao** | **A** |
| receita por cliente | nao | **sim** | **nao** | **A** |
| **coorte de CLIENTE** | nao | **sim** | **nao** | **A** |
| **coorte de AQUISICAO** | nao | sim | **SIM** | **B** |
| CAC | nao | sim | **SIM** | **B** |
| CPL | nao | nao | **SIM** | **B** |
| ROAS | nao | nao | **SIM** | **B** |
| atribuicao / campanha / UTM | nao | nao | **SIM** | **B** |
| score de qualidade de campanha | nao | nao | **SIM** | **B** |
| scorecards de agente (`vw_org_*`) | nao | nao | **SIM** | **B** |
| ticket medio global | — | — | — | **C** (numerador e denominador de fontes diferentes) |
| MAPA economico | **sim** | **sim** | **nao** | **A + C** |
| metas | **sim** | nao | **nao** | **A** |
| Dora | **sim** | parcial | **nao** | **A** |
| shadow / coorte de midia | nao | nao | **SIM** | **B** |

`D — indeterminado`: **2 views** (`vw_org_caio_fila_dia_auditoria`,
`vw_org_isabela_leads_prioritarios`) tem LEFT **e** INNER JOIN com
`leads_marketing`; a leitura estatica nao decide qual carrega o lead. Nao
promovi a nenhuma classe.

### Impacto real nos 34 — e ele e zero

**Sob o desenho recomendado, `pixel_events` nao recebe nenhuma linha nova.**
Logo:

| classe | n |
|---|---:|
| **SEM_MUDANCA** | **34** |
| GANHA_DEALS_SEM_LEAD | 0 |
| CONTINUA_EXIGINDO_LEAD | 0 |
| PRECISA_REESCRITA | 0 |

A mudanca deixa de ser um efeito colateral e vira **decisao explicita, uma view
por vez**. As candidatas do dominio A a serem reescritas depois, em rodada
propria: `vw_clientes_recorrentes_chat`, `vw_cliente_frequencia_status`,
`vw_dora_bcg`, `vw_conferencia_vendas_campanha` e o que o MAPA consumir.
**Nenhuma reescrita nesta rodada.**

Isso corrige o alerta com que fechei a R55 ("mudar isso muda numero de gente"):
sob o desenho C **nao muda nada sozinho**.

---

## §4 — Receita

Base viva em 2026-08-26 (subiu desde a R53 por vendas novas do dia):

| medida | valor | eventos |
|---|---:|---:|
| **RECEITA_COMERCIAL_TOTAL** | R$639.909,03 | 1.599 |
| RECEITA_COM_LEAD | R$639.909,03 | 1.599 |
| RECEITA_SEM_LEAD | **R$0,00** | **0** |
| **RECEITA_ATRIBUIVEL** (com `campaign_id`) | **R$74.744,86** | 366 |
| RECEITA_NAO_ATRIBUIDA | R$565.164,17 | 1.233 |

**Hoje 88,3% da receita ja e nao atribuivel.** Esse numero e o que desarma o
medo do §8: as 9 vendas provadas entram num balde que ja domina a base — nao
criam uma categoria nova, engrossam a que ja e maioria.

E `RECEITA_SEM_LEAD = R$0,00` confirma que a convencao "todo Purchase tem lead"
e absoluta hoje, nao aproximada.

---

## §5 — Clientes unicos: o erro ja existe, e e mensuravel

| criterio | hoje |
|---|---:|
| `COUNT(DISTINCT lead_id)` | **504** |
| `COUNT(DISTINCT identidade)` — `COALESCE(lead→pessoa, lead_id)` | **502** |

**O sistema conta hoje 2 clientes a mais do que existem.** Sao os 5 leads
compradores da R49 colapsando em 3 identidades (Vanessa, Kleberson, Igreja).

Isso responde ao §7 do enunciado com um sim medido: **existem consumidores hoje
confundindo multiplos leads com multiplos clientes.** Nao e hipotese.

Repeat buyers: **216 por lead** vs **215 por identidade** — mesma distorcao.

---

## §6 — Recompra e LTV sem lead: provado

Simulado sobre as 7 pessoas PROVADAS, usando apenas `deal → identidade`:

| pessoa | deals | LTV | perfil |
|---|---:|---:|---|
| **Gabriela Anjos** | **3** | **R$2.939,50** | **recompra, 43 dias** |
| Evaldo de Melo Correa | 1 | 739,00 | compra unica |
| Mateus Rodrigues Amorim | 1 | 442,35 | compra unica |
| Guilherme França | 1 | 389,80 | compra unica |
| Bozzi Transportes | 1 | 389,40 | compra unica |
| Thiago Cardoso Couto | 1 | 219,88 | compra unica |
| Victória Homercher | 1 | 130,48 | compra unica |

Primeira compra, segunda compra, intervalo, frequencia e LTV **saem todos** de
`deal → identidade`. Nenhum precisa de lead.

---

## §7 — Aquisicao

As 9 PROVADAS entram como **SEM_ATRIBUICAO**, nunca no denominador de CAC, CPL,
ROAS ou coorte de midia.

| medida | antes | depois das 9 |
|---|---:|---:|
| receita total | 639.909,03 | **645.159,44** |
| receita atribuivel | 74.744,86 | **74.744,86** |
| receita nao atribuida | 565.164,17 | **570.414,58** |
| % atribuivel | 11,7% | 11,6% |

**A receita atribuivel nao se move um centavo.** Nenhuma das 9 tem campanha, e
nao existe lead de onde copiar UTM — o risco de fabricar aquisicao e zero por
construcao, nao por disciplina.

---

## §8 — Coortes: dois conceitos, hoje misturados

| conceito | base | pessoa sem lead |
|---|---|---|
| **COORTE_DE_AQUISICAO** | `lead_t0` — quando chegou | **nao tem.** Fica `AQUISICAO_DESCONHECIDA`, nunca num mes |
| **COORTE_DE_CLIENTE** | `first_purchase_at` da identidade | **tem.** Gabriela = coorte de fevereiro/2026 |

Sao perguntas diferentes: *"quantos clientes o marketing trouxe em fevereiro"*
e *"quantos clientes compraram pela primeira vez em fevereiro"*. Hoje a base so
sabe responder a primeira, e responde a segunda por acidente.

---

## §9 — T0: tres datas, nao uma

| campo | significado | fonte | existe? |
|---|---|---|---|
| `lead_t0` | primeira aquisicao conhecida | `min(lead.created_at)` da identidade | sim |
| `cliente_t0` | primeira relacao conhecida | `min(lead_t0, first_purchase_at)` | derivavel |
| `first_purchase_at` | primeira compra conhecida | `min(closed_at)` dos deals | derivavel |

Para as 7 pessoas provadas: **`lead_t0` nao existe**, `first_purchase_at`
existe, e `cliente_t0 = first_purchase_at`. Dizer que o T0 delas e a data da
compra e honesto; dizer que e "aquisicao em fevereiro" nao.

A R51 mostrou o custo de confundir: o `lead_t0` real da Vanessa/Alean
(**2025-08-22**) foi destruido por um merge fisico e so sobrevive em backup.
**Nao corrigido aqui** — so a semantica fica fixada.

---

## §10/§11 — Resolucao e precedencia

```
identidade(venda) =
  CASE
    WHEN via_lead IS NOT NULL AND via_deal IS NOT NULL AND via_lead <> via_deal
      THEN 'CONTRADICAO'                    -- nunca COALESCE silencioso
    ELSE COALESCE(via_lead, via_deal)
  END
```

Regra de precedencia explicita:

1. Se ambos existem e **concordam** → identidade resolvida.
2. Se ambos existem e **divergem** → **`ERRO_DE_IDENTIDADE`**, linha sinalizada,
   **nao escolhida por precedencia**. Uma fonte nunca esconde a outra.
3. So `via_lead` → resolvida, com aquisicao conhecida.
4. So `via_deal` → resolvida, **`AQUISICAO_DESCONHECIDA`**.
5. Nenhum → `CLIENTE_DESCONHECIDO`.

O ponto 2 e o que impede a camada nova de virar um mecanismo de mascarar
conflito — a mesma disciplina que a R42 aplicou a atribuicao.

---

## §12 — Scorecards: delta zero, e por dois motivos

Nao basta dizer "muda numero". Medi:

| scorecard | janela | o que mede |
|---|---|---|
| `vw_org_marcos_scorecard` | `now() - '30 days'` | checkouts, mensagens enviadas, conflitos, bloqueios |
| `vw_org_isabela_scorecard` | `now() - '30 days'` | objecoes detectadas/tratadas, playbooks |
| `vw_org_rafael_scorecard` | `now() - '30 days'` | idem, agente |
| `vw_org_bruno_scorecard` | `now() - '30 days'` | idem, agente |
| `vw_org_rafael_kpis_metas_realizadas` | `now() - '30 days'` | metas |
| `vw_org_marcos_kpis_ricardo_comparativo` | **sem janela** | comparativo |

**Delta esperado: 0**, por dois motivos independentes:

1. **Sao operacionais, nao economicos.** Medem trabalho de agente —
   conversa, objecao, playbook, mensagem. Um cliente sem lead nao teve conversa,
   entao nao pertence a essas metricas. **Devem continuar exigindo lead** (classe B).
2. **Janela de 30 dias.** Os 9 deals fecharam entre 26/01 e 25/03 — cinco meses
   atras. Ficariam fora mesmo se a regra mudasse.

Ou seja: o alerta que levantei no fim da R55 nao se sustenta para os scorecards.

---

## §13 — MAPA economico

O MAPA deve consumir:

| verdade | fonte | inclui venda sem lead? |
|---|---|---|
| **receita comercial total** | soma dos deals won | **sim** |
| **clientes reais** | `COUNT(DISTINCT identidade)` | **sim** |
| **recompra / LTV por identidade** | `deal → identidade` | **sim** |
| **atribuicao** | so o que tem lead com campanha | **nao** — bloco separado |

Regra dura: **ausencia de lead nunca reduz faturamento real.** E, no mesmo
movimento, ausencia de lead nunca vira aquisicao.

O MAPA passa a exibir dois numeros que hoje sao um so:
**R$645.159,44 de receita comercial** e **R$74.744,86 de receita atribuivel**.

---

## §14 — Dudalippe (e os outros dois PROVAVEL)

`Dudalippe Personaliados`, R$20,00: ERP **sem CPF, sem CNPJ, sem e-mail**;
telefone do deal e o literal `123458`. So o nome liga — inclusive com o mesmo
erro de grafia ("Personaliados") nos dois lados, o que e indicio, nao prova.

**Classificado PROVAVEL e excluido do bloco automatico**, junto com AUTERA
(R$1.780,00) e Marcos Protec (R$59,23).

Os tres so entram por decisao humana caso a caso, nunca por regra.

---

## §15 — Simulacao, somente as 9 PROVADAS

| metrica | antes | depois | delta |
|---|---:|---:|---:|
| receita comercial total | 639.909,03 | **645.159,44** | **+5.250,41** |
| receita atribuivel | 74.744,86 | **74.744,86** | **0** |
| receita nao atribuida | 565.164,17 | 570.414,58 | +5.250,41 |
| canonical deals | 1.400 | **1.409** | **+9** |
| clientes por identidade | 502 | **509** | **+7** |
| clientes por lead | 504 | 504 | 0 — *invisiveis* |
| repeat buyers (identidade) | 215 | **216** | +1 (Gabriela) |
| ticket medio por cliente | 1.274,72 | 1.267,50 | −7,22 |
| % receita atribuivel | 11,7% | 11,6% | −0,1 p.p. |

**Nada escrito.**

---

## §16 — Arquitetura minima (nao implementada)

Confirmada a hipotese da R55, com uma simplificacao: **nao e preciso coluna nova
em `identidade_comercial`.**

```
identidade_comercial_deals
  pessoa_id       uuid  -> identidade_comercial(pessoa_id)
  deal_id         text  PRIMARY KEY
  erp_pessoa_id   uuid  -> pessoas(id)      -- a ponte com o ERP mora aqui
  evidencia_tipo  text
  evidencia_valor text
  confidence      text  CHECK (provada|provavel|indeterminada)
  validado_em     timestamptz
  validado_por    text
```

Porque `erp_pessoa_id` aqui e nao em `identidade_comercial`: a ponte com o ERP e
**evidencia daquele vinculo**, com a mesma confianca do resto da linha. Posta na
tabela-pai, ela viraria atributo global de uma identidade que pode ter sido
provada por outro caminho — exatamente o erro que a R49 evitou ao nao deixar
`pessoa_id` parecer `pessoas.id`. **Uma tabela, zero alteracao no que existe.**

`pixel_events` **nao muda**. `identidade_comercial` e
`identidade_comercial_leads` **nao mudam**.

---

## §17 — Auto-refutacao

- *Receita sem lead deveria ser excluida?* Nao. E venda won confirmada na RD,
  com valor e data. Excluir seria subcontagem — o erro que as R43/R44 corrigiram.
- *Cliente unico pode continuar por lead?* **Nao, e ja esta errado hoje: 504 vs
  502.** A camada da R49 ja provou que um cliente pode ter varios leads.
- *`deal → identidade` duplica alguma fonte?* Nao. `pixel_crm_sync_map` liga
  deal a **evento**; `propostas_rd` tem `lead_id` nulo em 24/24; `pessoas` nao
  tem lead. Verificado na R55.
- *A pessoa do ERP e estavel?* Parcialmente. Todas as 1.754 vieram de importacao
  (a maioria em 03/04/2026) e **`Marcos Protec` esta cadastrada com CPF**, o que
  ja mostra ruido. Por isso a ponte carrega `confidence` por linha.
- *Pessoa provada pode estar errada?* Pode — e por isso 3 cairam para PROVAVEL
  neste §0. As 9 restantes casam por telefone **e** documento **e** nome.
- *`COALESCE` causaria contradicao?* Causaria, se fosse silencioso. Por isso o
  §10 exige `CONTRADICAO` explicita antes do `COALESCE`.
- *Scorecard mistura aquisicao e cliente?* Medido: **nao.** Sao operacionais de
  agente, janela de 30 dias, e devem continuar exigindo lead.
- *LTV ficaria inflado?* Nao: +R$5.250,41 de receita com +7 clientes **derruba**
  o ticket medio de 1.274,72 para 1.267,50. Inflaria se contasse a receita sem
  contar o cliente — que e exatamente o que Purchase com `lead_id` NULL faria.
- *Algum KPI precisa continuar vendo so leads?* **Sim, todo o dominio B** — CAC,
  CPL, ROAS, campanha, coorte de aquisicao, qualidade de campanha e os
  scorecards. Nenhum deles deve enxergar venda sem lead.

Nenhuma refutacao derrubou o contrato. Tres derrubaram classificacoes minhas,
e estao no §0.

---

## §18 — Recomendacao unica de leitura

1. **`pixel_events` permanece com a invariante "todo Purchase tem lead".** As
   vendas sem lead **nao** entram la.
2. Uma tabela nova, `identidade_comercial_deals`, carrega `deal → pessoa` com
   evidencia, confianca e a ponte para o ERP.
3. **Leitura de CLIENTE** (receita, clientes unicos, recompra, frequencia, LTV,
   ticket, coorte de cliente) resolve por
   `COALESCE(lead→pessoa, deal→pessoa)`, com `CONTRADICAO` explicita.
4. **Leitura de AQUISICAO** (CAC, CPL, ROAS, campanha, UTM, coorte de aquisicao,
   scorecards) **continua exigindo lead**. Venda sem lead entra como
   `SEM_ATRIBUICAO`, fora do denominador.
5. O MAPA passa a publicar **dois** numeros: receita comercial total e receita
   atribuivel.

---

## §19 — Proximo passo

**R57 — a menor escrita possivel**, e so ela: criar
`identidade_comercial_deals` e popular **as 9 PROVADAS** (7 pessoas,
R$5.250,41), com os gates de sempre — reancoragem na RD, ensaio revertido,
guardas de delta em transacao, prova de que `pixel_events`, `leads_marketing` e
os vinculos da R49 nao mudam.

**Nao** reescrever nenhuma das 34 views nessa rodada: a leitura muda depois, uma
view por vez, com o antes/depois de cada uma medido.

Registrados, sem mudanca: os 3 PROVAVEL (R$1.859,23); os 12 SEM_EVIDENCIA
(R$7.392,95); as 2 views indeterminadas; o `lead_t0` de 2025-08-22 da
Vanessa/Alean; os pares suspeitos da Igreja e do Kleberson;
`fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa; `crm_deals_cache`
congelado desde 16/08.
