#!/bin/sh
# Roda a matriz completa da FASE 2. Uso: sh provas/rodar.sh <base_v4.37.0.ts>
set -e
D=$(cd "$(dirname "$0")" && pwd); BASE="$1"; CAND="$D/../candidato/index.ts"
python3 "$D/../aplicar_patch.py" "$BASE" "$CAND"
python3 "$D/extrair.py" "$CAND" "$D/proveniencia_gerado.ts"
python3 "$D/extrair_modalidade.py" "$CAND" "$D/modalidade_gerado.ts"
R="$D/../.."
cp "$CAND" "$D/../candidato436.ts"; cp "$BASE" "$D/../base436.ts"  # nomes herdados das suites antigas
# baselines historicos, ja versionados nas frentes anteriores
cp "$R/joao-cep-canonico-confirmar-reutilizar/candidato/index.ts" "$D/../base435.ts"
cp "$R/joao-modalidade-logistica-antes-do-cep/candidato/index.ts" "$D/../base.ts"
echo '{"type":"module"}' > "$D/package.json"; mkdir -p "$D/../out"; echo '{"type":"module"}' > "$D/../out/package.json"
# Type-check do CANDIDATO INTEIRO: as suites so exercitam o modulo extraido, entao
# so isto prova que o codigo da guarda de saida (dentro de atenderClienteInterno)
# enxerga calcmeVigente, chamarCerebro, estadoLog e o resto do escopo.
python3 - "$CAND" "$D/../cand_tc.ts" <<'PYEOF'
import io, sys
s = io.open(sys.argv[1], encoding='utf-8').read()
s = s.replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
              "declare function createClient(a?:any,b?:any):any;", 1)
io.open(sys.argv[2], 'w', encoding='utf-8').write(s)
PYEOF
printf 'declare const Deno: any;\n' > "$D/../shim_tc.d.ts"
tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution Bundler \
    --strict false --skipLibCheck --ignoreConfig "$D/../cand_tc.ts" "$D/../shim_tc.d.ts"
echo "candidato inteiro: 0 erros de tipo"
tsc -p "$D/tsconfig.json"; tsc -p "$D/tsconfig.fin.json"
for t in testes_saida testes_modalidade testes_cep testes_envio_remetente testes; do
  echo "===== $t ====="; node "$D/../out/$t.js" | tail -4
done
python3 "$D/regressao_diff.py" "$BASE" "$CAND" | tail -3
