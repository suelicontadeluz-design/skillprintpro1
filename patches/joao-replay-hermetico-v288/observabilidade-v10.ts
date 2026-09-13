// João replay hermético v288 — observabilidade de produto v10 — 13/09/2026
//
// Entregas E1 e E3 do briefing de 13/09.
//
// ESCOPO DECLARADO: este módulo **observa**. Ele não resolve, não promove e não
// corrige produto. A promoção determinística de produto é o Candidate A e não
// entra aqui. Tudo o que este arquivo faz é ler o que a execução já produziu
// (resposta do handler, tentativa de escrita no estado, palco congelado, saída
// do modelo) e classificar a ORIGEM daquilo, num vocabulário fechado.
//
// Nada aqui toca `globalThis.fetch` nem `Deno.serve`: é uma função pura sobre
// evidências que o harness já coletava. É por isso que não é o 38º remendo.
//
// O módulo não importa nada — nem Deno, nem rede — de propósito: ele roda
// igual dentro da edge e dentro de `node --test`.

// ───────────────────────────── vocabulário fechado ─────────────────────────────

/** As únicas fontes que o harness pode registrar. Qualquer outra coisa é bug. */
export const FONTES_PRODUTO = [
  'mensagem_cliente',
  'estado_anterior',
  'canonico',
  'anuncio',
  'modelo',
  'nenhuma',
] as const;
export type FonteProduto = (typeof FONTES_PRODUTO)[number];

/** Guards do núcleo v288 que encerram o turno ANTES de qualquer chamada ao modelo. */
export const GUARDS_INTERRUPTORES = ['cliente_comprador', 'agente_pausado', 'sem_conteudo'] as const;
export type GuardInterruptor = (typeof GUARDS_INTERRUPTORES)[number];

/** `produto_macro` que o banco já conhece (replay_caso, joao_slots_observacao, pixel_events). */
export const MACROS_CONHECIDOS = ['dtf_textil', 'dtf_uv', 'camiseta', 'copo', 'pack'] as const;

// Termos de EVIDÊNCIA, não de decisão: servem só para responder "este texto menciona
// o produto que já foi resolvido?". Não escolhem produto nenhum.
const TERMOS_EVIDENCIA: Record<string, string[]> = {
  dtf_textil: ['dtf textil', 'dtf têxtil', 'dtf_textil', 'dtf para tecido', 'dtf tecido', 'dtf de camiseta'],
  dtf_uv: ['dtf uv', 'dtf_uv', 'dtfuv', 'adesivo uv', 'uv dtf'],
  camiseta: ['camiseta', 'camisetas', 'baby look', 'babylook', 'blusa'],
  copo: ['copo', 'copos', 'caneca'],
  pack: ['pack', 'packs'],
};

// ───────────────────────────── tipos ─────────────────────────────

export type OrigemLeituraSlot =
  | 'escrita_estado_tentada'   // o que o núcleo TENTARIA gravar em agente_noturno_estado
  | 'resposta_handler'         // slots devolvidos pelo handler
  | 'palco_estado_anterior'    // nada mudou: o valor é o que já estava no palco
  | 'ausente';

export type Conhecimento = 'promovido_ao_estado' | 'apenas_conhecido';

export interface EvidenciaProduto {
  fonte: FonteProduto;
  encontrada: boolean;
  detalhe: string | null;
}

export interface CandidatoSlots {
  produto: string | null;
  produto_macro: string | null;
  macro_origem: 'explicito' | 'igual_ao_produto' | 'ausente';
  origem_leitura: OrigemLeituraSlot;
  slots_completos: Record<string, unknown> | null;
}

export interface ProvenienciaProduto {
  produto: string | null;
  produto_macro: string | null;
  fonte: FonteProduto;
  fonte_detalhe: string | null;
  promovido: boolean;
  conhecimento: Conhecimento;
  evidencias: EvidenciaProduto[];
  /** true quando há produto_macro mas nenhuma fonte identificável. Força INCONCLUSIVE. */
  macro_sem_fonte: boolean;
}

export interface ObservacaoExecucao {
  candidato_slots: CandidatoSlots;
  proveniencia: ProvenienciaProduto;
  chegou_ao_modelo: boolean;
  guard_interruptor: GuardInterruptor | null;
  model_call_count: number;
  /** Incoerências entre os sinais (ex.: guard disparou E o modelo foi chamado). */
  inconsistencias: string[];
}

export interface EntradaObservacao {
  /** Texto do inbound do caso. */
  mensagem_cliente: string;
  /** `palco.estado` inteiro (tabelas congeladas → linhas). */
  palco_estado: Record<string, any[]> | null | undefined;
  /** JSON devolvido pelo handler de produção. */
  resposta_json: any;
  /** Textos crus que vieram do modelo (só `content[].text`; nunca o prompt). */
  textos_modelo: string[];
  /** Payloads de escrita em `agente_noturno_estado` que a jaula bloqueou. */
  escritas_estado_tentadas: any[];
  /** Quantas vezes /v1/messages foi chamado nesta execução. */
  model_calls: number;
}

// ───────────────────────────── utilitários ─────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function normalizar(v: unknown): string {
  return txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Só compara: não deduz produto a partir de texto livre. */
function mencionaProduto(texto: string, produto: string | null, macro: string | null): string | null {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  for (const chave of [produto, macro]) {
    if (!chave) continue;
    const slug = normalizar(chave);
    if (slug && alvo.includes(slug)) return slug;
    for (const termo of TERMOS_EVIDENCIA[slug] ?? []) {
      if (alvo.includes(normalizar(termo))) return termo;
    }
  }
  return null;
}

function primeiraLinha(palco: Record<string, any[]> | null | undefined, tabela: string): any {
  const linhas = palco?.[tabela];
  return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
}

function objeto(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

/** Extrai {produto, produto_macro} de um objeto de slots, sem inferir nada. */
function lerSlots(slots: unknown): { produto: string | null; produto_macro: string | null } {
  const o = objeto(slots);
  if (!o) return { produto: null, produto_macro: null };
  const produto = txt(o.produto).trim() || null;
  const macro = txt(o.produto_macro).trim() || null;
  return { produto, produto_macro: macro };
}

// ───────────────────────────── E3: guard × modelo ─────────────────────────────

/**
 * Separa "o modelo decidiu" de "um guard interrompeu".
 * O núcleo v288 encerra o turno devolvendo `{"ok":true,"skip":"<guard>"}` — é esse
 * campo, e só ele, que vira `guard_interruptor`.
 */
export function lerGuard(respostaJson: any): GuardInterruptor | null {
  const skip = txt(objeto(respostaJson)?.skip).trim();
  return (GUARDS_INTERRUPTORES as readonly string[]).includes(skip) ? (skip as GuardInterruptor) : null;
}

// ───────────────────────────── E1: slots resolvidos ─────────────────────────────

/**
 * Slots ao FIM do turno, na ordem em que o harness consegue enxergá-los:
 *  1. o que o núcleo tentou gravar em `agente_noturno_estado` (a jaula bloqueou a escrita,
 *     mas o payload é exatamente o estado final que produção teria);
 *  2. os slots devolvidos na resposta;
 *  3. o estado anterior do palco, quando o turno não mexeu em nada.
 */
export function lerCandidatoSlots(e: EntradaObservacao): CandidatoSlots {
  const candidatos: Array<{ origem: OrigemLeituraSlot; slots: unknown }> = [];

  for (const payload of e.escritas_estado_tentadas ?? []) {
    const linha = Array.isArray(payload) ? payload[0] : payload;
    const slots = objeto(linha)?.slots;
    if (objeto(slots)) candidatos.push({ origem: 'escrita_estado_tentada', slots });
  }

  const r = objeto(e.resposta_json);
  if (objeto(r?.slots)) candidatos.push({ origem: 'resposta_handler', slots: r!.slots });

  const estado = primeiraLinha(e.palco_estado, 'agente_noturno_estado');
  if (objeto(estado?.slots)) candidatos.push({ origem: 'palco_estado_anterior', slots: estado.slots });

  const escolhido = candidatos.find((c) => {
    const { produto, produto_macro } = lerSlots(c.slots);
    return !!(produto || produto_macro);
  }) ?? candidatos[0];

  if (!escolhido) {
    return { produto: null, produto_macro: null, macro_origem: 'ausente', origem_leitura: 'ausente', slots_completos: null };
  }

  const { produto, produto_macro } = lerSlots(escolhido.slots);

  // `produto_macro` explícito ganha. Na falta dele, o macro só é preenchido quando o
  // próprio `produto` JÁ É um slug de macro conhecido — igualdade exata, sem inferência.
  let macro = produto_macro;
  let macroOrigem: CandidatoSlots['macro_origem'] = produto_macro ? 'explicito' : 'ausente';
  if (!macro && produto && (MACROS_CONHECIDOS as readonly string[]).includes(produto)) {
    macro = produto;
    macroOrigem = 'igual_ao_produto';
  }

  return {
    produto,
    produto_macro: macro,
    macro_origem: macroOrigem,
    origem_leitura: escolhido.origem,
    slots_completos: objeto(escolhido.slots),
  };
}

// ───────────────────────────── E1: proveniência ─────────────────────────────

/**
 * Qual fonte ORIGINOU o produto. Escada determinística, primeira que casa vence.
 * A ordem é a do briefing e reflete precedência causal: o que já estava no estado
 * não foi originado neste turno; o que o cliente escreveu vence catálogo e anúncio;
 * o modelo só leva o crédito quando nenhuma evidência externa existe.
 */
export function classificarProveniencia(e: EntradaObservacao, slots: CandidatoSlots): ProvenienciaProduto {
  const { produto, produto_macro } = slots;
  const evidencias: EvidenciaProduto[] = [];
  const registrar = (fonte: FonteProduto, detalhe: string | null): boolean => {
    evidencias.push({ fonte, encontrada: !!detalhe, detalhe });
    return !!detalhe;
  };

  if (!produto && !produto_macro) {
    return {
      produto: null, produto_macro: null, fonte: 'nenhuma', fonte_detalhe: null,
      promovido: false, conhecimento: 'apenas_conhecido', evidencias: [], macro_sem_fonte: false,
    };
  }

  // 1. estado_anterior — o valor já estava no palco antes do turno.
  const estadoAnterior = lerSlots(primeiraLinha(e.palco_estado, 'agente_noturno_estado')?.slots);
  const bateEstado =
    (produto && estadoAnterior.produto === produto) ||
    (produto_macro && estadoAnterior.produto_macro === produto_macro) ||
    (produto_macro && estadoAnterior.produto === produto_macro);
  const evEstado = bateEstado
    ? `agente_noturno_estado.slots.produto=${estadoAnterior.produto ?? estadoAnterior.produto_macro}`
    : null;

  // 2. mensagem_cliente — o inbound deste turno menciona o produto resolvido.
  const evMensagem = mencionaProduto(e.mensagem_cliente, produto, produto_macro);

  // 3. anuncio — pixel_events/leads_marketing do palco carimbam o produto.
  let evAnuncio: string | null = null;
  for (const ev of e.palco_estado?.pixel_events ?? []) {
    for (const campo of ['familia_slug', 'product_type', 'content_category'] as const) {
      const valor = txt(ev?.[campo]).trim();
      if (!valor) continue;
      if (valor === produto || valor === produto_macro) { evAnuncio = `pixel_events.${campo}=${valor}`; break; }
    }
    if (evAnuncio) break;
  }
  if (!evAnuncio) {
    for (const lead of e.palco_estado?.leads_marketing ?? []) {
      for (const campo of ['produto_interesse', 'familia_slug', 'produto', 'campanha'] as const) {
        const valor = txt((lead as any)?.[campo]).trim();
        if (valor && (valor === produto || valor === produto_macro)) {
          evAnuncio = `leads_marketing.${campo}=${valor}`; break;
        }
      }
      if (evAnuncio) break;
    }
  }

  // 4. canonico — o slug existe no catálogo congelado.
  let evCanonico: string | null = null;
  for (const item of e.palco_estado?.catalogo_produtos ?? []) {
    for (const campo of ['slug', 'produto_macro', 'familia_slug', 'codigo'] as const) {
      const valor = txt((item as any)?.[campo]).trim();
      if (valor && (valor === produto || valor === produto_macro)) {
        evCanonico = `catalogo_produtos.${campo}=${valor}`; break;
      }
    }
    if (evCanonico) break;
  }

  // 5. modelo — só o texto devolvido pelo modelo menciona o produto.
  let evModelo: string | null = null;
  for (const t of e.textos_modelo ?? []) {
    const achou = mencionaProduto(t, produto, produto_macro);
    if (achou) { evModelo = `resposta_do_modelo:"${achou}"`; break; }
  }

  const ordem: Array<[FonteProduto, string | null]> = [
    ['estado_anterior', evEstado],
    ['mensagem_cliente', evMensagem ? `inbound:"${evMensagem}"` : null],
    ['anuncio', evAnuncio],
    ['canonico', evCanonico],
    ['modelo', evModelo],
  ];

  let fonte: FonteProduto = 'nenhuma';
  let detalhe: string | null = null;
  for (const [f, d] of ordem) {
    const casou = registrar(f, d);
    if (casou && fonte === 'nenhuma') { fonte = f; detalhe = d; }
  }

  // promovido: houve tentativa de gravar ESTE produto em agente_noturno_estado.
  const promovido = (e.escritas_estado_tentadas ?? []).some((payload) => {
    const linha = Array.isArray(payload) ? payload[0] : payload;
    const s = lerSlots(objeto(linha)?.slots);
    return (!!produto && s.produto === produto) || (!!produto_macro && s.produto_macro === produto_macro);
  });

  return {
    produto,
    produto_macro,
    fonte,
    fonte_detalhe: detalhe,
    promovido,
    conhecimento: promovido ? 'promovido_ao_estado' : 'apenas_conhecido',
    evidencias,
    macro_sem_fonte: !!produto_macro && fonte === 'nenhuma',
  };
}

// ───────────────────────────── regra dura do Alessandro ─────────────────────────────

export type Veredito = 'MELHOROU' | 'EQUIVALENTE' | 'REGREDIU' | 'INDETERMINADO' | 'INCONCLUSIVE';

export interface ResultadoVeredito {
  veredito: Veredito;
  pass: boolean;
  motivo: string;
  regra_aplicada: 'produto_macro_sem_fonte' | 'nenhuma';
}

/**
 * `produto_macro` preenchido sem fonte identificável ⇒ INCONCLUSIVE. Nunca PASS.
 *
 * Está aqui, no harness, e não no julgamento humano: quem chama não tem como
 * devolver PASS por engano, porque o PASS é recalculado depois da regra.
 */
export function aplicarRegraProduto(
  vereditoBase: Veredito | string | null,
  passBase: boolean,
  proveniencia: Pick<ProvenienciaProduto, 'produto_macro' | 'fonte'>,
): ResultadoVeredito {
  const macro = txt(proveniencia?.produto_macro).trim();
  const fonte = txt(proveniencia?.fonte).trim();
  const fonteIdentificavel = !!fonte && fonte !== 'nenhuma' && (FONTES_PRODUTO as readonly string[]).includes(fonte);

  if (macro && !fonteIdentificavel) {
    return {
      veredito: 'INCONCLUSIVE',
      pass: false,
      motivo: `produto_macro=${macro} sem fonte identificável (fonte=${fonte || 'ausente'}). ` +
        'Aceite de produto é inmensurável nesta execução: INCONCLUSIVE, nunca PASS.',
      regra_aplicada: 'produto_macro_sem_fonte',
    };
  }

  const base = txt(vereditoBase).trim() || 'INDETERMINADO';
  return {
    veredito: base as Veredito,
    pass: !!passBase,
    motivo: 'Regra de proveniência de produto não se aplica.',
    regra_aplicada: 'nenhuma',
  };
}

// ───────────────────────────── composição ─────────────────────────────

export function observarExecucao(e: EntradaObservacao): ObservacaoExecucao {
  const candidato_slots = lerCandidatoSlots(e);
  const proveniencia = classificarProveniencia(e, candidato_slots);
  const guard = lerGuard(e.resposta_json);
  const model_call_count = Number.isFinite(e.model_calls) ? Number(e.model_calls) : 0;
  const chegou_ao_modelo = model_call_count > 0;

  const inconsistencias: string[] = [];
  if (guard && chegou_ao_modelo) inconsistencias.push(`guard_${guard}_com_${model_call_count}_chamadas_ao_modelo`);
  if (!guard && !chegou_ao_modelo) inconsistencias.push('sem_guard_e_sem_chamada_ao_modelo');
  if (proveniencia.macro_sem_fonte) inconsistencias.push('produto_macro_sem_fonte');

  return { candidato_slots, proveniencia, chegou_ao_modelo, guard_interruptor: guard, model_call_count, inconsistencias };
}
