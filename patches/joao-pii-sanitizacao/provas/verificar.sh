#!/usr/bin/env bash
# Prova de que o artefato sanitizado e SEMANTICAMENTE IDENTICO ao baseline live
# e de que nao resta PII real.
#
# Prova central: os dois arquivos, minificados pelo esbuild (que remove
# comentarios mas preserva todo o codigo, strings, prompts e tools), devem
# produzir bundles com o MESMO sha256. Se algum literal de PII estivesse dentro
# de uma string de prompt, de uma regra ou de uma tool, os bundles divergiriam.
#
# IMPORTANTE: os dois lados sao copiados para o MESMO diretorio temporario antes
# de minificar. O esbuild aplica o tsconfig.json que encontrar subindo a arvore,
# entao minificar um lado dentro do repo e o outro fora produz bundles
# diferentes por configuracao, nao por conteudo — e a comparacao vira invalida.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "uso: verificar.sh <caminho-do-baseline-live-index.ts>"
  echo "  git cat-file -p 58f64326271f3a38e5b92ee322ff5dfcd0866816:patches/joao-slot-proveniencia-escrita/candidato/index.ts > /tmp/base.ts"
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$BASE" "$TMP/a_baseline.ts"
cp candidato/index.ts "$TMP/b_sanitizado.ts"

echo "== 1. build/sintaxe dos dois lados =="
npx -y esbuild@0.24.0 "$TMP/a_baseline.ts"  --loader:.ts=ts --minify --outfile="$TMP/a.min.js"
npx -y esbuild@0.24.0 "$TMP/b_sanitizado.ts" --loader:.ts=ts --minify --outfile="$TMP/b.min.js"

echo "== 2. equivalencia semantica (bundle minificado byte a byte) =="
sha256sum "$TMP/a.min.js" "$TMP/b.min.js"
if cmp -s "$TMP/a.min.js" "$TMP/b.min.js"; then
  echo "EQUIVALENTES: nenhuma mudanca de logica/fluxo/regra/prompt/tool"
else
  echo "FALHA: os bundles DIFEREM — a sanitizacao tocou codigo. PARAR."
  exit 1
fi

echo "== 3. diff so pode tocar comentario =="
diff -u "$TMP/a_baseline.ts" "$TMP/b_sanitizado.ts" > "$TMP/pii.diff" || true
python3 - "$TMP/pii.diff" <<'PY'
import sys
linhas = [l for l in open(sys.argv[1]) if l[:1] in '+-' and not l.startswith(('+++', '---'))]
corpo = [l[1:].strip() for l in linhas]
com = [c for c in corpo if c.startswith(('//', '*', '/*'))]
print('linhas +/-:', len(linhas), '| em comentario:', len(com))
ok = len(linhas) > 0 and len(com) == len(linhas)
print('DIFF_PII_ONLY:', 'SIM' if ok else 'NAO')
sys.exit(0 if ok else 1)
PY

echo "== 4. nenhuma PII real remanescente no sanitizado =="
python3 - <<'PY'
import re, sys
t = open('candidato/index.ts', encoding='utf-8').read()
tel = re.findall(r'\b55[1-9]\d{9,10}\b', t)
ok_tel = all(re.match(r'^55\d{2}90{2,}\d{3}$', x) for x in tel)
fmt = [f for f in re.findall(r'\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}', t) if not re.match(r'\(\d{2}\) 90+-\d{4}', f)]
cep = [c for c in re.findall(r'\b\d{5}-\d{3}\b', t) if c != '00000-000']
cpf = re.findall(r'\b\d{3}\.\d{3}\.\d{3}-\d{2}\b', t)
cnpj = re.findall(r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b', t)
print(f'telefones={len(tel)} todos_sinteticos={ok_tel} fmt_reais={len(fmt)} cep_reais={len(cep)} cpf={len(cpf)} cnpj={len(cnpj)}')
sys.exit(0 if (ok_tel and not fmt and not cep and not cpf and not cnpj) else 1)
PY

echo "TODAS AS PROVAS PASSARAM"
