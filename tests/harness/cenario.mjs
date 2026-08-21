// Estado inicial de banco compartilhado pelos testes + RPCs oficiais mockadas.
// A precificacao continua vindo da RPC: o mock devolve o MESMO retorno que a
// fn_precificar_dtf_uv_v2 real devolveu no incidente para (50, 10x21).
import { criarBancoFake } from './fake_supabase.mjs';

export const TELEFONE = '5511999990001';
export const LEAD = 'lead-teste-0001';

// Retornos canonicos da fn_precificar_dtf_uv_v2, indexados por quantidade x medida.
// Nao ha formula aqui de proposito: o teste prova que o preco vem da RPC, entao a RPC
// falsa devolve valores fixos e observaveis.
const TABELA_UV_OFICIAL = {
  '50x10x21': { consumo_m: 5.15, preco_total: 437.75, degrau: 'acima_1m', unidade_cobranca: 'metro', cabem_por_metro: 10, cabem_ainda_no_material: 1 },
  '30x5x7':   { consumo_m: 0.424, preco_total: 40.37, degrau: 'folha_a3', unidade_cobranca: 'folha', cabem_por_metro: 72, cabem_ainda_no_material: 42 },
  '60x5x7':   { consumo_m: 0.85, preco_total: 78.40, degrau: 'acima_050m', unidade_cobranca: 'folha_mais_excedente', cabem_por_metro: 72, cabem_ainda_no_material: 12 },
};

export function precificarUvOficial(payload) {
  if (payload?.origem !== 'rendimento_adesivos') return { ok: false, erro: 'origem_nao_suportada_no_mock' };
  const { quantidade, largura_cm, altura_cm } = payload;
  const chave = `${Number(quantidade)}x${Number(largura_cm)}x${Number(altura_cm)}`;
  const linha = TABELA_UV_OFICIAL[chave] || TABELA_UV_OFICIAL[`${Number(quantidade)}x${Number(altura_cm)}x${Number(largura_cm)}`];
  if (!linha) return { ok: false, erro: 'combinacao_fora_do_mock' };
  return {
    ok: true, consumo_m: linha.consumo_m, unidade_cobranca: linha.unidade_cobranca,
    degrau: linha.degrau, preco_total: linha.preco_total, faixa_id: 'faixa-' + chave,
    precos_verbalizaveis: [{ tipo: 'total', centavos: Math.round(linha.preco_total * 100) }],
    display: { cabem_por_metro: linha.cabem_por_metro, cabem_ainda_no_material: linha.cabem_ainda_no_material },
  };
}

export function novoBanco({ inbounds = [], conversas = [], estado = null } = {}) {
  const dados = {
    inbound_fora_horario: inbounds,
    fact_conversations: conversas,
    agente_noturno_estado: estado ? [estado] : [],
    operacoes_financeiras: [],
    leads_marketing: [{ ph: TELEFONE, lead_id: LEAD }],
    sistema_config: [],
    catalogo_produtos: [],
    dtf_precos_faixa: [],
    arte_uploads: [],
    orcamentos: [],
    pixel_events: [],
    mp_pix_cobrancas: [],
    error_log: [],
    joao_envios: [],
    joao_slots_observacao: [],
    joao_tool_guard_shadow: [],
    agente_decisoes_log: [],
    anthropic_token_usage: [],
    agente_noturno_lock: [],
    dtf_uv_degraus: [],
    dtf_produto_config: [],
    vw_orcamento_calcme_vigente: [],
  };
  const rpcs = {
    fn_agente_pausado: () => ({ data: false, error: null }),
    fn_joao_adquirir_lock: () => ({ data: true, error: null }),
    fn_get_or_create_lead: () => ({ data: { ok: true, lead_id: LEAD }, error: null }),
    fn_contexto_comercial_do_lead: () => ({ data: { comportamento: 'iniciar_negociacao_nova', etapa: null }, error: null }),
    fn_contexto_aprendizados: () => ({ data: null, error: { message: 'sem_aprendizados_no_teste' } }),
    fn_log_prompt_manifesto_joao: () => ({ data: 1, error: null }),
    fn_registrar_decisao_agente: () => ({ data: 'dec-' + Math.floor(Math.random() * 1e6), error: null }),
    fn_valor_e_legitimo: () => ({ data: { legitimo: true }, error: null }),
    fn_precificar_dtf_uv_v2: (args) => ({ data: precificarUvOficial(args?.p_payload), error: null }),
    fn_emitir_operacao_financeira: (args) => ({
      data: {
        id: 'op-' + Math.floor(Math.random() * 1e9), kind: args.p_kind, amount: args.p_amount,
        currency: 'BRL', expires_at: new Date(Date.now() + 1800000).toISOString(), components: args.p_components,
      }, error: null,
    }),
  };
  return criarBancoFake({ dados, rpcs });
}

export function inbound({ id, texto, minutosAtras = 0, status = 'pendente', messageId = null }) {
  return {
    id, phone: TELEFONE, chat_name: 'Cliente Teste', status,
    created_at: new Date(Date.now() - minutosAtras * 60000).toISOString(),
    body: { text: { message: texto }, messageId: messageId || ('wa-' + id) },
  };
}
export function conversa({ texto, direction, source = 'joao', minutosAtras = 0 }) {
  return {
    phone: TELEFONE, direction, source, message_text: texto,
    timestamp: new Date(Date.now() - minutosAtras * 60000).toISOString(),
  };
}
