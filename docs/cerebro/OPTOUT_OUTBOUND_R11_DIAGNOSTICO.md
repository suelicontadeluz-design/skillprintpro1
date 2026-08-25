# R11 — Opt-out de WhatsApp no caminho real do `whatsapp-executor`

**Data:** 2026-08-25 · **Projeto:** `ldrdtaibazplvrbwyrvx` · **Modo:** diagnóstico (nenhuma alteração publicada)

## VEREDITO

**`GUARD_COMPARTILHADO_PATCH_INSEGURO`**

`fn_agente_automatico_pode_atender` **não é uma guarda de outbound**. Ela é a guarda
compartilhada de 4 pontos de chamada, dos quais **2 são INBOUND** (resposta a mensagem
que o próprio cliente enviou). Um bloqueio de opt-out colocado dentro dela — sem
parâmetro novo — silenciaria o robô para clientes que escreveram para a empresa.

Isso aciona exatamente a condição de parada da rodada. **Nada foi publicado.**
Abaixo o diagnóstico e o menor gate específico para OUTBOUND.

---

## 1. Censo de chamadores (fechado por 3 instrumentos independentes)

| # | Edge | Site | Natureza | `p_respeitar_julia_pausa` | `p_checar_purchase` |
|---|------|------|----------|---------------------------|---------------------|
| 1 | `whatsapp-executor` v12 | fila de disparos | **OUTBOUND** | `true` | `true` |
| 2 | `agente-conversacao` v79 | `modoProativo` (l.748) | **OUTBOUND** | `false` | `true` |
| 3 | `agente-conversacao` v79 | `modoReativo` (l.845) | **INBOUND** | `false` | `true` |
| 4 | `agente-fechamento` v6.4.0 | `modoReativo` | **INBOUND** | `false` | `false` |

Instrumentos usados:

1. **Varredura SQL exaustiva** — `pg_proc` + `pg_views` + `cron.job` para `prosrc/definition/command ilike '%fn_agente_automatico_pode_atender%'` → **`[]`**. Nenhuma função, view ou cron chama a guarda. Os chamadores são exclusivamente edges via PostgREST RPC.
2. **Leitura do fonte ACTIVE** das 3 edges acima.
3. **Varredura do marcador de log** — sweep dinâmico (`query_to_xml`, read-only) sobre **toda** coluna `text/jsonb/json/varchar` de **toda** tabela `public` com nome contendo `log|decis|execu|event|audit|hist|trace|run`, procurando o literal `agentePodeAtender`. Resultado: só `agente_decisoes_log.contexto` (129) e `executor_rodada_etapa.detalhe` (1 — nota de auditoria anterior, não é chamador).

**Limite honesto do censo:** um chamador que (a) não seja uma dessas 3 edges e (b) nunca
grave o marcador `agentePodeAtender` nem `guard_bloqueou:` seria invisível a estes três
instrumentos. `track_functions = none` (sem `pg_stat_user_functions`) e o retention de
logs é de 24h, então não existe hoje um censo exaustivo de chamadores por telemetria.

## 2. Prova de que o site 3 é INBOUND

```
Deno.serve → body.modo === 'reativo' && mensagem → modoReativo(lead_id, phone, mensagem, ...)
                                                    ↓
                                          agentePodeAtender(lead_id, phone)
                                                    ↓
                                    rpc fn_agente_automatico_pode_atender
```

`mensagem` é o texto que **o cliente acabou de mandar**. Confirmado no log real:

```json
{"fonte":"agentePodeAtender","motivo":"humano_atendendo_90min",
 "turn_id":"0ae5bd0f-f2a9-4e38-9dd3-e51d340eb91e"}
```

`turn_id` só existe em `modoReativo`. Motivos exclusivos da guarda observados em
`resposta_bloqueada`: `humano_atendendo_90min` (7), `tarefa_pendente_humano` (30),
`estado_bloqueado_handoff_humano` (28), `estado_bloqueado_bloqueada_humano` (9),
`purchase_recente_24h` (4).

**Consequência:** hoje, se a guarda devolvesse `pode=false` por opt-out, o
`agente-conversacao` ainda gravaria `status = 'bloqueada_humano'` no estado do lead
(l.847) — ou seja, o efeito colateral vai além de "não responder": ele **muda o estado
da conversa**.

## 3. `EXECUTOR_TEM_BYPASS` — levantado e **refutado**

O `whatsapp-executor` contém, sim, um caminho que devolve `pode: true` sem chamar a guarda:

```ts
if (!leadId) return { pode: true, motivo: 'sem_lead_id_skip_guard' };
```

Ele é **inalcançável pela fila**:

- `waba_disparos_lista.lead_id` é **`NOT NULL`** (`information_schema.columns`), e
  `fn_fila_disparos_pendentes` devolve `w.lead_id` direto dessa coluna.
- `Deno.serve(async (_req))` ignora o corpo da requisição — a fila é a **única** origem
  de itens. Não há branch de teste/dry-run.
- Registro histórico: `whatsapp_executor_log` → **0 de 940** linhas com `lead_id IS NULL`;
  0 de 746 envios.

Portanto: **código morto latente, não bypass ativo.** Vale endurecer (`return {pode:false}`)
numa rodada de edge, mas não é o que bloqueia esta.

## 4. `OPTOUT_IDENTIDADE_INSUFICIENTE` — levantado e **refutado**

`crm_contact_optouts` é chaveada em `lead_id uuid NOT NULL` com FK para
`leads_marketing(lead_id)` — **não tem coluna `phone`**. Se um telefone carregasse vários
`lead_id`, um opt-out em um deles não protegeria os outros.

Medição em `leads_marketing` (telefone normalizado, ≥10 dígitos):

| telefones c/ 1 lead | c/ 2–3 leads | c/ 4+ leads | total | máx leads/telefone |
|---|---|---|---|---|
| 15.980 | 0 | 0 | 15.980 | **1** |

A identidade é **1:1**. `lead_id` sozinho é chave suficiente. Refutado.

## 5. Semântica de canal — sem inventar política cross-channel

O schema **já distingue** nativamente, por CHECK constraint:

```sql
CHECK (canal      = ANY (ARRAY['whatsapp','email']))
CHECK (finalidade = ANY (ARRAY['marketing','transacional']))
```

Predicado proposto (nada inventado, só as colunas que existem):

```sql
EXISTS (SELECT 1 FROM crm_contact_optouts o
        WHERE o.lead_id = p_lead_id
          AND o.canal = 'whatsapp'
          AND o.revogado_em IS NULL)
```

Sem filtro de `finalidade`: quem recusa WhatsApp *transacional* recusa, com folga,
WhatsApp de *marketing*. Filtrar por `finalidade='marketing'` seria **menos** conservador.

## 6. Prova em transação (`BEGIN … ROLLBACK`, zero envio externo)

Lead real da fila `73bb8e30-f8dc-411b-8f94-228f206486fb`:

| Caso | Estado | Guarda LIVE hoje | Predicado proposto |
|------|--------|------------------|--------------------|
| **A** | sem opt-out | `pode = true` | — |
| **B** | opt-out `whatsapp/marketing` **ativo** | **`pode = true`** ⚠️ | `true` |
| **C** | mesmo opt-out **revogado** | `pode = true` | `false` |
| **D** | linha real `email/marketing` (`brevo_hard_bounce`) | — | **`false`** |

- **B é o gap, provado:** com opt-out de WhatsApp ativo, a guarda LIVE **libera o envio**.
- **C:** `revogado_em` desliga o bloqueio corretamente.
- **D:** o hard bounce de e-mail **não** contamina o WhatsApp.

Pós-rollback: `total_optouts = 1`, `residuo_teste = 0`,
`md5(prosrc) = 716eace2fa6a736752496c8fe30de97e` (inalterado), `pg_current_xact_id_if_assigned() = NULL`.

## 7. Impacto histórico simulado

Dos **746** envios com `status='enviado'`, o gate teria bloqueado **0**.

Não porque o gate seja frouxo: porque **existem 0 opt-outs de WhatsApp na base**
(`crm_contact_optouts` tem 1 linha, `canal='email'`). Consistente com R10, que provou que
as "97 recusas" não eram opt-out. **O gate é garantia futura, não mudança de comportamento hoje.**

## 8. Menor gate específico para OUTBOUND (proposto, NÃO publicado)

Único formato que altera só `fn_agente_automatico_pode_atender` sem tocar inbound:
**parâmetro novo, default preservando o comportamento atual.**

```sql
-- assinatura: + p_checar_optout_whatsapp boolean DEFAULT false
--
-- inserir como Guarda 1.5, ANTES da Guarda 2 (estado), pois opt-out
-- é vontade do cliente e precede qualquer heurística de estado:
  IF p_checar_optout_whatsapp AND EXISTS (
    SELECT 1 FROM crm_contact_optouts o
    WHERE o.lead_id = p_lead_id
      AND o.canal = 'whatsapp'
      AND o.revogado_em IS NULL
  ) THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'optout_whatsapp');
  END IF;
```

Por que `DEFAULT false`:

- Os 4 sites atuais chamam por **nome**, nenhum passa o parâmetro → todos mantêm
  comportamento **byte-idêntico**. Inbound intocado, por construção.
- `DEFAULT true` aplicaria o bloqueio aos 2 sites INBOUND — o bloqueio cego proibido.

**Custo honesto:** com `DEFAULT false` o patch é **inerte**. Para o objetivo da rodada
("o executor respeitar opt-out") falta **uma linha** no `whatsapp-executor`:

```ts
p_respeitar_julia_pausa: true,
p_checar_optout_whatsapp: true,   // ← única linha nova
```

Isso é **deploy de edge**, fora do escopo autorizado. Por isso o patch SQL **não foi
publicado**: publicar sozinho criaria a aparência de proteção sem proteção nenhuma.

### Alternativa examinada e rejeitada

Distinguir outbound de inbound pelos parâmetros existentes. Hoje
`p_respeitar_julia_pausa = true` identifica unicamente o `whatsapp-executor` — mas
`agente-conversacao` usa **os mesmos parâmetros** em `modoProativo` e `modoReativo`
(o mesmo helper `agentePodeAtender`), então proativo e reativo são
**indistinguíveis de dentro da função**. Amarrar opt-out a uma flag de pausa da Julia
seria inventar semântica que o schema não tem. Rejeitado.

## 9. Ordem recomendada (próxima rodada)

1. Publicar `p_checar_optout_whatsapp boolean DEFAULT false` (inerte, hash pré-computado).
2. Deploy `whatsapp-executor` v13 com a linha acima **e** `sem_lead_id` → `pode:false`.
3. Só então: `agente-conversacao` `modoProativo` (site 2) — também outbound.
4. **Nunca** nos sites 3 e 4 (inbound).

Opt-out de marketing não deve calar a empresa quando o cliente puxa conversa.

## 10. Estado preservado

| Objeto | `md5(prosrc)` | Status |
|---|---|---|
| `fn_agente_automatico_pode_atender` | `716eace2fa6a736752496c8fe30de97e` | inalterado |
| `fn_exp001_coorte` | `8be3ea0aa38a813c40591138624904a8` | inalterado |
| `fn_mapa_cerebro_v0` | `226944645b3f715d75b9a82b33211f28` | inalterado |
| `fn_score_lead_campanha` | `75e946c1e963357e4585487695fed871` | inalterado (patch R7) |
| `fn_crm_capturar_optout_inbound` | `10c20a94fc64e8272d27ec04c350bac5` | inalterado (não ampliado) |

EXP-001 permanece congelado. Zero mensagens externas nesta rodada.
