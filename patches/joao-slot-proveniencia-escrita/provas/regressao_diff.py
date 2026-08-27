# -*- coding: utf-8 -*-
"""Prova de nao-regressao por DIFF, nao por declaracao — frente v4.37.0.
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
    # Os TRES unicos segmentos que a frente v4.37.0 altera de proposito.
    "const V = 'agente-noturno-v4.36.0';",
    "const slotsRecebidos: any = decisao.slots || {};",
    "const propostas: Array<{ slot: string; motivo: string }> = [];",
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
