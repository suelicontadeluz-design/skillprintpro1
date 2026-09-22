export const SERVICE_MODE = Object.freeze({
  FINISHED: 'FINISHED_PERSONALIZED',
  TRANSFER: 'TRANSFER_ONLY',
});

export function smNorm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasApparel(text) {
  return /\b(camisas?|camisetas?|baby\s*look|babylook|oversized|oversize|moletons?|polos?|pecas?|roupas?)\b/.test(smNorm(text));
}

export function smStrongSignal(text, previousAssistant = '') {
  const t = smNorm(text);
  const prev = smNorm(previousAssistant);
  if (!t) return null;

  const ownsPiece = /\b(?:ja\s+tenho|eu\s+tenho|tenho\s+(?:as?|os?)|vou\s+levar|pecas?\s+(?:sao|minhas?))\b.{0,45}\b(?:camisas?|camisetas?|pecas?|roupas?)\b/.test(t)
    || /\b(?:camisas?|camisetas?|pecas?|roupas?)\b.{0,45}\b(?:ja\s+tenho|eu\s+tenho|sao\s+minhas?|vou\s+levar)\b/.test(t);
  const selfApply = /\b(?:eu\s+)?(?:vou|quero|preciso)\s+(?:eu\s+)?(?:aplicar|estampar|prensar)\b/.test(t)
    || /\bpara\s+(?:eu\s+)?(?:aplicar|estampar|prensar)\b/.test(t);
  const onlyTransfer = /\b(?:so|somente|apenas)\b.{0,35}\b(?:dtf|impressao|transfer|estampa)\b/.test(t)
    || /\b(?:nao\s+quero|sem)\b.{0,30}\b(?:camisa|camiseta|peca)\b/.test(t);
  if (onlyTransfer || (hasApparel(t) && (ownsPiece || selfApply))) return SERVICE_MODE.TRANSFER;

  const readyPiece = /\b(?:camisas?|camisetas?|pecas?|moletons?|polos?)\b.{0,45}\b(?:pront[oa]s?|personalizad[oa]s?)\b/.test(t)
    || /\b(?:pront[oa]s?|personalizad[oa]s?)\b.{0,45}\b(?:camisas?|camisetas?|pecas?|moletons?|polos?)\b/.test(t);
  const pricePerPiece = /\b(?:quanto|qto|valor|preco|custa|sairia|sai)\b.{0,55}\b(?:cada\s+)?(?:camisa|camiseta|peca|moletom|polo)\b/.test(t)
    || /\b(?:camisa|camiseta|peca|moletom|polo)\b.{0,55}\b(?:quanto|qto|valor|preco|custa|sairia|sai)\b/.test(t);
  const explicitBuyPiece = /\b(?:quero|preciso|prefiro|seria|vai\s+ser)\b.{0,30}\b(?:camisa|camiseta|peca|moletom|polo)\b/.test(t)
    && !/\b(?:aplicar|estampar|prensar)\b/.test(t);
  if (readyPiece || pricePerPiece || explicitBuyPiece) return SERVICE_MODE.FINISHED;

  const assistantOfferedModes = /\b(?:dtf|impressao|transfer)\b/.test(prev)
    && /\b(?:pront|personaliz|camiseta|camisa|peca)\b/.test(prev)
    && /\b(?:ou|prefere)\b/.test(prev);
  if (assistantOfferedModes) {
    if (/\b(?:camisa|camiseta|peca\s+pronta|personalizada)\b/.test(t) && !/\b(?:dtf|impressao|transfer)\b/.test(t)) {
      return SERVICE_MODE.FINISHED;
    }
    if (/\b(?:impressao|transfer|so\s+o\s+dtf|somente\s+o\s+dtf)\b/.test(t)) return SERVICE_MODE.TRANSFER;
  }

  return null;
}

export function smWeakTechnique(text) {
  const t = smNorm(text);
  if (!t) return false;
  return /\b(?:dtf|dft|ftp)\s*(?:textil|t[eê]xtil)\b/.test(t)
    || /^\s*(?:dtf|dft|ftp)\s*(?:textil|t[eê]xtil)\s*[.!]?\s*$/.test(t);
}

export function smResolve(messages) {
  const clean = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = String(m?.role ?? '');
    const text = String(m?.text ?? '').trim();
    if (!text) continue;
    clean.push({ role, text });
  }

  let mode = null;
  let evidence = null;
  let sourceIndex = -1;
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i].role !== 'user') continue;
    let previousAssistant = '';
    for (let j = i - 1; j >= 0; j -= 1) {
      if (clean[j].role === 'assistant') { previousAssistant = clean[j].text; break; }
    }
    const signal = smStrongSignal(clean[i].text, previousAssistant);
    if (signal) {
      mode = signal;
      evidence = clean[i].text;
      sourceIndex = i;
    }
  }

  const latestUser = [...clean].reverse().find((m) => m.role === 'user')?.text ?? '';
  const weakTechnique = smWeakTechnique(latestUser);
  const apparelContext = clean.some((m) => hasApparel(m.text));

  if (!mode && weakTechnique) {
    mode = SERVICE_MODE.TRANSFER;
    evidence = latestUser;
    sourceIndex = clean.length - 1;
  }

  return {
    mode,
    evidence,
    sourceIndex,
    latestUser,
    weakTechnique,
    apparelContext,
    canonicalProduct: mode === SERVICE_MODE.FINISHED && apparelContext
      ? 'camiseta'
      : mode === SERVICE_MODE.TRANSFER && (weakTechnique || apparelContext)
        ? 'dtf_textil'
        : null,
  };
}

export function smAllowedTools(tools, resolution) {
  const denyFinished = new Set(['consultar_tabela_dtf', 'calcular_dtf_por_arte', 'calcular_dtf_metro']);
  const denyTransfer = new Set(['orcar_camisetas', 'consultar_modelos']);
  const deny = resolution?.mode === SERVICE_MODE.FINISHED ? denyFinished
    : resolution?.mode === SERVICE_MODE.TRANSFER ? denyTransfer
      : new Set();
  return (Array.isArray(tools) ? tools : []).filter((t) => !deny.has(String(t?.name ?? '')));
}

export function smPatchDecision(decision, resolution) {
  if (!decision || typeof decision !== 'object' || !resolution?.canonicalProduct) {
    return { changed: false, decision, contradiction: false };
  }
  const next = { ...decision, slots: { ...(decision.slots || {}) } };
  const oldProduct = String(next.slots.produto ?? '');
  const target = resolution.canonicalProduct;
  const contradiction = (resolution.mode === SERVICE_MODE.FINISHED && /dtf_textil|textil/i.test(oldProduct))
    || (resolution.mode === SERVICE_MODE.TRANSFER && /camiseta|camisa|baby_look|polo|moletom/i.test(oldProduct));
  if (oldProduct !== target) next.slots.produto = target;

  if (contradiction && typeof next.mensagem === 'string') {
    const msg = String(next.mensagem);
    const hasMoney = /R\$\s*\d/i.test(msg);
    if (resolution.mode === SERVICE_MODE.FINISHED && hasMoney) {
      next.mensagem = 'Perfeito, seguimos com as camisetas personalizadas. Para fechar o orçamento oficial, preciso apenas completar a grade/estampa que ainda estiver faltando; não vou usar preço de DTF avulso para esse pedido.';
    } else if (resolution.mode === SERVICE_MODE.FINISHED) {
      next.mensagem = msg.replace(/\b(?:c[oó]pias?\s+de\s+)?DTF\s*t[eê]xtil\b/ig, 'camisetas personalizadas');
    }
  }

  const changed = oldProduct !== target || (typeof decision.mensagem === 'string' && next.mensagem !== decision.mensagem);
  return { changed, decision: next, contradiction };
}
