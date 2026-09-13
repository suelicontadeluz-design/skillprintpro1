// João replay hermético v288 — harness v2 — 13/09/2026
//
// v1 (commit 85d55be): jaula de rede + captura do handler de produção.
// v2 (esta):           palco congelado, relógio congelado, temperature=0, trilha de leituras.
//
// O que é: um wrapper que carrega a composição v288 (os mesmos 38 imports pinados
// da edge `agente-noturno` viva) dentro de uma jaula, captura o handler de produção
// e executa um caso de `replay_caso` sem deixar nenhum efeito sair E sem deixar o
// núcleo ler estado vivo.
//
// Diferença essencial para `agente-noturno-replay` v17: o v17 instala a ponte de
// fetch DENTRO do handler, isto é, DEPOIS do import. Naquele desenho `current` já
// nasce sendo a cadeia pronta e a política nunca envolve as camadas existentes. O
// candidato v4374 era hermético por conta própria, então bastava. A v288 NÃO é:
// 33 dos 38 arquivos reatribuem globalThis.fetch no IMPORT. Aqui a ponte é
// instalada ANTES da composição.
//
// FIDELIDADE DECLARADA: o palco é o estado do MOMENTO DA CAPTURA, não de `as_of`.
// O estado histórico dos 29 leads nunca foi fotografado — não existe tabela de
// "estado no instante T". O que este harness garante é DETERMINISMO: duas execuções
// comparadas veem exatamente o mesmo palco. Ver LEIA-ME.md §6.

import { AsyncLocalStorage } from 'node:async_hooks';

declare const Deno: any;

const HARNESS_VERSION = 'joao-replay-hermetico-v288/harness-v2';
const COMPOSICAO_SHA256 = 'b33776a0908ae7bf551a27512110446711e2a093d13bb97f9b763470bef7025b';

// Tarifa registrada no dia, fonte: public.go_ai_model_pricing (effective_from 2026-08-31T23:10:00Z)
const TARIFA = {
  model: 'claude-haiku-4-5-20251001',
  input_usd_per_million: 1.0,
  output_usd_per_million: 5.0,
  fonte: 'public.go_ai_model_pricing',
};

const EXPECTED = (Deno.env.get('REPLAY_RUNNER_JWT') ?? '').trim();
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PUBLIC_API_KEY = (Deno.env.get('SUPABASE_ANON_KEY') ?? '').trim();
const ERP_URL = (Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co').replace(/\/$/, '');

const NATIVE_FETCH: typeof fetch = globalThis.fetch.bind(globalThis);
const NATIVE_SERVE = Deno.serve.bind(Deno);
const RealDate = Date;

// ───────────────────────────── tabela de roteamento ─────────────────────────────
// Levantada por grep sobre os 38 arquivos NOS SHAs PINADOS. Ver LEIA-ME.md §3.
// Qualquer leitura fora desta tabela é BLOCK (`leitura_nao_classificada`).

// Mutáveis: servidas do palco congelado.
const CONGELADAS = new Set([
  'agente_noturno_estado', 'leads_marketing', 'orcamentos', 'vw_orcamento_calcme_vigente',
  'lead_identificadores', 'pixel_events', 'sistema_config', 'catalogo_produtos',
  'dtf_precos_faixa', 'dtf_uv_degraus', 'dtf_produto_config',
]);

// Append-only: leitura nativa com corte `<coluna> <= as_of`.
const APPEND_ONLY: Record<string, string> = {
  inbound_fora_horario: 'created_at', fact_conversations: 'created_at',
  operacoes_financeiras: 'created_at', joao_envios: 'created_at',
  agente_decisoes_log: 'created_at', error_log: 'created_at',
  mp_pix_cobrancas: 'created_at', anthropic_token_usage: 'created_at',
  arte_uploads: 'created_at', joao_slots_observacao: 'created_at',
  joao_tool_guard_shadow: 'created_at', prompt_manifesto_joao: 'created_at',
  sistema_logs: 'created_at',
};

// Efêmera: o palco sempre responde "sem lock".
const LOCK_VAZIO = 'agente_noturno_lock';

// RPCs cuja SAÍDA foi congelada no palco.
const RPC_PALCO = new Set([
  'fn_contexto_comercial_do_lead', 'fn_contexto_aprendizados', 'fn_agente_pausado',
]);

// Calculadoras: STABLE sobre tabelas de preço congeladas, ou IMMUTABLE (puras).
// Rodam ao vivo; o hash das tabelas de preço no palco detecta drift.
const RPC_CALC = new Set([
  'fn_precificar_dtf_uv_v2', 'fn_dtf_uv_capacidade_folha', 'fn_valor_e_legitimo',
  'fn_qualification_evaluate_v2', 'fn_closing_evaluate_v1', 'fn_joao_explicit_close_signal_v2',
]);

const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';

// ───────────────────────────── contexto por request ─────────────────────────────

type Bloqueio = { url: string; metodo: string; motivo: string; origem?: string };
type Leitura = { alvo: string; destino: 'PALCO' | 'ASOF' | 'NATIVO_CALC' | 'BLOCK'; filtro_aplicado?: string };
type Palco = { caso_id: string; versao_palco: number; as_of: string; estado: any; rpc_saidas: any; hashes: any };
type Store = {
  bloqueios: Bloqueio[];
  leituras: Leitura[];
  anthropic: { calls: number; input_tokens: number; output_tokens: number; temperature_forcada: boolean };
  palco: Palco | null;
  relogio: { baseMs: number; inicioReal: number } | null;
};
const als = new AsyncLocalStorage<Store>();
const store = (): Store | null => als.getStore() ?? null;

// ───────────────────────────── relógio congelado ─────────────────────────────
// O núcleo usa relógio em ~37 sítios e os remendos em ~62 (saudação [AGORA], horário
// comercial, "turno velho", expiração de lock, jaDespediuHoje). Sem congelar, dois
// replays do mesmo caso divergem pela hora do dia.

function agoraVirtual(): number {
  const s = store();
  if (!s?.relogio) return RealDate.now();
  return s.relogio.baseMs + (RealDate.now() - s.relogio.inicioReal);
}

function instalarRelogio() {
  const F: any = function (this: any, ...args: any[]) {
    // Construtor SEM argumentos → instante virtual. Com argumentos → inalterado.
    if (args.length === 0) return new (RealDate as any)(agoraVirtual());
    return new (RealDate as any)(...args);
  };
  F.prototype = RealDate.prototype;      // preserva `instanceof Date` e os métodos
  F.now = () => agoraVirtual();
  F.parse = RealDate.parse;
  F.UTC = RealDate.UTC;
  Object.defineProperty(F, 'name', { value: 'Date' });
  (globalThis as any).Date = F;
}

// ───────────────────────────── utilitários ─────────────────────────────

function urlDe(input: any): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return String(input?.url ?? input);
  } catch { return ''; }
}
function metodoDe(input: any, init?: any): string {
  return String(init?.method ?? input?.method ?? 'GET').toUpperCase();
}
function J(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function claims(token: string): any {
  try {
    const ps = token.split('.'); if (ps.length !== 3) return null;
    const s = ps[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(s + '='.repeat((4 - s.length % 4) % 4)));
  } catch { return null; }
}
function credencialServidorOk(): boolean {
  const p = claims(EXPECTED); const now = Math.floor(RealDate.now() / 1000);
  return !!p && p.role === 'replay_runner' && p.ref === 'ldrdtaibazplvrbwyrvx'
    && typeof p.exp === 'number' && p.exp > now;
}
async function digest(v: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
}
async function iguais(a: string, b: string) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function sha256Hex(v: string) {
  return [...await digest(v)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────────── PostgREST em memória ─────────────────────────────
// Aplica sobre o palco os filtros que o núcleo usa. Filtro desconhecido NUNCA
// "devolve tudo": vira BLOCK `filtro_nao_suportado`.

const PARAMS_CONTROLE = new Set(['select', 'order', 'limit', 'offset']);

function aplicaOperador(valorLinha: any, expr: string): boolean | null {
  const i = expr.indexOf('.');
  if (i < 0) return null;
  const op = expr.slice(0, i);
  const alvo = expr.slice(i + 1);
  switch (op) {
    case 'eq': return String(valorLinha ?? '') === alvo;
    case 'neq': return String(valorLinha ?? '') !== alvo;
    case 'in': {
      const lista = alvo.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      return lista.includes(String(valorLinha ?? ''));
    }
    case 'is':
      if (alvo === 'null') return valorLinha === null || valorLinha === undefined;
      if (alvo === 'true') return valorLinha === true;
      if (alvo === 'false') return valorLinha === false;
      return null;
    case 'gte': return String(valorLinha ?? '') >= alvo;
    case 'lte': return String(valorLinha ?? '') <= alvo;
    case 'gt': return String(valorLinha ?? '') > alvo;
    case 'lt': return String(valorLinha ?? '') < alvo;
    default: return null;   // desconhecido → o chamador bloqueia
  }
}

function servirDoPalco(linhas: any[], u: URL): { ok: true; corpo: any[]; filtro: string } | { ok: false; motivo: string } {
  let out = Array.isArray(linhas) ? [...linhas] : [];
  const descricao: string[] = [];

  for (const [chave, valor] of u.searchParams.entries()) {
    if (PARAMS_CONTROLE.has(chave)) continue;
    if (chave === 'and' || chave === 'or' || chave.startsWith('not.')) {
      return { ok: false, motivo: `filtro_nao_suportado:${chave}` };
    }
    const r = out.map((l) => aplicaOperador(l?.[chave], valor));
    if (r.some((x) => x === null)) return { ok: false, motivo: `filtro_nao_suportado:${chave}=${valor}` };
    out = out.filter((_, i) => r[i] === true);
    descricao.push(`${chave}=${valor}`);
  }

  const order = u.searchParams.get('order');
  if (order) {
    const [campo, ...mods] = order.split('.');
    const desc = mods.includes('desc');
    out.sort((a, b) => {
      const x = String(a?.[campo] ?? ''), y = String(b?.[campo] ?? '');
      return x === y ? 0 : (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
    descricao.push(`order=${order}`);
  }

  const offset = Number(u.searchParams.get('offset') ?? 0);
  if (offset > 0) { out = out.slice(offset); descricao.push(`offset=${offset}`); }
  const limit = u.searchParams.get('limit');
  if (limit) { out = out.slice(0, Number(limit)); descricao.push(`limit=${limit}`); }

  const select = u.searchParams.get('select');
  if (select && select !== '*') {
    const campos = select.split(',').map((s) => s.trim().split(':').pop()!.split('(')[0].trim()).filter(Boolean);
    if (campos.length) {
      out = out.map((l) => {
        const o: any = {};
        for (const c of campos) if (c in (l ?? {})) o[c] = l[c];
        return o;
      });
      descricao.push(`select=${select}`);
    }
  }
  return { ok: true, corpo: out, filtro: descricao.join('&') || '(sem filtro)' };
}

function respostaPostgrest(corpo: any[], input: any, init?: any) {
  const h = new Headers(init?.headers ?? input?.headers ?? {});
  const aceita = String(h.get('accept') ?? '');
  const total = corpo.length;
  if (aceita.includes('vnd.pgrst.object+json')) {
    if (total !== 1) {
      return new Response(JSON.stringify({
        code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
      }), { status: 406, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(corpo[0]), {
      status: 200,
      headers: { 'Content-Type': 'application/vnd.pgrst.object+json; charset=utf-8', 'content-range': '0-0/1' },
    });
  }
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'content-range': total ? `0-${total - 1}/${total}` : `*/0`,
    },
  });
}

// ───────────────────────────── política de rede ─────────────────────────────

type Decisao = 'ALLOW_NATIVE' | 'ALLOW_ANTHROPIC' | 'PALCO' | 'ASOF' | 'BLOCK';

function politica(raw: string, metodo: string): { decisao: Decisao; motivo: string; alvo?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { decisao: 'BLOCK', motivo: 'url_invalida' }; }

  if (u.origin === 'https://api.anthropic.com') {
    if (u.pathname === '/v1/messages') return { decisao: 'ALLOW_ANTHROPIC', motivo: 'anthropic_messages' };
    return { decisao: 'BLOCK', motivo: 'anthropic_endpoint_nao_mapeado' };
  }

  if (SUPABASE_URL && u.origin === new URL(SUPABASE_URL).origin) {
    if (u.pathname.startsWith('/functions/v1/')) return { decisao: 'BLOCK', motivo: 'edge_function_invocacao' };
    if (!u.pathname.startsWith('/rest/v1/')) return { decisao: 'BLOCK', motivo: 'supabase_endpoint_nao_mapeado' };

    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = decodeURIComponent(u.pathname.slice('/rest/v1/rpc/'.length).split('/')[0]);
      if (metodo !== 'POST' && metodo !== 'GET') return { decisao: 'BLOCK', motivo: `rpc_metodo:${metodo}` };
      if (RPC_PALCO.has(fn)) return { decisao: 'PALCO', motivo: 'rpc_contexto_congelada', alvo: `rpc:${fn}` };
      if (RPC_CALC.has(fn)) return { decisao: 'ALLOW_NATIVE', motivo: 'rpc_calculadora', alvo: `rpc:${fn}` };
      return { decisao: 'BLOCK', motivo: `rpc_fora_da_lista:${fn}`, alvo: `rpc:${fn}` };
    }

    const tabela = decodeURIComponent(u.pathname.slice('/rest/v1/'.length).split('?')[0]);
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      return { decisao: 'BLOCK', motivo: `escrita_tabela:${tabela}`, alvo: tabela };
    }
    if (tabela === LOCK_VAZIO) return { decisao: 'PALCO', motivo: 'lock_sempre_vazio', alvo: tabela };
    if (CONGELADAS.has(tabela)) return { decisao: 'PALCO', motivo: 'tabela_congelada', alvo: tabela };
    if (APPEND_ONLY[tabela]) return { decisao: 'ASOF', motivo: 'append_only_corte_as_of', alvo: tabela };
    return { decisao: 'BLOCK', motivo: `leitura_nao_classificada:${tabela}`, alvo: tabela };
  }

  if (ERP_URL && u.origin === new URL(ERP_URL).origin) return { decisao: 'BLOCK', motivo: 'erp_supabase' };

  const h = u.hostname;
  if (h === 'api.z-api.io' || h.endsWith('.z-api.io')) return { decisao: 'BLOCK', motivo: 'zapi_whatsapp' };
  if (h.endsWith('botconversa.com.br')) return { decisao: 'BLOCK', motivo: 'botconversa' };
  if (h.includes('mercadopago')) return { decisao: 'BLOCK', motivo: 'mercadopago' };
  if (h === 'pay.smartpag.com.br') return { decisao: 'BLOCK', motivo: 'smartpag_checkout' };
  if (h === 'api.frenet.com.br') return { decisao: 'BLOCK', motivo: 'SEM_REPRODUCAO_FRETE' };
  if (h === 'api.openai.com') return { decisao: 'BLOCK', motivo: 'openai_transcricao_audio' };
  if (h === 'drive.google.com' || h === 'docs.google.com' || h === 'drive.usercontent.google.com') {
    return { decisao: 'BLOCK', motivo: 'google_drive_intake' };
  }
  return { decisao: 'BLOCK', motivo: 'destino_nao_mapeado' };
}

function origemAproximada(): string | undefined {
  try {
    for (const l of String(new Error().stack ?? '').split('\n')) {
      const m = l.match(/patches\/([^/]+)\/([^:) ]+)/);
      if (m) return `${m[1]}/${m[2]}`;
    }
  } catch { /* atribuição é opcional */ }
  return undefined;
}

function bloquear(raw: string, metodo: string, motivo: string, alvo?: string) {
  const s = store();
  if (s) {
    s.bloqueios.push({ url: raw, metodo, motivo, origem: origemAproximada() });
    s.leituras.push({ alvo: alvo ?? raw, destino: 'BLOCK', filtro_aplicado: motivo });
  }
  let target = raw;
  try { target = new URL(raw).host; } catch { /* mantém raw */ }
  // 409 é terminal para a v288: nenhuma das 38 camadas trata 409 como retry.
  return J(409, { ok: false, hermetic_block: true, target, motivo, dry_run: true });
}

// ───────────────────────────── fundo da cadeia (a jaula) ─────────────────────────────

async function leituraNativa(input: any, init?: any) {
  const h = new Headers(init?.headers ?? input?.headers ?? {});
  if (PUBLIC_API_KEY) h.set('apikey', PUBLIC_API_KEY);
  return await NATIVE_FETCH(input as any, { ...(init ?? {}), headers: h });
}

async function anthropicNativa(input: any, init?: any) {
  const s = store();
  let usarInit = init;
  // Determinismo: o núcleo não passa `temperature` (default 1.0), então o texto de
  // `mensagem` varia entre duas execuções com prompt idêntico e quebraria o
  // normalized_hash sem que houvesse regressão. Ajuste de HARNESS, não da v288.
  try {
    const brutoBody = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof brutoBody === 'string' && brutoBody) {
      const corpo = JSON.parse(brutoBody);
      if (corpo && typeof corpo === 'object') {
        corpo.temperature = 0;
        usarInit = { ...(init ?? {}), method: 'POST', body: JSON.stringify(corpo) };
        if (!usarInit.headers) usarInit.headers = new Headers((input as any)?.headers ?? {});
        if (s) s.anthropic.temperature_forcada = true;
      }
    }
  } catch { /* corpo não-JSON: segue sem forçar */ }

  const res = await NATIVE_FETCH(input as any, usarInit);
  if (s) {
    s.anthropic.calls++;
    try {
      const body: any = await res.clone().json();
      s.anthropic.input_tokens += Number(body?.usage?.input_tokens ?? 0);
      s.anthropic.output_tokens += Number(body?.usage?.output_tokens ?? 0);
    } catch { /* resposta não-JSON não invalida a execução */ }
  }
  return res;
}

async function servirPalco(u: URL, input: any, init?: any, alvo?: string): Promise<Response> {
  const s = store();
  if (!s?.palco) return bloquear(u.href, metodoDe(input, init), 'palco_ausente', alvo);

  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = decodeURIComponent(u.pathname.slice('/rest/v1/rpc/'.length).split('/')[0]);
    const saida = s.palco.rpc_saidas?.[fn];
    if (saida === undefined) return bloquear(u.href, 'POST', `rpc_sem_palco:${fn}`, alvo);
    s.leituras.push({ alvo: `rpc:${fn}`, destino: 'PALCO', filtro_aplicado: '(saída congelada)' });
    return new Response(JSON.stringify(saida), {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const tabela = decodeURIComponent(u.pathname.slice('/rest/v1/'.length).split('?')[0]);
  const linhas = tabela === LOCK_VAZIO ? [] : (s.palco.estado?.[tabela] ?? null);
  if (linhas === null) return bloquear(u.href, 'GET', `tabela_sem_palco:${tabela}`, alvo);

  const r = servirDoPalco(linhas, u);
  if (!r.ok) return bloquear(u.href, 'GET', r.motivo, alvo);
  s.leituras.push({ alvo: tabela, destino: 'PALCO', filtro_aplicado: r.filtro });
  return respostaPostgrest(r.corpo, input, init);
}

async function servirAsOf(u: URL, input: any, init?: any, alvo?: string): Promise<Response> {
  const s = store();
  if (!s?.palco) return bloquear(u.href, metodoDe(input, init), 'palco_ausente', alvo);
  const tabela = decodeURIComponent(u.pathname.slice('/rest/v1/'.length).split('?')[0]);
  const coluna = APPEND_ONLY[tabela];
  const nova = new URL(u.href);
  nova.searchParams.append(coluna, `lte.${s.palco.as_of}`);
  s.leituras.push({ alvo: tabela, destino: 'ASOF', filtro_aplicado: `${coluna}=lte.${s.palco.as_of}` });
  return await leituraNativa(nova.href, init);
}

// Raiz da cadeia. Tudo que as 38 camadas repassarem termina aqui.
async function baseFetch(input: any, init?: any): Promise<Response> {
  const raw = urlDe(input);
  const metodo = metodoDe(input, init);
  const { decisao, motivo, alvo } = politica(raw, metodo);
  if (decisao === 'ALLOW_ANTHROPIC') return await anthropicNativa(input, init);
  if (decisao === 'PALCO') return await servirPalco(new URL(raw), input, init, alvo);
  if (decisao === 'ASOF') return await servirAsOf(new URL(raw), input, init, alvo);
  if (decisao === 'ALLOW_NATIVE') {
    store()?.leituras.push({ alvo: alvo ?? raw, destino: 'NATIVO_CALC', filtro_aplicado: motivo });
    return await leituraNativa(input, init);
  }
  return bloquear(raw, metodo, motivo, alvo);
}

// ───────────────────────────── ponte: captura cada reatribuição ─────────────────────────────

let camadasFetch = 0;

function instalarPonte() {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let current: any = baseFetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    enumerable: anterior?.enumerable ?? true,
    get() { return current; },
    set(fn: any) {
      camadasFetch++;
      const interna = fn;
      // Guarda por camada: corta BLOCK na origem. PALCO/ASOF/ALLOW_* descem a cadeia
      // para que os preloads continuem podendo interceptar e transformar leituras —
      // é isso que preserva a fidelidade com produção. A resolução final é no baseFetch.
      current = async (input: any, init?: any) => {
        const raw = urlDe(input);
        const metodo = metodoDe(input, init);
        const d = politica(raw, metodo);
        if (d.decisao === 'BLOCK') return bloquear(raw, metodo, d.motivo, d.alvo);
        return await interna(input, init);
      };
    },
  });
  return () => {
    if (anterior) Object.defineProperty(globalThis, 'fetch', anterior);
    else Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: NATIVE_FETCH });
  };
}

// ───────────────────────────── carga da composição v288 ─────────────────────────────

instalarPonte();
instalarRelogio();

let handlerProducao: any = null;
let serveChamadas = 0;
(Deno as any).serve = (a: any, b?: any) => {
  serveChamadas++;
  handlerProducao = typeof a === 'function' ? a : b;
  return { shutdown: async () => {}, finished: Promise.resolve(), addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' } };
};

// A composição é importada com a ponte e o relógio JÁ instalados: os 33 preloads que
// fazem `globalThis.fetch.bind(globalThis)` no import recebem a jaula como base.
await import('./composicao-v288.ts');

(Deno as any).serve = NATIVE_SERVE;
if (!handlerProducao) throw new Error('handler_producao_ausente');

// ───────────────────────────── normalização para hash ─────────────────────────────
// Gate DURO (13/13): responde, etapa, tema, encaminhou_venda, slots, tools, json_invalido.
// Gate BRANDO (relatório, não reprova): texto de `mensagem`. Ver LEIA-ME.md §8.

const CHAVES_VOLATEIS = new Set([
  'decision_id', 'execution_id', 'operation_id', 'operation_ids', 'created_at',
  'executed_at', 'duracao_ms', 'tempo_execucao_ms', 'messageId',
]);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_DUROS = ['responde', 'etapa', 'tema', 'encaminhou_venda', 'slots'];

function ehVolatil(chave: string, valor: any): boolean {
  if (CHAVES_VOLATEIS.has(chave)) return true;
  if (/_id$/.test(chave) && typeof valor === 'string' && RE_UUID.test(valor)) return true;
  if (/_at$/.test(chave) && typeof valor === 'string') return true;
  return false;
}
function normalizar(v: any): any {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      if (ehVolatil(k, v[k])) continue;
      out[k] = normalizar(v[k]);
    }
    return out;
  }
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  return v;
}
// O hash duro ignora `mensagem` de propósito: temperature=0 reduz a variação mas não
// a elimina, e texto variando sem mudança de decisão não é regressão.
function projecaoDura(json: any, tools: any, jsonInvalido: boolean): any {
  const o: any = { json_invalido: jsonInvalido, tools: normalizar(tools ?? null) };
  for (const c of CAMPOS_DUROS) o[c] = normalizar(json?.[c] ?? null);
  return o;
}

// ───────────────────────────── palco e gate ─────────────────────────────

async function carregarPalco(casoId: string): Promise<Palco | null> {
  const r = await leituraNativa(
    `${SUPABASE_URL}/rest/v1/replay_palco_congelado?caso_id=eq.${encodeURIComponent(casoId)}` +
    `&select=caso_id,versao_palco,as_of,estado,rpc_saidas,hashes&order=versao_palco.desc&limit=1`,
    { headers: { Authorization: `Bearer ${PUBLIC_API_KEY}` } },
  );
  const j = await r.json();
  return Array.isArray(j) && j[0] ? j[0] as Palco : null;
}

async function podeExecutar(cicloId: string): Promise<any> {
  const r = await leituraNativa(`${SUPABASE_URL}/rest/v1/rpc/fn_replay_pode_executar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PUBLIC_API_KEY}` },
    body: JSON.stringify({ p_ciclo_id: cicloId }),
  });
  return await r.json();
}

async function carregarCaso(casoId: string): Promise<any> {
  const r = await leituraNativa(
    `${SUPABASE_URL}/rest/v1/replay_caso?id=eq.${encodeURIComponent(casoId)}&select=*`,
    { headers: { Authorization: `Bearer ${PUBLIC_API_KEY}` } },
  );
  const j = await r.json();
  return Array.isArray(j) ? j[0] : j;
}

function entradaDoCaso(c: any) {
  return {
    phone: String(c.phone ?? '').replace(/\D/g, ''),
    chat_name: 'Cliente',
    mensagem: String(c.inbound_texto ?? ''),
    inbound_id: c.inbound_id ?? null,
  };
}

// Classificação estática, para o modo `ensaiar`: o que CADA alvo conhecido faria.
function leiturasPlanejadas(palco: Palco): Leitura[] {
  const out: Leitura[] = [];
  for (const t of [...CONGELADAS].sort()) {
    out.push({
      alvo: t,
      destino: palco.estado?.[t] ? 'PALCO' : 'BLOCK',
      filtro_aplicado: palco.estado?.[t] ? `${(palco.estado[t] as any[]).length} linha(s) no palco` : 'tabela_sem_palco',
    });
  }
  out.push({ alvo: LOCK_VAZIO, destino: 'PALCO', filtro_aplicado: 'sempre []' });
  for (const t of Object.keys(APPEND_ONLY).sort()) {
    out.push({ alvo: t, destino: 'ASOF', filtro_aplicado: `${APPEND_ONLY[t]}=lte.${palco.as_of}` });
  }
  for (const f of [...RPC_PALCO].sort()) {
    out.push({
      alvo: `rpc:${f}`,
      destino: palco.rpc_saidas?.[f] !== undefined ? 'PALCO' : 'BLOCK',
      filtro_aplicado: palco.rpc_saidas?.[f] !== undefined ? '(saída congelada)' : 'rpc_sem_palco',
    });
  }
  for (const f of [...RPC_CALC].sort()) {
    out.push({ alvo: `rpc:${f}`, destino: 'NATIVO_CALC', filtro_aplicado: 'pura/STABLE sobre tabela congelada' });
  }
  return out;
}

// ───────────────────────────── servidor ─────────────────────────────

NATIVE_SERVE(async (req: Request) => {
  if (!credencialServidorOk()) return J(503, { ok: false, motivo: 'replay_credencial_servidor_invalida' });
  if (!PUBLIC_API_KEY) return J(503, { ok: false, motivo: 'supabase_public_api_key_ausente' });

  const h = req.headers.get('authorization') ?? '';
  const got = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!got || !(await iguais(got, EXPECTED))) return J(401, { ok: false, motivo: 'replay_nao_autorizado' });

  let body: any;
  try { body = await req.json(); } catch { return J(400, { ok: false, motivo: 'json_invalido' }); }

  const modo = String(body?.modo ?? 'executar');

  // ── inspecionar: diagnóstico de montagem. Não executa caso nenhum. ──
  if (modo === 'inspecionar') {
    let palcoDisponivel = false;
    try {
      const r = await leituraNativa(
        `${SUPABASE_URL}/rest/v1/replay_palco_congelado?select=caso_id&limit=1`,
        { headers: { Authorization: `Bearer ${PUBLIC_API_KEY}` } },
      );
      palcoDisponivel = r.ok && Array.isArray(await r.json());
    } catch { palcoDisponivel = false; }

    // Prova do relógio, dentro de um contexto com base conhecida.
    const baseIso = '2026-08-27T03:04:48.335Z';
    const provaRelogio = await als.run(
      { bloqueios: [], leituras: [], palco: null,
        anthropic: { calls: 0, input_tokens: 0, output_tokens: 0, temperature_forcada: false },
        relogio: { baseMs: RealDate.parse(baseIso), inicioReal: RealDate.now() } },
      async () => {
        const a = new Date().toISOString();
        const t1 = Date.now(); const t2 = Date.now();
        return {
          base: baseIso,
          new_Date_toISOString: a,
          proximo_de_as_of: Math.abs(RealDate.parse(a) - RealDate.parse(baseIso)) < 5000,
          Date_now_monotonico: t2 >= t1,
          construtor_com_argumento_intacto: new Date('2026-01-01T00:00:00Z').toISOString() === '2026-01-01T00:00:00.000Z',
        };
      },
    );

    return J(200, {
      ok: true,
      harness: HARNESS_VERSION,
      composicao_sha256: COMPOSICAO_SHA256,
      camadas_fetch_capturadas: camadasFetch,
      deno_serve_chamadas: serveChamadas,
      handler_producao: !!handlerProducao,
      palco_disponivel: palcoDisponivel,
      relogio_congelado: provaRelogio.proximo_de_as_of && provaRelogio.Date_now_monotonico
        && provaRelogio.construtor_com_argumento_intacto,
      prova_relogio: provaRelogio,
      tz: Deno.env.get('TZ') ?? null,
      tarifa: TARIFA,
      roteamento: {
        congeladas: [...CONGELADAS].sort(),
        append_only: APPEND_ONLY,
        rpc_palco: [...RPC_PALCO].sort(),
        rpc_calculadora: [...RPC_CALC].sort(),
        lock_vazio: LOCK_VAZIO,
        default: 'BLOCK',
      },
    });
  }

  const casoId = String(body?.replay_case_id ?? body?.caso_id ?? '').trim();
  if (!casoId) return J(400, { ok: false, motivo: 'replay_case_id_obrigatorio' });

  const caso = await carregarCaso(casoId);
  if (!caso?.id) return J(404, { ok: false, motivo: 'caso_inexistente' });

  const palco = await carregarPalco(casoId);
  if (!palco) return J(424, { ok: false, motivo: 'PALCO_AUSENTE', detalhe: 'rodar fn_replay_congelar_palco_v288 para este caso' });

  const entrada = entradaDoCaso(caso);

  // ── ensaiar: monta tudo, resolve o palco, aplica o relógio, e PARA antes do handler. ──
  if (modo === 'ensaiar') {
    const planejadas = leiturasPlanejadas(palco);
    const relogio = { baseMs: RealDate.parse(palco.as_of), inicioReal: RealDate.now() };
    const amostraRelogio = await als.run(
      { bloqueios: [], leituras: [], palco,
        anthropic: { calls: 0, input_tokens: 0, output_tokens: 0, temperature_forcada: false }, relogio },
      async () => new Date().toISOString(),
    );
    return J(200, {
      ok: true,
      modo: 'ensaiar',
      harness: HARNESS_VERSION,
      caso_id: caso.id,
      palco: { versao_palco: palco.versao_palco, as_of: palco.as_of, hashes: palco.hashes },
      body_que_enviaria: entrada,
      relogio_do_ensaio: amostraRelogio,
      leituras_planejadas: planejadas,
      nativo_em_mutavel: planejadas.filter((l) => l.destino === 'NATIVO_CALC' && CONGELADAS.has(l.alvo)).length,
      handler_chamado: false,
      custo_usd: 0,
    });
  }

  // ── executar ──
  const cicloId = String(body?.ciclo_id ?? '').trim();
  if (!cicloId) return J(400, { ok: false, motivo: 'ciclo_id_obrigatorio' });

  const gate = await podeExecutar(cicloId);
  if (gate?.pode !== true) return J(423, { ok: false, motivo: 'gate_replay_fechado', gate });

  const st: Store = {
    bloqueios: [], leituras: [], palco,
    anthropic: { calls: 0, input_tokens: 0, output_tokens: 0, temperature_forcada: false },
    relogio: { baseMs: RealDate.parse(palco.as_of), inicioReal: RealDate.now() },
  };
  const t0 = RealDate.now();

  let resposta: any = null;
  let erro: string | null = null;
  try {
    resposta = await als.run(st, async () => {
      const r = await handlerProducao(new Request('https://replay.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entrada),
      }));
      const txt = await r.text();
      try { return { status: r.status, json: JSON.parse(txt) }; }
      catch { return { status: r.status, json: null, texto: txt }; }
    });
  } catch (e) {
    erro = String((e as any)?.message ?? e);
  }

  const jsonInvalido = !erro && resposta?.json == null;
  const tools = resposta?.json?.tools ?? resposta?.json?.tools_usadas ?? null;
  const raw_hash = await sha256Hex(JSON.stringify(resposta?.json ?? resposta ?? null));
  const normalized_hash = await sha256Hex(JSON.stringify(projecaoDura(resposta?.json, tools, jsonInvalido)));
  const custo_usd =
    (st.anthropic.input_tokens / 1e6) * TARIFA.input_usd_per_million +
    (st.anthropic.output_tokens / 1e6) * TARIFA.output_usd_per_million;

  const nativoEmMutavel = st.leituras.filter(
    (l) => l.destino === 'NATIVO_CALC' && CONGELADAS.has(l.alvo),
  ).length;

  return J(200, {
    ok: !erro,
    harness: HARNESS_VERSION,
    composicao_sha256: COMPOSICAO_SHA256,
    caso_id: caso.id,
    ciclo_id: cicloId,
    palco: { versao_palco: palco.versao_palco, as_of: palco.as_of, hashes: palco.hashes },
    entrada,
    resposta,
    erro,
    raw_hash,
    normalized_hash,
    json_invalido: jsonInvalido,
    bloqueios: st.bloqueios,
    leituras: st.leituras,
    nativo_em_mutavel: nativoEmMutavel,   // gate: tem de ser 0
    anthropic: { ...st.anthropic, custo_usd: Number(custo_usd.toFixed(6)), tarifa: TARIFA },
    duracao_ms: RealDate.now() - t0,
  });
});
