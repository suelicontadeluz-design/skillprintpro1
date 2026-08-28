#!/bin/bash
# Replay dry-run do defeito adesivo_dtf_uv. Nao acessa rede, nao chama modelo,
# nao envia mensagem: so roda as funcoes puras recortadas do proprio index.ts.
#   antes  = baseline-v4.37.0.ts (fonte vigente antes da correcao)
#   depois = recorte do index.ts atual
# Requer Node >= 22 (--experimental-strip-types).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .gen
cp baseline-v4.37.0.ts .gen/antes.ts
./slice.sh ../../candidato/index.ts .gen/depois.ts
falhou=0
for t in regressao-produto regressao-quantidade replay-lead prova-preco; do
  echo; echo "═══ $t ═══"
  node --experimental-strip-types "$t.mjs" || falhou=1
done
echo; [ "$falhou" = 0 ] && echo "TODOS OS TESTES PASSARAM" || { echo "HOUVE FALHA"; exit 1; }
