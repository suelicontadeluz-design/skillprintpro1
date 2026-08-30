#!/bin/bash
# Gera um modulo testavel da guarda de autorizacao por preco de ficha, recortando
# do proprio index.ts. A COMPOSICAO da decisao (FONTES_UNIDADE_FECHADA .. ehProduto)
# entra VERBATIM: o teste nao reimplementa a regra, executa a do fonte.
set -euo pipefail
SRC="$1"; OUT="$2"
sec() { awk -v ini="$1" -v fim="$2" 'index($0,ini){p=1} p{print} p&&index($0,fim)&&!index($0,ini){exit}' "$SRC"; }
{
  grep -F 'const RX_MOEDA = ' "$SRC"
  sec 'function reaisParaCentavos(' '}'
  sec 'function valoresDaMensagem(' 'return out;'
  echo '}'
  grep -F 'const RX_PRECO_UNITARIO = ' "$SRC"
  sec 'function frasesComValor(' '.filter((f) => valoresDaMensagem(f).includes(centavos));'
  echo '}'
  sec 'const PRECOS_DE_FICHA = new Set' ']);'
  sec 'const PRECOS_FICHA_FECHADOS = new Set' ']);'
  sec 'function somaGrade(' 'return t > 0 ? t : null;'
  echo '}'
  echo 'function decidirEhProduto(a: any) {'
  echo '  const resposta: string = a.resposta;'
  echo '  const decisao: any = { slots: a.slots || {} };'
  echo '  const estado: any = { slots: a.estadoSlots || {} };'
  echo '  const produtoGuarda: any = a.produtoGuarda ?? null;'
  echo '  const naMsg = valoresDaMensagem(resposta);'
  echo '  const conferidos: any[] = a.conferidos;'
  echo '  const soUm = naMsg.length === 1 && conferidos.length === 1;'
  # ── composicao VERBATIM do fonte ──
  sec '        const FONTES_UNIDADE_FECHADA = (f: string) =>' '          && FONTES_UNIDADE_FECHADA(conferidos[0].fonte);'
  echo '  return { ehProduto, valorEUnitario: soUm ? valorEUnitario : false, soUm, qtdDoPedido };'
  echo '}'
  echo 'export { decidirEhProduto, valoresDaMensagem, RX_PRECO_UNITARIO, frasesComValor, PRECOS_FICHA_FECHADOS };'
} > "$OUT"
