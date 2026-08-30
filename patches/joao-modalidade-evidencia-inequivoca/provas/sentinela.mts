// REPLAY DETERMINISTICO DO CASO SENTINELA — efeito-zero por construcao (nenhum I/O).
// Caso real: phone 5521993457646, lead 3b12c20f-2824-4ab4-96e5-ccc69aa9d311, 29/08/2026.
// Uso: node --experimental-strip-types sentinela.mts <caminho_do_modulo.mts>
const modPath = process.argv[2];
const m = await import(modPath);

const PHONE = '5521993457646';
const INB_1 = 'Olá! Posso ter mais informações sobre isso?';
const INB_2 = 'Tenho 10 imagens que preciso para para o papel tranafer, seriam:\n\n3 nos tamanhos de 13 x 15;\n\n1 no tamanho de 15 x 20;\n\n4 no tamanho de 20 x 25;\n\nTem como me passar o orçamento?\n\n2 no tamanho de 25 x 20';
const OBRIGADA = 'Obrigada';
const NAO_PRECISA = 'Não precisa\nObrigada';
const SLOTS = { arte: 'multiplas_medidas', produto: 'dtf_textil', quantidade: 10 };

function turno(nome: string, mensagemAtual: string, inboundsDesc: string[], slots: any) {
  const e = m.resolverModalidadeLogistica({
    mensagemAtual,
    inboundsPedido: inboundsDesc.map((t) => ({ message_text: t })),
    historicoInbound: [],           // primeiro contato: nada antes de 14h atras
    slots, phone: PHONE, freteJa: null, produtoContexto: 'dtf_textil',
  });
  const blocoMod = m.blocoModalidadeLogistica(e);
  const blocoCep = m.blocoCepCanonico(e);
  return {
    turno: nome,
    classificacao_mensagem_atual: m.classificarDeclaracaoLogistica(mensagemAtual),
    modalidade: e.modalidade, proveniencia: e.proveniencia, fonte_nivel: e.fonte_nivel,
    evidencia: e.evidencia, bloqueia_frete: e.bloqueia_frete, motivo_bloqueio: e.motivo_bloqueio,
    pedir_cep: e.pedir_cep,
    prompt_instrui_pedir_cep: /CEP AUSENTE|peça o CEP|peça UMA vez/i.test(blocoCep) || /CEP ainda falta: peça/i.test(blocoMod),
    prompt_diz_envio_provavel: /ENVIO é o caminho provável/i.test(blocoMod),
    prompt_manda_perguntar_modalidade: /Faça UMA pergunta|pergunte em UMA frase|Pergunte em UMA frase/i.test(blocoMod),
    prompt_proibe_pedir_cep: /PROIBIDO pedir CEP/i.test(blocoMod),
    bloco_modalidade: blocoMod.replace(/\n/g, ' ').trim(),
    bloco_cep: blocoCep.replace(/\n/g, ' ').trim(),
  };
}

const resultados = [
  turno('T2_defeituoso_apos_Obrigada', OBRIGADA, [OBRIGADA, INB_2, INB_1], SLOTS),
  turno('T3_apos_Nao_precisa', NAO_PRECISA, [NAO_PRECISA, OBRIGADA, INB_2, INB_1], SLOTS),
];

// Guarda terminal de texto (se o modulo exportar — candidato v4.38.0). No baseline nao existe.
const temGuardaTexto = typeof m.guardaTextoModalidadeSemEvidencia === 'function';
const TEXTO_REAL_DEFEITUOSO = 'Perfeito, então é envio. Me passa o CEP de 8 dígitos para a gente calcular o frete.';
let guardaTexto: any = { existe: temGuardaTexto };
if (temGuardaTexto) {
  const e2 = m.resolverModalidadeLogistica({
    mensagemAtual: OBRIGADA, inboundsPedido: [OBRIGADA, INB_2, INB_1].map((t) => ({ message_text: t })),
    historicoInbound: [], slots: SLOTS, phone: PHONE, freteJa: null, produtoContexto: 'dtf_textil',
  });
  guardaTexto = { existe: true, resultado: m.guardaTextoModalidadeSemEvidencia(TEXTO_REAL_DEFEITUOSO, e2) };
}

console.log(JSON.stringify({ resultados, guarda_terminal_de_texto: guardaTexto }, null, 2));
