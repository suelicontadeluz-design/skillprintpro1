// REPLAY DRY-RUN do lead 5553984545499.
// Roda a porta de proveniencia e o normalizador de produto ANTES e DEPOIS da
// correcao, com os dados REAIS de cada turno (fact_conversations, error_log,
// joao_slots_observacao). Nada de rede, nada de modelo, nada de envio.
import { readFileSync } from 'node:fs';
const A = await import('./.gen/antes.ts');
const D = await import('./.gen/depois.ts');
const fx = JSON.parse(readFileSync(new URL('./turnos-5553984545499.json', import.meta.url), 'utf8'));
const RX_PERGUNTA_QUANTIDADE = /\bquant[oa]s\b[^?]{0,160}\?/i;

const cores = { ok: '\x1b[32m', mau: '\x1b[31m', off: '\x1b[0m' };
const marca = (b) => (b ? cores.ok + 'OK ' + cores.off : cores.mau + 'X  ' + cores.off);

// Estado persistido de verdade: o de um turno alimenta o proximo, como no agente.
const estados = { antes: {}, depois: {} };
console.log(`REPLAY  lead=${fx.lead}  prodOrigem=${fx.prodOrigem} (content_category=${fx.content_category})\n`);

for (const t of fx.turnos) {
  console.log(`── turno ${t.quando}  cliente: ${JSON.stringify(t.mensagem)}`);
  for (const via of ['antes', 'depois']) {
    const M = via === 'antes' ? A : D;
    const anteriores = Object.keys(estados[via]).length ? estados[via] : t.anteriores;
    const arg = {
      anteriores,
      recebidos: JSON.parse(JSON.stringify(t.recebidos)),
      textosCliente: t.textosCliente,
      macroCanonico: M.normalizarProdutoMacro(fx.prodOrigem),
      toolsUsadas: t.toolsUsadas,
      midiaNoTurno: t.midiaNoTurno,
      numerosDeFerramenta: t.numerosDeFerramenta,
    };
    // O parametro novo so existe na versao corrigida; a antiga ignora.
    if (via === 'depois') arg.perguntaQuantidadePendente = RX_PERGUNTA_QUANTIDADE.test(String(t.ultimaMsgJoao || ''));
    const r = M.filtrarSlotsPorProveniencia(arg);
    const slotsNovos = { ...anteriores, ...r.slots };
    for (const k of Object.keys(slotsNovos)) if (slotsNovos[k] === null || slotsNovos[k] === 'null' || slotsNovos[k] === '') delete slotsNovos[k];
    estados[via] = slotsNovos;
    const macro = M.normalizarProdutoMacro(slotsNovos.produto);
    console.log(`   ${via.padEnd(6)} produto_macro=${String(macro).padEnd(11)} quantidade=${String(slotsNovos.quantidade ?? '—').padEnd(5)} rejeitados=${JSON.stringify(r.rejeitados.map(x => x.slot + ':' + x.motivo))}`);
  }
  console.log('');
}

console.log('── VEREDITO ────────────────────────────────────────────────');
const macroA = A.normalizarProdutoMacro(estados.antes.produto);
const macroD = D.normalizarProdutoMacro(estados.depois.produto);
const testes = [
  ['produto_macro ANTES era null (defeito reproduzido)', macroA === null],
  ['produto_macro DEPOIS = dtf_uv', macroD === 'dtf_uv'],
  ['quantidade ANTES perdida', estados.antes.quantidade === undefined],
  ['quantidade DEPOIS preservada = 100', estados.depois.quantidade === 100],
  ['slot produto do modelo segue intacto (nao reescrevemos a fala)', estados.depois.produto === 'adesivo_dtf_uv'],
];
for (const [n, b] of testes) console.log(marca(b) + n);
process.exit(testes.every(([, b]) => b) ? 0 : 1);
