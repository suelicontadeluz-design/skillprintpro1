// =============================================================================
// PATCH v122 — frente marketing-touches-sem-escritor-ctwa (trilha midia, P1)
// Alvo: edge function `zapi-ingest` do projeto ldrdtaibazplvrbwyrvx
// Baseline: v121 ACTIVE, ezbr_sha256 0dd035d29ba122a30dcb72ac1b2420045ac0fe7841def7eeead00bfd095fb104
//
// Este arquivo NAO e deployado. Ele existe para (a) versionar o texto exato do
// patch, (b) permitir typecheck isolado antes do deploy. O conteudo entre os
// marcadores PATCH-INICIO / PATCH-FIM e o que entra no index.ts do zapi-ingest,
// sem nenhuma alteracao.
//
// O cabecalho abaixo (ate PATCH-INICIO) reproduz APENAS as assinaturas que ja
// existem no index.ts v121, para o typecheck fechar fora do arquivo real.
// =============================================================================

// --- ambiente ja existente no index.ts v121 (NAO faz parte do patch) ---------
type PostgrestLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ data: any; error: any }> & {
      then: <A, B>(ok: (v: unknown) => A, err: (e: unknown) => B) => Promise<A | B>;
    };
  };
};
declare const supabase: PostgrestLike;
declare function log(step: string, status: string, detail?: Record<string, unknown>): void;
// --- fim do ambiente ---------------------------------------------------------

// PATCH-INICIO — bloco 1 de 2: nova funcao, inserida logo APOS resolveAdData()
// v122 (16/08/2026) frente marketing-touches-sem-escritor-ctwa:
//   marketing_touches existe desde 19/07 com 0 linhas porque nunca teve escritor.
//   Aqui o first-touch de CTWA passa a ser gravado no livro canonico DENTRO do
//   mesmo escopo em que o lead e criado — sem race entre criacao do lead e touch,
//   e sem segunda arquitetura. A escrita e delegada a fn_registrar_marketing_touch,
//   que ja carrega idempotencia dupla (external_event_id + payload_hash).
async function registrarTouchCtwa(
  leadId: string,
  ctwaClid: string | null,
  sourceId: string | null,
  adData: any,
  body: any,
): Promise<void> {
  try {
    // FAIL-CLOSED 1: sem lead_id nao existe touch. Nada de touch orfao.
    if (!leadId) return;

    const adId = (adData?.utm_ad_id || sourceId || null);

    // FAIL-CLOSED 2: sem ctwa_clid E sem identidade de anuncio nao ha atribuicao
    // real para registrar. Um adTitle solto que resolveAdData nao conseguiu
    // resolver NAO vira touch — atribuicao nao se fabrica.
    if (!ctwaClid && !adId) return;

    // IDEMPOTENCIA PRIMARIA: um clique no anuncio = um ctwa_clid = um touch.
    //   - retransmissao do mesmo webhook repete o ctwaClid -> 'duplicado';
    //   - varias mensagens do mesmo clique repetem o ctwaClid -> 1 touch;
    //   - clique novo em outro anuncio traz ctwaClid novo -> multi-touch preservado.
    // Sem ctwaClid, cai no messageId da Z-API, estavel por mensagem.
    const externalEventId = ctwaClid
      ? `ctwa:${ctwaClid}`
      : (body?.messageId ? `zapmsg:${body.messageId}` : null);

    // occurred_at real: `momment` da Z-API (epoch ms), que e o instante da
    // mensagem, nao o do processamento. Descarta valor futuro para nao esbarrar
    // no ck_occurred_nao_futuro; nesse caso usa o agora.
    const momentMs = Number(body?.momment);
    const nowMs = Date.now();
    const occurredAt = new Date(
      Number.isFinite(momentMs) && momentMs > 0 && momentMs <= nowMs + 60000 ? momentMs : nowMs,
    ).toISOString();

    const { data, error } = await supabase.rpc('fn_registrar_marketing_touch', {
      p_source_system: 'zapi_ingest',
      p_touch_type: ctwaClid ? 'ctwa_click' : 'paid_click',
      p_occurred_at: occurredAt,
      p_external_event_id: externalEventId,
      p_lead_id: leadId,
      p_channel: 'whatsapp',
      p_utm_source: (adData?.utm_source || (ctwaClid ? 'fb' : null)),
      p_utm_medium: (adData?.utm_medium || (ctwaClid ? 'cpc' : null)),
      p_campaign_id: (adData?.utm_campaign_id || null),
      p_campaign_name: (adData?.utm_campaign_name || null),
      p_adset_id: (adData?.utm_adset_id || null),
      p_adset_name: (adData?.utm_content || null),
      p_ad_id: adId,
      p_ad_name: (adData?.utm_ad_name || null),
      p_ctwa_clid: (ctwaClid || null),
      p_conversation_id: (body?.chatLid || null),
      p_payload_ref: {
        origem: 'zapi-ingest',
        message_id: (body?.messageId || null),
        source_type: (body?.externalAdReply?.sourceType || null),
        source_app: (body?.externalAdReply?.sourceApp || null),
        ad_title: (body?.externalAdReply?.title || null),
        atribuicao_origem: (adData?.atribuicao_origem || null),
      },
      p_ingestion_method: 'realtime',
    });

    const status = (data?.status || (error ? 'erro_rpc' : 'sem_status'));
    // 'duplicado' e SUCESSO: e a idempotencia funcionando, nao falha.
    if (status !== 'inserido' && status !== 'duplicado') {
      await supabase.from('error_log').insert({
        function_name: 'zapi-ingest',
        error_message: 'marketing_touch_nao_registrado',
        payload: {
          lead_id: leadId,
          status,
          motivo: (data?.motivo || error?.message || null),
          tem_ctwa: !!ctwaClid,
          ad_id: adId,
        },
      }).then(() => {}, () => {});
    }
    log('marketing_touch', status, {
      lead_id: leadId,
      touch_id: (data?.touch_id || null),
      tem_ctwa: !!ctwaClid,
    });
  } catch (e: any) {
    // FAIL-SAFE: o livro de midia NUNCA derruba o atendimento do WhatsApp.
    // Perder um touch e ruim; perder a conversa do cliente e pior.
    log('marketing_touch', 'exception', { erro: String(e?.message ?? e).slice(0, 200) });
  }
}
// PATCH-FIM — bloco 1 de 2

export { registrarTouchCtwa };
