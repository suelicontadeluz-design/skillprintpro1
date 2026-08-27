// ============================================================================
// TESTES OBRIGATORIOS v4.38.0 FASE 2 — guarda de SAIDA.
// O codigo sob teste e EXTRAIDO VERBATIM do candidato (proveniencia_gerado.ts).
// ============================================================================
import {
  filtrarSlotsPorProveniencia, evidenciaDeQuantidade, evidenciaDeProduto,
  normalizarProdutoMacro, valorEcoaNoTexto,
  somaGrade, afirmacoesSemLastro, fatosDePedidoNoTexto,
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
