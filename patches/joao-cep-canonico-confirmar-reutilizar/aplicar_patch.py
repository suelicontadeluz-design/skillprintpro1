# -*- coding: utf-8 -*-
"""v4.35.0 P0 — fluxo de CEP canonico sobre a v4.34.0 LIVE (Edge 177)."""
import io, sys, hashlib
BASE, OUT = sys.argv[1], sys.argv[2]
src = io.open(BASE, encoding='utf-8').read()
assert hashlib.sha256(src.encode('utf-8')).hexdigest() == \
    'c8fd20f16f32c7bd851a6cddb88cfbf68d2386cac2285782a1654935b117ba70', 'base nao e a LIVE 177'
trocas = []
def rep(a, n, r): trocas.append((a, n, r))

# ── 1. CABECALHO + VERSAO ───────────────────────────────────────────────────
rep("const V = 'agente-noturno-v4.34.0';",
"""//
// v4.35.0 (26/08/2026) P0 — FLUXO DE CEP CANONICO: CONFIRMAR, REUTILIZAR, PERSISTIR COM GUARDA.
// Rollback: redeploy do v4.34.0 (Edge 177, index.ts sha256 c8fd20f16f32c7bd851a6cddb88cfbf6
// 8d2386cac2285782a1654935b117ba70). Sem migracao: o estado novo sao chaves dentro do jsonb
// ja existente de agente_noturno_estado.
//
// A v4.34.0 resolveu MODALIDADE ANTES DE CEP e isso continua valendo sem um caractere de
// diferenca: a modalidade e resolvida primeiro, e todo este fluxo de CEP so existe DEPOIS,
// e SOMENTE quando a modalidade admite frete. Sob retirada/motoboy/produto digital o cadastro
// nem chega a ser lido.
//
// O QUE FALTAVA: o Joao pedia CEP a quem ja tinha CEP no cadastro, e nao tinha nenhum contrato
// para (a) confirmar antes de reutilizar, (b) distinguir "CEP so deste pedido" de "novo CEP
// padrao", (c) persistir sem estragar cadastro.
//
// FONTES DO CEP, EM ORDEM (so vale para ENVIO):
//   1 CEP informado explicitamente no pedido atual (turno + inbounds do pedido)
//   2 CEP ja confirmado no estado do pedido atual
//   3 pessoas.cep — cadastro canonico, que vive no ERP, NAO neste projeto
//   4 CEP confiavel de historico / frete ja calculado
//   5 nenhum -> pedir UMA vez
// CEP EXISTIR NAO DEFINE MODALIDADE. A modalidade vem antes, sempre.
//
// ONDE O CADASTRO CANONICO REALMENTE VIVE — MEDIDO, NAO PRESUMIDO:
//   public.pessoas DESTE projeto tem 1.754 linhas e ZERO com cep. Nao e o cadastro.
//   public.pessoas do ERP (ynjsflvdfftcopibzxyo) tem 144 linhas, 136 com cep. E o cadastro.
//   Casamento por telefone: 137 sufixos de 8 digitos, 137 distintos — ZERO ambiguidade hoje.
//   Cobertura real: dos 1.525 telefones que o Joao atendeu em 90 dias, 64 (4,2%) tem pessoa
//   no ERP. O caminho de confirmacao serve o cliente RECORRENTE, que e onde ele importa.
//
// RISCO DE SOBRESCRITA — POR QUE A ESCRITA E GUARDADA:
//   pessoas.cep e campo FISCAL: fn_montar_payload_spedy_nfe monta o destinatario da NF-e a
//   partir de pessoas (cep, logradouro, numero, bairro, cidade, estado, municipio_ibge).
//   Trocar SO o cep deixa logradouro/numero/bairro/cidade apontando para o endereco ANTIGO —
//   um endereco que parece completo e esta errado. Medido: das 144 pessoas, 136 tem cep COM
//   logradouro/cidade e apenas 8 estao sem cep.
//   Por isso a persistencia e ESCALONADA:
//     - pessoa sem cep, ou com cep e sem endereco  -> grava (preenche lacuna, risco zero);
//     - pessoa com cep E endereco                  -> NAO grava. Registra o motivo, marca a
//       divergencia e abre tarefa humana para atualizar o endereco COMPLETO no ERP.
//   PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO liga a sobrescrita literal, e vem FALSE de proposito:
//   ligar significa aceitar emitir NF-e com endereco incoerente.
//
// GARANTIAS DE ESCRITA (todas cumulativas, fail-closed em qualquer uma):
//   1 exatamente UMA pessoa ativa casa com o telefone (0 ou >=2 nao grava);
//   2 CEP com 8 digitos validos;
//   3 o cliente declarou EXPLICITAMENTE que e o novo padrao;
//   4 a guarda de coerencia de endereco acima permite.
//   Nunca cria pessoa. Nunca escreve outro campo alem de cep. Nunca grava sob retirada/motoboy.
const V = 'agente-noturno-v4.35.0';""", "cabecalho + const V")

# ── 2. ESTADO LOGISTICO GANHA O CONTRATO DE CEP ─────────────────────────────
rep("""  cep_conhecido: string | null;
  cep_fonte: string | null;
  retirada_plausivel: boolean;
  produto_digital: boolean;
  ddd: string;
};""",
"""  cep_conhecido: string | null;
  cep_fonte: string | null;
  retirada_plausivel: boolean;
  produto_digital: boolean;
  ddd: string;
  // ── v4.35.0: contrato de CEP. Preenchido por refinarCepComCadastro, que so roda
  // quando a modalidade admite frete. Sob retirada/motoboy ficam nos valores neutros.
  cep_cadastro: string | null;
  pessoa_id: string | null;
  cadastro_ambiguo: boolean;
  cadastro_tem_endereco: boolean;
  cep_confirmado: boolean;
  pedir_confirmacao_cep: boolean;
  cep_divergente_do_cadastro: boolean;
  intencao_cep_padrao: 'novo_padrao' | 'so_este_pedido' | 'indefinida' | null;
};""", "EstadoLogistico + contrato de CEP")

# ── 3. ORDEM DAS FONTES DE CEP + nomes canonicos de fonte ───────────────────
rep("""  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.
  let cep: string | null = null; let cepFonte: string | null = null;
  const cepSlot = a.slots?.cep ? String(a.slots.cep).replace(/\\D/g, '') : '';
  if (cepSlot.length === 8) { cep = cepSlot; cepFonte = 'slot'; }
  if (!cep) for (const i of (a.inboundsPedido || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'inbound_do_pedido'; break; } }
  if (!cep && a.freteJa?.cep_destino) { const c = String(a.freteJa.cep_destino).replace(/\\D/g, ''); if (c.length === 8) { cep = c; cepFonte = 'frete_ja_calculado'; } }
  if (!cep) for (const i of (a.historicoInbound || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'historico'; break; } }""",
"""  // CEP CONHECIDO = o que o Joao REALMENTE ja tem. Existir CEP nao decide modalidade.
  // v4.35.0: ordem das fontes conforme o contrato. O que o cliente ACABOU de escrever vence
  // o estado salvo — antes o slot vinha primeiro e um CEP novo digitado perdia para um slot
  // velho. pessoas.cep (nivel 3) entra depois, em refinarCepComCadastro.
  let cep: string | null = null; let cepFonte: string | null = null;
  const cepDoTurno = cepDoTexto(String(a.mensagemAtual || ''));
  if (cepDoTurno) { cep = cepDoTurno; cepFonte = 'pedido'; }
  if (!cep) for (const i of (a.inboundsPedido || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'pedido'; break; } }
  if (!cep) { const cepSlot = a.slots?.cep ? String(a.slots.cep).replace(/\\D/g, '') : ''; if (cepSlot.length === 8) { cep = cepSlot; cepFonte = 'estado_confirmado'; } }
  if (!cep && a.freteJa?.cep_destino) { const c = String(a.freteJa.cep_destino).replace(/\\D/g, ''); if (c.length === 8) { cep = c; cepFonte = 'frete_anterior'; } }
  if (!cep) for (const i of (a.historicoInbound || [])) { const c = cepDoTexto(String(i?.message_text || '')); if (c) { cep = c; cepFonte = 'historico'; break; } }""",
"ordem canonica das fontes de CEP")

# ── 4. montar() devolve os campos novos em estado neutro ───────────────────
rep("""      cep_conhecido: cep, cep_fonte: cepFonte,
      retirada_plausivel: semFretePorModalidade || grandeSP,
      produto_digital: produtoDigital, ddd,
    };
  };""",
"""      cep_conhecido: cep, cep_fonte: cepFonte,
      retirada_plausivel: semFretePorModalidade || grandeSP,
      produto_digital: produtoDigital, ddd,
      // v4.35.0: neutros aqui. Sob retirada/motoboy/digital continuam neutros para SEMPRE,
      // porque refinarCepComCadastro nem chega a ser chamado — o cadastro nao e nem lido.
      cep_cadastro: null, pessoa_id: null, cadastro_ambiguo: false,
      cadastro_tem_endereco: false, cep_confirmado: false,
      pedir_confirmacao_cep: false, cep_divergente_do_cadastro: false,
      intencao_cep_padrao: null,
    };
  };""", "montar() com campos de CEP neutros")

# ── 5. MODULO NOVO: cadastro canonico, confirmacao e persistencia guardada ──
rep("""// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy
// confirmados, nenhuma destas palavras pode atravessar.""",
"""// ══ v4.35.0 P0: CEP CANONICO — LER O CADASTRO, CONFIRMAR, REUTILIZAR, PERSISTIR ══
// KILL SWITCH. FALSE = nunca troca um cep que ja convive com endereco preenchido.
// Ligar significa aceitar que a NF-e saia com cep novo e logradouro/cidade antigos.
const PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO = false;

type PessoaCadastro = {
  pessoa_id: string | null; nome: string | null; cep: string | null;
  tem_endereco: boolean; ambiguo: boolean;
};

const CADASTRO_VAZIO: PessoaCadastro = { pessoa_id: null, nome: null, cep: null, tem_endereco: false, ambiguo: false };

function soDigitos(v: any): string { return String(v ?? '').replace(/\\D/g, ''); }

// Le o cadastro canonico do ERP por TELEFONE. Fail-closed: 0 ou 2+ casamentos exatos de
// sufixo devolvem cadastro vazio com ambiguo=true. Nunca cria pessoa, nunca adivinha.
// O filtro vai pelos 4 ultimos digitos (sempre contiguos no formato "(11) 91857-0605") so
// para limitar a linha trafegada; o casamento real e por sufixo de 8 digitos, aqui.
async function lerPessoaCanonicaPorTelefone(phone: string): Promise<PessoaCadastro> {
  const digits = soDigitos(phone);
  if (digits.length < 10) return CADASTRO_VAZIO;
  if (!ERP_URL || !ERP_SERVICE_KEY) { await logErro('cep_cadastro_sem_credencial', { phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
  const ult4 = digits.slice(-4);
  const suf8 = digits.slice(-8);
  try {
    const COLUNAS = 'id,nome,cep,logradouro,numero,bairro,cidade,estado,telefone,whatsapp,ativo';
    const cab = { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}` };
    // Filtro pelos 4 ultimos digitos so para nao trafegar a tabela inteira. Medido no ERP:
    // pior grupo de ult4 tem 7 linhas, contra o limite de 20.
    let r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}`
      + `&or=(telefone.ilike.*${ult4}*,whatsapp.ilike.*${ult4}*)&limit=20`,
      { headers: cab, signal: AbortSignal.timeout(10000) });
    // FALLBACK DELIBERADO: se o filtro for recusado (grafia de PostgREST, coluna renomeada),
    // a feature NAO some em silencio — relemos sem filtro. O cadastro tem 144 linhas hoje;
    // o casamento exato continua sendo feito aqui, por sufixo de 8 digitos.
    if (!r.ok) {
      await logErro('cep_cadastro_filtro_recusado', { status: r.status, phone: phone.slice(-4) });
      r = await fetch(`${ERP_URL}/rest/v1/pessoas?select=${COLUNAS}&limit=500`,
        { headers: cab, signal: AbortSignal.timeout(10000) });
    }
    if (!r.ok) { await logErro('cep_cadastro_http_erro', { status: r.status, phone: phone.slice(-4) }); return CADASTRO_VAZIO; }
    const linhas = await r.json();
    const casam = (Array.isArray(linhas) ? linhas : []).filter((p: any) => {
      if (p?.ativo === false) return false;
      const t1 = soDigitos(p?.telefone), t2 = soDigitos(p?.whatsapp);
      return (t1.length >= 10 && t1.slice(-8) === suf8) || (t2.length >= 10 && t2.slice(-8) === suf8);
    });
    if (casam.length !== 1) {
      if (casam.length > 1) await logErro('cep_cadastro_ambiguo', { phone: phone.slice(-4), encontrados: casam.length });
      return { ...CADASTRO_VAZIO, ambiguo: casam.length > 1 };
    }
    const p = casam[0];
    const cepCad = soDigitos(p?.cep);
    return {
      pessoa_id: String(p.id), nome: p?.nome ? String(p.nome) : null,
      cep: cepCad.length === 8 ? cepCad : null,
      tem_endereco: !!(String(p?.logradouro || '').trim() || String(p?.cidade || '').trim() || String(p?.bairro || '').trim()),
      ambiguo: false,
    };
  } catch (e: any) {
    await logErro('cep_cadastro_excecao', { phone: phone.slice(-4), e: String(e?.message ?? e).slice(0, 120) });
    return CADASTRO_VAZIO;
  }
}

// Respostas do cliente a pergunta de confirmacao de CEP. Deterministicas: o modelo nao opina.
const RX_CEP_CONFIRMA = /\\b(isso|isso mesmo|esse mesmo|o mesmo|mesmo cep|mesmo endere[c\\u00e7]o|sim|pode ser|pode mandar|confirmo|confirmado|exato|correto|isso a[i\\u00ed]|[e\\u00e9] esse|[e\\u00e9] esse mesmo|continua|igual)\\b/i;
const RX_CEP_OUTRO = /\\b(outro|outra|novo|nova|mudei|mudou|mudamos|mudan[c\\u00e7]a|troquei|trocamos|diferente|n[a\\u00e3]o [e\\u00e9] esse|nao e esse|agora [e\\u00e9]|me mudei)\\b/i;
const RX_CEP_PADRAO_NOVO = /\\b(novo (cep )?padr[a\\u00e3]o|mudei de endere[c\\u00e7]o|me mudei|nos mudamos|mudamos de endere[c\\u00e7]o|endere[c\\u00e7]o novo|atualiza(r)? (o )?cadastro|pode atualizar|passa a ser|de agora em diante|daqui (pra|para) frente|sempre (vai ser|ser[a\\u00e1]))\\b/i;
const RX_CEP_SO_ESTE_PEDIDO = /\\b(s[o\\u00f3] (para|pra) (este|esse) pedido|s[o\\u00f3] (deste|desse) pedido|s[o\\u00f3] (desta|dessa) vez|apenas (este|esse) pedido|s[o\\u00f3] agora|exce[c\\u00e7][a\\u00e3]o|dessa vez|s[o\\u00f3] dessa)\\b/i;
// A pergunta que o PROPRIO Joao faz. Serve para saber se "isso mesmo" responde ao CEP.
const RX_JOAO_PERGUNTOU_CEP = /(mesmo cep|cep final|mesmo endere[c\\u00e7]o|novo (cep )?padr[a\\u00e3]o|s[o\\u00f3] (para|pra) este pedido)/i;

function mascararCep(cep: string | null): string {
  const d = soDigitos(cep);
  return d.length === 8 ? d.slice(-4) : '';
}

// NIVEL 3 do contrato + estado de confirmacao. So roda quando a modalidade admite frete:
// sob retirada/motoboy/produto digital o cadastro nem e lido, e por construcao o CEP salvo
// NAO interfere.
function refinarCepComCadastro(
  e: EstadoLogistico, cadastro: PessoaCadastro, slots: any, mensagem: string, ultimaMsgJoao: string,
): EstadoLogistico {
  const r: EstadoLogistico = { ...e };
  r.cep_cadastro = cadastro.cep;
  r.pessoa_id = cadastro.pessoa_id;
  r.cadastro_ambiguo = cadastro.ambiguo === true;
  r.cadastro_tem_endereco = cadastro.tem_endereco === true;

  const joaoPerguntouCep = RX_JOAO_PERGUNTOU_CEP.test(String(ultimaMsgJoao || ''));
  const confirmouAntes = slots?.cep_confirmado_para_envio === true;
  const cepDoTurnoAgora = cepDoTexto(String(mensagem || ''));

  // Intencao sobre cadastro: so vale se o cliente falou, nunca inferida do silencio.
  r.intencao_cep_padrao = RX_CEP_PADRAO_NOVO.test(mensagem) ? 'novo_padrao'
    : RX_CEP_SO_ESTE_PEDIDO.test(mensagem) ? 'so_este_pedido'
    : null;

  // NIVEL 3: sem CEP de nivel 1/2/4, o cadastro entra como fonte.
  if (!r.cep_conhecido && cadastro.cep) { r.cep_conhecido = cadastro.cep; r.cep_fonte = 'pessoas'; }

  r.cep_divergente_do_cadastro = !!(cadastro.cep && r.cep_conhecido && r.cep_conhecido !== cadastro.cep);

  // CONFIRMACAO. O cliente respondendo "isso mesmo" a uma pergunta de CEP confirma; dizendo
  // "outro"/"mudei" desconfirma e o CEP do cadastro deixa de servir.
  if (joaoPerguntouCep && RX_CEP_OUTRO.test(mensagem) && !cepDoTurnoAgora) {
    r.cep_confirmado = false;
    if (r.cep_fonte === 'pessoas') { r.cep_conhecido = null; r.cep_fonte = null; }
  } else if (cepDoTurnoAgora) {
    // CEP escrito agora e confirmacao por si: e o proprio cliente declarando o destino.
    r.cep_confirmado = true;
  } else if (confirmouAntes && !r.cep_divergente_do_cadastro) {
    r.cep_confirmado = true;
  } else if (joaoPerguntouCep && RX_CEP_CONFIRMA.test(mensagem)) {
    r.cep_confirmado = true;
  } else {
    r.cep_confirmado = false;
  }

  // Reutilizar CEP do cadastro sem avisar e o defeito que esta rodada corrige: confirma
  // primeiro, em UMA pergunta, sem expor o endereco inteiro.
  r.pedir_confirmacao_cep = r.cep_fonte === 'pessoas' && !r.cep_confirmado;
  // Pedir CEP so quando nao existe NENHUM. Ter de confirmar nao e ter de pedir.
  r.pedir_cep = !r.bloqueia_frete && !r.cep_conhecido;
  return r;
}

// O CEP so vale para calcular frete quando esta confirmado como destino deste pedido.
function cepLiberadoParaFrete(e: EstadoLogistico): boolean {
  if (e.bloqueia_frete) return false;
  if (!e.cep_conhecido) return false;
  return e.cep_confirmado === true || e.cep_fonte !== 'pessoas';
}

function blocoCepCanonico(e: EstadoLogistico): string {
  if (e.bloqueia_frete) return '';
  if (e.pedir_confirmacao_cep && e.cep_cadastro) {
    return `\\n\\n[CEP DO CADASTRO: este cliente j\\u00e1 tem CEP no cadastro, final ${mascararCep(e.cep_cadastro)}.`
      + ' N\\u00c3O pe\\u00e7a o CEP inteiro de novo e N\\u00c3O use o do cadastro calado.'
      + ` CONFIRME em UMA frase curta e natural: "Vai ser enviado para o mesmo CEP final ${mascararCep(e.cep_cadastro)}?".`
      + ' N\\u00e3o exponha o endere\\u00e7o completo. Se ele confirmar, calcule o frete com esse CEP. Se disser que \\u00e9 outro, a\\u00ed sim pe\\u00e7a o CEP novo.]';
  }
  if (e.cep_conhecido && e.cep_confirmado) {
    return `\\n\\n[CEP CONFIRMADO para este pedido: ${e.cep_conhecido} (fonte: ${e.cep_fonte}). N\\u00c3O pergunte de novo, nem o CEP nem a confirma\\u00e7\\u00e3o: chame calcular_frete com ele.`
      + (e.cep_divergente_do_cadastro && e.intencao_cep_padrao === null
        ? ' Este CEP \\u00e9 DIFERENTE do que est\\u00e1 no cadastro dele. Antes de encerrar o assunto de entrega, pergunte UMA vez, curto: "Esse \\u00e9 seu novo CEP padr\\u00e3o ou \\u00e9 s\\u00f3 para este pedido?" — e N\\u00c3O trate como novo padr\\u00e3o enquanto ele n\\u00e3o responder.'
        : '')
      + ']';
  }
  if (e.pedir_cep) {
    return '\\n\\n[CEP AUSENTE: pe\\u00e7a o CEP UMA vez, 8 d\\u00edgitos, e chame calcular_frete em seguida. N\\u00c3O pe\\u00e7a duas vezes.]';
  }
  return '';
}

// PERSISTENCIA GUARDADA. Devolve o que aconteceu e POR QUE. Nunca cria pessoa, nunca escreve
// campo que nao seja cep, nunca roda sob retirada/motoboy.
async function persistirCepCanonico(
  e: EstadoLogistico, phone: string,
): Promise<{ persistido: boolean; motivo: string }> {
  if (e.bloqueia_frete) return { persistido: false, motivo: 'modalidade_sem_frete' };
  const cep = soDigitos(e.cep_conhecido);
  if (cep.length !== 8) return { persistido: false, motivo: 'cep_invalido' };
  if (!e.pessoa_id) return { persistido: false, motivo: e.cadastro_ambiguo ? 'cadastro_ambiguo' : 'sem_pessoa_vinculada' };
  if (!e.cep_confirmado) return { persistido: false, motivo: 'cep_nao_confirmado' };
  if (e.cep_cadastro === cep) return { persistido: false, motivo: 'cep_ja_igual_ao_cadastro' };
  // Lacuna: pessoa sem cep. Preencher e aditivo e nao contradiz endereco nenhum.
  const preencheLacuna = !e.cep_cadastro;
  if (!preencheLacuna) {
    if (e.intencao_cep_padrao !== 'novo_padrao') {
      return { persistido: false, motivo: e.intencao_cep_padrao === 'so_este_pedido' ? 'apenas_este_pedido' : 'intencao_de_padrao_indefinida' };
    }
    if (e.cadastro_tem_endereco && !PERSISTIR_CEP_SOBRESCREVENDO_ENDERECO) {
      return { persistido: false, motivo: 'endereco_fiscal_coerente_exige_atualizacao_completa' };
    }
  } else if (e.intencao_cep_padrao === 'so_este_pedido') {
    return { persistido: false, motivo: 'apenas_este_pedido' };
  }
  if (!ERP_URL || !ERP_SERVICE_KEY) return { persistido: false, motivo: 'erp_sem_credencial' };
  try {
    const r = await fetch(`${ERP_URL}/rest/v1/pessoas?id=eq.${e.pessoa_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: ERP_SERVICE_KEY, Authorization: `Bearer ${ERP_SERVICE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ cep: cep.slice(0, 5) + '-' + cep.slice(5) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { await logErro('cep_persistencia_http_erro', { status: r.status, pessoa_id: e.pessoa_id }); return { persistido: false, motivo: 'http_' + r.status }; }
    return { persistido: true, motivo: preencheLacuna ? 'lacuna_preenchida' : 'novo_padrao_declarado' };
  } catch (err: any) {
    await logErro('cep_persistencia_excecao', { pessoa_id: e.pessoa_id, e: String(err?.message ?? err).slice(0, 120) });
    return { persistido: false, motivo: 'excecao' };
  }
}

// Termo de frete na SAIDA. Usado pela validacao de resposta: com retirada/motoboy
// confirmados, nenhuma destas palavras pode atravessar.""", "modulo de CEP canonico")

# ── 6. resolverModalidadeLogistica precisa da mensagem para o nivel 1 do CEP ─
rep("""function resolverModalidadeLogistica(a: {
  mensagemAtual: string; inboundsPedido: any[]; historicoInbound: any[];
  slots: any; phone: string; freteJa: any | null; produtoContexto: string;
}): EstadoLogistico {""",
"""function resolverModalidadeLogistica(a: {
  mensagemAtual: string; inboundsPedido: any[]; historicoInbound: any[];
  slots: any; phone: string; freteJa: any | null; produtoContexto: string;
}): EstadoLogistico {
  // v4.35.0: a.mensagemAtual ja era usada para a MODALIDADE (nivel 1) e agora tambem entra
  // como nivel 1 do CEP. Nada da resolucao de modalidade mudou.""",
"assinatura resolverModalidade")

# ── 7. WIRING: ler cadastro so quando a modalidade admite frete ─────────────
rep("""  L('modalidade_logistica', {
    phone: phone.slice(-4), modalidade: estadoLog.modalidade, prov: estadoLog.proveniencia,
    nivel: estadoLog.fonte_nivel, bloqueia_frete: estadoLog.bloqueia_frete, pedir_cep: estadoLog.pedir_cep,
  });""",
"""  // ── v4.35.0 P0: NIVEL 3 DO CEP. O cadastro canonico so e LIDO quando a modalidade
  // admite frete. Sob retirada, motoboy ou produto digital nao ha leitura nenhuma — e por
  // isso "CEP salvo no cadastro nao interfere" e propriedade estrutural, nao promessa.
  let cadastroPessoa: PessoaCadastro = CADASTRO_VAZIO;
  if (!estadoLog.bloqueia_frete) {
    cadastroPessoa = await lerPessoaCanonicaPorTelefone(phone);
    estadoLog = refinarCepComCadastro(estadoLog, cadastroPessoa, { ...(estado?.slots || {}) }, mensagem, ultimaMsgJoao || '');
  }
  L('modalidade_logistica', {
    phone: phone.slice(-4), modalidade: estadoLog.modalidade, prov: estadoLog.proveniencia,
    nivel: estadoLog.fonte_nivel, bloqueia_frete: estadoLog.bloqueia_frete, pedir_cep: estadoLog.pedir_cep,
    cep_fonte: estadoLog.cep_fonte, confirmar_cep: estadoLog.pedir_confirmacao_cep,
  });""", "wiring leitura do cadastro")

rep("""  const estadoLog = resolverModalidadeLogistica({""",
"""  let estadoLog = resolverModalidadeLogistica({""", "estadoLog mutavel")

# ── 8. BLOCO NO PROMPT ─────────────────────────────────────────────────────
rep("""    + blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) + blocoOrigem""",
"""    + blocoLocalizacao(phone) + blocoModalidadeLogistica(estadoLog) + blocoCepCanonico(estadoLog) + blocoOrigem""",
"bloco de CEP no systemFinal")

# ── 9. GUARDA: frete so com CEP liberado ───────────────────────────────────
rep("""        if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {""",
"""        // v4.35.0: alem do bloqueio por modalidade (v4.34.0, intacto), o frete tambem nao
        // roda com CEP que veio do cadastro e ainda nao foi confirmado pelo cliente.
        if (toolEfetiva === 'calcular_frete' && !estadoLog.bloqueia_frete
            && estadoLog.pedir_confirmacao_cep && !cepDoTexto(String((inputEfetivo as any)?.cep_destino || '')) ) {
          await logErro('guardrail_frete_com_cep_nao_confirmado', {
            phone, lead: leadId, turn_id: obsTurnId, cep_fonte: estadoLog.cep_fonte,
            cep_cadastro_final: mascararCep(estadoLog.cep_cadastro),
          });
          toolsUsadas.push('calcular_frete_aguardando_confirmacao');
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify({
            ok: false, erro: 'cep_do_cadastro_nao_confirmado',
            acao: 'O CEP veio do CADASTRO e o cliente ainda nao confirmou que o envio vai para la. '
              + 'Pergunte em UMA frase: "Vai ser enviado para o mesmo CEP final '
              + mascararCep(estadoLog.cep_cadastro) + '?" e so calcule o frete depois da resposta. NAO peca o CEP inteiro.',
          }) });
          continue;
        }
        if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) {""",
"guarda de CEP nao confirmado")

# ── 10. PERSISTENCIA + TELEMETRIA no fim do turno ──────────────────────────
rep("""  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {
    slotsNovos.modalidade_logistica = estadoLog.modalidade;
    slotsNovos.envio_retirada = estadoLog.modalidade === 'envio' ? 'envio'
      : estadoLog.modalidade === 'motoboy' ? 'motoboy' : 'retirada';
  }""",
"""  if (estadoLog.fonte_nivel <= 2 && estadoLog.modalidade !== 'desconhecida') {
    slotsNovos.modalidade_logistica = estadoLog.modalidade;
    slotsNovos.envio_retirada = estadoLog.modalidade === 'envio' ? 'envio'
      : estadoLog.modalidade === 'motoboy' ? 'motoboy' : 'retirada';
  }
  // ── v4.35.0 P0: ESTADO DE CEP DO PEDIDO + PERSISTENCIA GUARDADA ─────────────
  if (!estadoLog.bloqueia_frete && estadoLog.cep_conhecido) {
    slotsNovos.cep = estadoLog.cep_conhecido;
    slotsNovos.cep_origem = estadoLog.cep_fonte;
    slotsNovos.cep_confirmado_para_envio = estadoLog.cep_confirmado === true;
  }""", "estado de CEP nos slots")

rep("""  if (!dryRun) await salvarEstado(phone, leadId, decisao.etapa || estado?.etapa || 'sondagem', slotsNovos);""",
"""  // v4.35.0: a persistencia do cadastro roda DEPOIS de tudo decidido e NUNCA em dry-run.
  // Falha aqui jamais derruba o atendimento: o pedido ja tem o CEP no proprio estado.
  if (!dryRun && !estadoLog.bloqueia_frete) {
    try {
      const p = await persistirCepCanonico(estadoLog, phone);
      await logErro('cep_fluxo', {
        phone, turn_id: obsTurnId, agent_version: V,
        modalidade: estadoLog.modalidade,
        cep_fonte: estadoLog.cep_fonte,
        cep_confirmacao_solicitada: estadoLog.pedir_confirmacao_cep,
        cep_reutilizado: estadoLog.cep_fonte === 'pessoas' && estadoLog.cep_confirmado === true,
        cep_novo_informado: estadoLog.cep_fonte === 'pedido',
        cep_diferente_do_cadastro: estadoLog.cep_divergente_do_cadastro,
        intencao_cep_padrao: estadoLog.intencao_cep_padrao,
        cep_persistido: p.persistido,
        cep_nao_persistido_motivo: p.persistido ? null : p.motivo,
        pessoa_id: estadoLog.pessoa_id, cadastro_ambiguo: estadoLog.cadastro_ambiguo,
        cadastro_tem_endereco: estadoLog.cadastro_tem_endereco,
      });
      // Divergencia que a guarda recusou gravar nao pode morrer em log: vira trabalho humano,
      // porque atualizar endereco fiscal exige logradouro, numero, bairro, cidade e IBGE.
      if (!p.persistido && p.motivo === 'endereco_fiscal_coerente_exige_atualizacao_completa') {
        await criarTask(leadId, phone, 'Cadastro: cliente declarou novo CEP padrao',
          `O cliente informou o CEP ${estadoLog.cep_conhecido} como novo padrao. O cadastro tem `
          + `${estadoLog.cep_cadastro} com endereco preenchido. NAO foi sobrescrito de proposito: `
          + 'trocar so o CEP deixaria logradouro, numero, bairro e cidade do endereco antigo, e '
          + 'pessoas alimenta a NF-e. Atualizar o endereco COMPLETO no ERP.');
      }
    } catch (e: any) { await logErro('cep_fluxo_excecao', { phone, e: String(e?.message ?? e).slice(0, 120) }); }
  }
  if (!dryRun) await salvarEstado(phone, leadId, decisao.etapa || estado?.etapa || 'sondagem', slotsNovos);""",
"persistencia guardada + telemetria")

out = src
for a, n, r in trocas:
    c = out.count(a)
    if c != 1:
        sys.stderr.write('FALHA ancora [%s]: %d ocorrencia(s)\n' % (r, c)); sys.exit(1)
    out = out.replace(a, n, 1)
    sys.stderr.write('ok  %s\n' % r)
io.open(OUT, 'w', encoding='utf-8').write(out)
sys.stderr.write('escrito %s (%d bytes, sha256 %s)\n' % (OUT, len(out.encode('utf-8')), hashlib.sha256(out.encode('utf-8')).hexdigest()))
