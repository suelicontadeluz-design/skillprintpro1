# R73 — Desenho do primeiro experimento econômico de reativação

**Data:** 2026-08-26 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** READ-ONLY / SHADOW.
Nenhuma mensagem enviada, nenhum sorteio gravado, `policy = false`, canário intocado.

**Regra central:**
> Não perguntar "45 pessoas dão para testar?" — perguntar qual tamanho de efeito esse
> experimento consegue detectar, e se esse efeito é pequeno o bastante para a decisão que
> queremos tomar.

---

## §0 — Reancoragem R72

68 elegíveis · **45 contatáveis** (29 FREQ_2_3 + 16 FREQ_4_PLUS) · 22 sem consentimento ·
1 sem canal · LTV R$ 66.514,68 · 4,1 compras médias · **mediana de 118 dias parados**.

---

## §3 — O baseline não é um número. São dois, e são incomparáveis.

Reconstruí historicamente quem **cruzou** o p90 da própria classe e comprou depois, em janelas
fechadas:

| classe | cruzamentos | D7 | D14 | **D30** |
|---|---|---|---|---|
| **FREQ_2_3** | 49 | 2,0% | 2,0% | **10,2%** |
| **FREQ_4_PLUS** | 106 | 24,5% | 36,8% | **59,4%** |
| agregado | 155 | 17,4% | 25,8% | 43,9% |

**Isto muda o desenho inteiro.** Clientes de 4+ compras voltam sozinhos em 59,4% dos casos
dentro de 30 dias do cruzamento — o p90 deles é curto (30,9 d), então "cruzar" quase não
significa nada. Mandar reativação para eles é, em boa parte, falar com quem já ia voltar.

**A população onde reativação pode importar é FREQ_2_3, com baseline de 10,2%.**

O agregado de 43,9% é um número que **não deve ser usado**: mistura duas populações com
comportamento oposto.

---

## §11 — Contaminação: dos 45, sobram 36

Excluindo quem tem task humana aberta, conversa nos últimos 7 dias ou objeção aberta:

| classe | contatáveis | **limpos** | excluídos |
|---|---|---|---|
| FREQ_2_3 | 29 | **28** | 1 |
| FREQ_4_PLUS | 16 | **8** | **8 (metade)** |
| total | 45 | **36** | 9 |

Metade dos FREQ_4_PLUS está contaminada — coerente: são clientes ativos, em conversa.
Também medido: **0 clientes com mais de um lead** (sem risco de dupla exposição), 0 com disparo
WABA ativo, **9 presentes na fila de campanha legada** (se ela um dia disparar, contamina).

**A população causal utilizável é: 28 clientes FREQ_2_3.**

---

## §4/§5 — Poder: o teste não consegue detectar nada plausível

Fisher exato unilateral, α = 0,05, por enumeração completa (`ops/r73/power.py`).

### FREQ_2_3 — 28 limpos, 14 × 14, baseline 10,2%

| cenário | uplift | **poder** |
|---|---|---|
| 10,2% → 15,2% | +5 pp | **3,5%** |
| 10,2% → 20,2% | +10 pp | **8,1%** |
| 10,2% → 25,2% | +15 pp | 14,8% |
| 10,2% → 30,2% | +20 pp | 23,7% |
| 10,2% → 40,2% | +30 pp | 45,9% |
| 10,2% → 50,2% | +40 pp | 69,1% |

**MDE (80% de poder) = 55,8%, ou seja +45,6 pp.** A mensagem teria que **quintuplicar** a taxa
de recompra para o teste enxergar. Nenhuma intervenção de reativação faz isso.

### Todos os 45 juntos — 22 × 23, baseline agregado 43,9%

**MDE = 82,2% (+38,3 pp).** Pior ainda — e sobre um baseline que não deveria existir.

**Resposta à §5: o split 22/23 é `SUBDIMENSIONADO`.** Não responde nenhuma pergunta
economicamente útil.

---

## §6/§7 — Quanto seria preciso, e quanto tempo levaria

N por grupo para 80% de poder, baseline 10,2%:

| efeito | n/grupo | total | tempo ao fluxo atual |
|---|---|---|---|
| +5 pp | 600 | 1.200 | inviável |
| **+10 pp** | **175** | **350** | **~27 meses** |
| +15 pp | 90 | 180 | ~13 meses |
| **+20 pp** | **60** | **120** | **~8 meses** |
| +30 pp | 35 | 70 | ~3,5 meses |

Fluxo medido de entrada na faixa (cruzamentos do p90 por mês):

| mês | FREQ_2_3 | FREQ_4_PLUS |
|---|---|---|
| 2026-03 | 0 | 13 |
| 04 | 2 | 23 |
| 05 | 11 | 19 |
| 06 | 13 | 27 |
| **07** | **27** | 25 |

FREQ_2_3 cresce (0 → 27/mês). Usando ~20/mês e a taxa de contatabilidade observada (29 de 47 ≈
62%), entram **~12 contatáveis novos por mês**. Daí as estimativas acima.

> Ressalva: os meses iniciais estão truncados — quem comprou em fevereiro só cruza 83,5 dias
> depois. A tendência é real, a inclinação é parcialmente artefato.

---

## §1/§2 — Outcome e janela

**Outcome primário: compra canônica** (`vw_fato_comercial_identidade_canario`) em **D30** após a
exposição, por **cliente econômico**. Nunca resposta, clique ou `resolvido` — a R67 já mostrou
que `converteu_depois` ≡ `resolvido` e a R71 que `converteu_em` da audiência está zerado.

**D30, e a escolha vem do dado:** em FREQ_2_3, D7 e D14 capturam **2,0%** cada — praticamente
nada acontece antes de 30 dias nessa classe. D7/D14 seriam janelas cegas. E D30 é o horizonte em
que 90% dos intervalos dessa classe ainda não fecharam (p90 = 83,5 d), então não confunde com
retorno natural tardio.

Secundárias (§13): resposta, conversa retomada, proposta, opt-out, bloqueio, tempo até compra,
receita observada.

---

## §8/§10 — Desenho recomendado, se e quando houver N

**Sequencial**, não fixo: novos elegíveis entram continuamente, randomização 50/50 **por cliente
econômico** (não por lead — e a R72 já garantiu 1 cliente = 1 linha).

Estratificação: **só por classe de frequência** (FREQ_2_3 × FREQ_4_PLUS), porque os baselines
diferem 6× . Não estratificar por recência nem LTV — com N desse tamanho criaria células
minúsculas.

Regra de parada **pré-definida**, não "olhar todo dia": checkpoints em N fixos com correção de
múltiplas comparações (O'Brien-Fleming ou equivalente). Sem isso, "parar quando der positivo"
transforma α = 0,05 em algo muito maior.

---

## §9 — Canário de segurança ≠ teste de efeito

São coisas diferentes e devem ser tratadas assim:

| | canário operacional | experimento econômico |
|---|---|---|
| objetivo | provar entrega, opt-out, compliance, zero incidente | estimar efeito incremental |
| N | 5–8 pessoas | 120+ |
| conclui uplift? | **NUNCA** | sim, se tiver poder |

Faz sentido rodar o canário **antes**, e ele **não** consome a audiência para um teste causal —
justamente porque não é um.

---

## §14/§15/§16 — Regras a fixar antes de qualquer exposição

**Stop-loss:** opt-out acima do limite da política · qualquer reclamação · erro de provider ·
mensagem enviada a cliente que recomprou entre randomização e envio · qualquer incidente de
compliance. Violação crítica → interromper.

**Revalidação no envio** (R71/R72): ainda esfriando? não recomprou? consentimento? não optout?
canal válido? policy liberada? Se não → sai do tratamento.

**ITT:** quem foi randomizado permanece no grupo analítico original. Quem sair pela revalidação
conta como **não tratado dentro do grupo tratamento** — a regra fica escrita **antes**, para não
escolher amostra depois de ver resultado.

---

## §18 — Margem

Podemos estimar: uplift em conversão · receita incremental observada.
**Não podemos afirmar:** lucro incremental · ROI · payback.

`calcme_itens_pedido` continua vazia. Se um dia o teste mostrar uplift, **margem por pedido vira
o gap bloqueante** para decidir escala.

---

## §19 — Decisão: **B**, com **D** em seguida

**`CANARIO_SEGURANCA_AGORA_TESTE_CAUSAL_DEPOIS`**, encadeado com
**`EXPERIMENTO_SEQUENCIAL_RECOMENDADO`**.

Não escolhi **A** porque o poder é de 8,1% para +10 pp. Não escolhi **E** porque a população não
é pequena demais para *sempre* — é pequena **hoje**, e cresce ~12/mês. Não escolhi **C** sozinho
porque acumular sem antes provar entrega desperdiça meses.

**Rodar o teste causal agora seria pior do que não rodar:** gastaria 28 pessoas raras e devolveria
ou um nulo sem informação ou um falso positivo. O poder de 8,1% significa que, se o efeito real
fosse +10 pp, o teste **não o veria em 92% das vezes**.

---

## §17/§20 — Próximo passo

1. **Não fazer nada antes de 04/09/2026** — a janela do canário `tiago-brevo-luciana-resultado`
   segue aberta e não foi tocada.
2. Depois dela: **canário de segurança com 5–8 pessoas**, para provar entrega, opt-out e ausência
   de incidente. Explicitamente **sem** conclusão de uplift.
3. Em paralelo, **acumular** FREQ_2_3 até ~60 por grupo (~8 meses ao fluxo atual) com
   randomização sequencial já em vigor desde o primeiro elegível.
4. FREQ_4_PLUS **fica fora do teste causal**: baseline de 59,4% deixa headroom pequeno demais.
5. Se houver uplift, **margem por pedido** passa a ser o próximo gap bloqueante.

---

## Objetos desta rodada

**Criados:** nenhum objeto de banco. `ops/r73/power.py` (cálculo de poder por enumeração exata,
reproduzível).
**Registrados:** 1 candidato em `candidato_acao_economica`, `status = NAO_EXECUTADO`.
**Alterados:** nenhum. **Enviados:** nenhum. **Sorteios gravados:** nenhum.

Gate: 0 envios · 0 WABA novo · `policy = false` · campanhas 21/1/1 · audiência V2 inalterada (45)
· canário `em_andamento` · 0 frentes tocadas · nenhuma tabela de tratamento/controle criada.
