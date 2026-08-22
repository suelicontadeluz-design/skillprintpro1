# Transformacao programatica e localizada: SOMENTE gerarOrientacaoHandoff.
# Falha ruidosamente (assert) se qualquer ancora nao for unica ou cair fora do escopo.
import hashlib, sys

SRC = "baseline_index.ts"
DST = "candidato_index.ts"

src = open(SRC, "rb").read().decode("utf-8")

# ---- 1. delimitar o span EXATO da funcao alvo -------------------------------
FN_START = "async function gerarOrientacaoHandoff(params: {"
FN_END   = "\nasync function resolverDealId("
assert src.count(FN_START) == 1, "FN_START nao e unico"
assert src.count(FN_END)   == 1, "FN_END nao e unico"
i = src.index(FN_START)
j = src.index(FN_END) + 1          # inclui o \n final da funcao alvo
assert i < j
head, span, tail = src[:i], src[i:j], src[j:]

# ---- 2. as duas unicas mudancas, cada uma unica DENTRO do span --------------
EDITS = [
    (  # (a) passar a consumir promptBase e reflexao
        "  const { nome, segmento, historico, ctx } = params;",
        "  const { nome, segmento, historico, ctx, promptBase, reflexao } = params;",
    ),
    (  # (b) system no request Anthropic — byte-equivalente ao CASO 2
        "      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, "
        "messages: [{ role: 'user', content: prompt }] }),",
        "      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, "
        "system: promptBase + reflexao, messages: [{ role: 'user', content: prompt }] }),",
    ),
]
novo_span = span
for old, new in EDITS:
    assert src.count(old) == 1,       f"ancora nao e unica no arquivo: {old[:60]!r}"
    assert novo_span.count(old) == 1, f"ancora nao esta no span alvo: {old[:60]!r}"
    novo_span = novo_span.replace(old, new, 1)

out = head + novo_span + tail

# ---- 3. invariantes de escopo ----------------------------------------------
assert out[:i] == head,  "head alterado"
assert out[len(head)+len(novo_span):] == tail, "tail alterado"

# CASO 2 byte a byte inalterado
CASO2 = ("      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, "
         "system: promptBase + reflexao, messages: [{ role: 'user', content: userPrompt }] }),")
assert src.count(CASO2) == 1 and out.count(CASO2) == 1, "CASO 2 alterado/duplicado"

# nenhuma outra linha mudou
a, b = src.split("\n"), out.split("\n")
assert len(a) == len(b), "contagem de linhas mudou"
difs = [n+1 for n, (x, y) in enumerate(zip(a, b)) if x != y]
assert difs == [226, 255], f"linhas alteradas fora do previsto: {difs}"

open(DST, "wb").write(out.encode("utf-8"))
print("baseline sha256 :", hashlib.sha256(src.encode()).hexdigest())
print("candidato sha256:", hashlib.sha256(out.encode()).hexdigest())
print("bytes baseline / candidato:", len(src.encode()), "/", len(out.encode()))
print("linhas alteradas:", difs)
