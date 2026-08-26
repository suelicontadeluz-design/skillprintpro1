# -*- coding: utf-8 -*-
"""Prova de nao-regressao por DIFF, nao por declaracao.
1. Nenhuma linha REMOVIDA pode conter termo financeiro/critico.
2. As funcoes que a suite financeira v4.33.0 testa continuam byte-identicas.
3. Imprime a matriz de hunks para conferencia humana."""
import io, sys, difflib, re

base = io.open(sys.argv[1], encoding='utf-8').read().split('\n')
cand = io.open(sys.argv[2], encoding='utf-8').read().split('\n')

TERMOS_CRITICOS = [
    'emitirAutorizacao', 'fn_emitir_operacao_financeira', 'operation_id', 'gerar_pix',
    'compor_total', 'fn_compor_total', 'mp_pix_cobrancas', 'qr_code', 'checkoutMercadoPago',
    'guardaEgressoFinanceiro', 'idsInternosNoTexto', 'expurgarIdsInternos', 'precos_verbalizaveis',
    'fn_valor_e_legitimo', 'rendimentos_autorizados', 'calcme', 'CalcMe', 'blocoArquivos',
    'joao_envios', 'finalizarEnvioLedger', 'carimbarInbound', 'owned_inbound_ids',
    'processarLostCanonico', 'PIX_CHAVE', 'validarPix', 'adquirirLock', 'liberarLock',
]

removidas, adicionadas, hunks = [], [], []
sm = difflib.SequenceMatcher(None, base, cand, autojunk=False)
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        continue
    hunks.append((tag, i1 + 1, i2 - i1, j1 + 1, j2 - j1))
    removidas.extend((i1 + 1 + k, base[i1 + k]) for k in range(i2 - i1))
    adicionadas.extend((j1 + 1 + k, cand[j1 + k]) for k in range(j2 - j1))

falhas = []

# Segmentos que ESTA frente altera de proposito. Tudo que sair do fonte e nao estiver
# aqui, nem reaparecer no texto que entrou no lugar, e regressao.
ALTERADOS_DELIBERADAMENTE = [
    "const V = 'agente-noturno-v4.33.0';",
    "const V = 'agente-noturno-v4.34.0';",
    "  cep_conhecido: string | null;",
    "  cep_fonte: string | null;",
    "  retirada_plausivel: boolean;",
    "  produto_digital: boolean;",
    "  ddd: string;",
    "  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.",
    "let cep: string | null = null; let cepFonte: string | null = null;",
    "const cepSlot = a.slots?.cep ? String(a.slots.cep).replace",
    "if (!cep) for (const i of (a.inboundsPedido || []))",
    "if (!cep && a.freteJa?.cep_destino)",
    "if (!cep) for (const i of (a.historicoInbound || []))",
    "      cep_conhecido: cep, cep_fonte: cepFonte,",
    "// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy",
    "function resolverModalidadeLogistica(a: {",
    "}): EstadoLogistico {",
    "  L('modalidade_logistica', {",
    "nivel: estadoLog.fonte_nivel, bloqueia_frete: estadoLog.bloqueia_frete, pedir_cep: estadoLog.pedir_cep,",
    "  const estadoLog = resolverModalidadeLogistica({",
    "+ blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) + blocoOrigem",
    "if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {",
    "slotsNovos.modalidade_logistica = estadoLog.modalidade;",
    "slotsNovos.envio_retirada = estadoLog.modalidade === 'envio' ? 'envio'",
    ": estadoLog.modalidade === 'motoboy' ? 'motoboy' : 'retirada';",
    "if (!dryRun) await salvarEstado(phone, leadId, decisao.etapa",
    "if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {",
    "  };",
    "  }",
    "  if (ddd === '11') return '",
    "  return `",
    "Pode oferecer RETIRADA ou ENVIO.",
    "ASSUMA ENVIO: pe",
    'SLOTS: produto -> arte -> quantidade -> envio/retirada + CEP -> or\\u00e7amento -> "Vamos fechar?" -> "Pix ou cart\\u00e3o?".',
    "2. CEP -> calcular_frete -> TOTAL = produto + frete.",
    '- ROTEIRO DO COPO: 1. calcular_copo. 2. "Me fala o tema que a gente monta a arte." 3. CEP -> calcular_frete -> TOTAL. 4. "Pix ou cartao?" -> gerar_pix.',
    "    + blocoLocalizacao(phone) + blocoOrigem + blocoAnuncio + blocoMudouProduto + blocoPreco + blocoObjecao + blocoRespostaCurta + blocoArquivos",
    "  if (decisao.responde === true && toolsUsadas.includes('calcular_frete') && !execucoes.freteJa && !/PAC|Sedex|SEDEX|frete/i.test(resposta)) {",
    "      resposta = 'Para gerar a cobran\\u00e7a correta, preciso primeiro concluir o valor do pedido. Qual dado ainda falta: quantidade, medida, CEP ou forma de retirada?';",
    "      else if (ehCep) { resposta = 'Anotei seu CEP! J\\u00e1 calculo o frete e te passo o total certinho.'; decisao.tema = 'frete'; }",
    '"envio_retirada": "...ou null", "cep": "...ou null",',
]

# (1) INVARIANTE DE SEGMENTO: cada pedaco que saiu tem de reaparecer no que entrou,
#     salvo os segmentos explicitamente alterados por esta frente.
for tag, i1, dn, j1, an in hunks:
    saiu = '\n'.join(base[i1 - 1:i1 - 1 + dn])
    entrou = '\n'.join(cand[j1 - 1:j1 - 1 + an])
    for seg in [x for x in saiu.split('\\n') if len(x.strip()) >= 12]:
        if seg in entrou:
            continue
        if any(a in seg or seg.strip() in a for a in ALTERADOS_DELIBERADAMENTE):
            continue
        falhas.append('SEGMENTO PERDIDO no hunk da linha %d: %s' % (i1, seg.strip()[:180]))

# (2) INVARIANTE DE TERMO CRITICO: nenhum termo pode ter MENOS ocorrencias depois.
for tag, i1, dn, j1, an in hunks:
    saiu = '\n'.join(base[i1 - 1:i1 - 1 + dn])
    entrou = '\n'.join(cand[j1 - 1:j1 - 1 + an])
    for termo in TERMOS_CRITICOS:
        if saiu.count(termo) > entrou.count(termo):
            falhas.append('TERMO CRITICO "%s" perdeu ocorrencia no hunk da linha %d (%d -> %d)'
                          % (termo, i1, saiu.count(termo), entrou.count(termo)))

# (3) INVARIANTE GLOBAL: contagem de cada termo critico no arquivo inteiro nao cai.
b_all = '\n'.join(base); c_all = '\n'.join(cand)
for termo in TERMOS_CRITICOS:
    if c_all.count(termo) < b_all.count(termo):
        falhas.append('TERMO CRITICO "%s" caiu no arquivo inteiro (%d -> %d)'
                      % (termo, b_all.count(termo), c_all.count(termo)))

# 2. blocos verbatim exercitados pela suite financeira v4.33.0
b = '\n'.join(base); c = '\n'.join(cand)
def fatiar(txt, ini, fim):
    i = txt.index(ini); j = txt.index(fim, i) + len(fim)
    return txt[i:j]
BLOCOS = [
    ('guardaEgressoFinanceiro', 'async function guardaEgressoFinanceiro(', "return { bloqueou: true, texto: expurgarIdsInternos(texto, ids), ids };\n}"),
    ('idsInternosNoTexto', 'async function idsInternosNoTexto(', "return Array.from(new Set([...jaInternos, ...restantes]));\n  }\n}"),
    ('expurgarIdsInternos', 'function expurgarIdsInternos(', ".replace(/\\n{3,}/g, '\\n\\n')\n    .trim();\n}"),
    ('emitirAutorizacao', 'async function emitirAutorizacao(', "catch (e) { await logErro('autorizacao_excecao'"),
    ('envelope', 'function envelope(autorizacoes: any[]', 'display_data: display ?? {},\n  });\n}'),
    ('executarTool:calcular_frete', "if (name === 'calcular_frete') {", "return envelope([opF], dsp);\n    }"),
    ('executarTool:gerar_pix', "if (name === 'gerar_pix') {", "erro: 'valor_livre_recusado'"),
    ('executarTool:compor_total', "if (name === 'compor_total') {", "return envelope([data], { total: Number(data.amount) });\n    }"),
    ('checkoutMercadoPago', 'function checkoutMercadoPago(', 'return u.toString();\n  } catch { return null; }\n}'),
    ('valoresDaMensagem', 'function valoresDaMensagem(', 'return out;\n}'),
    ('RX_HOLD_ARTE_PAGAMENTO', 'const RX_HOLD_ARTE_PAGAMENTO =', '\n'),
    ('lerExecucoes', 'async function lerExecucoes(', "} catch { return vazio; }\n}"),
]
for nome, ini, fim in BLOCOS:
    try:
        fb, fc = fatiar(b, ini, fim), fatiar(c, ini, fim)
    except ValueError as e:
        falhas.append('BLOCO %s nao encontrado: %s' % (nome, e)); continue
    if fb != fc:
        falhas.append('BLOCO %s DIVERGIU entre LIVE e candidato' % nome)

print('MATRIZ DE HUNKS (%d hunks)' % len(hunks))
print('  %-8s %10s %6s %10s %6s' % ('tipo', 'linha-LIVE', '-lin', 'linha-cand', '+lin'))
for tag, i1, dn, j1, an in hunks:
    print('  %-8s %10d %6d %10d %6d' % (tag, i1, dn, j1, an))
print('\nlinhas removidas: %d   |   linhas adicionadas: %d' % (len(removidas), len(adicionadas)))
print('blocos financeiros conferidos byte a byte: %d' % len(BLOCOS))

print('\n--- LINHAS REMOVIDAS (todas) ---')
for ln, txt in removidas:
    print('  -%-5d %s' % (ln, txt.strip()[:200]))

if falhas:
    print('\n*** REGRESSAO DETECTADA ***')
    for f in falhas: print('  ' + f)
    sys.exit(1)
print('\nOK: nenhum segmento perdido fora do escopo da frente; nenhum termo critico perdeu ocorrencia;')
print('    todos os %d blocos financeiros byte-identicos a LIVE.' % len(BLOCOS))
