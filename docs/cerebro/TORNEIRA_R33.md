# R33 — Fechando a torneira: resolução determinística de lead no fluxo RD

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** ESCRITA AUTORIZADA (2 objetos)

## VEREDITO: `RESOLVER_CORRIGIDO`

Dois objetos alterados no mesmo deploy lógico, ambos com candidato pré-computado conferido
contra o LIVE. **Nenhum outro objeto tocado. Nenhuma linha de dado alterada.** Histórico
intocado, conforme a decisão da rodada.

---

## 1. BASELINE

| objeto | baseline | rollback |
|---|---|---|
| `fn_linkar_propostas_leads()` | md5 `2db750130c889c729fe5743ed0f44c7a`, 338 b, `VOLATILE`, `SECURITY INVOKER`, dono `postgres` | `ops/cerebro/fn_linkar_propostas_leads_R33_ROLLBACK.sql` |
| edge `rd-won-pixel-sync` | **version 55**, `ezbr_sha256` `c5ac9006…c31295`, `verify_jwt=false` | `ops/cerebro/rd-won-pixel-sync_v55_ROLLBACK.ts` |

**O artefato de rollback da função foi provado fiel:** aplicado numa transação, reproduziu
`md5 = 2db750130c889c729fe5743ed0f44c7a` — o baseline exato — e a transação foi revertida.

Dependências levantadas antes de tocar: `fn_linkar_propostas_leads` **não tem chamador algum** —
nenhuma função, nenhum trigger, nenhum cron, zero execuções em 30 dias. A edge é chamada pelo
cron `rd-won-pixel-sync-diario` (`0 7 * * *`).

## 2. REGRA ANTIGA

**Edge v55:** resolvia por `lead_identificadores.deal_rdstation_id`, com fallback em laço:

```ts
for (const cid of contactIds) { leadId = liByContactMap.get(cid) ?? null; if (leadId) break; }
```

**`fn_linkar_propostas_leads`:** `UPDATE…FROM` com join em `contact_rdstation_id`.

Nenhuma das duas chaves é única: **29 `deal_rdstation_id` e 37 `contact_rdstation_id` apontam
para mais de um lead**, afetando 82 leads. Quando o join casa múltiplas linhas, o PostgreSQL não
erra e não avisa — escolhe uma.

## 3. REGRA NOVA

```
1. telefone extraido de deal.name ("Nome | Telefone")
2. normalizado para DDD + 8 ultimos digitos (tolera 55 e ausencia do nono digito)
3. leads com essa chave:
     exatamente 1  -> RESOLVE   (evidencia: telefone_deal_nome)
     2 ou mais     -> AMBIGUO   -> NAO insere
     zero, ou sem telefone no nome -> SEM_LEAD -> NAO insere
```

**A edge deixou de consultar `lead_identificadores`.** As duas queries àquela tabela foram
substituídas por uma única a `leads_marketing`. Verificado: as três ocorrências restantes da
string no arquivo estão em comentários, nenhuma em código.

O fallback para `lead_identificadores` quando único foi avaliado e **descartado**: recuperaria
**1 deal** em 1.195. Não compensa manter viva uma chave que já provou não ser determinística.

**Telefone é evidência do evento, não identidade permanente.** Nenhum merge é feito. A gravação
registra `evidencia: "telefone_deal_nome"` junto com o `lead_id`.

## 4. SIMULAÇÃO DE COBERTURA — antes de escrever

Sobre 1.195 deals `won` com nome disponível:

| | v55 | **v56** |
|---|---|---|
| resolvia por `deal_rdstation_id` | 278 | — |
| **RESOLVE** | — | **1.138 (95,2%)** |
| AMBIGUO | (escolhia) | 21 (1,8%) |
| SEM_LEAD | — | 36 (3,0%) |
| casos onde só a v55 resolvia | — | **3** |

**A cobertura não piora — quadruplica.** 278 → 1.138.

`fn_linkar_propostas_leads` no estado atual dos dados: **atualizaria 0 linhas antes e 0 depois.**
As 1.029 propostas com `lead_id` nulo e contato preenchido não têm correspondência em
`lead_identificadores`. **A guarda é puramente preventiva, com impacto imediato zero.**

## 5. SIMULAÇÃO DE PRECISÃO — os 41 casos conhecidos

| resultado com a regra nova | n |
|---|---|
| **CORRIGE — resolve para o lead certo** | **37** |
| SEM_LEAD (telefone malformado) | 4 |
| AMBIGUO | 0 |
| **MANTERIA O ERRO** | **0** |

**Zero casos em que a regra nova repetiria o erro.**

## 6. DIFF

**Função** — três linhas adicionadas, nada removido:

```sql
    AND pr.contact_rdstation_id IS NOT NULL
+   AND (SELECT count(DISTINCT li2.lead_id)
+          FROM lead_identificadores li2
+         WHERE li2.contact_rdstation_id = pr.contact_rdstation_id) = 1;
```

**Edge** — removidas 2 queries a `lead_identificadores` e o laço `if (leadId) break`; adicionadas
`chaveTelefone()`, `telefoneDoDealNome()`, `variantesDaChave()`, uma busca em lotes de 200 e os
ramos `ambiguo` / `sem_lead`.

## 7. DEPLOY

| | esperado | LIVE | |
|---|---|---|---|
| `fn_linkar_propostas_leads` md5 | `b1b3765179be56639e1e7cb9bfb54eb9` | `b1b3765179be56639e1e7cb9bfb54eb9` | ✅ |
| bytes | 495 | 495 | ✅ |
| volatilidade / `SECURITY DEFINER` / dono / ACL | inalterados | inalterados | ✅ |
| edge version | 56 | 56 | ✅ |
| edge `ezbr_sha256` | — | `8fdba67c31bba7248275afe608857d313f5f20cfc1b1cd0dde00893d48874328` | registrado |
| edge `verify_jwt` | `false` | `false` | ✅ preservado |

O md5 do candidato foi **pré-computado dentro de uma transação revertida**, antes do deploy, e
conferido contra o LIVE depois. Candidato == LIVE.

## 8. CANÁRIO — execução real em `dry=1`

```json
{"ok":true,"page":1,"novos":49,"ja_existia":50,"ambiguo":0,"sem_lead":1,"dryRun":true}
```

Comparação com a execução da v55 de hoje às 07:00, mesma janela de 100 deals:

| | v55 (07:00) | **v56 (canário)** |
|---|---|---|
| novos | 36 | **49** |
| ja_existia | 50 | 50 |
| **ambiguo** | *(não existia — escolhia)* | **0** |
| **sem_lead** | **14** | **1** |
| resolvidos | 86/100 | **99/100** |

**`sem_lead` caiu de 14 para 1.** A resolução por telefone recupera 13 deals que
`lead_identificadores` perdia.

Cada resolução traz `evidencia: "telefone_deal_nome"`. Um dos leads resolvidos é
`d92bc47a…` — **Beats Estamparia**, exatamente um dos clientes cujas vendas iam parar na
"Juliana". Agora resolve certo.

**Prova de que nada foi escrito:**

| | antes | depois do canário |
|---|---|---|
| `Purchase` total | 1.608 | **1.608** |
| `rd_won_*` | 353 | **353** |
| último `rd_won_*` | 2026-05-07 | **2026-05-07** |
| canário citou o lead "Juliana" | — | **não** |

## 9. ERRO NÃO É MAIS ESCONDIDO COMO SUCESSO

A v55 tinha três estados e reportava dois. A v56 tem quatro e reporta os quatro, no log
estruturado e no corpo da resposta: `novos`, `ja_existia`, **`ambiguo`**, `sem_lead`, mais uma
lista `naoResolvidos` com o motivo de cada um.

Nenhuma estrutura nova de observabilidade foi criada — o log JSON já existente foi estendido, e
a resposta HTTP passou a carregar os contadores. É o menor patch possível para tornar a
abstenção visível.

## 10. NÃO FEITO NESTA RODADA — como decidido

41 vendas históricas · 44 duplicações econômicas · coluna `deal_id` · backfill · índice único ·
paginação · **merge** (`fn_merge_leads` não foi tocada, os 23 pares seguem intactos) · camada de
identidade comercial · MAPA/GPS/agentes.

## 11. CONTRATO ECONÔMICO PRESERVADO

| conceito | onde vive | status |
|---|---|---|
| **LEAD** = origem, aquisição, T0 | `leads_marketing` | **intacto** — nenhuma linha apagada, nenhum merge |
| **IDENTIDADE COMERCIAL** = agregação de relacionamento | ainda não existe | **não implementada**, como decidido |
| **DEAL** = fato comercial | `deal_id` do RD | inalterado |
| **RECOMPRA / LTV** | futuramente agregados por identidade | **não implementados** |

A v56 resolve **o evento**, não a identidade. Um deal aponta para um lead; dois leads da mesma
pessoa continuam dois leads.

## 12. AUTO-REFUTAÇÃO

| tentativa | resposta |
|---|---|
| **Telefone no `deal_nome` pode estar errado?** | Sim — 3 dos 7 casos da R30 tinham telefone truncado. Por isso a normalização é DDD + 8 últimos, e esses caem em `SEM_LEAD`, não em lead errado |
| **O número pode ter mudado?** | Sim — a Aleanuniformes trocou de número (R32). A v56 resolve **o evento na época**, e o `deal_nome` guarda o número vigente quando o deal foi criado. É a resposta certa para aquele deal |
| **Telefone compartilhado?** | Vira `AMBIGUO` e **não insere**. No canário: 0 casos nesta janela; retrospectivamente, 21 em 1.195 |
| **Contato RD único poderia ser confiável?** | Sim, mas recuperaria **1 deal em 1.195**. Removido por não valer o risco de manter a chave viva |
| **A abstenção aumentou demais?** | **Não — diminuiu.** `sem_lead` foi de 14 para 1 no canário |
| **`propostas_rd` fica com muitos `lead_id` nulos?** | Não muda nada hoje: a função atualizava 0 linhas antes e continua atualizando 0 |
| **Algum consumidor exige `lead_id` obrigatório?** | O `NOT NULL` não existe em `pixel_events.lead_id`. A v56 simplesmente não insere a linha — o consumidor não vê um `lead_id` nulo, vê a ausência do evento |
| **Falhar fechado impede a venda de entrar no MAPA?** | **Sim, e é o objetivo.** Uma venda ausente é recuperável; uma venda no cliente errado contamina coorte, recompra e campanha |
| **Outro resolver ainda vaza?** | **Sim.** `fn_joao_lost_classificar` e `fn_contexto_crm_etapa_base_v1` continuam usando `LIMIT 1` sobre essas chaves. **Não escrevem `pixel_events` nem `propostas_rd.lead_id`** — não criam verdade econômica — mas o mecanismo segue vivo neles |
| **E o webhook `won_`?** | Já resolvia por telefone e erra 0,17%. Não foi tocado |
| **O canário provou o caso "Juliana"?** | Provou o inverso do erro: nenhum dos 49 resolvidos apontou para aquele lead, e Beats Estamparia resolveu certo. Não provou um caso ambíguo — não houve nenhum na janela |

## 13. PRÓXIMO PASSO MÍNIMO

**Observar a próxima execução real do cron (07:00 de amanhã) e conferir `ambiguo` e `sem_lead`.**

O canário rodou em `dry=1`. A execução real vai tentar inserir, e aí aparece a interação com a
trigger `trg_pixel_events_dedup` — que hoje descarta silenciosamente tudo o que a edge manda
(R28). **A v56 corrige o cliente, não corrige a paginação nem o silêncio da trigger.** Esperar
`novos > 0` e `rd_won_*` voltar a crescer seria erro de leitura: enquanto o `deal_id` não for
chave, a trigger continua sendo a única defesa contra duplicata — e continua mandando as linhas
para o vazio.

Depois disso, a fila da R31/R32 segue na ordem: corrigir as 41 vendas históricas → resolver as
44 colisões → `deal_id` → backfill → índice único → produtores → paginação.

E fica registrado o vazamento residual: **`fn_joao_lost_classificar` e
`fn_contexto_crm_etapa_base_v1`** ainda escolhem lead com `LIMIT 1` sobre chave não-única. Não
produzem verdade econômica hoje, mas são a mesma doença.
