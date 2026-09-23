// Quantity provenance core v1 — P0 #1177 — 23/09/2026
//
// Pure/effect-zero helpers for the João slot provenance gate.
// Goal: accept natural contextual quantity answers without reopening the historical
// "300 reais" => quantidade=300 contamination bug.

function qpNorm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const QP_GOODS =
  'un\\b|und\\b|unid\\w*|pecas?|camisetas?|camisas?|baby\\s?looks?|regatas?|moletons?|polos?|jalecos?|uniformes?|adesivos?|copos?|canecas?|garrafas?|itens?|pcs?|folhas?|metros?';

const QP_RX_EXPLICIT_UNIT = new RegExp(
  '\\b\\d{1,6}\\s*(?:x\\s*)?(?:' + QP_GOODS + ')',
  'i',
);

// Deliberately closed vocabulary. Generic words such as "sabe" or "fechar" are not
// enough by themselves to establish a pending quantity question.
const QP_RX_QUESTION = /(?:\bquant(?:o|os|a|as)\b[^?]{0,160}|\bqual\s+(?:e\s+)?a\s+quantidade\b[^?]{0,120}|\b(?:me\s+)?confirm(?:a|ar|ou|ado|ada)\s+(?:a\s+)?quantidade\b[^?]{0,120}|\bconseguiu\s+(?:definir|confirmar)\s+(?:a\s+)?quantidade\b[^?]{0,120}|\b(?:ja\s+)?definiu\s+(?:a\s+)?quantidade\b[^?]{0,120})\?/i;

const QP_RX_FINANCIAL = /(?:r\$|reais?|conto|entrada|sinal|adiantamento|deposito|pagar|paguei|pago|pagamento|transfer\w*|\bpix\b|restante|resto|parcel\w*|metade|desconto|troco|,\s*00\b)/i;
const QP_RX_CUSTOMER_SENDING = /\b(?:posso|poderia|vou|irei|consigo|acabei\s+de|estou|to|ja|eu)\s+(?:te\s+|lhe\s+|ja\s+)?(?:envi\w*|mand\w*)/i;
const QP_RX_DIMENSION = /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b/i;
const QP_RX_ZIP = /\b\d{5}-?\d{3}\b/;
const QP_RX_DATE = /\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/;

export function qpAsksQuantity(text) {
  return QP_RX_QUESTION.test(qpNorm(text));
}

export function qpHasExplicitQuantityUnit(text) {
  return QP_RX_EXPLICIT_UNIT.test(qpNorm(text));
}

export function qpContextualQuantityAnswer(value, text) {
  const raw = String(text ?? '').trim();
  const normalized = qpNorm(raw);
  const n = Number(String(value ?? '').replace(',', '.'));

  if (!Number.isInteger(n) || n < 1 || n > 999999) return false;
  if (!raw || raw.length > 120) return false;
  if (QP_RX_FINANCIAL.test(normalized)) return false;
  if (QP_RX_CUSTOMER_SENDING.test(normalized)) return false;
  if (QP_RX_DIMENSION.test(raw) || QP_RX_ZIP.test(raw) || QP_RX_DATE.test(raw)) return false;

  const nums = raw.match(/\d{1,6}/g) ?? [];
  if (nums.length !== 1) return false;
  return Number(nums[0]) === n;
}
