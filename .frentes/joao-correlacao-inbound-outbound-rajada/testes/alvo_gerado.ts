// GERADO por extrair.py — NAO EDITAR. Cada bloco abaixo e fatia literal de
// supabase/functions/agente-noturno/index.ts (versao patchada v4.31.0).
import { sb, L, logErro, adquirirLock, liberarLock, atenderClienteInterno } from './stubs.ts';
export { sb } from './stubs.ts';

// ── helpers de frescor (literal) ──
const FILTRO_INBOUND_COM_CONTEUDO = 'body->text->>message.not.is.null,body->image->>imageUrl.not.is.null,body->image->>thumbnailUrl.not.is.null,body->audio->>audioUrl.not.is.null,body->document->>documentUrl.not.is.null';
async function inboundMaisNovoQue(phone: string, refCreatedAt: string, opts: { ownedIds?: any[] | null; somentePendentes?: boolean } = {}): Promise<{ id: string; created_at: string } | null> {
  try {
    let q = sb.from('inbound_fora_horario').select('id, created_at').eq('phone', phone).gt('created_at', refCreatedAt);
    if (opts.somentePendentes) q = q.eq('status', 'pendente');
    const { data } = await q.or(FILTRO_INBOUND_COM_CONTEUDO).order('created_at', { ascending: true }).limit(5);
    const owned = (opts.ownedIds || []).map((i: any) => String(i));
    const novo = (data || []).find((r: any) => !owned.includes(String(r.id)));
    return novo ? { id: String(novo.id), created_at: String(novo.created_at) } : null;
  } catch { return null; }
}
// Maior created_at do lote. So vai ao banco quando o chamador nao sabe; webhook e sweep
// ja sabem. Sem referencia devolve null e a barreira NAO bloqueia: como no v98, a falta
// de linha faz o fluxo responder, nunca calar.
async function maxCreatedAtDoLote(ids: any[] | null, conhecido: string | null): Promise<string | null> {
  if (conhecido) return conhecido;
  if (!ids || ids.length === 0) return null;
  try {
    const { data } = await sb.from('inbound_fora_horario').select('created_at').in('id', ids).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data?.created_at ? String(data.created_at) : null;
  } catch { return null; }
}
async function carimbarInbound(phone: string, ids: any[] | null, status: string) {
  try {
    if (ids && ids.length > 0) { await sb.from('inbound_fora_horario').update({ status }).in('id', ids); }
    else { await sb.from('inbound_fora_horario').update({ status }).eq('phone', phone).eq('status', 'pendente').gte('created_at', new Date(Date.now() - 600000).toISOString()); }
  } catch {}
}
async function finalizarDecisaoSuperseded(decisionId: string | null, turnId: string, contexto: any) {
  if (!decisionId) return;
  try {
    const { error } = await sb.from('agente_decisoes_log').update({
      acao_executada: 'resposta_noturna_superseded_por_inbound_mais_novo',
      resultado: 'expirada',
      execucao_sucesso: false,
      efeito_externo: false,
      executed_at: new Date().toISOString(),
      turn_id: turnId,
      output_origin: 'nenhuma_saida',
      terminal_operacional: 'nao_executavel',
      terminal_em: new Date().toISOString(),
      terminal_fonte: 'freshness_fence',
      contexto
    }).eq('id', decisionId);
    if (error) await logErro('CRITICO_decisao_superseded_falhou', { decision_id: decisionId, erro: error.message });
  } catch (e: any) { await logErro('CRITICO_decisao_superseded_excecao', { decision_id: decisionId, erro: String(e?.message ?? e).slice(0,150) }); }
}
export { inboundMaisNovoQue, maxCreatedAtDoLote, carimbarInbound, finalizarDecisaoSuperseded };

export type Barreira = { bloqueou: boolean; retorno: any };
export async function barreiraFinal(p: { dryRun: boolean; phone: string; idsParaCarimbar: any[] | null; loteCreatedAtMax: string | null; decisionId: string | null; turnId: string; executionId: string; contextoDecisao: any }): Promise<Barreira> {
  const { dryRun, phone, idsParaCarimbar, loteCreatedAtMax, decisionId, turnId, executionId, contextoDecisao } = p;
  const ownedInboundIds = (idsParaCarimbar || []).map((i: any) => String(i));
  const r = await (async () => {
  if (!dryRun) {
    const refLote = await maxCreatedAtDoLote(idsParaCarimbar, loteCreatedAtMax);
    const novoInbound = refLote ? await inboundMaisNovoQue(phone, refLote, { ownedIds: ownedInboundIds, somentePendentes: true }) : null;
    if (novoInbound) {
      const contextoSuperseded = { ...contextoDecisao, superseded: true, skip_reason: 'superseded_por_inbound_mais_novo', newer_inbound_id: novoInbound.id, newer_inbound_created_at: novoInbound.created_at, lote_created_at_max: refLote };
      await finalizarDecisaoSuperseded(decisionId, turnId, contextoSuperseded);
      L('superseded_por_inbound_mais_novo', { phone: phone.slice(-4), turn_id: turnId, execution_id: executionId, owned_inbound_ids: ownedInboundIds, newer_inbound_id: novoInbound.id, lote_created_at_max: refLote });
      return { ok: true, respondeu: false, skip: 'superseded_por_inbound_mais_novo', superseded: true, turn_id: turnId, execution_id: executionId, owned_inbound_ids: ownedInboundIds, newer_inbound_id: novoInbound.id };
    }
  }
    return null;
  })();
  return r ? { bloqueou: true, retorno: r } : { bloqueou: false, retorno: null };
}


// ── formacao do lote no webhook (literal) ──
export async function formarLoteWebhook(phone: string, inboundId: string | null): Promise<{ skip?: string; idsDoLote: any[] | null; loteCreatedAtMax: string | null }> {
  const ownedIds: string[] = [];
  let loteCreatedAtMax: string | null = null;
  if (inboundId) {
    const { data: minhaLinha } = await sb.from('inbound_fora_horario')
      .select('created_at, status').eq('id', inboundId).maybeSingle();
        if (minhaLinha?.status && minhaLinha.status !== 'pendente') {
          return { skip: 'inbound_ja_terminal', idsDoLote: null, loteCreatedAtMax: null };
        }
    if (minhaLinha?.created_at) {
      loteCreatedAtMax = String(minhaLinha.created_at);
      const maisNova = await inboundMaisNovoQue(phone, String(minhaLinha.created_at));
      if (maisNova) return { skip: 'debounce_msg_mais_nova', idsDoLote: null, loteCreatedAtMax: null };
    }
  }
  const { data: rajada } = await sb.from('inbound_fora_horario').select('id, body, created_at').eq('phone', phone).eq('status', 'pendente').gte('created_at', new Date(Date.now() - 300000).toISOString()).order('created_at', { ascending: true }).limit(10);
  if (rajada && rajada.length > 0) {
        for (const r of rajada) {
          ownedIds.push(String(r.id));
          if (!loteCreatedAtMax || String(r.created_at) > loteCreatedAtMax) loteCreatedAtMax = String(r.created_at);
        }
  }
  const idsDoLote = ownedIds.length > 0 ? ownedIds : (inboundId ? [String(inboundId)] : null);
  return { idsDoLote, loteCreatedAtMax };
}


// ── selecao e agrupamento do sweep (literal) ──
export async function loteDoSweep(): Promise<Array<{ phone: string; ids: any[]; loteMax: string | null }>> {
  const { data: rows } = await sb.from('inbound_fora_horario').select('id, phone, chat_name, body, created_at').eq('status', 'pendente').gte('created_at', new Date(Date.now() - 4 * 3600000).toISOString()).lte('created_at', new Date(Date.now() - 30000).toISOString()).order('created_at', { ascending: true }).limit(40);
  const porPhone = new Map<string, any[]>();
  for (const r of (rows || [])) { const p = String(r.phone || '').replace(/\D/g, ''); if (!p) continue; if (!porPhone.has(p)) porPhone.set(p, []); porPhone.get(p)!.push(r); }
  const saida: Array<{ phone: string; ids: any[]; loteMax: string | null }> = [];
  for (const [ph, lote] of porPhone) {
    const ids = lote.map((r: any) => r.id);
    const loteMax = lote.reduce((m: string | null, r: any) => (!m || String(r.created_at) > m) ? String(r.created_at) : m, null as string | null);
    saida.push({ phone: ph, ids, loteMax });
  }
  return saida;
}

// ── wrapper de lock (literal) ──
async function atenderCliente(phone: string, chatName: string, mensagem: string, imagens: string[], transcricoes: string[], idsParaCarimbar: any[] | null, dryRun: boolean, loteCreatedAtMax: string | null = null): Promise<any> {
  if (!dryRun) { const temLock = await adquirirLock(phone); if (!temLock) return { ok: true, skip: 'lock_ocupado' }; }
  try { return await atenderClienteInterno(phone, chatName, mensagem, imagens, transcricoes, idsParaCarimbar, dryRun, loteCreatedAtMax); }
  finally { if (!dryRun) await liberarLock(phone); }
}
export { atenderCliente };
