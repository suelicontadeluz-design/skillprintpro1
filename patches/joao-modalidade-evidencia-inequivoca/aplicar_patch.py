#!/usr/bin/env python3
# Aplica o patch v4.37.1 -> v4.38.0 sobre a copia exata da producao.
# Substituicoes por numero de linha (1-based), de baixo para cima, com assercao de conteudo.
import sys

F = 'patches/joao-modalidade-evidencia-inequivoca/candidato/index.ts'
with open(F, encoding='utf-8') as f:
    L = f.read().split('\n')

def assert_line(n, must_contain):
    if must_contain not in L[n-1]:
        print(f'FALHA: linha {n} nao contem [{must_contain}]: {L[n-1][:120]}'); sys.exit(1)

def replace(start, end, new_lines):
    L[start-1:end] = new_lines

# ── E: invocacao da guarda de saida (inserir apos linha 4271, fim do bloco !respondeValido)
assert_line(4267, 'if (!respondeValido) {')
assert_line(4271, '}')
guard_call = '''
  // ══ v4.38.0 P0: GUARDA DE SAIDA — a resposta final nao pode afirmar modalidade nem citar
  // CEP sem evidencia do cliente. Roda DEPOIS de todo fallback/retry (o texto aqui e final)
  // e ANTES de slots/estado/envio, nos dois modos (dry-run inclusive). Nunca toca mensagem
  // que carrega Pix nascido no turno: cobranca real tem prioridade (invariante da v107).
  if (!ctx.pixGerado?.ok) {
    const gm = guardaTextoModalidadeSemEvidencia(resposta, estadoLog);
    if (gm.bloqueia) {
      await logErro('guardrail_texto_modalidade_sem_evidencia', {
        phone, lead: leadId, turn_id: obsTurnId, agent_version: V, gatilho: gm.gatilho,
        resposta_original: String(resposta).slice(0, 250),
      });
      toolsUsadas.push('texto_modalidade_bloqueado');
      resposta = gm.substituta;
    }
  }'''.split('\n')
L[4271:4271] = guard_call

# ── D: texto da interceptacao de calcular_frete para 'desconhecida' (linha 3134)
assert_line(3134, 'A forma de entrega ainda NAO foi resolvida e retirada e plausivel')
replace(3134, 3134, ["                ? 'A forma de entrega ainda NAO foi resolvida. Pergunte em UMA frase se ele quer envio pelos Correios ou retirada aqui em Embu, e NAO peca CEP antes da resposta.'"])

# ── F: funcao da guarda de saida (inserir apos linha 886, fim de perguntaDoQueFaltaFechamento)
assert_line(886, '}')
assert_line(885, 'Para gerar a cobran')
guard_fn = '''
// ══ v4.38.0 P0: GUARDA DE SAIDA DE MODALIDADE — ver manifesto no topo do arquivo ══
// So atua quando o resolvedor NAO tem evidencia (modalidade 'desconhecida') e o produto nao
// e digital. NAO e regra por frase: "obrigada" nao aparece aqui. O que ela verifica e a
// RESPOSTA: sem evidencia do cliente, afirmar modalidade ou citar CEP e proibido em qualquer
// regiao. Pergunta que OFERECE a escolha (cita retirada E envio) nao e afirmacao e passa.
// Nota de regex: \\b nao funciona ao lado de acento ([\\u00e9]); os limites usam (?:^|\\s).
const RX_TXT_CITA_CEP = /\\bcep\\b/i;
const RX_TXT_AFIRMA_MODALIDADE = /(?:^|\\s)(?:ent[a\\u00e3]o\\s+)?(?:[e\\u00e9]|vai\\s+ser|ser[a\\u00e1]|fica(?:ria)?\\s+(?:por|como))\\s+(?:por\\s+)?(?:envio|retirada|entrega\\s+em\\s+casa)(?:$|[\\s.,!?])/i;
function guardaTextoModalidadeSemEvidencia(texto: string, e: EstadoLogistico): { bloqueia: boolean; gatilho: string | null; substituta: string } {
  const substituta = 'S\\u00f3 me confirma a forma de entrega: retirada aqui em Embu das Artes ou envio pelos Correios?';
  if (e.modalidade !== 'desconhecida' || e.produto_digital) return { bloqueia: false, gatilho: null, substituta };
  const t = String(texto || '');
  if (RX_TXT_CITA_CEP.test(t)) return { bloqueia: true, gatilho: 'citou_cep_sem_modalidade_resolvida', substituta };
  const ofereceEscolha = /retirad/i.test(t) && /envio|correios|sedex|entrega/i.test(t);
  if (!ofereceEscolha && RX_TXT_AFIRMA_MODALIDADE.test(t)) return { bloqueia: true, gatilho: 'afirmou_modalidade_sem_evidencia', substituta };
  return { bloqueia: false, gatilho: null, substituta };
}'''.split('\n')
L[886:886] = guard_fn

# ── C: blocoModalidadeLogistica, ramo final (linhas 864-865)
assert_line(864, 'ENVIO \\u00e9 o caminho prov\\u00e1vel' if False else 'ENVIO')
assert_line(865, 'cep_conhecido')
replace(864, 865, [
  "  return '\\n\\n[MODALIDADE LOG\\u00cdSTICA N\\u00c3O RESOLVIDA. O cliente est\\u00e1 fora da Grande SP, ent\\u00e3o ENVIO \\u00e9 o caminho prov\\u00e1vel — mas isso \\u00e9 pista, n\\u00e3o fato. N\\u00c3O afirme que \\u00e9 envio. Cortesia (\"obrigada\", \"ok\", \"beleza\"), emoji e sil\\u00eancio N\\u00c3O s\\u00e3o escolha de modalidade. Fa\\u00e7a UMA pergunta: envio pelos Correios ou retirada aqui em Embu?'",
  "    + '\\nPROIBIDO pedir CEP antes da resposta do cliente. PROIBIDO calcular frete. PROIBIDO oferecer PAC ou Sedex.'",
  "    + (e.cep_conhecido ? ` O CEP ${e.cep_conhecido} j\\u00e1 \\u00e9 conhecido (fonte: ${e.cep_fonte}): quando o envio for confirmado, N\\u00c3O pe\\u00e7a de novo.]` : ']');",
])

# ── B: montar() — 'desconhecida' bloqueia frete/CEP em qualquer regiao (linhas 792-798)
assert_line(793, 'indefinidaComRetiradaPlausivel = m === ')
assert_line(798, "'sem_bloqueio'")
replace(793, 798, [
  "    // v4.38.0: 'desconhecida' bloqueia frete/CEP em QUALQUER regiao. A versao anterior so",
  "    // bloqueava na Grande SP; fora dela, pedir_cep=true fazia blocoCepCanonico emitir",
  "    // \"[CEP AUSENTE: peca o CEP]\" com ZERO evidencia do cliente — caso sentinela 29/08,",
  "    // 5521993457646: \"Obrigada\" respondendo a pergunta de modalidade virou \"entao e envio\".",
  "    const indefinida = m === 'desconhecida';",
  "    const bloqueia = semFretePorModalidade || produtoDigital || indefinida;",
  "    const motivo = produtoDigital ? 'produto_digital_sem_frete'",
  "      : semFretePorModalidade ? ('modalidade_' + m + '_nao_tem_frete')",
  "      : indefinida ? (grandeSP ? 'modalidade_indefinida_com_retirada_plausivel' : 'modalidade_indefinida_sem_declaracao_do_cliente')",
  "      : 'sem_bloqueio';",
])

# ── A: manifesto de versao + V (linha 362)
assert_line(362, "const V = 'agente-noturno-v4.37.1';")
replace(362, 362, '''// ══ v4.38.0 (30/08/2026) — GUARDA DE SAIDA: EVIDENCIA INEQUIVOCA DE MODALIDADE ══
// A frente anunciada acima ("guarda de saida, v4.38.0") comeca aqui. Caso sentinela
// 5521993457646 (29/08/2026 18:24-18:27):
//   Joao: "Como vai ser a entrega, retirada aqui em Embu ou envio?"  Cliente: "Obrigada"
//   Joao: "Perfeito, entao e envio. Me passa o CEP de 8 digitos..."
// O resolvedor disse 'desconhecida' (nivel 4, DDD 21) e a guarda de proveniencia da v4.37.0
// rejeitou o slot 'envio' proposto pelo modelo — e o TEXTO saiu mesmo assim, porque com
// bloqueia_frete=false o prompt recebia ao mesmo tempo "ENVIO e o caminho provavel" e
// "[CEP AUSENTE: peca o CEP UMA vez]". O modelo obedeceu a instrucao que o codigo emitiu.
// TRES fechos, nenhum por frase especifica ("obrigada" nao aparece em regra nenhuma):
//   1. montar(): 'desconhecida' passa a bloquear frete/CEP em QUALQUER regiao — cortesia,
//      emoji e silencio nunca foram evidencia; fora da Grande SP agora tambem nao sao.
//   2. blocoModalidadeLogistica(): fora da Grande SP sem modalidade resolvida, a instrucao
//      vira pergunta explicita (envio ou retirada?) com CEP proibido antes da resposta.
//   3. guardaTextoModalidadeSemEvidencia(): barreira TERMINAL deterministica no texto da
//      resposta. Texto de prompt nao resolve (licao da v4.34.0): a barreira e codigo.
// Nada financeiro muda; niveis 1-3 (declaracao real do cliente) seguem byte-identicos.
const V = 'agente-noturno-v4.38.0';'''.split('\n'))

with open(F, 'w', encoding='utf-8') as f:
    f.write('\n'.join(L))
print('ok: patch aplicado,', len(L), 'linhas')
