// João replay hermético v288 — harness — 12/09/2026
//
// O que é: um wrapper que carrega a composição v288 (os mesmos 38 imports pinados
// da edge `agente-noturno` viva) dentro de uma jaula de rede, captura o handler de
// produção e executa um caso de `replay_caso` sem deixar nenhum efeito sair.
//
// Diferença essencial para `agente-noturno-replay` v17:
//   v17 instala a ponte de fetch DENTRO do handler, isto é, DEPOIS do import do
//   candidato. Naquele desenho `current` já nasce sendo a cadeia pronta e a política
//   nunca envolve as camadas existentes — só reatribuições futuras. O candidato v4374
//   era hermético por conta própria, então isso bastava.
//   A v288 NÃO é hermética: 33 dos 38 arquivos reatribuem globalThis.fetch no IMPORT.
//   Aqui a ponte é instalada ANTES da composição, de modo que a raiz da cadeia é
//   `baseFetch` (a jaula) e toda reatribuição passa pelo setter.
//
// Política de rede: LISTA FECHADA. O default é BLOCK.
// Ver LEIA-ME.md para a tabela completa de destinos e a prova da cadeia.

import { AsyncLocalStorage } from 'node:async_hooks';

declare const Deno: any;

const HARNESS_VERSION = 'joao-replay-hermetico-v288/harness-v1';
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

// Herdado literalmente do v17. Qualquer RPC fora desta lista é POST e cai em BLOCK.
const SAFE_READ_RPCS = new Set([
  'fn_agente_pausado', 'fn_contexto_aprendizados', 'fn_contexto_comercial_do_lead',
  'fn_dtf_uv_capacidade_folha', 'fn_precificar_dtf_uv_v2', 'fn_valor_e_legitimo', 'fn_replay_snapshot',
]);

const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';

// ───────────────────────────── contexto por request ─────────────────────────────

type Bloqueio = { url: string; metodo: string; motivo: string; origem?: string };
type Store = {
  bloqueios: Bloqueio[];
  anthropic: { calls: number; input_tokens: number; output_tokens: number };
};
const als = new AsyncLocalStorage<Store>();
const store = (): Store | null => als.getStore() ?? null;

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
  const p = claims(EXPECTED); const now = Math.floor(Date.now() / 1000);
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

// ───────────────────────────── política de rede ─────────────────────────────

type Decisao = 'ALLOW_NATIVE' | 'ALLOW_ANTHROPIC' | 'BLOCK';

function politica(raw: string, metodo: string): { decisao: Decisao; motivo: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { decisao: 'BLOCK', motivo: 'url_invalida' }; }

  // 1. Anthropic — única chamada real permitida; é ela que consome o orçamento.
  if (u.origin === 'https://api.anthropic.com') {
    if (u.pathname === '/v1/messages') return { decisao: 'ALLOW_ANTHROPIC', motivo: 'anthropic_messages' };
    return { decisao: 'BLOCK', motivo: 'anthropic_endpoint_nao_mapeado' };
  }

  // 2. Supabase próprio (cérebro-vendas).
  if (SUPABASE_URL && u.origin === new URL(SUPABASE_URL).origin) {
    if (u.pathname.startsWith('/functions/v1/')) {
      return { decisao: 'BLOCK', motivo: 'edge_function_invocacao' };
    }
    if (!u.pathname.startsWith('/rest/v1/')) {
      return { decisao: 'BLOCK', motivo: 'supabase_endpoint_nao_mapeado' };
    }
    if (metodo === 'GET' || metodo === 'HEAD') {
      return { decisao: 'ALLOW_NATIVE', motivo: 'leitura_rest' };
    }
    if (metodo === 'POST' && u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = decodeURIComponent(u.pathname.slice('/rest/v1/rpc/'.length).split('/')[0]);
      if (SAFE_READ_RPCS.has(fn)) return { decisao: 'ALLOW_NATIVE', motivo: 'rpc_read_only' };
      return { decisao: 'BLOCK', motivo: `rpc_fora_da_lista:${fn}` };
    }
    // POST/PATCH/PUT/DELETE em tabela = escrita de negócio.
    return { decisao: 'BLOCK', motivo: `escrita_tabela:${u.pathname.replace('/rest/v1/', '')}` };
  }

  // 3. ERP (projeto separado) — leitura ou escrita, sempre bloqueado.
  if (ERP_URL && u.origin === new URL(ERP_URL).origin) {
    return { decisao: 'BLOCK', motivo: 'erp_supabase' };
  }

  // 4. Provedores externos com efeito no mundo real.
  const h = u.hostname;
  if (h === 'api.z-api.io' || h.endsWith('.z-api.io')) return { decisao: 'BLOCK', motivo: 'zapi_whatsapp' };
  if (h === 'backend.botconversa.com.br' || h.endsWith('botconversa.com.br')) return { decisao: 'BLOCK', motivo: 'botconversa' };
  if (h === 'api.mercadopago.com' || h.includes('mercadopago')) return { decisao: 'BLOCK', motivo: 'mercadopago' };
  if (h === 'pay.smartpag.com.br') return { decisao: 'BLOCK', motivo: 'smartpag_checkout' };

  // 5. Frete: bloqueado por padrão (regra 1.4). Caso que dependa disso vira SEM_REPRODUCAO_FRETE.
  if (h === 'api.frenet.com.br') return { decisao: 'BLOCK', motivo: 'SEM_REPRODUCAO_FRETE' };

  // 6. Destinos encontrados no grep dos 38 arquivos que NÃO constavam da tabela 1.4 do
  //    briefing. Entram nomeados para ficarem legíveis no relatório; decisão é BLOCK.
  if (h === 'api.openai.com') return { decisao: 'BLOCK', motivo: 'openai_transcricao_audio' };
  if (h === 'drive.google.com' || h === 'docs.google.com' || h === 'drive.usercontent.google.com') {
    return { decisao: 'BLOCK', motivo: 'google_drive_intake' };
  }

  return { decisao: 'BLOCK', motivo: 'destino_nao_mapeado' };
}

function origemAproximada(): string | undefined {
  // Atribuição best-effort: primeira linha do stack que aponte para um dos 38 arquivos.
  try {
    const linhas = String(new Error().stack ?? '').split('\n');
    for (const l of linhas) {
      const m = l.match(/patches\/([^/]+)\/([^:) ]+)/);
      if (m) return `${m[1]}/${m[2]}`;
    }
  } catch { /* atribuição é opcional */ }
  return undefined;
}

function respostaBloqueio(raw: string, motivo: string) {
  let target = raw;
  try { target = new URL(raw).host; } catch { /* mantém raw */ }
  // 409 é terminal para as camadas da v288: nenhuma das 38 trata 409 como retry
  // (só 4 sítios mencionam 409 e todos o PRODUZEM). Ver LEIA-ME.md §5.
  return J(409, { ok: false, hermetic_block: true, target, motivo, dry_run: true });
}

function bloquear(raw: string, metodo: string, motivo: string) {
  const s = store();
  if (s) s.bloqueios.push({ url: raw, metodo, motivo, origem: origemAproximada() });
  return respostaBloqueio(raw, motivo);
}

// ───────────────────────────── fundo da cadeia (a jaula) ─────────────────────────────

async function leituraNativa(input: any, init?: any) {
  const h = new Headers(init?.headers ?? input?.headers ?? {});
  if (PUBLIC_API_KEY) h.set('apikey', PUBLIC_API_KEY);
  return await NATIVE_FETCH(input as any, { ...(init ?? {}), headers: h });
}

async function anthropicNativa(input: any, init?: any) {
  const s = store();
  const res = await NATIVE_FETCH(input as any, init);
  if (s) {
    s.anthropic.calls++;
    try {
      const clone = res.clone();
      const body: any = await clone.json();
      s.anthropic.input_tokens += Number(body?.usage?.input_tokens ?? 0);
      s.anthropic.output_tokens += Number(body?.usage?.output_tokens ?? 0);
    } catch { /* resposta não-JSON não invalida a execução */ }
  }
  return res;
}

// Raiz da cadeia. Tudo que as 38 camadas repassarem termina aqui.
async function baseFetch(input: any, init?: any): Promise<Response> {
  const raw = urlDe(input);
  const metodo = metodoDe(input, init);
  const { decisao, motivo } = politica(raw, metodo);
  if (decisao === 'ALLOW_NATIVE') return await leituraNativa(input, init);
  if (decisao === 'ALLOW_ANTHROPIC') return await anthropicNativa(input, init);
  return bloquear(raw, metodo, motivo);
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
      // Guarda por camada: corta na origem o que já é proibido, sem esperar chegar ao
      // fundo. ALLOW_* desce a cadeia para que os preloads continuem podendo
      // interceptar e transformar leituras — é isso que preserva a fidelidade com
      // produção. A resolução final ALLOW_NATIVE/ALLOW_ANTHROPIC é só no baseFetch.
      current = async (input: any, init?: any) => {
        const raw = urlDe(input);
        const metodo = metodoDe(input, init);
        const { decisao, motivo } = politica(raw, metodo);
        if (decisao === 'BLOCK') return bloquear(raw, metodo, motivo);
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

const restaurarFetch = instalarPonte();

let handlerProducao: any = null;
let serveChamadas = 0;
(Deno as any).serve = (a: any, b?: any) => {
  serveChamadas++;
  handlerProducao = typeof a === 'function' ? a : b;
  return { shutdown: async () => {}, finished: Promise.resolve(), addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' } };
};

// A composição é importada com a ponte JÁ instalada: os 33 preloads que fazem
// `globalThis.fetch.bind(globalThis)` no import recebem a jaula como base.
await import('./composicao-v288.ts');

(Deno as any).serve = NATIVE_SERVE;
if (!handlerProducao) throw new Error('handler_producao_ausente');

// ───────────────────────────── normalização para hash ─────────────────────────────

const CHAVES_VOLATEIS = new Set([
  'decision_id', 'execution_id', 'operation_id', 'operation_ids', 'created_at',
  'executed_at', 'duracao_ms', 'tempo_execucao_ms', 'messageId',
]);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehVolatil(chave: string, valor: any): boolean {
  if (CHAVES_VOLATEIS.has(chave)) return true;
  // *_at e *_id só saem quando o valor é de fato UUID (ou timestamp, para *_at).
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

// ───────────────────────────── gate ─────────────────────────────

async function podeExecutar(cicloId: string): Promise<any> {
  const res = await leituraNativa(`${SUPABASE_URL}/rest/v1/rpc/fn_replay_pode_executar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PUBLIC_API_KEY}` },
    body: JSON.stringify({ p_ciclo_id: cicloId }),
  });
  return await res.json();
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

  // Modo diagnóstico: não executa caso nenhum, só descreve a montagem.
  if (body?.modo === 'inspecionar') {
    return J(200, {
      ok: true,
      harness: HARNESS_VERSION,
      composicao_sha256: COMPOSICAO_SHA256,
      camadas_fetch_capturadas: camadasFetch,
      deno_serve_chamadas: serveChamadas,
      handler_producao: !!handlerProducao,
      tarifa: TARIFA,
    });
  }

  const cicloId = String(body?.ciclo_id ?? '').trim();
  const casoId = String(body?.replay_case_id ?? body?.caso_id ?? '').trim();
  if (!cicloId || !casoId) return J(400, { ok: false, motivo: 'ciclo_id_e_replay_case_id_obrigatorios' });

  // Gate do banco. FAIL CLOSED: sem `pode=true` explícito, nada roda.
  const gate = await podeExecutar(cicloId);
  if (gate?.pode !== true) {
    return J(423, { ok: false, motivo: 'gate_replay_fechado', gate });
  }

  // Trava de contrato. O núcleo da v288 (arquivo 22, joao-slot-proveniencia-escrita)
  // NÃO tem suporte a replay: não conhece replay_case_id, fn_replay_snapshot nem
  // __ctxHermetico — tudo isso era do candidato v4374 (3063c81c). Sem isso ele lê
  // estado VIVO do lead, que mudou desde `as_of`, e o baseline não seria fiel.
  // Ver LEIA-ME.md §6. Enquanto essa lacuna não for fechada, fail closed.
  if (body?.aceitar_contrato_divergente !== true) {
    return J(422, {
      ok: false,
      motivo: 'CONTRATO_V288_SEM_SNAPSHOT',
      detalhe: 'nucleo v288 nao implementa replay_case_id/fn_replay_snapshot; leria estado vivo do lead',
      ver: 'LEIA-ME.md secao 6',
    });
  }

  const caso = await (await leituraNativa(
    `${SUPABASE_URL}/rest/v1/replay_caso?id=eq.${encodeURIComponent(casoId)}&select=*`,
    { headers: { Authorization: `Bearer ${PUBLIC_API_KEY}` } },
  )).json();
  const c = Array.isArray(caso) ? caso[0] : caso;
  if (!c?.id) return J(404, { ok: false, motivo: 'caso_inexistente' });

  const st: Store = { bloqueios: [], anthropic: { calls: 0, input_tokens: 0, output_tokens: 0 } };
  const t0 = Date.now();

  const entrada = {
    phone: String(c.phone ?? '').replace(/\D/g, ''),
    chat_name: 'Cliente',
    mensagem: String(c.inbound_texto ?? ''),
    inbound_id: c.inbound_id ?? null,
  };

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

  const bruto = JSON.stringify(resposta?.json ?? resposta ?? null);
  const raw_hash = await sha256Hex(bruto);
  const normalized_hash = await sha256Hex(JSON.stringify(normalizar(resposta?.json ?? null)));
  const custo_usd =
    (st.anthropic.input_tokens / 1e6) * TARIFA.input_usd_per_million +
    (st.anthropic.output_tokens / 1e6) * TARIFA.output_usd_per_million;

  return J(200, {
    ok: !erro,
    harness: HARNESS_VERSION,
    composicao_sha256: COMPOSICAO_SHA256,
    caso_id: c.id,
    ciclo_id: cicloId,
    entrada,
    resposta,
    erro,
    raw_hash,
    normalized_hash,
    bloqueios: st.bloqueios,
    anthropic: { ...st.anthropic, custo_usd: Number(custo_usd.toFixed(6)), tarifa: TARIFA },
    duracao_ms: Date.now() - t0,
  });
});
