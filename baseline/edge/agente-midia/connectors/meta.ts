// v8.8.0 (12/08/2026): acao de campanha comprovavel ponta a ponta.
//   FRENTE resultado-executada-prova-intencao, escopo SO Gustavo (decisao do Alessandro).
//   - TIMEOUT_MS em TODAS as chamadas (antes: nenhuma tinha AbortSignal; timeout deixava
//     o estado externo desconhecido enquanto a decisao ja constava 'executada').
//   - lerCampanha(): GET de status/effective_status/daily_budget para registrar
//     estado ANTES e estado OBSERVADO DEPOIS.
//   - escalarOrcamento e pausarCampanha passam a devolver endpoint, payload enviado,
//     http_status, body cru da resposta e fbtrace_id. Nada e mais descartado.
//   - incerto=true separa "nao sei" de "falhou": timeout, rede caida ou JSON invalido
//     NUNCA podem virar sucesso nem fracasso comprovado.
//
// v8.7.0 (05/08/2026): criarPublico monta payload por familia.
// ENGAGEMENT usa rule (com retention_seconds DENTRO da regra) e NUNCA
// retention_days no topo. Sem rule, recusa antes de chamar a Meta.
//
// v8.5.0 (10/06/2026): pausarCampanha confirma effective_status real (Bug 1)
// PROBLEMA: a versao anterior confiava em d.success do Meta API sem verificar
// se a campanha foi REALMENTE pausada. Em 04/05 CP134 foi 'pausada'
// (success=true) mas continuou rodando 26/26 dias em maio.
// FIX: apos POST de pause, aguarda 2s e busca effective_status real via GET.
// So retorna ok:true se status virou PAUSED.

const TIMEOUT_MS = 15000;
const ehTimeout = (e: any) => String(e?.name) === 'TimeoutError' || String(e?.name) === 'AbortError';

export class MetaConnector {
  private token: string;
  private accessToken: string;
  private baseUrl = 'https://graph.facebook.com/v24.0';
  public accountId = 'act_300454634851581';

  constructor(env: Record<string,string>) {
    this.token = env.META_PAGE_TOKEN || '';
    this.accessToken = env.META_ACCESS_TOKEN || '';
  }

  // v8.8.0: leitura completa da campanha, usada para estado ANTES e estado DEPOIS.
  // GET puro: nao altera nada na Meta.
  async lerCampanha(id: string) {
    const endpoint = `${this.baseUrl}/${id}?fields=id,name,status,effective_status,daily_budget,lifetime_budget`;
    try {
      const r = await fetch(`${endpoint}&access_token=${this.accessToken}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      let d: any = null;
      try { d = await r.json(); } catch { return { ok: false, incerto: true, http_status: r.status, erro: 'json_invalido_na_leitura', body: null, endpoint }; }
      if (!r.ok || d?.error) return { ok: false, http_status: r.status, erro: d?.error?.message ?? `HTTP ${r.status}`, body: d, endpoint };
      return {
        ok: true,
        http_status: r.status,
        endpoint,
        body: d,
        status: d?.status ?? null,
        effective_status: d?.effective_status ?? null,
        daily_budget: d?.daily_budget ?? null,
        lifetime_budget: d?.lifetime_budget ?? null,
      };
    } catch (e: any) {
      return { ok: false, incerto: true, timeout: ehTimeout(e), http_status: null, erro: e?.message ?? String(e), body: null, endpoint };
    }
  }

  async getStatusCampanha(id: string): Promise<string | null> {
    try {
      const r = await fetch(`${this.baseUrl}/${id}?fields=status,effective_status&access_token=${this.accessToken}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) return null;
      const d = await r.json();
      return d?.effective_status ?? d?.status ?? null;
    } catch {
      return null;
    }
  }

  async pausarCampanha(id: string) {
    const endpoint = `${this.baseUrl}/${id}`;
    const payload_enviado = { status: 'PAUSED' };
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload_enviado, access_token: this.accessToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      let d: any = null;
      try {
        d = await r.json();
      } catch {
        return { ok: false, incerto: true, resultado: `Meta retornou JSON invalido ao pausar ${id} (HTTP ${r.status})`, http_status: r.status, response: null, endpoint, payload_enviado };
      }

      if (!r.ok || d?.success !== true) {
        return { ok: false, resultado: d?.error?.message || `Meta nao confirmou pausa (HTTP ${r.status})`, http_status: r.status, response: d, endpoint, payload_enviado, meta_trace: d?.error?.fbtrace_id ?? null };
      }

      await new Promise(res => setTimeout(res, 2000));
      const statusReal = await this.getStatusCampanha(id);

      if (statusReal !== 'PAUSED') {
        return {
          ok: false,
          incerto: true,
          resultado: `Meta respondeu success=true mas effective_status=${statusReal ?? 'desconhecido'}. Pausa NAO confirmada.`,
          http_status: r.status, response: d, endpoint, payload_enviado, effective_status_observado: statusReal ?? null,
        };
      }

      return { ok: true, resultado: `Campanha ${id} pausada e confirmada (effective_status=PAUSED)`, http_status: r.status, response: d, endpoint, payload_enviado, effective_status_observado: statusReal };
    } catch (e: any) {
      return { ok: false, incerto: true, timeout: ehTimeout(e), resultado: e?.message ?? String(e), http_status: null, response: null, endpoint, payload_enviado };
    }
  }

  async escalarOrcamento(id: string, valor: number) {
    const endpoint = `${this.baseUrl}/${id}`;
    const centavos = Math.round(Number(valor) * 100);
    const payload_enviado = { daily_budget: centavos };
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_budget: centavos, access_token: this.accessToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      let d: any = null;
      try {
        d = await r.json();
      } catch {
        return { ok: false, incerto: true, resultado: `Meta retornou JSON invalido ao ajustar orcamento de ${id} (HTTP ${r.status})`, http_status: r.status, response: null, endpoint, payload_enviado };
      }
      const ok = r.ok && d?.success === true;
      return {
        ok,
        resultado: ok ? `Orcamento R$${valor}/dia` : (d?.error?.message || `Meta nao confirmou (HTTP ${r.status})`),
        http_status: r.status,
        response: d,
        endpoint,
        payload_enviado,
        meta_trace: d?.error?.fbtrace_id ?? null,
      };
    } catch (e: any) {
      return { ok: false, incerto: true, timeout: ehTimeout(e), resultado: e?.message ?? String(e), http_status: null, response: null, endpoint, payload_enviado };
    }
  }

  async criarPublico(accountId: string, config: any) {
    try {
      const p: any = { name: config.name, subtype: config.subtype || 'CUSTOM', access_token: this.accessToken };

      if (config.subtype === 'ENGAGEMENT') {
        if (!config.rule) return { ok: false, erro: 'ENGAGEMENT sem rule - payload recusado antes de chamar a Meta' };
        p.rule = JSON.stringify(config.rule);
      } else {
        if (config.retention_days) p.retention_days = config.retention_days;
        if (config.lookalike_spec) p.lookalike_spec = JSON.stringify(config.lookalike_spec);
      }

      const r = await fetch(`${this.baseUrl}/${accountId}/customaudiences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const d = await r.json();
      return d.id ? { ok: true, audience_id: d.id } : { ok: false, erro: d.error?.message || 'Erro' };
    } catch (e: any) {
      return { ok: false, erro: e.message };
    }
  }
}
