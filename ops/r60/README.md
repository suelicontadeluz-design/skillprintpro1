# R60 — recorrencia economica × gating operacional

Rodada READ-ONLY de 2026-08-26. **Nenhuma escrita, nenhum DDL, nenhuma view
trocada, nenhum agente alterado.**

## Veredito

**SEMANTICAS_DEVEM_SER_SEPARADAS**

E o motivo nao e o delta — o delta e quase nulo. E que **as duas perguntas ja
estao acopladas hoje numa flag que nao significa o que o nome diz.**

## §0 — Reancoragem

| | OLD | V2 |
|---|---:|---:|
| clientes | 126 | **127** |
| compras | 1.131 | **1.137** |
| receita | R$348.279,07 | **R$353.534,01** |

Delta +1 cliente / +6 compras / **+R$5.254,94**, igual a R59. Gabriela, Vanessa
e Kleberson conferidos.

## §1 — A cadeia operacional inteira

```
vw_clientes_recorrentes_chat
  └─> fn_lead_eh_recorrente(p_lead_id)
        ├─> fn_julia_pode_atender(p_lead_id)              -- GATE
        └─> fn_agente_automatico_pode_atender(p_lead_id)  -- GATE
```

| consumidor | papel |
|---|---|
| `fn_julia_pode_atender` | **gate**: `pode=false, motivo='cliente_recorrente'` |
| `fn_agente_automatico_pode_atender` | **gate**: idem, sob `p_checar_recorrente` |
| views | **0** |
| triggers | **0** |
| crons | **0** |

Fim da cadeia. Nao e score, nao e contexto, nao e mensagem: **e bloqueio**.

Nos dois casos o gate so dispara quando `julia_config.julia_atende_recorrentes = false`.
**Medido hoje: `false`.** Ou seja, **o gate esta ativo** — Julia e o agente
automatico **nao atendem** quem ja comprou.

## §2 — O achado da rodada: a perna da view e codigo morto

```sql
CREATE FUNCTION fn_lead_eh_recorrente(p_lead_id uuid) ...
  SELECT
    EXISTS (SELECT 1 FROM pixel_events
            WHERE lead_id = p_lead_id AND event_name='Purchase'
              AND event_time >= now() - interval '2 years')   -- perna 1
    OR
    EXISTS (SELECT 1 FROM vw_clientes_recorrentes_chat
            WHERE lead_id = p_lead_id
              AND ultima_compra >= now() - interval '2 years'); -- perna 2
```

A perna 2 so poderia decidir sozinha se existisse um lead **na view** (portanto
com **≥3** Purchase) **sem** Purchase nos ultimos 2 anos. Medido:

| verificacao | resultado |
|---|---:|
| leads na view sem Purchase em 2 anos | **0** |
| Purchase mais antigo que 2 anos na base inteira | **0** |
| Purchase mais antigo existente | 2026-01-26 |
| leads com Purchase em 2 anos | **505** |
| leads onde `fn_lead_eh_recorrente` = TRUE | **505** |

**`fn_lead_eh_recorrente` ≡ `EXISTS(Purchase deste lead)`.** A perna da view
nunca decide nada.

Consequencia direta: **trocar `vw_clientes_recorrentes_chat` pela V2 nao mudaria
absolutamente nada no gating**, porque o gating nao le a view de verdade.

### E o nome nao descreve o que a funcao faz

A funcao se chama `eh_recorrente` mas retorna **TRUE para quem comprou UMA vez**.
Isso nao e recorrencia — e *"ja comprou"*. Enquanto isso a view exige **≥3**
compras. **Dois conceitos diferentes com o mesmo nome, no mesmo arquivo.**

## §3 — OLD × V2 para todos os leads

Troca minima (so a perna 2 vira V2), 16.041 leads:

| classe | leads |
|---|---:|
| IGUAL_TRUE | **505** |
| IGUAL_FALSE | **15.536** |
| OLD_FALSE_V2_TRUE | **0** |
| OLD_TRUE_V2_FALSE | **0** |

**Delta zero**, como a §2 previu.

### Semantica de PESSOA de verdade

A troca minima e conservadora demais para responder a pergunta arquitetural.
Simulei entao a semantica que o modelo novo realmente propoe — *"esta PESSOA ja
comprou?"* — com o mesmo fallback da R58 (sem identidade materializada, a pessoa
**e** o lead):

| classe | leads | quais |
|---|---:|---|
| IGUAL_TRUE | 505 | — |
| IGUAL_FALSE | 15.535 | — |
| **OLD_FALSE_PESSOA_TRUE** | **1** | **`559c601d`** |
| OLD_TRUE_PESSOA_FALSE | **0** | — |

**Correcao de um erro meu no meio da rodada:** a primeira versao dessa medicao
classificou **500 leads** como `OLD_TRUE_PESSOA_FALSE`. Era artefato meu: sao
compradores **sem identidade materializada**, e eu tinha esquecido o fallback,
entao "a pessoa nao comprou" significava so "a pessoa nao existe ainda".
Refeito com o fallback: **500 → 0**.

## §4 — O unico delta, com causa individual

| campo | valor |
|---|---|
| lead | `559c601d` — **Igreja Batista Biblíca de Cristo** |
| telefone | `511972394278` (malformado, sem o 5 inicial) |
| criado | 2026-02-24 |
| **Purchase do lead** | **0** |
| pessoa | 2 leads, **2 Purchase**, R$933,48, 0 deals da R57 |
| origem do delta | vinculo **R49** (mesmo `contact_rdstation_id` do lead canonico) |

Vanessa e Kleberson **nao** aparecem no delta: os fragmentos dos dois **ja tem
Purchase proprio** (2 e 1), entao a perna 1 ja os marca TRUE hoje. Gabriela nao
aparece porque **nao tem lead** (§11).

## §5/§6/§7 — Gating simulado

| gate | OLD (hoje, executado) | semantica de pessoa |
|---|---|---|
| `fn_julia_pode_atender('559c601d')` | **`pode=true, motivo=ok`** | `pode=false, motivo=cliente_recorrente` |
| `fn_agente_automatico_pode_atender('559c601d')` | **`pode=true, motivo=ok`** | `pode=false, motivo=cliente_recorrente` |

**PODE → NAO_PODE**, em 1 lead, nos dois gates. Nenhum outro lead muda.

## §8 — Essa mudanca e desejavel? Nao consigo afirmar que sim

O gate `cliente_recorrente` e **protecao**: impede o bot de abordar
comercialmente quem ja e cliente. Sob essa leitura, bloquear o fragmento da
Igreja parece certo — a pessoa **e** cliente.

Mas repare no que o gate faz de fato: ele decide **autorizacao**, nao
**conhecimento**. E as duas coisas nao precisam andar juntas:

> Se a Vanessa escreve por um lead secundario, o agente **deveria saber** que ela
> ja comprou 26 vezes. Isso e **contexto** e e util.
> Dai nao decorre que ele deva ser **proibido** de responder.

Hoje um unico booleano cumpre os dois papeis. **Separar conhecimento de
autorizacao e o ganho real desta rodada**, e ele independe do delta ser 1 ou 0.

## §9 — ACOPLAMENTO_SEMANTICO registrado

Uma flag, quatro significados distintos:

| significado pretendido | quem usa | e a mesma coisa? |
|---|---|---|
| "ja comprou alguma vez" | `fn_lead_eh_recorrente`, perna 1 | e o que a funcao **faz** |
| "comprou ≥3 vezes" | `vw_clientes_recorrentes_chat` | e o que o **nome** sugere |
| "nao pode ser abordado pelo bot" | os 2 gates | e o que ela **decide** |
| "este cliente e da casa" | leitura humana do nome | e o que as pessoas **entendem** |

**ACOPLAMENTO_SEMANTICO confirmado.** Isso ja existe hoje, **antes** de qualquer
mudanca minha, e e a razao pela qual promover a V2 dentro desse consumidor
seria arrumar o numero no lugar errado.

## §10 — Arquitetura separada (simulada, nao implementada)

| funcao | pergunta | fonte | usada por |
|---|---|---|---|
| `fn_cliente_eh_recorrente(pessoa_id)` | *"esta pessoa compra de novo?"* | identidade + fato canonico | leitura economica, LTV, MAPA |
| `fn_lead_tem_historico_compra(lead_id)` | *"este lead ja comprou?"* | `pixel_events` por lead | gating — **e o que os gates ja fazem hoje** |
| gate do agente | recebe explicitamente o conceito que precisa | — | Julia, agente automatico |

Essa separacao **elimina a ambiguidade sem mudar comportamento**: o gate
continuaria com exatamente a semantica de hoje (delta 0), e a economia passaria
a ter nome proprio. O unico caso que exigiria decisao humana e o fragmento da
Igreja — e ele pode ser resolvido explicitamente, nao por efeito colateral.

## §11 — Gabriela: o teste semantico decisivo — **PASSOU**

| prova | resultado |
|---|---|
| leads da Gabriela | **0** |
| recorrente economica | **TRUE** (3 deals, R$2.939,50) |
| participa de gating de lead | **nao pode, e nao precisa** |
| o desenho exige criar lead para ela? | **NAO** |

Os gates recebem `p_lead_id`. Gabriela nao tem lead, entao **nunca sera
argumento de gating**. Ela existe inteira na leitura economica e ausente na
operacional — que e exatamente o comportamento correto.

## §12 — Vanessa

Recorrencia economica = **pessoa inteira**: 26 compras, R$12.694,90, uma
cliente. Provado na R58/R59.

Operacionalmente: os **dois** leads ja tem Purchase proprio, entao **ja recebem
hoje a mesma decisao** (`recorrente=TRUE`, bloqueado). Nao foi preciso assumir —
foi medido: nenhum dos dois aparece no delta.

## §13 — Kleberson

Mesmo caso. Fragmento com 1 Purchase proprio → ja TRUE hoje. Economia agregada
(23 compras, R$13.277,72) e historico do lead especifico continuam podendo ser
lidos separadamente, sem conflito.

## §14 — Impacto real hoje

| medida | valor |
|---|---:|
| leads cujo status de recorrencia mudaria | **1** |
| gating da Julia mudaria | **1** (PODE → NAO_PODE) |
| gating do agente automatico mudaria | **1** (PODE → NAO_PODE) |
| **conversas abertas afetadas** | **0** |
| **acoes recentes que teriam decidido diferente** | **0** |

O lead `559c601d` tem: **0 conversas** (nunca teve), 0 decisoes de agente, 0
mensagens Z-API, 0 disparos WABA, 0 tarefas CRM. E `bc_subscriber_lookup`
registra **`nao_encontrado / http 404`** — o telefone malformado **nao existe no
WhatsApp**.

## §15 — Contrafactual

**Nao ha o que replayar.** O unico lead afetado nunca teve conversa nem acao. O
contrafactual honesto e: com OLD, nada aconteceu; com a semantica de pessoa,
nada teria acontecido — porque nao ha canal para acontecer.

Registro isso como **ausencia de evidencia**, nao como evidencia de
equivalencia. Um delta de 1 lead inativo nao prova que a semantica de pessoa e
segura em regime.

## §16/§17 — Decisao arquitetural

**Escolhida: B — SEPARAR_ECONOMIA_DE_GATING.**

Tentei refutar em favor de A (promover a V2 no consumidor existente) e nao
consegui sustentar:

- promover a V2 ali **nao muda nada**, porque a perna da view e codigo morto
  (§2). Seria trocar uma peca que nao esta ligada;
- e deixaria intacto o problema real, que e **um booleano decidindo quatro
  coisas** (§9).

**C** (manter OLD no gating e V2 na economia) e o estado de fato desta rodada e
um bom passo intermediario — mas nao resolve o acoplamento, so o congela.

**Nada foi promovido.** Mesmo com delta operacional praticamente nulo:
delta zero hoje nao prova equivalencia semantica futura, e o proprio §15 mostra
que o unico caso testavel e inerte.

### Risco de promocao, declarado

| risco | avaliacao |
|---|---|
| trocar a view no gating | **inutil** — a perna e morta |
| adotar semantica de pessoa no gating | **1 lead** muda, PODE → NAO_PODE, inativo |
| manter como esta | o acoplamento continua, e o nome continua enganando quem ler |

## §18 — Os 216 sem deal

Preservado o alerta da R59, sem reabrir: **216 eventos, R$83.522,60, confianca
canonica menor, 2 sinais residuais de possivel duplicacao** (`csv_backfill`).
Fora do escopo do gating — nenhum deles participa de decisao de agente.

## §19 — Auto-refutacao

| tentativa | resultado |
|---|---|
| economia e gating sao a mesma coisa? | **nao**: uma pergunta *"compra de novo?"*, a outra *"posso abordar?"* |
| V2 melhoraria uma decisao operacional? | **nao demonstravel**: o unico lead afetado nunca teve conversa |
| V2 pioraria alguma? | tambem nao demonstravel, pelo mesmo motivo |
| OLD olha lead de proposito? | **provavelmente sim** — o gate protege **aquela conversa**, e conversa acontece num lead. Isso e coerente |
| fragmentos deveriam herdar status da pessoa? | **para contexto sim, para autorizacao nao esta provado** |
| cria bloqueio indevido? | 1 lead, inativo, telefone inexistente no WhatsApp — risco pratico nulo |
| libera atendimento indevido? | **0 casos** de NAO_PODE → PODE |
| separar funcoes aumenta complexidade sem beneficio? | **nao**: hoje um booleano tem 4 significados; separar troca ambiguidade por duas perguntas claras |

Nenhuma refutacao derrubou o veredito. Uma derrubou uma medicao minha (§3).

## §20 — Entrega

| item | resultado |
|---|---|
| leads com delta | **1** (`559c601d`) |
| gates com delta | **2** (Julia e agente automatico), no mesmo lead |
| conversas afetadas | **0** |
| semantica correta | economia por **pessoa**; gating por **lead** |
| arquitetura recomendada | **separar**: `fn_cliente_eh_recorrente(pessoa)` + `fn_lead_tem_historico_compra(lead)` |
| risco de promocao | promover a V2 no consumidor atual seria **inocuo e enganoso** |

## §21 — Proximo passo

**R61 — criar a leitura economica oficial, sem tocar no gating.**

Concretamente, e nesta ordem:

1. Nomear a economia: `fn_cliente_eh_recorrente(pessoa_id)` sobre
   `vw_cliente_economico_canario`. **Nao** substitui nada.
2. **Nao mexer** em `fn_lead_eh_recorrente` nem nos dois gates nesta rodada.
3. Registrar como divida tecnica, para decisao humana separada:
   - a perna morta em `fn_lead_eh_recorrente`;
   - o nome `eh_recorrente` para algo que significa *"ja comprou"*;
   - o caso `559c601d`, unico lead onde pessoa e lead divergem.

Registrados, sem mudanca: os 3 PROVAVEL (R$1.859,23); os 12 SEM_EVIDENCIA
(R$7.392,95); os 216 eventos sem deal e seus 2 sinais residuais; as 2 views
indeterminadas da R56; a divida do indice unico em `erp_pessoa_id`; o `lead_t0`
de 2025-08-22 da Vanessa/Alean; os pares suspeitos da Igreja e do Kleberson;
`fn_fechar_tasks_apos_compra`; os 329 orfaos do mapa; `crm_deals_cache`
congelado desde 16/08.
