// Harness-only. Força SOMENTE joao_skill_router_ativo=true dentro do replay.
// Nenhuma configuração de produção é alterada.
const RF_BASE_FETCH = globalThis.fetch.bind(globalThis);
const RF_SUPABASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

function rfUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  try {
    const raw = rfUrl(input);
    const u = new URL(raw);
    const base = new URL(RF_SUPABASE);
    if (u.origin === base.origin && u.pathname === '/rest/v1/sistema_config') {
      const chave = u.searchParams.get('chave') || '';
      if (chave === 'eq.joao_skill_router_ativo') {
        return new Response(JSON.stringify([{ valor_bool: true }]), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
    }
  } catch {}
  return RF_BASE_FETCH(input, init);
};
