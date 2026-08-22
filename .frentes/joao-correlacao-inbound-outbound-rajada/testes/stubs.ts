// Stubs de teste. Substituem o cliente Supabase, o transporte e o lock por
// estruturas em memoria. Nenhum teste toca banco real, telefone real ou provider.
// PROIBIDO por mandato: 5513974079782 so aparece como evidencia historica, nunca
// como destino. Os telefones aqui sao sinteticos (prefixo 5500).

export type Inbound = { id: string; phone: string; status: string; created_at: string; body: any };
export type Decisao = Record<string, any>;

export const db = {
  inbound: [] as Inbound[],
  decisoes: new Map<string, Decisao>(),
  erros: [] as any[],
  logs: [] as any[],
  transportes: [] as Array<{ phone: string; texto: string }>,
  locks: new Set<string>(),
  reset() { this.inbound = []; this.decisoes = new Map(); this.erros = []; this.logs = []; this.transportes = []; this.locks = new Set(); },
};

export function txt(id: string, phone: string, created_at: string, status = 'pendente', message = 'msg ' + id): Inbound {
  return { id, phone, status, created_at, body: { text: { message } } };
}

// Resolve 'body->image->>imageUrl' etc. sobre a linha.
function caminho(row: any, expr: string): any {
  const partes = expr.replace(/->>/g, '->').split('->').map((p) => p.trim());
  let cur: any = row;
  for (const p of partes) { if (cur == null) return null; cur = cur[p]; }
  return cur ?? null;
}
// Interpreta o filtro .or(...) do PostgREST usado pelo codigo: lista de
// "<caminho>.not.is.null" separados por virgula, semantica OR.
function casaOr(row: any, filtro: string): boolean {
  return filtro.split(',').some((c) => {
    const m = c.trim().match(/^(.*)\.not\.is\.null$/);
    if (!m) throw new Error('clausula .or nao suportada pelo stub: ' + c);
    return caminho(row, m[1]) != null;
  });
}

type Filtro = { tipo: string; col?: string; val?: any; expr?: string };

class Builder {
  tabela: string; filtros: Filtro[] = []; ordem: { col: string; asc: boolean } | null = null;
  lim: number | null = null; modo: 'select' | 'update' | 'delete' = 'select'; patch: any = null;
  constructor(t: string) { this.tabela = t; }
  select(_c?: string) { return this; }
  eq(col: string, val: any) { this.filtros.push({ tipo: 'eq', col, val }); return this; }
  gt(col: string, val: any) { this.filtros.push({ tipo: 'gt', col, val }); return this; }
  gte(col: string, val: any) { this.filtros.push({ tipo: 'gte', col, val }); return this; }
  lte(col: string, val: any) { this.filtros.push({ tipo: 'lte', col, val }); return this; }
  in(col: string, vals: any[]) { this.filtros.push({ tipo: 'in', col, val: (vals || []).map(String) }); return this; }
  or(expr: string) { this.filtros.push({ tipo: 'or', expr }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ordem = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  linhas(): any[] {
    const fonte = this.tabela === 'inbound_fora_horario' ? db.inbound : [];
    let r = (fonte as any[]).filter((row: any) => this.filtros.every((f) => {
      if (f.tipo === 'or') return casaOr(row, f.expr!);
      const v = row[f.col!];
      if (f.tipo === 'eq') return String(v) === String(f.val);
      if (f.tipo === 'in') return (f.val as string[]).includes(String(v));
      if (f.tipo === 'gt') return String(v) > String(f.val);
      if (f.tipo === 'gte') return String(v) >= String(f.val);
      if (f.tipo === 'lte') return String(v) <= String(f.val);
      throw new Error('filtro nao suportado: ' + f.tipo);
    }));
    if (this.ordem) { const { col, asc } = this.ordem; r = [...r].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1)); }
    if (this.lim != null) r = r.slice(0, this.lim);
    return r;
  }
  aplica(): any {
    if (this.modo === 'update' && this.tabela === 'inbound_fora_horario') {
      for (const row of this.linhas()) Object.assign(row, this.patch);
      return { data: null, error: null };
    }
    if (this.modo === 'update' && this.tabela === 'agente_decisoes_log') {
      const f = this.filtros.find((x) => x.tipo === 'eq' && x.col === 'id');
      const id = String(f?.val);
      db.decisoes.set(id, { ...(db.decisoes.get(id) || {}), ...this.patch });
      return { data: null, error: null };
    }
    if (this.modo === 'delete') return { data: null, error: null };
    return { data: this.linhas(), error: null };
  }
  maybeSingle() { const r = this.aplica(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }); }
  single() { return this.maybeSingle(); }
  update(p: any) { this.modo = 'update'; this.patch = p; return this; }
  delete() { this.modo = 'delete'; return this; }
  insert(_v: any) { this.modo = 'update'; this.patch = {}; return this; }
  then(res: any, rej: any) { return Promise.resolve(this.aplica()).then(res, rej); }
}

export const sb: any = {
  from(t: string) { return new Builder(t); },
  rpc(_f: string, _a: any) { return Promise.resolve({ data: true, error: null }); },
};

export const L = (s: string, d: any = {}) => { db.logs.push({ s, ...d }); };
export async function logErro(msg: string, payload: any) { db.erros.push({ msg, payload }); }

// Lock: mesma semantica do fn_joao_adquirir_lock (uma execucao por telefone).
export let lockDisponivel = true;
export function setLockDisponivel(v: boolean) { lockDisponivel = v; }
export async function adquirirLock(phone: string): Promise<boolean> {
  if (!lockDisponivel || db.locks.has(phone)) return false;
  db.locks.add(phone); return true;
}
export async function liberarLock(phone: string) { db.locks.delete(phone); }

// Transporte fisico stubado. Se um teste registrar envio sem passar pela barreira,
// o array denuncia.
export let interno: (...a: any[]) => Promise<any> = async () => ({ ok: true });
export function setInterno(f: (...a: any[]) => Promise<any>) { interno = f; }
export async function atenderClienteInterno(...a: any[]): Promise<any> { return await interno(...a); }
export function transportar(phone: string, texto: string) { db.transportes.push({ phone, texto }); }
