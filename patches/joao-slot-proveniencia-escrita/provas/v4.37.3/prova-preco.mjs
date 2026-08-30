// Prova que, resolvido o produto, o fluxo ALCANCA a etapa de preco:
// a ferramenta de preco do UV deixa de passar por fail-open e passa por
// compatibilidade de verdade, e a guarda de preco passa a saber o produto.
const A = await import('./.gen/antes.ts');
const D = await import('./.gen/depois.ts');

const slotProduto = 'adesivo_dtf_uv';           // o que o modelo emitiu, real
const modalidade = null;                         // obsModalidade do turno real

for (const [via, M] of [['antes', A], ['depois', D]]) {
  const macro = M.normalizarProdutoMacro(slotProduto);
  console.log(`\n${via.toUpperCase()}  produto_macro = ${macro}`);
  for (const tool of ['calcular_rendimento_uv', 'calcular_dtf_uv_metro', 'calcular_dtf_por_arte', 'orcar_camisetas', 'calcular_copo']) {
    const r = M.avaliarCompatibilidadeTool(tool, macro, modalidade);
    console.log(`   ${tool.padEnd(24)} permitida=${String(r.permitida).padEnd(6)} motivo=${r.motivo}`);
  }
}

const mA = A.normalizarProdutoMacro(slotProduto), mD = D.normalizarProdutoMacro(slotProduto);
const t = [
  ['ANTES: ferramenta de UV so passava por fail-open', A.avaliarCompatibilidadeTool('calcular_rendimento_uv', mA, null).motivo === 'produto_indeterminado_fail_open'],
  ['DEPOIS: ferramenta de UV passa por compatibilidade real', D.avaliarCompatibilidadeTool('calcular_rendimento_uv', mD, null).motivo === 'compativel'],
  ['DEPOIS: ferramenta de textil fica incompativel nesta conversa', D.avaliarCompatibilidadeTool('calcular_dtf_por_arte', mD, null).permitida === false],
  ['DEPOIS: a guarda de preco recebe p_produto=dtf_uv (era null)', mD === 'dtf_uv' && mA === null],
];
console.log('\n── VEREDITO ────────────────────────────────────────────────');
for (const [n, b] of t) console.log((b ? '\x1b[32mOK \x1b[0m' : '\x1b[31mX  \x1b[0m') + n);
process.exit(t.every(([, b]) => b) ? 0 : 1);
