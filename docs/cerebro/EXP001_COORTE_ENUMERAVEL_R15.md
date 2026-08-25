# R15 — `fn_exp001_coorte` passa a devolver a população inteira

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx`

## VEREDITO: `COORTE_ENUMERAVEL_SEM_MUDANCA`

Publicado. Uma única mudança de um caractere. O experimento não mudou — provado por
comparação atômica ANTES × DEPOIS dentro da mesma transação.

---

## 1. PRÉ-CONDIÇÕES

| Verificação | Resultado |
|---|---|
| `md5(prosrc)` LIVE | `8be3ea0aa38a813c40591138624904a8` (11564 b) ✓ |
| volatilidade | `STABLE` |
| ocorrências do teto `…,200)` | **1** |
| ocorrências de `p_amostra` | **1** (dentro do próprio teto) |
| ocorrências de `n_amostra` | **2** |

As duas — e só as duas — ocorrências de `n_amostra`:

```
linha   4:                least(greatest(coalesce(p_amostra,20),0),200) n_amostra),
linha 126:     select braco, row_number() over (partition by braco order by md5(lead_id::text)) ord,
linha 141:   ) y where ord <= (select n_amostra from cfg)
```

`ord` é atribuído na linha 126, **depois** de elegibilidade, estratificação e
randomização já estarem resolvidas; o teto corta na 141. Ele nunca toca em quem entra.

## 2. HASH ESPERADO

| | `md5(prosrc)` | bytes |
|---|---|---|
| baseline | `8be3ea0aa38a813c40591138624904a8` | 11564 |
| candidato pré-computado | `4390732e59e29c7b0b63bceca2215828` | 11565 |
| **LIVE pós-deploy** | **`4390732e59e29c7b0b63bceca2215828`** | **11565** |

Overloads: 1. ACL preservada. `STABLE` preservado.

## 3. ANTES × DEPOIS — comparação atômica

Capturei a saída completa, apliquei o patch e capturei de novo **dentro da mesma
transação**, depois `ROLLBACK`. Mesmo instante, zero deriva possível entre as duas leituras.

```
chaves que diferem:  amostra          ← e só ela
(j - 'amostra' - 'gerado_em') idêntico: true
```

| Campo | ANTES | DEPOIS |
|---|---|---|
| `resumo` | `{total_elegivel:459, tratamento:246, controle:213, desbal:7.190}` | **idêntico** |
| `balanceamento_por_estrato` | — | **idêntico** |
| `randomizacao.hash_divisao` | — | **idêntico** |
| `metricas` | — | **idêntico** |
| `baseline_espontaneo` | — | **idêntico** |
| `populacao` | — | **idêntico** |
| `amostra` | **400** | **459** |

## 4. TESTES PÓS-DEPLOY

| # | Teste | Resultado |
|---|---|---|
| T1 | `resumo.tratamento` | **246** |
| T2 | `resumo.controle` | **213** (valor LIVE no instante — ver item 5) |
| T3 | `amostra` devolve os dois braços inteiros | **459** = `total_elegivel`; 246 + 213 |
| T4 | nenhum lead extra fora da população | sem duplicados; 459 distintos; todos existem em `leads_marketing` |
| T5 | braço de cada lead idêntico | os 400 antigos são subconjunto dos 459, **braço idêntico em todos**; e os 459 batem 100% com a fórmula recalculada fora da função |
| T6 | estratos | `31-35d`=142 · `36-40d`=117 · `41-45d`=200 |
| T7 | gates idênticos | `fn_agente_automatico_pode_atender` `d22ac0fd…`, `fn_fila_disparos_pendentes` `8eeebb25…`, `fn_exp001_registrar_intervencao` `4b3c979b…`, MAPA `226944645b…` |
| T8 | baseline idêntico | provado no item 3 |
| T9 | nenhuma escrita | campanha EXP-001 = **0**, audiências **1982** (inalterado), opt-outs **1**, `pg_current_xact_id_if_assigned()` nulo |
| T10 | nenhum envio | **0** envios com `segmentacao='exp001_reaquecimento'` em toda a história — ver item 6 |
| T11 | candidato == LIVE | `4390732e59e29c7b0b63bceca2215828` nos dois |
| T12 | rollback provado | volta a `8be3ea0a…` e `amostra` volta a **400**, em transação |

## 5. A POPULAÇÃO DERIVOU DURANTE A PRÓPRIA RODADA

Isto não é ruído — é o achado que justifica a próxima rodada.

| Instante | total | tratamento | controle | estrato 41-45d | `hash_divisao` |
|---|---|---|---|---|---|
| 15:16 UTC | 460 | 246 | **214** | **201** | `4bfc4f190609fe009974e5c99264c0b1` |
| ~15:25 UTC | 459 | 246 | **213** | **200** | `a23d663a105015eac7d85d1b213b5cb9` |

**Um lead de controle envelheceu para fora da janela em ~9 minutos**, no meio desta rodada.

E `hash_divisao` **não é constante**. A linha 180 revela o que ele é:

```sql
'hash_divisao', (select md5(string_agg(lead_id::text||':'||braco, ',' order by lead_id)) from principal)
```

É a impressão digital da **população inteira + atribuição**, não do método. Logo:

- é **imune ao teto** — provado idêntico na comparação atômica do item 3;
- **muda sozinho** sempre que a população muda.

Consequência prática: `hash_divisao` **não serve** como âncora de integridade ao longo do
tempo, mas é **exatamente** a âncora certa para carimbar a leitura única do congelamento.
A âncora estável do método é a fórmula, que reproduz 459/459 fora da função.

## 6. ATRIBUIÇÃO DO QUE MEXEU NO BANCO (não foi esta rodada)

`waba_disparos_lista` subiu de 906 para **907**. Investiguei antes de concluir:

```
15:20:00.224 · evento=vigia_ciclo_compra · origem_agente=agente-retencao
             · campaign_audience_id=null · status=pendente_envio
```

É o cron `vigia-ciclo-compra-diario`, agendado `20 15 * * 1-5` — disparou às 15:20 UTC,
no horário dele. E os 6 envios da última meia hora são todos `segmentacao='lead_morno'`,
de linhas criadas às 14:00 pelo `vigia_leads_mornos`, todas com `campaign_audience_id` nulo.

**Nada disso é do EXP-001** (`segmentacao='exp001_reaquecimento'`: 0 linhas, 0 envios, sempre)
**e nada disso foi causado por mim** — esta rodada só executou `SELECT`, mais uma migration
de DDL puro. Registro para não misturar a operação normal da empresa com a rodada.

## 7. PRÓXIMO PASSO MÍNIMO

Agora dá para enumerar. O congelamento é uma rodada separada, e tem de ser **uma única
leitura consistente**:

1. `select public.fn_exp001_coorte(5000)` **uma vez**, dentro de uma transação;
2. materializar os leads com `braco='TRATAMENTO'` dessa leitura;
3. `fn_exp001_registrar_intervencao(lead_id, false, NULL)` para cada um;
4. carimbar no registro o `hash_divisao` e o `gerado_em` **daquela** leitura, como
   identidade da população congelada;
5. reexecutar para provar `ja_registrado` em 100%.

Não chamar a função por lead, e não reler entre o passo 1 e o 3 — a deriva medida no item
5 mostra que a população pode mudar durante a própria operação.

EXP-001 continua congelado: sem campanha, sem audiência, sem fila, sem envio.
