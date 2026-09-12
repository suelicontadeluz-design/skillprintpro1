// calcular-frete v17 — 12/09/2026
// Truth semantics: erro interno/sem opções nunca pode ser traduzido como "CEP sem cobertura" sem prova.
// Só enriquece respostas ok:false; caminho ok:true permanece byte-semanticamente igual ao handler anterior.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const V17_URL = Deno.env.get('SUPABASE_URL')!;
const V17_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const V17_CONFIG_KEY = 'joao_freight_error_truth_semantics_v1_ativo';
const v17sb = createClient(V17_URL, V17_KEY);
let v17CfgAt = 0;
let v17Cfg = false;

const V17_INTERNAL_ERRORS = new Set([
  'freight_receipt_context_mismatch',
  'dtf_uv_operacao_nao_selecionada',
  'dtf_uv_operacao_ambigua',
  'dtf_uv_operacao_elegivel_ausente',
  'dtf_uv_receipt_operacao_ausente',
  'dtf_uv_receipt_consumo_divergente',
  'dtf_uv_latest_receipt_divergente',
  'valor_venda_canonico_ausente',
  'itens_canonicos_ausentes',
  'freight_snapshot_failed',
]);

async function v17enabled(): Promise<boolean> {
  if (Date.now() - v17CfgAt < 15000) return v17Cfg;
  v17CfgAt = Date.now();
  try {
    const { data, error } = await v17sb.from('sistema_config').select('valor_bool').eq('chave', V17_CONFIG_KEY).limit(1);
    if (!error && Array.isArray(data) && data.length) v17Cfg = data[0]?.valor_bool === true;
  } catch {}
  return v17Cfg;
}

function v17safeMessage(code: string, body: any): string {
  if (code === 'dtf_uv_operacao_ambigua') {
    return 'Preciso confirmar qual quantidade/opção do pedido você escolheu antes de calcular o frete. Seu CEP não foi recusado.';
  }
  if (code === 'dtf_uv_operacao_nao_selecionada' || code === 'dtf_uv_operacao_elegivel_ausente') {
    return 'Preciso confirmar a quantidade escolhida antes de calcular o frete. Seu CEP não foi recusado.';
  }
  if (code === 'freight_receipt_context_mismatch' || code === 'dtf_uv_receipt_operacao_ausente' || code === 'dtf_uv_receipt_consumo_divergente' || code === 'dtf_uv_latest_receipt_divergente' || code === 'valor_venda_canonico_ausente' || code === 'itens_canonicos_ausentes' || code === 'freight_snapshot_failed') {
    return 'Preciso reconciliar o orçamento atual antes de calcular o frete. Seu CEP não foi recusado.';
  }
  if (code === 'sem_resultados') {
    return 'Não apareceu opção de frete nesta consulta. Isso não confirma que o CEP esteja fora de cobertura.';
  }
  if (code === 'erro_ao_conectar_frenet') {
    return 'Não consegui consultar as transportadoras agora. Isso não confirma que o CEP esteja fora de cobertura.';
  }
  return String(body?.acao || 'Não foi possível concluir o cálculo do frete agora.');
}

async function v17postprocess(response: Response): Promise<Response> {
  if (!(await v17enabled())) return response;
  const ct = response.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) return response;

  let body: any;
  try { body = await response.clone().json(); } catch { return response; }
  if (!body || typeof body !== 'object' || body.ok !== false) return response;

  const code = String(body.error || '');
  const internal = V17_INTERNAL_ERRORS.has(code);
  const noOptionsUnknownReason = code === 'sem_resultados' || code === 'erro_ao_conectar_frenet';
  if (!internal && !noOptionsUnknownReason) return response;

  const enriched = {
    ...body,
    coverage_status: internal ? 'NOT_EVALUATED' : 'UNDETERMINED',
    coverage_inference_allowed: false,
    customer_safe_message: v17safeMessage(code, body),
    forbidden_customer_claims: [
      'CEP sem cobertura',
      'área de exclusão',
      'fora do atendimento dos Correios',
      'cobertura limitada',
    ],
    regra_saida_verdade: 'NÃO atribua este erro à cobertura do CEP. Só afirme ausência de cobertura quando houver evidência explícita da transportadora para esse CEP.',
  };

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-cortex-freight-truth-semantics', 'v17');
  headers.delete('content-length');
  return new Response(JSON.stringify(enriched), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Wrapper externo ao v16/v15/v14: observa a resposta final e só enriquece falhas sem prova de cobertura.
const v17Deno: any = Deno as any;
const v17OriginalServe = v17Deno.serve.bind(Deno);
v17Deno.serve = (arg1: any, arg2?: any) => {
  if (typeof arg1 === 'function') {
    const handler = arg1;
    return v17OriginalServe(async (req: Request, info: any) => {
      const res = await handler(req, info);
      return await v17postprocess(res);
    });
  }
  const options = arg1;
  const handler = arg2;
  return v17OriginalServe(options, async (req: Request, info: any) => {
    const res = await handler(req, info);
    return await v17postprocess(res);
  });
};

await import('https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/d12b0da0b1ad4902e37c15a778fec1484434ae05/patches/calcular-frete-20260912/v16-retry-snapshot-reuse.ts');
