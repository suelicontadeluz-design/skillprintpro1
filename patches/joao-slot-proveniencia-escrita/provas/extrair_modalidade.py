# -*- coding: utf-8 -*-
"""Extrai VERBATIM do candidato o modulo de modalidade logistica + CEP canonico.
Nenhuma linha do candidato e reescrita: o teste executa o codigo que sera publicado.
So o PREAMBULO de mocks e acrescentado, e ele fica claramente delimitado."""
import io, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
INI = "const DDD_UF: Record<string, string> ="
FIM = "  return partes.filter((p) => !testar.test(p)).join(' ')"
i = src.index(INI); j = src.index(FIM); j = src.index("\n}\n", j) + len("\n}\n")
bloco = src[i:j]

for nome in ['classificarDeclaracaoLogistica', 'resolverModalidadeLogistica', 'blocoModalidadeLogistica',
             'perguntaDoQueFaltaFechamento', 'removerSentencasComTermo', 'RX_SAIDA_TERMO_FRETE',
             'blocoLocalizacao', 'normalizarModalidadeSlot', 'cepDoTexto',
             'lerPessoaCanonicaPorTelefone', 'refinarCepComCadastro', 'persistirCepCanonico',
             'blocoCepCanonico', 'cepLiberadoParaFrete', 'PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO']:
    assert nome in bloco, 'faltou no extrato: ' + nome

MOCK = '''// ═══════ PREAMBULO DE MOCK — NAO FAZ PARTE DO CANDIDATO ═══════
// Substitui apenas o MUNDO (ERP por HTTP e log). Nenhuma regra e reimplementada.
export const ERROS: any[] = [];
export const PATCHES: any[] = [];
let ERP_ROWS: any[] = [];
export function setErpRows(r: any[]) { ERP_ROWS = r; }
export function reset() { ERROS.length = 0; PATCHES.length = 0; ERP_ROWS = []; }
export let ERP_FALHA = false;
export function setErpFalha(v: boolean) { ERP_FALHA = v; }
const ERP_URL = 'https://erp.test';
const ERP_SERVICE_KEY = 'chave-de-teste';
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }
const fetch = async (url: any, init?: any): Promise<any> => {
  const u = String(url);
  if (ERP_FALHA) return { ok: false, status: 503, json: async () => ({}) };
  if ((init?.method || 'GET') === 'PATCH') {
    PATCHES.push({ url: u, body: JSON.parse(String(init.body)) });
    return { ok: true, status: 204, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ERP_ROWS };
};
// ═══════ FIM DO MOCK — daqui para baixo e recorte VERBATIM ═══════

'''
cab = ("// GERADO AUTOMATICAMENTE por provas/extrair.py — NAO EDITAR.\n"
       "// Recorte VERBATIM de candidato/index.ts (bytes %d..%d).\n\n" % (i, j))
rod = ("\n\nexport {\n"
       "  cepDoTexto, sentencasLogisticas, termoPositivo, classificarDeclaracaoLogistica,\n"
       "  normalizarModalidadeSlot, resolverModalidadeLogistica, blocoModalidadeLogistica,\n"
       "  perguntaDoQueFaltaFechamento, removerSentencasComTermo, RX_SAIDA_TERMO_FRETE,\n"
       "  blocoLocalizacao, lerPessoaCanonicaPorTelefone, refinarCepComCadastro,\n"
       "  persistirCepCanonico, blocoCepCanonico, cepLiberadoParaFrete, mascararCep,\n"
       "  CADASTRO_VAZIO, PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO,\n"
       "};\n"
       "export type { ModalidadeLogistica, EstadoLogistico, PessoaCadastro };\n")
io.open(sys.argv[2], 'w', encoding='utf-8').write(cab + MOCK + bloco + rod)
sys.stderr.write('extraido %d bytes\n' % len(bloco))
