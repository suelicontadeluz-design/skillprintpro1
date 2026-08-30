const RX_MOEDA = /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})|(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s?reais/gi;
function reaisParaCentavos(txt: string): number {
  const n = txt.replace(/\./g, '').replace(',', '.');
  return Math.round(Number(n) * 100);
}
function valoresDaMensagem(msg: string): number[] {
  const out: number[] = []; let m: RegExpExecArray | null;
  const rx = new RegExp(RX_MOEDA.source, 'gi');
  while ((m = rx.exec(msg)) !== null) { const bruto = m[1] || m[2]; if (bruto) out.push(reaisParaCentavos(bruto)); }
  return out;
}
const PRECOS_DE_FICHA = new Set<number>([
  2990, 3990,              // folha A4 e folha A3 de DTF UV
  3590,                    // copo termico avulso
  690, 990, 1990,          // packs de estampas
  5990, 5490, 4990, 4490, 3990, // tabela de DTF textil por faixa
]);
const PRECOS_FICHA_FECHADOS = new Set<number>([
  2990, 3990,        // folha A4 e folha A3 de DTF UV
  3590,              // copo termico avulso
  690, 990, 1990,    // packs de estampas
]);
function somaGrade(grade: any): number | null {
  if (!Array.isArray(grade) || !grade.length) return null;
  let t = 0;
  for (const item of grade) {
    const tam = item?.tamanhos || {};
    for (const k of Object.keys(tam)) { const n = Number(tam[k]); if (Number.isFinite(n) && n > 0) t += n; }
  }
  return t > 0 ? t : null;
}
function decidirEhProduto(a: any) {
  const resposta: string = a.resposta;
  const produtoGuarda: any = a.produtoGuarda ?? null;
  const naMsg = valoresDaMensagem(resposta);
  const conferidos: any[] = a.conferidos;
  const soUm = naMsg.length === 1 && conferidos.length === 1;
        const FONTES_UNIDADE_FECHADA = (f: string) =>
          f === 'ficha_preco_fechado'
          || f === 'dtf_uv_degraus'
          || (f === 'catalogo_produtos' && !produtoGuarda);

        const ehProduto = soUm
          && PRECOS_FICHA_FECHADOS.has(conferidos[0].centavos)
          && FONTES_UNIDADE_FECHADA(conferidos[0].fonte);
  return { ehProduto, valorEUnitario: false, soUm, qtdDoPedido: null };
}
export { decidirEhProduto, valoresDaMensagem, PRECOS_FICHA_FECHADOS };
