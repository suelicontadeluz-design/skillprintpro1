// ── HARNESS A1: driver de execucao (depois do artefato real) ─────────────────
function mensagemValida(m: string): boolean { const t = String(m || '').trim(); return t.length >= 2 || /^\d$/.test(t); }

let ESTADO_VISTO_PELO_TURNO: any = 'nao_lido';

// Reproduz a SEQUENCIA REAL de pontos de efeito de um turno do agente-noturno
// v4.37.1 (extraida do baseline 58f64326): leituras de contexto, ledger de
// decisao/envio, transporte WhatsApp com fallback, Pix, task, LOST, frete,
// transcricao, inferencia, gravacao de fio, carimbo e persistencia de estado.
async function atenderCliente(phone: string, _chatName: string, mensagem: string, _i: string[], _t: string[], _ids: any, _dry: boolean, _lote: any): Promise<any> {
  const est = await sb.from('agente_noturno_estado').select('etapa, slots, updated_at').eq('phone', phone).maybeSingle();
  ESTADO_VISTO_PELO_TURNO = est?.data ?? null;
  await sb.from('fact_conversations').select('source, message_text, timestamp').eq('direction', 'outbound').limit(6);
  await sb.from('inbound_fora_horario').select('id, body, created_at').eq('phone', phone).limit(10);
  await sb.from('mp_pix_cobrancas').select('payment_id, valor, status').eq('lead_id', 'x').limit(5);
  await sb.from('orcamentos').select('produto, valor_total').eq('lead_id', 'x').limit(5);
  await sb.from('operacoes_financeiras').select('id, kind, amount').eq('lead_id', 'x').limit(6);
  await sb.from('pixel_events').select('id').eq('event_name', 'Purchase').limit(1);

  await sb.rpc('fn_agente_pausado', { p_phone: phone });
  await sb.rpc('fn_contexto_comercial_do_lead', { p_lead_id: 'x' });
  await sb.rpc('fn_joao_adquirir_lock', { p_phone: phone });
  await sb.rpc('fn_get_or_create_lead', { p_phone: phone, p_fullname: null });

  await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'x' }) });
  await fetch(`${ERP_URL}/rest/v1/pessoas?select=id`, { method: 'GET' });
  await fetch(`${ERP_URL}/rest/v1/rpc/fn_orcar_camisetas_agente`, { method: 'POST', body: '{}' });
  await fetch(`${ERP_URL}/rest/v1/pessoas?id=eq.1`, { method: 'PATCH', body: '{"nome":"x"}' });

  await sb.rpc('fn_emitir_operacao_financeira', { p_lead_id: 'x', p_kind: 'produto', p_amount: 213.24, p_source_tool: 'calcular_dtf_metro', p_components: {} });
  const dec = await sb.rpc('fn_registrar_decisao_agente', { p_agente_slug: 'agente-noturno', p_acao_executada: 'resposta_noturna', p_dry_run: false });
  await sb.from('joao_envios').insert({ decision_id: dec?.data ?? null, phone, tipo: 'texto', status: 'preparado' });

  const textoResposta = 'Imagina! Qualquer coisa e so chamar. Boa tarde!';
  await fetch(`https://api.z-api.io/instances/INST/token/TOK/send-text`, { method: 'POST', body: JSON.stringify({ phone, message: textoResposta }) });
  await fetch(`${BOT_BASE}/subscriber/get_by_phone/${phone}/`, { method: 'GET' });
  await fetch(`${BOT_BASE}/subscriber/123/send_message/`, { method: 'POST', body: JSON.stringify({ type: 'text', value: textoResposta }) });
  await fetch(`${SUPABASE_URL}/functions/v1/joao-tts`, { method: 'POST', body: '{}' });
  await fetch(`https://api.z-api.io/instances/INST/token/TOK/send-audio`, { method: 'POST', body: '{}' });
  await fetch(`${SUPABASE_URL}/functions/v1/mp-pix-criar`, { method: 'POST', body: JSON.stringify({ valor: 213.24 }) });
  await fetch(`${SUPABASE_URL}/functions/v1/agente-pipeline`, { method: 'POST', body: JSON.stringify({ titulo: 'handoff' }) });
  await fetch(`${SUPABASE_URL}/functions/v1/joao-lost-canonico`, { method: 'POST', body: '{}' });
  await fetch(`${SUPABASE_URL}/functions/v1/calcular-frete`, { method: 'POST', body: '{}' });
  await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', body: '{}' });
  await fetch('https://crm.rdstation.com/api/v1/deals', { method: 'POST', body: '{}' });

  await sb.from('joao_envios').update({ status: 'aceito_provider' }).eq('id', 'x');
  await sb.from('fact_conversations').insert({ phone, direction: 'outbound', message_text: textoResposta });
  await sb.from('agente_decisoes_log').update({ resultado: 'executada' }).eq('id', 'x');
  await sb.from('inbound_fora_horario').update({ status: 'atendido_joao' }).eq('phone', phone);
  await sb.from('agente_noturno_estado').upsert({ phone, etapa: 'fechamento', slots: {} });
  await sb.from('anthropic_token_usage').insert({ model: 'x', input_tokens: 10 });
  await sb.from('error_log').insert({ function_name: 'agente-noturno', error_message: 'x' });
  await sb.from('agente_noturno_lock').delete().eq('phone', phone);

  return { ok: true, enviou: true, texto: textoResposta, mensagem_recebida: mensagem };
}

async function corpo(r: Response) { try { return JSON.parse(await r.text()); } catch { return null; } }

async function main() {
  const comJwt = !!Deno.env.get('REPLAY_RUNNER_JWT');
  const out: any = { com_jwt: comJwt, cenarios: {} };

  if (!comJwt) {
    const r = await atenderHermetico({ mode: 'replay', replay_case_id: SNAPSHOT_REAL.caso_id }, 'replay');
    out.cenarios.sem_credencial = { status: r.status, corpo: await corpo(r) };
  } else {
    const r1 = await atenderHermetico({ mode: 'replay', replay_case_id: SNAPSHOT_REAL.caso_id, artifact_sha: '3f1ecf3c24859b628c5baea1d17d2e7620c7faf1' }, 'replay');
    out.cenarios.replay = { status: r1.status, corpo: await corpo(r1) };
    out.estado_visto_pelo_turno = ESTADO_VISTO_PELO_TURNO;
    const r2 = await atenderHermetico({ mode: 'live', phone: '55219XXXXXXXX', mensagem: 'oi' }, 'live');
    out.cenarios.live_apos_lacre = { status: r2.status, corpo: await corpo(r2) };
    const r3 = await atenderHermetico({ mode: 'xpto' }, 'xpto');
    out.cenarios.modo_invalido = { status: r3.status, corpo: await corpo(r3) };
  }
  out.auditoria = AUDIT;
  console.log(JSON.stringify(out, null, 1));
}
main();
