# Auditoria mecânica — 21/08/2026

Sessão `claude-20260821-criar-etiqueta-frenet`, frente `agente-logistica-criar-etiqueta`.
Somente leitura, exceto o claim/heartbeat de governança.

Projetos: **CÉREBRO** = `ldrdtaibazplvrbwyrvx` · **ERP** = `ynjsflvdfftcopibzxyo` (criativa-futuro-erp)

## A. Qual função ACTIVE calcula frete hoje

`calcular-frete` v34 ACTIVE no CÉREBRO, ezbr `568730ee1d9a04a90b4f755e35b232ff21db794b063220cb4c683d35938aae13`.
Fonte espelhada em `suelicontadeluz-design/skillprint-erp:supabase/functions/calcular-frete/index.ts`.
`POST http://api.frenet.com.br/shipping/quote`. Origem fixa `06813230`.

## B. Como TOKEN_FRENET é usado hoje

`const FRENET_TOKEN = Deno.env.get('TOKEN_FRENET')` → header `token` na cotação.
Uma única referência em todo o código examinado. **Não substituído.**

## C. FRENET_PARTNER_TOKEN consumido separadamente

Separação garantida em código (`segredos.ts`): nomes distintos, headers distintos
(`token` vs `partnerToken`), e `conferirSeparacaoDeCredenciais()` recusa colisão.

**Não provei presença em runtime.** Os dois probes que existiam
(`debug-secrets` v38, `env-probe` v17) estão aposentados — ambos retornam
`410 gone`. Provar presença exigiria deployar um probe novo, o que é alteração
de produção sem gate. Fica como pendência.

## D/E. Endpoints Frenet

**Limite honesto:** o egress deste ambiente bloqueia `docs.frenet.com.br`,
`api.frenet.com.br` e `frenet.com.br` (CONNECT tunnel 403). Nada foi chamado.

| Endpoint | Efeito | Como verifiquei |
|---|---|---|
| `/shipping/quote` | cota | código nosso em produção |
| `/shipping/info`, `/CEP/Address`, `/tracking/trackinginfo` | consulta | SDK oficial `FrenetGatewaydeFretes/frenet-php` (clonado) |
| `/v1/orders` | cria pedido, *aguardando pagamento* → *aguardando impressão*, **não debita** | índice público de doc, não lida |
| `/v1/orders/oneclick` | valida + cria + **paga** + imprime, 1 requisição | índice público de doc, não lida |
| `/v1/shipments/oneclick` | gera etiqueta (Whitelabel) | índice público de doc, não lida |

Achado estrutural: o SDK **oficial** da Frenet não tem criação de pedido nem compra
de etiqueta — só cotação, CEP e tracking. Emissão pertence ao produto
Whitelabel/Envios, com base URL e credenciais próprias entregues na homologação.
Isso explica mecanicamente por que existem dois tokens.

**Consequência:** a base do Whitelabel vem de `FRENET_WHITELABEL_BASE_URL`.
Nenhuma URL de produção foi adivinhada.

## Mapa campo → fonte

Estado atual, por contagem:

| Campo | Fonte | Classificação | Evidência |
|---|---|---|---|
| pedido | ERP `vendas` | AINDA_EM_DESENVOLVIMENTO | 6 linhas; `venda_itens` 3 |
| pedido (alt.) | CÉREBRO `orcamentos` | INCOMPLETO | 99 linhas (38 pagas), sem destinatário/itens |
| destinatário nome | ERP `pessoas` | AINDA_EM_DESENVOLVIMENTO | 136 linhas, sem ponte com o Cérebro |
| CPF/CNPJ | `pessoas.cpf/cnpj` | INCOMPLETO | CÉREBRO 976 cpf + 502 cnpj de 1754 |
| telefone | `lead_identificadores` | AUTORIDADE_CONFIÁVEL | 15715 linhas; `pessoas.telefone` 1554/1754 |
| e-mail | `pessoas.email` | INCOMPLETO | 1325/1754 |
| **CEP** | ERP `pessoas.cep` | **NÃO_EXISTE** | CÉREBRO `pessoas`: **0 de 1754** |
| **rua** | `pessoas.logradouro` | **NÃO_EXISTE** | **0 de 1754** |
| **número** | `pessoas.numero` | **NÃO_EXISTE** | **0 de 1754** |
| complemento | `pessoas.complemento` | NÃO_EXISTE | 0 preenchidas |
| **bairro** | `pessoas.bairro` | **NÃO_EXISTE** | **0 de 1754** |
| **cidade** | `pessoas.cidade` | **NÃO_EXISTE** | **1 de 1754** |
| **UF** | `pessoas.estado` | **NÃO_EXISTE** | sem preenchimento útil |
| remetente | `frete_config[remetente]` | INCOMPLETO | só `{uf, cep, cidade}` — falta CNPJ, rua, número, bairro, telefone, e-mail |
| itens / quantidade | ERP `venda_itens` | AINDA_EM_DESENVOLVIMENTO | 3 linhas |
| **peso / altura / largura / comprimento** | ERP `produtos` | **AINDA_EM_DESENVOLVIMENTO** | **1 de 12 produtos** tem `peso_bruto_kg` (0,15) e dimensões |
| embalagem heurística | `frete_config[embalagem]` | NÃO_AUTORIZADO_PARA_EMISSÃO | `peso_por_metro_g: 100` + 2 caixas fixas; regra de cotação DTF |
| valor declarado | `orcamentos.valor_total` | INCOMPLETO | `calcular-frete` usa default 50 |
| serviço | `operacoes_financeiras[kind=frete]` | INCOMPLETO | 125 ops; `components` só `{cep, servico}`; **0 com peso** |
| etiqueta/tracking | — | **NÃO_EXISTE** | **zero** tabelas/views `etiqueta/label/shipment/tracking/rastreio` no CÉREBRO |

**19 de 24 campos obrigatórios bloqueiam emissão.**

## Regra dura confirmada

Peso e dimensões dependem da entrevista física que ainda não terminou. A frente
`entrega-cep-e-frete-sem-fonte-fiel` está **bloqueada** exatamente nisso:
*"Aguarda fonte fisica confiavel de peso/volume/dimensoes/embalagem por produto."*
Nenhum default foi inventado; a heurística DTF é classificada
`NAO_AUTORIZADO_PARA_EMISSAO` e recusada pelo validador.

## Achado colateral — receptor de webhook

`frenet-tracking-webhook` v27 ACTIVE, ezbr `af11c994…` (mesmo ezbr da v25 já
auditada — nenhuma mudança de código desde então; o "PATCH 0" citado na frente
`logistica-frenet-fonte-canonica` **não está deployado**). No código vigente:

1. `verify_jwt=false` e **zero** verificação de token → qualquer um pode postar;
2. dispara WhatsApp via BotConversa **antes** de qualquer persistência;
3. dedup consulta `pixel_events.select('id')` — coluna que não existe — e o erro
   do PostgREST é descartado, então o guard nunca dispara;
4. interpreta `OrderId` como telefone/CPF/e-mail do cliente.

Enquanto isso valer, informar essa URL na criação do pedido transformaria a
primeira etiqueta real em WhatsApp indevido. `auditarReceptor()` reprova.

## Governança

- `AGENTS.md` (51 linhas, `skillprint-erp`) lido integralmente.
- `fn_contexto_codex_frentes(200)` executada.
- Trilha `erp` estava **AMBÍGUA** (2 candidatas, `rota_escolhida: []`).
  `gps_frente_precedencia` cobre `agente-pre-impressao-dtf` (4) mas **não** esta
  frente — lacuna de política que só Alessandro fecha. Não escrevi nela.
- `fn_frente_claim` — gate final, `ok=true`, `claim_criado`, trilha `erp` livre.
- `gps_autoridade_frente`: **sem linha** para esta frente → sem autonomia para
  deploy, dinheiro, produção ou mensagem externa. Fail-closed respeitado.
