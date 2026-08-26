# R34 — venda certa -> cliente errado (rd_won_*)

Rodada de 2026-08-26. **Nenhuma escrita foi aplicada.** O gate do item 6 do
protocolo disparou antes da mutacao.

## O que foi provado

Replay da regra LIVE v56 (`rd-won-pixel-sync`, telefone do `deal.name`,
DDD + 8 ultimos digitos, resolucao unica ou nada) sobre os 361 `Purchase`
com `event_id like 'rd_won_%'`, reancorado na API da RD (1331 deals won do
pipeline `63191f7dd02b2e000cb1805b`).

| classe | eventos | receita |
|---|---:|---:|
| JA_CORRETO | 311 | 98.036,30 |
| CORRIGIVEL_PROVADO | 39 | 12.046,48 |
| AMBIGUO (hoje ja corretos) | 8 | 2.022,52 |
| SEM_LEAD (errados, irresolviveis) | 2 | 723,83 |
| SEM_TELEFONE_NO_NOME (indeterminado) | 1 | 274,50 |

Conjunto comprovadamente errado = 39 + 2 = **41**, identico ao da R33.
O split, porem, e 39/2 e nao 37/4.

## Por que nao escrevemos

1. **Split divergente e nao explicado por deriva.** Nenhum dos 39 leads-alvo
   nasceu depois da R33; nenhum dos 27 leads tocados depois da R33 e alvo.
2. **Gate do item 6.** `pixel_events.state` dos 37 e igual ao `st` do lead
   ERRADO em 37/37 e bate com o lead certo em apenas 9/37. Trocar so
   `lead_id` deixaria 28 eventos com estado contradizendo o novo dono.

## Artefatos (somente leitura, no banco)

- `public._r34_rd_deals_live` — espelho live dos deals won da RD
- `public._r34_replay` — classificacao dos 361 eventos
- `public._r34_alvo` — os 37 congelados (rollback: coluna `lead_atual`)

## SQL — aplicar (SO com GO explicito do dono)

```sql
begin;
update pixel_events p set lead_id = a.lead_esperado
from public._r34_alvo a
where p.event_id = a.event_id and p.event_name = 'Purchase'
  and p.lead_id = a.lead_atual;
-- exigir exatamente 37; qualquer outro numero => rollback
commit;
refresh materialized view public.mv_qualidade_campanha;
```

## SQL — rollback

```sql
update pixel_events p set lead_id = a.lead_atual
from public._r34_alvo a
where p.event_id = a.event_id and p.event_name = 'Purchase'
  and p.lead_id = a.lead_esperado;
```

Prova em transacao revertida (2026-08-26): update=37, aplicados=37,
rollback=37, colaterais fora do alvo=0.

## Fora de escopo desta rodada

As 44 duplicacoes economicas (mesmo deal -> mais de uma linha) continuam
abertas. Esta rodada trata apenas venda certa -> cliente errado.
