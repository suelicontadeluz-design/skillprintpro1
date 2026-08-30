// Suite A-L da correcao v4.37.2 (familia digital "pack").
// antes = v4.37.1 publicada na Edge 183 (sha 1d838589...9967b)
// depois = index.ts corrigido. Tudo puro: sem rede, sem modelo, sem envio.
const A = await import('./.gen/antes.ts');
const D = await import('./.gen/depois.ts');

let falhas = 0;
const ok = (b) => (b ? '\x1b[32mOK \x1b[0m' : (falhas++, '\x1b[31mX  \x1b[0m'));
const T = (id, desc, cond, detalhe='') => console.log(`${ok(cond)}${id}. ${desc}${detalhe ? '  ->  ' + detalhe : ''}`);

// helper: estado logistico para um contexto de produto, sem nenhuma fala logistica
// DDD importa: em Grande SP (11) o frete ja e bloqueado por
// 'modalidade_indefinida_com_retirada_plausivel', o que MASCARA o efeito digital.
// Para isolar a correcao usamos um DDD de fora (31, Minas — como o lead real ...3109).
const estado = (M, produtoContexto, msg='', slots={}, phone='5531999990000') => M.resolverModalidadeLogistica({
  mensagemAtual: msg, inboundsPedido: [], historicoInbound: [],
  slots, phone, freteJa: null, produtoContexto,
});

console.log('── PRODUTO: familia pack reconhecida ────────────────────────────');
T('A', 'pack_adesivos -> macro pack', D.normalizarProdutoMacro('pack_adesivos') === 'pack',
  `antes=${A.normalizarProdutoMacro('pack_adesivos')} depois=${D.normalizarProdutoMacro('pack_adesivos')}`);
T('B', 'Pack Futebol -> macro pack', D.normalizarProdutoMacro('Pack Futebol') === 'pack');
T('C', 'Pack Animes -> macro pack', D.normalizarProdutoMacro('Pack Animes') === 'pack');
// aliases reais do corpus de producao e do catalogo vivo
for (const v of ['pack_animes','pack_catolicos','packs_digitais','pack_digital','pack_estampas_anime',
                 'pack_nba_legends','pack_rock','pack_digital_streetwear','pack_estampas_prontas',
                 'Pack de Estampas Anime (1000+ artes digitais)','Pack de Estampas Streetwear (+6.000 artes digitais)']) {
  T('C+', `alias real "${v}"`, D.normalizarProdutoMacro(v) === 'pack');
}

console.log('\n── FLUXO DIGITAL: sem frete, sem medida, sem retirada ───────────');
const ePackD = estado(D, 'pack_adesivos');
const ePackA = estado(A, 'pack_adesivos');
T('D', 'pack fora da Grande SP -> frete bloqueado (antes NAO era)',
  ePackD.bloqueia_frete === true && ePackA.bloqueia_frete === false,
  `antes=${ePackA.bloqueia_frete}/${ePackA.motivo_bloqueio} depois=${ePackD.bloqueia_frete}/${ePackD.motivo_bloqueio}`);
const spD = estado(D,'pack_adesivos','',{}, '5511999990000');
const spA = estado(A,'pack_adesivos','',{}, '5511999990000');
T('D1b','pack na Grande SP: ja bloqueava por retirada plausivel, agora bloqueia pelo motivo certo',
  spA.bloqueia_frete === true && spD.bloqueia_frete === true
  && spA.motivo_bloqueio === 'modalidade_indefinida_com_retirada_plausivel'
  && spD.motivo_bloqueio === 'produto_digital_sem_frete');
T('D2','pack -> produto_digital=true', ePackD.produto_digital === true);
T('D3','pack -> NAO pede CEP', ePackD.pedir_cep === false);
const perguntaD = D.perguntaDoQueFaltaFechamento(ePackD, {});
const perguntaA = A.perguntaDoQueFaltaFechamento(ePackA, {});
T('E', 'pack -> nao pede MEDIDA', !/medida/i.test(perguntaD), `depois: "${perguntaD}"`);
T('F', 'pack -> nao pede retirada/envio nem CEP', !/(retirada|envio|cep)/i.test(perguntaD));
T('F2','pack -> nao pede quantidade fisica', !/quantidade/i.test(perguntaD));
T('F3','a v4.37.1 pedia exatamente o texto do defeito', /quantidade/i.test(perguntaA) && /medida/i.test(perguntaA),
  `antes: "${perguntaA}"`);
T('F4','bloco de prompt declara entrega digital', /PRODUTO DIGITAL/i.test(D.blocoModalidadeLogistica(ePackD)));

console.log('\n── GUARDAS ─────────────────────────────────────────────────────');
T('G', 'pack: ferramenta fisica de UV fica INCOMPATIVEL (era fail-open)',
  D.avaliarCompatibilidadeTool('calcular_rendimento_uv','pack',null).permitida === false
  && A.avaliarCompatibilidadeTool('calcular_rendimento_uv',null,null).motivo === 'produto_indeterminado_fail_open');
T('G2','pack: calcular_frete/orcar_camisetas/calcular_copo incompativeis',
  ['calcular_dtf_por_arte','orcar_camisetas','calcular_copo','calcular_dtf_metro']
    .every((t) => D.avaliarCompatibilidadeTool(t,'pack',null).permitida === false));
T('G3','pack: consultar_catalogo e gerar_pix seguem permitidos (preco tem fonte)',
  ['consultar_catalogo','gerar_pix','compor_total'].every((t) => D.avaliarCompatibilidadeTool(t,'pack',null).permitida === true));

console.log('\n── NAO-REGRESSAO DAS OUTRAS FAMILIAS ───────────────────────────');
T('H', 'DTF UV inalterado', ['dtf_uv','adesivo_dtf_uv','adesivo_uv','dtf_uv_folha_a4','DTF UV']
  .every((v) => D.normalizarProdutoMacro(v) === A.normalizarProdutoMacro(v) && D.normalizarProdutoMacro(v) === 'dtf_uv'));
T('I', 'DTF textil inalterado', ['dtf_textil','DTF têxtil','dtf_textil_2m','dtf_textil e dtf_uv']
  .every((v) => D.normalizarProdutoMacro(v) === A.normalizarProdutoMacro(v) && D.normalizarProdutoMacro(v) === 'dtf_textil'));
T('J', 'camiseta/copo inalterados', ['camiseta','camiseta oversized','camiseta_personalizada','copo_termico','copo']
  .every((v) => D.normalizarProdutoMacro(v) === A.normalizarProdutoMacro(v)));
T('J2','PEDIDO MISTO segue FISICO e mantem frete',
  D.normalizarProdutoMacro('dtf_textil_3m + pack_catolicos_troca_anjos') === 'dtf_textil'
  && estado(D,'dtf_textil_3m + pack_catolicos_troca_anjos').bloqueia_frete === estado(A,'dtf_textil_3m + pack_catolicos_troca_anjos').bloqueia_frete,
  `misto: macro=${D.normalizarProdutoMacro('dtf_textil_3m + pack_catolicos_troca_anjos')} bloqueia_frete=${estado(D,'dtf_textil_3m + pack_catolicos_troca_anjos').bloqueia_frete}`);
T('J3','fluxo fisico ainda pergunta quantidade e medida',
  /quantidade/i.test(D.perguntaDoQueFaltaFechamento(estado(D,'dtf_uv'), {}))
  && /medida/i.test(D.perguntaDoQueFaltaFechamento(estado(D,'dtf_uv'), {})));
T('K', 'produto desconhecido segue null / fail-closed do fallback',
  D.normalizarProdutoMacro('linha e fio marrom') === null
  && D.normalizarProdutoMacro('panos_de_prato') === null
  && D.avaliarCompatibilidadeTool('calcular_rendimento_uv',null,null).motivo === 'produto_indeterminado_fail_open');

console.log('\n── L: quantidade da v4.37.1 sem regressao ──────────────────────');
const RXQ = /\bquant[oa]s\b[^?]{0,160}\?/i;
const rodaQ = (M, c, comFix) => {
  const arg = { anteriores:{}, recebidos:{ quantidade:c.q }, textosCliente:c.cliente,
                macroCanonico:null, toolsUsadas:[], midiaNoTurno:false, numerosDeFerramenta:[] };
  if (comFix) arg.perguntaQuantidadePendente = RXQ.test(String(c.ultimaJoao||''));
  return M.filtrarSlotsPorProveniencia(arg).slots.quantidade !== undefined;
};
const casosQ = [
  { n:'alvo 5499: "100" apos "Quantos adesivos ... precisa?"', q:100, esperado:true,
    ultimaJoao:'Perfeito! Quantos adesivos de 50x75cm você precisa?', cliente:['100','50x75'] },
  { n:'ADV dinheiro "entrada de 300"', q:300, esperado:false,
    ultimaJoao:'Quantas camisetas você quer?', cliente:['Consigo dar uma entrada de 300 hoje'] },
  { n:'ADV remessa "posso enviar 300 agora"', q:300, esperado:false,
    ultimaJoao:'Quantos adesivos você precisa?', cliente:['posso enviar 300 agora'] },
  { n:'real 7646: "10 imagens que preciso"', q:10, esperado:true,
    ultimaJoao:'Qual é a medida da sua arte?', cliente:['Tenho 10 imagens que preciso para o papel transfer'] },
  { n:'real 4303: "6 baby look"', q:6, esperado:true,
    ultimaJoao:'Bom dia! A gente faz estamparia', cliente:['Gostaria de saber quanto fica 6 baby look algodão'] },
];
let regQ = 0;
for (const c of casosQ) {
  const a = rodaQ(A,c,true), d = rodaQ(D,c,true);
  if (a !== d) regQ++;
  T('L', c.n, d === c.esperado && a === d, `v4.37.1=${a} v4.37.2=${d} esperado=${c.esperado}`);
}
T('L*','ZERO divergencia entre v4.37.1 e v4.37.2 na porta de quantidade', regQ === 0);

console.log(`\n${falhas === 0 ? '\x1b[32mTODOS OS TESTES PASSARAM\x1b[0m' : '\x1b[31m' + falhas + ' FALHA(S)\x1b[0m'}`);
process.exit(falhas === 0 ? 0 : 1);
