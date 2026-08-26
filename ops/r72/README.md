# R72 — Audiência de reativação V2, em shadow

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY / SHADOW.
Nenhuma campanha criada, nenhuma mensagem enviada, audiência legada não usada como fonte,
canário intocado.

**Regra central:**
> Não reativar "quem está numa fila". Reativar somente quem, na realidade econômica de AGORA, é
> cliente, está fora do seu ciclo normal e continua elegível para contato.

---

## §1 — A unidade é o cliente econômico, não o lead

Reconstruído de `vw_fato_comercial_identidade_canario`, agregado por `cliente_key`:

**510 clientes · 1.610 fatos · R$ 645.340,00** · **7 clientes sem lead** (§11) ·
**2 identidades com múltiplos leads** (§10) — e cada uma conta como **um** cliente, não dois.

---

## §4 — Os limiares da R71 sobrevivem à mudança de unidade

Medidos agora por `cliente_key`, não por lead:

| classe | intervalos | clientes | mediana | p75 | **p90 agora** | p90 R71 (lead) |
|---|---|---|---|---|---|---|
| FREQ_2_3 | 158 | 123 | 13,8 d | 34,0 d | **83,5 d** | 83,7 d |
| FREQ_4_PLUS | 942 | 93 | 7,0 d | 16,2 d | **30,9 d** | 31,2 d |

Praticamente idênticos. A regra é estável entre as duas unidades.

---

## §8 — O corte de `MUITO_ANTIGO` também veio do dado

Em vez de escolher um multiplicador, medi onde a recompra espontânea colapsa:

| classe | ≤ p90 | p90–2p90 | 2p90–3p90 | **> 3p90** |
|---|---|---|---|---|
| FREQ_2_3 | 89,9% | 8,9% | 1,3% | **0,0%** |
| FREQ_4_PLUS | 89,9% | 7,6% | 1,7% | **0,7%** |

Acima de 3×p90 a volta espontânea praticamente não acontece. Daí `MUITO_ANTIGO = > 3×p90`
(250 d para FREQ_2_3, 93 d para FREQ_4_PLUS) — **medido, não arbitrado**.

E a contrapartida honesta: na faixa `ESFRIANDO` **≈10% voltariam sozinhos**. Esse é o custo
conhecido de enviar mensagem para essa faixa.

---

## §5/§13 — `vw_audiencia_reativacao_v2_shadow`

| estado econômico | FREQ_2_3 | FREQ_4_PLUS | FREQ_1 | total |
|---|---|---|---|---|
| RECOMPROU_RECENTEMENTE (≤ mediana) | 22 | 29 | — | 51 |
| AINDA_NO_CICLO_NORMAL (≤ p90) | 54 | 34 | — | 88 |
| **ESFRIANDO (p90 → 3×p90) = alvo** | **47** | **21** | — | **68** |
| MUITO_ANTIGO (> 3×p90) | 0 | 9 | — | 9 |
| SEM_HISTORICO_SUFICIENTE (1 compra) | — | — | 294 | 294 |
| | | | | **510** ✓ |

`ZERO` gravação em `crm_campaign_audiences`. A view carrega o contrato no próprio dado:
*"Audiência não autoriza envio: a revalidação acontece no instante do disparo (R71)."*

---

## §2/§3 — Por que 68 e não os 108 da R68

A R68 não estava errada; usava buckets fixos. Reconstruindo as duas regras hoje, a conta fecha
exatamente:

| | clientes | LTV |
|---|---|---|
| regra R68 recriada hoje (≥2 compras, > 30 dias) | **108** | R$ 168.549,65 |
| ⤷ **R72 ESFRIANDO** | **68** | R$ 112.985,17 |
| ⤷ FREQ_2_3 com 31–83 dias que **ainda estão no ciclo** | **31** | R$ 36.781,49 |
| ⤷ **MUITO_ANTIGO** (> 3×p90) | **9** | R$ 18.782,99 |
| | **68 + 31 + 9 = 108** ✓ | |

Os **31** são o ponto: com 2–3 compras, o p90 da própria classe é **83,5 dias**. Mandar
"sentimos sua falta" a alguém com 40 dias sem comprar, quando 90% dessa classe volta em até 83,
é falar cedo demais. O corte fixo de 30 dias da R68 não sabia disso.

---

## §14 — Legado × V2: populações quase disjuntas

| | |
|---|---|
| legado: leads pendentes | **694** |
| **legado sem nenhum cliente V2 elegível** | **680 (98%)** |
| V2: clientes elegíveis | **68** |
| **V2 sem nenhum lead na fila legada** | **54 (79%)** |
| interseção | **14** clientes (9 contatáveis) |

Somando o que a R71 já tinha medido do lado legado — 561 de 694 nunca compraram, 33 já voltaram
sozinhos — a conclusão fica quantitativa: **são duas populações diferentes, com ~2% de
sobreposição.**

---

## §9/§15 — Universo testável

| | clientes | LTV observado | compras médias | dias médios |
|---|---|---|---|---|
| **CONTATÁVEL** | **45** | **R$ 66.514,68** | **4,1** | 107 |
| sem consentimento | 22 | R$ 43.530,99 | 3,3 | 118 |
| `ELEGIVEL_SEM_CANAL` (cliente sem lead) | 1 | R$ 2.939,50 | 3,0 | 154 |
| | **68** | R$ 112.985,17 | | |

Contatável = elegível **e** existe um lead com telefone, `consentimento = true` e sem registro em
`crm_contact_optouts`. Nenhum lead foi criado para o cliente sem canal (§11).

**A diferença de qualidade contra a fila legada é grande:** os 32 contatáveis que a R71 achou no
legado tinham **1,6 compras médias**; estes 45 têm **4,1**.

---

## §12 — Produto: não segmentei

`content_category` continua sendo **segmento de cliente**, não produto (provado na R65: das 46
compras sem `product_type`, zero eram copo/caneca/brinde e as categorias eram `catolicos`,
`evangelicos`, `terceirao`…). Sem fonte canônica de produto com cobertura suficiente, **não
segmentei por produto** em vez de segmentar por um campo que mente.

---

## §17 — O que podemos e o que não podemos afirmar

**Podemos medir:** resposta · Purchase/deal canônico posterior (R67) · receita observada.
**Não podemos provar:** margem incremental líquida · payback econômico.

`calcme_itens_pedido` continua vazia. Isso **não bloqueia** construir a audiência — e **bloqueia**
qualquer afirmação de ROI.

**§16:** nenhum uplift estimado. Não multipliquei taxa observacional × audiência × LTV.

---

## §18 — Contrato de revalidação no envio (simulado, não implementado)

A audiência criada hoje **nunca é autorização suficiente**. No instante do disparo:

1. o cliente ainda existe na camada canônica?
2. ainda está em `ESFRIANDO` pela p90 da **sua** classe?
3. não comprou depois de entrar?
4. o lead de contato ainda tem telefone?
5. `consentimento = true` **agora**?
6. não está em `crm_contact_optouts` **agora**?
7. `crm_campaign_autonomy_policy.ativo` liberado?
8. só então enviar.

---

## §20 — Auto-refutação

| tentativa | resultado |
|---|---|
| os 108 da R68 não existem mais? | **existem** — 108 hoje pela regra R68; a R72 os separa em 68 + 31 + 9 |
| "valioso" estava mal definido? | **estava incompleto**: era ≥2 compras e > 30 dias, sem piso de valor e com corte único de recência |
| o ciclo mudou desde a R71? | **não** — 83,5 vs 83,7 e 30,9 vs 31,2 |
| frequência e recência não independem? | independem — provado na R68 pelo cruzamento 2D |
| população pequena demais? | **45 contatáveis, R$ 66.514,68**. Pequena, e é a que existe |
| consentimento derruba quase tudo? | **32,4%** dos elegíveis — significativo, não "quase tudo" |
| clientes recompram rápido demais sozinhos? | **~10% na faixa alvo** — registrado como custo, não escondido |
| algum cliente aparece duas vezes? | **não** — uma linha por `cliente_key`; as 2 identidades multi-lead contam uma vez cada |
| V2 ainda mistura prospect com cliente? | **não** — `n_compras ≥ 2` é condição de elegibilidade; os 294 de 1 compra ficam em `SEM_HISTORICO_SUFICIENTE` |
| não existe canal suficiente? | 45 de 68 têm canal; 1 é `ELEGIVEL_SEM_CANAL` |

---

## §21 — Veredito

**`AUDIENCIA_V2_SHADOW_VALIDADA`**, com a ressalva de tamanho: **`POPULACAO_TESTAVEL_PEQUENA`**
— 45 clientes contatáveis.

A audiência é reprodutível, derivada de limiares medidos, não duplica identidade, não inventa
lead, separa elegibilidade econômica de contatabilidade e carrega o contrato de revalidação
dentro do próprio registro.

---

## §19/§22 — Próximo passo

**Não enviar.** O canário `tiago-brevo-luciana-resultado` segue `em_andamento` com janela até
**04/09/2026** e não foi tocado. O que a R72 acrescenta quando ele fechar:

- **população nova**: 45 contatáveis, 4,1 compras médias, R$ 66.514,68 — não herdada
- **regra dinâmica**: p90 por classe de frequência, revalidada no disparo
- **contatabilidade** já resolvida por cliente, não por lead
- **outcome R67** como desfecho, nunca `converteu_em` da audiência

Dados do canário atual **não** se misturam com o experimento futuro: são públicos e canais
diferentes (e-mail Brevo × WhatsApp), e o canário tem n=5 sem controle.

Com 45 contatáveis, um desenho tratamento × controle divide em ~22/23. O Worker Econômico
precisará dizer se isso é suficiente para o que quer detectar — **antes** de pedir decisão humana
para exposição real.

---

## Objetos desta rodada

**Criados:** `vw_audiencia_reativacao_v2_shadow` (view de leitura, **sem consumidor**) ·
`_r72_cliente` (artefato de agregação por cliente econômico).
**Alterados:** nenhum. **Enviados:** nenhum.

Gate de segurança: 0 envios · 0 audiências legadas tocadas · 0 WABA novo · `policy = false` ·
campanhas 21/1/1 inalteradas · canário `em_andamento` · 0 frentes tocadas · view V2 sem consumidor.

Rollback: `DROP VIEW vw_audiencia_reativacao_v2_shadow; DROP TABLE _r72_cliente;`
