export type Pd5FileState = 'MOUNTED_FILE' | 'SEPARATE_ARTWORKS' | 'NO_ART' | 'UNKNOWN';

export type Pd5Decision = {
  responde: true;
  mensagem: string;
  tema: 'dtf_metro';
  encaminhou_venda: false;
  etapa: 'sondagem';
  slots: Record<string, unknown>;
  _pd5_reason: string;
};

export function pd5Norm(v: string): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const APPAREL = '(?:camisas?|camisetas?|baby\\s*look|oversized|moletom|moletons?|polos?|regatas?|uniformes?)';

export function pd5Kinds(inbound: string): { apparel: boolean; drinkware: boolean } {
  const t = pd5Norm(inbound);
  return {
    apparel: new RegExp(`\\b${APPAREL}\\b`).test(t),
    drinkware: /\b(canecas?|copos?|garrafas?)\b/.test(t),
  };
}

export function pd5ExplicitApparelApply(inbound: string): boolean {
  const t = pd5Norm(inbound);
  return new RegExp(`\\b(?:passar|aplicar|estampar|imprimir)\\b.{0,50}\\b(?:em|no|na|nos|nas|para|pra)\\s+(?:(?:o|a|os|as)\\s+)?${APPAREL}\\b`).test(t)
    || new RegExp(`\\b(?:para|pra)\\s+(?:passar|aplicar|estampar|imprimir)\\b.{0,50}\\b(?:em|no|na|nos|nas)\\s+(?:(?:o|a|os|as)\\s+)?${APPAREL}\\b`).test(t);
}

export function pd5DetectFileState(inbound: string): Pd5FileState {
  const t = pd5Norm(inbound);
  if (!t) return 'UNKNOWN';

  // Precedencia deliberada: se o cliente diz que TEM artes separadas, essa evidencia
  // vence uma negacao sobre "arquivo montado" na mesma frase.
  const separate = /\b(?:artes?|imagens?|arquivos?)\b.{0,30}\bseparad[oa]s?\b/.test(t)
    || /\b(?:tenho|possuo|ja\s+tenho)\s+(?:as|minhas?)\s+(?:artes?|imagens?)\b/.test(t)
    || /\b(?:artes?|imagens?)\s+soltas?\b/.test(t);
  if (separate) return 'SEPARATE_ARTWORKS';

  const deniesMounted = /\bnao\s+(?:tenho|possuo)\b.{0,35}\b(?:arquivo|folha|gang\s*sheet|gangsheet)\b.{0,35}\bmontad[oa]s?\b/.test(t)
    || /\b(?:arquivo|folha|gang\s*sheet|gangsheet)\b.{0,24}\bnao\s+(?:esta|ta)\s+montad[oa]\b/.test(t)
    || /\bsem\s+(?:o\s+|um\s+)?(?:arquivo|folha)\b.{0,24}\bmontad[oa]\b/.test(t);

  const mounted = /\b(?:arquivo|folha|gang\s*sheet|gangsheet)\b.{0,45}\b(?:montad[oa]s?|pront[oa]s?|fechad[oa]s?|diagramad[oa]s?)\b/.test(t)
    || /\b(?:ja\s+)?(?:esta|ta)\s+(?:tudo\s+)?montad[oa]\b/.test(t)
    || /\b(?:ja\s+)?tenho\s+(?:o\s+)?arquivo\s+(?:ja\s+)?(?:montad[oa]|pront[oa])\b/.test(t);
  if (mounted && !deniesMounted) return 'MOUNTED_FILE';

  const noArt = /\b(?:nao\s+tenho|sem)\s+(?:nenhuma?s?\s+)?(?:arte|artes|imagem|imagens)\b/.test(t)
    || /\bpreciso\s+(?:que\s+)?(?:facam|fazer|criar)\s+(?:a\s+)?arte\b/.test(t);
  if (noArt) return 'NO_ART';

  return 'UNKNOWN';
}

export function pd5FileStateQuestionWasAsked(text: string): boolean {
  const t = pd5Norm(text);
  return /arquivo\s+montado/.test(t) && /artes?\s+separadas?/.test(t);
}

export function pd5HasTrustedTextileContext(recentUserTexts: string[]): boolean {
  return recentUserTexts.some((text) => {
    const t = pd5Norm(text);
    const kinds = pd5Kinds(text);
    return (/\bdtf\s+textil\b/.test(t) || pd5ExplicitApparelApply(text)) && !kinds.drinkware;
  });
}

export function pd5BuildDecision(args: {
  inbound: string;
  previousAssistant?: string;
  recentUserTexts?: string[];
}): Pd5Decision | null {
  const inbound = String(args.inbound || '');
  const kinds = pd5Kinds(inbound);
  const explicitTextile = pd5ExplicitApparelApply(inbound) && kinds.apparel && !kinds.drinkware;
  const answeringStateQuestion = pd5FileStateQuestionWasAsked(String(args.previousAssistant || ''))
    && pd5HasTrustedTextileContext(args.recentUserTexts || []);

  if (!explicitTextile && !answeringStateQuestion) return null;

  const state = pd5DetectFileState(inbound);
  if (state === 'MOUNTED_FILE') {
    return {
      responde: true,
      mensagem: 'Perfeito. Como o arquivo já está montado, me envie pelo formulário de upload do DTF têxtil. Vou conferir o próprio arquivo para medir a metragem e validar a preparação; não precisa me passar o tamanho de cada arte.',
      tema: 'dtf_metro', encaminhou_venda: false, etapa: 'sondagem',
      slots: { produto: 'dtf_textil', arquivo_estado: 'MOUNTED_FILE' },
      _pd5_reason: 'mounted_file_explicit',
    };
  }

  if (state === 'SEPARATE_ARTWORKS') {
    return {
      responde: true,
      mensagem: 'Perfeito. Você quer que a Skillprint monte essas artes no arquivo de impressão para você?',
      tema: 'dtf_metro', encaminhou_venda: false, etapa: 'sondagem',
      slots: { produto: 'dtf_textil', arquivo_estado: 'SEPARATE_ARTWORKS' },
      _pd5_reason: 'separate_artworks_explicit',
    };
  }

  if (state === 'NO_ART') {
    return {
      responde: true,
      mensagem: 'Sem problema. Posso te ajudar por três caminhos: pack de artes prontas, nosso Studio para preparar a estampa, ou criação da arte. Qual deles faz mais sentido para você?',
      tema: 'dtf_metro', encaminhou_venda: false, etapa: 'sondagem',
      slots: { produto: 'dtf_textil', arquivo_estado: 'NO_ART' },
      _pd5_reason: 'no_art_explicit',
    };
  }

  if (explicitTextile) {
    return {
      responde: true,
      mensagem: 'Perfeito, então é DTF têxtil para aplicar nas peças. Você já tem o arquivo montado e pronto para impressão ou tem as artes separadas? Se ainda não tiver a arte, também consigo te orientar.',
      tema: 'dtf_metro', encaminhou_venda: false, etapa: 'sondagem',
      slots: { produto: 'dtf_textil' },
      _pd5_reason: 'ask_file_state_before_dimensions',
    };
  }

  return null;
}
