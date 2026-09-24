export async function findMaxCopiesWithinMeters({
  targetMeters,
  maxQuantity = 20000,
  metersForQuantity,
}) {
  const target = Number(targetMeters);
  const cap = Number(maxQuantity);
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, reason: 'INVALID_TARGET_METERS', maxCopies: null, probes: 0 };
  }
  if (!Number.isInteger(cap) || cap < 1 || typeof metersForQuantity !== 'function') {
    return { ok: false, reason: 'INVALID_SEARCH_CONTRACT', maxCopies: null, probes: 0 };
  }

  let probes = 0;
  const probe = async (quantity) => {
    const value = Number(await metersForQuantity(quantity));
    probes += 1;
    if (!Number.isFinite(value) || value <= 0) throw new Error('INVALID_CANONICAL_METERS');
    return value;
  };

  let low = 0;
  let high = 1;
  let highMeters = await probe(high);

  if (highMeters <= target) {
    low = high;
    while (high < cap) {
      const next = Math.min(cap, high * 2);
      if (next === high) break;
      high = next;
      highMeters = await probe(high);
      if (highMeters > target) break;
      low = high;
    }
  }

  if (high === cap && highMeters <= target) {
    return { ok: false, reason: 'BOUND_NOT_FOUND', maxCopies: null, probes };
  }

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const meters = await probe(mid);
    if (meters <= target) low = mid;
    else high = mid;
  }

  return { ok: true, reason: 'BOUND_FOUND', maxCopies: low, probes };
}
