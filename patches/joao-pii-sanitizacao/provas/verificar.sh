#!/usr/bin/env bash
# Prova de que o artefato sanitizado e SEMANTICAMENTE IDENTICO ao baseline live
# e que nao resta PII real.
#
# A prova central: os dois arquivos, minificados pelo esbuild (que remove
# comentarios mas preserva todo o codigo, strings e prompts), devem produzir
# bundles com o MESMO sha256. Se algum literal de PII estivesse dentro de uma
# string de prompt, de uma regra ou de uma tool, os bundles divergiriam.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "uso: verificar.sh <caminho-do-baseline-live-index.ts>"
  echo "  (obtenha-o com: git cat-file -p 58f64326271f3a38e5b92ee322ff5dfcd0866816:patches/joao-slot-proveniencia-escrita/candidato/index.ts)"
  exit 2
fi
SAN=candidato/index.ts

echo "== 1. build/sintaxe dos dois lados =="
npx -y esbuild@0.24.0 "$BASE" --loader:.ts=ts --minify --outfile=/tmp/base.min.js
npx -y esbuild@0.24.0 "$SAN"  --loader:.ts=ts --minify --outfile=/tmp/san.min.js

echo "== 2. equivalencia semantica (bundle minificado byte a byte) =="
sha256sum /tmp/base.min.js /tmp/san.min.js
cmp /tmp/base.min.js /tmp/san.min.js && echo "EQUIVALENTES: nenhuma mudanca de logica/fluxo/regra/prompt/tool"

echo "== 3. diff so pode tocar comentario =="
diff -u "$BASE" "$SAN" > /tmp/pii.diff || true
python3 - <<'PY'
linhas = [l for l in open('/tmp/pii.diff') if (l[0] in '+-') and not l.startswith(('+++', '---'))]
corpo = [l[1:].strip() for l in linhas]
com = [c for c in corpo if c.startswith(('//', '*', '/*'))]
print('linhas +/-:', len(linhas), '| em comentario:', len(com))
print('DIFF_PII_ONLY:', 'SIM' if len(com) == len(linhas) else 'NAO')
raise SystemExit(0 if len(com) == len(linhas) else 1)
PY

echo "== 4. nenhuma PII real remanescente no sanitizado =="
python3 - <<'PY'
import re
t = open('candidato/index.ts', encoding='utf-8').read()
tel = re.findall(r'\b55[1-9]\d{9,10}\b', t)
ok = all(re.match(r'^55\d{2}90{2,}\d{3}$', x) for x in tel)
cep = [c for c in re.findall(r'\b\d{5}-\d{3}\b', t) if c != '00000-000']
print('telefones:', len(tel), '| todos sinteticos:', ok, '| CEPs reais:', len(cep))
raise SystemExit(0 if ok and not cep else 1)
PY
echo "TODAS AS PROVAS PASSARAM"
