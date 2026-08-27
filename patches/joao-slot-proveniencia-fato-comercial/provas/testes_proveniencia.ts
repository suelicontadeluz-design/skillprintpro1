// ============================================================================
// TESTES OBRIGATORIOS v4.37.0 — proveniencia de fato comercial.
// O codigo sob teste e EXTRAIDO VERBATIM do candidato (proveniencia_gerado.ts).
// ============================================================================
import {
  filtrarSlotsPorProveniencia, evidenciaDeQuantidade, evidenciaDeProduto,
  normalizarProdutoMacro, valorEcoaNoTexto,
  afirmacoesSemLastro, fatosDePedidoNoTexto, somaGrade,
} from './proveniencia_gerado.js';

let pass = 0, fail = 0;
const linhas: string[] = [];
function check(n: string, cond: boolean, detalhe = '') {
  if (cond) { pass++; linhas.push(`  PASS  ${n}`); }
  else { fail++; linhas.push(`  FAIL  ${n}   ${detalhe}`); }
}

// ── O CASO ORGANICO, LITERAL ────────────────────────────────────────────────
// Copiado de whatsapp_message_log, lead 5511994088967, 26/08/2026.
const ORG_MSG = 'Feito';
const ORG_INBOUNDS = [
  'Bom dia, tudo bem?',
  'pode considerar a de 6 anos',
  'posso enviar 300 agora ? e o restante daqui a 5 dias?',
  'ou no ato da coleta',
  'Pix',
  'ok',
];
const ORG_TEXTOS = [ORG_MSG, ...ORG_INBOUNDS];
// Exatamente o que o modelo devolveu e que virou estado em producao.
const ORG_SLOTS_MODELO = {
  arte: 'pack_evangelicos',
  produto: 'adesivo_uv',
  pagamento: 'pix',
  quantidade: 300,
  envio_retirada: 'envio',
  modalidade_logistica: 'envio',
};

console.log('\n================ TESTES OBRIGATORIOS v4.37.0 ================\n');
console.log('-- CASO ORGANICO (lead 5511994088967, 26/08 23:54) --');

const org = filtrarSlotsPorProveniencia({
  anteriores: {},                      // agente_noturno_estado estava vazio
  recebidos: ORG_SLOTS_MODELO,
  textosCliente: ORG_TEXTOS,
  macroCanonico: 'camiseta',           // content_category=evangelicos -> camiseta
  toolsUsadas: [],                     // tools=[] no turno real
});
const rej = (s: string) => org.rejeitados.some((r: any) => r.slot === s);

check('T-ORG-1. produto "adesivo_uv" NAO vira fato', org.slots.produto === undefined && rej('produto'),
  JSON.stringify(org.slots));
check('T-ORG-2. quantidade 300 (dinheiro) NAO vira fato', org.slots.quantidade === undefined && rej('quantidade'),
  JSON.stringify(org.slots));
check('T-ORG-3. arte "pack_evangelicos" NAO vira fato', org.slots.arte === undefined && rej('arte'),
  JSON.stringify(org.slots));
check('T-ORG-4. modalidade_logistica sai das maos do modelo',
  org.slots.modalidade_logistica === undefined && rej('modalidade_logistica'), JSON.stringify(org.slots));
check('T-ORG-5. envio_retirada sai das maos do modelo',
  org.slots.envio_retirada === undefined && rej('envio_retirada'), JSON.stringify(org.slots));
check('T-ORG-6. pagamento "pix" CONTINUA valendo (o cliente escreveu "Pix")',
  org.slots.pagamento === 'pix' && !rej('pagamento'), JSON.stringify(org.slots));
check('T-ORG-7. nenhum "adesivo" sobra no estado',
  !JSON.stringify(org.slots).toLowerCase().includes('adesivo'), JSON.stringify(org.slots));
check('T-ORG-8. o estado resultante nao inventa pedido nenhum',
  Object.keys(org.slots).length === 1, JSON.stringify(org.slots));

// Invariante 4 — produto conhecido e PRESERVADO, nao sobrescrito.
const preserva = filtrarSlotsPorProveniencia({
  anteriores: { produto: 'camiseta', quantidade: 16 },
  recebidos: ORG_SLOTS_MODELO,
  textosCliente: ORG_TEXTOS, macroCanonico: 'camiseta', toolsUsadas: [],
});
check('T-ORG-9. camiseta/quantidade ja conhecidas sobrevivem ao turno',
  preserva.slots.produto === undefined && preserva.slots.quantidade === undefined,
  JSON.stringify(preserva.slots));

// ── MATRIZ ADVERSARIAL: DINHEIRO x QUANTIDADE ───────────────────────────────
console.log('-- MATRIZ ADVERSARIAL (dinheiro x quantidade) --');
const MATRIZ: Array<[string, number, boolean, string]> = [
  ['posso enviar 300 agora ? e o restante daqui a 5 dias?', 300, false, 'cliente remetente + dinheiro'],
  ['posso enviar 500 agora',                                500, false, 'cliente remetente'],
  ['vou mandar 200 e o restante amanha',                    200, false, 'cliente remetente'],
  ['ja enviei 300',                                         300, false, 'cliente remetente'],
  ['vou mandar o comprovante',                              300, false, 'sem numero na fala'],
  ['entrada de 300',                                        300, false, 'dinheiro explicito'],
  ['paguei 300',                                            300, false, 'dinheiro explicito'],
  ['transferi 300 agora',                                   300, false, 'dinheiro explicito'],
  ['sao 300 reais',                                         300, false, 'preco, nao peca'],
  ['quero 300 camisetas',                                   300, true,  'unidade explicita'],
  ['quero 300 adesivos',                                    300, true,  'unidade explicita'],
  ['300 unidades',                                          300, true,  'unidade explicita'],
  ['o pedido e de 300 pecas',                               300, true,  'unidade explicita'],
  ['quero 300 camisetas, pago no pix',                      300, true,  'unidade decide sobre dinheiro'],
  ['quero 300',                                             300, true,  'verbo de pedido explicito'],
];
for (const [frase, n, esperado, porque] of MATRIZ) {
  const r = evidenciaDeQuantidade(n, [frase]);
  check(`  "${frase}" -> quantidade=${esperado ? 'SIM' : 'NAO'} (${porque})`,
    r.ok === esperado, `obteve ok=${r.ok} ev=${r.evidencia}`);
}

// ── MUDANCA LEGITIMA DE PRODUTO ─────────────────────────────────────────────
console.log('-- MUDANCA LEGITIMA DE PRODUTO --');
const LEGIT = 'na verdade nao quero mais camiseta, quero adesivo UV';
for (const proposto of ['dtf_uv', 'adesivo_uv', 'adesivo uv']) {
  const e = evidenciaDeProduto(proposto, [LEGIT], 'camiseta', 'camiseta');
  check(`  cliente pede adesivo UV -> produto "${proposto}" ACEITO`, e.fonte !== null,
    JSON.stringify(e));
}
const trocaLegit = filtrarSlotsPorProveniencia({
  anteriores: { produto: 'camiseta', quantidade: 16 },
  recebidos: { produto: 'dtf_uv' },
  textosCliente: [LEGIT], macroCanonico: 'camiseta', toolsUsadas: [],
});
check('  troca declarada pelo cliente PERSISTE', trocaLegit.slots.produto === 'dtf_uv',
  JSON.stringify(trocaLegit.slots));

// Invariante 3 — ausencia de produto na mensagem NAO e mudanca de produto.
for (const mudo of ['Feito', 'ok', 'obrigado', 'bom dia']) {
  const e = evidenciaDeProduto('adesivo_uv', [mudo], 'camiseta', 'camiseta');
  check(`  "${mudo}" NAO autoriza reconstruir produto`, e.fonte === null, JSON.stringify(e));
}

// Refinamento dentro do mesmo macro continua passando (nao e mudanca de produto).
const refino = evidenciaDeProduto('camiseta dry fit branca', ['pode ser dry fit branca'], 'camiseta', 'camiseta');
check('  refino "camiseta dry fit branca" ACEITO (mesmo macro)', refino.fonte !== null, JSON.stringify(refino));

// ── INVARIANTE 6: OBSERVABILIDADE ENXERGA A DIVERGENCIA ─────────────────────
console.log('-- VOCABULARIO / OBSERVABILIDADE --');
check('  normalizarProdutoMacro("adesivo_uv") continua null (nao e vocabulario)',
  normalizarProdutoMacro('adesivo_uv') === null, String(normalizarProdutoMacro('adesivo_uv')));
check('  normalizarProdutoMacro("camiseta") = camiseta',
  normalizarProdutoMacro('camiseta') === 'camiseta');
check('  valorEcoaNoTexto("pack_evangelicos","Feito") = false',
  valorEcoaNoTexto('pack_evangelicos', 'Feito') === false);
check('  valorEcoaNoTexto("pack_animes","quero o pack animes") = true',
  valorEcoaNoTexto('pack_animes', 'quero o pack animes') === true);

// ── SLOTS NAO-CRITICOS SEGUEM LIVRES (superficie minima) ────────────────────
console.log('-- NAO-REGRESSAO --');
const livres = filtrarSlotsPorProveniencia({
  anteriores: {}, recebidos: { tema_arte: 'leao', observacao: 'urgente', _idioma: 'pt' },
  textosCliente: ['oi'], macroCanonico: null, toolsUsadas: [],
});
check('  slot nao-critico passa sem exigencia',
  livres.slots.tema_arte === 'leao' && livres.slots.observacao === 'urgente' && livres.rejeitados.length === 0,
  JSON.stringify(livres));

// CEP dito pelo cliente passa; CEP inventado pelo modelo nao.
const cepOk = filtrarSlotsPorProveniencia({
  anteriores: {}, recebidos: { cep: '03846040' },
  textosCliente: ['meu cep e 03846-040'], macroCanonico: null, toolsUsadas: [],
});
check('  CEP dito pelo cliente PASSA', cepOk.slots.cep === '03846040', JSON.stringify(cepOk.slots));
const cepMau = filtrarSlotsPorProveniencia({
  anteriores: {}, recebidos: { cep: '01001000' },
  textosCliente: ['Feito'], macroCanonico: null, toolsUsadas: [],
});
check('  CEP inventado pelo modelo NAO passa', cepMau.slots.cep === undefined, JSON.stringify(cepMau.slots));

// Valor identico ao estado anterior nunca e barrado (nao e criacao nem mudanca).
const igual = filtrarSlotsPorProveniencia({
  anteriores: { produto: 'adesivo_uv', quantidade: 300 },
  recebidos: { produto: 'adesivo_uv', quantidade: 300 },
  textosCliente: ['Feito'], macroCanonico: 'camiseta', toolsUsadas: [],
});
check('  repetir o estado anterior nao e barrado (idempotente)',
  igual.slots.produto === 'adesivo_uv' && igual.slots.quantidade === 300 && igual.rejeitados.length === 0,
  JSON.stringify(igual));

// Grade: so barra a TROCA de grade conhecida sem o cliente falar de tamanho.
const gradeAnt = [{ modelo: 'basica', cor: 'branca', tamanhos: { M: 4, G: 7 } }];
const gradeTrocaMuda = filtrarSlotsPorProveniencia({
  anteriores: { grade: gradeAnt }, recebidos: { grade: [{ modelo: 'basica', tamanhos: { P: 9 } }] },
  textosCliente: ['Feito'], macroCanonico: 'camiseta', toolsUsadas: [],
});
check('  grade conhecida NAO e trocada sem o cliente falar tamanho',
  gradeTrocaMuda.slots.grade === undefined, JSON.stringify(gradeTrocaMuda.slots));
const gradeTrocaDita = filtrarSlotsPorProveniencia({
  anteriores: { grade: gradeAnt }, recebidos: { grade: [{ modelo: 'basica', tamanhos: { P: 9 } }] },
  textosCliente: ['troca pra P mesmo, 9 unidades'], macroCanonico: 'camiseta', toolsUsadas: [],
});
check('  grade CORRIGIDA pelo cliente PASSA',
  Array.isArray(gradeTrocaDita.slots.grade), JSON.stringify(gradeTrocaDita.slots));
const gradeNova = filtrarSlotsPorProveniencia({
  anteriores: {}, recebidos: { grade: gradeAnt },
  textosCliente: ['M 4 G 7'], macroCanonico: 'camiseta', toolsUsadas: [],
});
check('  grade NOVA (nao havia nenhuma) PASSA', Array.isArray(gradeNova.slots.grade),
  JSON.stringify(gradeNova.slots));

// Pagamento confirmado por ferramenta passa mesmo sem o cliente escrever a palavra.
const pagTool = filtrarSlotsPorProveniencia({
  anteriores: {}, recebidos: { pagamento: 'pix' },
  textosCliente: ['Feito'], macroCanonico: null, toolsUsadas: ['gerar_pix'],
});
check('  pagamento confirmado por TOOL passa', pagTool.slots.pagamento === 'pix',
  JSON.stringify(pagTool.slots));

// ══════════════════════════════════════════════════════════════════════════
// GUARDA DE SAIDA — fato comercial AFIRMADO sem lastro (v4.37.0, 2a metade)
// ══════════════════════════════════════════════════════════════════════════
console.log('-- GUARDA DE SAIDA: fato afirmado ao cliente --');

const GRADE_VITOR = [{ modelo: 'basica', cor: 'branca',
  tamanhos: { M: 4, G: 7, GG: 3, G3: 1, Infantil: 1 } }];
const semLastro = (texto: string, verificado: any, textos: string[],
                   macro: string | null = 'camiseta', nums: number[] = []) =>
  afirmacoesSemLastro({ texto, verificado, textosCliente: textos, macroCanonico: macro, numerosAutorizados: nums });

// A — CASO VITOR: a proposta adversarial literal do enunciado.
const MSG_VITOR = 'Perfeito! Pagamento confirmado. Qual e o seu CEP para calcular o frete dos 300 adesivos?';
const vA = semLastro(MSG_VITOR, org.slots, ORG_TEXTOS);
check('A. "300 adesivos" no texto do Vitor e BLOQUEADO', vA.length > 0, JSON.stringify(vA));
check('A2. motivo e o numero ter nascido de DINHEIRO do cliente',
  vA.some((x: any) => x.motivo === 'quantidade_veio_de_dinheiro'), JSON.stringify(vA));
check('A3. a variante SEM token de frete tambem e pega',
  semLastro('Perfeito! Pagamento confirmado. Vou separar os 300 adesivos e ja te aviso.', org.slots, ORG_TEXTOS).length > 0);

// B — PRODUTO CORRETO: so passa com evidencia.
const VER_OK = { produto: 'camiseta', quantidade: 16, grade: GRADE_VITOR };
check('B. "16 camisetas" PASSA com produto e quantidade verificados',
  semLastro('Seu pedido de 16 camisetas esta confirmado', VER_OK, ['Feito']).length === 0,
  JSON.stringify(semLastro('Seu pedido de 16 camisetas esta confirmado', VER_OK, ['Feito'])));
// B2 — CASO ORGANICO 2, achado pelo replay: lead de CAMISETAS (arte "logo camisa.pdf",
// grade basica, cliente pedindo "mais uma camisa") e o Joao escreveu "51 adesivos".
// Mesma familia do Vitor, outro lead, outro dia.
check('B2. produto que CONTRADIZ o pedido e bloqueado ("adesivos" num pedido de camiseta)',
  semLastro('Voce ainda tem R$694,09 de saldo para completar os 51 adesivos + 1 que voce acrescentou hoje.',
            { arte: 'logo camisa.pdf', grade: [{ modelo: 'basica', tamanhos: { G: 17, M: 17, P: 5, GG: 6, XG: 4 } }] },
            ['Preciso que acrescente mais uma camisa tamanho M'], null).length > 0,
  JSON.stringify(semLastro('Voce ainda tem R$694,09 de saldo para completar os 51 adesivos.',
    { arte: 'logo camisa.pdf', grade: [{ modelo: 'basica', tamanhos: { G: 17 } }] }, ['mais uma camisa tamanho M'], null)));
// LIMITE ASSUMIDO E TESTADO: quantidade que apenas DIVERGE do estado verificado NAO e
// bloqueada. A regra existiu, foi medida no replay (10 disparos em 281 turnos, quase
// todos legitimos: cliente revisa, upsell de completar filme, rendimento de ferramenta)
// e foi retirada. Quem impede o numero de virar ESTADO e a porta de escrita.
check('B3. quantidade que so diverge do estado NAO e bloqueada (limite declarado)',
  semLastro('Otimo, 40 camisetas basicas com essas imagens.',
            { produto: 'camiseta basica', quantidade: 3 }, ['Qual valor pra fazer dessas']).length === 0);
check('B4. quantidade vinda da SOMA DA GRADE (16) e lastro valido',
  somaGrade(GRADE_VITOR) === 16 &&
  semLastro('Fechamos 16 camisetas', { produto: 'camiseta', grade: GRADE_VITOR }, ['Feito']).length === 0,
  String(somaGrade(GRADE_VITOR)));

// C — TROCA LEGITIMA.
const TROCA = 'na verdade nao quero mais camiseta, quero adesivo UV';
check('C. resposta sobre adesivo UV PASSA apos o cliente pedir a troca',
  semLastro('Combinado! Vamos de adesivo UV entao.', { produto: 'dtf_uv' }, [TROCA]).length === 0);

// D — QUANTIDADE LEGITIMA.
check('D. "300 adesivos" PASSA quando o cliente pediu 300 adesivos',
  semLastro('Fechado: 300 adesivos.', { produto: 'dtf_uv', quantidade: 300 }, ['quero 300 adesivos']).length === 0,
  JSON.stringify(semLastro('Fechado: 300 adesivos.', { produto: 'dtf_uv', quantidade: 300 }, ['quero 300 adesivos'])));

// E — DINHEIRO nunca vira unidade no texto.
check('E. "300 unidades" e BLOQUEADO quando o cliente falava de dinheiro',
  semLastro('Vou separar as 300 unidades.', {}, ['vou enviar 300 agora']).length > 0);

// H — ESTADO ANTIGO ja confirmado pode ser referenciado sem o cliente repetir.
check('H. estado previamente confirmado sustenta a frase apos um "Feito"',
  semLastro('Confirmado! Suas 16 camisetas entram na producao.',
            { produto: 'camiseta', quantidade: 16 }, ['Feito']).length === 0);

// FALSOS POSITIVOS que a guarda NAO pode criar.
console.log('-- FALSOS POSITIVOS --');
check('FP1. catalogo sem numero nao e afirmacao de pedido',
  semLastro('Trabalhamos com DTF textil para camisetas, DTF UV que e adesivo para copo, vidro e metal.', {}, ['oi']).length === 0);
check('FP2. frase de TABELA ("a partir de 10 unidades") nao e afirmacao de pedido',
  semLastro('O copo sai R$35,90 abaixo de 10 unidades e R$29,90 a partir de 10 unidades.', {}, ['oi']).length === 0,
  JSON.stringify(semLastro('O copo sai R$35,90 abaixo de 10 unidades e R$29,90 a partir de 10 unidades.', {}, ['oi'])));
check('FP3. numero autorizado por ferramenta (rendimento) PASSA',
  semLastro('Cabem 48 adesivos por metro.', { produto: 'dtf_uv' }, ['oi'], 'dtf_uv', [48]).length === 0,
  JSON.stringify(semLastro('Cabem 48 adesivos por metro.', { produto: 'dtf_uv' }, ['oi'], 'dtf_uv', [48])));
check('FP4. preco nao e confundido com quantidade',
  semLastro('O total ficou R$ 497,16.', { produto: 'camiseta', quantidade: 12 }, ['oi']).length === 0,
  JSON.stringify(semLastro('O total ficou R$ 497,16.', { produto: 'camiseta', quantidade: 12 }, ['oi'])));
check('FP5. resposta neutra sem numero nunca dispara',
  semLastro('Perfeito! Recebi o comprovante. Vou seguir com o pedido conforme combinamos.', {}, ['Feito']).length === 0);

// Extrator: so pega numero COLADO em substantivo de mercadoria.
check('EXT1. extrai "300 adesivos"', fatosDePedidoNoTexto('os 300 adesivos').length === 1);
check('EXT2. NAO extrai "R$ 497,16"', fatosDePedidoNoTexto('total R$ 497,16').length === 0,
  JSON.stringify(fatosDePedidoNoTexto('total R$ 497,16')));
check('EXT3. NAO extrai numero solto', fatosDePedidoNoTexto('em 5 dias uteis').length === 0);

console.log(linhas.join('\n'));
console.log(`\n  TOTAL: ${pass} PASS / ${fail} FAIL\n`);
if (fail > 0) process.exit(1);
