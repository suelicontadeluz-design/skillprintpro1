// João -> PDF oficial da proposta ERP.
// Observa o transporte Z-API já aceito e, para o MESMO inbound, pede ao Córtex que anexe
// o documento oficial. Não monta proposta, não recebe preço/itens do modelo e não toca no
// retorno do transporte textual/áudio. O serviço de entrega é idempotente por inbound.

const __pdfDeliveryOriginalFetch = globalThis.fetch.bind(globalThis);
const __pdfDeliveryMainUrl = Deno.env.get('SUPABASE_URL') || '';
const __pdfDeliveryMainKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function __pdfDeliveryPhone(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  try {
    const j = JSON.parse(body);
    const p = String(j?.phone || '').replace(/\D/g, '');
    return p.length >= 10 && p.length <= 15 ? p : null;
  } catch { return null; }
}

function __pdfDeliveryIsJoaoTransport(url: string, init?: RequestInit): boolean {
  if (String(init?.method || 'GET').toUpperCase() !== 'POST') return false;
  return /^https:\/\/api\.z-api\.io\/instances\/[^/]+\/token\/[^/]+\/send-(?:text|audio)$/i.test(url);
}

async function __pdfDeliveryTry(phone: string): Promise<void> {
  if (!__pdfDeliveryMainUrl || !__pdfDeliveryMainKey) return;
  try {
    const r = await __pdfDeliveryOriginalFetch(`${__pdfDeliveryMainUrl}/functions/v1/joao-proposta-pdf-enviar`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${__pdfDeliveryMainKey}`,
        'apikey': __pdfDeliveryMainKey,
      },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(35000),
    });
    const d = await r.json().catch(() => ({}));
    if (d?.sent === true) {
      console.log(JSON.stringify({
        event: 'JOAO_PROPOSTA_PDF_DELIVERY_SENT',
        phone_final: phone.slice(-4),
        proposta_id: d?.proposta_id || null,
        document_id: d?.document_id || null,
        envio_id: d?.envio_id || null,
      }));
    } else if (d?.attempted === true && d?.code !== 'IDEMPOTENT') {
      console.error(JSON.stringify({
        event: 'JOAO_PROPOSTA_PDF_DELIVERY_NOT_SENT',
        phone_final: phone.slice(-4),
        http: r.status,
        code: d?.code || null,
        envio_id: d?.envio_id || null,
      }));
    }
  } catch (e: any) {
    console.error(JSON.stringify({
      event: 'JOAO_PROPOSTA_PDF_DELIVERY_EXCEPTION',
      phone_final: phone.slice(-4),
      error: String(e?.message ?? e).slice(0, 180),
    }));
  }
}

globalThis.fetch = async function __pdfDeliveryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const isTransport = __pdfDeliveryIsJoaoTransport(url, init);
  const phone = isTransport ? __pdfDeliveryPhone(init?.body) : null;

  // Primeiro preserva exatamente o transporte já existente do João.
  const res = await __pdfDeliveryOriginalFetch(input, init);

  // Só tenta documento depois de o provider aceitar a resposta principal.
  // O edge joao-proposta-pdf-enviar valida o inbound explícito, a proposta ERP, o PDF,
  // o claim idempotente e o provider. Em mensagens comuns retorna sem efeito.
  if (res.ok && phone) await __pdfDeliveryTry(phone);

  return res;
};
