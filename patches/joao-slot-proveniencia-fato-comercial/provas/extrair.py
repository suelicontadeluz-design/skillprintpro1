# -*- coding: utf-8 -*-
"""Extrai VERBATIM do candidato o modulo de proveniencia de slot + as dependencias
que ele reusa (normalizarProdutoMacro, produtoNaMensagem e os RX de envio da v4.36.0).

Nenhuma linha do candidato e reescrita: o teste executa o codigo que sera publicado.
So o PREAMBULO de mocks e acrescentado, e ele fica claramente delimitado.
"""
import io, sys

src = io.open(sys.argv[1], encoding='utf-8').read()


def recorte(ini, fim_marca):
    i = src.index(ini)
    j = src.index(fim_marca, i)
    return src[i:j], i, j


# Bloco A — vocabulario de produto e deteccao na mensagem (v4.20+).
BLOCO_A, iA, _ = recorte("function produtoNaMensagem(msg: string): string | null {",
                         "const NOME_PRODUTO: Record<string, string>")

# Bloco B — os dois niveis de sinal de envio da v4.36.0, que o gate REUSA.
BLOCO_B, iB, _ = recorte("// v4.36.0: o sinal de envio passa a ter DOIS niveis",
                         "function sentencasLogisticas(txt: string): string[] {")

# Bloco C — normalizarProdutoMacro + o modulo de proveniencia da v4.37.0.
BLOCO_C, iC, _ = recorte("function normalizarProdutoMacro(v: any): string | null {",
                         "// MATRIZ produto x modalidade x ferramenta.")

for nome in ['SLOTS_CRITICOS', 'SLOTS_SO_DETERMINISTICOS', 'valorEcoaNoTexto',
             'evidenciaDeQuantidade', 'evidenciaDeProduto', 'filtrarSlotsPorProveniencia',
             'RX_EVID_UNIDADE_SUF', 'RX_EVID_PEDIDO', 'RX_EVID_DINHEIRO', 'RX_EVID_GRADE']:
    assert nome in BLOCO_C, 'faltou no extrato: ' + nome
for nome in ['RX_ENVIO_REMETENTE_CLIENTE', 'RX_ENVIO_OBJETO_NAO_LOGISTICO', 'RX_LOG_ENVIO_FORTE']:
    assert nome in BLOCO_B, 'faltou no extrato: ' + nome
for nome in ['produtoNaMensagem', 'RX_PROD_CAMISETA', 'RX_PROD_UV']:
    assert nome in BLOCO_A or nome in src, 'faltou no extrato: ' + nome

# As constantes RX_PROD_* vivem acima de produtoNaMensagem; recorta-as tambem.
# Para em `const sb = createClient`, que e o MUNDO e nao entra no extrato.
BLOCO_RX, _, _ = recorte("const RX_PROD_UV = ",
                         "const sb = createClient(")

MOCK = '''// ═══════ PREAMBULO DE MOCK — NAO FAZ PARTE DO CANDIDATO ═══════
// Substitui apenas o MUNDO (funcao de log). Nenhuma regra e reimplementada.
export const ERROS: any[] = [];
export function resetErros() { ERROS.length = 0; }
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }
function termoPositivo(s: string, rx: RegExp): boolean {
  // Recorte funcional de negacao usado pelo candidato. Nos testes de proveniencia
  // nenhuma frase usa negacao, entao o comportamento observavel e identico.
  return rx.test(s) && !/\\b(nao|n\\u00e3o)\\b[^.!?]{0,20}$/i.test(s);
}
// ═══════ FIM DO MOCK — daqui para baixo e recorte VERBATIM ═══════

'''

RODAPE = """

export {
  SLOTS_CRITICOS, SLOTS_SO_DETERMINISTICOS, semAcento, valorEcoaNoTexto,
  evidenciaDeQuantidade, evidenciaDeProduto, filtrarSlotsPorProveniencia,
  normalizarProdutoMacro, produtoNaMensagem,
  RX_EVID_PEDIDO, RX_EVID_DINHEIRO, RX_EVID_GRADE,
  RX_ENVIO_REMETENTE_CLIENTE, RX_ENVIO_OBJETO_NAO_LOGISTICO,
};
"""

cab = ("// GERADO AUTOMATICAMENTE por provas/extrair.py — NAO EDITAR.\n"
       "// Recorte VERBATIM de candidato/index.ts.\n\n")

io.open(sys.argv[2], 'w', encoding='utf-8').write(
    cab + MOCK + BLOCO_RX + "\n" + BLOCO_A + "\n" + BLOCO_B + "\n" + BLOCO_C + RODAPE)
sys.stderr.write('extraido %d bytes (A=%d B=%d C=%d RX=%d)\n'
                 % (len(BLOCO_A) + len(BLOCO_B) + len(BLOCO_C) + len(BLOCO_RX),
                    len(BLOCO_A), len(BLOCO_B), len(BLOCO_C), len(BLOCO_RX)))
