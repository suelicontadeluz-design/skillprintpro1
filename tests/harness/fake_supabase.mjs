// Cliente Supabase falso, suficiente para o subconjunto de PostgREST que a Edge
// agente-noturno usa. Nao e um ORM: e um armazenamento em memoria com os mesmos
// verbos de encadeamento, para que o artefato real rode sem tocar em banco nenhum.
//
// Suporta: select/insert/update/upsert/delete, eq/neq/gt/gte/lt/lte/in/like/is/or,
// order/limit/maybeSingle/single, e rpc(nome, args) roteada por um mapa do teste.

function caminho(coluna) {
  return String(coluna).replace(/->>/g, '.').replace(/->/g, '.').split('.');
}
function valorDe(linha, coluna) {
  let v = linha;
  for (const p of caminho(coluna)) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
}
function comoLike(padrao) {
  const escapado = String(padrao).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + escapado + '$', 'i');
}

class Consulta {
  constructor(db, tabela) {
    this.db = db; this.tabela = tabela;
    this.filtros = []; this.modo = 'select';
    this.carga = null; this.ordenacao = null; this.corte = null; this.singular = null;
  }
  select() { return this; }
  insert(rows) { this.modo = 'insert'; this.carga = rows; return this; }
  update(obj) { this.modo = 'update'; this.carga = obj; return this; }
  upsert(row, opts) { this.modo = 'upsert'; this.carga = row; this.opts = opts || {}; return this; }
  delete() { this.modo = 'delete'; return this; }
  eq(c, v) { this.filtros.push((r) => String(valorDe(r, c)) === String(v)); return this; }
  neq(c, v) { this.filtros.push((r) => String(valorDe(r, c)) !== String(v)); return this; }
  gt(c, v) { this.filtros.push((r) => valorDe(r, c) > v); return this; }
  gte(c, v) { this.filtros.push((r) => valorDe(r, c) >= v); return this; }
  lt(c, v) { this.filtros.push((r) => valorDe(r, c) < v); return this; }
  lte(c, v) { this.filtros.push((r) => valorDe(r, c) <= v); return this; }
  in(c, vs) { const set = new Set((vs || []).map(String)); this.filtros.push((r) => set.has(String(valorDe(r, c)))); return this; }
  like(c, p) { const rx = comoLike(p); this.filtros.push((r) => rx.test(String(valorDe(r, c) ?? ''))); return this; }
  ilike(c, p) { return this.like(c, p); }
  is(c, v) { this.filtros.push((r) => (v === null ? valorDe(r, c) == null : valorDe(r, c) === v)); return this; }
  not(c, op, v) { this.filtros.push((r) => !(op === 'is' && v === null ? valorDe(r, c) == null : String(valorDe(r, c)) === String(v))); return this; }
  filter(c, op, v) { this.filtros.push((r) => String(valorDe(r, c)) === String(v)); return this; }
  // 'body->text->>message.not.is.null,body->image->>imageUrl.not.is.null'
  or(expr) {
    const clausulas = String(expr).split(',').map((c) => c.trim()).filter(Boolean);
    this.filtros.push((r) => clausulas.some((c) => {
      if (c.endsWith('.not.is.null')) return valorDe(r, c.slice(0, -'.not.is.null'.length)) != null;
      if (c.endsWith('.is.null')) return valorDe(r, c.slice(0, -'.is.null'.length)) == null;
      return true;
    }));
    return this;
  }
  order(c, o) { this.ordenacao = { c, asc: (o && o.ascending === false) ? false : true }; return this; }
  limit(n) { this.corte = n; return this; }
  maybeSingle() { this.singular = 'maybe'; return this; }
  single() { this.singular = 'one'; return this; }

  _linhas() { return (this.db.dados[this.tabela] ||= []); }
  _casam() { return this._linhas().filter((r) => this.filtros.every((f) => f(r))); }

  _executar() {
    const t = this.tabela;
    if (this.modo === 'insert') {
      const rows = Array.isArray(this.carga) ? this.carga : [this.carga];
      for (const r of rows) { const copia = { id: this.db.proximoId(), ...r }; this._linhas().push(copia); }
      this.db.escritas.push({ tabela: t, modo: 'insert', rows });
      return { data: rows, error: null };
    }
    if (this.modo === 'update') {
      const alvos = this._casam();
      for (const r of alvos) Object.assign(r, this.carga);
      this.db.escritas.push({ tabela: t, modo: 'update', carga: this.carga, afetadas: alvos.length });
      return { data: alvos, error: null };
    }
    if (this.modo === 'upsert') {
      const chave = (this.opts && this.opts.onConflict) || 'id';
      const existente = this._linhas().find((r) => String(valorDe(r, chave)) === String(valorDe(this.carga, chave)));
      if (existente) Object.assign(existente, this.carga);
      else this._linhas().push({ id: this.db.proximoId(), ...this.carga });
      this.db.escritas.push({ tabela: t, modo: 'upsert', carga: this.carga });
      return { data: [this.carga], error: null };
    }
    if (this.modo === 'delete') {
      const alvos = new Set(this._casam());
      this.db.dados[t] = this._linhas().filter((r) => !alvos.has(r));
      return { data: null, error: null };
    }
    let out = this._casam().slice();
    if (this.ordenacao) {
      const { c, asc } = this.ordenacao;
      out.sort((a, b) => {
        const va = valorDe(a, c), vb = valorDe(b, c);
        if (va === vb) return 0;
        return (va > vb ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (this.corte != null) out = out.slice(0, this.corte);
    if (this.singular) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then(res, rej) { try { return Promise.resolve(this._executar()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}

export function criarBancoFake({ dados = {}, rpcs = {} } = {}) {
  let seq = 1000;
  const db = {
    dados: JSON.parse(JSON.stringify(dados)),
    escritas: [],
    chamadasRpc: [],
    proximoId() { seq += 1; return 'row-' + seq; },
    tabela(n) { return this.dados[n] || []; },
    cliente: null,
  };
  db.cliente = {
    from(t) { return new Consulta(db, t); },
    schema() { return { from: (t) => new Consulta(db, t) }; },
    async rpc(nome, args) {
      db.chamadasRpc.push({ nome, args });
      const h = rpcs[nome];
      if (!h) return { data: null, error: { message: 'rpc_nao_mockada:' + nome } };
      try { return await h(args, db); } catch (e) { return { data: null, error: { message: String(e && e.message || e) } }; }
    },
  };
  return db;
}
