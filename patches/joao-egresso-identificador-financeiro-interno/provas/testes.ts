import { simularTransporte, simularGuardaUrl, validarPix, calcPrometeuPix,
         RX_HOLD_ARTE_PAGAMENTO, idsInternosNoTexto, ERROS, resetErros, setLeituraFalha } from './harness.js';

const OP_25_08 = '02d22212-8e17-4dfb-9fa4-1c184b7ac1b9';   // produto 101.18 (caso real)
const OP_04_08 = '5d357026-77e7-4066-ba76-9d9a57813383';   // pedido_total 64.52 (caso real)
const OP_08_08 = 'eef34589-e6b7-4f02-8cf8-fea17eba3809';   // pedido_total 41.83 (caso real)
const OP_23_08 = '28a00b98-52ef-4213-92b7-98efbbfbd895';   // produto 233.61 (caso real)
// Chave Pix aleatoria LEGITIMA: formato UUID, NAO existe em operacoes_financeiras.
const CHAVE_ALEATORIA = '7b3e91d4-2c8f-4a15-9e6b-0d5a8c7f3e21';
const QR_OFICIAL = '00020126580014BR.GOV.BCB.PIX0136' + CHAVE_ALEATORIA + '52040000530398654041.005802BR5913SKILLPRINT LT6009SAO PAULO62070503***6304AB12';
const QR_PENDENTE = '00020126580014BR.GOV.BCB.PIX0136aa11bb22-cc33-4d44-8e55-66f7788990aa5204000053039865406101.185802BR5913SKILLPRINT LT6009SAO PAULO62070503***6304CD34';

let pass = 0, fail = 0;
const linhas: string[] = [];
function check(n: string, cond: boolean, detalhe = '') {
  if (cond) { pass++; linhas.push(`  PASS  ${n}`); }
  else { fail++; linhas.push(`  FAIL  ${n}   ${detalhe}`); }
}
const contem = (t: string, id: string) => t.toLowerCase().includes(id.toLowerCase());

async function run() {
console.log('\n================ TESTES OBRIGATORIOS v4.33.0 ================\n');

// 1 — "Segue o Pix: <operation_id>"  => BLOQUEADO  (reproduz o caso de 25/08 literalmente)
resetErros();
let r = await simularTransporte({ resposta: `Perfeito! Segue o Pix:\n\n${OP_25_08}` });
check('1. "Segue o Pix: <operation_id>" BLOQUEADO',
  r.bloqueou && !contem(r.textoEnviado, OP_25_08) && r.codigoPixEnviado === ''
  && ERROS.some(e => e.msg === 'guardrail_identificador_financeiro_interno'),
  JSON.stringify(r));

// 2 — operation_id puro, sem frase  => BLOQUEADO  (reproduz 23/08)
r = await simularTransporte({ resposta: `Rafaela, o total é *R$ 233,61*. Cartão certo?\n\n${OP_23_08}` });
check('2. operation_id puro na mensagem BLOQUEADO',
  r.bloqueou && !contem(r.textoEnviado, OP_23_08), JSON.stringify(r));

// 3 — URL inventada carregando operation_id  => BLOQUEADA  (reproduz 08/08)
r = await simularTransporte({ resposta: `Link do cartão: https://pay.smartpag.com.br/${OP_08_08}\n\nClica no link e finaliza.` });
const url3 = simularGuardaUrl(`Link do cartão: https://pay.smartpag.com.br/${OP_08_08}`, null, true);
check('3. URL inventada com operation_id BLOQUEADA',
  r.bloqueou && !contem(r.textoEnviado, OP_08_08) && !/smartpag/i.test(r.textoEnviado)
  && !contem(url3, OP_08_08), JSON.stringify(r) + ' | url=' + url3);

// 4 — operation_id dentro de markdown / code block  => BLOQUEADO  (reproduz 04/08)
r = await simularTransporte({ resposta: `Seu total é R$ 64,52. Pix ou cartão?\n\n\`\`\`\n${OP_04_08}\n\`\`\`` });
check('4. operation_id em markdown/code block BLOQUEADO',
  r.bloqueou && !contem(r.textoEnviado, OP_04_08), JSON.stringify(r));

// 5 — QR oficial 000201... contendo chave UUID legitima  => PERMITIDO INTACTO
r = await simularTransporte({
  resposta: `Perfeito! Segue seu Pix abaixo.\n${QR_OFICIAL}`,
  pixGerado: { ok: true, qr_code: QR_OFICIAL, payment_id: '123', operation_id: OP_25_08 } });
check('5. QR oficial 000201 com chave UUID legitima PERMITIDO INTACTO',
  !r.bloqueou && r.codigoPixEnviado === QR_OFICIAL && contem(r.codigoPixEnviado, CHAVE_ALEATORIA),
  JSON.stringify({ b: r.bloqueou, igual: r.codigoPixEnviado === QR_OFICIAL }));

// 6 — Pix recem-criado  => codigo sai EXCLUSIVAMENTE de ctx.pixGerado.qr_code
r = await simularTransporte({
  resposta: 'Perfeito! Segue seu Pix copia e cola logo abaixo.',
  pixGerado: { ok: true, qr_code: QR_OFICIAL, payment_id: '123', operation_id: OP_25_08 } });
check('6. Pix recem-criado: codigo vem so de ctx.pixGerado.qr_code',
  r.codigoPixEnviado === QR_OFICIAL && !r.bloqueou, JSON.stringify(r).slice(0, 200));

// 7 — Pix pendente real  => codigo sai EXCLUSIVAMENTE de mp_pix_cobrancas.qr_code
r = await simularTransporte({
  resposta: 'Segue o Pix que já tinha sido gerado, viu?',
  cobrancaPendente: { qr_code: QR_PENDENTE, payment_id: '999', valor: 101.18 } });
check('7. Pix pendente: codigo vem so de mp_pix_cobrancas.qr_code',
  r.codigoPixEnviado === QR_PENDENTE && !r.bloqueou, JSON.stringify(r).slice(0, 200));

// 8 — gerar_pix falha  => nada de Pix/UUID/link improvisado
r = await simularTransporte({ resposta: `Segue o Pix: ${OP_25_08}\nOu use a chave 30248650000111.` });
check('8. gerar_pix falha: nenhum Pix/UUID/link improvisado sai',
  r.codigoPixEnviado === '' && !contem(r.textoEnviado, OP_25_08)
  && !r.textoEnviado.includes('30248650000111') && !/https?:\/\//.test(r.textoEnviado),
  JSON.stringify(r));
check('8b. validarPix agora recusa a chave manual desativada',
  validarPix('Use a chave 30248650000111') === false && validarPix('Total R$ 101,18. Pix ou cartao?') === true);

// 9 — Cartao oficial Mercado Pago  => continua funcionando
const OFICIAL = 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=abc123';
const r9 = simularGuardaUrl(`Segue o link: ${OFICIAL}`, OFICIAL, true);
const r9b = simularGuardaUrl(`Link: ${OFICIAL}`, OFICIAL, false);
const r9c = await simularTransporte({ resposta: `Segue o link oficial do Mercado Pago:\n\n${OFICIAL}`, prometeuCartao: true });
check('9. Cartao oficial Mercado Pago continua funcionando',
  r9.includes(OFICIAL) && r9b.includes(OFICIAL) && r9c.textoEnviado.includes(OFICIAL) && !r9c.bloqueou,
  JSON.stringify({ r9, r9b, r9c: r9c.textoEnviado }));

// 10 — Cliente aguarda arte antes de pagar  => nao gera cobranca naquele turno
const FRASE_ARTE = 'Ok fico no aguardo da art para finalização e pagamento';
const r10 = await simularTransporte({
  resposta: `Perfeito! Segue o Pix:\n\n${OP_25_08}`, holdArte: RX_HOLD_ARTE_PAGAMENTO.test(FRASE_ARTE) });
check('10. Cliente aguarda arte: nao cobra naquele turno',
  RX_HOLD_ARTE_PAGAMENTO.test(FRASE_ARTE) && r10.codigoPixEnviado === ''
  && !contem(r10.textoEnviado, OP_25_08) && /aprovar/i.test(r10.textoEnviado), JSON.stringify(r10));
check('10b. variantes de hold reconhecidas', [
  'aguardo a arte para pagar',
  'quando aprovar a arte eu pago',
  'me manda o layout antes do pagamento',
  'assim que eu ver a arte eu fecho',
].every(f => RX_HOLD_ARTE_PAGAMENTO.test(f)));

// 11 — Cliente pronto para pagar, sem hold  => fluxo normal ainda gera Pix
const SEM_HOLD = ['Pix', 'pode mandar o pix', 'quero pagar agora', 'manda o pix por favor',
                  'vou querer 70 xicaras', 'fechado, pode gerar'];
const r11 = await simularTransporte({
  resposta: 'Perfeito! Segue seu Pix copia e cola logo abaixo.',
  holdArte: SEM_HOLD.some(f => RX_HOLD_ARTE_PAGAMENTO.test(f)),
  pixGerado: { ok: true, qr_code: QR_OFICIAL, payment_id: '123', operation_id: OP_25_08 } });
check('11. Sem hold de arte: fluxo normal ainda gera e envia Pix',
  !SEM_HOLD.some(f => RX_HOLD_ARTE_PAGAMENTO.test(f)) && r11.codigoPixEnviado === QR_OFICIAL,
  JSON.stringify({ holds: SEM_HOLD.filter(f => RX_HOLD_ARTE_PAGAMENTO.test(f)), cod: r11.codigoPixEnviado.slice(0, 20) }));

// 12 — UUID nao-financeiro que NAO e id interno => NAO bloqueado so por ser UUID
const r12 = await simularTransporte({ resposta: `Seu protocolo de atendimento é ${CHAVE_ALEATORIA}, guarde aí.` });
const r12b = await simularTransporte({ resposta: `A chave Pix aleatória da loja é ${CHAVE_ALEATORIA}` });
check('12. UUID legitimo (nao interno) NAO e bloqueado so por ser UUID',
  !r12.bloqueou && contem(r12.textoEnviado, CHAVE_ALEATORIA)
  && !r12b.bloqueou && contem(r12b.textoEnviado, CHAVE_ALEATORIA),
  JSON.stringify({ r12: r12.bloqueou, r12b: r12b.bloqueou }));

console.log(linhas.join('\n'));
console.log('\n================ REFUTACAO (caminhos alternativos) ================\n');
const ref: string[] = []; let rp = 0, rf = 0;
async function rcheck(n: string, cond: boolean, d = '') { if (cond) { rp++; ref.push(`  PASS  ${n}`); } else { rf++; ref.push(`  FAIL  ${n}  ${d}`); } }

// R1 — id interno em MAIUSCULAS
let x = await simularTransporte({ resposta: `Segue: ${OP_25_08.toUpperCase()}` });
await rcheck('R1. id interno em MAIUSCULAS', x.bloqueou && !contem(x.textoEnviado, OP_25_08));
// R2 — id colado em texto / com pontuacao
x = await simularTransporte({ resposta: `Pix=${OP_25_08}.` });
await rcheck('R2. id colado com pontuacao', x.bloqueou && !contem(x.textoEnviado, OP_25_08));
// R3 — id dentro de markdown link
x = await simularTransporte({ resposta: `[clique aqui](https://pay.x.com/${OP_08_08})` });
await rcheck('R3. id dentro de markdown link', x.bloqueou && !contem(x.textoEnviado, OP_08_08));
// R4 — id em backticks inline
x = await simularTransporte({ resposta: `Seu codigo: \`${OP_04_08}\`` });
await rcheck('R4. id em backticks inline', x.bloqueou && !contem(x.textoEnviado, OP_04_08));
// R5 — id de OUTRO lead
x = await simularTransporte({ resposta: `Segue o Pix: 9c1f77aa-1111-4222-8333-444455556666` });
await rcheck('R5. id interno de outro lead tambem bloqueado', x.bloqueou);
// R6 — FALSO 000201 usado para tentar isentar o id (prefixo forjado)
const FORJADO = '000201' + 'X'.repeat(70) + ' ' + OP_25_08;
x = await simularTransporte({ resposta: `Segue:\n${FORJADO}` });
await rcheck('R6. prefixo 000201 FORJADO nao isenta o id', !contem(x.textoEnviado, OP_25_08) && x.codigoPixEnviado === '',
  JSON.stringify(x));
// R7 — leitura do banco falha => FECHA a porta
setLeituraFalha(true);
x = await simularTransporte({ resposta: `Segue o Pix: ${OP_25_08}` });
setLeituraFalha(false);
await rcheck('R7. falha de leitura do banco FECHA a porta', x.bloqueou && !contem(x.textoEnviado, OP_25_08));
// R8 — id interno + Pix real: expurga o id e PRESERVA o Pix legitimo
x = await simularTransporte({ resposta: `Segue o Pix ${OP_25_08} abaixo`,
  pixGerado: { ok: true, qr_code: QR_OFICIAL, payment_id: '1', operation_id: OP_25_08 } });
await rcheck('R8. id expurgado mas Pix legitimo preservado',
  x.bloqueou && !contem(x.textoEnviado, OP_25_08) && x.codigoPixEnviado === QR_OFICIAL, JSON.stringify(x).slice(0,220));
// R9 — ctx.pixGerado.operation_id bloqueado mesmo sem ir ao banco
setLeituraFalha(true);
x = await simularTransporte({ resposta: `Codigo: 9c1f77aa-1111-4222-8333-444455556666`,
  ctx: { autorizacoes: [{ operation_id: '9c1f77aa-1111-4222-8333-444455556666' }], pixGerado: null } });
setLeituraFalha(false);
await rcheck('R9. id vindo de ctx.autorizacoes bloqueado sem banco', x.bloqueou);
// R10 — prometeuPix cobre as frases pedidas
const FRASES = ['Segue o Pix', 'Segue sua chave', 'Pix:', 'Chave Pix:', 'aqui está o Pix', 'te envio o Pix', 'código Pix'];
const naoCobre = FRASES.filter(f => !calcPrometeuPix(f));
await rcheck('R10. prometeuPix cobre as 7 frases exigidas', naoCobre.length === 0, 'faltou: ' + JSON.stringify(naoCobre));
// R11 — prometeuPix nao dispara em conversa normal
const NEUTRAS = ['Você quer pagar no Pix ou cartão?', 'Aceitamos Pix e cartão', 'Total R$ 101,18, retira em Embu?'];
const falsos = NEUTRAS.filter(f => calcPrometeuPix(f));
await rcheck('R11. prometeuPix nao dispara em frase neutra', falsos.length === 0, 'falsos: ' + JSON.stringify(falsos));
// R12 — hold de arte nao dispara em conversa comum
const COMUNS = ['a arte ficou linda', 'voces fazem arte?', 'quanto custa a arte?', 'ja paguei, obrigado', 'manda o pix'];
const fh = COMUNS.filter(f => RX_HOLD_ARTE_PAGAMENTO.test(f));
await rcheck('R12. hold de arte nao dispara em frase comum', fh.length === 0, 'falsos: ' + JSON.stringify(fh));
// R13 — texto sem UUID nenhum nao vai ao banco (custo zero)
const ids0 = await idsInternosNoTexto('Total R$ 101,18. Pix ou cartao?', null, []);
await rcheck('R13. texto sem UUID nao consulta o banco', ids0.length === 0);
// R14 — QR pendente do banco atravessa intacto
x = await simularTransporte({ resposta: 'Segue o Pix abaixo', cobrancaPendente: { qr_code: QR_PENDENTE, payment_id: '9' } });
await rcheck('R14. QR pendente atravessa intacto', x.codigoPixEnviado === QR_PENDENTE && !x.bloqueou);

console.log(ref.join('\n'));
console.log('\n===========================================================');
console.log(`OBRIGATORIOS: ${pass} PASS / ${fail} FAIL`);
console.log(`REFUTACAO   : ${rp} PASS / ${rf} FAIL`);
console.log('===========================================================\n');
if (fail > 0 || rf > 0) process.exit(1);
}
run();
