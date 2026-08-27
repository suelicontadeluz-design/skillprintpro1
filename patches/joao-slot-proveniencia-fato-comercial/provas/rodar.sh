#!/bin/sh
# Roda a matriz completa desta frente. Uso: sh provas/rodar.sh <base_v4.36.0.ts>
set -e
D=$(cd "$(dirname "$0")" && pwd); BASE="$1"; CAND="$D/../candidato/index.ts"
python3 "$D/../aplicar_patch.py" "$BASE" "$CAND"
python3 "$D/extrair.py" "$CAND" "$D/proveniencia_gerado.ts"
python3 "$D/extrair_modalidade.py" "$CAND" "$D/modalidade_gerado.ts"
R="$D/../.."
cp "$CAND" "$D/../candidato436.ts"; cp "$BASE" "$D/../base436.ts"
# baselines historicos, ja versionados nas frentes anteriores
cp "$R/joao-cep-canonico-confirmar-reutilizar/candidato/index.ts" "$D/../base435.ts"
cp "$R/joao-modalidade-logistica-antes-do-cep/candidato/index.ts" "$D/../base.ts"
echo '{"type":"module"}' > "$D/package.json"; mkdir -p "$D/../out"; echo '{"type":"module"}' > "$D/../out/package.json"
tsc -p "$D/tsconfig.json"; tsc -p "$D/tsconfig.fin.json"
for t in testes_proveniencia testes_modalidade testes_cep testes_envio_remetente testes; do
  echo "===== $t ====="; node "$D/../out/$t.js" | tail -4
done
python3 "$D/regressao_diff.py" "$BASE" "$CAND" | tail -3
