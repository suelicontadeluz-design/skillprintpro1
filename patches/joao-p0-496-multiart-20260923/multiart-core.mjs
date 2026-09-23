// P0 #496 — pure DTF Textile multi-art provenance + physical aggregation owner.
// No price table, no commercial minimum, no network I/O.

function n(value) {
  const x = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(x) ? x : NaN;
}

function normPair(a, b) {
  const x = n(a), y = n(b);
  if (!(x > 0) || !(y > 0)) return null;
  return x <= y ? [x, y] : [y, x];
}

function samePair(a, b) {
  return !!a && !!b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

export function extractFullDimensionEvidence(customerText) {
  const text = String(customerText ?? '');
  const out = [];
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/gi,
    /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:de\s+)?largura[\s\S]{0,40}?(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:de\s+)?altura/gi,
    /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:de\s+)?altura[\s\S]{0,40}?(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:de\s+)?largura/gi,
  ];
  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      const pair = normPair(m[1], m[2]);
      if (pair) out.push(pair);
    }
  }
  return out;
}

export function validateMultiArtEvidence(input) {
  const artworks = Array.isArray(input?.artworks) ? input.artworks : [];
  if (artworks.length < 2) {
    return { ok: false, code: 'MULTI_ART_REQUIRED', missing_art_indexes: [] };
  }

  const invalid = [];
  for (let i = 0; i < artworks.length; i += 1) {
    const a = artworks[i] ?? {};
    if (!(n(a.largura_cm) > 0) || !(n(a.altura_cm) > 0) || !(Number(a.copias) > 0)) invalid.push(i);
  }
  if (invalid.length) {
    return { ok: false, code: 'INVALID_TOOL_INPUT', missing_art_indexes: invalid };
  }

  const available = extractFullDimensionEvidence(input?.customer_text);
  const used = new Set();
  const missing = [];

  for (let i = 0; i < artworks.length; i += 1) {
    const expected = normPair(artworks[i]?.largura_cm, artworks[i]?.altura_cm);
    let match = -1;
    for (let j = 0; j < available.length; j += 1) {
      if (used.has(j)) continue;
      if (samePair(expected, available[j])) { match = j; break; }
    }
    if (match < 0) missing.push(i);
    else used.add(match);
  }

  if (missing.length) {
    return {
      ok: false,
      code: 'MISSING_CUSTOMER_DIMENSION_EVIDENCE',
      missing_art_indexes: missing,
      evidenced_pair_count: available.length,
    };
  }

  return {
    ok: true,
    code: 'CUSTOMER_DIMENSIONS_PROVEN',
    missing_art_indexes: [],
    evidenced_pair_count: available.length,
  };
}

function close(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

export function aggregateMultiArtPhysicalMeters(input) {
  const rows = Array.isArray(input?.physical_results) ? input.physical_results : [];
  if (rows.length < 2 || rows.some((r) => !r || r.ok !== true || !(Number(r.metros_layout) > 0))) {
    return { ok: false, code: 'PHYSICAL_RESULTS_REQUIRED' };
  }

  const cfg = rows[0]?.config_fisica ?? {};
  const gapCm = Number(cfg.gap_cm);
  const safety = Number(cfg.margem_seguranca);
  const step = Number(cfg.arredondamento_m);
  if (!(gapCm >= 0) || !(safety >= 0) || !(step > 0)) {
    return { ok: false, code: 'PHYSICAL_CONFIG_INVALID' };
  }

  for (const row of rows.slice(1)) {
    const c = row?.config_fisica ?? {};
    if (!close(c.gap_cm, gapCm) || !close(c.margem_seguranca, safety) || !close(c.arredondamento_m, step)) {
      return { ok: false, code: 'PHYSICAL_CONFIG_MISMATCH' };
    }
  }

  const layoutMeters = rows.reduce((sum, r) => sum + Number(r.metros_layout), 0);
  // Conservative co-layout: each artwork keeps its own optimized row block and blocks
  // are stacked sequentially on the same film with one configured gap between blocks.
  const interBlockMeters = (gapCm / 100) * (rows.length - 1);
  const rawMeters = layoutMeters + interBlockMeters;
  const withSafety = rawMeters * (1 + safety);
  const rounded = Math.ceil((withSafety - 1e-12) / step) * step;
  const metersForErp = Math.round(rounded * 1000000) / 1000000;

  return {
    ok: true,
    code: 'MULTI_ART_PHYSICAL_CONSOLIDATED',
    art_count: rows.length,
    metros_layout_somados: Math.round(layoutMeters * 1000000) / 1000000,
    metros_separacao_blocos: Math.round(interBlockMeters * 1000000) / 1000000,
    metros_com_seguranca: Math.round(withSafety * 1000000) / 1000000,
    metros_para_lancar_erp: metersForErp,
    applies_commercial_minimum: false,
    commercial_operation_count: 1,
    erp_source_tool: 'calcular_dtf_metro',
  };
}
