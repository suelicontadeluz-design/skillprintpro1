# Frente `marketing-touches-sem-escritor-ctwa` — desenho para o gate

Trilha `midia` · P1 · projeto `ldrdtaibazplvrbwyrvx`
Medido em 16/08/2026 no codigo ACTIVE e nos dados vivos.

O `proximo_passo` registrado na frente exige **apresentar o desenho da chamada
antes de qualquer deploy**. Este documento e esse desenho. Nada foi deployado,
nenhuma migration foi aplicada, nenhuma linha foi escrita em `marketing_touches`.

---

## 1. Arquitetura real do CTWA hoje

```
anuncio Meta (CTWA)
  -> WhatsApp: 1a mensagem carrega externalAdReply{ctwaClid, sourceId, title, sourceType, sourceApp}
  -> Z-API webhook  ->  edge `zapi-ingest` v121 (verify_jwt=false)
       |
       |-- fora do horario comercial?  -> INSERT inbound_fora_horario + agente-noturno (Joao)
       |                                  >>> RETORNA AQUI. Nao passa pelo ramo de anuncio. <<<
       |
       |-- lead ja existe e tem dono (bruno/marcos) ou Julia ativa/em progresso?
       |                                  >>> RETORNA AQUI tambem. <<<
       |
       `-- if (sourceId || ctwaClid || adTitle)          <-- unico ponto que ve tudo junto
             resolveAdData(sourceId, adTitle)            -> Meta Graph API, senao dim_ads por ad_id, senao dim_ads por titulo
             classifySegmento(...)
             getOrCreateLeadAtomic(...)                  -> RPC fn_get_or_create_lead  => leadId
             lead_identificadores.upsert
             pixel_events.insert  (event_name='Lead')
             sendCAPICtwa(...)    (so se ctwaClid)
             callRDCrmUpsert(...)
             ativarJulia(...)
```

**Onde os sinais coexistem:** apos `getOrCreateLeadAtomic`, no mesmo escopo
sincrono, existem `leadId`, `ctwaClid`, `sourceId` e `adData` (campaign/adset/ad
+ nomes). O diagnostico anterior da frente esta **confirmado no codigo ACTIVE**.

**Versao ACTIVE conferida:** v121, `ezbr_sha256`
`0dd035d29ba122a30dcb72ac1b2420045ac0fe7841def7eeead00bfd095fb104`. Igual a
observada no checkpoint anterior — nao houve redeploy desde 11/08.

---

## 2. Causa raiz

`marketing_touches` (19/07) e `fn_registrar_marketing_touch` (com idempotencia
dupla) existem e estao corretas. **Nunca foram ligadas a nada.**

Provas independentes, todas re-executadas hoje:

| verificacao | resultado |
|---|---|
| `count(*) from marketing_touches` | **0** |
| funcoes SQL que citam `fn_registrar_marketing_touch` | so a propria definicao |
| triggers em `marketing_touches` | 3, e os tres so **bloqueiam** (no_delete/no_update/no_truncate) |
| cron chamando a funcao | nenhum |
| `pg_stat_statements` p/ `fn_registrar_marketing_touch` | **0 chamadas** — cobre tambem edges, que chamam via PostgREST |
| grep de `marketing_touches` no fonte v121 do `zapi-ingest` | **nenhuma ocorrencia** |

Nao e fonte que ficou de fora. **Nao existe escritor, em lugar nenhum.**

### Achado novo, nao registrado antes: o CHECK bloqueia o caminho real

```sql
ck_source_system CHECK (source_system = ANY (ARRAY[
  'inbound_fora_horario','capi_eventos_log','pixel_events',
  'lead_ads_externo','woocommerce','kiwify','manual']))
```

Nenhum valor representa o webhook da Z-API. Se o patch da edge fosse feito sem
migration, toda chamada cairia em `WHEN check_violation` e retornaria
`{status:'rejeitado'}` — **um no-op silencioso que pareceria implementado**.
Por isso o patch tem 2 partes, e a migration vem primeiro.

---

## 3. Cobertura e impacto medidos

Leads (`leads_marketing`):

| janela | leads totais | com `ctwa_clid` | com touch |
|---|---|---|---|
| 7 dias | 293 | **185** | 0 |
| 30 dias | 1.175 | **755** | 0 |

Compras (`pixel_events` `Purchase`) — leitura apenas, nada tocado:

| janela | compras | de lead com `ctwa_clid` | receita desses |
|---|---|---|---|
| 7 dias | 72 | **12** | R$ 2.172,45 |
| 30 dias | 276 | **44** | R$ 5.682,31 |

Ou seja: **44 compras / R$ 5.682,31 em 30 dias** vieram de lead com CTWA e nao
tem uma unica linha no livro canonico de midia.

### As 4 categorias pedidas

| categoria | 30 dias | leitura |
|---|---|---|
| CTWA presente, touch ausente | **755** | o buraco inteiro |
| CTWA ausente (lead sem sinal) | 420 | fora do escopo; nao se fabrica atribuicao |
| touch existente porem incompleto | **0** | nao ha touch nenhum |
| enriquecimento posterior (cron 114) | preenche `leads_marketing`, nunca `marketing_touches` | ver §5 |

De 755 CTWA em 30d, **745 tem `utm_campaign_id`** resolvido e 10 nao — nesses o
patch grava o touch com `ctwa_clid` e sem campanha, sem inventar valor.

### Limite real de cobertura do menor patch — **decisao sua**

O ponto de registro so e alcancado por quem passa pelo ramo de anuncio. Medindo
os leads CTWA de 30d por horario de criacao (BRT, mesma regra de
`dentroDoHorarioComercial`):

| | 30 dias | 7 dias |
|---|---|---|
| CTWA **dentro** do horario -> passa pelo ramo, **vira touch** | **312** (41%) | 81 |
| CTWA **fora** do horario -> retorna em `inbound_fora_horario` antes do ramo | **443** (59%) | 104 |

Confirmado pelo outro lado: 562 mensagens com `externalAdReply` em
`inbound_fora_horario` nos ultimos 30d (479 com `ctwaClid`).

Alem disso, lead **ja existente** que clica num anuncio novo tambem nao chega ao
ramo (retorna antes em bruno/marcos/Julia), exceto quando o estado da Julia e
`bloqueada`.

**Portanto o menor patch resolve ~41% do volume CTWA, nao 100%.** Ele resolve
exatamente o que o `criterio_aceite` pede — *lead novo de CTWA gera linha no
mesmo fluxo em que o lead e criado* — e nao mais que isso. O caminho fora do
horario passa por Joao/`agente-noturno`, que esta na sua lista de NAO TOCAR,
entao **nao foi tocado nem desenhado aqui**. Se quiser os 59% restantes, isso e
uma segunda frente, com decisao sua sobre mexer no caminho do Joao.

---

## 4. Consumidores e escritores de `marketing_touches`

**Consumidores:** um so — a view `public.vw_midia_coorte_aquisicao_shadow`, e
apenas como diagnostico:

```sql
fonte AS (SELECT count(*) AS immutable_touch_rows FROM marketing_touches)
```

Nenhuma metrica de campanha, lead, comprador ou receita da view depende dessa
CTE. Nenhum relatorio, agente ou processo le a tabela alem disso.

**Escritores:** **nenhum**. `fn_registrar_marketing_touch` e o unico caminho de
escrita previsto e tem 0 chamadas historicas.

### Janela de observacao — o bloqueio de 14/08 nao se aplica

O `onde_paramos` levantou a duvida de o deploy interferir na janela
`obs:cron:20260814..20260821` (frente `criterios-midia-inconsistentes`, ativa
hoje). Rastreado ate o fim:

- o observador e `midia_shadow.fn_observador_impl`, via cron **131** (`30 9 * * *`);
- ele le `vw_midia_coorte_aquisicao_shadow`, mas **nao seleciona
  `immutable_touch_rows`** (`position('immutable_touch_rows' in prosrc) = 0`);
- as colunas que ele consome vem de `meta_ads_insights`, `leads_marketing`,
  `pixel_events` e `fn_segmento_campanha_v2` — nenhuma toca `marketing_touches`.

**Conclusao: gravar touch nao muda nenhuma decisao do observador.** A janela
pode seguir intacta. Registro isso como medicao, nao como opiniao — a decisao de
deployar durante a janela continua sendo sua.

---

## 5. `fn_ctwa_enricher` (cron 114) nao serve como first-touch — confirmado

Lido o corpo da funcao hoje. Ela e um `UPDATE leads_marketing` que:

1. usa `COALESCE(lm.ctwa_clid, e.ctwa)` — **so preenche campo NULL**, nunca cria registro;
2. faz `DISTINCT ON (phone) ... ORDER BY created_at DESC` — **fica so com o clique mais recente por telefone**, o que destroi multi-touch por construcao;
3. olha janela de **6 horas**;
4. depende do lead **ja existir** — e o que gera a race que a frente quer evitar.

E enriquecimento de lead, nao livro de midia. **A instrucao da frente de nao
usa-la como first-touch esta correta e permanece.** O patch nao a altera, e nao
ha conflito: ela escreve em `leads_marketing`, o patch escreve em
`marketing_touches`.

---

## 6. Contrato de idempotencia

`fn_registrar_marketing_touch` ja traz dupla protecao, respaldada por indices
unicos reais (`ux_touch_external_event`, `ux_touch_payload_hash`) e por
tratamento de `unique_violation` (corrida de concorrencia):

1. **primaria** — `(source_system, external_event_id)`;
2. **secundaria** — SHA-256 do JSON canonico (`src,type,occ,ext,lead,camp,adset,ad,ctwa,sess`), sem `received_at`.

O patch fornece:

| campo | valor | por que |
|---|---|---|
| `external_event_id` | `ctwa:{ctwaClid}`, senao `zapmsg:{messageId}` | **um clique = um `ctwa_clid` = um touch**. Retransmissao repete o clid -> `duplicado`. Clique novo -> clid novo -> touch novo, multi-touch preservado. |
| `occurred_at` | `body.momment` (epoch ms da Z-API), descartado se futuro | instante real da mensagem, nao do processamento — torna o `payload_hash` estavel entre reprocessamentos |
| `source_system` | `zapi_ingest` (**novo**, via migration) | provenencia honesta; nenhum valor existente serve |
| `touch_type` | `ctwa_click` com clid, `paid_click` sem | dominio ja aceito por `ck_touch_type` |

`momment` e `messageId` foram confirmados presentes no payload real: aparecem
nas 840 linhas de `inbound_fora_horario` com `externalAdReply`.

**Risco de duplicidade apos o patch: nenhum produtor concorrente existe.** Se um
segundo escritor surgir no futuro, `payload_hash` ainda o deduplica desde que
use o mesmo `occurred_at`.

---

## 7. Fail-closed — o que o patch se recusa a fazer

| situacao | comportamento |
|---|---|
| sem `lead_id` | `return` antes da RPC — nenhum touch orfao |
| sem `ctwa_clid` **e** sem `ad_id` resolvido | `return` — atribuicao nao se fabrica a partir de titulo solto |
| retransmissao do mesmo webhook | `duplicado`, tratado como sucesso |
| campo indisponivel | vai `null`, nunca valor inventado |
| falha ao gravar o touch | `try/catch` + `error_log`; **o atendimento do WhatsApp segue normalmente** |
| first-touch verdadeiro | a tabela e append-only por trigger — **e impossivel sobrescrever** |
| venda historica | nada e reatribuido; backfill e decisao separada, como diz o proprio criterio |

---

## 8. Plano de canario — os 10 pontos

O aceite se prova em **ocorrencia organica**, nunca em insercao manual, e nunca
com mensagem fabricada para cliente real.

| # | prova | como verificar |
|---|---|---|
| 1 | lead novo de CTWA gera exatamente 1 touch | `select count(*) from marketing_touches where lead_id=$novo` = 1 |
| 2 | retransmissao nao duplica | reenviar o **mesmo** payload ja recebido ao endpoint; esperar `status='duplicado'`, `count(*)` inalterado |
| 3 | lead existente com evento novo nao destroi first-touch | `min(occurred_at)` por `lead_id` estavel; triggers ja impedem UPDATE/DELETE |
| 4 | ausencia de CTWA nao fabrica touch | rota `organico_novo` -> 0 linhas novas |
| 5 | campaign/adset/ad ficam no lead certo | join `marketing_touches` x `leads_marketing` -> `campaign_id` igual ao `utm_campaign_id` |
| 6 | WhatsApp segue funcionando | rotas `anuncio`/`exploracao` respondendo 200; `error_log` sem `zapi-ingest` novo |
| 7 | nenhum outbound adicional | o patch so chama 1 RPC — nenhum fetch a Meta/BotConversa/RD |
| 8 | nenhum Purchase criado/alterado | `count(*)` e `sum(value)` de `pixel_events` `Purchase` antes/depois |
| 9 | consumidores seguem funcionando | `select * from vw_midia_coorte_aquisicao_shadow limit 5` ok; cron 131 roda 09:30 UTC sem erro |
| 10 | rollback restaura o anterior | redeploy v121, conferir `ezbr_sha256` do baseline |

Janela sugerida: **48h**, com corte diario de `marketing_touches` por
`source_system` e `status`. Aceite so com **ocorrencia organica de lead novo
CTWA dentro do horario comercial** (~11/dia pela media de 312/30d).

---

## 9. Estado apos o GO (16/08/2026)

GO dado nos 5 pontos, com a condicao de que o baseline v121 seja recuperado
byte-a-byte, sem transcricao manual, parando antes do deploy caso nao fosse
possivel.

| # | passo da ordem acordada | estado |
|---|---|---|
| 1 | capturar legitimamente | **feito** — claim `ok=true`, trilha `midia` |
| 2 | recuperar/versionar v121 byte-a-byte | **BLOQUEADO** — ver `supabase/functions/zapi-ingest/PATCH.md` |
| 3 | aplicar migration | **feito** — `marketing_touches_source_system_zapi_ingest` |
| 4 | validar constraint/RPC | **feito** — `zapi_ingest` aceito, baseline preservado, RPC presente, tabela ainda com 0 linhas |
| 5 | deploy v122 | **nao executado** — parado na condicao do ponto 2 |
| 6..10 | canario -> ocorrencia organica -> prova -> medicao -> fechamento | nao iniciados, dependem do deploy |

A validacao do passo 4 foi feita **sem inserir linha de teste**: a tabela e
append-only por trigger e o `criterio_aceite` exige prova em ocorrencia
organica. Uma linha sintetica nao poderia ser apagada depois e contaminaria a
evidencia permanentemente.

Estado de producao agora: dominio do CHECK ampliado e **inerte** — nenhum
escritor existe, entao o comportamento observavel do sistema e identico ao de
antes da migration.

## 10. Gate

Chegamos exatamente no gate registrado na frente. **Precisa da sua decisao:**

1. **Autoriza a migration** que amplia `ck_source_system` com `'zapi_ingest'`?
   (aditiva, tabela com 0 linhas, rollback escrito)
2. **Autoriza o deploy** do `zapi-ingest` v122 com as 2 adicoes?
3. **Aceita deployar durante a janela `obs:cron:...0821`?** Medi que nao ha
   interferencia (§4) — a decisao continua sua.
4. **Aceita cobrir so os ~41% (dentro do horario) nesta frente?** Os 59% fora do
   horario passam por Joao, que esta em NAO TOCAR.
5. **Antes do deploy:** recuperar o fonte exato da v121 e commita-lo, para que a
   funcao passe a ter fonte versionada (hoje nao tem, em nenhum repositorio).
