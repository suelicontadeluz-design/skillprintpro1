# R76 — Auditoria do erro tipo I global do pré-registro V2

**Modo:** READ-ONLY / AUDITORIA. Nenhuma mensagem enviada, nenhuma randomização,
nenhuma alteração de população, de outcome ou de política.

**Pergunta única da rodada:** a regra de *efficacy* da V2 controla o erro tipo I
**global** (family-wise) sob o desenho sequencial real — ou o `0,0294` era só um
número herdado?

---

## §0 — Re-âncora LIVE (antes de qualquer conta)

| fato | valor LIVE em 2026-08-26 22:58 UTC |
|---|---|
| `crm_campaign_autonomy_policy.ativo` | `false` |
| campanhas por status | `rascunho=21`, `em_execucao=1`, `pausada=1` |
| audiência legada por `status_disparo` | `pendente=2124`, `cancelado=97`, `enviado=4`, `erro=1` |
| último `enviado_em` | `2026-08-21 13:06:05+00` (canário Brevo — **anterior** à R74) |
| conversões atribuídas a campanha | `0` |
| pré-registros | `EXP-REATIV-V1` e `EXP-REATIV-V2`, ambos `NAO_INICIADO` |
| V3 | **não existe** |
| população V2 contatável | 45 (`FREQ_2_3=29`, `FREQ_4_PLUS=16`) |
| auditorias registradas antes desta rodada | `0` |

Os hashes dos dois pré-registros conferem entre disco e banco:

```
9a9ece2577b49591f330d73d82cbce98c1d48bba85b42e6230b33c8e6be59b56  ops/r74/PRE-REGISTRO-EXP-REATIVACAO-V1.md
e8d4354083170d0b9aec521cf7c36e61de631408edab4ec70cec679da84d723b  ops/r74/PRE-REGISTRO-EXP-REATIVACAO-V2.md
```

Nada foi tocado. A auditoria é sobre papel, não sobre produção.

---

## §1 — O que precisa ser auditado

A V2 não faz **um** teste. Ela faz **três**, nos checkpoints `n = 20`, `40` e `70`
por braço, e para na primeira rejeição. O erro tipo I relevante não é o de um
checkpoint isolado — é a probabilidade de **rejeitar em algum dos três** quando
não há efeito nenhum:

```
alpha_global(p0) = P( rejeitar em n=20 OU em n=40 OU em n=70 | H0 : p_trat = p_ctrl = p0 )
```

Declarar `alpha_checkpoint = 0,0294` e `alpha_global = 0,05` na V2 foi uma
**afirmação**, não uma prova. Esta rodada produz a prova.

---

## §2 — O boundary 0,0294 **não** foi copiado: foi revalidado

A V1 usava checkpoints `20/40/60`. A V2 mudou para `20/40/70` e declarou
`N_MAX = 70 por braço`. Um boundary derivado para uma sequência de looks **não
transfere automaticamente** para outra sequência: mudar o último look muda a
correlação entre as estatísticas e, portanto, o alpha acumulado.

Então o `0,0294` foi tratado como candidato, não como fato herdado, e testado
contra a grade inteira nos looks reais da V2:

| boundary por checkpoint | α global (pior caso, non-binding) | veredito |
|---|---|---|
| 0,0500 | 0,06628 | **FALHA** |
| 0,0400 | 0,05407 | **FALHA** |
| 0,0350 | 0,04807 | OK |
| **0,0294** | **0,04069** | **OK** |
| 0,0250 | 0,03366 | OK |
| 0,0200 | 0,02453 | OK |

Duas leituras importam aqui:

1. O boundary ingênuo (0,05 por checkpoint, "olhar o p-valor a cada parcial")
   **estoura** o orçamento: 0,066. É exatamente o erro que a V2 existe para evitar.
2. O `0,0294` sobrevive à mudança de `60` para `70` **com folga** — o teto
   admissível fica por volta de `0,035`. A V2 não está no fio da navalha.

---

## §3 — Método: enumeração exata, não simulação

Sob H0 os dois braços são binomiais independentes com a mesma taxa `p0`. Para
cada `p0` da grade, o script percorre por programação dinâmica os estados
`(a, c)` — sucessos acumulados em tratamento e em controle — de look em look:

- em cada look calcula o **Fisher exato unilateral** por soma hipergeométrica
  (`P(X ≥ a)`), sem aproximação normal;
- se `p ≤ boundary`, o caminho rejeita e sai (o desenho para na primeira rejeição —
  massa contada uma única vez);
- se não, a massa segue para o próximo look, dividida pelos incrementos binomiais.

Sem Monte Carlo, sem `scipy`, sem `statsmodels` (nenhum dos dois existe neste
ambiente). O resultado é determinístico: rodar de novo dá exatamente o mesmo
número, e não há erro de simulação para esconder nada.

---

## §4 — Pior caso, não o baseline conveniente

O erro tipo I de um teste exato com `n` pequeno **depende de `p0`**, porque o
espaço amostral é discreto. Reportar só o baseline operacional (10,2%) seria
escolher o número que favorece o desenho. A grade completa:

### NON-BINDING (futility **não** aplicada)

| p0 | look n=20 | look n=40 | look n=70 | **α global** |
|---|---|---|---|---|
| 0,02 | 0,00003 | 0,00051 | 0,00295 | 0,00349 |
| 0,05 | 0,00094 | 0,00667 | 0,00898 | 0,01659 |
| **0,10** | 0,00591 | 0,01242 | 0,00976 | **0,02809** |
| 0,15 | 0,00997 | 0,01139 | 0,01129 | 0,03265 |
| 0,20 | 0,01131 | 0,01093 | 0,01215 | 0,03438 |
| 0,30 | 0,01333 | 0,01284 | 0,01233 | 0,03850 |
| **0,50** | 0,01924 | 0,01099 | 0,01046 | **0,04069** |

**Pior caso: `p0 = 0,50` → α global = 0,04069 ≤ 0,05.** ✅

O pior caso **não** é o baseline operacional. Em `p0 = 0,102` o desenho gasta
0,028; em `p0 = 0,50` gasta 0,041. Se a rodada tivesse parado no baseline, teria
reportado um desenho 45% mais folgado do que ele realmente é no pior ponto.

---

## §5 — A futility é NON-BINDING

| modo | α global pior caso | p0 do pior caso |
|---|---|---|
| NON-BINDING (futility não aplicada) | **0,04069** | 0,50 |
| BINDING (futility aplicada) | 0,03985 | 0,50 |

A diferença é `0,00084`. E o ponto decisivo não é o tamanho da diferença, é a
direção: **o modo non-binding já passa sozinho**. O controle de alpha da V2 não
depende de ninguém obedecer à regra de futility.

Isso tem consequência operacional concreta: se, num checkpoint, a futility
disparar e a operação decidir **continuar mesmo assim** — porque o cliente pediu,
porque o custo já foi pago, porque alguém achou cedo demais para desistir —, o
teste **continua estatisticamente válido**. Uma futility *binding* teria a
propriedade oposta: desobedecê-la invalidaria o alpha, e o desenho estaria
refém de uma decisão de campo.

Se a futility fosse necessária para segurar o alpha, essa seria uma fragilidade a
declarar. Ela não é. Logo: **a futility da V2 é um instrumento de economia (parar
de gastar contato num teste que não vai concluir nada), não um instrumento de
validade.**

Isso é uma **propriedade atestada da V2**, registrada no artefato de auditoria.
**Não é uma emenda.** Nenhum parâmetro da V2 muda — ver §10.

---

## §6 — Consistência: unilateral na derivação e no teste

Um erro clássico é derivar o boundary com um teste e aplicar outro (derivar
bilateral, testar unilateral, ou vice-versa) — o que dobra ou divide o alpha real
sem que ninguém perceba.

A V2 declara hipótese direcional: reativação **aumenta** a conversão. O script
usa `P(X ≥ a)` — hipergeométrica na cauda superior, **unilateral** — tanto para
apurar o gasto de alpha por look quanto para decidir rejeição. A mesma função
(`fisher_1s`) é a única usada nos dois papéis; não há duas implementações que
possam divergir.

Consequência a manter em mente na leitura: **um resultado em que o controle
converte mais que o tratamento nunca rejeita.** Isso não é falha do teste — é a
hipótese que foi pré-registrada. Dano na direção contrária é tratado pela regra
de HARM, que é separada e vence significância.

---

## §7 — α realizado (0,041), não α nominal (0,05)

A V2 declara `alpha_global = 0,05`. O desenho **realiza** 0,04069 no pior caso e
0,02809 no baseline operacional. A diferença não é erro: é a **discrição** do
teste exato de Fisher. Com `n` pequeno o espaço amostral tem poucos pontos, e o
nível atingível salta para baixo do nominal — não existe região crítica que
consuma exatamente 5%.

A tentação óbvia seria "aproveitar o alpha sobrando": afrouxar o boundary para
~0,035 e ficar em 0,048, comprando poder de graça. **Recusado.** Essa folga é
conservadorismo a favor de quem lê o resultado; convertê-la em poder é trocar
proteção contra falso positivo por eficiência, num teste que já vai decidir se a
empresa liga uma máquina de contato. Além disso, escolher o boundary olhando o
alpha sobrando é otimização de desenho — exatamente o que a rodada proíbe.

Fica registrado, para a leitura do resultado: **o teste é conservador. Uma
rejeição vale mais do que o rótulo "p < 0,05" sugere; uma não-rejeição vale
proporcionalmente menos.**

---

## §8 — Reprodutibilidade

```
ops/r76/audit_alpha.py
sha256 = 925506e1bfc22fdcbe8ab86b15f915bbe5cc2a35ab4f493880dede31786f782c
python3 ops/r76/audit_alpha.py     # 2,7 s, sem dependências externas
```

Determinístico: sem `random`, sem rede, sem banco. Reproduz as três tabelas deste
README exatamente.

Registro em banco (append-only, `UPDATE` e `DELETE` bloqueados por trigger —
ambos testados e rejeitados nesta rodada):

```sql
select rodada, versao_auditada, veredito, alpha_global_pior_caso,
       p0_pior_caso, futility_binding_necessario, script_sha256
  from experimento_auditoria;
-- R76 | EXP-REATIV-V2 | VALIDADO | 0.04069 | 0.50 | false | 925506e1...
```

---

## §9 — Veredito

```
V2_ALPHA_GLOBAL_VALIDADO
```

`α global (pior caso, non-binding) = 0,04069 ≤ 0,05`.

A regra de efficacy da V2 — Fisher exato unilateral, boundary 0,0294 por
checkpoint, looks em `n = 20/40/70` por braço, parada na primeira rejeição —
controla o erro tipo I global. O boundary foi revalidado para os looks da V2, não
herdado da V1.

**Nenhuma V3 foi criada.** O desenho passou; criar uma V3 seria abrir uma janela
para mexer num desenho aprovado.

Inclusive a propriedade descoberta em §5 (futility non-binding) foi registrada
como **atestação sobre a V2**, no artefato de auditoria — e não como emenda ao
pré-registro. Reescrever a V2 para acrescentar a palavra "non-binding" seria
tocar num desenho já congelado com base em uma conta feita depois; o texto da V2
continua byte-a-byte idêntico ao que foi pré-registrado, e a auditoria é um
documento separado que aponta para ele por hash.

---

## §10 — Congelamento

O desenho está **CONGELADO**.

| artefato | sha256 | estado |
|---|---|---|
| `PRE-REGISTRO-EXP-REATIVACAO-V1.md` | `9a9ece25…59b56` | histórico, intacto |
| `PRE-REGISTRO-EXP-REATIVACAO-V2.md` | `e8d43540…4d723b` | **vigente**, intacto |
| `ops/r76/audit_alpha.py` | `925506e1…6f782c` | auditoria |

Nenhuma nova rodada sobre **desenho** de experimento até o fechamento do canário
em **2026-09-04**. O que ainda pode acontecer antes disso é execução e observação,
não redesenho.

O que a V2 **ainda não tem**, e que continua verdadeiro depois desta auditoria:
alpha controlado não é poder. Com 29 clientes `FREQ_2_3` contatáveis contra um
`N_MAX` de 70 por braço, o desenho está pré-registrado mas **não está abastecido**.
Esta rodada provou que a régua é honesta — não que existe amostra suficiente para
usá-la.

---

## Gate de segurança (fecha a rodada)

| verificação | esperado | observado |
|---|---|---|
| mensagens enviadas nesta rodada | 0 | **0** (último envio 21/08, canário) |
| `policy.ativo` | `false` | `false` |
| campanhas | 21 rascunho / 1 em_execucao / 1 pausada | idem |
| randomizações executadas | 0 | **0** |
| população `FREQ_2_3` contatável | 29 | **29** |
| V1 sha256 | intacto | intacto |
| V2 sha256 | intacto | intacto |
| V3 criada | não | **não** |
| linhas em `experimento_auditoria` | 1 | 1 |
| trigger append-only (`UPDATE`/`DELETE`) | rejeita | **rejeitou os dois** |
