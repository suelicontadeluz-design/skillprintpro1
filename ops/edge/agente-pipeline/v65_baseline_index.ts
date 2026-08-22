// agente-pipeline v4.4.0-canario
// v4.4.0 (10/08/2026): CANARIO DE OBSERVABILIDADE — SOMENTE etapa_funil='handoff_humano'.
//   NAO altera politica: normalizador de urgencia, prompts, prazos, guardrails, escolha de
//   tarefa, cron e atribuicao comercial permanecem IDENTICOS a v4.3.2.
//   Acrescenta: (a) retrato FINAL no payload do evento crm_task_created;
//   (b) terminal_operacional/terminal_em/terminal_fonte e autoria_decisao/autoria_ref na decisao.
//   Todas as escritas novas sao fail-open (try/catch que nunca lanca) e passam pelo gate CANARIO.
// v4.3.2 (03/07/2026): FIX payload RD conforme OpenAPI oficial (crm-v2-create-task):
//   created_by -> created_by_id | assigned_to -> owner_ids | remove task_type inexistente,
//   type='task' (enum). Fix cache: coluna sistema_config.valor_text (nao valor_texto).
//   Novo modo 'rd_backfill': re-sincroniza tasks locais pendentes sem rd_task_id.
// v4.3.1: resolverRdUserId via /crm/v2/users com cache
// v4.3.0: resolve deal em 3 camadas, salva rd_task_id, loga falha
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const AGENT_VERSION = 'agente-pipeline-v4.4.0-canario';

// ===== CANARIO: unica etapa instrumentada =====
const CANARIO_ETAPA = 'handoff_humano';
const MODELO_HANDOFF = 'claude-haiku-4-5-20251001';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const log = (s: string, t: string, d: any = {}) => console.log(JSON.stringify({ step: s, status: t, agent: AGENT_VERSION, ...d }));

// ===== CANARIO: helpers de observabilidade (nenhum efeito comercial) =====
function noCanario(etapa: any): boolean {
  return String(etapa || '') === CANARIO_ETAPA;
}

async function hash(txt: string | null | undefined): Promise<string | null> {
  try {
    const s = String(txt ?? '');
    if (!s) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch { return null; }
}

// Grava terminal + autoria na decisao. Fail-open: nunca lanca, nunca bloqueia o fluxo comercial.
async function marcarTerminal(
  canario: boolean,
  decisionId: string | null,
  terminal: string,
  fonte: string,
  autoria: string | null,
  autoriaRef: string | null,
): Promise<void> {
  if (!canario || !decisionId) return;
  try {
    const patch: any = {
      terminal_operacional: terminal,
      terminal_em: new Date().toISOString(),
      terminal_fonte: fonte,
    };
    if (autoria) { patch.autoria_decisao = autoria; patch.autoria_ref = autoriaRef; }
    const { error } = await sb.from('agente_decisoes_log').update(patch).eq('id', decisionId);
    if (error) log('canario_terminal', 'erro', { decision_id: decisionId, terminal, error: error.message });
    else log('canario_terminal', 'ok', { decision_id: decisionId, terminal, autoria });
  } catch (e: any) {
    log('canario_terminal', 'exception', { decision_id: decisionId, error: String(e).slice(0, 200) });
  }
}

async function gerarEmbedding(texto: string): Promise<string | null> {
  if (!texto || texto.length < 10) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texto, dimensions: 1536 }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    return vec ? JSON.stringify(vec) : null;
  } catch { return null; }
}

async function carregarReflexao(leadId: string, phone: string, segmento: string, embedding: string | null): Promise<string> {
  try {
    const { data } = await sb.rpc('fn_bloco_reflexao_agente', {
      p_agente_slug: 'agente-pipeline', p_lead_id: leadId, p_phone: phone,
      p_segmento: segmento || null, p_embedding_contexto: embedding,
    });
    return data || '';
  } catch { return ''; }
}

async function gravarAcerto(tipo: string, regra: string, segmento?: string): Promise<void> {
  try {
    const { data: existe } = await sb.from('agente_aprendizados').select('id, vezes_confirmado')
      .eq('agente_slug', 'agente-pipeline').eq('tipo', tipo).eq('tipo_registro', 'acerto').eq('ativo', true).limit(1).maybeSingle();
    if (existe) {
      await sb.from('agente_aprendizados').update({ vezes_confirmado: (existe.vezes_confirmado || 1) + 1, ultima_ocorrencia: new Date().toISOString() }).eq('id', existe.id);
    } else {
      await sb.from('agente_aprendizados').insert({ agente_slug: 'agente-pipeline', tipo_registro: 'acerto', tipo, gravidade: 'alto', segmento: segmento || 'todos', descricao: regra, regra, fonte: `auto_${AGENT_VERSION}`, vezes_confirmado: 1 });
    }
  } catch {}
}

function normalizarUrgencia(u: string | null | undefined): 'alta' | 'media' | 'baixa' {
  if (!u) return 'media';
  const v = u.toLowerCase().trim();
  if (v === 'alta' || v === 'imediata' || v === 'critica' || v === 'urgente') return 'alta';
  if (v === 'baixa') return 'baixa';
  return 'media';
}

function normalizarPhone(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

async function buscarTaskRecente24h(leadId: string, phone: string): Promise<{ existe: boolean; task_id: string | null; created_at: string | null; horas_desde_task: number | null; }> {
  const phoneNorm = normalizarPhone(phone);
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const resultado = { existe: false, task_id: null as string | null, created_at: null as string | null, horas_desde_task: null as number | null };
  try {
    if (leadId) {
      const { data } = await sb.from('crm_tasks').select('id, created_at, phone, titulo, status')
        .eq('origem', 'agente-pipeline').eq('lead_id', leadId).gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(1);
      if (data && data.length > 0) {
        const row = data[0];
        const horasDesde = (Date.now() - new Date(row.created_at).getTime()) / 3600000;
        return { existe: true, task_id: row.id, created_at: row.created_at, horas_desde_task: Math.round(horasDesde * 10) / 10 };
      }
    }
    if (phoneNorm.length >= 10) {
      const { data } = await sb.from('crm_tasks').select('id, created_at, phone, titulo, status')
        .eq('origem', 'agente-pipeline').gte('created_at', desde)
        .order('created_at', { ascending: false }).limit(20);
      if (data) {
        const match = data.find((row: any) => normalizarPhone(row.phone) === phoneNorm);
        if (match) {
          const horasDesde = (Date.now() - new Date(match.created_at).getTime()) / 3600000;
          return { existe: true, task_id: match.id, created_at: match.created_at, horas_desde_task: Math.round(horasDesde * 10) / 10 };
        }
      }
    }
  } catch (e: any) { log('buscarTaskRecente24h', 'erro', { error: String(e).slice(0, 200) }); }
  return resultado;
}

async function getNivel(): Promise<number> {
  try {
    const { data } = await sb.from('agentes').select('nivel_autonomia_atual').eq('slug', 'agente-pipeline').maybeSingle();
    return data?.nivel_autonomia_atual ?? 0;
  } catch { return 0; }
}

async function getPromptBase(): Promise<string> {
  try {
    const { data } = await sb.from('agentes').select('prompt_base').eq('slug', 'agente-pipeline').single();
    return data?.prompt_base || '';
  } catch { return ''; }
}

async function registrarDecisao(params: any): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-pipeline', p_acao_executada: params.acao_executada,
      p_resultado: params.resultado, p_nivel_autonomia: params.nivel ?? 0,
      p_lead_id: params.lead_id ? String(params.lead_id) : null,
      p_contexto: params.contexto ?? {}, p_decisao: params.decisao ?? {},
      p_agent_version: AGENT_VERSION, p_dry_run: params.dry_run ?? false,
    });
    if (error) { log('registrar_decisao', 'erro_rpc', { error: error.message }); return null; }
    return data as string | null;
  } catch (e: any) { log('registrar_decisao', 'exception', { error: String(e).slice(0, 200) }); return null; }
}

async function registrarEvento(event_type: string, status: string, decision_id: string | null, payload?: any, error?: string): Promise<void> {
  try {
    await sb.rpc('fn_registrar_execution_event', {
      p_agente_slug: 'agente-pipeline', p_event_type: event_type, p_status: status,
      p_decision_id: decision_id, p_payload: payload ?? null, p_error: error ?? null,
    });
  } catch {}
}

async function buscarHistoricoConversa(leadId: string, phone: string, limite = 15): Promise<{ role: string; text: string }[]> {
  try {
    const { data } = await sb.from('fact_conversations')
      .select('direction, message_text, timestamp')
      .or(`lead_id.eq.${leadId},phone.eq.${phone}`)
      .not('message_text', 'ilike', '%[m%dia]%')
      .not('message_text', 'ilike', '%[audio]%')
      .not('message_text', 'ilike', '%[imagem]%')
      .order('timestamp', { ascending: false })
      .limit(limite);
    return (data || []).reverse().map((m: any) => ({
      role: m.direction === 'inbound' ? 'cliente' : 'empresa',
      text: (m.message_text || '').trim().slice(0, 200),
    })).filter(m => m.text.length > 3);
  } catch { return []; }
}

async function buscarContextoLead(leadId: string): Promise<any> {
  const ctx: any = {};
  try {
    const { data: lm } = await sb.from('leads_marketing').select('content_category, fn, fullname').eq('lead_id', leadId).maybeSingle();
    ctx.segmento = lm?.content_category || '';
    ctx.nome = lm?.fn || lm?.fullname || '';
  } catch {}
  try {
    const { data: px } = await sb.from('pixel_events')
      .select('event_name, value').eq('lead_id', leadId)
      .in('event_name', ['InitiateCheckout', 'Purchase'])
      .order('event_time', { ascending: false }).limit(5);
    ctx.ic = (px || []).find((p: any) => p.event_name === 'InitiateCheckout');
    ctx.compras = (px || []).filter((p: any) => p.event_name === 'Purchase');
    ctx.valor_ic = ctx.ic?.value || 0;
    ctx.total_compras = ctx.compras.reduce((s: number, p: any) => s + (p.value || 0), 0);
  } catch {}
  return ctx;
}

// v4.4.0: acrescenta APENAS os campos `origem` e `erro_modelo` ao retorno (observabilidade).
// Titulo, orientacao, urgencia e prazo continuam exatamente como na v4.3.2.
async function gerarOrientacaoHandoff(params: { nome: string; segmento: string; historico: { role: string; text: string }[]; ctx: any; promptBase: string; reflexao: string; }): Promise<{ titulo: string; orientacao: string; urgencia: string; prazo_horas: number; origem: 'modelo' | 'fallback'; erro_modelo: string | null }> {
  const { nome, segmento, historico, ctx } = params;
  const historicoStr = historico.map(h => `[${h.role.toUpperCase()}] ${h.text}`).join('\n');
  const valorStr = ctx.valor_ic > 0 ? `Valor em checkout: R$${ctx.valor_ic}` : '';
  const comprasStr = ctx.compras?.length > 0 ? `Compras anteriores: ${ctx.compras.length}x (total R$${ctx.total_compras})` : 'Primeiro contato';
  const prompt = `Voce e Rafael Cunha, responsavel pelo pipeline comercial da Skillprint Estamparia.
Um lead chegou ao handoff humano. Analise a conversa e crie uma task UTIL para a Tamires executar.

Lead: ${nome} | Segmento: ${segmento || 'desconhecido'}
${valorStr}
${comprasStr}

Conversa completa:
${historicoStr || 'Sem historico disponivel'}

Crie uma task que diz:
1. O que o cliente quer especificamente (nao generico)
2. O que esta pendente ou bloqueando o fechamento
3. O que a Tamires deve fazer (acao concreta)
4. Se tem valor/pedido especifico, mencionar

NUNCA use titulo generico como "Handoff - X" ou "Atendimento - X".
Titulo deve ter nome + situacao + valor se houver. Ex: "Joao - Pedido 50 camisetas evangelicos aguardando tamanhos"

Retorne JSON:
{"titulo": "", "orientacao": "", "urgencia": "alta|media|baixa", "prazo_horas": 4}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await res.json();
    const parsed = JSON.parse((d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    return {
      titulo: parsed.titulo || `${nome} — Atendimento pendente`,
      orientacao: parsed.orientacao || 'Ver historico da conversa no WhatsApp.',
      urgencia: parsed.urgencia || 'media',
      prazo_horas: parsed.prazo_horas || 4,
      origem: 'modelo',
      erro_modelo: null,
    };
  } catch (e: any) {
    const icStr = ctx.valor_ic > 0 ? ` — IC R$${ctx.valor_ic}` : '';
    return {
      titulo: `${nome}${icStr} — Aguarda atendimento humano`,
      orientacao: `Cliente ${nome} (${segmento}) chegou ao ponto de handoff. Verificar historico no WhatsApp e dar continuidade.${valorStr ? ' ' + valorStr : ''}`,
      urgencia: ctx.valor_ic > 500 ? 'alta' : 'media',
      prazo_horas: 4,
      origem: 'fallback',
      erro_modelo: String(e).slice(0, 200),
    };
  }
}

async function resolverDealId(leadId: string, phone: string, nome: string, dealIdPayload: string | null): Promise<string | null> {
  if (dealIdPayload) return dealIdPayload;
  try {
    const { data } = await sb.from('lead_identificadores').select('deal_rdstation_id').eq('lead_id', leadId).maybeSingle();
    if (data?.deal_rdstation_id) { log('resolver_deal', 'local', { lead_id: leadId, deal_id: data.deal_rdstation_id }); return data.deal_rdstation_id; }
  } catch {}
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rd-crm-upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ lead_id: leadId, phone, name: nome || 'Cliente' }),
    });
    const d = await res.json().catch(() => ({}));
    if (d?.deal_id) { log('resolver_deal', 'upsert_ok', { lead_id: leadId, deal_id: d.deal_id, reused: !!d.reused }); return d.deal_id; }
    log('resolver_deal', 'upsert_sem_deal', { lead_id: leadId, resp: JSON.stringify(d).slice(0, 200) });
  } catch (e: any) { log('resolver_deal', 'erro', { lead_id: leadId, error: String(e).slice(0, 200) }); }
  return null;
}

// v4.3.2: cache na coluna correta (valor_text)
async function resolverRdUserId(rdToken: string): Promise<string | null> {
  try {
    const { data: cfg } = await sb.from('sistema_config').select('valor_text').eq('chave', 'rd_user_id_tasks').maybeSingle();
    if (cfg?.valor_text) return cfg.valor_text;
  } catch {}
  try {
    const res = await fetch('https://api.rd.services/crm/v2/users?limit=20', {
      headers: { Authorization: `Bearer ${rdToken}` },
    });
    const d = await res.json().catch(() => ({}));
    const users = d?.data || d?.users || [];
    const ativo = users.find((u: any) => u?.active !== false) || users[0];
    const userId = ativo?.id ?? null;
    if (userId) {
      try {
        await sb.from('sistema_config').upsert({
          chave: 'rd_user_id_tasks', valor_text: String(userId),
          motivo: `Auto-resolvido via /crm/v2/users em ${new Date().toISOString()} (${ativo?.name || ''})`,
          atualizado_por: AGENT_VERSION, atualizado_em: new Date().toISOString(),
        }, { onConflict: 'chave' });
      } catch (e: any) { log('rd_user', 'cache_erro', { error: String(e).slice(0, 120) }); }
      log('rd_user', 'resolvido', { user_id: userId, nome: ativo?.name });
      return String(userId);
    }
    log('rd_user', 'nenhum_usuario', { status: res.status, resp: JSON.stringify(d).slice(0, 150) });
  } catch (e: any) { log('rd_user', 'erro', { error: String(e).slice(0, 150) }); }
  return null;
}

// v4.3.2: payload conforme OpenAPI oficial crm-v2-create-task
async function postTaskRd(rdToken: string, rdUserId: string, dealId: string, titulo: string, orientacao: string, prazoHoras: number): Promise<{ rd_task_id: string | null; erro: string | null }> {
  try {
    const rdRes = await fetch('https://api.rd.services/crm/v2/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rdToken}` },
      body: JSON.stringify({ data: {
        name: titulo,
        description: orientacao,
        type: 'task',
        due_date: new Date(Date.now() + (prazoHoras || 24) * 3600000).toISOString(),
        deal_id: dealId,
        created_by_id: rdUserId,
        owner_ids: [rdUserId],
      }}),
    });
    const rdData = await rdRes.json().catch(() => ({}));
    const rdTaskId = rdData?.data?.id ?? null;
    if (!rdRes.ok || !rdTaskId) {
      return { rd_task_id: null, erro: `HTTP ${rdRes.status}: ${JSON.stringify(rdData?.errors || rdData).slice(0, 200)}` };
    }
    return { rd_task_id: rdTaskId, erro: null };
  } catch (e: any) {
    return { rd_task_id: null, erro: String(e).slice(0, 200) };
  }
}

async function criarOuAtualizarTask(payload: any, rdToken: string | null): Promise<{ ok: boolean; task_id: string | null; rd_task_id?: string | null; rd_sync_erro?: string | null; error?: string }> {
  const urgenciaNorm = normalizarUrgencia(payload.urgencia);
  try {
    const taskResult = await sb.rpc('create_human_task_safe', {
      p_phone: payload.phone, p_lead_id: payload.lead_id, p_nome_cliente: payload.nome || 'Cliente',
      p_etapa_funil: payload.etapa_funil || 'atendimento', p_urgencia: urgenciaNorm,
      p_titulo: payload.titulo || 'Tarefa sem titulo',
      p_orientacao: payload.orientacao || '', p_script: payload.script || '',
      p_due_horas: payload.prazo_horas || 24, p_origem: 'agente-pipeline',
      p_decision_id: payload.decision_id || null,
    });
    if (taskResult.error) return { ok: false, task_id: null, error: taskResult.error.message };
    const taskId = (taskResult.data as any)?.task_id || null;

    let rdTaskId: string | null = null;
    let rdSyncErro: string | null = null;
    let dealIdFinal: string | null = null;

    if (rdToken && taskId) {
      dealIdFinal = await resolverDealId(payload.lead_id, payload.phone, payload.nome, payload.deal_id || null);
      const rdUserId = await resolverRdUserId(rdToken);
      if (dealIdFinal && rdUserId) {
        const r = await postTaskRd(rdToken, rdUserId, dealIdFinal, payload.titulo, payload.orientacao, payload.prazo_horas);
        rdTaskId = r.rd_task_id; rdSyncErro = r.erro;
        log('rd_task_sync', rdTaskId ? 'ok' : 'falhou', { task_id: taskId, rd_task_id: rdTaskId, deal_id: dealIdFinal, erro: rdSyncErro });
      } else {
        rdSyncErro = !dealIdFinal ? 'deal_id_nao_resolvido' : 'rd_user_id_nao_resolvido';
        log('rd_task_sync', 'sem_prerequisito', { task_id: taskId, lead_id: payload.lead_id, erro: rdSyncErro });
      }
      try {
        await sb.from('crm_tasks').update({ rd_task_id: rdTaskId, rd_deal_id: dealIdFinal, updated_at: new Date().toISOString() }).eq('id', taskId);
      } catch (e: any) { log('rd_task_sync', 'update_local_erro', { task_id: taskId, error: String(e).slice(0, 150) }); }
    }

    return { ok: true, task_id: taskId, rd_task_id: rdTaskId, rd_sync_erro: rdSyncErro };
  } catch (e: any) { return { ok: false, task_id: null, error: e.message }; }
}

// v4.3.2: re-sincroniza tasks locais pendentes sem rd_task_id (backfill)
async function rdBackfill(limite = 20): Promise<any> {
  let rdToken: string | null = null;
  try { const r = await sb.from('token_crm').select('token').limit(1).single(); rdToken = r.data?.token || null; } catch {}
  if (!rdToken) return { ok: false, erro: 'sem_token' };
  const rdUserId = await resolverRdUserId(rdToken);
  if (!rdUserId) return { ok: false, erro: 'sem_rd_user' };
  const { data: tasks } = await sb.from('crm_tasks')
    .select('id, lead_id, phone, nome_cliente, titulo, orientacao, rd_deal_id')
    .eq('status', 'pendente').is('rd_task_id', null)
    .order('created_at', { ascending: false }).limit(limite);
  let ok = 0, falha = 0;
  for (const t of (tasks || [])) {
    const dealId = t.rd_deal_id || await resolverDealId(t.lead_id, t.phone, t.nome_cliente, null);
    if (!dealId) { falha++; continue; }
    const r = await postTaskRd(rdToken, rdUserId, dealId, t.titulo, t.orientacao || '', 24);
    if (r.rd_task_id) {
      ok++;
      await sb.from('crm_tasks').update({ rd_task_id: r.rd_task_id, rd_deal_id: dealId, updated_at: new Date().toISOString() }).eq('id', t.id);
    } else {
      falha++;
      log('rd_backfill', 'falhou', { task_id: t.id, erro: r.erro });
    }
  }
  log('rd_backfill', 'ok', { sincronizadas: ok, falhas: falha });
  return { ok: true, sincronizadas: ok, falhas: falha };
}

Deno.serve(async (req) => {
  const tInicio = Date.now();
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, erro: 'invalid json' }), { status: 400 }); }

  // v4.3.2: modo backfill de sync RD
  if (body.modo === 'rd_backfill') {
    const resultado = await rdBackfill(body.limite || 20);
    return new Response(JSON.stringify(resultado), { status: 200 });
  }

  const nivel = await getNivel();
  const { lead_id, phone, nome, etapa_funil, urgencia, titulo, orientacao, script, prazo_horas, deal_id } = body;

  if (!lead_id || !phone) return new Response(JSON.stringify({ ok: false, erro: 'lead_id e phone obrigatorios' }), { status: 400 });
  log('received', 'ok', { lead_id, nivel, etapa_funil, tem_titulo: !!titulo });

  // ===== CANARIO: gate unico. Fora de handoff_humano nada novo e escrito. =====
  const CANARIO = noCanario(etapa_funil);
  let decisionIdGlobal: string | null = null;

  try {
    // CASO 1: Veio com titulo pre-definido
    if (titulo) {
      const decisionId = await registrarDecisao({
        lead_id, acao_executada: 'criar_task', resultado: nivel >= 1 ? 'executada' : 'pendente_aprovacao',
        nivel, contexto: { etapa_funil, urgencia }, decisao: { titulo, orientacao, prazo_horas },
      });
      decisionIdGlobal = decisionId;
      await registrarEvento('decision_started', 'ok', decisionId, { titulo, urgencia, etapa_funil });

      const taskRecente = await buscarTaskRecente24h(lead_id, phone);
      if (taskRecente.existe) {
        log('guardrail_task_recente_24h', 'bloqueado', { lead_id, phone, task_recente_id: taskRecente.task_id, horas_desde_task: taskRecente.horas_desde_task });
        await registrarEvento('guardrail_task_recente_24h', 'blocked', decisionId, { task_recente_id: taskRecente.task_id, horas_desde_task: taskRecente.horas_desde_task });
        if (decisionId) {
          try {
            await sb.from('agente_decisoes_log').update({
              acao_executada: 'guardrail_task_recente_24h', resultado: 'bloqueada_guardrail',
              decisao: { motivo: 'task_recente_24h', task_recente_id: taskRecente.task_id, horas_desde_task: taskRecente.horas_desde_task },
              contexto: { etapa_funil, urgencia, titulo_original: titulo, guardrail: 'task_recente_24h' },
              tempo_execucao_ms: Date.now() - tInicio,
            }).eq('id', decisionId);
          } catch {}
        }
        // CANARIO: terminal do guardrail. A decisao veio pronta do chamador, sem modelo.
        await marcarTerminal(CANARIO, decisionId, 'bloqueada_guardrail', `edge:${AGENT_VERSION}:guardrail_task_recente_24h`,
          'outra_origem_explicita', 'caller:payload_com_titulo');
        return new Response(JSON.stringify({ ok: true, skip: 'task_recente_24h', decision_id: decisionId, task_recente_id: taskRecente.task_id, horas_desde_task: taskRecente.horas_desde_task }), { status: 200 });
      }

      let tituloFinal = titulo;
      let orientacaoFinal = orientacao || '';
      let urgenciaFinal = urgencia || 'media';
      let prazoFinal = prazo_horas || 24;

      const orientacaoVazia = !orientacaoFinal || orientacaoFinal.trim() === tituloFinal.trim() || orientacaoFinal.trim().length < 20;
      const ehHandoff = etapa_funil === 'handoff_humano' || tituloFinal.toLowerCase().startsWith('handoff');

      // CANARIO: rastro da regeneracao (nao muda a condicao nem o resultado)
      let houveRegeneracao = false;
      let motivoRegeneracao: string | null = null;
      let origemFinal: 'caller' | 'modelo' | 'fallback' = 'caller';
      let erroModelo: string | null = null;

      if (ehHandoff || orientacaoVazia) {
        log('handoff', 'gerando_orientacao_rica', { lead_id, ehHandoff, orientacaoVazia });
        const [historico, ctx, promptBase] = await Promise.all([
          buscarHistoricoConversa(lead_id, phone),
          buscarContextoLead(lead_id),
          getPromptBase(),
        ]);
        const textoCtx = `${nome || ''} ${ctx.segmento || ''} ${(historico.slice(-3).map(h => h.text).join(' '))}`.trim();
        const reflexao = await carregarReflexao(lead_id, phone, ctx.segmento || '', await gerarEmbedding(textoCtx));
        const gerado = await gerarOrientacaoHandoff({ nome: nome || ctx.nome || 'Cliente', segmento: ctx.segmento || '', historico, ctx, promptBase, reflexao });
        tituloFinal = gerado.titulo;
        orientacaoFinal = gerado.orientacao;
        urgenciaFinal = normalizarUrgencia(gerado.urgencia);
        prazoFinal = gerado.prazo_horas;
        houveRegeneracao = true;
        motivoRegeneracao = ehHandoff ? (orientacaoVazia ? 'handoff_e_orientacao_curta' : 'handoff') : 'orientacao_curta_ou_igual_titulo';
        origemFinal = gerado.origem;
        erroModelo = gerado.erro_modelo;
        log('handoff', 'orientacao_gerada', { titulo: tituloFinal, urgencia: urgenciaFinal });
      }

      // CANARIO: autoria derivada do caminho REAL. Nunca atribui ao agente por omissao.
      const autoria = !houveRegeneracao ? 'outra_origem_explicita' : (origemFinal === 'fallback' ? 'fallback' : 'agente_modelo');
      const autoriaRef = !houveRegeneracao ? 'caller:payload_com_titulo'
        : (origemFinal === 'fallback' ? 'gerarOrientacaoHandoff:fallback_catch' : `gerarOrientacaoHandoff:${MODELO_HANDOFF}`);

      if (nivel >= 1) {
        let rdToken: string | null = null;
        try { const r = await sb.from('token_crm').select('token').limit(1).single(); rdToken = r.data?.token || null; } catch {}
        const { ok, task_id, rd_task_id, rd_sync_erro, error: taskErr } = await criarOuAtualizarTask({
          lead_id, phone, nome, etapa_funil: etapa_funil || 'atendimento',
          urgencia: urgenciaFinal, titulo: tituloFinal, orientacao: orientacaoFinal,
          script: script || '', prazo_horas: prazoFinal, deal_id, decision_id: body.decision_id || decisionId,
        }, rdToken);

        // CANARIO: retrato FINAL no payload do evento que ja existia
        let retrato: any = null;
        if (CANARIO) {
          try {
            retrato = {
              retrato_versao: 1,
              etapa: etapa_funil ?? null,
              declarado: {
                urgencia: urgencia ?? null,
                prazo_horas: prazo_horas ?? null,
                titulo_hash: await hash(titulo),
                orientacao_hash: await hash(orientacao),
              },
              final: {
                urgencia_edge: urgenciaFinal ?? null,
                urgencia_persistida: normalizarUrgencia(urgenciaFinal),
                prazo_horas: prazoFinal ?? null,
                titulo_hash: await hash(tituloFinal),
                orientacao_hash: await hash(orientacaoFinal),
              },
              regeneracao: { houve: houveRegeneracao, motivo: motivoRegeneracao },
              fallback: { houve: origemFinal === 'fallback', erro: erroModelo },
              origem_decisao_final: origemFinal,
              autoria_decisao: autoria,
              autoria_ref: autoriaRef,
              agent_version: AGENT_VERSION,
            };
          } catch (e: any) { log('canario_retrato', 'exception', { error: String(e).slice(0, 200) }); retrato = null; }
        }

        await registrarEvento('crm_task_created', ok ? 'ok' : 'erro', decisionId,
          retrato ? { task_id, rd_task_id, rd_sync_erro, retrato_final: retrato } : { task_id, rd_task_id, rd_sync_erro },
          taskErr);

        if (decisionId) {
          try { await sb.from('agente_decisoes_log').update({ resultado: ok ? 'executada' : 'falhou', tempo_execucao_ms: Date.now() - tInicio }).eq('id', decisionId); } catch {}
        }
        // CANARIO: terminal da execucao
        await marcarTerminal(CANARIO, decisionId, ok ? 'executada' : 'falha_criacao',
          `edge:${AGENT_VERSION}:criarOuAtualizarTask`, autoria, autoriaRef);

        if (ok) gravarAcerto('task_criada_sucesso', 'Task criada com orientacao rica entregue a Tamires.').catch(() => null);
        log('task', ok ? 'criada' : 'falhou', { task_id, rd_task_id, titulo: tituloFinal, ehHandoff });
        return new Response(JSON.stringify({ ok, task_id, rd_task_id, rd_sync_erro, nivel, titulo: tituloFinal, orientacao_rica: ehHandoff || orientacaoVazia, decision_id: decisionId, error: taskErr }), { status: 200 });
      } else {
        await registrarEvento('approval_requested', 'ok', decisionId, { titulo: tituloFinal });
        // CANARIO: nivel 0 nao executa — nao ha terminal de execucao, so autoria fica registrada
        await marcarTerminal(CANARIO, decisionId, 'nao_executavel',
          `edge:${AGENT_VERSION}:nivel_autonomia_0`, autoria, autoriaRef);
        return new Response(JSON.stringify({ ok: true, pendente_aprovacao: true, nivel, titulo: tituloFinal, decision_id: decisionId }), { status: 200 });
      }
    }

    // CASO 2: Sem titulo -> Rafael decide
    const promptBase = await getPromptBase();
    const ctx: any = await (async () => {
      try { const r = await sb.rpc('fn_contexto_real_cliente', { p_phone: phone, p_lead_id: lead_id }); return r.data ?? {}; } catch { return {}; }
    })();

    if (ctx.tarefa_pendente_ativa) {
      const dIdGuard = await registrarDecisao({ lead_id, acao_executada: 'guardrail_task_pendente', resultado: 'bloqueada_guardrail', nivel, contexto: {} });
      decisionIdGlobal = dIdGuard;
      await marcarTerminal(CANARIO, dIdGuard, 'bloqueada_guardrail', `edge:${AGENT_VERSION}:guardrail_task_pendente`,
        'outra_origem_explicita', 'fn_contexto_real_cliente:tarefa_pendente_ativa');
      return new Response(JSON.stringify({ ok: true, skip: 'task_pendente' }), { status: 200 });
    }

    let segmento = '';
    try { const { data: lm } = await sb.from('leads_marketing').select('content_category').eq('lead_id', lead_id).maybeSingle(); segmento = lm?.content_category || ''; } catch {}

    const historico = await buscarHistoricoConversa(lead_id, phone);
    const leadCtx = await buscarContextoLead(lead_id);
    const textoContexto = `${nome || ''} ${segmento} ${historico.slice(-5).map(h => h.text).join(' ')}`;
    const embedding = await gerarEmbedding(textoContexto);
    const reflexao = await carregarReflexao(lead_id, phone, segmento, embedding);

    let pixels: any[] = [];
    try { const r = await sb.from('pixel_events_br').select('event_name,event_time_br,value').eq('lead_id', lead_id).order('event_time_br', { ascending: false }).limit(10); pixels = r.data || []; } catch {}

    const decisionId = await registrarDecisao({ lead_id, acao_executada: 'analisando_pipeline', resultado: 'proposta', nivel, contexto: { etapa_funil, usou_embedding: !!embedding } });
    decisionIdGlobal = decisionId;
    await registrarEvento('context_loaded', 'ok', decisionId, { conversas: historico.length, pixels: pixels.length });

    const historicoStr = historico.slice(0, 8).map(h => `[${h.role.toUpperCase()}] ${h.text}`).join('\n');
    const userPrompt = [
      `Lead: ${nome} | Tel: ${phone} | Segmento: ${segmento || '?'} | Etapa: ${etapa_funil || '?'}`,
      `IC: ${leadCtx.valor_ic > 0 ? `R$${leadCtx.valor_ic}` : 'nao'} | Compras anteriores: ${leadCtx.total_compras > 0 ? `R$${leadCtx.total_compras}` : 'nenhuma'}`,
      `Historico:\n${historicoStr}`,
      `\nDecida se deve criar task. Se criar, titulo e orientacao devem ser especificos e acionaveis.`,
      `Titulo: [Nome] - [situacao especifica e valor se houver]. Orientacao: o que cliente quer + o que esta pendente + o que Tamires deve fazer.`,
      `Retorne JSON: {"criar": false, "titulo": "", "orientacao": "", "script": "", "urgencia": "alta|media|baixa", "prazo_horas": 24, "motivo": ""}`,
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO_HANDOFF, max_tokens: 600, system: promptBase + reflexao, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const d = await res.json();
    let decisao: any;
    try { decisao = JSON.parse((d.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()); }
    catch {
      await registrarEvento('decision_started', 'erro', decisionId, null, 'parse_error');
      if (decisionId) { try { await sb.from('agente_decisoes_log').update({ resultado: 'falhou', acao_executada: 'erro_parse_decisao', tempo_execucao_ms: Date.now() - tInicio }).eq('id', decisionId); } catch {} }
      await marcarTerminal(CANARIO, decisionId, 'falha_modelo', `edge:${AGENT_VERSION}:parse_error`,
        'agente_modelo', `decisao_pipeline:${MODELO_HANDOFF}`);
      return new Response(JSON.stringify({ ok: false, erro: 'parse_error' }), { status: 200 });
    }

    await registrarEvento('decision_started', 'ok', decisionId, { criar: decisao.criar, urgencia: decisao.urgencia });

    if (!decisao.criar) {
      try { await sb.from('agente_decisoes_log').update({ resultado: 'executada', acao_executada: 'sem_task', decisao: { motivo: decisao.motivo || (d?.error ? 'claude_error: ' + JSON.stringify(d.error).slice(0,120) : 'decisao_vazia') }, tempo_execucao_ms: Date.now() - tInicio }).eq('id', decisionId); } catch {}
      await marcarTerminal(CANARIO, decisionId, 'nao_executavel', `edge:${AGENT_VERSION}:decisao_sem_task`,
        'agente_modelo', `decisao_pipeline:${MODELO_HANDOFF}`);
      return new Response(JSON.stringify({ ok: true, criar: false, motivo: decisao.motivo }), { status: 200 });
    }

    let rdToken: string | null = null;
    try { const r = await sb.from('token_crm').select('token').limit(1).single(); rdToken = r.data?.token || null; } catch {}
    const { ok, task_id, rd_task_id, rd_sync_erro, error: taskErr } = await criarOuAtualizarTask({
      lead_id, phone, nome, etapa_funil: etapa_funil || 'atendimento',
      urgencia: decisao.urgencia, titulo: decisao.titulo, orientacao: decisao.orientacao,
      script: decisao.script, prazo_horas: decisao.prazo_horas, deal_id, decision_id: decisionId,
    }, rdToken);

    let retrato2: any = null;
    if (CANARIO) {
      try {
        retrato2 = {
          retrato_versao: 1,
          etapa: etapa_funil ?? null,
          declarado: { urgencia: null, prazo_horas: null, titulo_hash: null, orientacao_hash: null },
          final: {
            urgencia_edge: decisao.urgencia ?? null,
            urgencia_persistida: normalizarUrgencia(decisao.urgencia),
            prazo_horas: decisao.prazo_horas ?? null,
            titulo_hash: await hash(decisao.titulo),
            orientacao_hash: await hash(decisao.orientacao),
          },
          regeneracao: { houve: false, motivo: 'caso2_decisao_autonoma' },
          fallback: { houve: false, erro: null },
          origem_decisao_final: 'modelo',
          autoria_decisao: 'agente_modelo',
          autoria_ref: `decisao_pipeline:${MODELO_HANDOFF}`,
          agent_version: AGENT_VERSION,
        };
      } catch (e: any) { log('canario_retrato', 'exception', { error: String(e).slice(0, 200) }); retrato2 = null; }
    }

    await registrarEvento('crm_task_created', ok ? 'ok' : 'erro', decisionId,
      retrato2 ? { task_id, rd_task_id, rd_sync_erro, retrato_final: retrato2 } : { task_id, rd_task_id, rd_sync_erro },
      taskErr);
    try { await sb.from('agente_decisoes_log').update({ resultado: ok ? 'executada' : 'falhou', acao_executada: 'criar_task_autonomo', decisao: { titulo: decisao.titulo, motivo: decisao.motivo }, tempo_execucao_ms: Date.now() - tInicio }).eq('id', decisionId); } catch {}
    await marcarTerminal(CANARIO, decisionId, ok ? 'executada' : 'falha_criacao',
      `edge:${AGENT_VERSION}:criar_task_autonomo`, 'agente_modelo', `decisao_pipeline:${MODELO_HANDOFF}`);

    return new Response(JSON.stringify({ ok, task_id, rd_task_id, rd_sync_erro, decisao, nivel, decision_id: decisionId, error: taskErr }), { status: 200 });

  } catch (e: any) {
    log('fatal', 'erro_global', { error: String(e).slice(0, 500) });
    // CANARIO: nenhuma decisao pode ficar eternamente sem terminal
    await marcarTerminal(CANARIO, decisionIdGlobal, 'erro_inesperado', `edge:${AGENT_VERSION}:catch_global`, null, null);
    return new Response(JSON.stringify({ ok: false, erro: 'fatal: ' + String(e).slice(0, 200) }), { status: 500 });
  }
});
