declare const Deno: any;

// Harness-only. Fica por fora do skill-router para contar tentativas Anthropic
// e distinguir respostas resolvidas deterministicamente pelo router.
const RM_BASE_FETCH = globalThis.fetch.bind(globalThis);

function rmUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function rmState(): any | null {
  const s = (globalThis as any).__joaoPromptMetricsCurrent;
  return s && typeof s === 'object' ? s : null;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = rmUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) {
    return RM_BASE_FETCH(input, init);
  }

  const st = rmState();
  if (st) st.anthropic_attempts = Number(st.anthropic_attempts || 0) + 1;

  const res = await RM_BASE_FETCH(input, init);

  if (st) {
    const routed = !!res.headers.get('x-cortex-skill-router');
    if (routed) st.router_hits = Number(st.router_hits || 0) + 1;
    else st.router_misses = Number(st.router_misses || 0) + 1;
  }

  return res;
};
