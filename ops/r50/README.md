# R50 — o HTTP 401 da RD: causa provada, e a causa era minha

Rodada READ-ONLY de 2026-08-26. **Nenhuma escrita. Nenhum token alterado.
Nenhuma credencial gerada.**

## Veredito antecipado

**RD_AUTH_RESTAURADA** — no sentido de que a capacidade de perguntar a RD ao
vivo esta comprovadamente disponivel. Mas a palavra "restaurada" e generosa
demais comigo: **nada estava quebrado.** A autenticacao da RD funcionou o tempo
todo, inclusive durante a R48 e a R49.

**Causa: SECRET_ERRADO / ENDPOINT_ERRADO — erro meu de diagnostico, nao falha da
RD, nem do token, nem do proxy, nem do Supabase.**

## §1 — Reproducao do 401

Executado em **2026-08-26 15:52:42 UTC**, tres chamadas no **mesmo statement**,
usando o **mesmo token**, na **mesma linha do tempo**:

| # | endpoint | metodo | auth | status | corpo |
|---|---|---|---|---:|---|
| A | `api.rd.services/crm/v2/deals?filter=status:won,pipeline_id:…` | GET | `Bearer` | **200** | `{"data":[{"id":"69d8e427…","name":"Sidney Ferreira Cruz \| 5511940310917",…}]}` |
| B | `api.rd.services/crm/v2/deals/6a3d88c9db321b001d6bff57` | GET | `Bearer` | **200** | `{"data":{"name":"Kleberson \| 5511972491479","status":"won","total_price":1799.79,…}}` |
| C | `crm.rdstation.com/api/v1/deals/6a3d88c9db321b001d6bff57` | GET | `?token=` | **401** | `{"error":"Permission denied."}` |

Fonte da credencial nas tres: `public.token_crm.token`, mesma linha, mesma
leitura. Segredo nao impresso.

**O controle e decisivo:** mesmo segredo, mesmo instante, mesmo cliente HTTP.
Se a credencial estivesse expirada ou revogada, A e B teriam falhado junto com
C. Nao falharam.

O 401 e real e e da RD — mas de **outro produto da RD**. `crm.rdstation.com` e a
API legada do CRM (linhagem Plug/PipeRun). Esta conta nunca a usou. O token nao
tem permissao la, e `Permission denied.` e a resposta **correta**.

## §2 — A credencial de verdade

| item | valor |
|---|---|
| onde mora | `public.token_crm` (linha unica, `id 22c0110e…`) |
| tipo | OAuth2 **access token** da RD Station, 32 chars alfanumericos |
| `refresh_token` | presente, 32 chars |
| client_id / app | `455993cd-c33c-4ed0-9f73-71706df6b2aa`, fixo em `rd-token-refresh` |
| quem le | `getRDToken()` — `supabase.from("token_crm").select("token")` |
| quem escreve | edge `rd-token-refresh` v72, via `POST api.rd.services/oauth2/token` (`grant_type=refresh_token`) |
| renovacao | **cron jobid 40, `0 */1 * * *`, ativo** — de hora em hora |

Segredo nao impresso em nenhum momento.

## §3 — O que mudou entre o 200 e o 401: o host, e so o host

A fonte da verdade nao foi memoria minha: foi o codigo vivo de
`rd-won-pixel-sync` **v56**, o produtor que gerou os `rd_won_` das rodadas
anteriores:

```ts
const rdRes = await fetch(
  `https://api.rd.services/crm/v2/deals?filter=status:won,pipeline_id:${PIPELINE_VENDAS}` +
  `&page[number]=${page}&page[size]=100&sort=-closed_at`,
  { headers: { "accept": "application/json", "Authorization": `Bearer ${rdToken}` } }
);
```

| | R43–R47 (200) | R48/R49 (401) |
|---|---|---|
| host | **`api.rd.services`** | **`crm.rdstation.com`** |
| path | `/crm/v2/deals…` | `/api/v1/deals/<id>` |
| auth | `Authorization: Bearer <token>` | `?token=<token>` na query |
| segredo | `token_crm.token` | **o mesmo** |
| funcao chamadora | a mesma consulta ad-hoc via extensao `http` | idem |

**Unica diferenca: eu troquei o host e o esquema de autenticacao.** Na R48
cheguei a tentar `Bearer`, mas contra `crm.rdstation.com/api/v2/...`, que
devolveu `403 Forbidden` do nginx — erro de rota, nao de credencial. Li os dois
sintomas como "a RD caiu". Estava errado.

## §4 — Token expirado? Nao. Refutado com dado.

O token **expira** e **exige refresh** — isso e verdade da integracao. Mas nao
foi o que aconteceu:

| evidencia | resultado |
|---|---|
| cron `rd-token-refresh` nas ultimas 48h | **48 execucoes, 48 `succeeded`, 0 falhas** |
| ultima renovacao | 2026-08-26 **15:00:00** — minutos antes do meu "diagnostico" |
| chamada A/B agora | **200** |

Nao houve revogacao, nem perda de escopo, nem app desconectado, nem rotacao
falha. Nao simulei o fluxo de refresh porque **nao ha nada a refrescar**: o
token corrente autentica.

## §5 — Outros consumidores: `ALGUMAS_AINDA_200`

Sondagem ao vivo, mesma credencial, mesmo instante:

| superficie | status | leitura |
|---|---:|---|
| `api.rd.services/crm/v2/deals` | **200** | OK |
| `api.rd.services/crm/v2/deals/<id>` | **200** | OK |
| `api.rd.services/crm/v2/contacts` | **200** | OK |
| `api.rd.services/crm/v2/users` | **200** | OK |
| `api.rd.services/marketing/account_info` | 401 | `invalid_token` — **outro escopo** (Marketing), nao e o nosso |
| `crm.rdstation.com/api/v1/deals` | 401 | `Permission denied.` — **outro produto**, nao e o nosso |
| `…/deal_products`, `…/deal_pipelines` | 404 | rota inexistente, **nao e auth** |

Os tres corpos de erro sao distintos — `Permission denied.`, `invalid_token`,
`404 Page not found`. Tratar tudo como "a RD caiu" apagava essa diferenca.

### E os consumidores reais nunca pararam

| cron RD (48h) | ok | falha |
|---|---:|---:|
| `rd-deal-backfill-cron` | **192** | 0 |
| `rd-deal-produtos-sync-30min` | **96** | 0 |
| `rd-stage-sync-quente-horario` | 48 | 0 |
| `rd-token-refresh` | 48 | 0 |
| `rd-won-pixel-sync-diario` | 2 | 0 |
| `rd-stage-sync-frio-diario` | 2 | 0 |
| `analise-conversas-rdcrm-diario` | 2 | 0 |

Ressalva honesta: `succeeded` no cron prova que o disparo HTTP funcionou, nao o
que a RD respondeu dentro da edge. Entao busquei o efeito colateral:

**`deal_produtos_rd_obs` recebeu 29 linhas nas ultimas 6 horas, a ultima as
14:30:13 UTC** — dentro da janela em que eu afirmava que a RD estava fora. Essas
linhas so existem se houve leitura ao vivo bem-sucedida.

(`crm_deals_cache` segue congelado desde 2026-08-16. Condicao pre-existente, ja
conhecida desde a R43, nao relacionada.)

## §6 — Cache nao foi usado como prova

A prova de autenticacao veio de **chamadas HTTP reais**, com status e corpo
registrados. `crm_deals_cache`, `propostas_rd`, `_r34_rd_deals_live` e
`deal_produtos_rd_obs` aparecem aqui apenas como **evidencia de que houve
trafego**, nunca como substituto da chamada.

## §7 — Causa

**SECRET_ERRADO** (no sentido de credencial certa aplicada no servico errado),
combinado com **ENDPOINT_ERRADO**.

Descartados com evidencia: `TOKEN_EXPIRADO`, `TOKEN_REVOGADO`,
`REFRESH_NAO_EXECUTADO`, `ESCOPO_PERDIDO`, `APP_DESCONECTADO`, `ENDPOINT_MUDOU`
(o endpoint nao mudou — eu e que mudei).

## §8 — Correcao minima: nenhuma mudanca de sistema

A correcao correta e **nao mexer em nada**. O token esta valido, o refresh esta
ativo e todos os consumidores funcionam. Trocar secret, gerar credencial ou
religar o app teria **introduzido** um incidente onde nao havia nenhum.

A correcao e de conhecimento, e fica registrada aqui:

```
BASE:  https://api.rd.services/crm/v2
AUTH:  Authorization: Bearer <token_crm.token>
NAO USAR: crm.rdstation.com  (produto legado, sem permissao nesta conta)
NAO USAR: ?token= na query   (esquema da API legada)
```

Escritas nesta rodada: **0 UPDATE, 0 INSERT, 0 DELETE, 0 DDL, 0 deploy.**

## §9 — Teste pos-correcao: os 8 deals da Vanessa ao vivo

`GET api.rd.services/crm/v2/deals/<id>`, um por deal:

| deal | nome na RD | status | `total_price` | `valor_sinc` | bate | `closed_at` | pipeline |
|---|---|---|---:|---:|:--:|---|:--:|
| `69aeec24` | Vanessa Büher \| 554195338939 | won | 764,73 | 764,73 | ok | 2026-03-09 | vendas |
| `698b4051` | Vanessa Büher \| 554195338939 | won | 418,31 | 418,31 | ok | 2026-02-10 | vendas |
| `698c879a` | Vanessa Büher \| 554195338939 | won | 308,51 | 308,51 | ok | 2026-02-11 | vendas |
| `69c18a38` | Vanessa \| 554195338939 | won | 308,51 | 308,51 | ok | 2026-03-23 | vendas |
| `69930e83` | Vanessa Büher \| 554195338939 | won | 308,51 | 308,51 | ok | 2026-02-16 | vendas |
| `69b93ac9` | Vanessa Buher \| 554195338939 | won | 303,60 | 303,60 | ok | 2026-03-17 | vendas |
| `69bae06e` | Vanessa \| 554195338939 | won | 209,64 | 209,64 | ok | 2026-03-18 | vendas |
| `69b031db` | Vanessa Buher \| 554195338939 | won | 179,70 | 179,70 | ok | 2026-03-10 | vendas |

**8/8 HTTP 200 · 8/8 `won` · 8/8 no pipeline de vendas
(`63191f7dd02b2e000cb1805b`) · 8/8 `total_price` = `valor_sinc` · 8/8 com
`closed_at`.**

Soma: **R$2.801,51**, identica a medida na R48 e na R49.

Os 8 nomes carregam `554195338939` — a forma de 12 digitos, do lead fragmento.
Consistente com R48/R49.

**Nenhum Purchase foi inserido. Nenhum backfill foi executado.**

## §10 — Auto-refutacao

- *A credencial nao expirou?* Correto, nao expirou — e essa era a minha hipotese
  errada. Refresh 48/48 ok, ultimo as 15:00, e A/B respondem 200 agora.
- *O erro nao e da RD?* E da RD, sim — corpo JSON `{"error":"Permission
  denied."}`, servido por host RD. So que de **outro produto** da RD.
- *E proxy ou Supabase?* Nao: a extensao `http` roda dentro do Postgres da
  Supabase e nao passa pelo proxy do agente. E o mesmo caminho devolveu 200 para
  A e B no mesmo statement.
- *Um token alternativo esta sendo usado?* Nao. As tres chamadas leem a mesma
  linha de `token_crm`, no mesmo CTE. Nao ha segunda fonte de token RD no banco.
- *A funcao usa secret diferente?* Nao. `rd-won-pixel-sync` v56 le
  `token_crm.token`. `client_id`/`client_secret` so aparecem em
  `rd-token-refresh`, exclusivamente para o `grant_type=refresh_token`.
- *O 401 e so de um endpoint especifico?* **Sim — e essa e a conclusao.** Toda a
  superficie `api.rd.services/crm/v2` responde 200.
- *Corrigir o secret quebraria outro consumidor?* Pergunta felizmente vazia:
  nenhum secret foi tocado. Se eu tivesse "corrigido" o token com base no
  diagnostico da R48, teria rotacionado a credencial de 7 crons saudaveis.

Nenhuma refutacao sobreviveu.

## §11 — Veredito

**RD_AUTH_RESTAURADA**, com a ressalva de que nunca esteve perdida.

| pergunta | resposta |
|---|---|
| ultimo 200 | ininterrupto — `deal_produtos_rd_obs` gravou as 14:30 de hoje |
| primeiro 401 | R48, contra `crm.rdstation.com` — host que nunca foi o nosso |
| credencial usada | `token_crm.token`, OAuth2 RD, renovada de hora em hora |
| diferenca encontrada | **host e esquema de auth**, nada mais |
| causa | erro de endpoint meu |
| correcao | nenhuma mudanca de sistema; conhecimento corrigido |
| teste 200 | A, B e as 8 chamadas da Vanessa |
| 8 deals reancorados | **8/8 won, R$2.801,51** |

## §12 — Correcao das rodadas anteriores

A R48 declarou "**Gate de ambiente: a RD ao vivo caiu**" e a R49 concluiu
"**enquanto a RD nao voltar, a R50 nao comeca**". **As duas afirmacoes estao
erradas** e ja foram corrigidas em `ops/r49/README.md`.

O que **nao** muda: a R48 e a R49 nao dependiam da RD para nada que afirmaram.
A identidade dos tres casos foi provada por `lead_identificadores`,
`bc_subscriber_lookup` e `lead_merge_log` — chaves locais. Os 8 desbloqueados
foram medidos sobre o mapa e `leads_marketing`. A camada da R49 nao usou a RD.
Nenhum numero publicado nas duas rodadas muda.

O que muda: o **item que ficou INDETERMINADO na R48 por falta de RD** — o par de
R$1.799,79 do Kleberson — deixa de ter esse impedimento. Continua indeterminado
por merito proprio, mas agora e investigavel.

## §13 — Proximo passo

**R51 — backfill dos 8 deals da Vanessa.** O gate de reancoragem esta cumprido
por esta rodada. Falta, e nao foi feito aqui:

- decidir a **qual dos dois leads** cada Purchase se ancora. A pessoa e unica
  desde a R49, mas `pixel_events.lead_id` continua sendo lead, nao pessoa. Os 8
  deals nomeiam `554195338939` (fragmento) e o mapa aponta 7 deles para o
  canonico `9abb20c2` — **essa contradicao precisa ser resolvida antes**, nao no
  meio da escrita;
- gate obrigatorio de `fn_cancelar_disparos_apos_compra` e
  `fn_trigger_feedback_purchase`, que agem por `lead_id` **sem filtro de data**;
- idempotencia por `event_id = 'rd_won_' || deal_id`;
- zero atribuicao fabricada.

Fora de escopo, registrados: os 22 SEM_LEAD; o par da Igreja (466,68 / 466,80);
o par de R$1.799,79 do Kleberson — este agora **desbloqueado para investigacao**;
`crm_deals_cache` congelado desde 16/08.
