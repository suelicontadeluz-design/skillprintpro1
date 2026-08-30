# joao-modalidade-evidencia-inequivoca — v4.37.1 → v4.38.0

## Caso sentinela (real, reproduzido)

Telefone `5521993457646`, lead `3b12c20f-2824-4ab4-96e5-ccc69aa9d311`, 29/08/2026, sob
`agente-noturno-v4.37.1` (Edge v183, commit `58f6432`):

```
18:24:13 João:    "…Como vai ser a entrega, retirada aqui em Embu ou envio?"
18:24:28 Cliente: "Obrigada"
18:25:06 João:    "Perfeito, então é envio. Me passa o CEP de 8 dígitos…"   ← DEFEITO
18:26:42 Cliente: "Não precisa"
18:26:45 Cliente: "Obrigada"
18:27:19 João:    "Pix ou cartão?"
```

Telemetria do turno defeituoso (`turn_id 2ab11620-097a-475c-be1d-3af4a3ca0202`):
o resolvedor determinístico disse `modalidade=desconhecida`; a guarda de proveniência da
v4.37.0 rejeitou os slots `envio` propostos pelo modelo (`slot_critico_sem_proveniencia`);
e o TEXTO saiu mesmo assim. "Obrigada" nunca foi evidência — o estado nunca virou envio —
mas o cliente leu que era.

## Causa raiz (código executável, não comentário)

1. `resolverModalidadeLogistica` → `montar()`: `desconhecida` só bloqueava frete/CEP na
   Grande SP (`indefinidaComRetiradaPlausivel = desconhecida && grandeSP`). DDD 21 ⇒
   `bloqueia_frete=false`, `pedir_cep=true`.
2. Com `pedir_cep=true`, `blocoCepCanonico` injetava no prompt:
   `"[CEP AUSENTE: peça o CEP UMA vez, 8 dígitos, e chame calcular_frete em seguida.]"`.
3. `blocoModalidadeLogistica` (ramo fora da Grande SP) dizia
   `"ENVIO é o caminho provável"` e `"Só peça o CEP quando ele realmente faltar"`.
4. Nenhuma guarda olhava o TEXTO da resposta — a v4.37.1 declarou isso explicitamente no
   manifesto ("guarda de saída, v4.38.0" era a frente seguinte).

O modelo obedeceu a instrução que o próprio código emitiu. Não é regra por frase:
"obrigada" não aparece em regra nenhuma, nem antes nem depois.

## Correção (3 fechos, menor mudança possível)

1. **`montar()`**: `desconhecida` bloqueia frete/CEP em QUALQUER região.
   Novo motivo: `modalidade_indefinida_sem_declaracao_do_cliente`.
2. **`blocoModalidadeLogistica()`** (fora da Grande SP, não resolvida): instrução vira
   pergunta explícita (envio ou retirada?) com CEP proibido antes da resposta — mesmo
   contrato que a Grande SP já tinha. Cortesia/emoji/silêncio nomeados como não-escolha.
3. **`guardaTextoModalidadeSemEvidencia()`** — a guarda de saída anunciada pela v4.37.1:
   barreira TERMINAL determinística. Sem evidência do cliente (`desconhecida`, não
   digital), resposta que cita CEP ou afirma modalidade é substituída pela pergunta de
   modalidade e logada (`guardrail_texto_modalidade_sem_evidencia`). Pergunta que oferece
   a escolha (cita retirada E envio) passa. Mensagem com Pix nascido no turno nunca é
   tocada (invariante v107).

Não muda: classificador de declarações (níveis 1–3 byte-idênticos), preços, frete,
autorizações financeiras, Pix, CalcMe, LOST, TTS, debounce, schema. Zero migration.

## Provas (efeito-zero por construção: nenhum I/O, nenhum deploy)

```
node --experimental-strip-types provas/sentinela.mts ./base_producao.mts    # baseline: FAIL reproduzido
node --experimental-strip-types provas/sentinela.mts ./candidato_v438.mts   # candidato: PASS
node --experimental-strip-types provas/bateria.mts                          # 30/30 PASS
```

- Baseline (58f6432): `bloqueia_frete=false`, `pedir_cep=true`, prompt instruindo a pedir
  CEP com zero evidência → defeito reproduzido (FAIL esperado).
- Candidato: `bloqueia_frete=true`, `pedir_cep=false`, bloco de CEP vazio, prompt manda
  perguntar; a guarda terminal bloqueia o texto defeituoso real e o substitui pela pergunta.
- Bateria (frases reais de `fact_conversations`): envio explícito ("Sedex", "Pelos
  correios", "pode enviar"…), retirada/motoboy explícitos, cortesias ("Obrigada", "Ok",
  "Pode ser", 👍), indefinidas, CEP solicitado corretamente sob envio declarado,
  fechamento envio+CEP, Grande SP — reconhecimento idêntico ao baseline em todos;
  única mudança: indefinida deixa de liberar CEP/frete.
- Typecheck do arquivo inteiro: `tsc --noEmit` limpo.

## Deploy

Padrão vigente: a Edge `agente-noturno` importa 1 linha fixada por commit imutável.
Rollback determinístico = redeploy da linha anterior
(`58f6432…/patches/joao-slot-proveniencia-escrita/candidato/index.ts`).
