#!/bin/bash
# Extrai, do fonte do agente-noturno, exatamente os blocos envolvidos na
# normalizacao de produto e na porta de proveniencia de slots. Nada e reescrito
# a mao: sao recortes do proprio arquivo, delimitados por marcadores.
set -euo pipefail
SRC="$1"; OUT="$2"
sec() { awk -v ini="$1" -v fim="$2" 'index($0,ini){p=1} p{print} p&&index($0,fim)&&!index($0,ini){exit}' "$SRC"; }
{
  sec 'const RX_PROD_UV = '            'const RX_PECA_PROPRIA = '
  sec 'function produtoNaMensagem('    '}'
  grep -F 'const RX_ENVIO_REMETENTE_CLIENTE = ' "$SRC"
  sec 'function normalizarProdutoMacro(' 'return { slots: out, rejeitados };'
  echo '}'
  sec 'const MATRIZ_TOOL: Record' 'return { permitida: true, motivo: '"'"'compativel'"'"' };'
  echo '}'
  echo 'export { avaliarCompatibilidadeTool };'
  echo 'export { normalizarProdutoMacro, filtrarSlotsPorProveniencia, produtoNaMensagem, evidenciaDeQuantidade, evidenciaDeProduto };'
} > "$OUT"
