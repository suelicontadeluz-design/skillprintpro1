# R47 — consolidacao dos 5 grupos de valor divergente

Executada em 2026-08-26 15:16:28 UTC. **5 representacoes erradas removidas,
5 negocios preservados no valor comprovado pela RD.**

## Gate critico: o `won_` volta?

Auditoria de todos os produtores vivos de `won_<deal_id>`:

| produtor | travas | efeito nos 5 |
|---|---|---|
| `deal-won-ingest` v28 | `won_<dealId>` **+ `locked_deal`** | aborta em `locked_deal` |
| `won-ingest` v35 | `won_<dealId>` (trava_1) **+ `locked_deal`** (trava_2, antes do insert) | aborta em `locked_deal` |
| `botconversa-won-ingest` v40 | so seleciona deals `status='ongoing'` | nunca alcanca deal `won` |
| `rd-won-pixel-sync` v56 | cria `rd_won_`, nao `won_` | nao recria |
| `fn_reconciliar_purchase_rd` | so `UPDATE ... WHERE value=0` | nao insere |
| `crm-pixel-sync` | tombstone HTTP 410 | morto |

Nenhum cron chama os ingests — sao webhook-driven.

**5/5 tem `custom_fields.locked_deal = "true"` e estao no stage de fechamento**,
verificado na RD ao vivo. A trava de `locked_deal` e de nivel-deal, persistida no
RD, e sobrevive ao delete da linha em `pixel_events`.

**Veredito: TORNEIRA_WON_SEGURA.**

Risco residual declarado: a protecao depende de `locked_deal` continuar `true`.
Se alguem destravar um desses deals manualmente na RD, um replay de webhook
recriaria o `won_`. Nao corrigido nesta rodada (exigiria mexer no produtor).

## Baseline — 5/5

| cliente | survivor | valor survivor | alias `won_` removido | RD live | soma produtos RD |
|---|---|---:|---:|---:|---:|
| Ana Ribeiro | **uuid** | 3.221,88 | 3.217,20 | 3.221,88 | 3.221,88 |
| Antonio Tadeu | rd_won | 92,97 | 107,97 | 92,97 | 92,97 |
| Bruno Cardoso | rd_won | 261,60 | **10,00** | 261,60 | 261,60 |
| Beats Estamparia | rd_won | 152,74 | **763,47** | 152,74 | 152,74 |
| Willian Vieira | **uuid** | 755,48 | 835,82 | 755,48 | 755,48 |

Em 5/5: `survivor.value` = `total_price` = **soma itemizada dos produtos**.
Survivor escolhido pela verdade da RD, nunca pelo prefixo — em 2 dos 5 o
sobrevivente e um UUID.

## Origem da divergencia

Alias e survivor sao do **mesmo dia** nos 5. A `won-ingest` grava
`event_time = now()` do webhook e `value` = total do deal **naquele instante**.
A divergencia e o total do deal tendo mudado depois do webhook.

Ana (+4,68) e Antonio (+15,00) tem cara de ajuste comercial. Bruno (10,00) e
Beats (763,47) tem cara de payload quebrado — o Bruno inclusive carrega
`adset_id = 'value:'`, lixo literal. Nao precisei provar intencao para
consolidar; a evidencia fica no snapshot.

## Atribuicao

**0 aliases com atribuicao valida.** Guarda de abort na transacao. Placeholder,
string vazia e `'value:'` nao contam como evidencia.

## Mapa: zero repontamento

- Ana e Willian: o mapa **ja apontava para o survivor UUID**
- Antonio, Bruno, Beats: **sem linha de mapa**

Guarda `mapa_tocado = 0` aprovada. Gate do item 11 fechado: remover o `won_`
nao torna o `canonical_deal_id` invisivel, porque quem resolve o UUID e o mapa,
e ele continua intacto.

## Guardas, todas aprovadas em transacao unica

| guarda | resultado |
|---|---|
| revalidacao (RD won + locked + valor=RD=produtos + alias divergente + 2 eventos) | 5 |
| atribuicao valida no alias | **0** |
| aliases deletados | **5** |
| survivor byte-a-byte intacto (md5) | **5** |
| survivor value = RD = produtos | **5** |
| exatamente 1 Purchase por deal | **5** |
| **mapa tocado** | **0** |
| Purchase | 1596 -> 1591 (-5) |
| receita | 642.263,23 -> 637.328,77 |
| **queda de receita = soma dos aliases removidos** | **4.934,46 = 4.934,46** |
| canonical deals | **1374 -> 1374** |
| compradores | **504 -> 504** |
| orfaos do mapa | 329 -> 329 |

A guarda de receita nao usa `sum - max`: exige que a queda seja **exatamente** a
soma das 5 representacoes erradas.

Ensaio revertido antes: atribuicao 0, delete 5, hash 5, valor 5, um_purchase 5,
mapa_tocado 0, orfaos 329->329, restauracao byte a byte 5/5.

## Nada anterior foi desfeito

R35: **37/37** · R44: **17/17** · R46: **5/5** · `vw_venda_identidade`: 1591 linhas.

## Duplicacoes restantes: 6 -> 1

| deal | cliente | combo | valores | soma |
|---|---|---|---:|---:|
| 69f3ac56 | **Vanessa Buher** | rd_won+uuid | iguais | 620,30 |

Unico caso restante, e **nao e consolidacao**: dois cadastros
`Vanessa Buher` com telefones `554195338939` e `5541995338939`. E merge de lead.

## Rollback

`public._r47_rollback` (5 linhas, PK `canonical_deal_id`) com snapshot jsonb de
survivor e alias, linha do mapa, valor RD, soma de produtos e o valor removido.

```sql
begin;
set local session_replication_role = replica;
insert into pixel_events
  select (jsonb_populate_record(null::pixel_events, r.snapshot_alias)).*
  from public._r47_rollback r;
set local session_replication_role = origin;
commit;
-- o mapa nao foi alterado, entao nao precisa restauracao
```
