// PATCH 0 do receptor frenet-tracking-webhook — PROPOSTA, NAO DEPLOYADA.
//
// DONO: a Edge Function frenet-tracking-webhook pertence a frente
// logistica-frenet-fonte-canonica (trilha identidade), NAO a esta frente.
// Este arquivo e uma proposta pronta para aquele dono publicar; nenhuma
// Edge Function foi alterada por esta sessao.
//
// Baseline corrigido: v27 ACTIVE, ezbr af11c994184067ab6748a249b51be628c17dd75608f49ca5bb0435acb60879a5
// (mesmo ezbr da v25 ja auditada — nenhuma mudanca de codigo desde entao).
//
// Contrato desta fase, na ordem exata:
//   request -> autenticacao -> validacao estrutural -> persistencia -> resposta
//
// ZERO WhatsApp. ZERO acao comercial. ZERO inferencia de cliente por
// telefone/CPF/email. Nenhum efeito financeiro.
//
// Sink interino: public.error_log (ja existe, zero migration). O destino
// final e public.logistica_evento_tracking, criado por
// ../sql/0001_logistica_envio.sql, que ainda nao foi aplicado.

export interface EventoFrenet {
  OrderId?: unknown;
  ShipmentId?: unknown;
  TrackingNumber?: unknown;
  TrackingUrl?: unknown;
  TrackingEvents?: unknown;
}

export interface RegistroEvento {
  chave_evento: string;
  order_id: string | null;
  shipment_id: string | null;
  tracking_number: string | null;
  /** uuid do nosso envio quando o OrderId for reconhecivel; senao null. */
  envio_id: string | null;
  reconciliado: boolean;
  payload_bruto: unknown;
}

/** Porta de persistencia. Injetada para o handler ser testavel sem banco. */
export interface Persistencia {
  /** Deve devolver false quando a chave ja existia (dedup). */
  registrar(r: RegistroEvento): Promise<boolean>;
}

export interface Deps {
  ler: (nome: string) => string | undefined;
  persistencia: Persistencia;
  agora?: () => string;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Comparacao de tempo constante: evita vazar o segredo por timing. */
export function comparaSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Chave de deduplicacao. Determinstica sobre o fato logistico, nao sobre a
 * requisicao: a Frenet reenvia o mesmo evento e isso nao pode gerar segundo
 * registro. Inclui o evento mais recente do array quando presente.
 */
export function chaveEvento(e: EventoFrenet): string {
  const eventos = Array.isArray(e.TrackingEvents) ? e.TrackingEvents : [];
  const ultimo = (eventos[eventos.length - 1] ?? {}) as Record<string, unknown>;
  return [
    'frenet-trk',
    texto(e.OrderId) ?? '',
    texto(e.ShipmentId) ?? '',
    texto(e.TrackingNumber) ?? '',
    texto(ultimo.EventType) ?? '',
    texto(ultimo.EventDate) ?? '',
  ].join('~');
}

/**
 * Reconciliacao honesta: so aceita vinculo quando o OrderId for o uuid que
 * NOS mandamos na criacao do pedido. Telefone, CPF e email nunca reconciliam
 * — foi exatamente essa inferencia que quebrou a versao anterior.
 */
export function resolverEnvioId(orderId: string | null): string | null {
  if (!orderId) return null;
  return RE_UUID.test(orderId) ? orderId.toLowerCase() : null;
}

export async function tratar(req: Request, deps: Deps): Promise<Response> {
  // ---- 0. metodo
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405);

  // ---- 1. autenticacao (antes de ler o corpo, antes de qualquer efeito)
  const nomeHeader = deps.ler('FRENET_WEBHOOK_TOKEN_NAME');
  const valorEsperado = deps.ler('FRENET_WEBHOOK_TOKEN_VALUE');

  // Segredo ausente nao vira "aceita tudo": vira recusa de servico.
  if (!nomeHeader || !valorEsperado) {
    return json({ erro: 'receptor_sem_credencial_configurada' }, 503);
  }

  const recebido = req.headers.get(nomeHeader);
  if (!recebido) return json({ erro: 'nao_autenticado' }, 401);
  if (!comparaSegura(recebido, valorEsperado)) return json({ erro: 'nao_autenticado' }, 401);

  // ---- 2. validacao estrutural
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: 'json_invalido' }, 400);
  }
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return json({ erro: 'corpo_deve_ser_objeto' }, 400);
  }

  const evento = corpo as EventoFrenet;
  const orderId = texto(evento.OrderId);
  const shipmentId = texto(evento.ShipmentId);
  const trackingNumber = texto(evento.TrackingNumber);

  // Sem nenhum identificador o evento e inutilizavel: recusa explicita,
  // nao 200 silencioso.
  if (!orderId && !shipmentId && !trackingNumber) {
    return json({ erro: 'evento_sem_identificador' }, 422);
  }

  // ---- 3. persistencia / observabilidade
  const envioId = resolverEnvioId(orderId);
  const registro: RegistroEvento = {
    chave_evento: chaveEvento(evento),
    order_id: orderId,
    shipment_id: shipmentId,
    tracking_number: trackingNumber,
    envio_id: envioId,
    // Evento que nao reconcilia continua observavel, sem vinculo inventado.
    reconciliado: envioId !== null,
    payload_bruto: corpo,
  };

  let novo: boolean;
  try {
    novo = await deps.persistencia.registrar(registro);
  } catch {
    // Falha de persistencia NAO pode virar 200: a Frenet precisa reenviar.
    return json({ erro: 'falha_ao_persistir' }, 500);
  }

  // ---- 4. resposta
  return json({
    ok: true,
    duplicado: !novo,
    reconciliado: registro.reconciliado,
    chave_evento: registro.chave_evento,
  }, 200);
}

// ------------------------------------------------------------------
// Adaptador de runtime (Deno / Supabase Edge). Mantido separado do handler
// para que os testes rodem sem rede e sem banco.
// ------------------------------------------------------------------

export interface ClienteSupabaseMinimo {
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: unknown): {
        limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
      };
    };
    insert(valor: unknown): Promise<{ error: unknown }>;
  };
}

/**
 * Sink interino em public.error_log, que ja existe (zero migration).
 *
 * A dedup filtra por payload->>chave_evento, NAO por function_name. A versao
 * anterior consultava pixel_events.select('id') — coluna inexistente — e
 * descartava o erro do PostgREST, entao o guard nunca disparava. Aqui o erro
 * propaga e o handler responde 500, para a Frenet reenviar.
 */
export function persistenciaErrorLog(sb: ClienteSupabaseMinimo): Persistencia {
  return {
    async registrar(r) {
      const { data, error } = await sb.from('error_log')
        .select('id')
        .eq('payload->>chave_evento', r.chave_evento)
        .limit(1);
      if (error) throw new Error('dedup_indisponivel');
      if (Array.isArray(data) && data.length > 0) return false;

      const { error: errIns } = await sb.from('error_log').insert({
        function_name: 'frenet-tracking-webhook',
        error_message: r.reconciliado ? 'evento_tracking' : 'evento_tracking_nao_reconciliado',
        payload: r as unknown,
      });
      if (errIns) throw new Error('insert_falhou');
      return true;
    },
  };
}
