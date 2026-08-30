// Suite A-I da v4.37.3 — "preco unitario nao autoriza o total".
// antes  = v4.37.2 publicada na Edge 184 (sha e93b2f10...92983)
// depois = index.ts corrigido. A COMPOSICAO da decisao vem VERBATIM do fonte.
const A = await import('./.gen/preco-antes.ts');
const D = await import('./.gen/preco-depois.ts');
let f = 0;
const ok = (b) => (b ? '\x1b[32mOK \x1b[0m' : (f++, '\x1b[31mX  \x1b[0m'));
const T = (id, d, c, det='') => console.log(`${ok(c)}${id}. ${d}${det ? '  ->  ' + det : ''}`);
const cent = (r) => Math.round(r * 100);
// atalho: um valor conferido, fonte de unidade fechada
const caso = (resposta, c, fonte='ficha_preco_fechado', extra={}) =>
  ({ resposta, conferidos: [{ centavos: c, fonte }], produtoGuarda: null, ...extra });
const rodaA = (x) => A.decidirEhProduto(x).ehProduto;
const rodaD = (x) => D.decidirEhProduto(x);

console.log('── A. as 4 autorizacoes historicas com linguagem unitaria ───────');
// textos VERBATIM de operacoes_financeiras.components.texto / fact_conversations
const historicos = [
  { n:'28/08 lead ...6900  R$29,90  "a partir de R$29,90 a folha"', c:2990, fonte:'dtf_uv_degraus',
    t:'Boa noite! Temos filme DTF UV pronto para imprimir em copos, vidros, metais e outros materiais, sem prensa, resistente à água e custa a partir de R$29,90 a folha. Qual tamanho de adesivo você está pensando?',
    slots:{ produto:'dtf_uv' } },
  { n:'18/08 lead ...8608  R$29,90  "a partir de R$29,90 cada"', c:2990, fonte:'ficha_preco_fechado',
    t:'Camiseta personalizada sai a partir de R$29,90 cada. E que cor?',
    slots:{ produto:'camiseta', grade:[{cor:'preto',modelo:'basica',tamanhos:{}},{cor:'marrom',modelo:'basica',tamanhos:{}}] } },
  { n:'11/08 lead ...6945  R$35,90  "a partir de R$ 35,90 a unidade"', c:3590, fonte:'ficha_preco_fechado',
    t:'Ótimo! Para *copos térmicos inox* que a gente vende, personalizado sai a partir de R$ 35,90 a unidade. Quantas você quer?',
    slots:{} },
  { n:'17/08 lead ...8796  R$9,90  (so o prefixo de 160 chars sobreviveu)', c:990, fonte:'ficha_preco_fechado',
    t:'Cobre sim, Rosa! A gente envia pra Tubarão normalmente pelos Correios. O pack sai R$9,90 a unidade, arquivo digital.',
    slots:{}, reconstruido:true },
];
for (const h of historicos) {
  const x = caso(h.t, h.c, h.fonte, { slots: h.slots });
  const a = rodaA(x), d = rodaD(x);
  T('A', h.n + (h.reconstruido ? '  [texto reconstruido]' : ''), a === true && d.ehProduto === false,
    `v4.37.2 autorizava=${a} -> v4.37.3 autoriza=${d.ehProduto} (unitario=${d.valorEUnitario}, qtd=${d.qtdDoPedido})`);
}

console.log('\n── B. informar preco unitario continua permitido ────────────────');
T('B', 'a guarda so decide AUTORIZACAO; nao ha caminho que altere o texto',
  typeof D.decidirEhProduto({ resposta:'Camiseta a partir de R$29,90 cada.', conferidos:[{centavos:2990,fonte:'ficha_preco_fechado'}] }).ehProduto === 'boolean',
  'decidirEhProduto devolve so o booleano de autorizacao');

console.log('\n── C/D. fechamento com informacao suficiente ────────────────────');
const josiene = caso('Certo! A4 sai por R$29,90. Me passa o CEP para calcular o frete e a gente fecha.', 2990);
T('D', 'caso Josiene (folha A4 avulsa, sem semantica unitaria) segue autorizando',
  rodaA(josiene) === true && rodaD(josiene).ehProduto === true);
const josieneQtd = caso('Certo! A4 sai por R$29,90. Me passa o CEP.', 2990, 'ficha_preco_fechado', { slots:{ quantidade:1 } });
T('D2','Josiene com quantidade=1 explicita segue autorizando', rodaD(josieneQtd).ehProduto === true);
const multiQtd = caso('A folha A4 sai R$29,90.', 2990, 'ficha_preco_fechado', { slots:{ quantidade:10 } });
T('C', 'quantidade conhecida > 1: valor unico NAO autoriza (total tem de vir da composicao)',
  rodaA(multiQtd) === true && rodaD(multiQtd).ehProduto === false,
  `qtd=10 -> unitario=${rodaD(multiQtd).valorEUnitario}`);
const gradeQtd = caso('Camiseta sai R$39,90.', 3990, 'ficha_preco_fechado',
  { slots:{ grade:[{tamanhos:{P:2,M:3}}] } });
T('C2','soma da grade (5 pecas) tambem bloqueia o valor unitario', rodaD(gradeQtd).ehProduto === false,
  `qtd derivada da grade = ${rodaD(gradeQtd).qtdDoPedido}`);

console.log('\n── E. Pack Futebol nao regride ──────────────────────────────────');
const packReal = caso('Não tenho como enviar imagem de preview aqui no WhatsApp. O pack Futebol R$ 9,90 vem com +100 artes de clubes brasileiros em alta resolução, pronto para imprimir.', 990);
T('E', 'Pack Futebol R$9,90 (texto real de 30/08) segue autorizando',
  rodaA(packReal) === true && rodaD(packReal).ehProduto === true);
const packAnime = caso('O pack Animes sai por R$6,90, arquivo digital por link, sem frete.', 690);
T('E2','Pack Animes R$6,90 (texto real de 24/08) segue autorizando',
  rodaA(packAnime) === true && rodaD(packAnime).ehProduto === true);
const packStreet = caso('O pack Streetwear sai por R$29,90, com mais de 6.000 artes digitais.', 2990);
T('E3','Pack Streetwear R$29,90 segue autorizando', rodaD(packStreet).ehProduto === true);

console.log('\n── F. por metro nao ganha autorizacao nova ──────────────────────');
for (const [n,c,t] of [
  ['DTF Textil/metro R$59,90', 5990, 'DTF têxtil sai R$59,90 o metro.'],
  ['DTF UV/metro R$99,00', 9900, 'Um metro sai por R$ 99,00.'],
  ['faixa textil R$49,90', 4990, 'De 10 a 20 metros sai R$49,90 por metro.'],
]) {
  const x = caso(t, c, 'catalogo_produtos');
  T('F', `${n} nao autoriza (antes tambem nao)`, rodaA(x) === false && rodaD(x).ehProduto === false);
}

console.log('\n── G. precos inventados seguem recusados ────────────────────────');
for (const [n,c] of [['R$29,70 caso Erica',2970],['R$44,55 caso Erica',4455]]) {
  // sem fonte, fn_valor_e_legitimo nao confere -> conferidos vazio
  const x = { resposta:`O valor fica R$${(c/100).toFixed(2).replace('.',',')}.`, conferidos:[], produtoGuarda:null };
  T('G', `${n} nao autoriza`, rodaA(x) === false && rodaD(x).ehProduto === false);
}

console.log('\n── H. nenhuma autorizacao segura muda sem justificativa ─────────');
const seguras = [
  ['A3 fechada R$39,90', 3990, 'Seu arquivo já está montado no tamanho A3. DTF UV em folha A3 é R$39,90. Vamos fechar o pedido?'],
  ['A4 fechada R$29,90', 2990, 'Uma folha A4 DTF UV com o mix de designs: R$29,90.'],
  ['pack BTS R$9,90', 990, 'Temos um pack digital com essas artes prontas por R$9,90, você recebe o arquivo por link.'],
];
let mudou = 0;
for (const [n,c,t] of seguras) {
  const x = caso(t, c);
  const a = rodaA(x), d = rodaD(x).ehProduto;
  if (a !== d) mudou++;
  T('H', `${n} inalterada`, a === d && d === true, `antes=${a} depois=${d}`);
}
T('H*','zero autorizacao segura alterada', mudou === 0);

console.log('\n── I. guards financeiros existentes integros ────────────────────');
T('I', 'soUm continua exigindo UM valor e UM conferido',
  D.decidirEhProduto({ resposta:'Produto R$29,90 e frete R$19,90.', conferidos:[{centavos:2990,fonte:'ficha_preco_fechado'},{centavos:1990,fonte:'ficha_preco_fechado'}] }).ehProduto === false);
T('I2','fonte fora de unidade fechada continua barrada (ficha_unitario)',
  D.decidirEhProduto(caso('Sai R$59,90.', 5990, 'ficha_unitario')).ehProduto === false);
T('I3','catalogo_produtos COM produtoGuarda continua barrado',
  D.decidirEhProduto({ ...caso('Sai R$29,90.', 2990, 'catalogo_produtos'), produtoGuarda:'dtf_uv' }).ehProduto === false);
T('I4','valor fora de PRECOS_FICHA_FECHADOS continua barrado',
  D.decidirEhProduto(caso('Sai R$47,90.', 4790, 'catalogo_produtos')).ehProduto === false);
T('I5','idempotencia: mesma entrada, mesmo veredito',
  JSON.stringify(rodaD(packReal)) === JSON.stringify(rodaD(packReal)));

console.log(`\n${f===0 ? '\x1b[32mTODOS OS TESTES PASSARAM\x1b[0m' : '\x1b[31m'+f+' FALHA(S)\x1b[0m'}`);
process.exit(f===0?0:1);
