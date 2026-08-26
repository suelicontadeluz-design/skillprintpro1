import * as fs from 'node:fs';
import {
  resolverModalidadeLogistica, refinarCepComCadastro, lerPessoaCanonicaPorTelefone,
  persistirCepCanonico, blocoCepCanonico, cepLiberadoParaFrete, mascararCep,
  CADASTRO_VAZIO, PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO,
  ERROS, PATCHES, setErpRows, setErpFalha, reset,
} from './modalidade_gerado.js';
import type { EstadoLogistico, PessoaCadastro } from './modalidade_gerado.js';

const CAND = fs.readFileSync(new URL('../candidato435.ts', import.meta.url), 'utf8');
const B434 = fs.readFileSync(new URL('../base434.ts', import.meta.url), 'utf8');

let pass = 0, fail = 0; const linhas: string[] = [];
function check(n: string, cond: boolean, d = '') {
  if (cond) { pass++; linhas.push(`  PASS  ${n}`); }
  else { fail++; linhas.push(`  FAIL  ${n}\n          ${d}`); }
}

// Pessoa do ERP no formato REAL medido: telefone "(11) 91857-0605", cep "11688-602".
const PESSOA_COM_CEP_E_ENDERECO = [{
  id: 'p-0001', nome: 'Cliente Recorrente', ativo: true,
  telefone: '(11) 98765-3000', whatsapp: '(11) 98765-3000',
  cep: '04573-000', logradouro: 'Rua das Flores', numero: '120', bairro: 'Centro',
  cidade: 'Sao Paulo', estado: 'SP',
}];
const PESSOA_SEM_CEP = [{
  id: 'p-0002', nome: 'Cliente Novo', ativo: true,
  telefone: '(11) 98765-4000', whatsapp: null,
  cep: null, logradouro: null, numero: null, bairro: null, cidade: null, estado: null,
}];
const DUAS_PESSOAS_MESMO_SUFIXO = [
  { id: 'p-A', nome: 'A', ativo: true, telefone: '(11) 98765-5000', whatsapp: null, cep: '01001-000', logradouro: 'R. X', cidade: 'Sao Paulo' },
  { id: 'p-B', nome: 'B', ativo: true, telefone: '(11) 98765-5000', whatsapp: null, cep: '02002-000', logradouro: 'R. Y', cidade: 'Sao Paulo' },
];

function base(phone: string, mensagem: string, extra: any = {}): EstadoLogistico {
  return resolverModalidadeLogistica({
    mensagemAtual: mensagem, inboundsPedido: extra.inboundsPedido || [],
    historicoInbound: extra.historicoInbound || [], slots: extra.slots || {},
    phone, freteJa: extra.freteJa || null, produtoContexto: extra.produtoContexto || 'dtf_textil',
  });
}
async function turno(phone: string, mensagem: string, extra: any = {}) {
  let e = base(phone, mensagem, extra);
  let cad: PessoaCadastro = CADASTRO_VAZIO;
  if (!e.bloqueia_frete) {
    cad = await lerPessoaCanonicaPorTelefone(phone);
    e = refinarCepComCadastro(e, cad, extra.slots || {}, mensagem, extra.ultimaMsgJoao || '');
  }
  return { e, cad };
}
const PERGUNTA_JOAO = 'Vai ser enviado para o mesmo CEP final 3000?';

async function run() {
console.log('\n=========== TESTES OBRIGATORIOS v4.35.0 — CEP CANONICO ===========\n');

// ── T1 — envio + pessoas.cep existente ────────────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e } = await turno('5511987653000', 'Pode enviar pelos Correios');
  const bloco = blocoCepCanonico(e);
  check('T1.a modalidade = envio', e.modalidade === 'envio', JSON.stringify(e));
  check('T1.b cep veio do cadastro (fonte pessoas)', e.cep_conhecido === '04573000' && e.cep_fonte === 'pessoas', JSON.stringify(e));
  check('T1.c pede CONFIRMACAO, nao o CEP inteiro', e.pedir_confirmacao_cep === true && e.pedir_cep === false, JSON.stringify(e));
  check('T1.d bloco propoe a frase com o final mascarado',
    /mesmo CEP final 3000\?/.test(bloco) && /NÃO peça o CEP inteiro/.test(bloco), bloco);
  check('T1.e bloco NAO expoe o endereco completo',
    !/Rua das Flores/.test(bloco) && !/04578/.test(bloco.replace('3000','')), bloco);
  check('T1.f frete AINDA nao liberado (falta confirmar)', cepLiberadoParaFrete(e) === false, '');
}

// ── T2 — cliente confirma o mesmo CEP ─────────────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e } = await turno('5511987653000', 'Isso mesmo, pode mandar pra la',
    { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: PERGUNTA_JOAO });
  const bloco = blocoCepCanonico(e);
  check('T2.a cep confirmado', e.cep_confirmado === true, JSON.stringify(e));
  check('T2.b reutiliza o CEP do cadastro', e.cep_conhecido === '04573000' && e.cep_fonte === 'pessoas', JSON.stringify(e));
  check('T2.c nao repergunta nada de CEP', e.pedir_cep === false && e.pedir_confirmacao_cep === false, JSON.stringify(e));
  check('T2.d frete LIBERADO', cepLiberadoParaFrete(e) === true, '');
  check('T2.e bloco manda calcular sem perguntar de novo',
    /NÃO pergunte de novo/.test(bloco) && /calcular_frete/.test(bloco), bloco);
  const p = await persistirCepCanonico(e, '5511987653000');
  check('T2.f nada e gravado: o CEP ja e o do cadastro',
    p.persistido === false && p.motivo === 'cep_ja_igual_ao_cadastro' && PATCHES.length === 0, JSON.stringify(p));
}

// ── T3 — envio + pessoas.cep NULL ─────────────────────────────────────────
reset(); setErpRows(PESSOA_SEM_CEP);
{
  const semCep = await turno('5511987654000', 'Quero envio para o meu endereco');
  check('T3.z pre-condicao: modalidade envio resolvida', semCep.e.modalidade === 'envio' && semCep.e.bloqueia_frete === false, JSON.stringify(semCep.e));
  check('T3.a sem CEP no cadastro -> PEDE o CEP uma vez',
    semCep.e.cep_conhecido === null && semCep.e.pedir_cep === true && semCep.e.pedir_confirmacao_cep === false, JSON.stringify(semCep.e));
  check('T3.b bloco pede UMA vez, 8 digitos', /peça o CEP UMA vez, 8 dígitos/.test(blocoCepCanonico(semCep.e)), blocoCepCanonico(semCep.e));
  const comCep = await turno('5511987654000', 'Meu CEP e 01310-100', { slots: { modalidade_logistica: 'envio' } });
  check('T3.c CEP escrito no turno vira fonte "pedido" e ja conta como confirmado',
    comCep.e.cep_conhecido === '01310100' && comCep.e.cep_fonte === 'pedido' && comCep.e.cep_confirmado === true, JSON.stringify(comCep.e));
  const p = await persistirCepCanonico(comCep.e, '5511987654000');
  check('T3.d GRAVA: preenche lacuna de cadastro sem cep',
    p.persistido === true && p.motivo === 'lacuna_preenchida' && PATCHES.length === 1, JSON.stringify(p));
  check('T3.e grava SOMENTE o campo cep, formatado',
    PATCHES.length === 1 && Object.keys(PATCHES[0].body).length === 1 && PATCHES[0].body.cep === '01310-100', JSON.stringify(PATCHES));
  check('T3.f o PATCH mira a pessoa certa', PATCHES.length === 1 && PATCHES[0].url.includes('id=eq.p-0002'), JSON.stringify(PATCHES));
}

// ── T4 — CEP novo diferente do cadastro, intencao indefinida ─────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e } = await turno('5511987653000', 'Manda para o CEP 20040-002', { slots: { modalidade_logistica: 'envio' } });
  const bloco = blocoCepCanonico(e);
  check('T4.a usa o CEP novo no pedido', e.cep_conhecido === '20040002' && e.cep_fonte === 'pedido', JSON.stringify(e));
  check('T4.b marca divergencia do cadastro', e.cep_divergente_do_cadastro === true, JSON.stringify(e));
  check('T4.c intencao ainda INDEFINIDA', e.intencao_cep_padrao === null, String(e.intencao_cep_padrao));
  check('T4.d bloco pergunta novo padrao vs so este pedido',
    /novo CEP padrão ou é só para este pedido/.test(bloco), bloco);
  const p = await persistirCepCanonico(e, '5511987653000');
  check('T4.e NAO sobrescreve antes da resposta',
    p.persistido === false && p.motivo === 'intencao_de_padrao_indefinida' && PATCHES.length === 0, JSON.stringify(p));
}

// ── T5 — CEP diferente, so para este pedido ──────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e } = await turno('5511987653000', 'E so para este pedido, o CEP 20040-002',
    { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: 'Esse e seu novo CEP padrao ou e so para este pedido?' });
  check('T5.a intencao = so_este_pedido', e.intencao_cep_padrao === 'so_este_pedido', JSON.stringify(e));
  check('T5.b usa o CEP novo no pedido', e.cep_conhecido === '20040002', JSON.stringify(e));
  const p = await persistirCepCanonico(e, '5511987653000');
  check('T5.c pessoas.cep INTACTO',
    p.persistido === false && p.motivo === 'apenas_este_pedido' && PATCHES.length === 0, JSON.stringify(p));
}

// ── T6 — cliente confirma que mudou de endereco ─────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e } = await turno('5511987653000', 'Mudei de endereco, agora e 20040-002, pode atualizar o cadastro',
    { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: 'Esse e seu novo CEP padrao ou e so para este pedido?' });
  check('T6.a intencao = novo_padrao', e.intencao_cep_padrao === 'novo_padrao', JSON.stringify(e));
  const p = await persistirCepCanonico(e, '5511987653000');
  check('T6.b com endereco fiscal preenchido a guarda RECUSA a sobrescrita cega',
    p.persistido === false && p.motivo === 'endereco_fiscal_coerente_exige_atualizacao_completa' && PATCHES.length === 0,
    JSON.stringify(p));
  check('T6.c kill switch existe e vem desligado', PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO === false, '');
  check('T6.d o candidato abre tarefa humana nessa recusa',
    CAND.includes("p.motivo === 'endereco_fiscal_coerente_exige_atualizacao_completa'")
    && CAND.includes("'Cadastro: cliente declarou novo CEP padrao'"), '');
  // Mesma intencao, mas pessoa SEM endereco: nao ha nada a contradizer -> grava.
  reset(); setErpRows([{ ...PESSOA_COM_CEP_E_ENDERECO[0], logradouro: null, cidade: null, bairro: null }]);
  const r2 = await turno('5511987653000', 'Mudei de endereco, agora e 20040-002, pode atualizar o cadastro',
    { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: 'Esse e seu novo CEP padrao ou e so para este pedido?' });
  const p2 = await persistirCepCanonico(r2.e, '5511987653000');
  check('T6.e sem endereco coerente para contradizer, GRAVA o novo padrao',
    p2.persistido === true && p2.motivo === 'novo_padrao_declarado' && PATCHES.length === 1 && PATCHES[0].body.cep === '20040-002', JSON.stringify(p2) + ' ' + JSON.stringify(PATCHES));
}

// ── T7 — retirada com pessoas.cep preenchido ────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e, cad } = await turno('5511987653000', 'Forma de retirada: retirada presencial');
  check('T7.a modalidade = retirada', e.modalidade === 'retirada', JSON.stringify(e));
  check('T7.b o cadastro nem chega a ser LIDO', cad.pessoa_id === null && ERROS.length === 0, JSON.stringify(cad));
  check('T7.c zero confirmacao de CEP', e.pedir_confirmacao_cep === false && e.cep_cadastro === null, JSON.stringify(e));
  check('T7.d zero pedido de CEP', e.pedir_cep === false, '');
  check('T7.e frete bloqueado', e.bloqueia_frete === true && cepLiberadoParaFrete(e) === false, '');
  check('T7.f bloco de CEP vazio', blocoCepCanonico(e) === '', blocoCepCanonico(e));
  const p = await persistirCepCanonico(e, '5511987653000');
  check('T7.g persistencia recusada por modalidade',
    p.persistido === false && p.motivo === 'modalidade_sem_frete' && PATCHES.length === 0, JSON.stringify(p));
}

// ── T8 — motoboy com CEP preenchido ─────────────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e, cad } = await turno('5511987653000', 'Vou mandar o motoboy buscar', { slots: { cep: '04573000' } });
  check('T8.a modalidade = motoboy', e.modalidade === 'motoboy', JSON.stringify(e));
  check('T8.b cadastro nao lido', cad.pessoa_id === null, JSON.stringify(cad));
  check('T8.c zero fluxo de CEP/Correios',
    e.pedir_cep === false && e.pedir_confirmacao_cep === false && blocoCepCanonico(e) === '', JSON.stringify(e));
  check('T8.d frete bloqueado mesmo com slots.cep', e.bloqueia_frete === true, '');
}

// ── T9 — REGRESSAO v4.34.0: replay Carolina ─────────────────────────────
reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
{
  const { e, cad } = await turno('5511952315439', 'A quantidade e 14\n\nForma de retirada : retirada presencial',
    { inboundsPedido: [{ message_text: 'Retirar' }] });
  check('T9.a modalidade = retirada, nivel 1', e.modalidade === 'retirada' && e.fonte_nivel === 1, JSON.stringify(e));
  check('T9.b zero CEP', e.pedir_cep === false && e.cep_cadastro === null && blocoCepCanonico(e) === '', JSON.stringify(e));
  check('T9.c zero frete', e.bloqueia_frete === true, '');
  check('T9.d cadastro nao consultado', cad.pessoa_id === null && cad.ambiguo === false, JSON.stringify(cad));
  // E com o CEP dela na mensagem, como no caso real:
  const comCep = await turno('5511952315439', 'Meu CEP e 05893-000 mas a forma de retirada e retirada presencial');
  check('T9.e CEP na mesma frase NAO desfaz a retirada',
    comCep.e.modalidade === 'retirada' && comCep.e.bloqueia_frete === true && comCep.cad.pessoa_id === null, JSON.stringify(comCep.e));
}

// ── T10 — REGRESSOES FINANCEIRAS (invariantes de codigo) ───────────────
{
  const ancoras = [
    "async function emitirAutorizacao(", "if (name === 'gerar_pix') {", "if (name === 'compor_total') {",
    "erro: 'operation_id_inventado',", "erro: 'valor_livre_recusado'", "async function guardaEgressoFinanceiro(",
    "const escolhida = lista.find((a: any) => a.kind === 'total')", "function checkoutMercadoPago(",
    "await sb.rpc('fn_valor_e_legitimo'", "orcamento_calcme_entrada", "RX_HOLD_ARTE_PAGAMENTO",
    "guardrail_dtf_metro_redirecionado", "async function blocoArquivosDoLead(", "const PIX_CHAVE_DESATIVADA = '30248650000111';",
    "guardrail_valor_diverge_cobranca_pendente", "codigo_pix_reenviado_da_cobranca_pendente",
  ];
  check('T10.a ancoras financeiras presentes', ancoras.every(a => CAND.includes(a)),
    JSON.stringify(ancoras.filter(a => !CAND.includes(a))));
  check('T10.b contagem identica a v4.34.0', ancoras.every(a => CAND.split(a).length === B434.split(a).length), '');
  check('T10.c persistencia de cadastro NUNCA roda em dry-run',
    CAND.includes('if (!dryRun && !estadoLog.bloqueia_frete) {\n    try {\n      const p = await persistirCepCanonico'), '');
  check('T10.d o PATCH so escreve o campo cep',
    CAND.includes("body: JSON.stringify({ cep: cep.slice(0, 5) + '-' + cep.slice(5) }),")
    && !/method: 'POST'[\s\S]{0,200}rest\/v1\/pessoas/.test(CAND), '');
}

// ── INVARIANTES v4.34.0 INTACTAS ───────────────────────────────────────
{
  const invariantes434 = [
    "if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {",
    "executada: false, enforcement_ativo: true,",
    "if (decisao.responde === true && estadoLog.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(resposta)) {",
    "resposta = perguntaDoQueFaltaFechamento(estadoLog,",
    "else if (ehCep && !estadoLog.bloqueia_frete)",
    "slotsNovos.modalidade_logistica = estadoLog.modalidade;",
    "declaracao_explicita_no_turno",
  ];
  check('E1 todas as invariantes da v4.34.0 continuam no codigo',
    invariantes434.every(a => CAND.includes(a)), JSON.stringify(invariantes434.filter(a => !CAND.includes(a))));
  check('E2 nenhuma frase antiga voltou',
    !CAND.includes('ASSUMA ENVIO: pe\\u00e7a o CEP completo, 8 d\\u00edgitos.')
    && !CAND.includes('Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?'), '');
  check('E3 leitura do cadastro so quando a modalidade admite frete',
    CAND.includes('if (!estadoLog.bloqueia_frete) {\n    cadastroPessoa = await lerPessoaCanonicaPorTelefone(phone);'), '');
  check('E4 versao logica v4.35.0', CAND.includes("const V = 'agente-noturno-v4.35.0';"), '');
  check('E5 bloco de CEP entra no systemFinal depois do de modalidade',
    CAND.includes('blocoModalidadeLogistica(estadoLog) + blocoCepCanonico(estadoLog)'), '');
  check('E6 guarda de frete com CEP nao confirmado existe',
    CAND.includes("erro: 'cep_do_cadastro_nao_confirmado'"), '');
}

// ── REFUTACAO ──────────────────────────────────────────────────────────
{
  reset(); setErpRows(DUAS_PESSOAS_MESMO_SUFIXO);
  const amb = await turno('5511987655000', 'Pode enviar');
  check('R1 dois casamentos = FAIL CLOSED, nenhum cadastro usado',
    amb.cad.pessoa_id === null && amb.cad.ambiguo === true && amb.e.cep_cadastro === null, JSON.stringify(amb.cad));
  const pAmb = await persistirCepCanonico(amb.e, '5511987655000');
  check('R2 ambiguidade nunca grava', pAmb.persistido === false && PATCHES.length === 0, JSON.stringify(pAmb));

  reset(); setErpRows([]);
  const semPessoa = await turno('5511900000000', 'Pode enviar pelos Correios');
  check('R3 sem pessoa no ERP: pede CEP normalmente, sem inventar cadastro',
    semPessoa.cad.pessoa_id === null && semPessoa.e.pedir_cep === true && semPessoa.e.pedir_confirmacao_cep === false, JSON.stringify(semPessoa.e));

  reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO); setErpFalha(true);
  const falha = await turno('5511987653000', 'Pode enviar pelos Correios');
  setErpFalha(false);
  check('R4 ERP fora do ar: degrada para pedir CEP, sem quebrar o turno',
    falha.cad.pessoa_id === null && falha.e.pedir_cep === true && ERROS.some(x => x.msg === 'cep_cadastro_http_erro'), JSON.stringify(falha.e));

  reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
  const outro = await turno('5511987653000', 'Nao e esse, mudei', { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: PERGUNTA_JOAO });
  check('R5 "nao e esse" descarta o CEP do cadastro e volta a pedir',
    outro.e.cep_conhecido === null && outro.e.pedir_cep === true && outro.e.cep_confirmado === false, JSON.stringify(outro.e));

  reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
  const semPergunta = await turno('5511987653000', 'Isso mesmo', { slots: { modalidade_logistica: 'envio' }, ultimaMsgJoao: 'Vamos fechar o pedido?' });
  check('R6 "isso mesmo" sem o Joao ter perguntado CEP NAO confirma CEP',
    semPergunta.e.cep_confirmado === false && semPergunta.e.pedir_confirmacao_cep === true, JSON.stringify(semPergunta.e));

  reset(); setErpRows(PESSOA_SEM_CEP);
  const curto = await turno('5511987654000', 'Meu CEP e 1234-567', { slots: { modalidade_logistica: 'envio' } });
  check('R7 CEP malformado nao vira CEP', curto.e.cep_conhecido === null && curto.e.pedir_cep === true, JSON.stringify(curto.e));

  reset(); setErpRows(PESSOA_COM_CEP_E_ENDERECO);
  const inativa = await turno('5511987653000', 'Pode enviar');
  setErpRows([{ ...PESSOA_COM_CEP_E_ENDERECO[0], ativo: false }]);
  const cadInativa = await lerPessoaCanonicaPorTelefone('5511987653000');
  check('R8 pessoa inativa nao serve de cadastro', cadInativa.pessoa_id === null, JSON.stringify(cadInativa));
  check('R9 mascara mostra so os 4 ultimos digitos do CEP, nunca o CEP inteiro', mascararCep('04573000') === '3000', mascararCep('04573000'));
  check('R10 CEP do cadastro nunca aparece inteiro no bloco',
    !blocoCepCanonico(inativa.e).includes('04573000'), blocoCepCanonico(inativa.e));
}

console.log(linhas.join('\n'));
console.log(`\n  >>> ${pass} PASS / ${fail} FAIL\n`);
process.exit(fail === 0 ? 0 : 1);
}
run();
