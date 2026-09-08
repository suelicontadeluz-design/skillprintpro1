declare const Deno: any;

// João -> ERP proposta v1 — 2026-09-08
// Depois que a operação financeira passa pelo bridge canônico e o ERP cria/atualiza a proposta real,
// exige snapshot canônico daquela proposta e grava receipt append-only no Córtex.
// Sem proposta ERP comprovada, falha fechado. Não cria proposta paralela no Córtex.
const JOE_PROP_MAIN_URL = Deno.env.get('SUPABASE_URL')!;
const JOE_PROP_MAIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JOE_PROP_ERP_URL = Deno.env.get('ERP_URL') ?? 'https://ynjsflvdfftcopibzxyo.supabase.co';
const JOE_PROP_ERP_KEY = Deno.env.get('ERP_SERVICE_KEY') ?? Deno.env.get('ERP_SERVICE_ROLE_KEY') ?? '';
const joeProposalPreviousFetch = globalThis.fetch.bind(globalThis);

function joeProposalUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
async function joeProposalBody(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  let raw = '';
  if (typeof init?.body === 'string') raw = init.body;
  else if (init?.body != null) raw = String(init.body);
  else if (typeof Request !== 'undefined' && input instanceof Request) {
    try { raw = await input.clone().text(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function joeProposalRow(data: any): any { return Array.isArray(data) ? data[0] : data; }
function joeProposalFail(code: string): Response {
  return new Response(JSON.stringify({ error: 'ERP_CANONICAL_PROPOSAL_REQUIRED', code, canonical: false }), {
    status: 424,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function joeRequireCanonicalProposal(operationId: string): Promise<{ ok: boolean; code: string; snapshot?: any }> {
  if (!JOE_PROP_ERP_KEY) return { ok: false, code: 'ERP_KEY_MISSING' };
  const snapResp = await joeProposalPreviousFetch(`${JOE_PROP_ERP_URL}/rest/v1/rpc/fn_cortex_proposal_snapshot_v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: JOE_PROP_ERP_KEY, authorization: `Bearer ${JOE_PROP_ERP_KEY}` },
    body: JSON.stringify({ p_operation_id: operationId }),
  });
  if (!snapResp.ok) return { ok: false, code: 'ERP_PROPOSAL_SNAPSHOT_HTTP_FAIL' };
  const snapshot = await snapResp.json().catch(() => null);
  if (!snapshot || snapshot.ok !== true || snapshot.canonical !== true || snapshot.system_of_record !== 'ERP') {
    return { ok: false, code: String(snapshot?.code ?? 'ERP_CANONICAL_PROPOSAL_REQUIRED'), snapshot };
  }

  const receiptResp = await joeProposalPreviousFetch(`${JOE_PROP_MAIN_URL}/rest/v1/rpc/fn_joao_erp_proposal_receipt_record_v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: JOE_PROP_MAIN_KEY, authorization: `Bearer ${JOE_PROP_MAIN_KEY}` },
    body: JSON.stringify({ p_operation_id: operationId, p_erp_snapshot: snapshot }),
  });
  if (!receiptResp.ok) return { ok: false, code: 'CORTEX_PROPOSAL_RECEIPT_HTTP_FAIL', snapshot };
  const receipt = await receiptResp.json().catch(() => null);
  if (!receipt || receipt.ok !== true) return { ok: false, code: String(receipt?.code ?? 'CORTEX_PROPOSAL_RECEIPT_REJECTED'), snapshot };

  console.log(JSON.stringify({ event: 'JOAO_ERP_PROPOSAL_RECEIPT', operation_id: operationId, proposta_id: snapshot.proposta_id, numero_proposta: snapshot.numero_proposta, receipt }));
  return { ok: true, code: String(receipt.code ?? 'RECORDED'), snapshot };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = joeProposalUrl(input);
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isEmit = method === 'POST' && /\/rest\/v1\/rpc\/fn_emitir_operacao_financeira(?:\?|$)/i.test(url);
  const isCompose = method === 'POST' && /\/rest\/v1\/rpc\/fn_compor_total(?:\?|$)/i.test(url);
  if (!isEmit && !isCompose) return joeProposalPreviousFetch(input, init);

  const req = await joeProposalBody(input, init);
  const response = await joeProposalPreviousFetch(input, init);
  if (!response.ok) return response;

  try {
    const data = joeProposalRow(await response.clone().json());
    const row = data && typeof data === 'object' ? { ...data } : {};
    const kind = String(row.kind ?? (isCompose ? 'total' : req?.p_kind ?? ''));
    if (kind !== 'produto' && kind !== 'total') return response;
    const operationId = String(row.id ?? row.operation_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) return joeProposalFail('ERP_PROPOSAL_OPERATION_ID_INVALID');

    const proof = await joeRequireCanonicalProposal(operationId);
    if (!proof.ok) {
      console.error(JSON.stringify({ event: 'JOAO_ERP_PROPOSAL_REJECTED', operation_id: operationId, code: proof.code }));
      return joeProposalFail(proof.code);
    }
    return response;
  } catch (e: any) {
    console.error(JSON.stringify({ event: 'JOAO_ERP_PROPOSAL_EXCEPTION', error: String(e?.message ?? e).slice(0, 180) }));
    return joeProposalFail('ERP_PROPOSAL_SYNC_EXCEPTION');
  }
};
