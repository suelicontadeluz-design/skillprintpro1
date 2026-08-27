import { simularTransporteBase, simularGuardaUrlBase, validarPix, calcPrometeuPixBase } from './harness_base.js';

const OP_25_08 = '02d22212-8e17-4dfb-9fa4-1c184b7ac1b9';
const OP_04_08 = '5d357026-77e7-4066-ba76-9d9a57813383';
const OP_08_08 = 'eef34589-e6b7-4f02-8cf8-fea17eba3809';
const OP_23_08 = '28a00b98-52ef-4213-92b7-98efbbfbd895';
const contem = (t: string, id: string) => t.toLowerCase().includes(id.toLowerCase());

console.log('\n========= MESMOS TESTES CONTRA A BASELINE v174 (ANTES) =========\n');
const linhas: string[] = []; let vaz = 0;
function t(n: string, vazou: boolean, amostra: string) {
  if (vazou) { vaz++; linhas.push(`  VAZOU   ${n}\n            -> "${amostra.replace(/\n/g,' | ').slice(0,120)}"`); }
  else linhas.push(`  contido ${n}`);
}

let r = simularTransporteBase({ resposta: `Perfeito! Segue o Pix:\n\n${OP_25_08}` });
t('1. "Segue o Pix: <operation_id>"', contem(r.textoEnviado, OP_25_08), r.textoEnviado);

r = simularTransporteBase({ resposta: `Rafaela, o total é *R$ 233,61*. Cartão certo?\n\n${OP_23_08}` });
t('2. operation_id puro', contem(r.textoEnviado, OP_23_08), r.textoEnviado);

const u = simularGuardaUrlBase(`Link do cartão: https://pay.smartpag.com.br/${OP_08_08}`, null, false);
r = simularTransporteBase({ resposta: `Link do cartão: https://pay.smartpag.com.br/${OP_08_08}` });
t('3. URL inventada com operation_id (ramo temUrlPagamento)', contem(u, OP_08_08), u);

r = simularTransporteBase({ resposta: `Seu total é R$ 64,52. Pix ou cartão?\n\n\`\`\`\n${OP_04_08}\n\`\`\`` });
t('4. operation_id em markdown/code block', contem(r.textoEnviado, OP_04_08), r.textoEnviado);

r = simularTransporteBase({ resposta: `Segue o Pix: ${OP_25_08}\nOu use a chave 30248650000111.` });
t('8. gerar_pix falha: UUID + chave manual', contem(r.textoEnviado, OP_25_08) || r.textoEnviado.includes('30248650000111'), r.textoEnviado);

console.log(linhas.join('\n'));
console.log(`\n  validarPix('...30248650000111') na v174 = ${validarPix('Use a chave 30248650000111')}  (LIBERAVA a chave errada)`);
console.log(`  prometeuPix('Segue o Pix:') na v174    = ${calcPrometeuPixBase('Segue o Pix:')}  (NAO detectava a promessa)`);
console.log(`  prometeuPix('Segue sua chave') na v174  = ${calcPrometeuPixBase('Segue sua chave')}`);
console.log(`\n  >>> ${vaz} de 5 casos VAZARAM identificador interno/chave errada na v174.\n`);
