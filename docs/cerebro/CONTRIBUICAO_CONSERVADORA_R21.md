# R21 — `contribuicao_conservadora`: por que ela não destrava a escala

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY, nada publicado

## VEREDITO: `SHADOW_CONTINUA_BLOQUEADO`

Por dois motivos independentes, os dois descobertos ao fazer o trabalho — e nenhum deles
se resolve criando a função que eu ia criar.

---

## 1. O BLOQUEIO NUNCA FOI UM DADO FALTANDO

`midia_shadow.fn_observador_impl` (md5 `73f6f4d92e6c15d4e6a8f6ee65524064`):

```sql
-- Dependencias GLOBAIS desta frente. Nao viram true por count(*).
c_pausa_ok    constant boolean := false;
c_pausa_blq   constant text    := 'promocao_formal_ausente_frente_kpis_decisivos_midia';
c_escala_ok   constant boolean := false;
c_escala_blq  constant text    := 'contribuicao_conservadora_ausente';
```

`escala_disponivel` é uma **constante literal `false`**. O observador **não consulta nada**
para decidi-la: não há lookup, não há função, não há tabela. A string
`contribuicao_conservadora_ausente` é um **rótulo que explica por que é false**, não uma
dependência que o código resolve.

E quem escreveu deixou o aviso na linha de cima: *"Não viram true por count(*)"* — ou seja,
não flipe isso só porque algum número passou a existir.

**Consequência:** se eu tivesse criado `fn_contribuicao_conservadora()` e publicado, o
shadow continuaria com 0 escalas e eu teria entregue um objeto que ninguém consulta,
podendo alegar falsamente ter destravado algo. Destravar exige editar a regra de decisão
do shadow — que é exatamente a "promoção formal da frente" que o outro bloqueio nomeia.
Isso é decisão sua, não patch meu.

## 2. A SEMÂNTICA ESPERADA — descoberta, não assumida

Você mandou não assumir ROAS. Fez bem. A casa já tem uma convenção madura em
`vw_midia_coorte_aquisicao_shadow` (md5 `711482f5e1f0d66ec8dff44c3df04924`):

| Elemento | Convenção existente |
|---|---|
| Janela de gasto | 90 dias, `negocio='skillprint'`, `spend > 0` |
| **Maturação** | dia/lead só conta se `<= CURRENT_DATE - 30` |
| **Atribuição** | `Purchase` entre `acquired_at` e `acquired_at + 30 days` — **janela declarada** |
| **Conservadorismo** | `ref_poisson_ic95` (61 linhas, k=0..60), IC95 exato de Poisson sobre a **contagem de compradores** |
| CAC otimista | `gasto / limite_superior(k)` |
| CAC pessimista | `gasto / limite_inferior(k)` |
| Favorável | só quando **até o pessimista** passa no `limiar_cac_aprovado` |
| Cobertura | `cobertura_maturacao_pct` |

Então "contribuição conservadora" não é `receita/spend`. É o espelho, do lado da receita,
do CAC com IC95 que já existe: **receita reconhecida usando o limite inferior de Poisson da
contagem de compradores, menos o gasto maduro.**

## 3. FONTES ECONÔMICAS — declaradas

- **Spend:** `meta_ads_insights`, nível anúncio, `negocio='skillprint'`, 90d, só dias maduros.
- **Receita:** `pixel_events` `event_name='Purchase'`, `value > 0`, ligada por
  `leads_marketing.utm_campaign_id`, dentro da janela de atribuição.
- **Cobertura:** `cobertura_maturacao_pct` da própria view.
- **Purchase é negócio ganho no RD CRM, não caixa** (U1 do MAPA). Não é lucro, não é margem.
- Compras sem campanha e `campaign_id` não resolvido ficam fora por construção do join.

## 4. REGRA PROPOSTA (menor definição falsificável)

```
ticket_observado       = receita_madura / k
receita_conservadora   = ticket_observado × limite_inferior_poisson(k)
contribuicao_conserv.  = receita_conservadora − gasto_maduro

FAVORAVEL_ESCALA  ⟺  dias_maduros > 0
                  ∧  cobertura_maturacao_pct >= 50
                  ∧  gasto_maduro >= 300
                  ∧  k > 0
                  ∧  contribuicao_conservadora > 0
```

## 5. SIMULAÇÃO — coorte madura, convenção da casa

| campanha | gasto mad. | receita mad. | k | contrib. bruta | **contrib. conserv.** | status |
|---|---|---|---|---|---|---|
| CP136 dtfuv | 3.512,15 | 1.644,94 | 13 | −1.867,21 | **−2.636,28** | negativa |
| CP134 dtftêxtil | 2.397,62 | 2.011,89 | 8 | −385,73 | **−1.529,04** | negativa |
| CP130 mofu wpp | 1.632,78 | 808,88 | 6 | −823,90 | **−1.335,93** | negativa |
| CP143 Copa 2026 | 1.033,00 | 69,90 | 1 | −963,10 | **−1.031,23** | negativa |
| CP01 camisetas | 1.028,41 | 888,73 | 3 | −139,68 | **−845,12** | negativa |
| CP145 eventos | 998,12 | 0,00 | 0 | −998,12 | −998,12 | sem compradores |
| CP151 CTWA UV | 739,99 | 426,54 | 4 | −313,45 | −623,77 | cobertura 31,8% |
| CP137 camisetas | 706,00 | 0,00 | 0 | −706,00 | −706,00 | sem compradores |
| CP152 copos | 304,38 | 209,66 | 3 | −94,72 | −261,14 | negativa |
| CP155 CTWA têxtil | 222,19 | 370,88 | 3 | **+148,69** | **−145,70** | cobertura 19,7% |

**Campanhas que passariam a ter evidência para escala: ZERO.**
A única com contribuição bruta positiva (CP155) tem 19,7% de cobertura de maturação e
vira negativa no conservador.

## 6. SENSIBILIDADE 7/14/30/60/90 DIAS — e é aqui que a regra morre

| campanha | gasto 90d | r7 | r14 | r30 | r60 | r90 | contrib 30d | contrib 90d |
|---|---|---|---|---|---|---|---|---|
| CP136 dtfuv | 3.512,15 | 1.190,86 | 1.419,19 | 2.990,99 | 4.222,66 | 4.222,66 | **−521,16** | **+710,51** |
| CP134 dtftêxtil | 2.397,62 | 2.012,59 | 2.019,49 | 3.445,70 | 5.785,81 | 5.785,81 | +1.048,08 | +3.388,19 |
| CP151 CTWA UV | 2.351,04 | 1.918,57 | 2.014,15 | 2.014,15 | 2.014,15 | 2.014,15 | −336,89 | −336,89 |
| CP130 mofu wpp | 1.632,78 | 768,88 | 1.068,48 | 1.766,60 | 3.148,87 | 4.069,72 | +133,82 | +2.436,94 |
| **CP145 eventos** | 998,12 | **0,00** | **0,00** | **0,00** | **1.386,86** | 1.386,86 | **−998,12** | **+388,74** |
| CP143 Copa | 1.033,00 | 69,90 | 69,90 | 69,90 | 69,90 | 69,90 | −963,10 | −963,10 |

**A janela decide o sinal.** CP145 tem **receita zero até o dia 30** e R$ 1.386,86 no dia 60:
sob a convenção de 30 dias ela é o pior desastre da lista (−998); sob 60/90 dias é positiva.
CP136 vai de −521 para +711.

Sua própria regra do item 4 diz: *"Campanha só pode ser candidata forte a escala se o sinal
sobreviver razoavelmente à sensibilidade temporal."* **Não sobrevive.**

Ressalva metodológica que eu mesmo introduzo: nesta tabela o gasto é o de 90 dias inteiros
enquanto leads recentes não tiveram 90 dias para converter — isso **subestima** r90 e é
inconsistente. A view resolve isso restringindo à coorte madura, e é por isso que ela
existe. Os dois recortes concordam no essencial: nada é candidato claro a escala.

## 7. CORREÇÃO À R20

Na auditoria anterior eu reportei ROAS interno de **2,52 / 2,50 / 2,31** para CP01, CP134 e
CP136 e disse que havia R$ 9.441 rendendo 2,3–2,5x.

**Aquilo estava inflado.** Eu usei *toda* a receita já ligada ao lead, **sem janela de
atribuição e sem maturação**. Sob a convenção declarada da casa, CP01 e CP136 são
**negativas** na coorte madura. O número honesto de "campanha lucrativa em contribuição
observada" hoje é **zero**, não três.

A conclusão de território da R20 (Meta é o melhor laboratório) continua de pé — o dado é
real, é diário e é material. O que caiu foi a leitura fácil de que havia dinheiro
obviamente mal alocado esperando para ser realocado.

## 8. AUTO-REFUTAÇÃO

| Pergunta | Resposta |
|---|---|
| A atribuição interna cobre receita suficiente? | Parcialmente. CP151 tem 31,8% de cobertura de maturação, CP155 19,7%. Abaixo de 50% eu não classifico |
| Recompra atribuída à campanha errada? | **Risco real.** O join é por `utm_campaign_id` do lead, então toda compra futura do lead vira crédito da campanha de aquisição, inclusive recompra meses depois. A janela de 30d limita, a de 90d não |
| Campanha pequena parece excelente por ruído? | Era o risco central. O limite inferior de Poisson resolve: com k=1, `limite_inferior=0,0253` — a receita reconhecida despenca a ~2,5% da observada |
| Campanha grande parece ruim por atraso de conversão? | **Sim, e foi medido.** CP145 é o caso exato: zero até 30d, positiva aos 60d |
| Janela de atribuição adequada? | **É a pergunta em aberto.** 30d é a convenção da casa e não está justificada por dado nesta base |
| Meta já realocou verba e criou viés? | Sim. O algoritmo realoca dentro da campanha; "campanha boa" pode ser só a que ele alimentou |
| Receita é deal ganho, não caixa? | **Sim.** U1 do MAPA |
| ROAS alto pode ter margem péssima? | Sim, e não dá para saber: só 8 de 104 produtos têm custo e preço (R20) |
| Escalar algo lucrativo em receita pode piorar margem? | Pode. Por isso **não chamo isto de lucro**: é contribuição observada de mídia, receita menos gasto de mídia, nada mais |

## 9. PATCH E DEPLOY

**Nenhum.** Não publiquei nada.

Não criei `fn_contribuicao_conservadora` porque (a) o shadow não a consultaria — a
constante continuaria `false` — e (b) a regra não sobrevive à sensibilidade temporal, então
publicá-la seria congelar uma definição que eu mesmo acabo de mostrar instável.

## 10. SHADOW ANTES × DEPOIS

Idênticos, porque nada foi tocado:

| | antes | depois |
|---|---|---|
| avaliações | 306 | **306** |
| `escala_disponivel = true` | 0 | **0** |
| `fn_observador_impl` md5 | `73f6f4d9…` | `73f6f4d9…` |
| view md5 | `711482f5…` | `711482f5…` |
| `gustavo_meta_acoes` | 0 | **0** |

## 11. O TESTE MAIS IMPORTANTE (seu item 10)

Você perguntou se, preenchida a contribuição, apareceria outro bloqueio.

A resposta é mais dura: **não existe "preencher".** O bloqueio não é um campo vazio — é uma
constante `false` protegida por um comentário explícito. Preencher a contribuição não move
o shadow um milímetro. Parei aqui, como você pediu, sem sair corrigindo em cadeia.

## 12. PRÓXIMO PASSO MÍNIMO

Uma coisa só, e é uma decisão de método, não código:

**fixar a janela de atribuição do Cérebro para mídia.** 30 dias (convenção atual da view),
60 ou 90 — com justificativa. Enquanto ela não for fixada e justificada, qualquer regra de
escala vai herdar a instabilidade medida no item 6, e "escalar" vira função da janela
escolhida, não do negócio.

Só depois disso vale rediscutir se a frente de KPIs de mídia deve ser formalmente promovida
— que é o que realmente destrava as constantes.

## Estado preservado

EXP-001 WhatsApp intocado: snapshot **456**, campanha `rascunho`, fila **0**.
Nenhuma escrita no banco (`pg_current_xact_id_if_assigned()` nulo em todas as leituras).
Zero envio, zero Meta write, zero mudança de orçamento.
