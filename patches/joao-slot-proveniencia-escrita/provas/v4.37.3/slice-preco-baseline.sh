#!/bin/bash
set -euo pipefail
SRC="$1"; OUT="$2"
sec() { awk -v ini="$1" -v fim="$2" 'index($0,ini){p=1} p{print} p&&index($0,fim)&&!index($0,ini){exit}' "$SRC"; }
{
  grep -F 'const RX_MOEDA = ' "$SRC"
  sec 'function reaisParaCentavos(' '}'
  sec 'function valoresDaMensagem(' 'return out;'
  echo '}'
  sec 'const PRECOS_DE_FICHA = new Set' ']);'
  sec 'const PRECOS_FICHA_FECHADOS = new Set' ']);'
  sec 'function somaGrade(' 'return t > 0 ? t : null;'
  echo '}'
  echo 'function decidirEhProduto(a: any) {'
  echo '  const resposta: string = a.resposta;'
  echo '  const produtoGuarda: any = a.produtoGuarda ?? null;'
  echo '  const naMsg = valoresDaMensagem(resposta);'
  echo '  const conferidos: any[] = a.conferidos;'
  echo '  const soUm = naMsg.length === 1 && conferidos.length === 1;'
  sec '        const FONTES_UNIDADE_FECHADA = (f: string) =>' '          && FONTES_UNIDADE_FECHADA(conferidos[0].fonte);'
  echo '  return { ehProduto, valorEUnitario: false, soUm, qtdDoPedido: null };'
  echo '}'
  echo 'export { decidirEhProduto, valoresDaMensagem, PRECOS_FICHA_FECHADOS };'
} > "$OUT"
