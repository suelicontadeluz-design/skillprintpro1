// wrapper v6 — ledger obrigatório. Camada MAIS EXTERNA do replay do João.
//
// Por que existe: até a v5 o registro em `replay_execucao` era passo opcional de quem
// chamava. Baterias inteiras rodaram sem deixar linha, e o teto de `orcamento_usd` era
// comparado com um `gasto_usd` que nenhuma função escrevia. A partir daqui o registro
// acontece DEPOIS das transformações finais e ANTES da resposta, e é condição de sucesso.
//
// Por que aqui e não no harness: a v5 reescreve `harness`, `composicao_sha256`,
// `candidate_sha` e `candidato_produto_proveniencia` DEPOIS que o harness responde.
// Gravar lá dentro registraria A e devolveria B. O ledger tem que ser a última coisa
// antes do 200.
//
// O que veio da v5 sem alteração: normalização de fetch (chave privada nas leituras
// privadas e nas leituras AS-OF de fact_conversations), captura do handler do harness
// e as transformações finais do corpo.
//
// O que mudou em relação à v5:
//   1. o harness é importado do commit da MAIN (d1fca976), não de commit solto;
//   2. `candidate_sha` e `executado_por` são derivados do runtime, nunca do request;
//   3. o payload final é gravado em `replay_execucao` antes da resposta;
//   4. se o registro falhar, devolve 502 e nunca `ok: true`.
//
// O gasto do ciclo NÃO é escrito aqui: o gatilho `trg_replay_ciclo_acumula_gasto_v1`
// recalcula `replay_ciclo.gasto_usd` a partir da soma real do ledger a cada INSERT.

// Replay-only wrapper derived from Candidate A+B v4.
// Difference: read-only fact_conversations native AS-OF fetches are normalized to
// the project's private apikey and no Authorization header. This fixes replay-only
// 401s caused by non-JWT secret keys being preserved as Bearer by the inner client.
const realServe = Deno.serve.bind(Deno);
const originalFetch = globalThis.fetch.bind(globalThis);
(globalThis as any).__candidate_original_fetch = originalFetch;
const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
let privateKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
if (!privateKey) { try { const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); privateKey = String(keys?.default ?? '').trim(); } catch { privateKey = ''; } }
const PRIVATE_REPLAY_PATHS = new Set(['/rest/v1/replay_caso','/rest/v1/replay_palco_congelado','/rest/v1/rpc/fn_replay_pode_executar']);
const FACT_PATH = '/rest/v1/fact_conversations';
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
      if (u.origin === base.origin) {
        const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const isFactRead = u.pathname === FACT_PATH && (method === 'GET' || method === 'HEAD');
        if (PRIVATE_REPLAY_PATHS.has(u.pathname) || isFactRead) {
          const headers = privateHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          const res = await originalFetch(input, { ...(init ?? {}), headers });
          if (u.pathname === '/rest/v1/replay_caso' && res.ok) {
            try { const data = await res.clone().json(); const patched = await preencherPhoneDoPalco(data); const outHeaders = new Headers(res.headers); outHeaders.delete('content-length'); outHeaders.set('content-type','application/json'); return new Response(JSON.stringify(patched), { status: res.status, statusText: res.statusText, headers: outHeaders }); } catch { return res; }
          }
          return res;
        }
      }
    } catch {}
    return await originalFetch(input, init);
  };
}
let harnessHandler: ((req: Request) => Response | Promise<Response>) | null = null;
(Deno as any).serve = (a: any, b?: any) => { harnessHandler = typeof a === 'function' ? a : b; return { shutdown: async () => {}, finished: Promise.resolve(), addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' } }; };
const WRAPPER_ID = 'wrapper-v6-ledger-obrigatorio';
const HARNESS_COMMIT = 'd1fca97688c8160f664dbe8065fa68f5bedf50db';
const DEPLOY_ID = String(Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'sem_deployment_id');
// Identidade do que rodou: nunca vem do corpo do request. Como este módulo é
// importado por URL content-addressed do GitHub, `import.meta.url` carrega o commit
// exato do wrapper publicado.
const WRAPPER_COMMIT = (() => {
  try {
    const p = new URL(import.meta.url).pathname.split('/').filter(Boolean);
    return p[2] || 'commit_desconhecido'; // owner/repo/<commit>/...
  } catch { return 'commit_desconhecido'; }
})();
const RUNTIME_SHA = `${WRAPPER_ID}@${WRAPPER_COMMIT}`;
const EXECUTADO_POR = `${WRAPPER_ID}@${DEPLOY_ID}`;
const RPC_REGISTRAR = 'fn_replay_registrar_execucao_v10';

type ResultadoLedger =
  | { ok: true; execucao_id: string; retorno: any }
  | { ok: false; motivo: string; detalhe: any };

// Mesma credencial já provada pelo runtime atual: service role, senão a chave de
// serviço do cofre. Enviada em `apikey`, sem Bearer. A RPC é SECURITY INVOKER e o papel
// anônimo não tem INSERT em `replay_execucao`, então sem esta chave não há registro.
async function registrarNoLedger(args: Record<string, any>): Promise<ResultadoLedger> {
  try {
    if (!privateKey) return { ok: false, motivo: 'ledger_credencial_ausente', detalhe: 'sem service role e sem SUPABASE_SECRET_KEYS.default' };
    const r = await originalFetch(`${supabaseUrl}/rest/v1/rpc/${RPC_REGISTRAR}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: privateKey },
      body: JSON.stringify(args),
    });
    const texto = await r.text();
    let corpoResp: any = null;
    try { corpoResp = JSON.parse(texto); } catch { /* não-JSON cai no fail-closed */ }
    if (!r.ok) return { ok: false, motivo: `ledger_http_${r.status}`, detalhe: corpoResp ?? texto.slice(0, 600) };
    const id = corpoResp?.execucao_id ?? null;
    if (!id) return { ok: false, motivo: 'ledger_sem_execucao_id', detalhe: corpoResp ?? texto.slice(0, 600) };
    return { ok: true, execucao_id: String(id), retorno: corpoResp };
  } catch (e) {
    return { ok: false, motivo: 'ledger_excecao', detalhe: String((e as any)?.message ?? e) };
  }
}

let importError: unknown = null;
try { await import('https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/d1fca97688c8160f664dbe8065fa68f5bedf50db/patches/joao-replay-hermetico-v288/harness.ts'); } catch (e) { importError = e; }
(Deno as any).serve = realServe;
if (importError || !harnessHandler) {
  realServe(() => new Response(JSON.stringify({ ok:false, motivo:'candidate_import_error', erro:String((importError as any)?.stack ?? (importError as any)?.message ?? importError ?? 'handler_ausente') }), { status:500, headers:{'content-type':'application/json','cache-control':'no-store'} }));
} else {
  const h = harnessHandler;
  realServe(async (req: Request) => {
    const r = await h!(req); let body: any = null; try { body = await r.clone().json(); } catch { return r; }
    // Fotografia do que o harness disse ANTES desta camada reescrever nada.
    const preWrapper = body && typeof body === 'object' ? {
      harness: body.harness ?? null,
      composicao_sha256: body.composicao_sha256 ?? null,
      candidate_sha: body.candidate_sha ?? null,
      candidato_produto_proveniencia: body.candidato_produto_proveniencia ?? null,
    } : null;
    if (body && typeof body === 'object') {
      body.harness = 'joao-replay-prompt-skills-v12-fact-asof-auth';
      body.composicao_sha256 = 'v12-fact-asof-auth'; body.candidate_sha = RUNTIME_SHA;   // v5 gravava um apelido aqui; agora e identidade de runtime
      const slots = body?.candidato_slots?.slots; const fonte = String(slots?._produto_fonte ?? ''); const detalhe = slots?._produto_fonte_detalhe == null ? null : String(slots._produto_fonte_detalhe);
      const fontesValidas = new Set(['mensagem_cliente','estado_anterior','canonico','anuncio','modelo','nenhuma']);
      if (fontesValidas.has(fonte) && fonte !== 'nenhuma' && body?.candidato_slots?.produto_macro) {
        const atual = body.candidato_produto_proveniencia && typeof body.candidato_produto_proveniencia === 'object' ? body.candidato_produto_proveniencia : {}; const ev = Array.isArray(atual.evidencias) ? atual.evidencias : [];
        body.candidato_produto_proveniencia = { ...atual, produto: body.candidato_slots.produto ?? null, produto_macro: body.candidato_slots.produto_macro ?? null, fonte, fonte_detalhe: detalhe, promovido:true, conhecimento:'promovido_ao_estado', macro_sem_fonte:false, evidencias:[...ev,{fonte,encontrada:true,detalhe:detalhe ?? '_produto_fonte'}] };
      }
    }
    const headers = new Headers(r.headers); headers.delete('content-length'); headers.set('content-type','application/json');

    // Só execução real vai ao ledger. `inspecionar`, `ensaiar`, gate fechado (423) e
    // palco ausente (424) não são execução e passam intactos.
    const houveExecucao = r.status === 200 && !!body?.ciclo_id && !!body?.caso_id;
    if (!houveExecucao) return new Response(JSON.stringify(body), { status:r.status, statusText:r.statusText, headers });

    const registro = await registrarNoLedger({
      p_ciclo_id: body.ciclo_id,
      p_caso_id: body.caso_id,
      p_tentativa: 1,
      // Grava o payload candidato final, antes do recibo do próprio ledger, mais o que
      // o harness tinha dito antes das transformações desta camada. Ledger e resposta
      // não podem divergir, e a leitura original do harness não pode ser perdida.
      p_payload: { ...body, pre_wrapper: preWrapper, runtime: { wrapper: WRAPPER_ID, wrapper_commit: WRAPPER_COMMIT, harness_commit: HARNESS_COMMIT, deployment_id: DEPLOY_ID } },
      p_veredito_base: 'INDETERMINADO',
      p_veredito_motivo: 'registro obrigatorio do wrapper v6; veredito comparativo permanece com fn_replay_comparar',
      p_pass_base: false,
      p_executado_por: EXECUTADO_POR,
      p_candidate_sha: RUNTIME_SHA,
      p_candidate_diff: null,
    });

    if (!registro.ok) {
      // FAIL-CLOSED