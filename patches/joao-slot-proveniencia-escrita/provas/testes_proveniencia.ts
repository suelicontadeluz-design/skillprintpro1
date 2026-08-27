// ============================================================================
// TESTES OBRIGATORIOS v4.37.0 FASE 1 — porta de ESCRITA.
// O codigo sob teste e EXTRAIDO VERBATIM do candidato (proveniencia_gerado.ts).
// ============================================================================
import {
  filtrarSlotsPorProveniencia, evidenciaDeQuantidade, evidenciaDeProduto,
  normalizarProdutoMacro, valorEcoaNoTexto,
  somaGrade,
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
// LIMITE DECLARADO DA FASE 1: 'arte' NAO e gateada. MEDIDO em 1.273 turnos organicos:
// gatear arte custava 39 recusas (8,8% -> 6,4% ao sair), quase todas legitimas, porque
// arte nasce de IMAGEM/AUDIO e de descricao em conversa. Como produto, quantidade e
// modalidade sao gateados por conta propria, arte sozinha nao altera o pedido.
// Consequencia assumida: no turno do Vitor, "pack_evangelicos" AINDA persiste.
check('T-ORG-3. arte NAO e gateada nesta fase (limite declarado e medido)',
  org.slots.arte === 'pack_evangelicos' && !rej('arte'), JSON.stringify(org.slots));
check('T-ORG-4. modalidade_logistica sai das maos do modelo',
  org.slots.modalidade_logistica === undefined && rej('modalidade_logistica'), JSON.stringify(org.slots));
check('T-ORG-5. envio_retirada sai das maos do modelo',
  org.slots.envio_retirada === undefined && rej('envio_retirada'), JSON.stringify(org.slots));
check('T-ORG-6. pagamento "pix" CONTINUA valendo (o cliente escreveu "Pix")',
  org.slots.pagamento === 'pix' && !rej('pagamento'), JSON.stringify(org.slots));
check('T-ORG-7. nenhum "adesivo" sobra no estado',
  !JSON.stringify(org.slots).toLowerCase().includes('adesivo'), JSON.stringify(org.slots));
check('T-ORG-8. nenhum FATO COMERCIAL do pedido e inventado (produto/qtd/modalidade)',
  org.slots.produto === undefined && org.slots.quantidade === undefined
  && org.slots.modalidade_logistica === undefined && org.slots.envio_retirada === undefined,
  JSON.stringify(org.slots));

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

console.log(linhas.join('\n'));
console.log(`\n  TOTAL: ${pass} PASS / ${fail} FAIL\n`);
if (fail > 0) process.exit(1);
