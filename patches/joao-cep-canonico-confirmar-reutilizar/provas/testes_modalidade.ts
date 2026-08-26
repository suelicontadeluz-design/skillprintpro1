import * as fs from 'node:fs';
import { resolver, simularLacoDeTools, simularValidacaoDeSaida, simularFallbackTerminal,
         blocoModalidadeLogistica, classificarDeclaracaoLogistica, RX_SAIDA_TERMO_FRETE,
         ERROS, resetErros } from './harness_modalidade.js';

const CAND = fs.readFileSync(new URL('../candidato435.ts', import.meta.url), 'utf8');
const BASE = fs.readFileSync(new URL('../base.ts', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const linhas: string[] = [];
function check(n: string, cond: boolean, detalhe = '') {
  if (cond) { pass++; linhas.push(`  PASS  ${n}`); }
  else { fail++; linhas.push(`  FAIL  ${n}\n          ${detalhe}`); }
}
const semCep = (t: string) => !/\bcep\b/i.test(t);
const semCorreios = (t: string) => !/\b(pac|sedex|correios?)\b/i.test(t);

// Falas REAIS do caso organico 5511952315439 (Carolina), copiadas de fact_conversations.
const CAROLINA_TURNO = 'A quantidade é 14\n\nForma de retirada : retirada presencial';
const CAROLINA_RESPOSTA_DEFEITO = 'Preciso do seu CEP para gerar a cobrança correta, mesmo sendo retirada.';
const CAROLINA_OFERTA_DEFEITO = 'Tá bem, mas você quer mesmo retirar aqui ou quer envio? Vi que o Sedex sai por R$11,93 ou PAC por R$18,54.';
const CAROLINA_HISTORICO = [
  { message_text: 'Obrigada' },
  { message_text: 'Ele está na porta' },
  { message_text: 'Conseguimos retirar ainda hoje ?' },
  { message_text: 'Meu pedido está pronto para retirada?' },
  { message_text: 'A retirada vai ser amanhã, tudo bem?' },
];

async function run() {
console.log('\n============ TESTES OBRIGATORIOS v4.34.0 — MODALIDADE LOGISTICA ============\n');

// ── T1 — REPLAY CAROLINA ───────────────────────────────────────────────────
resetErros();
{
  const e = resolver({ phone: '5511952315439', mensagem: CAROLINA_TURNO,
    inboundsPedido: [{ message_text: 'Retirar' }, { message_text: 'Cartão' }],
    produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '05893000' } }]);
  const val = await simularValidacaoDeSaida(e, CAROLINA_RESPOSTA_DEFEITO);
  const val2 = await simularValidacaoDeSaida(e, CAROLINA_OFERTA_DEFEITO);
  check('T1.a modalidade = retirada', e.modalidade === 'retirada', JSON.stringify(e));
  check('T1.b proveniencia = declaracao_explicita_no_turno', e.proveniencia === 'declaracao_explicita_no_turno', e.proveniencia);
  check('T1.c pedir_cep = false', e.pedir_cep === false, String(e.pedir_cep));
  check('T1.d calcular_frete NAO executado', laco.executadas.length === 0 && laco.toolsUsadas.includes('calcular_frete_bloqueado'), JSON.stringify(laco));
  check('T1.e evento de bloqueio registrado', ERROS.some(x => x.msg === 'guardrail_frete_bloqueado_modalidade'), '');
  check('T1.f resposta final sem pedido de CEP', semCep(val.resposta), val.resposta);
  check('T1.g resposta final sem PAC/Sedex', semCorreios(val2.resposta) && semCep(val2.resposta), val2.resposta);
  check('T1.h bloco de prompt proibe CEP e frete',
    /PROIBIDO pedir CEP/.test(blocoModalidadeLogistica(e)) && /PROIBIDO calcular frete/.test(blocoModalidadeLogistica(e)), '');
}

// ── T2 — HISTORICO DE MOTOBOY, MODALIDADE NAO INFORMADA NO PEDIDO ──────────
{
  const e = resolver({ phone: '5511952315439', mensagem: 'Vamos seguir com a proposta',
    inboundsPedido: [{ message_text: 'Bom dia, tudo bem?' }],
    historicoInbound: [{ message_text: 'Mando o motoboy buscar como sempre' }, ...CAROLINA_HISTORICO],
    produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '05893000' } }]);
  const bloco = blocoModalidadeLogistica(e);
  check('T2.a modalidade = motoboy vinda do historico', e.modalidade === 'motoboy' && e.fonte_nivel === 3, JSON.stringify(e));
  check('T2.b marcada para CONFIRMAR com o cliente', e.confirmar_com_cliente === true, '');
  check('T2.c pedir_cep = false', e.pedir_cep === false, '');
  check('T2.d calcular_frete NAO executado', laco.executadas.length === 0, JSON.stringify(laco));
  check('T2.e bloco pede confirmacao "como das outras vezes"', /como das outras vezes/.test(bloco), bloco);
  check('T2.f bloco diz que fala nova do cliente vence o historico', /vale mais que o hist/.test(bloco), bloco);
}

// ── T3 — DDD 11, CLIENTE NOVO, LOGISTICA DESCONHECIDA ─────────────────────
{
  const e = resolver({ phone: '5511987654321', mensagem: 'Quero 10 metros de DTF têxtil', produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '01001000' } }]);
  const bloco = blocoModalidadeLogistica(e);
  check('T3.a modalidade = desconhecida', e.modalidade === 'desconhecida', JSON.stringify(e));
  check('T3.b retirada plausivel (Grande SP)', e.retirada_plausivel === true, '');
  check('T3.c pedir_cep = false antes de resolver', e.pedir_cep === false, '');
  check('T3.d bloco faz UMA pergunta retirada-ou-envio', /retirada aqui em Embu ou envio/.test(bloco), bloco);
  check('T3.e frete bloqueado antes de resolver', laco.executadas.length === 0, JSON.stringify(laco));
}

// ── T4 — OUTRO ESTADO, LOGISTICA DESCONHECIDA ─────────────────────────────
{
  const e = resolver({ phone: '5531988887777', mensagem: 'Quero 10 metros de DTF têxtil', produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '30140071' } }]);
  const bloco = blocoModalidadeLogistica(e);
  check('T4.a modalidade = desconhecida', e.modalidade === 'desconhecida', JSON.stringify(e));
  check('T4.b retirada NAO plausivel fora da Grande SP', e.retirada_plausivel === false, '');
  check('T4.c pedir_cep = true (so quando necessario)', e.pedir_cep === true, '');
  check('T4.d calcular_frete permitido', laco.executadas.includes('calcular_frete'), JSON.stringify(laco));
  check('T4.e bloco conduz a envio SEM afirmar como fato', /prov[aá]vel/.test(bloco) && /pista, n[aã]o fato/.test(bloco), bloco);
}

// ── T5 — ENVIO EXPLICITO + CEP JA DISPONIVEL ──────────────────────────────
{
  const e = resolver({ phone: '5531988887777', mensagem: 'Pode mandar pelos Correios',
    slots: { cep: '30140071' }, produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '30140071' } }]);
  const bloco = blocoModalidadeLogistica(e);
  check('T5.a modalidade = envio', e.modalidade === 'envio', JSON.stringify(e));
  check('T5.b CEP conhecido reaproveitado (fonte estado_confirmado)', e.cep_conhecido === '30140071' && e.cep_fonte === 'estado_confirmado', JSON.stringify(e));
  check('T5.c pedir_cep = false (nao repergunta)', e.pedir_cep === false, '');
  check('T5.d calcular_frete liberado', laco.executadas.includes('calcular_frete'), '');
  check('T5.e bloco manda NAO pedir o CEP de novo', /N[ÃA]O pe[çc]a de novo/.test(bloco), bloco);
}

// ── T6 — RETIRADA EXPLICITA + CEP PRESENTE NO HISTORICO ───────────────────
{
  const e = resolver({ phone: '5511952315439', mensagem: 'Vamos retirar',
    historicoInbound: [{ message_text: '05893-000' }, ...CAROLINA_HISTORICO],
    produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '05893000' } }]);
  const bloco = blocoModalidadeLogistica(e);
  check('T6.a modalidade = retirada', e.modalidade === 'retirada', JSON.stringify(e));
  check('T6.b CEP conhecido NAO altera a modalidade', e.cep_conhecido === '05893000' && e.bloqueia_frete === true, JSON.stringify(e));
  check('T6.c calcular_frete NAO executado mesmo com CEP', laco.executadas.length === 0, JSON.stringify(laco));
  check('T6.d bloco diz que o CEP nao e usado nesta modalidade', /n[aã]o é usado para nada|n[ÃA]O muda nada aqui/.test(bloco), bloco);
}

// ── T7 — RETIRADA E DEPOIS MUDANCA EXPLICITA PARA ENVIO ───────────────────
{
  const e = resolver({ phone: '5511952315439', mensagem: 'Mudei de ideia, prefiro que vocês enviem pelos Correios',
    inboundsPedido: [{ message_text: 'Forma de retirada : retirada presencial' }],
    slots: { modalidade_logistica: 'retirada', cep: '05893000' },
    historicoInbound: CAROLINA_HISTORICO, produtoContexto: 'dtf_textil' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '05893000' } }]);
  check('T7.a fala MAIS RECENTE vence: modalidade = envio', e.modalidade === 'envio' && e.fonte_nivel === 1, JSON.stringify(e));
  check('T7.b CEP conhecido reutilizado, sem reperguntar', e.cep_conhecido === '05893000' && e.pedir_cep === false, JSON.stringify(e));
  check('T7.c calcular_frete LIBERADO', laco.executadas.includes('calcular_frete'), JSON.stringify(laco));
  check('T7.d nenhum bloqueio registrado', e.bloqueia_frete === false, '');
}

// ── T8 — PRODUTO DIGITAL ──────────────────────────────────────────────────
{
  const e = resolver({ phone: '5531988887777', mensagem: 'Quero o pack de animes', produtoContexto: 'pack' });
  const laco = await simularLacoDeTools(e, [{ name: 'calcular_frete', input: { cep_destino: '30140071' } }]);
  const bloco = blocoModalidadeLogistica(e);
  const val = await simularValidacaoDeSaida(e, 'Me passa seu CEP que eu calculo o frete do pack.');
  check('T8.a produto_digital reconhecido', e.produto_digital === true, JSON.stringify(e));
  check('T8.b frete bloqueado', e.bloqueia_frete === true && laco.executadas.length === 0, JSON.stringify(laco));
  check('T8.c pedir_cep = false', e.pedir_cep === false, '');
  check('T8.d bloco declara entrega por link, sem CEP e sem frete',
    /PRODUTO DIGITAL/.test(bloco) && /N[ÃA]O existe CEP/.test(bloco), bloco);
  check('T8.e resposta final sem CEP e sem frete de Correios', semCep(val.resposta) && semCorreios(val.resposta), val.resposta);
}

// ── T9 — REGRESSOES FINANCEIRAS (invariantes de codigo) ───────────────────
{
  const ancorasFinanceiras = [
    "async function emitirAutorizacao(",
    "p_lead_id: leadId, p_kind: kind, p_amount: amount, p_source_tool: sourceTool,",
    "if (name === 'gerar_pix') {",
    "if (name === 'compor_total') {",
    "const { data, error } = await sb.rpc('fn_compor_total', { p_lead_id: ctx.leadId, p_operation_ids: ids, p_ttl_minutos: 30 });",
    "erro: 'operation_id_inventado',",
    "erro: 'valor_livre_recusado', acao: 'O valor nunca vem de voce. Use somente o operation_id.'",
    "const PIX_CHAVE_DESATIVADA = '30248650000111';",
    "async function guardaEgressoFinanceiro(",
    "const escolhida = lista.find((a: any) => a.kind === 'total')",
    "guardrail_valor_diverge_cobranca_pendente",
    "codigo_pix_reenviado_da_cobranca_pendente",
    "AUTORIZA\\u00c7\\u00d5ES ATIVAS deste cliente:",
    "function checkoutMercadoPago(",
    "await sb.rpc('fn_valor_e_legitimo'",
    "orcamento_calcme_entrada",
    "RX_HOLD_ARTE_PAGAMENTO",
    "guardrail_dtf_metro_redirecionado",
    "async function blocoArquivosDoLead(",
  ];
  const faltando = ancorasFinanceiras.filter(a => !CAND.includes(a));
  check('T9.a todas as ancoras financeiras/Pix/arquivos presentes no candidato',
    faltando.length === 0, 'faltando: ' + JSON.stringify(faltando));
  const contagemIgual = ancorasFinanceiras.every(a =>
    CAND.split(a).length === BASE.split(a).length);
  check('T9.b contagem de cada ancora IDENTICA a LIVE', contagemIgual, '');
  // A guarda de frete nao pode nascer autorizacao: se calcular_frete e bloqueada, nao ha
  // emitirAutorizacao(...,'frete',...) naquele turno.
  check('T9.c bloqueio de frete acontece ANTES de executarTool',
    CAND.indexOf("erro: 'frete_incompativel_com_modalidade'") <
    CAND.indexOf("const out = await executarTool(toolEfetiva, inputEfetivo, ctx);"), '');
  check('T9.d emitirAutorizacao de frete continua unica e intocada',
    CAND.split("'calcular_frete', { servico: melhor.servico, cep }").length === 2, '');
}

// ── T10 — PERGUNTA REPETIDA / SLOT JA RESPONDIDO ──────────────────────────
{
  const eRet = resolver({ phone: '5511952315439', mensagem: 'Vamos retirar', produtoContexto: 'dtf_textil' });
  const t1 = simularFallbackTerminal(eRet, { quantidade: '14', arte: '1 metro', produto: 'dtf_textil' });
  const eEnv = resolver({ phone: '5531988887777', mensagem: 'Manda pelos Correios', slots: { cep: '30140071' }, produtoContexto: 'dtf_textil' });
  const t2 = simularFallbackTerminal(eEnv, { quantidade: '14', arte: '1 metro', cep: '30140071' });
  const eDesc = resolver({ phone: '5511987654321', mensagem: 'Quanto fica?', produtoContexto: 'dtf_textil' });
  const t3 = simularFallbackTerminal(eDesc, {});
  check('T10.a retirada com tudo respondido: nao cita CEP nem forma de entrega',
    semCep(t1) && !/retirada ou envio/i.test(t1), t1);
  check('T10.b retirada com tudo respondido: pergunta so o pagamento', /Pix ou cart/i.test(t1), t1);
  check('T10.c envio com CEP conhecido: nao repergunta CEP', semCep(t2), t2);
  check('T10.d desconhecida sem dados: pergunta quantidade, medida e forma de entrega',
    /quantidade/.test(t3) && /medida/.test(t3) && /retirada ou envio/.test(t3) && semCep(t3), t3);
  check('T10.e a lista FIXA da v4.33.0 sumiu do candidato',
    !CAND.includes('Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?')
    && BASE.includes('Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?'), '');
}

// ── INVARIANTES ESTRUTURAIS: os tres sitios de aplicacao existem no candidato ──
{
  check('E1 interceptacao de calcular_frete no laco de tools',
    CAND.includes("if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {"), '');
  check('E2 registro de enforcement (nao shadow)',
    CAND.includes('permitida: false, motivo: estadoLog.motivo_bloqueio,')
    && CAND.includes('executada: false, enforcement_ativo: true,'), '');
  check('E3 validacao de saida ligada ao estado canonico',
    CAND.includes("if (decisao.responde === true && estadoLog.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(resposta)) {"), '');
  check('E4 bloco de modalidade injetado no systemFinal',
    CAND.includes('+ blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) +'), '');
  check('E5 fallback terminal usa perguntaDoQueFaltaFechamento',
    CAND.includes('resposta = perguntaDoQueFaltaFechamento(estadoLog,'), '');
  check('E6 retry de PAC/Sedex desligado sob bloqueio',
    CAND.includes("decisao.responde === true && !estadoLog.bloqueia_frete && toolsUsadas.includes('calcular_frete')"), '');
  check('E7 "Anotei seu CEP" so fora de bloqueio',
    CAND.includes('else if (ehCep && !estadoLog.bloqueia_frete)'), '');
  check('E8 modalidade explicita persistida nos slots',
    CAND.includes('slotsNovos.modalidade_logistica = estadoLog.modalidade;'), '');
  // Comparacao pela LINHA EXATA do prompt vivo, nao pelo texto solto: o cabecalho do
  // candidato CITA as duas frases antigas para documentar o que foi removido.
  const LINHA_DDD_ANTIGA = 'ASSUMA ENVIO: pe\\u00e7a o CEP completo, 8 d\\u00edgitos.';
  const LINHA_SLOTS_ANTIGA = 'SLOTS: produto -> arte -> quantidade -> envio/retirada + CEP -> or\\u00e7amento';
  check('E9 DDD deixou de mandar "ASSUMA ENVIO" no prompt',
    !CAND.includes(LINHA_DDD_ANTIGA) && BASE.includes(LINHA_DDD_ANTIGA), '');
  check('E10 SLOTS nao tem mais "envio/retirada + CEP" como slot unico',
    !CAND.includes(LINHA_SLOTS_ANTIGA) && BASE.includes(LINHA_SLOTS_ANTIGA), '');
  check('E11 FECHAMENTO nao comeca mais em "CEP -> calcular_frete"',
    !CAND.includes('2. CEP -> calcular_frete -> TOTAL = produto + frete.')
    && BASE.includes('2. CEP -> calcular_frete -> TOTAL = produto + frete.'), '');
  // A versao logica avanca a cada frente; o que esta suite garante e que a v4.34.0 nao
  // regrediu, nao que o numero congelou. Confere a versao vigente do candidato.
  check('E12 versao logica avancou sem perder a v4.34.0',
    /const V = 'agente-noturno-v4\.(3[5-9]|[4-9]\d)/.test(CAND), '');
}

// ── REFUTACAO: as mesmas entradas nao sao aceitas por engano ──────────────
{
  check('R1 "nao vou retirar, prefiro envio" => envio',
    classificarDeclaracaoLogistica('Não vou retirar, prefiro envio').modalidade === 'envio', '');
  check('R2 "Forma de retirada: envio pelos Correios" => envio (rotulo nao conta)',
    classificarDeclaracaoLogistica('Forma de retirada: envio pelos Correios').modalidade === 'envio', '');
  check('R3 "retirada sem frete" => retirada',
    classificarDeclaracaoLogistica('Vou fazer retirada, sem frete').modalidade === 'retirada', '');
  check('R4 CEP puro NAO declara modalidade',
    classificarDeclaracaoLogistica('05893-000').modalidade === null, '');
  check('R5 "quero retirar ou receber, tanto faz" => ambiguo, nao decide',
    classificarDeclaracaoLogistica('Posso retirar ou vocês enviam?').modalidade === null, '');
  check('R6 texto sem sinal nao inventa modalidade',
    classificarDeclaracaoLogistica('Quanto fica 14 metros?').modalidade === null, '');
  const eR = resolver({ phone: '5511952315439', mensagem: 'Vamos retirar', produtoContexto: 'dtf_textil' });
  const v = await simularValidacaoDeSaida(eR,
    'O total dos 14 metros fica R$698,60. Me passa o CEP que eu vejo o Sedex.');
  check('R7 cirurgia preserva o valor do produto e corta a frase do CEP',
    /R\$698,60/.test(v.resposta) && semCep(v.resposta) && semCorreios(v.resposta), v.resposta);
  check('R8 desfecho registrado', ['preservado_cirurgia','substituido_deterministico','aceito'].includes(v.desfecho), v.desfecho);
  // Retry do modelo que APAGA o valor do produto: tem de ser RECUSADO (invariante v4.21.6).
  const v2 = await simularValidacaoDeSaida(eR,
    'O total dos 14 metros fica R$698,60. Me passa o CEP que eu vejo o Sedex.',
    () => ({ responde: true, mensagem: 'Perfeito, vou calcular o valor e te falo.' }));
  check('R9 retry que apaga R$698,60 e RECUSADO', /R\$698,60/.test(v2.resposta), v2.resposta);
  // Retry valido que preserva o valor: ACEITO.
  const v3 = await simularValidacaoDeSaida(eR,
    'O total dos 14 metros fica R$698,60. Me passa o CEP que eu vejo o Sedex.',
    () => ({ responde: true, mensagem: 'Fechou: 14 metros por R$698,60, retirada aqui em Embu, sem frete. Pix ou cartao?' }));
  check('R10 retry valido que preserva o valor e ACEITO',
    v3.desfecho === 'aceito' && /R\$698,60/.test(v3.resposta) && semCep(v3.resposta), JSON.stringify(v3));
}

  console.log(linhas.join('\n'));
  console.log(`\n  >>> ${pass} PASS / ${fail} FAIL\n`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
