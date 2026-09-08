// João — guard de compatibilidade para sacolas — 07/09/2026
// Regra de negócio autorizada pelo Alessandro:
// 1) sacola sem material -> perguntar antes de recomendar;
// 2) plástico -> não recomendar DTF;
// 3) papel ou tecido -> oferecer DTF têxtil;
// 4) respostas curtas no turno seguinte ("plástico", "papel", "tecido")
//    continuam cobertas pela instrução injetada no system prompt.

const BAG_GUARD_PREV_SERVE = Deno.serve.bind(Deno);
const BAG_GUARD_BASE_FETCH = globalThis.fetch.bind(globalThis);

function bagClean(v: unknown): string {
  return String(v ?? '').trim();
}

function bagNorm(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

type BagMaterial = 'plastico' | 'papel' | 'tecido' | 'unknown' | null;

function detectBagMaterial(text: string): BagMaterial {
  const t = bagNorm(text);
  if (!/\bsacolas?\b/.test(t)) return null;

  // Fail-closed para substratos plásticos, inclusive siglas comuns.
  if (/\b(plastico|plastica|polietileno|polipropileno|sacola\s+pp|sacola\s+pe)\b/.test(t)) return 'plastico';
  if (/\b(papel|kraft)\b/.test(t)) return 'papel';
  if (/\b(tecido|algodao|lona|canvas|tnt)\b/.test(t)) return 'tecido';
  return 'unknown';
}

function bagReply(material: Exclude<BagMaterial, null>): string {
  if (material === 'plastico') {
    return 'Se forem de plástico, DTF não pega nessas sacolas, então não indicamos.';
  }
  if (material === 'papel') {
    return 'Se forem de papel, posso te atender com DTF têxtil.';
  }
  if (material === 'tecido') {
    return 'Se forem de tecido, posso te atender com DTF têxtil.';
  }
  return 'As sacolas são de plástico, papel ou tecido? O material muda a indicação do DTF.';
}

const BAG_SYSTEM_RULE = `

[GUARDA SACOLAS — REGRA OBRIGATÓRIA]
Sempre que o assunto for SACOLA, descubra o MATERIAL antes de recomendar qualquer técnica.
- Material ainda não informado: pergunte se a sacola é de plástico, papel ou tecido. NÃO recomende produto antes da resposta.
- Sacola de plástico: NÃO recomende DTF UV, DTF têxtil nem outro produto. Informe que DTF não pega nessas sacolas e não indique alternativa.
- Sacola de papel ou tecido: ofereça DTF TÊXTIL.
- NUNCA diga que DTF UV cola, pega ou é indicado para sacola plástica.
- Se a pergunta anterior foi sobre o material da sacola, respostas curtas como "plástico", "papel", "kraft", "tecido", "lona" ou "TNT" são a resposta dessa qualificação. Não mude o assunto nem recomende UV.
`;

// Segunda camada: mantém a regra disponível ao modelo para o turno seguinte,
// quando o cliente pode responder apenas "plástico" sem repetir a palavra sacola.
globalThis.fetch = async (input: any, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? '');
  if (/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?|$)/i.test(url) && typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      if (typeof body?.system === 'string' && !body.system.includes('[GUARDA SACOLAS — REGRA OBRIGATÓRIA]')) {
        body.system += BAG_SYSTEM_RULE;
        return BAG_GUARD_BASE_FETCH(input, { ...init, body: JSON.stringify(body) });
      }
      if (Array.isArray(body?.system) && !JSON.stringify(body.system).includes('[GUARDA SACOLAS — REGRA OBRIGATÓRIA]')) {
        body.system.push({ type: 'text', text: BAG_SYSTEM_RULE });
        return BAG_GUARD_BASE_FETCH(input, { ...init, body: JSON.stringify(body) });
      }
    } catch {
      // Se não for JSON reconhecível, não altera a requisição.
    }
  }
  return BAG_GUARD_BASE_FETCH(input, init);
};

// Primeira camada: quando a própria mensagem contém "sacola", a resposta é
// determinística e não depende do LLM.
(Deno as any).serve = (...args: any[]) => {
  const idx = typeof args[0] === 'function' ? 0 : 1;
  const handler = args[idx];
  if (typeof handler !== 'function') return (BAG_GUARD_PREV_SERVE as any)(...args);

  args[idx] = async (req: Request, info: any) => {
    if (req.method !== 'POST') return handler(req, info);

    let body: any;
    try { body = await req.clone().json(); }
    catch { return handler(req, info); }

    if (!body || body._sweep === true || bagClean(body._direct_message)) return handler(req, info);

    const original = bagClean(body.mensagem);
    const material = detectBagMaterial(original);
    if (material === null) return handler(req, info);

    const resposta = bagReply(material);
    if (body._dry_run === true) {
      return new Response(JSON.stringify({
        ok: true,
        respondeu: true,
        dry_run: true,
        tema: 'sacola_material',
        material,
        resposta,
        source_tag: 'joao_sacola_material_guard_v1',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    const direct = {
      ...body,
      _direct_message: resposta,
      _assinar_como: 'joao',
      _source_tag: 'joao_sacola_material_guard_v1',
    };
    delete direct._dry_run;

    return handler(new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(direct),
    }), info);
  };

  return (BAG_GUARD_PREV_SERVE as any)(...args);
};
