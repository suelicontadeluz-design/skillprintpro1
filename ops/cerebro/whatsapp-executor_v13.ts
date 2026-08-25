// whatsapp-executor v13
// Mudancas vs v12 (frente opt-out-outbound):
//   - OPT-OUT DE WHATSAPP: a guarda passa a ser chamada com
//     p_checar_optout_whatsapp=true. Este e o UNICO caminho OUTBOUND que ativa
//     a Guarda 1.5. Inbound (agente-conversacao/agente-fechamento modoReativo)
//     nao passa o parametro e mantem DEFAULT false: opt-out de outbound NAO
//     bloqueia resposta a quem procurou a empresa.
//   - FAIL-CLOSED em lead_id ausente: 'sem_lead_id_skip_guard' liberava o envio
//     sem consultar a guarda. Agora bloqueia. waba_disparos_lista.lead_id e
//     NOT NULL e 0/940 do historico tem lead_id nulo, entao nao muda operacao.
//   - Nenhuma outra regra muda. Bruno, Marcos e Julia seguem intocados.
//
// Mudancas vs v11 (frente vera-loop-retencao-observavel):
//   - EXCECAO ESTREITA DA VERA: item da fila que esta VINCULADO a um ciclo vivo em
//     vera_retencao_ciclos (waba_disparo_id = item.id) chama a guarda com
//     p_checar_recorrente=false. So a Guarda 4 e dispensada; todas as outras seguem.
//   - O vinculo e o discriminador porque vera_retencao_ciclos tem RLS e so
//     postgres/service_role escrevem. `evento` sozinho NAO serve: waba_disparos_lista
//     esta com RLS=false e anon com INSERT, entao o rotulo e falsificavel.
//   - Fail-closed: erro, ausencia de ciclo, ciclo terminal ou id nulo => checar=true.
//   - NENHUMA funcao do banco muda. Bruno, Marcos e Julia seguem intocados.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_API_KEY  = Deno.env.get('API-KEY')!;
const BOT_BASE    = 'https://backend.botconversa.com.br/api/v1/webhook';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => (Math.floor(Math.random() * 70) + 20) * 1000;

function log(step: string, status: string, detail: any = {}) {
  console.log(JSON.stringify({ step, status, v: 'v13', ...detail }));
}

const ESTADOS_CICLO_TERMINAIS = ['comprou', 'recusou', 'perdido', 'limite_atingido', 'encerrado'];

// Discriminador da excecao da Vera. Fail-closed em TODOS os caminhos de duvida.
async function veraCicloVivo(disparoId: string | null | undefined): Promise<boolean> {
  if (!disparoId) return false;
  try {
    const { data, error } = await sb
      .from('vera_retencao_ciclos')
      .select('id, estado')
      .eq('waba_disparo_id', disparoId)
      .limit(1)
      .maybeSingle();
    if (error) {
      log('vera_excecao', 'lookup_error', { disparo_id: disparoId, error: error.message });
      return false;
    }
    if (!data) return false;
    return !ESTADOS_CICLO_TERMINAIS.includes(String(data.estado));
  } catch (e: any) {
    log('vera_excecao', 'exception', { disparo_id: disparoId, error: e.message });
    return false;
  }
}

async function agentePodeAtender(leadId: string | null, phone: string, checarRecorrente = true): Promise<{ pode: boolean; motivo: string }> {
  if (!leadId) {
    // Sem lead_id, busca pelo phone
    try {
      const { data: lm } = await sb.from('leads_marketing').select('lead_id').eq('ph', phone).limit(1).maybeSingle();
      if (lm?.lead_id) leadId = lm.lead_id;
    } catch {}
  }
  // v13: FAIL-CLOSED. Sem lead_id nao ha como consultar opt-out nem a guarda,
  // entao nao se envia. Antes isto liberava o envio sem checagem nenhuma.
  if (!leadId) {
    log('guard', 'sem_lead_id_fail_closed', { phone });
    return { pode: false, motivo: 'sem_lead_id_fail_closed' };
  }

  try {
    const { data, error } = await sb.rpc('fn_agente_automatico_pode_atender', { 
      p_lead_id: leadId, 
      p_phone: phone,
      p_janela_humano_min: 90,
      p_checar_recorrente: checarRecorrente,
      p_checar_purchase: true,
      p_respeitar_julia_pausa: true,
      p_checar_optout_whatsapp: true
    });
    if (error) {
      log('guard', 'rpc_error', { lead_id: leadId, error: error.message });
      return { pode: false, motivo: 'rpc_error_fail_safe' };
    }
    return { pode: !!data?.pode, motivo: data?.motivo || 'unknown' };
  } catch (e: any) {
    log('guard', 'exception', { lead_id: leadId, error: e.message });
    return { pode: false, motivo: 'exception_fail_safe' };
  }
}

async function resolverSubscriberId(lead_id: string | null, phone: string): Promise<string | null> {
  if (lead_id) {
    const { data } = await sb.from('lead_identificadores').select('contact_botconversa_id').eq('lead_id', lead_id).limit(1).single();
    if (data?.contact_botconversa_id) return data.contact_botconversa_id;
  }
  try {
    const res = await fetch(`${BOT_BASE}/subscriber/get_by_phone/${phone}/`, {
      headers: { 'API-KEY': BOT_API_KEY },
    });
    if (res.ok) {
      const d = await res.json();
      const sid = String(d?.id ?? '');
      if (sid && sid !== 'undefined') {
        if (lead_id) {
          await sb.from('lead_identificadores').upsert({ lead_id, contact_botconversa_id: sid }, { onConflict: 'lead_id' });
        }
        return sid;
      }
    }
  } catch (e) { console.error('[resolverSubscriberId]', String(e)); }
  return null;
}

async function enviarMensagem(subscriberId: string, mensagem: string) {
  try {
    const res = await fetch(`${BOT_BASE}/subscriber/${subscriberId}/send_message/`, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify({ type: 'text', value: mensagem }),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (e: any) { return { ok: false, status: 0, body: String(e) }; }
}

async function gravarLog(p: any) {
  await sb.from('whatsapp_executor_log').insert({
    disparo_id: p.disparo_id, lead_id: p.lead_id, phone: p.phone,
    segmentacao: p.segmentacao, template: p.template,
    mensagem: p.mensagem.substring(0, 300), tentativa: p.tentativa,
    status: p.status, motivo_bloqueio: p.motivo_bloqueio || null,
    zapi_status: p.zapi_status || null, zapi_response: p.zapi_response?.substring(0, 500) || null,
  });
}

Deno.serve(async (_req) => {
  if (!BOT_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'secret_missing' }), { status: 500 });

  const { data: fila, error: filaErr } = await sb.rpc('fn_fila_disparos_pendentes', { p_limite: 3 });
  if (filaErr) return new Response(JSON.stringify({ ok: false, error: filaErr.message }), { status: 500 });

  if (!fila || fila.length === 0) {
    const { data: lr } = await sb.rpc('fn_cron_log_start', { p_job: 'whatsapp-executor', p_meta: { motivo: 'fila_vazia_ou_fora_janela' } });
    if (lr) await sb.rpc('fn_cron_log_finish', { p_id: lr, p_status: 'success', p_rows: 0 });
    return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: 'fila_vazia_ou_fora_janela' }));
  }

  const { data: lr } = await sb.rpc('fn_cron_log_start', { p_job: 'whatsapp-executor', p_meta: { lote: fila.length, canal: 'botconversa_api', versao: 'v13' } });
  const logId = lr as string | null;
  let enviados = 0;
  let bloqueados_guard = 0;
  let excecoes_vera = 0;
  const resultados: any[] = [];

  for (let i = 0; i < fila.length; i++) {
    const item = fila[i];
    if (i > 0) await sleep(randomDelay());
    const mensagem = item.mensagem_personalizada || 'Ola! Passando para ver se posso te ajudar com seu pedido.';
    const leadIdStr = item.lead_id?.toString() || null;

    // ── EXCECAO ESTREITA DA VERA: so quando o item esta ligado a um ciclo vivo dela
    const veraOk = await veraCicloVivo(item.id);
    if (veraOk) {
      excecoes_vera++;
      log('vera_excecao', 'aplicada', { disparo_id: item.id, lead_id: leadIdStr });
    }

    // ── GUARDA FINAL: cliente pode receber mensagem automatica?
    const guard = await agentePodeAtender(leadIdStr, item.phone, !veraOk);
    if (!guard.pode) {
      const motivo = `guard_bloqueou:${guard.motivo}`;
      log('guard', 'bloqueou', { disparo_id: item.id, lead_id: leadIdStr, phone: item.phone, motivo: guard.motivo });
      // Marca o disparo como bloqueado para nao re-enfileirar
      try {
        await sb.rpc('fn_marcar_disparo_erro', { p_id: item.id, p_erro: motivo });
      } catch {}
      await gravarLog({ 
        disparo_id: item.id, lead_id: leadIdStr, phone: item.phone, 
        segmentacao: item.segmentacao, template: item.template_atual, 
        mensagem, tentativa: item.contador, 
        status: 'bloqueado_guard', motivo_bloqueio: motivo 
      });
      bloqueados_guard++;
      resultados.push({ id: item.id, phone: item.phone, ok: false, motivo });
      continue;
    }

    const subscriberId = await resolverSubscriberId(leadIdStr, item.phone);

    if (!subscriberId) {
      const motivo = `subscriber_nao_encontrado: phone=${item.phone}`;
      await gravarLog({ disparo_id: item.id, lead_id: leadIdStr, phone: item.phone, segmentacao: item.segmentacao, template: item.template_atual, mensagem, tentativa: item.contador, status: 'bloqueado', motivo_bloqueio: motivo });
      resultados.push({ id: item.id, phone: item.phone, ok: false, motivo });
      continue;
    }

    const { ok, status, body } = await enviarMensagem(subscriberId, mensagem);
    if (ok) {
      await sb.rpc('fn_marcar_disparo_enviado', { p_id: item.id, p_api_response: body.substring(0, 300) });
      await gravarLog({ disparo_id: item.id, lead_id: leadIdStr, phone: item.phone, segmentacao: item.segmentacao, template: item.template_atual, mensagem, tentativa: item.contador, status: 'enviado', zapi_status: status, zapi_response: body });
      enviados++;
    } else {
      const errMsg = `HTTP ${status}: ${body.substring(0, 200)}`;
      await sb.rpc('fn_marcar_disparo_erro', { p_id: item.id, p_erro: errMsg });
      await gravarLog({ disparo_id: item.id, lead_id: leadIdStr, phone: item.phone, segmentacao: item.segmentacao, template: item.template_atual, mensagem, tentativa: item.contador, status: 'erro', motivo_bloqueio: errMsg, zapi_status: status, zapi_response: body });
    }
    resultados.push({ id: item.id, phone: item.phone, subscriber_id: subscriberId, ok, http_status: status });
  }

  if (logId) await sb.rpc('fn_cron_log_finish', { p_id: logId, p_status: 'success', p_rows: enviados });
  return new Response(JSON.stringify({ ok: true, canal: 'botconversa_api', lote: fila.length, enviados, bloqueados_guard, excecoes_vera, resultados }), { headers: { 'Content-Type': 'application/json' } });
});
