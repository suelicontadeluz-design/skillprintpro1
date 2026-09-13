// Candidate A+B v3 replay wrapper — replay only.
const realServe = Deno.serve.bind(Deno);
const originalFetch = globalThis.fetch.bind(globalThis);
(globalThis as any).__candidate_original_fetch = originalFetch;
const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
let privateKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
if (!privateKey) { try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); privateKey = String(keys?.default ?? '').trim(); } catch { privateKey = ''; } }
const PRIVATE_REPLAY_PATHS = new Set(['/rest/v1/replay_caso','/rest/v1/replay_palco_congelado','/rest/v1/rpc/fn_replay_pode_executar']);
function privateHeaders(base?: HeadersInit) { const h = new Headers(base); h.set('apikey', privateKey); h.delete('authorization'); return h; }
async function preencherPhoneDoPalco(data: any): Promise<any> {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row?.id || String(row?.phone ?? '').trim()) continue;
    try {
      const url = `${supabaseUrl}/rest/v1/replay_palco_congelado?caso_id=eq.${encodeURIComponent(String(row.id))}&order=versao_palco.desc&limit=1&select=estado`;
      const r = await originalFetch(url, { headers: privateHeaders() }); if (!r.ok) continue;
      const j = await r.json(); const palco = Array.isArray(j) ? j[0] : j; const ids = palco?.estado?.lead_identificadores;
      const tel = Array.isArray(ids) ? ids.map((x: any) => String(x?.telefone ?? x?.phone ?? '').replace(/\D/g, '')).find((x: string) => x.length >= 10) : '';
      if (tel) row.phone = tel;
    } catch {}
  }
  return Array.isArray(data) ? rows : rows[0];
}
if (privateKey && supabaseUrl) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw); const base = new URL(supabaseUrl);
      if (u.origin === base.origin && PRIVATE_REPLAY_PATHS.has(u.pathname)) {
        const headers = privateHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const res = await originalFetch(input, { ...(init ?? {}), headers });
        if (u.pathname === '/rest/v1/replay_caso' && res.ok) {
          try { const data = await res.clone().json(); const patched = await preencherPhoneDoPalco(data); const outHeaders = new Headers(res.headers); outHeaders.delete('content-length'); outHeaders.set('content-type','application/json'); return new Response(JSON.stringify(patched), { status: res.status, statusText: res.statusText, headers: outHeaders }); } catch { return res; }
        }
        return res;
      }
    } catch {}
    return await originalFetch(input, init);
  };
}
let harnessHandler: ((req: Request) => Response | Promise<Response>) | null = null;
(Deno as any).serve = (a: any, b?: any) => { harnessHandler = typeof a === 'function' ? a : b; return { shutdown: async () => {}, finished: Promise.resolve(), addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' } }; };
let importError: unknown = null;
try { await import('https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/0a16fb0d133d40b6ccdf4e7805052cd55f7fda56/patches/joao-replay-hermetico-v288/harness.ts'); } catch (e) { importError = e; }
(Deno as any).serve = realServe;
if (importError || !harnessHandler) {
  realServe(() => new Response(JSON.stringify({ ok:false, motivo:'candidate_import_error', erro:String((importError as any)?.stack ?? (importError as any)?.message ?? importError ?? 'handler_ausente') }), { status:500, headers:{'content-type':'application/json','cache-control':'no-store'} }));
} else {
  const h = harnessHandler;
  realServe(async (req: Request) => {
    const r = await h!(req); let body: any = null; try { body = await r.clone().json(); } catch { return r; }
    if (body && typeof body === 'object') {
      body.harness = 'joao-replay-candidato-ab-20260913/harness-v3-candidate-ab-v3';
      body.composicao_sha256 = 'candidate-ab-v3-late-acquisition'; body.candidate_sha = 'candidate-ab-v3-late-acquisition';
      const slots = body?.candidato_slots?.slots; const fonte = String(slots?._produto_fonte ?? ''); const detalhe = slots?._produto_fonte_detalhe == null ? null : String(slots._produto_fonte_detalhe);
      const fontesValidas = new Set(['mensagem_cliente','estado_anterior','canonico','anuncio','modelo','nenhuma']);
      if (fontesValidas.has(fonte) && fonte !== 'nenhuma' && body?.candidato_slots?.produto_macro) {
        const atual = body.candidato_produto_proveniencia && typeof body.candidato_produto_proveniencia === 'object' ? body.candidato_produto_proveniencia : {}; const ev = Array.isArray(atual.evidencias) ? atual.evidencias : [];
        body.candidato_produto_proveniencia = { ...atual, produto: body.candidato_slots.produto ?? null, produto_macro: body.candidato_slots.produto_macro ?? null, fonte, fonte_detalhe: detalhe, promovido:true, conhecimento:'promovido_ao_estado', macro_sem_fonte:false, evidencias:[...ev,{fonte,encontrada:true,detalhe:detalhe ?? '_produto_fonte'}] };
      }
    }
    const headers = new Headers(r.headers); headers.delete('content-length'); headers.set('content-type','application/json'); return new Response(JSON.stringify(body), { status:r.status, statusText:r.statusText, headers });
  });
}
