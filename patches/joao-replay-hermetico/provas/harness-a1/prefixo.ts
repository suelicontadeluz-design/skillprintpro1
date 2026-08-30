// ── HARNESS A1: instrumentacao ANTES do bloco hermetico real ──────────────────
// O bloco abaixo e extraido byte a byte do artefato 3f1ecf3c
// (sha256 01cf12b8...). Nada dele foi editado. Tudo que o cerca e medicao.
declare const process: any;
const AUDIT = {
  fetchNativoChamado: [] as Array<{ url: string; metodo: string }>,
  dbOps: [] as Array<{ tabela: string; op: string; args?: any }>,
  rpcs: [] as Array<{ nome: string; via: string }>,
  lteAplicado: [] as Array<{ tabela: string; coluna: string; valor: string }>,
  leiturasEstado: [] as any[],
};
const SNAPSHOT_REAL = JSON.parse(process.env.SNAPSHOT_JSON as string);
const ESTADO_ATUAL_PROIBIDO = { etapa: 'fechamento', slots: { CONTAMINACAO: 'estado_de_hoje_18_27' }, updated_at: '2026-08-29T18:27:18.511+00:00' };

const Deno: any = {
  env: { get: (k: string) => (process.env['DENO_' + k] ?? undefined) },
  serve: (_h: any) => {},
};

// fetch nativo espionado: qualquer chamada que ESCAPE do gate cai aqui.
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const metodo = String(init?.method ?? 'GET').toUpperCase();
  AUDIT.fetchNativoChamado.push({ url, metodo });
  return new Response(JSON.stringify({ stub_nativo: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function construirBuilder(tabela: string, op: string): any {
  const alvo: any = {};
  const prox: any = new Proxy(alvo, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: any, rej: any) => {
          let data: any = [];
          if (op === 'select' && tabela === 'agente_noturno_estado') { AUDIT.leiturasEstado.push('foi_ao_banco'); data = ESTADO_ATUAL_PROIBIDO; }
          return Promise.resolve({ data, error: null }).then(res, rej);
        };
      }
      return (...args: any[]) => {
        if (prop === 'lte') AUDIT.lteAplicado.push({ tabela, coluna: String(args[0]), valor: String(args[1]) });
        return prox;
      };
    },
  });
  return prox;
}
const clienteStub: any = {
  from: (tabela: string) => new Proxy({}, {
    get: (_t, op) => (...args: any[]) => {
      AUDIT.dbOps.push({ tabela, op: String(op), args: args?.[0] });
      return construirBuilder(tabela, String(op));
    },
  }),
  rpc: async (nome: string, _args?: any) => {
    AUDIT.rpcs.push({ nome, via: 'cliente_real' });
    if (nome === 'fn_replay_snapshot') return { data: SNAPSHOT_REAL, error: null };
    return { data: null, error: { code: '42501', message: 'permission denied for function ' + nome } };
  },
  schema: (_s: string) => clienteStub,
};
const createClient = (_u: string, _k: string, _o?: any) => clienteStub;

const SUPABASE_URL = 'https://ldrdtaibazplvrbwyrvx.supabase.co';
const SUPABASE_SERVICE_KEY = 'SERVICE_ROLE_NUNCA_DEVE_SER_USADA_EM_REPLAY';
const ERP_URL = 'https://ynjsflvdfftcopibzxyo.supabase.co';
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
// ── fim da instrumentacao; a partir daqui, artefato real ──────────────────────
