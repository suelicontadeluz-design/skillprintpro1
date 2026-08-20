// Roteador de rede do teste. Toda saida externa da Edge passa por aqui e fica
// registrada: chamadas ao modelo, a Edge calcular-frete, e os envios Z-API.
// Qualquer URL nao prevista e registrada em `outras` e devolve 500 — nenhum teste
// pode tocar em servico real por acidente.

export function criarRoteadorFetch({ turnosModelo = [], repetirUltimo = true } = {}) {
  const chamadas = { anthropic: [], calcularFrete: [], envios: [], reacoes: [], outras: [] };
  let iModelo = 0;

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json' },
  });

  const fetchFake = async (url, opts = {}) => {
    const u = String(url);
    let corpo = {};
    try { corpo = opts.body ? JSON.parse(opts.body) : {}; } catch { corpo = { _raw: String(opts.body).slice(0, 200) }; }

    if (u.startsWith('https://api.anthropic.com/')) {
      chamadas.anthropic.push(corpo);
      // Retries internos (guardrail de preco, pergunta repetida) chamam o modelo de novo.
      // Com repetirUltimo, o roteiro nao precisa adivinhar quantos retries ocorrem.
      const passo = turnosModelo[iModelo] ?? (repetirUltimo ? turnosModelo[turnosModelo.length - 1] : null);
      iModelo++;
      if (!passo) throw new Error('roteiro do modelo esgotado na chamada ' + iModelo);
      const r = typeof passo === 'function' ? passo(corpo, chamadas) : passo;
      return json({ usage: { input_tokens: 100, output_tokens: 50 }, ...r });
    }
    if (u.includes('/functions/v1/calcular-frete')) {
      chamadas.calcularFrete.push(corpo);
      return json({ ok: true, opcoes: [
        { servico: 'PAC', preco: 24.5, preco_formatado: 'R$24,50', prazo_formatado: '5 dias' },
        { servico: 'SEDEX', preco: 38.9, preco_formatado: 'R$38,90', prazo_formatado: '2 dias' },
      ] });
    }
    if (u.includes('/send-reaction')) { chamadas.reacoes.push(corpo); return json({ messageId: 'reac-1' }); }
    if (u.includes('/send-text')) { chamadas.envios.push(corpo); return json({ messageId: 'msg-' + chamadas.envios.length }); }
    if (u.includes('/functions/v1/joao-orcamento-calcme')) return json({ ok: false });

    chamadas.outras.push({ url: u, corpo });
    return json({ ok: false, erro: 'url_nao_prevista_no_teste' }, 500);
  };

  return { fetchFake, chamadas };
}

// ── Respostas do modelo ──────────────────────────────────────────────────
export function respostaTexto(decisao) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(decisao) }] };
}
export function respostaTool(nome, input, id = 'tu-1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: nome, input }] };
}
