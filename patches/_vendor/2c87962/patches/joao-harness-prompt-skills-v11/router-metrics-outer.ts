declare const Deno: any;

// Harness-only. Fica por fora do skill-router e distingue resposta determinística
// (header x-cortex-skill-router) de passagem ao provider. Só emite números/flags.
const RM_BASE_FETCH = globalThis.fetch.bind(globalThis);

function rmUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function rmEmit(routed: boolean) {
  try {
    await RM_BASE_FETCH(`https://harness-metrics.invalid/router?routed=${routed ? 1 : 0}`, { method: 'GET' });
  } catch {}
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = rmUrl(input);
  if (!/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url)) {
    return RM_BASE_FETCH(input, init);
  }

  const res = await RM_BASE_FETCH(input, init);
  await rmEmit(!!res.headers.get('x-cortex-skill-router'));
  return res;
};
