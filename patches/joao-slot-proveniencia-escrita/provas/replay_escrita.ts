// Replay em SHADOW da PORTA DE ESCRITA contra trafego organico real.
// Nao escreve nada: so mostra o que a porta teria recusado.
import * as fs from 'node:fs';
import { filtrarSlotsPorProveniencia, normalizarProdutoMacro, produtoNaMensagem } from './proveniencia_gerado.js';
// Mesmo mapeamento de categoriaParaProduto() do candidato, para o canonico do replay
// ser o MESMO que producao usa (prodOrigem), e nao um proxy.
function categoriaParaProduto(cat: string): string | null {
  const c = String(cat || '').toLowerCase();
  if (!c) return null;
  if (c.includes('pack') || c.includes('anime') || c.includes('estampa')) return 'pack';
  if (c.includes('uv')) return 'dtf_uv';
  if (c.includes('textil') || c.includes('t\u00eaxtil')) return 'dtf_textil';
  if (c.includes('camiseta') || c.includes('uniforme') || c.includes('terceirao') || c.includes('evangel')) return 'camiseta';
  if (c.includes('copo')) return 'copo';
  return null;
}

const dados: any[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let comSlots = 0, comRejeicao = 0;
const porSlot: Record<string, number> = {};
const amostras: any[] = [];
for (const t of dados) {
  const textos: string[] = Array.isArray(t.c) ? t.c.filter(Boolean) : [];
  const sd = t.sd || {}, sa = t.sa || {};
  if (Object.keys(sd).length === 0) continue;
  comSlots++;
  const r = filtrarSlotsPorProveniencia({
    anteriores: sa, recebidos: sd, textosCliente: textos,
    macroCanonico: normalizarProdutoMacro(categoriaParaProduto(t.cc || '')) || normalizarProdutoMacro(sa.produto) || null,
    toolsUsadas: [],
    // Proxy fiel de imagens/transcricoes: fact_conversations grava a midia como marcador.
    midiaNoTurno: textos.some((x) => /\[(imagem|áudio|audio|documento|vídeo|video)\]/i.test(x)),
  });
  // modalidade_logistica / envio_retirada / cep sao reescritos pelo estadoLog LOGO
  // DEPOIS da porta, quando ha evidencia. slots_depois do banco ja contem essa
  // escrita, entao conta-la como "recusa" seria artefato do replay.
  const DETERMINISTICOS = new Set(['modalidade_logistica', 'envio_retirada', 'cep']);
  const efetivas = r.rejeitados.filter((x: any) => !DETERMINISTICOS.has(x.slot));
  for (const x of r.rejeitados) if (DETERMINISTICOS.has(x.slot)) porSlot['(det) ' + x.slot] = (porSlot['(det) ' + x.slot] || 0) + 1;
  if (efetivas.length > 0) {
    comRejeicao++;
    for (const x of efetivas) porSlot[x.slot] = (porSlot[x.slot] || 0) + 1;
    if (amostras.length < 40 && efetivas.some((x:any)=>x.slot==='produto')) amostras.push({ rej: efetivas.map((x: any) => x.slot + '=' + JSON.stringify(x.valor) + ' (' + x.motivo + ')'), antes: sa, depois: sd, cli: textos.slice(0, 3) });
  }
}
console.log('turnos com slots      :', comSlots);
console.log('turnos com recusa EFETIVA:', comRejeicao, '(' + (100 * comRejeicao / Math.max(comSlots, 1)).toFixed(1) + '%)');
console.log('recusas por slot      :', JSON.stringify(porSlot));
console.log('\n--- AMOSTRAS ---');
for (const a of amostras) {
  console.log('\nREJ  : ' + a.rej.join(' | '));
  console.log('ANTES: ' + JSON.stringify(a.antes).slice(0, 120));
  console.log('CLI  : ' + JSON.stringify(a.cli).slice(0, 180));
}
