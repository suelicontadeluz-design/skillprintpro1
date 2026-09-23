// Quantity provenance core v1 — P0 #1177 — 23/09/2026
//
// Pure/effect-zero helpers shared by the João slot provenance and canonical
// quantity reconciliation boundaries. The accepted numeric domain is deliberately
// narrow: apparel/generic piece counts, never money, remittance, dimensions, CEP or dates.

function qpNorm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// One shared merchandise vocabulary for both provenance and canonical reconciliation.
// Deliberately excludes meter/cm/folha and non-apparel physical product nouns.
const QP_GOODS =
  'un\\b|und\\b|unid\\w*|pecas?|camisetas?|camisas?|baby\\s?looks?|regatas?|moletons?|polos?|jalecos?|uniformes?|itens?|pcs?';

const QP_RX_EXPLICIT_UNIT = new RegExp(
  '\\b\\d{1,5}\\s*(?:x\\s*)?(?:' + QP_GOODS + ')',
  'i',
);

// Closed vocabulary. Generic words such as "sabe" or "fechar" are insufficient.
const QP_RX_QUESTION = /(?:\bquant(?:o|os|a|as)\b[^?]{0,160}|\bqual\s+(?:e\s+)?a\s+quantidade\b[^?]{0,120}|\b(?:me\s+)?confirm(?:a|ar|ou|ado|ada)\s+(?:a\s+)?quantidade\b[^?]{0,120}|\bconseguiu\s+(?:definir|confirmar)\s+(?:a\s+)?quantidade\b[^?]{0,120}|\b(?:ja\s+)?definiu\s+(?:a\s+)?quantidade\b[^?]{0,120})\?/i;

const QP_RX_FINANCIAL = /(?:r\$|reais?|conto|entrada|sinal|adiantamento|deposito|pagar|paguei|pago|pagamento|transfer\w*|\bpix\b|restante|resto|parcel\w*|metade|desconto|troco|,\s*00\b)/i;
const QP_RX_CUSTOMER_SENDING = /\b(?:posso|poderia|vou|irei|consigo|acabei\s+de|estou|to|ja|eu)\s+(?:te\s+|lhe\s+|ja\s+)?(?:envi\w*|mand\w*)/i;
const QP_RX_DIMENSION = /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b/i;
const QP_RX_MEASURE = /\b(?:m|metro|metros|cm|centimetro|centimetros|mm|milimetro|milimetros)\b/i;
const QP_RX_ZIP = /\b\d{5}-?\d{3}\b/;
const QP_RX_DATE = /\b\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?\b/;
const QP_RX_TIME = /\b\d{1,2}:\d{2}\b/;
const QP_RX_SIZE_NUMBER = /(?:\b(?:pp|p|m|g|gg|xg|xxg|g1|g2|g3|a3|a4)\s*[-:=]?\s*\d+\b|\b\d+\s*(?:pp|p|m|g|gg|xg|xxg|g1|g2|g3)\b)/i;

export function qpAsksQuantity(text) {
  return QP_RX_QUESTION.test(qpNorm(text));
}

export function qpHasExplicitQuantityUnit(text) {
  return QP_RX_EXPLICIT_UNIT.test(qpNorm(text));
}

export function qpQuantityCandidate(text) {
  const raw = String(text ?? '').trim();
  if (!raw || raw.length > 120) return null;
  const normalized = qpNorm(raw);

  if (QP_RX_ZIP.test(raw) || /^\d{8}$/.test(raw)) return null;
  if (QP_RX_DIMENSION.test(raw) || QP_RX_DATE.test(raw) || QP_RX_TIME.test(raw) || QP_RX_SIZE_NUMBER.test(raw)) return null;

  const nums = raw.match(/\d+/g) ?? [];
  if (nums.length !== 1) return null;
  const value = Number(nums[0]);
  if (!Number.isInteger(value) || value < 1 || value > 99999) return null;

  const explicitUnit = qpHasExplicitQuantityUnit(raw);
  if (!explicitUnit && QP_RX_MEASURE.test(normalized)) return null;
  if (!explicitUnit && QP_RX_FINANCIAL.test(normalized)) return null;
  if (!explicitUnit && QP_RX_CUSTOMER_SENDING.test(normalized)) return null;
  return value;
}

export function qpContextualQuantityAnswer(value, text) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isInteger(n) && qpQuantityCandidate(text) === n;
}

export function qpRemoveQuantityQuestion(text) {
  let out = String(text ?? '');
  const patterns = [
    /(?:^|[\n.!?]\s*)[^\n.!?]*\bquant(?:o|os|a|as)\b.{0,160}\b(?:peças?|pecas?|camisetas?|camisas?|unidades?|itens?|quantidade)\b[^\n.!?]*\??/giu,
    /(?:^|[\n.!?]\s*)[^\n.!?]*\bqual\s+(?:é|e\s+)?a\s+quantidade\b[^\n.!?]*\??/giu,
    /(?:^|[\n.!?]\s*)[^\n.!?]*\bquantidade\s+(?:que\s+)?(?:você|voce|vc)\s+(?:precisa|quer|deseja)\b[^\n.!?]*\??/giu,
    /(?:^|[\n.!?]\s*)[^\n.!?]*\bconfirm(?:a|ar|ou|ado|ada)\s+(?:a\s+)?quantidade\b[^\n.!?]*\??/giu,
    /(?:^|[\n.!?]\s*)[^\n.!?]*\bconseguiu\s+(?:definir|confirmar)\s+(?:a\s+)?quantidade\b[^\n.!?]*\??/giu,
    /(?:^|[\n.!?]\s*)[^\n.!?]*\b(?:já\s+|ja\s+)?definiu\s+(?:a\s+)?quantidade\b[^\n.!?]*\??/giu,
  ];
  for (const p of patterns) out = out.replace(p, ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/^\s*[.!?]\s*/, '').trim();
}
