#!/bin/bash
# Replay/regressao do agente-noturno. Nao acessa rede, nao chama modelo, nao envia
# mensagem: so roda as funcoes puras recortadas do proprio index.ts.
#   suite v4.37.1 (alias UV + proveniencia de quantidade)  baseline = v4.37.0
#   suite v4.37.2 (familia digital pack)                   baseline = v4.37.1
# Requer Node >= 22 (--experimental-strip-types).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .gen
./slice.sh ../../candidato/index.ts .gen/depois.ts
falhou=0

echo "═══════ SUITE v4.37.1 — baseline v4.37.0 ═══════"
cp baseline-v4.37.0.ts .gen/antes.ts
for t in regressao-produto regressao-quantidade replay-lead prova-preco; do
  echo; echo "── $t ──"
  node --experimental-strip-types "$t.mjs" || falhou=1
done

echo; echo "═══════ SUITE v4.37.2 — baseline v4.37.1 ═══════"
cp baseline-v4.37.1.ts .gen/antes.ts
for t in testes-pack canario-pack; do
  echo; echo "── $t ──"
  node --experimental-strip-types "$t.mjs" || falhou=1
done

echo; echo "═══════ SUITE v4.37.3 — baseline v4.37.2 ═══════"
cp baseline-preco-v4.37.2.ts .gen/preco-antes.ts
./slice-preco.sh ../../candidato/index.ts .gen/preco-depois.ts
echo; echo "── testes-preco-unitario ──"
node --experimental-strip-types testes-preco-unitario.mjs || falhou=1

echo; [ "$falhou" = 0 ] && echo "TODAS AS SUITES PASSARAM" || { echo "HOUVE FALHA"; exit 1; }
