// wrapper v6 — camada externa de ledger obrigatório sobre o wrapper v5 já provado.
// Preserva o comportamento do v5 byte a byte; só adiciona identidade de runtime e
// persistência obrigatória DEPOIS da resposta final do v5 e ANTES do HTTP 200.

declare const Deno: any;

const NATIVE_SERVE = Deno.serve.bind(Deno);
let v5Handler: ((req: Request) => Response | Promise<Response>) | null = null;

// Captura o handler FINAL que o wrapper v5 tentaria publicar. O próprio v5 captura
// internamente o handler do harness e, ao terminar, chama o Deno.serve que encontrou
// ao ser importado — isto é, esta captura externa.
(Deno as any).serve = (a: any, b?: any) => {
  v5Handler = typeof a === 'function' ? a : b;
  return {
    shutdown: async () => {},
    finished: Promise.resolve(),
    addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' },
  };
};

const WRAPPER_ID = 'wrapper-v6-ledger-obrigatorio';
const V5_SOURCE_COMMIT = '8f5fa9854f5394437cedd75a1207087c9bba4eaf';
const V5_SOURCE_URL = `https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/${V5_SOURCE_COMMIT}/patches/joao-harness-prompt-skills-v11/wrapper-v5-fact-asof-auth.ts`;
// O mesmo blob do v5 foi espelhado na main; a URL original continua sendo usada
// porque já é a origem comprovadamente carregável pelo runtime da edge.
const V5_MIRROR_MAIN_COMMIT = 'c821432a23b89af7557f0c7b722f3ed9a4ef7d0e';
const V5_BLOB_SHA = '1e8a07a8e4be415cc69d86e38bc135ab4e29dcad';

let importError: unknown = null;
try {
  await import(V5_SOURCE_URL);
} catch (e) {
  importError = e;
}
(Deno as any).serve = NATIVE_SERVE;

const ORIGINAL_FETCH: typeof fetch = ((globalThis as any).__candidate_original_fetch ?? globalThis.fetch).bind(globalThis);
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
let PRIVATE_KEY = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
if (!PRIVATE_KEY) {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    PRIVATE_KEY = String(keys?.default ?? '').trim();
  } catch { PRIVATE_KEY = ''; }
}

const WRAPPER_COMMIT = (() => {
  try {
    const p = new URL(import.meta.url).pathname.split('/').filter(Boolean);
    return p[2] || 'commit_desconhecido'; // owner/repo/<commit>/...
  } catch { return 'commit_desconhecido'; }
})();
const DEPLOY_ID = String(Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'sem_deployment_id');
const RUNTIME_SHA = `${WRAPPER_ID}@${WRAPPER_COMMIT}`;
const EXECUTADO_POR = `${WRAPPER_ID}@${DEPLOY_ID}`;
const RPC_REGISTRAR = 'fn_replay_registrar_execucao_v10';

type ResultadoLedger =
  | { ok: true; execucao_id: string; retorno: any }
  | { ok: false; motivo: string; detalhe: any };

async function registrarNoLedger(args: Record<string, any>): Promise<ResultadoLedger> {
  try {
    if (!PRIVATE_KEY) {
      return { ok: false, motivo: 'ledger_credencial_ausente', detalhe: 'sem service role e sem SUPABASE_SECRET_KEYS.default' };
    }
    const r = await ORIGINAL_FETCH(`${SUPABASE_URL}/rest/v1/rpc/${RPC_REGISTRAR}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PRIVATE_KEY },
      body: JSON.stringify(args),
    });
    const texto = await r.text();
    let corpo: any = null;
    try { corpo = JSON.parse(texto); } catch { /* não-JSON => fail-closed */ }
    if (!r.ok) return { ok: false, motivo: `ledger_http_${r.status}`, detalhe: corpo ?? texto.slice(0, 600) };
    const id = corpo?.execucao_id ?? null;
    if (!id) return { ok: false, motivo: 'ledger_sem_execucao_id', detalhe: corpo ?? texto.slice(0, 600) };
    return { ok: true, execucao_id: String(id), retorno: corpo };
  } catch (e) {
    return { ok: false, motivo: 'ledger_excecao', detalhe: String((e as any)?.message ?? e) };
  }
}

if (importError || !v5Handler) {
  NATIVE_SERVE(() => new Response(JSON.stringify({
    ok: false,
    motivo: 'wrapper_v5_import_error',
    erro: String((importError as any)?.stack ?? (importError as any)?.message ?? importError ?? 'handler_ausente'),
  }), { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
} else {
  const h = v5Handler;
  NATIVE_SERVE(async (req: Request) => {
    const r = await h!(req);
    let body: any = null;
    try { body = await r.clone().json(); } catch { return r; }

    const headers = new Headers(r.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');

    // inspecionar/ensaiar/gate fechado/palco ausente não são execuções.
    const houveExecucao = r.status === 200 && !!body?.ciclo_id && !!body?.caso_id;
    if (!houveExecucao) {
      return new Response(JSON.stringify(body), { status: r.status, statusText: r.statusText, headers });
    }

    const candidateAnterior = body?.candidate_sha ?? null;
    body.candidate_sha = RUNTIME_SHA;
    body.runtime = {
      wrapper: WRAPPER_ID,
      wrapper_commit: WRAPPER_COMMIT,
      wrapper_v5_source_commit: V5_SOURCE_COMMIT,
      wrapper_v5_mirror_main_commit: V5_MIRROR_MAIN_COMMIT,
      wrapper_v5_blob_sha: V5_BLOB_SHA,
      deployment_id: DEPLOY_ID,
      candidate_sha_antes_v6: candidateAnterior,
    };

    // JSON.stringify dentro de registrarNoLedger captura este payload antes de o
    // recibo `body.ledger` ser anexado. A resposta válida só sai depois do execucao_id.
    const registro = await registrarNoLedger({
      p_ciclo_id: body.ciclo_id,
      p_caso_id: body.caso_id,
      p_tentativa: 1,
      p_payload: body,
      p_veredito_base: 'INDETERMINADO',
      p_veredito_motivo: 'registro obrigatorio do wrapper v6; veredito comparativo permanece com fn_replay_comparar',
      p_pass_base: false,
      p_executado_por: EXECUTADO_POR,
      p_candidate_sha: RUNTIME_SHA,
      p_candidate_diff: null,
    });

    if (!registro.ok) {
      return new Response(JSON.stringify({
        ok: false,
        motivo: 'LEDGER_OBRIGATORIO_FALHOU',
        wrapper: WRAPPER_ID,
        caso_id: body.caso_id,
        ciclo_id: body.ciclo_id,
        ledger: registro,
        custo_usd_gasto_sem_registro: body?.anthropic?.custo_usd ?? null,
        aviso: 'a execucao ocorreu e custou dinheiro, mas nao foi registrada; nao usar como resultado valido',
      }), { status: 502, statusText: 'Bad Gateway', headers });
    }

    body.ledger = {
      registrado_antes_da_resposta: true,
      execucao_id: registro.execucao_id,
      veredito_gravado: registro.retorno?.veredito ?? null,
      regra_aplicada: registro.retorno?.regra_aplicada ?? null,
    };
    return new Response(JSON.stringify(body), { status: r.status, statusText: r.statusText, headers });
  });
}
