// BATERIA DE CONTROLE — baseline (producao 58f6432) vs candidato (v4.38.0), efeito-zero.
// Frases das categorias 1-3 sao REAIS, extraidas de fact_conversations (somente leitura).
const base = await import('./base_producao.mts');
const cand = await import('./candidato_v438.mts');

const RIO = '5521993457646', SP11 = '5511987654321';
function resolver(m: any, msg: string, phone: string, slots: any = {}, inb: string[] = []) {
  return m.resolverModalidadeLogistica({
    mensagemAtual: msg, inboundsPedido: inb.map((t) => ({ message_text: t })),
    historicoInbound: [], slots, phone, freteJa: null, produtoContexto: 'dtf_textil',
  });
}

type Caso = { cat: string; msg: string; phone?: string; regra: string };
const casos: Caso[] = [
  // 1. envio explicito (reais) — nao pode DEIXAR de ser reconhecido
  { cat: '1_envio', msg: 'Sedex', regra: 'igual_baseline_e_envio' },
  { cat: '1_envio', msg: 'Pelos correios', regra: 'igual_baseline_e_envio' },
  { cat: '1_envio', msg: 'qual o valor final com sedex?', regra: 'igual_baseline_e_envio' },
  { cat: '1_envio', msg: 'pode enviar', regra: 'igual_baseline_e_envio' },
  { cat: '1_envio', msg: 'manda por Sedex', regra: 'igual_baseline_e_envio' },
  { cat: '1_envio', msg: 'prefiro que entregue no meu endereço', regra: 'igual_baseline_e_envio' },
  // 2. retirada/motoboy explicita (reais)
  { cat: '2_retirada', msg: 'Vou fazer a retirada', regra: 'igual_baseline_e_retirada' },
  { cat: '2_retirada', msg: 'vou retirar aí', regra: 'igual_baseline_e_retirada' },
  { cat: '2_retirada', msg: 'O motoboy já esta a caminho 6 min ok', regra: 'igual_baseline_e_motoboy' },
  { cat: '2_retirada', msg: 'vou buscar aí na loja', regra: 'igual_baseline_e_retirada' },
  // 3. cortesia generica (reais) — nao pode virar modalidade nem liberar CEP
  { cat: '3_cortesia', msg: 'Obrigada', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'Ok', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'beleza', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'certo', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'entendi', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'Pode ser', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: '\u{1F44D}', regra: 'desconhecida_sem_cep' },
  { cat: '3_cortesia', msg: 'Não precisa\nObrigada', regra: 'desconhecida_sem_cep' },
  // 4. modalidade indefinida (pergunta neutra)
  { cat: '4_indefinida', msg: 'Qual o prazo de produção?', regra: 'desconhecida_sem_cep' },
  { cat: '4_indefinida', msg: 'Tenho 10 imagens, me passa o orçamento?', regra: 'desconhecida_sem_cep' },
];

const falhas: string[] = [];
const linhas: any[] = [];
for (const c of casos) {
  const ph = c.phone || RIO;
  const b = resolver(base, c.msg, ph);
  const k = resolver(cand, c.msg, ph);
  const mesmoReconhecimento = b.modalidade === k.modalidade && b.fonte_nivel === k.fonte_nivel;
  let pass = true; let motivo = '';
  if (c.regra.startsWith('igual_baseline')) {
    const esperada = c.regra.split('_e_')[1];
    pass = mesmoReconhecimento && k.modalidade === esperada;
    if (!mesmoReconhecimento) motivo = 'reconhecimento divergiu do baseline';
    else if (k.modalidade !== esperada) motivo = `esperava ${esperada}, veio ${k.modalidade} (baseline igual: ${b.modalidade})`;
  } else if (c.regra === 'desconhecida_sem_cep') {
    pass = k.modalidade === 'desconhecida' && k.bloqueia_frete === true && k.pedir_cep === false
      && b.modalidade === 'desconhecida';
    if (!pass) motivo = `cand={mod:${k.modalidade},bloq:${k.bloqueia_frete},cep:${k.pedir_cep}} base={mod:${b.modalidade}}`;
  }
  linhas.push({ cat: c.cat, msg: c.msg.slice(0, 42), base: `${b.modalidade}/n${b.fonte_nivel}/bloq=${b.bloqueia_frete}/cep=${b.pedir_cep}`, cand: `${k.modalidade}/n${k.fonte_nivel}/bloq=${k.bloqueia_frete}/cep=${k.pedir_cep}`, pass });
  if (!pass) falhas.push(`${c.cat} [${c.msg.slice(0, 40)}]: ${motivo}`);
}

// 5. CEP solicitado corretamente (envio declarado, sem CEP) — fluxo tem de continuar pedindo
{
  const k = resolver(cand, 'pode enviar pelos correios', RIO);
  const bloco = cand.blocoCepCanonico(k);
  const ok = k.modalidade === 'envio' && k.pedir_cep === true && /CEP AUSENTE/i.test(bloco);
  linhas.push({ cat: '5_cep_correto', msg: 'pode enviar pelos correios (sem CEP)', base: '(fluxo)', cand: `envio pedir_cep=${k.pedir_cep} blocoCEP=${/CEP AUSENTE/i.test(bloco)}`, pass: ok });
  if (!ok) falhas.push('5_cep_correto: pedido legitimo de CEP deixou de existir');
}
// 6. fechamento que ja funcionava: envio + CEP no texto -> frete liberado com CEP conhecido
{
  const b = resolver(base, 'pode enviar, meu cep é 20040-002', RIO);
  const k = resolver(cand, 'pode enviar, meu cep é 20040-002', RIO);
  const ok = k.modalidade === 'envio' && k.bloqueia_frete === false && k.cep_conhecido === '20040002'
    && b.bloqueia_frete === false && b.cep_conhecido === '20040002';
  linhas.push({ cat: '6_fechamento', msg: 'pode enviar + CEP no texto', base: `bloq=${b.bloqueia_frete} cep=${b.cep_conhecido}`, cand: `bloq=${k.bloqueia_frete} cep=${k.cep_conhecido}`, pass: ok });
  if (!ok) falhas.push('6_fechamento: envio+CEP legitimo mudou de comportamento');
}
// 6b. Grande SP desconhecida: comportamento tem de ser IDENTICO ao baseline (ja bloqueava)
{
  const b = resolver(base, 'Obrigada', SP11);
  const k = resolver(cand, 'Obrigada', SP11);
  const ok = b.bloqueia_frete === true && k.bloqueia_frete === true && b.modalidade === k.modalidade;
  linhas.push({ cat: '6_grande_sp', msg: 'Obrigada (DDD 11)', base: `bloq=${b.bloqueia_frete}`, cand: `bloq=${k.bloqueia_frete}`, pass: ok });
  if (!ok) falhas.push('6_grande_sp: comportamento da Grande SP mudou');
}

// GUARDA DE SAIDA (so candidato): textos finais contra estado 'desconhecida'
const eDesc = resolver(cand, 'Obrigada', RIO, { produto: 'dtf_textil' });
const eEnvio = resolver(cand, 'pode enviar', RIO);
const gTests = [
  { nome: 'texto_defeituoso_real', txt: 'Perfeito, então é envio. Me passa o CEP de 8 dígitos para a gente calcular o frete.', e: eDesc, esperaBloqueio: true },
  { nome: 'afirmacao_retirada', txt: 'Perfeito, então é retirada.', e: eDesc, esperaBloqueio: true },
  { nome: 'pergunta_com_escolha_e_preco', txt: 'Seu orçamento fica em R$ 213,24 pelos 3,56 metros. Como vai ser a entrega, retirada aqui em Embu ou envio pelos Correios?', e: eDesc, esperaBloqueio: false },
  { nome: 'pix_ou_cartao', txt: 'Pix ou cartão?', e: eDesc, esperaBloqueio: false },
  { nome: 'resposta_generica_preco', txt: 'O metro do DTF sai R$ 59,90. Me fala o tamanho das artes que eu calculo.', e: eDesc, esperaBloqueio: false },
  { nome: 'cep_com_envio_declarado', txt: 'Me passa o CEP de 8 dígitos para calcular o frete.', e: eEnvio, esperaBloqueio: false },
  { nome: 'substituta_nao_se_bloqueia', txt: 'Só me confirma a forma de entrega: retirada aqui em Embu das Artes ou envio pelos Correios?', e: eDesc, esperaBloqueio: false },
];
for (const g of gTests) {
  const r = cand.guardaTextoModalidadeSemEvidencia(g.txt, g.e);
  const ok = r.bloqueia === g.esperaBloqueio;
  linhas.push({ cat: 'guarda_saida', msg: g.nome, base: '(n/a)', cand: `bloqueia=${r.bloqueia}${r.gatilho ? ' (' + r.gatilho + ')' : ''}`, pass: ok });
  if (!ok) falhas.push(`guarda_saida ${g.nome}: bloqueia=${r.bloqueia}, esperado ${g.esperaBloqueio}`);
}

console.table(linhas);
console.log(falhas.length === 0 ? '\nCONTROLES = PASS (0 falhas em ' + linhas.length + ' casos)' : '\nCONTROLES = FAIL\n' + falhas.join('\n'));
process.exit(falhas.length === 0 ? 0 : 1);
