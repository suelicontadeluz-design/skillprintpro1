// CANARIO v4.37.2 — cadeia completa, deterministica, sem rede/modelo/envio.
// Entrada: "Quero o Pack Futebol de R$ 9,90"   Adversario: "Quero adesivo DTF UV"
const A = await import('./.gen/antes.ts');   // v4.37.1 publicada
const D = await import('./.gen/depois.ts');  // v4.37.2 candidata
let f = 0;
const ok = (b) => (b ? '\x1b[32mOK \x1b[0m' : (f++, '\x1b[31mX  \x1b[0m'));
const T = (d, c, det='') => console.log(`${ok(c)}${d}${det ? '  ->  ' + det : ''}`);
const estado = (M, ctx, phone='5531999990000') => M.resolverModalidadeLogistica({
  mensagemAtual: '', inboundsPedido: [], historicoInbound: [], slots: {}, phone, freteJa: null, produtoContexto: ctx });

console.log('══ CANARIO: "Quero o Pack Futebol de R$ 9,90" ══════════════════');
const msg = 'Quero o Pack Futebol de R$ 9,90';
const prodMsg = D.produtoNaMensagem(msg);
// produtoContexto e montado como no agente: [prodMsg, slots.produto, categoriaAnuncio]
const ctxPack = [prodMsg, 'pack_futebol'].filter(Boolean).join(' ');
const eD = estado(D, ctxPack), eA = estado(A, ctxPack);
T('produto reconhecido como pack', D.normalizarProdutoMacro('pack_futebol') === 'pack',
  `produtoNaMensagem="${prodMsg}"  macro="${D.normalizarProdutoMacro('pack_futebol')}"`);
T('entrega tratada como DIGITAL', eD.produto_digital === true);
T('nenhum calculo de frete (bloqueado na origem)', eD.bloqueia_frete === true && eD.motivo_bloqueio === 'produto_digital_sem_frete');
T('nenhuma pergunta de CEP', eD.pedir_cep === false);
const p = D.perguntaDoQueFaltaFechamento(eD, {});
T('nenhuma pergunta de MEDIDA', !/medida/i.test(p));
T('nenhuma pergunta de RETIRADA/ENVIO', !/(retirada|envio)/i.test(p));
T('fluxo segue comercialmente util (pede o que falta de verdade)', /pagamento|pix|cart/i.test(p), `"${p}"`);
T('nenhuma ferramenta fisica incompativel liberada',
  ['calcular_frete'].every((t)=>D.avaliarCompatibilidadeTool(t,'pack',null).permitida) === true
  && ['calcular_rendimento_uv','calcular_dtf_por_arte','orcar_camisetas','calcular_copo']
      .every((t)=>D.avaliarCompatibilidadeTool(t,'pack',null).permitida === false));
T('preco continua exigindo fonte canonica (catalogo/pix transversais, nada inventado)',
  D.avaliarCompatibilidadeTool('consultar_catalogo','pack',null).permitida === true
  && D.avaliarCompatibilidadeTool('gerar_pix','pack',null).permitida === true);
console.log(`    [comparacao] v4.37.1 nesta mesma entrada: digital=${eA.produto_digital} frete_bloqueado=${eA.bloqueia_frete} pergunta="${A.perguntaDoQueFaltaFechamento(eA,{})}"`);

console.log('\n══ ADVERSARIO: "Quero adesivo DTF UV" ══════════════════════════');
const msgUv = 'Quero adesivo DTF UV';
const prodUv = D.produtoNaMensagem(msgUv);
const ctxUv = [prodUv, 'adesivo_dtf_uv'].filter(Boolean).join(' ');
const uD = estado(D, ctxUv), uA = estado(A, ctxUv);
T('classificado como DTF UV', D.normalizarProdutoMacro('adesivo_dtf_uv') === 'dtf_uv' && prodUv === 'dtf_uv',
  `produtoNaMensagem="${prodUv}" macro="${D.normalizarProdutoMacro('adesivo_dtf_uv')}"`);
T('NAO virou pack', D.normalizarProdutoMacro('adesivo_dtf_uv') !== 'pack' && uD.produto_digital === false);
T('segue produto FISICO: frete nao bloqueado por digital', uD.motivo_bloqueio !== 'produto_digital_sem_frete');
T('comportamento identico a v4.37.1', uD.produto_digital === uA.produto_digital
  && uD.bloqueia_frete === uA.bloqueia_frete && uD.motivo_bloqueio === uA.motivo_bloqueio,
  `v4.37.1 digital=${uA.produto_digital}/${uA.motivo_bloqueio} | v4.37.2 digital=${uD.produto_digital}/${uD.motivo_bloqueio}`);
T('ferramenta de UV segue permitida no fluxo UV', D.avaliarCompatibilidadeTool('calcular_rendimento_uv','dtf_uv',null).permitida === true);
T('pergunta fisica preservada (quantidade/medida)', /quantidade|medida/i.test(D.perguntaDoQueFaltaFechamento(uD,{})));

console.log(`\n${f===0 ? '\x1b[32mCANARIO + ADVERSARIO: PASS\x1b[0m' : '\x1b[31m'+f+' FALHA(S)\x1b[0m'}`);
process.exit(f===0?0:1);
