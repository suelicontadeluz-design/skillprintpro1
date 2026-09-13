from pathlib import Path

p = Path('patches/joao-slot-proveniencia-escrita/candidato/index.ts')
s = p.read_text(encoding='utf-8')


def replace_once(label: str, before: str, after: str) -> None:
    global s
    n = s.count(before)
    if n != 1:
        raise SystemExit(f'anchor {label}: esperado 1x, encontrado {n}x')
    s = s.replace(before, after, 1)


replace_once(
    'short_content_guard',
    "function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length >= 2 || /^\\d$/.test(t); }",
    "function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length > 0; }",
)

replace_once(
    'promotion_block',
    """const produtoMacroAnteriorResolvido = normalizarProdutoMacro(slotsAnteriores.produto);
const produtoMacroMensagemResolvido = normalizarProdutoMacro(prodMsg);
const produtoMacroOrigemResolvido = normalizarProdutoMacro(prodOrigem);
const produtoDeterministico = produtoMacroMensagemResolvido
  || (!produtoMacroAnteriorResolvido ? produtoMacroOrigemResolvido : null);
const produtoDeterministicoFonte = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (!produtoMacroAnteriorResolvido && produtoMacroOrigemResolvido ? 'anuncio' : null);""",
    """const produtoAnteriorBruto = String(slotsAnteriores.produto || '').trim();
const produtoMacroAnteriorResolvido = normalizarProdutoMacro(slotsAnteriores.produto);
const produtoMacroMensagemResolvido = normalizarProdutoMacro(prodMsg);
const produtoMacroOrigemResolvido = normalizarProdutoMacro(prodOrigem);
let produtoMacroAquisicaoResolvido: string | null = null;
let produtoAquisicaoDetalhe: string | null = null;
if (!produtoAnteriorBruto && leadId) {
  try {
    const { data: lmMeta } = await sb.from('leads_marketing').select('product_type,utm_campaign_name,utm_content,utm_ad_name').eq('lead_id', leadId).limit(1).maybeSingle();
    const fontesAquisicao = [
      ['product_type', String(lmMeta?.product_type || '')],
      ['utm_campaign_name', String(lmMeta?.utm_campaign_name || '')],
      ['utm_content', String(lmMeta?.utm_content || '')],
      ['utm_ad_name', String(lmMeta?.utm_ad_name || '')],
    ] as Array<[string,string]>;
    for (const [detalhe, valor] of fontesAquisicao) {
      const p = normalizarProdutoMacro(categoriaParaProduto(valor));
      if (p) { produtoMacroAquisicaoResolvido = p; produtoAquisicaoDetalhe = detalhe; break; }
    }
  } catch {}
}
const produtoDeterministico = produtoMacroMensagemResolvido
  || (!produtoAnteriorBruto ? (produtoMacroAquisicaoResolvido || produtoMacroOrigemResolvido) : null);
const produtoDeterministicoFonte = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (!produtoAnteriorBruto && produtoDeterministico ? 'anuncio' : null);
const produtoDeterministicoFonteDetalhe = produtoMacroMensagemResolvido
  ? 'mensagem_cliente'
  : (produtoMacroAquisicaoResolvido && produtoDeterministico === produtoMacroAquisicaoResolvido
      ? produtoAquisicaoDetalhe
      : (produtoDeterministicoFonte === 'anuncio' ? 'origem_anuncio' : null));""",
)

replace_once(
    'filter_macro',
    "    macroCanonico: normalizarProdutoMacro(prodOrigem),",
    "    macroCanonico: produtoMacroAquisicaoResolvido || normalizarProdutoMacro(prodOrigem),",
)

replace_once(
    'persist_source_insert',
    "  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {",
    """  const produtoMacroNovoPersistido = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
  const produtoFontePersistida = produtoMacroNovoPersistido && produtoMacroNovoPersistido !== produtoMacroAnteriorResolvido && slotsRecebidos.produto !== undefined
    ? (produtoDeterministico && produtoMacroNovoPersistido === produtoDeterministico ? produtoDeterministicoFonte : 'modelo')
    : null;
  const produtoFonteDetalhePersistida = produtoFontePersistida
    ? (produtoFontePersistida === produtoDeterministicoFonte ? produtoDeterministicoFonteDetalhe : 'modelo_slot')
    : null;
  if (produtoFontePersistida) {
    slotsNovos._produto_fonte = produtoFontePersistida;
    slotsNovos._produto_fonte_detalhe = produtoFonteDetalhePersistida;
  } else if (produtoMacroNovoPersistido !== produtoMacroAnteriorResolvido) {
    delete slotsNovos._produto_fonte;
    delete slotsNovos._produto_fonte_detalhe;
  }
  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {""",
)

replace_once(
    'observer_source_reuse',
    """  const prodMacroObs = normalizarProdutoMacro(slotsNovos.produto ?? slotsAnteriores.produto);
  // Proveniencia observavel sem schema novo: grava somente quando um produto
  // canonico novo/mudado foi efetivamente aceito e persistido.
  const produtoFontePersistida = prodMacroObs
    && prodMacroObs !== produtoMacroAnteriorResolvido
    && slotsRecebidos.produto !== undefined
      ? (produtoDeterministico && prodMacroObs === produtoDeterministico
          ? produtoDeterministicoFonte
          : 'modelo_slot')
      : null;""",
    """  const prodMacroObs = produtoMacroNovoPersistido;
  // Proveniencia ja foi resolvida deterministicamente acima e persistida no mesmo JSONB.""",
)

required = [
    "return t.length > 0;",
    "produtoMacroAquisicaoResolvido",
    "utm_campaign_name",
    "_produto_fonte_detalhe",
    "macroCanonico: produtoMacroAquisicaoResolvido || normalizarProdutoMacro(prodOrigem)",
]
for marker in required:
    if marker not in s:
        raise SystemExit(f'marker final ausente: {marker}')

for marker in ['__candidate_createClient', 'candidate_core_fetch_failed', 'transpileModule']:
    if marker in s:
        raise SystemExit(f'artefato de laboratorio vazou para core: {marker}')

p.write_text(s, encoding='utf-8')
