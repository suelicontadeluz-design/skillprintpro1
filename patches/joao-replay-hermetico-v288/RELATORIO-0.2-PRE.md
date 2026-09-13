# RELATÓRIO — Fase 0.2-pré, plano João v5

**Data:** 13/09/2026
**Escopo executado:** Entrega 1 (harness hermético v288) + abertura de ciclo + preflight.
**Escopo NÃO executado:** nenhum caso de replay foi rodado. Entregas 2 e 3 não começaram.

---

## 1. Resultado em uma linha

O harness está construído, commitado e publicado. O preflight bloqueou em
`ALLOW_REPLAY_EXECUTION_FALSE`, como previsto. **E apareceu um impedimento novo, mais
sério que a trava: o núcleo da v288 não tem suporte a replay** — ver §6.

---

## 2. Hashes e identificadores

### Composição (item 2 da seção 5) — byte-idêntica

```
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/agente-noturno-index-20260912/v288.ts
b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b  patches/joao-replay-hermetico-v288/composicao-v288.ts
```

`cmp` entre os dois: idênticos, sem diferença de byte. O mesmo arquivo servido pelo
`raw.githubusercontent.com` no commit da entrega devolve o mesmo sha256.

### Commit e edge

| Item | Valor |
|---|---|
| Repositório | `suelicontadeluz-design/skillprintpro1` |
| Branch | `claude/joao-v5-fase-0-2-pre-g7atre` |
| Commit | `85d55bebe08208c365a9929943cd3a9e70dfccf4` |
| Edge nova | `agente-noturno-replay-v288`, id `b2497b7c-d32d-441c-ada2-5d408ddc79d5`, version **1** |
| `ezbr_sha256` da edge | `da5c0d5761a6818290542f3b2c1f13b51f2270ef796871b7b8c0ea5c9a8f90a6` |
| `verify_jwt` | `false` (igual ao v17; a autenticação é própria, por `REPLAY_RUNNER_JWT`) |

### Item 1 da seção 5 — publicada importando `harness.ts` por SHA

Conteúdo real de `index.ts` na edge publicada:

```ts
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/85d55bebe08208c365a9929943cd3a9e70dfccf4/patches/joao-replay-hermetico-v288/harness.ts";
```

### Item 7 da seção 5 — `agente-noturno` intocada

| Campo | Valor |
|---|---|
| `version` | **288** (inalterada) |
| `updated_at` | `1789257400509` → **2026-09-12 23:56:40 UTC** |
| `ezbr_sha256` | `d797064a01ae1ed1966a5e50f04fdb0020853eb715006740f006f140644297c5` |
| import | `…/010d91f8c305ed5d2800bdd65d3fde6dbc9d31ad/patches/agente-noturno-index-20260912/v288.ts` |

A edge nova foi criada em `1789264339720` → **2026-09-13 01:52:19 UTC**, ou seja
**1h55min depois** do último `updated_at` da `agente-noturno`. A viva não foi
redeployada, nem teve env ou config mexidos.

`agente-noturno-replay` v17 **não foi republicada**: continua version 17,
`updated_at 1788626223344`.

---

## 3. Retorno do preflight (seção 3.1)

Ciclo aberto — **novo**, o `7a522685` não foi reaproveitado nem alterado:

| Campo | Valor |
|---|---|
| `id` | `920aedd5-fd26-4529-b651-2861403aac1d` |
| `frente_slug` | `joao-replay-hermetico-v288` |
| `alvo` | `agente-noturno` |
| `estado` | `aberto` |
| `orcamento_usd` | **5.0000** |
| `max_tentativas` | **87** (= 29 casos × 3; `tentativas` é contador **por ciclo** — ver §5 e P5) |
| `max_casos` | 29 |
| `aberto_em` | 2026-09-13 01:53:40 UTC |
| `aberto_por` | `alessandro/claude-code-fase-0.2-pre-v288` |

> Nota: o par `(frente_slug, alvo)` tem índice único parcial
> `replay_ciclo_um_vivo_por_alvo … WHERE estado NOT IN ('promovido','descartado')`.
> O ciclo histórico `7a522685` (bloqueado, frente `joao-parametro-financeiro-sem-proveniencia`)
> ocupa esse par. Como ele é a evidência do vazamento de 30/08, **não foi descartado
> para liberar o slot**; o ciclo novo foi aberto sob a frente própria desta fase.

`select public.fn_replay_pode_executar('920aedd5-…')`:

```json
{
    "pode": false,
    "ciclo": {
        "estado": "aberto",
        "gasto_usd": 0.0000,
        "tentativas": "0/87",
        "orcamento_usd": 5.0000
    },
    "regra": "FAIL CLOSED: na duvida, nao roda. Ferramenta nova sem comportamento shadow explicito tambem cai aqui.",
    "bloqueios": [
        "ALLOW_REPLAY_EXECUTION_FALSE: replay não autorizado; não confunde com patch de edge produtiva"
    ]
}
```

**`ALLOW_REPLAY_EXECUTION_FALSE` é o único bloqueio.** Estado aberto, 0/87 tentativas,
gasto 0 < orçamento 5. Tudo o mais está configurado; só a trava está desligada — o
gate funcionando como projetado. **Parei aqui**, conforme a regra 0.3.

---

## 4. Destinos de rede nos 38 arquivos (seção 1.4 confirmada por grep)

Método: baixados os **38 arquivos nos SHAs exatos pinados** por `v288.ts` (não as
versões do HEAD — são diferentes), e
`grep -ohE "https?://[a-zA-Z0-9./_-]+" | sort -u` sobre eles.

| Destino | Quem chama | Na tabela 1.4? | Decisão no harness |
|---|---|---|---|
| `api.anthropic.com/v1/messages` | núcleo L3182 **e preload 17** (`EL_ANTHROPIC`) | sim (só o núcleo) | **PERMITIR** |
| `<SUPABASE_URL>/rest/v1/*` GET/HEAD | várias | sim | **PERMITIR** (nativo, anon key) |
| `<SUPABASE_URL>/rest/v1/rpc/<fn>` ∈ `SAFE_READ_RPCS` | várias | sim | **PERMITIR** |
| `<SUPABASE_URL>/rest/v1/rpc/<fn>` fora da lista | várias | sim | BLOCK `rpc_fora_da_lista` |
| `<SUPABASE_URL>/rest/v1/<tabela>` POST/PATCH/DELETE | núcleo, preloads | sim | BLOCK `escrita_tabela` |
| `<SUPABASE_URL>/functions/v1/*` | núcleo, preload 09 | sim | BLOCK |
| `api.z-api.io/instances/…` (`send-text`, `send-audio`, `send-reaction`) | núcleo L2355/L2524/L2566 | sim | BLOCK |
| `backend.botconversa.com.br/api/v1/webhook` | núcleo L152 | sim | BLOCK |
| `api.mercadopago.com` | `gerar_pix` | sim | BLOCK |
| `ynjsflvdfftcopibzxyo.supabase.co` (ERP) | preloads 01, 03, 04; núcleo L144 | sim | BLOCK |
| `http://api.frenet.com.br/shipping/quote` | preload 01 (`DRZ_FRENET_URL`) | sim | BLOCK `SEM_REPRODUCAO_FRETE` |
| **`api.openai.com/v1/audio/transcriptions`** | núcleo L2146 (`transcreverAudio`) | **NÃO** | BLOCK `openai_transcricao_audio` |
| **`drive.google.com/drive/folders`** | preload 17 L165 | **NÃO** | BLOCK `google_drive_intake` |
| **`drive.usercontent.google.com/download`** | preload 17 L150 | **NÃO** | BLOCK `google_drive_intake` |
| `pay.smartpag.com.br` | núcleo L2623, L3933 — **só comentário** | não | BLOCK (listado; não é egresso) |
| `skillprintestamparia.com.br` | núcleo L366 — constante de texto do prompt | não | não é egresso |
| `raw.githubusercontent.com` | resolução dos 38 imports | sim | acontece no `import`, não passa pelo `fetch` |
| `esm.sh` | import de módulo | não | idem |
| qualquer outro | — | — | BLOCK `destino_nao_mapeado` |

**Três destinos reais fora da tabela 1.4**: OpenAI (transcrição de áudio) e as duas
rotas do Google Drive. Todos bloqueados. Detalhe em `PENDENCIAS.md` P6.

**A Anthropic é chamada de dois sítios, não de um** (P7) — estimativas de custo que
suponham "1 chamada por caso" vão subestimar.

### Vias de fuga: nenhuma

Sobre os mesmos 38 arquivos: `EdgeRuntime.waitUntil` → **0**;
`XMLHttpRequest`/`new WebSocket` → **0**; captura de fetch fora de
`globalThis.fetch` → **0**. Os 38 capturam a base sempre como
`globalThis.fetch.bind(globalThis)`, então a jaula instalada antes do import é a raiz
de todas as cadeias. O canal de saída é único.

### Tratamento de 409

`grep -nE "\b409\b"` devolve 4 sítios e **todos produzem** 409; nenhum o consome como
retry. 409 é terminal para a v288 — status correto para o bloqueio, sem precisar de
ajuste.

---

## 5. O que foi construído

`patches/joao-replay-hermetico-v288/`: `composicao-v288.ts`, `harness.ts`,
`LEIA-ME.md`, `PENDENCIAS.md`, este relatório.

**A correção central em relação ao v17:** o v17 chama
`installOwnSupabaseReadBridge()` *dentro do handler*, depois do `import` do candidato.
`let current = globalThis.fetch` já recebe a cadeia pronta, e `defineProperty` só
intercepta reatribuições **futuras** — a política nunca envolveria nenhuma camada.
Isso bastava para o candidato v4374, que era hermético sozinho. A v288 não é: **33 dos
38 arquivos reatribuem `globalThis.fetch` no import**. Aqui a ponte é instalada
**antes** da composição, e a raiz da cadeia passa a ser a jaula.

A política é aplicada em dois pontos: guarda por camada no `set` (corta `BLOCK` na
origem) e `baseFetch` na raiz (resolve `ALLOW_NATIVE`/`ALLOW_ANTHROPIC`). `ALLOW_*`
desce a cadeia de propósito, para que os preloads continuem podendo interceptar
leituras — é o que preserva fidelidade com produção.

Travas, todas fail-closed: credencial do servidor → `Authorization` em tempo constante
→ **`fn_replay_pode_executar`** (423) → `CONTRATO_V288_SEM_SNAPSHOT` (422).

---

## 6. Impedimento novo — leia antes de ligar a trava

**O núcleo da v288 não tem suporte a replay.** No arquivo 22
(`joao-slot-proveniencia-escrita/candidato/index.ts` @ `0bd29b65`):

```
replay_case_id → 0    fn_replay_snapshot → 0    __ctxHermetico → 0    stubEscritaHermetica → 0
```

Tudo isso era do candidato **v4374** (`3063c81c`), para o qual o v17 foi escrito. O
núcleo da v288 aceita só `phone`, `chat_name`, `mensagem`, `inbound_id`, `_dry_run`,
`_sweep`, `_direct_message`. Sem caminho de snapshot ele **lê estado vivo do lead**,
que mudou desde o `as_of` dos casos — exatamente o que a seção 2.3 manda não deixar
acontecer.

Conforme a seção 2.3: documentado, e **parei antes de rodar os 29**. O harness é
fail-closed nesse ponto (422 `CONTRATO_V288_SEM_SNAPSHOT`).

Precedente na própria tabela: o ciclo `0c981cfa` (Isabela) está bloqueado com
`REPLAY_HISTORICO_IMPOSSIVEL_NA_VERSAO_VIVA` — o mesmo problema, em outro agente.

**Ligar `allow_replay_execution` não resolve isso.** São dois impedimentos
independentes: a trava (decisão do Alessandro) e a lacuna de contrato (trabalho de
engenharia ainda não feito). Caminhos possíveis em `PENDENCIAS.md` P1.

---

## 7. Verificação pendente

**Não consegui invocar a edge por HTTP nesta sessão**: o proxy de egresso nega
`ldrdtaibazplvrbwyrvx.supabase.co:443` com 403 de política. Então o teste de boot —
que provaria em runtime que a composição carrega sob a jaula e que o handler é
capturado — **não foi executado**.

O que está provado: a edge foi publicada, bundlada (`ezbr_sha256` emitido) e aponta
para o `harness.ts` no SHA certo; os arquivos são servidos pelo raw com o hash certo.

O que falta: um `POST {"modo":"inspecionar"}` com `Bearer REPLAY_RUNNER_JWT`, que
devolve `camadas_fetch_capturadas` (esperado: **33**), `deno_serve_chamadas`
(esperado: **1**) e `handler_producao: true`. Quem tiver rota para o endpoint deve
rodar isso antes de qualquer execução de caso.

---

## 8. Conformidade com a seção 0

| Regra | Estado |
|---|---|
| 0.1 Não tocar na edge `agente-noturno` | cumprida — version 288, `updated_at` inalterado (§2) |
| 0.2 Não alterar nenhum dos 38 arquivos | cumprida — `git status` não lista nenhum deles; a composição é cópia |
| 0.3 Não alterar chave de `go_ai_dev_config` | cumprida — `max(updated_at)` = 2026-09-11, nenhuma linha tocada hoje |
| 0.4 Nenhuma escrita de negócio | cumprida — única escrita foi 1 `INSERT` em `replay_ciclo` |
| 0.5 Nenhuma mensagem para telefone real | cumprida — nenhum caso executado; Z-API/BotConversa/MP bloqueados na origem |
| 0.6 Fora de escopo vai para `PENDENCIAS.md` | cumprida — 13 itens |
| 0.7 "Funcionou" com consulta que prova | cumprida — retornos colados em §2, §3 e abaixo |

Estado do banco ao fim:

```
replay_execucao_linhas | replay_ciclo_linhas | config_alterada_hoje | config_updated_at_max
          26           |          3          |          0           | 2026-09-11 06:30:16+00
```

As 26 linhas de `replay_execucao` são todas de **30/08/2026**, dos ciclos `7a522685`
(22) e `0c981cfa` (4). **Nenhuma do ciclo novo** — nada foi executado. (O briefing 1.3
dizia "0 linhas"; estava desatualizado — P13.)
`replay_ciclo` foi de 2 para 3 linhas: a minha.

---

## 9. Próximo passo

Decisão do Alessandro, sobre **dois** pontos independentes:

1. **A trava.** Ligar ou não `go_ai_dev_config.allow_replay_execution`. Não alterei.
2. **A lacuna de contrato (§6).** Sem isso, ligar a trava só troca o bloqueio 423 pelo
   422 — os 29 continuam sem poder rodar com fidelidade ao `as_of`.

Antes de qualquer execução, rodar o teste de boot da §7.
