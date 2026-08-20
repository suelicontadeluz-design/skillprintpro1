// Carrega o ARTEFATO REAL (supabase/functions/agente-noturno/index.ts) num processo
// Node, aplicando apenas os shims de FRONTEIRA DE RUNTIME — nada de logica:
//
//   1. o unico import remoto (supabase-js via esm.sh) vira o cliente fake local;
//   2. `Deno.serve(fn)` vira `export const __handler = (fn)`, para o teste poder
//      invocar o handler HTTP sem subir servidor;
//   3. Deno.env e fetch sao instalados em globalThis antes do import.
//
// Cada substituicao e verificada por contagem: se o artefato mudar de forma que o
// shim nao case exatamente uma vez, o harness FALHA em vez de testar outra coisa.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CAMINHO_AGENTE = resolve(AQUI, '../../supabase/functions/agente-noturno/index.ts');
const MOCK_SUPABASE = pathToFileURL(join(AQUI, 'mock_supabase_js.mjs')).href;

const SUBS = [
  ["import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
   `import { createClient } from '${MOCK_SUPABASE}';`],
  ['Deno.serve(async (req) => {', 'export const __handler = (async (req) => {'],
];

let contador = 0;

export const CAMINHO_V166_ORIGINAL = resolve(AQUI, '../../.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts');

export async function carregarAgente({ db, env = {}, fetchFake, caminho = CAMINHO_AGENTE }) {
  const fonte = await readFile(caminho, 'utf8');
  let src = fonte;
  for (const [de, para] of SUBS) {
    const n = src.split(de).length - 1;
    if (n !== 1) throw new Error(`shim de runtime nao casou 1x (casou ${n}x): ${de.slice(0, 60)}`);
    src = src.replace(de, para);
  }
  const ambiente = {
    SUPABASE_URL: 'https://teste.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key-teste',
    ANTHROPIC_API_KEY: 'anthropic-key-teste',
    'API-KEY': 'bot-key-teste',
    ZAPI_INSTANCE_ID: 'inst-teste',
    ZAPI_TOKEN: 'tok-teste',
    ZAPI_CLIENT_TOKEN: 'client-teste',
    ERP_URL: 'https://erp.teste.co',
    ERP_SERVICE_KEY: 'erp-key-teste',
    OPENAI_API_KEY: '',
    ...env,
  };
  globalThis.Deno = { env: { get: (k) => ambiente[k] } };
  globalThis.__SB_FAKE__ = db.cliente;
  globalThis.fetch = fetchFake;

  const dir = join(tmpdir(), 'agente-noturno-sob-teste');
  await mkdir(dir, { recursive: true });
  const arquivo = join(dir, `agente_${++contador}_${createHash('sha256').update(src).digest('hex').slice(0, 8)}.ts`);
  await writeFile(arquivo, src, 'utf8');
  const mod = await import(pathToFileURL(arquivo).href);
  return { handler: mod.__handler, sha256Artefato: createHash('sha256').update(fonte).digest('hex') };
}

export function requisicao(corpo) {
  return new Request('https://teste.local/agente-noturno', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}
