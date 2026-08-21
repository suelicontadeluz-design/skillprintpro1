// ══ ESCOPO DO PATCH E INTEGRIDADE DO ROLLBACK ═══════════════════════════
// Prova mecanica de que o patch e minimo e de que o artefato de rollback
// continua byte-exato. Nada aqui depende de julgamento humano.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', RAIZ, ...args], { encoding: 'utf8' });

const ROLLBACK = '.frentes/aprendizados-teto-descarte-total/v166_original_ROLLBACK.index.ts';
const ALVO = 'supabase/functions/agente-noturno/index.ts';

// Commit de onde esta frente partiu: HEAD da branch do PR #2, que carrega o v166
// original preservado + o hunk independente do manifesto. Fixo de proposito: o teste
// mede o patch contra o baseline provado, nao contra o ultimo commit.
const BASE = 'a671529d36f946a723563ba6dcdb6b981feab441';

function arquivosTocados() {
  const doDiff = git('diff', '--name-only', BASE).split('\n').map((l) => l.trim()).filter(Boolean);
  const naoRastreados = git('status', '--porcelain')
    .split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
  return [...new Set([...doDiff, ...naoRastreados])];
}

const SHA_V166 = '6c3c90bf19af4c3f39be0b11584a763f0fedf20f5e870da6f03acd982b024764';
const BYTES_V166 = 244094;
const LINHAS_V166 = 3215;

// As linhas que este patch tem direito de remover — as 5 da Issue #3 original mais as 14
// do suplemento de frete (pre-selecao de Sedex, merge cru de slots, ctx, laco de tools,
// detector de CEP). Qualquer remocao alem destas e refatoracao cosmetica ou dano
// colateral, e derruba o teste.
const REMOCOES_ESPERADAS = [
  'const RX_PEDE_CEP = /(qual|me\\s+passa|me\\s+manda|informe)[\\s\\S]{0,20}cep/i;',
  '      const opcoes = d.opcoes.map((o: any) => ({ servico: o.servico, preco: o.preco_formatado, prazo: o.prazo_formatado }));',
  '      const sedex = d.opcoes.find((o: any) => String(o.servico || \'\').toLowerCase().includes(\'sedex\'));',
  '      const melhor = sedex || [...d.opcoes].sort((a: any, b: any) => Number(a.preco) - Number(b.preco))[0];',
  '      const dsp = { opcoes, servico_recomendado: melhor.servico, cep, instrucao: \'MANDE AS OPCOES AGORA com preco, prazo e TOTAL. Se o Sedex for mais barato que o PAC, recomende o Sedex.\' };',
  '      const opF = await emitirAutorizacao(ctx.leadId, \'frete\', Math.round(Number(melhor.preco) * 100) / 100, \'calcular_frete\', { servico: melhor.servico, cep });',
  '      if (!opF) return falhaAutorizacao(dsp);',
  '      return envelope([opF], dsp);',
  'CLIENTE SEM MEDIDA: pergunte a medida do OBJETO e ofere\\u00e7a op\\u00e7\\u00f5es proporcionais. Refer\\u00eancia: arte de caneca costuma ser 10 x 21cm.',
  '  if (RX_CONFIRMACAO_CURTA.test(mensagem.trim()) && RX_ENCERRAMENTO_JOAO.test(ultimaMsgJoao)) {',
  '  const cortesiaPura = REGEX_CORTESIA.test(mensagem.trim());',
  '  const blocoEstado = estado ? `\\n\\n[FICHA: etapa=${estado.etapa}; slots=${JSON.stringify(estado.slots)}. N\\u00c3O pergunte o preenchido.]` : \'\';',
  '  const ctx: any = { leadId, phone, autorizacoes: [] as any[], precosAutorizados: [] as any[], cobrancaPendente: execucoes.cobrancaPendente, permiteMudanca: pediuMudanca, freteJa: execucoes.freteJa, arteParaCalculo, pixGerado: null };',
  '        try { const parsed = JSON.parse(out); if (Array.isArray(parsed?.financial_authorizations)) ctx.autorizacoes.push(...parsed.financial_authorizations);',
  '             if (Array.isArray(parsed?.precos_verbalizaveis)) ctx.precosAutorizados.push(...parsed.precos_verbalizaveis); } catch {}',
  '    ...slotsRecebidos,',
  '    grade: (Array.isArray(slotsRecebidos.grade) && slotsRecebidos.grade.length > 0) ? slotsRecebidos.grade : slotsAnteriores.grade,',
  '    estampas: (Array.isArray(slotsRecebidos.estampas) && slotsRecebidos.estampas.length > 0) ? slotsRecebidos.estampas : slotsAnteriores.estampas,',
  '  const out = await atenderCliente(phone, chatName, mensagem, imagens, transcricoes, inboundId ? [inboundId] : null, dryRun);',
];

// Subsistemas que o patch declarou NAO tocar. Nenhuma linha ADICIONADA pode
// escrever neles nem redefinir os seus caminhos.
const PROIBIDOS = [
  [/gerar_pix|mp-pix|mp_pix_cobrancas|fn_consumir_operacao|checkout_url/, 'Pix'],
  [/joao-orcamento-calcme|vw_orcamento_calcme/, 'CalcMe'],
  [/tts|text_to_speech|text-to-speech|ttsResultado\s*=|entregarComoJoao\s*\(/i, 'TTS/voz'],
  [/dtf_precos_faixa|dtf_uv_degraus|catalogo_produtos|dtf_produto_config/, 'tabela de preco'],
  [/sb\.rpc\('fn_precificar/, 'RPC de precificacao'],
  [/functions\/v1\/(?!calcular-frete\b)[a-z-]+/, 'outras Edge Functions'],
];

describe('escopo do patch e rollback', () => {
  test('o artefato v166 de rollback continua byte-exato', () => {
    const buf = readFileSync(resolve(RAIZ, ROLLBACK));
    assert.equal(createHash('sha256').update(buf).digest('hex'), SHA_V166, 'sha256 do rollback divergiu');
    assert.equal(buf.length, BYTES_V166, 'bytes do rollback divergiram');
    assert.equal(buf.toString('utf8').split('\n').length - 1, LINHAS_V166, 'linhas do rollback divergiram');
    assert.equal(git('status', '--porcelain', '--', ROLLBACK).trim(), '', 'o rollback nao pode aparecer como modificado');
  });

  test('em supabase/, somente o index.ts da agente-noturno foi tocado', () => {
    const emSupabase = arquivosTocados().filter((f) => f.startsWith('supabase/'));
    assert.deepEqual(emSupabase, [ALVO]);
    assert.ok(!arquivosTocados().includes(ROLLBACK), 'o artefato de rollback nao pode ser tocado');
  });

  test('o patch remove exatamente as linhas previstas', () => {
    const removidas = git('diff', '-U0', BASE, '--', ALVO)
      .split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
      .map((l) => l.slice(1));
    assert.deepEqual(removidas, REMOCOES_ESPERADAS);
  });

  test('nenhuma linha adicionada toca Pix, CalcMe, TTS, tabela de preco, RPC de preco ou outras Edges', () => {
    const adicionadas = git('diff', '-U0', BASE, '--', ALVO)
      .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .filter((l) => !l.trim().startsWith('//'));   // comentarios podem citar; codigo nao pode tocar
    for (const [rx, nome] of PROIBIDOS) {
      const culpada = adicionadas.find((l) => rx.test(l));
      assert.equal(culpada, undefined, `linha adicionada toca ${nome}: ${culpada}`);
    }
  });

  test('nenhuma migration e nenhuma outra Edge Function entrou no patch', () => {
    for (const f of arquivosTocados()) {
      assert.ok(!/^supabase\/migrations\//.test(f), `migration no patch: ${f}`);
      assert.ok(!/^supabase\/functions\/(?!agente-noturno\/)/.test(f), `outra Edge no patch: ${f}`);
    }
  });

  // Item 8 do suplemento: os parametros da chamada externa de frete continuam FIXOS.
  // A auditoria classificou como CONFIRMADO e frente separada (ver EVIDENCIA.md): mexer
  // neles sem o contrato da Edge de frete arriscaria cobrar frete errado em producao.
  // Este teste PINA o estado atual — mudar os valores exige mudar o teste, de proposito.
  test('parametros fixos da integracao de frete continuam pinados (frente separada)', () => {
    const fonte = readFileSync(resolve(RAIZ, ALVO), 'utf8');
    const chamada = fonte.split('\n').find((l) => l.includes('functions/v1/calcular-frete') && l.includes('cep_destino'));
    assert.ok(chamada, 'a chamada externa de frete tinha que existir');
    assert.match(chamada, /metros:\s*1\b/, 'metros segue fixo em 1');
    assert.match(chamada, /valor_declarado:\s*60\b/, 'valor_declarado segue fixo em 60');
    assert.match(fonte, /frete_parametros_fixos/, 'a cotacao registra os parametros fixos junto da composicao real');
  });
});
