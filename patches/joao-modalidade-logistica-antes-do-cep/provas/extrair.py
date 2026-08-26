# -*- coding: utf-8 -*-
"""Extrai VERBATIM do candidato o modulo de modalidade logistica.
Nenhuma linha e reescrita: o teste executa o codigo que sera publicado."""
import io, sys
src = io.open(sys.argv[1], encoding='utf-8').read()
INI = "const DDD_UF: Record<string, string> ="
FIM = "  return partes.filter((p) => !testar.test(p)).join(' ')"
i = src.index(INI)
j = src.index(FIM)
j = src.index("\n}\n", j) + len("\n}\n")
bloco = src[i:j]

# perguntaDoQueFaltaFechamento ja esta dentro do bloco? (esta: vem antes de RX_SAIDA_TERMO_FRETE)
for nome in ['classificarDeclaracaoLogistica', 'resolverModalidadeLogistica', 'blocoModalidadeLogistica',
             'perguntaDoQueFaltaFechamento', 'removerSentencasComTermo', 'RX_SAIDA_TERMO_FRETE',
             'blocoLocalizacao', 'normalizarModalidadeSlot', 'cepDoTexto']:
    assert nome in bloco, 'faltou no extrato: ' + nome

cab = ("// GERADO AUTOMATICAMENTE por provas/extrair.py — NAO EDITAR.\n"
       "// Recorte VERBATIM de candidato/index.ts (bytes %d..%d).\n"
       "// Se o candidato mudar, rode o extrator de novo: o teste tem de exercitar o codigo real.\n\n" % (i, j))
rod = ("\n\nexport {\n"
       "  cepDoTexto, sentencasLogisticas, termoPositivo, classificarDeclaracaoLogistica,\n"
       "  normalizarModalidadeSlot, resolverModalidadeLogistica, blocoModalidadeLogistica,\n"
       "  perguntaDoQueFaltaFechamento, removerSentencasComTermo, RX_SAIDA_TERMO_FRETE,\n"
       "  blocoLocalizacao,\n"
       "};\n"
       "export type { ModalidadeLogistica, EstadoLogistico };\n")
io.open(sys.argv[2], 'w', encoding='utf-8').write(cab + bloco + rod)
sys.stderr.write('extraido %d bytes\n' % len(bloco))
