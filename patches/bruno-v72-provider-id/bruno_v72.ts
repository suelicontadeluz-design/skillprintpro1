// agente-conversacao v7.7.4
// v7.7.4 (13/08/2026): FALLBACK MINIMO DE PARSE (primeiro-{ ate ultimo-})
// - parseDecisao continua sendo a PRIMEIRA e unica tentativa normal, intocada
// - somente quando ela devolve 'json_invalido', tenta JSON.parse do intervalo
//   primeiro-{ ate ultimo-} e submete o objeto extraido as MESMAS validacoes
//   funcionais atuais (parseDecisao). Se nao passar, preserva a falha original
// - NAO torna o parser permissivo: campo_mensagem_ausente, status_invalido e
//   mensagem_vazia_sem_motivo_valido continuam falhando exatamente como hoje
// - telemetria 9.1 preservada integralmente; acrescenta so o booleano
//   parse_recovered_by_brace_extract
// - NADA muda no prompt, no modelo, no retry, no envio nem no fluxo de decisao
// v7.7.3 (13/08/2026): OBSERVABILIDADE DO json_invalido (patch 9.1)
// - NADA muda no prompt, no modelo, no retry, no envio nem no fluxo de decisao
// - somente quando parseDecisao devolve 'json_invalido', grava telemetria ESTRUTURAL
//   em tele[`t{n}_diag`]: forma do raw, chaves de schema presentes, erro sanitizado
//   do JSON.parse e o contrafactual da extracao primeiro-{ ate ultimo-}
// - NAO persiste o raw, nem prefixo, nem sufixo, nem a mensagem da excecao
// v7.7.2 (06/08/2026): FECHA LOOP ISABELA -> AGENTE DE CONVERSA
// - gravarOutbound agora e await, retorna id + timestamp da fact_conversations
// - fn_objecao_registrar_uso agora e await, com erro observavel
// - registra usage_type='adaptado', conversation_message_id e enviado_em
// - sem uso de catch silencioso nas duas chamadas de uso de playbook
// Base: v7.7.1 implantada. Conteudo funcional preservado, com patch cirurgico.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const BOT_API_KEY = Deno.env.get('API-KEY')!;
const BOT_BASE = 'https://backend.botconversa.com.br/api/v1/webhook';
const AGENT_VERSION = 'agente-conversacao-v7.7.4';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ASSINATURA = '*Bruno Fonseca:*\n';
const DELAY_MS = 4000;
const TRAVA_MS = 45000;
const FOLLOWUP_JANELA_H = 8;
const STATUS_BLOQUEIO = ['bloqueada_purchase', 'bloqueada_humano', 'handoff_humano', 'fora_de_escopo'];
const NIVEL_FIXO = 2;
const REGEX_AUTO_ATENDIMENTO = /(sistema não validou sua resposta|sistema nao validou sua resposta|transferindo (seu |o )?atendimento|nosso horário de atendimento é|nosso horario de atendimento e|digite (o número|o numero|uma opção|uma opcao)|agradecemos o seu contato|atendente virtual|estarei transferindo|para falar com um de nossos atendentes|escolha uma das opções|escolha uma das opcoes|como podemos ajudá-lo|como podemos ajuda-lo|seja bem-vindo\(a\)|mensagem automática|mensagem automatica)/i;

const BRUNO_ENVIO_OBSERVAVEL_ENABLED =
  (Deno.env.get('BRUNO_ENVIO_OBSERVAVEL_ENABLED') ?? 'false').toLowerCase() === 'true';
const ENVIO_TIMEOUT_MS = 13000;
const ENVIO_CORPO_MAX = 500;

const REGEX_EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;
const FRASES_MOLDE: RegExp[] = [
  /qualquer d[uú]vida [eé] s[oó] (falar|chamar)/i,
  /passando pra (ver|saber) se ainda (tem interesse|posso te ajudar|faz sentido)/i,
  /queria saber se ainda (faz sentido|tem interesse)/i,
  /vi que (a gente|n[oó]s) tinha(mos)? conversado sobre/i,
  /ainda (tem|teria) interesse (no|na|em)/i,
  /s[oó] passando pra confirmar se voc[eê] ainda/i,
  /estamos (por aqui|[aà] disposi[cç][aã]o)!?$/i,
  /fico feliz em ajudar/i,
  /quero te ajudar/i,
];

const MAX_TOKENS_REATIVO = 500;
const MAX_TOKENS_RETRY = 1200;
const STATUS_VALIDOS = ['em_progresso', 'qualificado', 'handoff_humano', 'aguardando_cliente'];
const HTTP_RECUPERAVEL = [408, 409, 429, 500, 502, 503, 504];
const INSTRUCAO_RETRY = '\n\n== CORRECAO ==\nA resposta anterior nao pode ser lida pelo sistema. Responda APENAS com o objeto JSON pedido, sem texto antes ou depois e sem bloco de codigo. Mantenha o campo "mensagem" curto.';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const fmt = (txt: string) => ASSINATURA + txt;
function log(s: string, t: string, d: any = {}) { console.log(JSON.stringify({ s, t, v: AGENT_VERSION, ...d })); }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type ResultadoEnvio = {
  ok: boolean;
  estado: 'aceito' | 'rejeitado' | 'incerto';
  http_status: number | null;
  provider_id: string | null;
  corpo: string | null;
  erro: string | null;
  categoria_erro: 'http_nao_2xx' | 'timeout' | 'rede' | 'resposta_invalida' | null;
  duracao_ms: number;
  confirmado_por: 'http_2xx' | null;
  finalizado_em: string | null;
};

type OutboundPersistido = {
  id: string | null;
  timestamp: string;
  erro: string | null;
};

class ErroModelo extends Error {
  recuperavel: boolean;
  categoria: string;
  constructor(categoria: string, recuperavel: boolean, detalhe = '') {
    super(detalhe ? `${categoria}:${detalhe}` : categoria);
    this.categoria = categoria;
    this.recuperavel = recuperavel;
  }
}

async function chamarModelo(system: string, messages: any[], maxTokens: number): Promise<{ raw: string; stop_reason: string | null; output_tokens: number | null }> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages }),
    });
  } catch (e: any) {
    throw new ErroModelo('rede', true, String(e?.message || e).slice(0, 120));
  }
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new ErroModelo(`http_${res.status}`, HTTP_RECUPERAVEL.includes(res.status), corpo.slice(0, 120));
  }
  const d = await res.json().catch(() => null);
  const raw = d?.content?.[0]?.text;
  if (!raw || !raw.trim()) throw new ErroModelo('resposta_vazia', true);
  return { raw, stop_reason: d?.stop_reason ?? null, output_tokens: d?.usage?.output_tokens ?? null };
}

function parseDecisao(raw: string): { ok: true; decisao: any } | { ok: false; erro: string } {
  let obj: any;
  try { obj = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return { ok: false, erro: 'json_invalido' }; }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { ok: false, erro: 'json_nao_objeto' };
  if (typeof obj.mensagem !== 'string') return { ok: false, erro: 'campo_mensagem_ausente' };
  const status = obj.status || 'em_progresso';
  if (!STATUS_VALIDOS.includes(status)) return { ok: false, erro: 'status_invalido' };
  const motivo = String(obj.motivo || '').trim();
  const vazia = obj.mensagem.trim() === '';
  if (vazia && !/^auto_atendimento/i.test(motivo)) return { ok: false, erro: 'mensagem_vazia_sem_motivo_valido' };
  return { ok: true, decisao: { ...obj, status, motivo } };
}

function classeChar(c: string | undefined): string | null {
  if (c === undefined) return null;
  if (/[A-Za-zÀ-ÿ]/.test(c)) return 'letra';
  if (/[0-9]/.test(c)) return 'digito';
  if (c === '"') return 'aspas_dupla';
  if (c === "'") return 'aspas_simples';
  if (c === '{' || c === '}') return 'chave';
  if (c === '[' || c === ']') return 'colchete';
  if (c === '`') return 'crase';
  if (c === '\n' || c === '\r') return 'quebra_linha';
  if (c === '\t') return 'tab';
  if (c.charCodeAt(0) < 32) return 'controle';
  if (/\s/.test(c)) return 'espaco';
  return 'pontuacao_ou_simbolo';
}

function classificarErroParse(e: any): { tipo: string; categoria: string; pos: number | null } {
  const tipo = String(e?.name || 'Error');
  const msg = String(e?.message || '');
  const m = msg.match(/position\s+(\d+)/i);
  const pos = m ? Number(m[1]) : null;
  let categoria = 'outro';
  if (/Unexpected end of (JSON input|input)/i.test(msg)) categoria = 'fim_inesperado';
  else if (/non-whitespace character after JSON/i.test(msg)) categoria = 'texto_apos_json';
  else if (/control character/i.test(msg)) categoria = 'caractere_controle';
  else if (/Unterminated string/i.test(msg)) categoria = 'string_nao_fechada';
  else if (/Expected/i.test(msg)) categoria = 'token_esperado_ausente';
  else if (/Unexpected token|not valid JSON/i.test(msg)) categoria = 'token_inesperado';
  return { tipo, categoria, pos };
}

function diagnosticarRaw(raw: string): Record<string, any> {
  const d: Record<string, any> = { diag_v: 1 };
  try {
    const limpo = raw.replace(/```json|```/g, '').trim();
    d.raw_length = raw.length;
    d.limpo_length = limpo.length;

    const fence = raw.match(/```([A-Za-z0-9_-]{0,12})/);
    d.has_code_fence = !!fence;
    d.code_fence_label = fence ? (fence[1] || '') : null;
    d.code_fence_count = (raw.match(/```/g) || []).length;

    const iAbre = limpo.indexOf('{');
    const iFecha = limpo.lastIndexOf('}');
    d.starts_with_brace = limpo.startsWith('{');
    d.ends_with_brace = limpo.endsWith('}');
    d.first_open_brace_pos = iAbre;
    d.last_close_brace_pos = iFecha;
    d.open_brace_count = (limpo.match(/\{/g) || []).length;
    d.close_brace_count = (limpo.match(/\}/g) || []).length;
    d.has_text_before_first_brace = iAbre > 0 ? limpo.slice(0, iAbre).trim().length > 0 : false;
    d.has_text_after_last_brace = (iFecha >= 0 && iFecha < limpo.length - 1) ? limpo.slice(iFecha + 1).trim().length > 0 : false;

    d.has_newline = /\n/.test(limpo);
    d.has_raw_control_char = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(limpo);

    const temChave = (k: string) => new RegExp('"' + k + '"\\s*:').test(limpo);
    d.contains_key_mensagem = temChave('mensagem');
    d.contains_key_status = temChave('status');
    d.contains_key_motivo = temChave('motivo');
    d.contains_key_deve_enviar = temChave('deve_enviar');
    d.contains_key_mensagem_personalizada = temChave('mensagem_personalizada');
    d.contains_key_segmentacao = temChave('segmentacao');
    d.contains_key_agendar_em_horas = temChave('agendar_em_horas');
    const ehReativo = d.contains_key_mensagem || d.contains_key_status;
    const ehProativo = d.contains_key_deve_enviar || d.contains_key_mensagem_personalizada || d.contains_key_agendar_em_horas;
    d.schema_hint = (ehReativo && ehProativo) ? 'misto' : ehReativo ? 'reativo' : ehProativo ? 'proativo' : 'nenhum';

    try { JSON.parse(limpo); }
    catch (e: any) {
      const c = classificarErroParse(e);
      d.parse_error_tipo = c.tipo;
      d.parse_error_categoria = c.categoria;
      d.parse_error_pos = c.pos;
      d.parse_error_char_classe = (c.pos !== null && c.pos >= 0 && c.pos < limpo.length) ? classeChar(limpo[c.pos]) : null;
    }

    if (iAbre >= 0 && iFecha > iAbre) {
      const extraido = limpo.slice(iAbre, iFecha + 1);
      d.brace_extract_len = extraido.length;
      let okParse = false;
      try { JSON.parse(extraido); okParse = true; } catch { okParse = false; }
      d.brace_extract_parse_ok = okParse;
      if (okParse) {
        const p = parseDecisao(extraido);
        d.brace_extract_contract_ok = p.ok === true;
        d.brace_extract_failure_reason = p.ok ? null : (p as any).erro;
      } else {
        d.brace_extract_contract_ok = false;
        d.brace_extract_failure_reason = 'parse_falhou';
      }
    } else {
      d.brace_extract_parse_ok = false;
      d.brace_extract_contract_ok = false;
      d.brace_extract_failure_reason = 'sem_par_de_chaves';
    }
  } catch (e: any) {
    d.diag_erro = String(e?.name || 'Error');
  }
  return d;
}

function recuperarPorChaves(raw: string): { ok: true; decisao: any } | null {
  const limpo = raw.replace(/```json|```/g, '').trim();
  const iAbre = limpo.indexOf('{');
  const iFecha = limpo.lastIndexOf('}');
  if (iAbre < 0 || iFecha <= iAbre) return null;
  const extraido = limpo.slice(iAbre, iFecha + 1);
  try { JSON.parse(extraido); } catch { return null; }
  const p = parseDecisao(extraido);
  return p.ok ? p : null;
}

function schemaCompleto(d: any): boolean {
  return typeof d?.mensagem === 'string'
    && STATUS_VALIDOS.includes(d?.status)
    && (d.mensagem.trim() !== '' || /^auto_atendimento/i.test(String(d.motivo || '')));
}

async function liberarTrava(leadId: string): Promise<{ ok: boolean; erro: string | null }> {
  try {
    const { error } = await sb.from('agente_conversacao_estado')
      .update({ processando_em: null, debounce_token: null, updated_at: new Date().toISOString() })
      .eq('lead_id', leadId);
    return { ok: !error, erro: error?.message?.slice(0, 120) || null };
  } catch (e: any) {
    return { ok: false, erro: String(e?.message || e).slice(0, 120) };
  }
}

async function registrarDecisao(params: {
  lead_id: string | null; acao: string; resultado: string; contexto: any; decisao: any;
  turn_id?: string | null; envio?: ResultadoEnvio | null; output_origin?: string | null;
}): Promise<string | null> {
  try {
    if (BRUNO_ENVIO_OBSERVAVEL_ENABLED) {
      const e = params.envio ?? null;
      const sucesso = e ? (e.estado === 'aceito' ? true : e.estado === 'rejeitado' ? false : null) : null;
      const { data } = await sb.rpc('fn_registrar_decisao_agente_v2', {
        p_agente_slug: 'agente-conversacao', p_acao_executada: params.acao,
        p_resultado: params.resultado, p_nivel_autonomia: NIVEL_FIXO,
        p_lead_id: params.lead_id, p_contexto: params.contexto, p_decisao: params.decisao,
        p_impacto_financeiro: null, p_agent_version: AGENT_VERSION, p_dry_run: false,
        p_turn_id: params.turn_id ?? null,
        p_envio_provider_id: e?.provider_id ?? null,
        p_execucao_sucesso: sucesso,
        p_efeito_externo: sucesso,
        p_output_origin: params.output_origin ?? null,
        p_executed_at: e?.finalizado_em ?? null,
      });
      return (data as string) ?? null;
    }
    const { data } = await sb.rpc('fn_registrar_decisao_agente', {
      p_agente_slug: 'agente-conversacao', p_acao_executada: params.acao,
      p_resultado: params.resultado, p_nivel_autonomia: NIVEL_FIXO,
      p_lead_id: params.lead_id, p_contexto: params.contexto, p_decisao: params.decisao,
      p_impacto_financeiro: null, p_agent_version: AGENT_VERSION, p_dry_run: false,
    });
    return (data as string) ?? null;
  } catch (e: any) { console.error('decisao_log_err:', e?.message); return null; }
}

async function podeExecutarDiretamente(acao: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('fn_agente_pode_executar', { p_slug: 'agente-conversacao', p_acao: acao });
    if (error || !data?.pode) return false;
    return data.modo === 'execucao_direta';
  } catch { return false; }
}

async function enviar(subscriberId: string, txt: string): Promise<ResultadoEnvio> {
  const t0 = Date.now();
  const base: ResultadoEnvio = {
    ok: false, estado: 'incerto', http_status: null, provider_id: null,
    corpo: null, erro: null, categoria_erro: null, duracao_ms: 0,
    confirmado_por: null, finalizado_em: null,
  };
  try {
    const opcoes: RequestInit = {
      method: 'POST',
      headers: { accept: 'application/json', 'Content-Type': 'application/json', 'API-KEY': BOT_API_KEY },
      body: JSON.stringify({ type: 'text', value: fmt(txt) }),
    };
    if (BRUNO_ENVIO_OBSERVAVEL_ENABLED) opcoes.signal = AbortSignal.timeout(ENVIO_TIMEOUT_MS);
    const res = await fetch(`${BOT_BASE}/subscriber/${subscriberId}/send_message/`, opcoes);
    const finalizadoEm = new Date().toISOString();
    const corpo = BRUNO_ENVIO_OBSERVAVEL_ENABLED
      ? (await res.text().catch(() => '')).slice(0, ENVIO_CORPO_MAX)
      : null;
    if (res.ok) {
      return { ...base, ok: true, estado: 'aceito', http_status: res.status, corpo,
               confirmado_por: 'http_2xx', duracao_ms: Date.now() - t0, finalizado_em: finalizadoEm };
    }
    return { ...base, ok: false, estado: 'rejeitado', http_status: res.status, corpo,
             categoria_erro: 'http_nao_2xx', duracao_ms: Date.now() - t0, finalizado_em: finalizadoEm };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const nome = String(e?.name || '');
    const ehTimeout = nome === 'TimeoutError' || nome === 'AbortError' || /timed? ?out|abort/i.test(msg);
    return { ...base, ok: false, estado: 'incerto', erro: msg.slice(0, 200),
             categoria_erro: ehTimeout ? 'timeout' : 'rede', duracao_ms: Date.now() - t0,
             finalizado_em: new Date().toISOString() };
  }
}

async function gravarOutbound(leadId: string, phone: string, texto: string): Promise<OutboundPersistido> {
  const timestamp = new Date().toISOString();
  try {
    const { data, error } = await sb.from('fact_conversations').insert({
      lead_id: leadId, phone, direction: 'outbound', message_text: fmt(texto),
      message_type: 'text', timestamp, source: 'bruno',
    }).select('id, timestamp').single();
    if (error) {
      log('outbound', 'persistencia_falhou', { lead_id: leadId, erro: error.message?.slice(0, 160) });
      return { id: null, timestamp, erro: error.message?.slice(0, 160) || 'erro_desconhecido' };
    }
    return { id: data?.id ?? null, timestamp: data?.timestamp ?? timestamp, erro: null };
  } catch (e: any) {
    const erro = String(e?.message || e).slice(0, 160);
    log('outbound', 'persistencia_exception', { lead_id: leadId, erro });
    return { id: null, timestamp, erro };
  }
}

async function registrarUsoObjecao(params: {
  lead_id: string;
  objection_id: string;
  playbook_id: string | null;
  modo: 'followup_proativo' | 'resposta_reativa';
  contexto: Record<string, any>;
  outbound: OutboundPersistido;
}): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('fn_objecao_registrar_uso', {
      p_lead_id: params.lead_id,
      p_objection_id: params.objection_id,
      p_playbook_id: params.playbook_id,
      p_agente_slug: 'agente-conversacao',
      p_modo: params.modo,
      p_contexto: params.contexto,
      p_usage_type: 'adaptado',
      p_conversation_message_id: params.outbound.id,
      p_enviado_em: params.outbound.timestamp,
    });
    if (error || data?.ok !== true) {
      log('objecao_uso', 'registro_falhou', {
        lead_id: params.lead_id,
        objection_id: params.objection_id,
        modo: params.modo,
        outbound_id: params.outbound.id,
        rpc_error: error?.message?.slice(0, 160) || null,
        retorno: data ?? null,
      });
      return false;
    }
    log('objecao_uso', 'registrado', {
      lead_id: params.lead_id,
      objection_id: params.objection_id,
      modo: params.modo,
      usage_type: 'adaptado',
      outbound_id: params.outbound.id,
      com_evidencia: !!params.outbound.id,
    });
    return true;
  } catch (e: any) {
    log('objecao_uso', 'registro_exception', {
      lead_id: params.lead_id,
      objection_id: params.objection_id,
      modo: params.modo,
      erro: String(e?.message || e).slice(0, 160),
    });
    return false;
  }
}

async function getBCSubscriberId(phone: string): Promise<string | null> {
  try {
    const res = await fetch(`${BOT_BASE}/subscriber/get_by_phone/${phone}/`, {
      headers: { accept: 'application/json', 'API-KEY': BOT_API_KEY },
    });
    if (!res.ok) return null;
    return (await res.json())?.id?.toString() || null;
  } catch { return null; }
}

async function persistirSubscriberId(leadId: string, phone: string, subscriberId: string): Promise<void> {
  try {
    const agora = new Date().toISOString();
    const { error } = await sb.from('lead_identificadores').upsert({
      lead_id: leadId, telefone: phone, contact_botconversa_id: subscriberId,
      botconversa_verificado_em: agora, updated_at: agora,
    }, { onConflict: 'lead_id' });
    if (error) log('subscriber', 'persistencia_falhou', { lead_id: leadId, erro: error.message?.slice(0, 120) });
  } catch (e: any) {
    log('subscriber', 'persistencia_exception', { lead_id: leadId, erro: e?.message?.slice(0, 120) });
  }
}

async function resolverSubscriberId(leadId: string, phone: string, recebido?: string | null): Promise<{ id: string | null; fonte: string }> {
  if (recebido) {
    await persistirSubscriberId(leadId, phone, recebido);
    return { id: recebido, fonte: 'body' };
  }
  try {
    const { data: li } = await sb.from('lead_identificadores').select('contact_botconversa_id').eq('lead_id', leadId).maybeSingle();
    if (li?.contact_botconversa_id) return { id: String(li.contact_botconversa_id), fonte: 'lead_identificadores' };
  } catch {}
  try {
    const { data: exploracao } = await sb.from('agente_exploracao_estado').select('subscriber_id').eq('lead_id', leadId)
      .not('subscriber_id', 'is', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (exploracao?.subscriber_id) {
      const id = String(exploracao.subscriber_id);
      await persistirSubscriberId(leadId, phone, id);
      return { id, fonte: 'agente_exploracao_estado' };
    }
  } catch {}
  try {
    const { data: julia } = await sb.from('julia_sessoes_inbound').select('subscriber_id').eq('phone', phone)
      .not('subscriber_id', 'is', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (julia?.subscriber_id) {
      const id = String(julia.subscriber_id);
      await persistirSubscriberId(leadId, phone, id);
      return { id, fonte: 'julia_sessoes_inbound' };
    }
  } catch {}
  const apiId = await getBCSubscriberId(phone);
  if (apiId) {
    await persistirSubscriberId(leadId, phone, apiId);
    return { id: apiId, fonte: 'botconversa_api' };
  }
  return { id: null, fonte: 'nao_encontrado' };
}

async function gerarEmbedding(texto: string): Promise<string | null> {
  if (!texto || texto.length < 10) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texto, dimensions: 1536 }), signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.data?.[0]?.embedding ? JSON.stringify(d.data[0].embedding) : null;
  } catch { return null; }
}

async function carregarReflexao(leadId: string, phone: string, segmento: string, embedding: string | null): Promise<string> {
  try {
    const { data } = await sb.rpc('fn_bloco_reflexao_agente', {
      p_agente_slug: 'agente-conversacao', p_lead_id: leadId as any, p_phone: phone,
      p_segmento: segmento || null, p_embedding_contexto: embedding,
    });
    return data || '';
  } catch { return ''; }
}

async function getPromptBase(): Promise<string> {
  const { data } = await sb.from('agentes').select('prompt_base').eq('slug', 'agente-conversacao').single();
  return data?.prompt_base || '';
}

async function getEstado(leadId: string) {
  const { data } = await sb.from('agente_conversacao_estado').select('*').eq('lead_id', leadId).maybeSingle();
  return data;
}

async function saveEstado(leadId: string, e: any) {
  await sb.from('agente_conversacao_estado').upsert({ lead_id: leadId, ...e, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' });
}

async function agentePodeAtender(leadId: string, phone: string): Promise<{ pode: boolean; motivo: string }> {
  try {
    const { data, error } = await sb.rpc('fn_agente_automatico_pode_atender', {
      p_lead_id: leadId, p_phone: phone, p_janela_humano_min: 90,
      p_checar_recorrente: true, p_checar_purchase: true, p_respeitar_julia_pausa: false,
    });
    if (error) return { pode: false, motivo: 'rpc_error' };
    return { pode: !!data?.pode, motivo: data?.motivo || 'unknown' };
  } catch { return { pode: false, motivo: 'exception' }; }
}

async function jaTemFollowupRecente(leadId: string): Promise<boolean> {
  const { data } = await sb.from('agente_conversacao_estado').select('ultimo_followup_em').eq('lead_id', leadId).maybeSingle();
  if (!data?.ultimo_followup_em) return false;
  return (Date.now() - new Date(data.ultimo_followup_em).getTime()) / 3600000 < FOLLOWUP_JANELA_H;
}

async function getHistorico(leadId: string): Promise<{ role: string; content: string }[]> {
  try {
    const { data } = await sb.from('fact_conversations').select('direction, message_text, timestamp')
      .eq('lead_id', leadId).order('timestamp', { ascending: false }).limit(16);
    const hist = (data || []).reverse();
    return hist.map((h: any) => {
      const texto = h.message_text || '';
      if (h.direction === 'outbound') {
        if (!texto.startsWith(ASSINATURA.trim()) && !texto.startsWith('*Bruno Fonseca:*')) return null;
        return { role: 'assistant', content: texto.replace(/^\*[^*]+:\*\n?/, '').trim() };
      }
      return { role: 'user', content: texto.replace(/^\*[^*]+:\*\n?/, '').trim() };
    }).filter((m: any) => m && m.content.length > 0);
  } catch { return []; }
}

async function buscarObjecaoPendente(leadId: string): Promise<any | null> {
  try {
    const { data } = await sb.from('lead_objections')
      .select('id, tipo_objecao, forca, mensagem_gatilho, playbook_sugerido_id')
      .eq('lead_id', leadId).eq('resolvido', false).eq('status_aprovacao', 'aguardando')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    let playbook = null;
    if (data.playbook_sugerido_id) {
      const { data: pb } = await sb.from('objection_playbooks')
        .select('id, tipo_objecao, forca, titulo, script_sugerido').eq('id', data.playbook_sugerido_id).maybeSingle();
      playbook = pb;
    }
    if (!playbook) {
      const { data: pb } = await sb.from('objection_playbooks')
        .select('id, tipo_objecao, forca, titulo, script_sugerido')
        .eq('tipo_objecao', data.tipo_objecao).eq('ativo', true)
        .order('forca', { ascending: false }).limit(1).maybeSingle();
      playbook = pb;
    }
    return { ...data, playbook };
  } catch { return null; }
}

function validarMensagem(msg: string): { ok: boolean; motivo: string } {
  if (!msg || msg.trim().length < 5) return { ok: false, motivo: 'mensagem_vazia' };
  if (/\[[^\]]+\]|\{[^}]+\}|R\$X/i.test(msg)) return { ok: false, motivo: 'placeholder_nao_preenchido' };
  if (/\bTamires\b|\bHelen\b|\bAlessandro\b|\bJulia\b|\bMarcos\b/i.test(msg)) return { ok: false, motivo: 'menciona_funcionario' };
  if (msg.length > 600) return { ok: false, motivo: 'mensagem_muito_longa' };
  if (REGEX_EMOJI.test(msg)) return { ok: false, motivo: 'contem_emoji' };
  for (const re of FRASES_MOLDE) if (re.test(msg)) return { ok: false, motivo: 'frase_molde_generica' };
  return { ok: true, motivo: '' };
}

function calcularInicioJanela(): Date {
  const agora = new Date();
  const brt = new Date(agora.getTime() - 3 * 3600000);
  let diasAtras = 1;
  let diaFechamento = new Date(brt);
  diaFechamento.setDate(brt.getDate() - diasAtras);
  while (diaFechamento.getDay() === 0 || diaFechamento.getDay() === 6) {
    diasAtras++;
    diaFechamento = new Date(brt);
    diaFechamento.setDate(brt.getDate() - diasAtras);
  }
  const diaDaSemana = diaFechamento.getDay();
  const horarioFechamento = diaDaSemana === 5 ? 16 : 17;
  const dataBase = new Date(agora);
  dataBase.setUTCDate(agora.getUTCDate() - diasAtras);
  dataBase.setUTCHours(horarioFechamento + 3, 0, 0, 0);
  return dataBase;
}

async function modoReativarForaHorario(): Promise<Response> {
  const inicioJanela = calcularInicioJanela();
  const fimJanela = new Date();
  log('reativar', 'iniciando', { de: inicioJanela.toISOString(), ate: fimJanela.toISOString() });
  const { data: leads } = await sb.from('leads_marketing')
    .select('lead_id, fullname, ph, content_category')
    .gte('created_at', inicioJanela.toISOString()).lte('created_at', fimJanela.toISOString()).limit(50);
  if (!leads?.length) return new Response(JSON.stringify({ ok: true, ativados: 0 }), { status: 200 });
  let ativados = 0, sem_subscriber = 0, ja_atendidos = 0, compraram = 0;
  const fontesSubscriber: Record<string, number> = {};
  for (const lead of leads) {
    try {
      const leadId = lead.lead_id;
      const phone = lead.ph;
      const nome = (lead.fullname || 'Cliente').split(' ')[0];
      const segmento = lead.content_category || 'diversos';
      const { data: estado } = await sb.from('agente_exploracao_estado').select('trocas, status').eq('lead_id', leadId).maybeSingle();
      if (estado?.trocas && estado.trocas > 0) {
        ja_atendidos++;
        await registrarDecisao({ lead_id: leadId, acao: 'reativar_lead_skip', resultado: 'executada', contexto: { motivo: 'ja_atendido', trocas: estado.trocas, segmento }, decisao: {} });
        continue;
      }
      const { count: compras } = await sb.from('pixel_events').select('*', { count: 'exact', head: true }).eq('lead_id', leadId).eq('event_name', 'Purchase').gt('value', 0);
      if (compras && compras > 0) {
        compraram++;
        await registrarDecisao({ lead_id: leadId, acao: 'reativar_lead_skip', resultado: 'executada', contexto: { motivo: 'ja_comprou', compras, segmento }, decisao: {} });
        continue;
      }
      const resolvido = await resolverSubscriberId(leadId, phone);
      const subscriberId = resolvido.id;
      fontesSubscriber[resolvido.fonte] = (fontesSubscriber[resolvido.fonte] || 0) + 1;
      if (!subscriberId) {
        sem_subscriber++;
        await registrarDecisao({ lead_id: leadId, acao: 'reativar_lead_sem_bc', resultado: 'executada', contexto: { motivo: 'sem_subscriber_bc', segmento, phone }, decisao: {} });
        continue;
      }
      const { data: primeiraMsg } = await sb.from('fact_conversations').select('message_text').eq('lead_id', leadId).eq('direction', 'inbound')
        .not('message_text', 'is', null).order('timestamp', { ascending: true }).limit(1).maybeSingle();
      const mensagemContexto = primeiraMsg?.message_text || 'Olá, gostaria de mais informações';
      await sb.from('agente_exploracao_estado').upsert({
        lead_id: leadId, phone, subscriber_id: subscriberId, status: 'em_progresso', trocas: 0,
        processando_em: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'lead_id' });
      await fetch(`${SUPABASE_URL}/functions/v1/agente-exploracao`, {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        body: JSON.stringify({ phone, subscriber_id: subscriberId, lead_id: leadId, text: { message: mensagemContexto }, chatName: nome }),
      });
      await sleep(1500);
      ativados++;
      await registrarDecisao({ lead_id: leadId, acao: 'reativar_lead', resultado: 'executada', contexto: { segmento, nome, fonte: 'cron_fora_horario', subscriber_fonte: resolvido.fonte }, decisao: { acionou: 'agente-exploracao', mensagem_contexto: (mensagemContexto || '').slice(0, 200) } });
    } catch (e: any) {
      await registrarDecisao({ lead_id: lead.lead_id, acao: 'reativar_lead_erro', resultado: 'falhou', contexto: { erro: String(e).slice(0, 300), segmento: lead.content_category || null }, decisao: {} });
    }
  }
  await sb.from('cron_execution_log').insert({
    job_name: 'reativar-leads-fora-horario', status: 'ok',
    detalhes: { janela_de: inicioJanela.toISOString(), leads_encontrados: leads.length, ativados, sem_subscriber, ja_atendidos, compraram, fontes_subscriber: fontesSubscriber },
    executado_em: new Date().toISOString(),
  }).catch(() => {});
  return new Response(JSON.stringify({ ok: true, leads_encontrados: leads.length, ativados, sem_subscriber, ja_atendidos, compraram, fontes_subscriber: fontesSubscriber }), { status: 200 });
}

async function modoProativo(body: any): Promise<Response> {
  const { lead_id, phone, nome, mensagem, segmentacao, agendar_em_horas } = body;
  const podeDispararFollowup = await podeExecutarDiretamente('enviar_followup');
  if (!podeDispararFollowup) {
    await registrarDecisao({ lead_id, acao: 'followup_bloqueado', resultado: 'executada', contexto: { motivo: 'autonomia_insuficiente', segmentacao: segmentacao || null }, decisao: {} });
    return new Response(JSON.stringify({ ok: true, bloqueada: true, motivo: 'autonomia_insuficiente' }), { status: 200 });
  }
  if (await jaTemFollowupRecente(lead_id)) {
    await registrarDecisao({ lead_id, acao: 'followup_bloqueado', resultado: 'executada', contexto: { motivo: 'followup_recente_8h', segmentacao: segmentacao || null }, decisao: {} });
    return new Response(JSON.stringify({ ok: true, bloqueada: true, motivo: 'followup_recente_8h' }), { status: 200 });
  }
  const guard = await agentePodeAtender(lead_id, phone);
  if (!guard.pode) {
    await registrarDecisao({ lead_id, acao: 'followup_bloqueado', resultado: 'executada', contexto: { motivo: guard.motivo, fonte: 'agentePodeAtender', segmentacao: segmentacao || null }, decisao: {} });
    return new Response(JSON.stringify({ ok: true, bloqueada: true, motivo: guard.motivo }), { status: 200 });
  }
  const objecao = await buscarObjecaoPendente(lead_id);
  let mensagemFinal = mensagem;
  if (objecao?.playbook) {
    const [ctxTemporal, ctxAprendizados] = await Promise.all([
      sb.rpc('fn_bloco_contexto_temporal', { p_agente_slug: 'agente-conversacao' }).then((r: any) => r.data || '').catch(() => ''),
      sb.rpc('fn_contexto_aprendizados', { p_agente_slug: 'agente-conversacao', p_segmento: segmentacao || null }).then((r: any) => r.data || null).catch(() => null),
    ]);
    const blocoAprendizados = ctxAprendizados ? ((ctxAprendizados.bloco_erros || '') + (ctxAprendizados.bloco_acertos || '')) : '';
    const instrucao = [
      `Voce e Bruno Fonseca, consultor comercial da Skillprint.`,
      `Objecao: tipo=${objecao.tipo_objecao} forca=${objecao.forca}`,
      `Trecho: "${objecao.mensagem_gatilho}"`,
      `Script: "${objecao.playbook.script_sugerido}"`,
      `Mensagem original: "${mensagem}"`,
      blocoAprendizados ? blocoAprendizados : '', ctxTemporal ? ctxTemporal : '',
      `Reescreva incorporando a quebra de forma NATURAL. Max 3 frases. Nome: ${nome}. NUNCA use emoji.`,
      `PROIBIDO usar chavoes: "qualquer duvida e so falar", "passando pra ver se ainda tem interesse", "ainda faz sentido pra voce".`,
      `Retorne SOMENTE a mensagem.`,
    ].filter(Boolean).join('\n');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 300, messages: [{ role: 'user', content: instrucao }] }),
      });
      const d = await res.json();
      const nova = d.content?.[0]?.text?.trim();
      if (nova && nova.length > 5) mensagemFinal = nova;
    } catch {}
  }
  const validacao = validarMensagem(mensagemFinal);
  if (!validacao.ok) {
    await registrarDecisao({ lead_id, acao: 'followup_validacao_falha', resultado: 'falhou', contexto: { motivo: validacao.motivo, segmentacao: segmentacao || null, origem: 'modoProativo', chamador: body.chamador || body.fonte || null }, decisao: { mensagem_tentada: (mensagemFinal || '').slice(0, 300) } });
    return new Response(JSON.stringify({ ok: false, bloqueada: true, motivo: validacao.motivo }), { status: 200 });
  }
  await sb.rpc('upsert_waba_disparo_safe', {
    p_lead_id: lead_id, p_name: nome, p_phone: phone, p_interesse: '', p_segmentacao: segmentacao || 'followup_agente', p_evento: '',
    p_template: 'followup_agente', p_tipo_template: 'followup_agente', p_mensagem: fmt(mensagemFinal),
    p_next_due_at: new Date(Date.now() + (agendar_em_horas || 0) * 3600000).toISOString(), p_decision_id: body.decision_id || crypto.randomUUID(),
  });
  const subscriberId = await getBCSubscriberId(phone);
  const outbound = await gravarOutbound(lead_id, phone, mensagemFinal);
  await saveEstado(lead_id, {
    lead_id, phone, subscriber_id: subscriberId, status: 'em_progresso', ultimo_followup_em: new Date().toISOString(),
    contexto_followup: { segmento: segmentacao, sinal: body.sinal, tem_objecao: !!objecao, tipo_objecao: objecao?.tipo_objecao || null, mensagem: mensagemFinal.slice(0, 200) }, processando_em: null,
  });
  let usoObjecaoRegistrado: boolean | null = null;
  if (objecao?.id) {
    usoObjecaoRegistrado = await registrarUsoObjecao({
      lead_id,
      objection_id: objecao.id,
      playbook_id: objecao.playbook?.id || null,
      modo: 'followup_proativo',
      contexto: { segmento: segmentacao, versao: AGENT_VERSION },
      outbound,
    });
  }
  await registrarDecisao({
    lead_id, acao: 'followup_enviado', resultado: 'executada',
    contexto: { segmento: segmentacao, sinal: body.sinal, tem_objecao: !!objecao, tipo_objecao: objecao?.tipo_objecao || null, agendar_em_horas: agendar_em_horas || 0, objection_id: objecao?.id || null, playbook_id: objecao?.playbook?.id || null, conversation_message_id: outbound.id, outbound_persistido: !outbound.erro, uso_objecao_registrado: usoObjecaoRegistrado },
    decisao: { mensagem: mensagemFinal.slice(0, 500), template: 'followup_agente', playbook_usado: !!(objecao?.id) },
  });
  return new Response(JSON.stringify({ ok: true, disparado: true, conversation_message_id: outbound.id, uso_objecao_registrado: usoObjecaoRegistrado }), { status: 200 });
}

async function modoReativo(lead_id: string, phone: string, mensagem: string, subscriberId: string, imageUrl?: string | null, imageMimeType?: string | null): Promise<Response> {
  const turnId = crypto.randomUUID();
  if (!imageUrl && REGEX_AUTO_ATENDIMENTO.test(mensagem)) {
    await registrarDecisao({ lead_id, acao: 'resposta_skip', resultado: 'executada', contexto: { motivo: 'auto_atendimento', msg_robo: mensagem.slice(0, 120), turn_id: turnId }, decisao: {}, turn_id: turnId, output_origin: 'nenhuma_saida' });
    return new Response(JSON.stringify({ ok: true, skip: 'auto_atendimento', turn_id: turnId }), { status: 200 });
  }
  const estado = await getEstado(lead_id);
  const trocas = estado?.trocas || 0;
  const statusAtual = estado?.status || 'em_progresso';
  if (STATUS_BLOQUEIO.includes(statusAtual)) {
    await registrarDecisao({ lead_id, acao: 'resposta_skip', resultado: 'executada', contexto: { motivo: 'bloqueio_status', status: statusAtual, turn_id: turnId }, decisao: {}, turn_id: turnId, output_origin: 'nenhuma_saida' });
    return new Response(JSON.stringify({ ok: true, skip: 'bloqueio_status', turn_id: turnId }), { status: 200 });
  }
  if (estado?.processando_em) {
    const diff = Date.now() - new Date(estado.processando_em).getTime();
    if (diff < TRAVA_MS) {
      await sb.from('agente_conversacao_estado').update({ debounce_token: crypto.randomUUID(), updated_at: new Date().toISOString() }).eq('lead_id', lead_id);
      return new Response(JSON.stringify({ ok: true, skip: 'trava', turn_id: turnId }), { status: 200 });
    }
  }
  const meuToken = crypto.randomUUID();
  await saveEstado(lead_id, { lead_id, phone, subscriber_id: subscriberId, status: statusAtual, trocas, processando_em: new Date().toISOString(), debounce_token: meuToken });
  await sleep(DELAY_MS);
  const est2 = await getEstado(lead_id);
  if (est2?.debounce_token !== meuToken) {
    await sb.from('agente_conversacao_estado').update({ processando_em: null, updated_at: new Date().toISOString() }).eq('lead_id', lead_id);
    return new Response(JSON.stringify({ ok: true, skip: 'debounce', turn_id: turnId }), { status: 200 });
  }
  const guard = await agentePodeAtender(lead_id, phone);
  if (!guard.pode && !['cliente_recorrente'].includes(guard.motivo)) {
    await saveEstado(lead_id, { lead_id, phone, subscriber_id: subscriberId, status: 'bloqueada_humano', processando_em: null });
    await registrarDecisao({ lead_id, acao: 'resposta_bloqueada', resultado: 'executada', contexto: { motivo: guard.motivo, fonte: 'agentePodeAtender', turn_id: turnId }, decisao: {}, turn_id: turnId, output_origin: 'nenhuma_saida' });
    return new Response(JSON.stringify({ ok: true, bloqueada: true, motivo: guard.motivo, turn_id: turnId }), { status: 200 });
  }
  const segmento = estado?.contexto_followup?.segmento || 'diversos';
  const historico = await getHistorico(lead_id);
  const objecao = await buscarObjecaoPendente(lead_id);
  const isAudio = mensagem.startsWith('[Áudio]:') || mensagem.startsWith('[Audio]:');
  const temImagem = !!(imageUrl && !isAudio);
  const textoContexto = `Segmento: ${segmento}\nUltima mensagem: ${mensagem}\n${objecao ? `Objecao: ${objecao.tipo_objecao} ${objecao.forca}` : ''}${temImagem ? '\nCliente enviou imagem.' : ''}`;
  const embedding = await gerarEmbedding(textoContexto);
  const [promptBase, reflexao, ctxTemporal, ctxLinguagem, ctxAprendizados] = await Promise.all([
    getPromptBase(), carregarReflexao(lead_id, phone, segmento, embedding),
    sb.rpc('fn_bloco_contexto_temporal', { p_agente_slug: 'agente-conversacao' }).then((r: any) => r.data || '').catch(() => ''),
    sb.rpc('fn_contexto_linguagem', { p_lead_id: lead_id, p_segmento: segmento || null }).then((r: any) => r.data || '').catch(() => ''),
    sb.rpc('fn_contexto_aprendizados', { p_agente_slug: 'agente-conversacao', p_segmento: segmento || null }).then((r: any) => r.data || null).catch(() => null),
  ]);
  const blocoAprendizados = ctxAprendizados ? ((ctxAprendizados.bloco_erros || '') + (ctxAprendizados.bloco_acertos || '')) : '';
  const instrucaoObjecao = objecao?.playbook
    ? `\n== OBJECAO ==\nTipo: ${objecao.tipo_objecao} | Forca: ${objecao.forca}\nTrecho: "${objecao.mensagem_gatilho}"\nScript: "${objecao.playbook.script_sugerido}"\nUse como base de forma natural.`
    : '';
  const system = [
    promptBase, reflexao, blocoAprendizados ? '\n\n' + blocoAprendizados : '', ctxTemporal ? '\n\n' + ctxTemporal : '', ctxLinguagem ? '\n\n' + ctxLinguagem : '', instrucaoObjecao,
    `\n\n== MODO REATIVO ==\nO lead respondeu. Continue naturalmente.\nREGRAS DURAS:\n1. NUNCA afirme medidas, quantidades, especificacoes ou confirmacoes de pedido que o cliente NAO escreveu NESTA conversa. Pedido anterior so como PERGUNTA, nunca como afirmacao.\n2. Se a mensagem parecer automatica/robo de empresa, responda com {"mensagem": "", "status": "em_progresso", "motivo": "auto_atendimento"}.\n3. NUNCA use emoji.\n4. PROIBIDO usar chavoes de disparo automatico.\n5. NUNCA prometa desconto ou condicao que voce nao tem numero para dar.\nSe qualificou -> status: qualificado. Se fugiu -> handoff_humano.\nRetorne JSON: {"mensagem": "texto", "status": "em_progresso|qualificado|handoff_humano|aguardando_cliente", "motivo": ""}`,
  ].join('');
  let userContent: any;
  if (temImagem) userContent = [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: mensagem || 'O cliente enviou uma imagem.' }];
  else userContent = mensagem;
  const messages = [...historico.slice(-10), { role: 'user', content: userContent }];
  let parsed: any = null;
  const tele: Record<string, any> = {};
  for (let t = 1; t <= 2 && !parsed; t++) {
    const maxTok = t === 1 ? MAX_TOKENS_REATIVO : MAX_TOKENS_RETRY;
    const sys = t === 1 ? system : system + INSTRUCAO_RETRY;
    try {
      const r = await chamarModelo(sys, messages, maxTok);
      tele[`t${t}_stop_reason`] = r.stop_reason;
      tele[`t${t}_output_tokens`] = r.output_tokens;
      tele[`t${t}_tamanho`] = r.raw.length;
      let p = parseDecisao(r.raw);
      if (!p.ok && p.erro === 'json_invalido') {
        tele[`t${t}_diag`] = diagnosticarRaw(r.raw);
        const rec = recuperarPorChaves(r.raw);
        if (rec) { p = rec; tele.parse_recovered_by_brace_extract = true; }
      }
      if (!p.ok) {
        tele[`t${t}_resultado`] = p.erro;
        continue;
      }
      if (r.stop_reason === 'max_tokens' && !schemaCompleto(p.decisao)) { tele[`t${t}_resultado`] = 'max_tokens_schema_incompleto'; continue; }
      if (r.stop_reason === 'max_tokens') tele[`t${t}_suspeito_max_tokens`] = true;
      parsed = p.decisao;
      tele[`t${t}_resultado`] = 'ok';
    } catch (e: any) {
      const err = e instanceof ErroModelo ? e : new ErroModelo('excecao', false, String(e?.message || e));
      tele[`t${t}_resultado`] = err.categoria;
      tele[`t${t}_recuperavel`] = err.recuperavel;
      if (!err.recuperavel) break;
    }
  }
  if (!parsed) {
    const lib = await liberarTrava(lead_id);
    tele.trava_liberada = lib.ok;
    await registrarDecisao({ lead_id, acao: 'resposta_falha_tecnica', resultado: 'falhou', contexto: { segmento, trocas, status_anterior: statusAtual, fonte: 'modoReativo', tem_imagem: temImagem, is_audio: isAudio, telemetria: tele, turn_id: turnId }, decisao: {}, turn_id: turnId, output_origin: 'nenhuma_saida' });
    return new Response(JSON.stringify({ ok: false, erro: 'modelo_sem_resposta_valida', turn_id: turnId }), { status: 200 });
  }
  const decisao = parsed;
  const novoStatus = decisao.status || statusAtual;
  const resposta = decisao.mensagem || '';
  const validacao = validarMensagem(resposta);
  let envio: ResultadoEnvio | null = null;
  let enviou = false;
  let outbound: OutboundPersistido | null = null;
  let usoObjecaoRegistrado: boolean | null = null;
  if (resposta && validacao.ok) {
    envio = await enviar(subscriberId, resposta);
    const aceitar = BRUNO_ENVIO_OBSERVAVEL_ENABLED ? envio.estado === 'aceito' : true;
    if (aceitar) {
      outbound = await gravarOutbound(lead_id, phone, resposta);
      if (objecao?.id) {
        usoObjecaoRegistrado = await registrarUsoObjecao({
          lead_id,
          objection_id: objecao.id,
          playbook_id: objecao.playbook?.id || null,
          modo: 'resposta_reativa',
          contexto: { segmento, versao: AGENT_VERSION, turn_id: turnId },
          outbound,
        });
      }
      enviou = true;
    }
  }
  const envioNaoAceito = BRUNO_ENVIO_OBSERVAVEL_ENABLED && !!envio && envio.estado !== 'aceito';
  const handoffPretendido = novoStatus === 'handoff_humano' && statusAtual !== 'handoff_humano';
  const handoffExecutado = handoffPretendido && !envioNaoAceito;
  let acaoLog: string;
  let resultadoLog: string;
  let outputOrigin: string;
  if (envioNaoAceito) {
    acaoLog = envio!.estado === 'rejeitado' ? 'resposta_envio_falhou' : 'resposta_envio_incerto';
    resultadoLog = 'falhou'; outputOrigin = 'nenhuma_saida';
  } else if (handoffPretendido) {
    acaoLog = 'handoff_humano'; resultadoLog = 'executada'; outputOrigin = enviou ? 'enviar_mensagem' : 'nenhuma_saida';
    fetch(`${SUPABASE_URL}/functions/v1/agente-pipeline`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ lead_id, phone, etapa_funil: 'handoff_humano', urgencia: 'alta' }),
    }).catch(() => {});
  } else if (resposta && !validacao.ok) {
    acaoLog = 'resposta_validacao_falha'; resultadoLog = 'falhou'; outputOrigin = 'nenhuma_saida';
  } else if (enviou) {
    acaoLog = 'mensagem_enviada'; resultadoLog = 'executada'; outputOrigin = 'enviar_mensagem';
  } else {
    acaoLog = 'sem_resposta'; resultadoLog = 'executada'; outputOrigin = 'end_turn';
  }
  if (envioNaoAceito) {
    const lib = await liberarTrava(lead_id);
    tele.trava_liberada = lib.ok;
  } else {
    await saveEstado(lead_id, { lead_id, phone, subscriber_id: subscriberId, status: novoStatus, trocas: trocas + 1, processando_em: null, debounce_token: null });
  }
  await registrarDecisao({
    lead_id, acao: acaoLog, resultado: resultadoLog,
    contexto: {
      segmento, trocas: envioNaoAceito ? trocas : trocas + 1, status_anterior: statusAtual,
      status_novo: envioNaoAceito ? statusAtual : novoStatus,
      tem_objecao: !!objecao, tipo_objecao: objecao?.tipo_objecao || null,
      motivo_validacao: validacao.ok ? null : validacao.motivo, objection_id: objecao?.id || null,
      playbook_id: objecao?.playbook?.id || null, tem_imagem: temImagem, is_audio: isAudio,
      motivo_ia: (decisao.motivo || '').slice(0, 80), telemetria: tele, turn_id: turnId,
      envio: envio ? { estado: envio.estado, http_status: envio.http_status, categoria_erro: envio.categoria_erro, duracao_ms: envio.duracao_ms, confirmado_por: envio.confirmado_por, corpo: envio.corpo, finalizado_em: envio.finalizado_em } : null,
      confirmacao_nivel: envio?.estado === 'aceito' ? 'provider_accepted' : null,
      entrega_confirmada: false, provider: 'botconversa', handoff_pretendido: handoffPretendido,
      handoff_executado: handoffExecutado, conversation_message_id: outbound?.id ?? null,
      outbound_persistido: outbound ? !outbound.erro : null, uso_objecao_registrado: usoObjecaoRegistrado,
    },
    decisao: { mensagem: resposta.slice(0, 500), motivo_ia: (decisao.motivo || '').slice(0, 200), playbook_usado: !!(objecao?.id && enviou) },
    turn_id: turnId, envio, output_origin: outputOrigin,
  });
  return new Response(JSON.stringify({ ok: !envioNaoAceito, status: envioNaoAceito ? statusAtual : novoStatus, trocas: envioNaoAceito ? trocas : trocas + 1, turn_id: turnId, envio_estado: envio?.estado ?? null, handoff_pretendido: handoffPretendido, handoff_executado: handoffExecutado, conversation_message_id: outbound?.id ?? null, uso_objecao_registrado: usoObjecaoRegistrado }), { status: 200 });
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { lead_id, phone, mensagem } = body;
  if (body.modo === 'reativar_fds' || body.modo === 'reativar_fora_horario') return modoReativarForaHorario();
  if (!lead_id || !phone) return new Response(JSON.stringify({ ok: false, erro: 'lead_id e phone obrigatorios' }), { status: 400 });
  if (body.modo === 'reativo' && mensagem) {
    const resolvido = await resolverSubscriberId(lead_id, phone, body.subscriber_id || null);
    const subscriberId = resolvido.id;
    if (!subscriberId) return new Response(JSON.stringify({ ok: false, erro: 'subscriber_id nao encontrado' }), { status: 200 });
    return modoReativo(lead_id, phone, mensagem, subscriberId, body.image_url || null, body.image_mime_type || null);
  }
  return modoProativo(body);
});
