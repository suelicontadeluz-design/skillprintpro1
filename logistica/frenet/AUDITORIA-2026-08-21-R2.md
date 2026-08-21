# Auditoria rodada 2 — 21/08/2026

Chat `claude-20260821-criar-etiqueta-frenet-r2`, frente `agente-logistica-criar-etiqueta`.
Objetivo: eliminar todo bloqueio técnico possível **antes** de pedir peso/dimensões ao Alessandro.

Projetos: **CÉREBRO** `ldrdtaibazplvrbwyrvx` · **ERP** `ynjsflvdfftcopibzxyo`

---

## ELO 1 — precedência GPS: resolveu sozinho, sem inventar nada

`fn_gps_proxima('erp')` agora devolve `situacao: UNICA`,
`frente_escolhida: agente-pre-impressao-dtf`, `cobertura_precedencia.todas_cobertas: true`.

A AMBIGUA da rodada 1 desapareceu por mecanismo canônico, não por edição: as três
esperas que abri no post-flight tornaram `agente-logistica-criar-etiqueta` não-acionável,
e a regra `ACIONAVEL = elegivel E sem espera aberta` a tirou do conjunto de candidatas.
**Nada foi escrito em `gps_frente_precedencia`.**

Ordem viva da trilha (decisão do dono, 2026-08-20):
`erp-raio-x-backend` 1 · `entrega-cep-e-frete-sem-fonte-fiel` 2 ·
`integracao-cerebro-erp-identidade-v1` 3 (fechada) · `agente-pre-impressao-dtf` 4.
`agente-logistica-criar-etiqueta` continua **sem linha** de precedência.

**Consequência que só o Alessandro fecha:** quando as esperas desta frente forem
encerradas, ela volta a empatar com `agente-pre-impressao-dtf` e a trilha volta a
AMBIGUA. As opções, sem recomendação embutida:

- **(a) precedência 3** — emitir etiqueta antes de automatizar pré-impressão. Fecha
  o circuito comercial (vender → despachar → rastrear) antes de otimizar produção.
- **(b) precedência 5** — pré-impressão primeiro, mantendo o motivo já registrado
  em `agente-pre-impressao-dtf`: *"automação de pré-impressão só depois de o
  circuito operacional estar reconciliado"*. Note que esse motivo argumenta a favor
  de (a).
- **(c) deixar sem precedência** — a trilha volta a AMBIGUA e exige decisão a cada ciclo.

## ELO 2 — receptor: PATCH 0 escrito e testado, deploy barrado por exclusividade

Reauditado: `frenet-tracking-webhook` **v27 ACTIVE**, ezbr
`af11c994184067ab6748a249b51be628c17dd75608f49ca5bb0435acb60879a5` — byte-idêntico
ao baseline. Todos os defeitos confirmados de novo, nenhum corrigido em produção.

**Por que não deployei** — duas razões independentes, ambas de governança:

1. Essa Edge Function pertence a `logistica-frenet-fonte-canonica` (trilha
   `identidade`), não a esta frente. AGENTS.md: *"Se a frente estiver ocupada, não
   alterar nenhum arquivo, tabela, função, migration ou Edge Function relacionado a
   ela"* e *"cada chat pode possuir somente uma frente ativa por vez"*.
2. Aquela frente tem espera aberta `df611708` que fixa a **ordem causal**:
   Alessandro cadastra `FRENET_WEBHOOK_TOKEN_NAME` e `FRENET_WEBHOOK_TOKEN_VALUE`
   → *depois* deploy do PATCH 0 → *depois* validação 200/401/401. Deployar antes do
   secret faria o receptor responder 503 a tudo.

Entregue: `receptor/patch0.ts`, **20 testes passando**, pronto para o dono publicar.

Contrato implementado, na ordem: `request → autenticação → validação estrutural →
persistência → resposta`.

| Caso | Resposta |
|---|---|
| autenticado válido | 200 `{ok, duplicado:false, reconciliado}` |
| sem header de token | 401, nada persistido |
| token inválido | 401, nada persistido |
| token de tamanho diferente | 401 (comparação de tempo constante) |
| secret ausente no ambiente | **503**, nunca "aceita tudo" |
| método ≠ POST | 405 |
| JSON inválido | 400 |
| corpo que não é objeto | 400 |
| sem nenhum identificador | 422, não 200 silencioso |
| duplicata | 200 `duplicado:true`, uma única linha |
| evento novo do mesmo envio | grava (não é duplicata) |
| `OrderId` = telefone/CPF/e-mail | 200, `reconciliado:false`, `envio_id:null`, bruto preservado |
| falha de persistência | **500**, nunca 200 |
| todos os casos acima | **zero `fetch`** — verificado por espião global |

Correções sobre a v27: dedup filtra `payload->>chave_evento` (a v27 consultava
`pixel_events.select('id')`, coluna inexistente, e **descartava** o erro do
PostgREST, então o guard nunca disparava); o erro agora propaga e vira 500.
Reconciliação só aceita `OrderId` no formato UUID — o `envio_id` que nós mandamos.
Um teste lê o próprio fonte, remove comentários e falha se aparecer `botconversa`,
`send_message`, `api-key`, `whatsapp` ou `pixel_events` no código executável.

**Rollback:** nada foi publicado, então o rollback é não publicar. Quando for ao ar,
o byte-exato da v27 está preservado no corpo deste relatório pelo ezbr acima e o
fonte vigente é recuperável por `get_edge_function` antes do deploy.

## ELO 3 — endereço do destinatário: FONTE_CANONICA_PROVADA (correção da rodada 1)

Eu errei o escopo na rodada 1. Provei que `CEREBRO.public.pessoas` tinha 0 de 1754
com CEP e concluí "AUSENTE". Isso provava apenas que **aquela tabela** não era a fonte.

Varredura ponta a ponta desta rodada (Cérebro + ERP: colunas por regex de endereço,
colunas JSON/JSONB por chave, RD/CRM, CalcMe, Mercado Pago, marketing, webhooks):

- **Cérebro** — nada utilizável. `leads_marketing.zip_code` 1.621/15.825 e
  `pageview.zip` 17.625 são CEP de pixel/marketing, não cadastro de entrega.
  `joao_slots_observacao.cep_detectado` 120 é observação de conversa.
  `orcamentos.cep_destino` 19/99 é insumo de cotação. `mp_pix_cobrancas.payer` tem
  `phone`/`identification` **todos null**. `pessoas.metadata` só tem flags de duplicidade.
- **ERP** — a fonte existe, está modelada e está preenchida:

| Fonte | Cobertura |
|---|---|
| `ERP.public.pessoa_cliente_dados` | **130 linhas, 129 com cep + logradouro + numero + bairro + cidade + estado** (99,2%) |
| `ERP.public.pessoas` | nome, cpf/cnpj, telefone, whatsapp, email |
| `ERP.public.vendas.endereco_entrega` (jsonb) | override por pedido, shape `{cep, logradouro, numero, complemento, bairro, cidade, estado}` |
| `ERP.public.pessoa_cliente_dados.endereco_entrega` | override por cliente, 5/130 |

**Cobertura em pedidos reais:** das 8 vendas do ERP, **7 resolvem tudo** — liga
cliente, CEP, logradouro, número, bairro, cidade, UF, documento, telefone, e-mail.
Só a venda 19 não tem `cliente_id`. O vínculo é garantido pelo banco:
`vendas_cliente_id_fkey → pessoa_cliente_dados(id) ON DELETE RESTRICT`.

*(Autocorreção: minha primeira medição usou `pessoa_cliente_dados.pessoa_id` como
alvo da FK e deu 0 casamentos. A FK aponta para `.id`. Corrigido antes de concluir.)*

**Bloqueio que sobra, e é de projeto, não de dado:** `calcular-frete` roda no
Cérebro e não alcança o banco do ERP. Como pedido e endereço vivem no ERP, a
**emissão deve rodar no projeto ERP**. Registrado como `ponte_cerebro_erp` = AUSENTE.

## ELO 4 — remetente: fonte completa achada, mas com divergência viva

`ERP.public.perfil_empresa` (1 linha) tem **todo** o contrato preenchido:
razão social, nome fantasia, CNPJ (14 dígitos), e-mail, telefone, inscrição
estadual, CEP, logradouro, número, complemento, bairro, cidade, estado, país.
Substitui `frete_config[remetente]`, que só tinha `{uf, cep, cidade}`.

**Mas há duas verdades vivas para o CEP de origem:**

| Fonte | CEP |
|---|---|
| `ERP.public.perfil_empresa.cep` | **06803-150** |
| `CEREBRO.frete_config[remetente].cep` | **06813-230** |
| `calcular-frete` v34, `CEP_ORIGEM` hardcoded | **06813230** |

Ambos em Embu das Artes/SP. Endereço fiscal e endereço de postagem podem
legitimamente diferir — mas **muda o preço do frete** e não dá para escolher por
código. Classificado `AMBIGUA`. Só o Alessandro resolve.

Único outro reparo possível: `perfil_empresa.telefone` tem 10 dígitos (fixo).
Transportadora costuma querer celular. Não bloqueia sozinho.

**Nada foi inventado e nada foi buscado na internet sobre a Skillprint.**

## ELO 5 — adapter reconciliado

`fontes.ts` reescrito com o vocabulário pedido
(`FONTE_CANONICA_PROVADA` · `FONTE_CANDIDATA` · `INCOMPLETO` · `AMBIGUA` ·
`AUSENTE` · `AINDA_EM_DESENVOLVIMENTO` · `NAO_AUTORIZADA`), continua lido em
runtime, e **só `FONTE_CANONICA_PROVADA` libera emissão**.

Placar: **9 FONTE_CANONICA_PROVADA · 5 AUSENTE · 2 INCOMPLETO · 2 NAO_AUTORIZADA ·
1 AMBIGUA · 1 FONTE_CANDIDATA**.

Campos que bloqueiam emissão: **9 de 20** (rodada 1: 19 de 24).

Zero fallback heurístico novo. `COTAR` intacto, `VALIDAR_EMISSAO` local,
`EMITIR` selado. `INDETERMINADA → NEEDS_HUMAN` preservado.

## ELO 6 — peso/dimensões

Continua AUSENTE, agora com o inventário exato: ver `ENTREVISTA-FISICA.md`.
12 produtos ativos, 1 com peso e dimensões, `gramatura_g_m2` NULL em 12 de 12,
dois regimes de venda (`unidade` × `metro_linear`) e nenhuma regra de embalagem
ou empilhamento em lugar nenhum.

## ELO 7 — Frenet

Egress deste ambiente continua bloqueando `docs.frenet.com.br`,
`api.frenet.com.br` e `frenet.com.br` (CONNECT 403). Falta base URL de produção
do Whitelabel e confirmação formal do contrato de webhook — ambos entregues pela
Frenet na homologação.

**Divergência a reconciliar:** a espera `df611708` manda cadastrar os tokens
"no painel da Frenet (webhook de tracking)". Isso vem da premissa antiga. Pela
premissa vigente, a URL e os tokens vão no corpo da criação do pedido via API.
A parte que continua válida é cadastrar os dois secrets. Como aquela espera
pertence a outra frente, não a editei.
