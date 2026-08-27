// ============================================================================
// HARNESS DE PROVA — v4.34.0 (modalidade logistica antes do CEP).
// O nucleo de decisao e IMPORTADO VERBATIM de candidato/index.ts via
// provas/modalidade_gerado.ts. Aqui so existe (a) o mundo mocado e (b) a
// replica fiel dos TRES sitios de aplicacao, cujas condicoes booleanas sao
// copiadas linha a linha do candidato e conferidas por invariante estrutural
// em testes_modalidade.ts (checarInvariantesEstruturais).
// ============================================================================
import {
  resolverModalidadeLogistica, blocoModalidadeLogistica, perguntaDoQueFaltaFechamento,
  removerSentencasComTermo, RX_SAIDA_TERMO_FRETE, classificarDeclaracaoLogistica,
} from './modalidade_gerado.js';
import type { EstadoLogistico } from './modalidade_gerado.js';

export let ERROS: any[] = [];
export function resetErros() { ERROS = []; }
async function logErro(msg: string, payload: any) { ERROS.push({ msg, payload }); }

export type Turno = {
  phone: string;
  mensagem: string;
  inboundsPedido?: Array<{ message_text: string }>;
  historicoInbound?: Array<{ message_text: string }>;
  slots?: any;
  freteJa?: any;
  produtoContexto?: string;
};

export function resolver(t: Turno): EstadoLogistico {
  return resolverModalidadeLogistica({
    mensagemAtual: t.mensagem,
    inboundsPedido: t.inboundsPedido || [],
    historicoInbound: t.historicoInbound || [],
    slots: t.slots || {},
    phone: t.phone,
    freteJa: t.freteJa || null,
    produtoContexto: t.produtoContexto || '',
  });
}

// ── SITIO 1: interceptacao de calcular_frete dentro do laco de tools ────────
// Replica da condicao do candidato:
//   if (toolEfetiva === 'calcular_frete' && estadoLog.bloqueia_frete) { ...; continue; }
export async function simularLacoDeTools(e: EstadoLogistico, chamadas: Array<{ name: string; input?: any }>) {
  const toolsUsadas: string[] = [];
  const executadas: string[] = [];
  const resultados: any[] = [];
  for (const tu of chamadas) {
    const toolEfetiva = tu.name;
    if (toolEfetiva === 'calcular_frete' && e.bloqueia_frete) {
      await logErro('guardrail_frete_bloqueado_modalidade', {
        modalidade: e.modalidade, proveniencia: e.proveniencia,
        fonte_nivel: e.fonte_nivel, motivo: e.motivo_bloqueio, evidencia: e.evidencia,
        cep_tentado: String(tu.input?.cep_destino || '').slice(0, 12),
      });
      toolsUsadas.push('calcular_frete_bloqueado');
      resultados.push({ ok: false, erro: 'frete_incompativel_com_modalidade', modalidade_logistica: e.modalidade });
      continue;
    }
    executadas.push(toolEfetiva);
    toolsUsadas.push(toolEfetiva);
    resultados.push({ ok: true, tool: toolEfetiva });
  }
  return { toolsUsadas, executadas, resultados };
}

// ── SITIO 2: validacao de saida (CEP / PAC / Sedex / Correios) ──────────────
// Replica do bloco do candidato. `retry` mocka chamarCerebro: devolve null quando
// o modelo nao consegue produzir alternativa valida.
export async function simularValidacaoDeSaida(
  e: EstadoLogistico, respostaEntrada: string,
  retry?: (nudge: string) => { responde: boolean; mensagem: string } | null,
) {
  const RX_MOEDA = /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})|(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s?reais/gi;
  const valoresDaMensagem = (msg: string): number[] => {
    const out: number[] = []; let m: RegExpExecArray | null;
    const rx = new RegExp(RX_MOEDA.source, 'gi');
    while ((m = rx.exec(msg)) !== null) {
      const bruto = m[1] || m[2];
      if (bruto) out.push(Math.round(Number(bruto.replace(/\./g, '').replace(',', '.')) * 100));
    }
    return out;
  };
  let resposta = respostaEntrada;
  let desfechoLog = 'nao_acionado';
  if (e.bloqueia_frete && RX_SAIDA_TERMO_FRETE.test(resposta)) {
    const respostaOriginalLog = resposta;
    const valoresAntesLog = valoresDaMensagem(respostaOriginalLog);
    await logErro('guardrail_cep_ou_correios_sem_frete', {
      modalidade: e.modalidade, proveniencia: e.proveniencia, motivo: e.motivo_bloqueio,
      resposta: respostaOriginalLog.slice(0, 300),
    });
    desfechoLog = 'rejeitado';
    const d = retry ? retry('nudge') : null;
    if (d) {
      const rcep = d.mensagem;
      const valoresDepoisLog = valoresDaMensagem(rcep);
      const perdeuValorLog = valoresAntesLog.some((v: number) => !valoresDepoisLog.includes(v));
      if (d.responde === true && !RX_SAIDA_TERMO_FRETE.test(rcep) && !perdeuValorLog) {
        resposta = rcep; desfechoLog = 'aceito';
      }
    }
    if (desfechoLog !== 'aceito') {
      const podado = removerSentencasComTermo(respostaOriginalLog, RX_SAIDA_TERMO_FRETE);
      if (podado.length >= 8 && !RX_SAIDA_TERMO_FRETE.test(podado)) {
        resposta = podado; desfechoLog = 'preservado_cirurgia';
      } else {
        resposta = e.produto_digital
          ? 'O arquivo é digital e vai por link aqui no WhatsApp, sem frete. Pix ou cartão?'
          : e.modalidade === 'motoboy'
            ? 'Combinado, o motoboy retira aqui em Embu e não tem frete. Pix ou cartão?'
            : e.modalidade === 'retirada'
              ? 'Combinado, fica retirada aqui em Embu e não tem frete. Pix ou cartão?'
              : 'Você prefere retirar aqui em Embu ou receber por envio?';
        desfechoLog = 'substituido_deterministico';
      }
    }
    await logErro('guardrail_cep_ou_correios_desfecho', {
      modalidade: e.modalidade, resultado: desfechoLog,
      valores_antes: valoresAntesLog, valores_depois: valoresDaMensagem(resposta),
    });
  }
  return { resposta, desfecho: desfechoLog };
}

// ── SITIO 3: fallback terminal do fechamento ───────────────────────────────
export function simularFallbackTerminal(e: EstadoLogistico, slots: any): string {
  return perguntaDoQueFaltaFechamento(e, slots);
}

export { blocoModalidadeLogistica, classificarDeclaracaoLogistica, RX_SAIDA_TERMO_FRETE };
