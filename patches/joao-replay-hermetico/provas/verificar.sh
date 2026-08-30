#!/usr/bin/env bash
# Prova estatica do candidato joao-replay-hermetico:
#  1. o candidato compila (esbuild, sintaxe TS);
#  2. removidas as duas insercoes do contrato, o candidato volta a ser o baseline
#     BYTE A BYTE (preservacao do caminho live);
#  3. hashes de identidade.
set -euo pipefail
cd "$(dirname "$0")/.."
BASELINE=../joao-slot-proveniencia-escrita/candidato/index.ts
CANDIDATO=candidato/index.ts

echo "== 1. sintaxe (esbuild) =="
npx -y esbuild@0.24.0 "$CANDIDATO" --loader:.ts=ts --outfile=/dev/null && echo OK

echo "== 2. reversibilidade byte a byte =="
python3 provas/reversibilidade.py "$BASELINE" "$CANDIDATO"

echo "== 3. identidade =="
sha256sum "$BASELINE" "$CANDIDATO"
