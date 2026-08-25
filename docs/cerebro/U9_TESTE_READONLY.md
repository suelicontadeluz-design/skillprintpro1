# U9 — teste read-only da cadeia campanha -> lead -> contato -> venda

Projeto: Supabase `ldrdtaibazplvrbwyrvx` · Coleta: 2026-08-25 · Somente `SELECT`.

## VEREDITO: U9_PARCIAL

Fecha: identidade do lead, atribuicao de campanha, ordem temporal, autoria de contato.
Nao fecha: o efeito causal do contato — que era o motivo pelo qual U9 existia.

## O que mudou em relacao ao MAPA V0 (auto-refutacao)

1. **Fonte de contato errada.** O V0 mede "tocado" por `mensagem_envio`, que so existe
   desde **12/08/2026 (13 dias)**. A fonte real e `fact_conversations`: 268.471 linhas
   desde 30/03/2026, 154.226 outbound, 96,2% com `lead_id`, autoria por `source`.
2. **G2 exagerado.** Cobertura real vs a publicada no V0:
   | classe | V0 | real (fact_conversations) |
   |---|---|---|
   | quente | 33,1% | **55,4%** |
   | morno | 29,7% | 57,8% |
   | frio | 3,2% | 39,1% |
   | cliente_ativo | 14,8% | 82,3% |
   | fechamento | 0% | 50% (1 de 2) |
3. **Atribuicao de campanha existe.** O V0 diz "sem chave confiavel campanha->lead".
   Real: 72,4% dos leads de 120d tem `utm_campaign_id`; **0 leads sem nenhuma origem**.

## Identidade: FORTE

- 719 Purchases/90d, **100% com `lead_id`**, 0 duplicatas de `event_id` em 989/120d.
- 316 leads compradores: 316/316 em `leads_marketing` e `lead_identificadores` com telefone.
- Telefone -> lead: 826/844 (97,9%) match unico; 1 ambiguo; 8 colisoes em 15.641.
- Recuperando `lead_id` por telefone, 99% das mensagens ficam ligadas a um lead.

## A tautologia que invalida o teste por score

`fn_classificar_score(p_score_total, p_has_purchase_30d)`:

```sql
IF p_has_purchase_30d THEN RETURN 'cliente_ativo'; END IF;
```

`cliente_ativo` **e** "comprou nos ultimos 30 dias". Medir conversao por classificacao
atual e circular. Confirmado: 100% dos 217 compradores classificados como cliente_ativo
tiveram o score gravado DEPOIS da compra; as classes de ataque somam 0 vendas em 30d.

## Teste principal (coorte por data de cadastro, 120d..31d, observacao 30d)

| grupo | leads | vendas | conversao | receita |
|---|---|---|---|---|
| tocados | 3.321 | 171 | **5,15%** | R$ 118.265,05 |
| nao tocados | 746 | 2 | **0,27%** | R$ 275,25 |

Parece 19x. **Nao e.** Estratificando por engajamento do lead (inbounds):

| inbounds | tocado | leads | vendas | conversao |
|---|---|---|---|---|
| 0 | nao | 726 | 2 | 0,28% |
| 0 | **sim** | 1.102 | 1 | **0,09%** |
| 1-4 | sim | 862 | 1 | 0,12% |
| 5-19 | sim | 917 | 9 | 0,98% |
| 20+ | sim | 440 | 160 | **36,36%** |

- No estrato **0 inbound** — exatamente onde a Rota A atuaria — ser tocado **nao ajuda**
  (0,09% tocado vs 0,28% nao tocado).
- Todo o efeito esta em **20+ inbound**, que nao tem contrafactual: se o lead manda 20
  mensagens, alguem responde. Colinearidade perfeita.
- Nao-tocados tem inbound em 2,7% dos casos (media 0,2); tocados, 66,8% (media 11,5).
  O grupo de controle e composto de leads que nunca falaram com a empresa.

## Associacao observada por agente (CAUSALIDADE NAO PROVADA)

| source | leads tocados | vendas apos contato | conv. | receita | mediana contato->venda |
|---|---|---|---|---|---|
| zapi (generico) | 3.261 | 170 | 5,21% | R$ 116.470,05 | 55,9h |
| julia | 2.107 | 128 | 6,07% | R$ 87.189,62 | 55,9h |
| joao | 501 | 41 | 8,18% | R$ 19.244,81 | 39,6h |
| marcos | 17 | 3 | 17,65% | R$ 1.851,18 | 4,9h |
| bruno | 54 | 2 | 3,70% | R$ 315,13 | 38,8h |

Os `source` se sobrepoem (3.261+2.107+501 > 3.321 tocados): autoria nao e exclusiva.
`marcos` com 17,65% tem n=17 — ruido, nao performance.

## Campanha -> lead -> venda

- 5.359 leads/120d: 72,4% com `utm_campaign_id`, 2.119 com `ctwa_clid`, 1.458 organicos,
  **0 sem origem**.
- Dos 382 leads compradores/120d: 132 (34,6%) com campaign_id; 102 dessas campanhas
  existem em `meta_ads_insights` (a chave resolve).
- **Receita atribuivel a campanha: R$ 85.071,96 de R$ 396.005,57 = 21,5%.**
- **Receita organica: R$ 277.381,37 = 70%.**

## Purchase e venda ganha, nao pagamento

863 purchases com prefixo `won_`; 401 casaram com `propostas_rd`; desses **384 (95,8%)
tem `deal_status='won'`** — logo Purchase = deal ganho no RD CRM.
Ressalvas: 17 (4,2%) com status diferente de won; 49 linhas com valor divergente da
proposta, somando R$ 20.193,90 de diferenca absoluta; 53,5% dos `won_` nao casam com
`propostas_rd` e nao puderam ser validados. "Ganho" continua diferente de "pago" (U1).

## Valor esperado da Rota A

**NAO CALCULADO.** A unica evidencia disponivel para o estrato onde a rota atuaria
(leads sem conversa ativa) aponta conversao de 0,09% para tocados contra 0,28% para
nao tocados. Nao ha diferenca positiva para multiplicar.

## Proximo passo minimo sugerido (nao implementado)

Trocar a fonte de "tocado" de `mensagem_envio` para `fact_conversations` dentro de
`fn_mapa_cerebro_v0()`, e passar a publicar `inbounds_30d` junto da cobertura.
Uma unica funcao alterada, nada criado. Corrige G2, corrige a relacao
`lead_score_comercial -> atendimento` e da ao GPS o unico preditor que se sustentou:
conversa ativa.
