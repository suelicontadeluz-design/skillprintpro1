// v4.36.0 — "enviar" com o CLIENTE como remetente nao declara modalidade logistica.
// O caso T-ORG e a frase ORGANICA que produziu o defeito, copiada de fact_conversations.
import * as fs from 'node:fs';
import { classificarDeclaracaoLogistica, resolverModalidadeLogistica } from './modalidade_gerado.js';

const CAND = fs.readFileSync(new URL('../candidato436.ts', import.meta.url), 'utf8');
const B435 = fs.readFileSync(new URL('../base435.ts', import.meta.url), 'utf8');

let pass = 0, fail = 0; const linhas: string[] = [];
function check(n: string, cond: boolean, d = '') {
  if (cond) { pass++; linhas.push(`  PASS  ${n}`); }
  else { fail++; linhas.push(`  FAIL  ${n}\n          ${d}`); }
}
const modal = (t: string) => classificarDeclaracaoLogistica(t).modalidade;

console.log('\n===== v4.36.0 — REMETENTE CLIENTE NAO E MODALIDADE =====\n');

// ── O CASO ORGANICO ────────────────────────────────────────────────────────
{
  const FRASE = 'posso enviar 300 agora ? e o restante daqui a 5 dias?';
  check('T-ORG frase organica do lead 5511994088967 NAO declara envio',
    modal(FRASE) === null, String(modal(FRASE)));
  // E o efeito no estado: DDD 11, sem outro sinal -> volta a ser desconhecida e o frete
  // volta a ser bloqueado, que era a garantia da v4.34.0.
  const e = resolverModalidadeLogistica({
    mensagemAtual: 'Feito', inboundsPedido: [{ message_text: FRASE }], historicoInbound: [],
    slots: {}, phone: '5511994088967', freteJa: null, produtoContexto: 'dtf_uv',
  });
  check('T-ORG.b estado volta a desconhecida', e.modalidade === 'desconhecida', JSON.stringify(e));
  check('T-ORG.c frete bloqueado de novo (Grande SP)', e.bloqueia_frete === true, '');
  check('T-ORG.d nao pede CEP', e.pedir_cep === false, '');
  // Prova de que a v4.35.0 ERRAVA nesta mesma frase:
  check('T-ORG.e a v4.35.0 tinha o verbo solto como sinal de envio',
    B435.includes('const RX_LOG_ENVIO = /\\b(envi(?:ar|o|a|am|amos|em|ei|ou|ado[s]?)|correios?'), '');
  check('T-ORG.f a v4.36.0 separa FORTE de VERBO',
    CAND.includes('const RX_LOG_ENVIO_FORTE =') && CAND.includes('function envioPositivoNaSentenca('), '');
}

// ── O QUE TEM DE CONTINUAR VALENDO COMO ENVIO ─────────────────────────────
const AINDA_ENVIO: Array<[string, string]> = [
  ['Pode enviar pelos Correios', 'meio de transporte nomeado'],
  ['Quero receber por envio', 'substantivo envio'],
  ['Voces enviam para BH?', 'a empresa e a remetente'],
  ['Pode enviar?', 'verbo, empresa remetente implicita'],
  ['Manda pelo Sedex', 'sedex'],
  ['Prefiro que voces enviem', 'empresa remetente'],
  ['Qual o valor do frete?', 'frete'],
  ['Manda para o meu endereco', 'mandar para + endereco'],
  ['Pode postar amanha?', 'postar'],
  ['Quero receber em casa', 'receber em casa'],
];
for (const [frase, motivo] of AINDA_ENVIO) {
  check(`E+ "${frase}" continua envio (${motivo})`, modal(frase) === 'envio', String(modal(frase)));
}

// ── O QUE DEIXA DE SER ENVIO ──────────────────────────────────────────────
const NAO_E_ENVIO: Array<[string, string]> = [
  ['posso enviar 300 agora', 'cliente remetente + numero'],
  ['vou enviar o comprovante', 'cliente remetente + comprovante'],
  ['ja enviei a arte', 'cliente remetente + arte'],
  ['posso mandar o pix agora', 'cliente remetente + pix'],
  ['eu envio o arquivo hoje', 'cliente remetente + arquivo'],
  ['acabei de enviar o pagamento', 'cliente remetente + pagamento'],
  ['estou enviando a foto', 'cliente remetente + foto'],
  ['consigo enviar 500 hoje', 'cliente remetente + numero'],
];
for (const [frase, motivo] of NAO_E_ENVIO) {
  check(`E- "${frase}" NAO e envio (${motivo})`, modal(frase) === null, String(modal(frase)));
}

// ── RETIRADA E MOTOBOY INTOCADOS ──────────────────────────────────────────
check('M1 retirada presencial segue retirada', modal('Forma de retirada : retirada presencial') === 'retirada', '');
check('M2 vamos retirar segue retirada', modal('Vamos retirar') === 'retirada', '');
check('M3 motoboy segue motoboy', modal('Vou mandar o motoboy buscar') === 'motoboy', '');
check('M4 negacao segue funcionando', modal('Nao vou retirar, prefiro envio') === 'envio', String(modal('Nao vou retirar, prefiro envio')));
check('M5 rotulo nao conta', modal('Forma de retirada: envio pelos Correios') === 'envio', '');
check('M6 ambiguidade segue null', modal('Posso retirar ou voces enviam?') === null, String(modal('Posso retirar ou voces enviam?')));
check('M7 "sem frete" nao vira envio', modal('Vou fazer retirada, sem frete') === 'retirada', '');
check('M8 CEP puro segue null', modal('05893-000') === null, '');

// ── INVARIANTES ───────────────────────────────────────────────────────────
check('I1 versao v4.37.0', CAND.includes("const V = 'agente-noturno-v4.37.0';"), '');
check('I2 nada mais do modulo de CEP mudou',
  CAND.includes('function refinarCepComCadastro(') && CAND.includes('function persistirCepCanonico(')
  && CAND.includes('const PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO = false;'), '');
check('I3 guardas da v4.34.0 intactas',
  CAND.includes("if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {")
  && CAND.includes('resposta = perguntaDoQueFaltaFechamento(estadoLog,'), '');

console.log(linhas.join('\n'));
console.log(`\n  >>> ${pass} PASS / ${fail} FAIL\n`);
process.exit(fail === 0 ? 0 : 1);
