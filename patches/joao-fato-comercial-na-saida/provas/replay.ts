// Replay em SHADOW da guarda de saida contra trafego organico real.
// Le um JSON exportado do banco; nao escreve nada em lugar nenhum.
import * as fs from 'node:fs';
import { afirmacoesSemLastro, filtrarSlotsPorProveniencia, normalizarProdutoMacro,
         fatosDePedidoNoTexto } from './proveniencia_gerado.js';

const arq = process.argv[2];
const dados: any[] = JSON.parse(fs.readFileSync(arq, 'utf8'));
let comClaim = 0, bloqueadas = 0;
const porMotivo: Record<string, number> = {};
const amostras: any[] = [];
for (const t of dados) {
  const textos: string[] = Array.isArray(t.c) ? t.c.filter(Boolean) : [];
  // Estado verificado = o que a PORTA da v4.37.0 aprovaria neste turno.
  // slots_depois e o estado ja contaminado da LIVE; refiltra-se contra slots_antes.
  const macroCan = normalizarProdutoMacro((t.sd || {}).produto) || null;
  const porta = filtrarSlotsPorProveniencia({
    anteriores: t.sa || {}, recebidos: t.sd || {},
    textosCliente: textos, macroCanonico: macroCan, toolsUsadas: [],
  });
  const verificado = { ...(t.sa || {}), ...porta.slots };
  const claims = fatosDePedidoNoTexto(String(t.r || ''));
  if (claims.length === 0) continue;
  comClaim++;
  const fora = afirmacoesSemLastro({
    texto: String(t.r || ''), verificado, textosCliente: textos,
    macroCanonico: macroCan, numerosAutorizados: [],
  });
  if (fora.length > 0) {
    bloqueadas++;
    for (const f of fora) porMotivo[f.motivo] = (porMotivo[f.motivo] || 0) + 1;
    if (amostras.length < 25) amostras.push({ r: String(t.r).slice(0, 130), fora: fora.map((x: any) => x.trecho + '/' + x.motivo), ver: verificado, cli: textos.slice(0, 3) });
  }
}
console.log('turnos no arquivo        :', dados.length);
console.log('com afirmacao de pedido  :', comClaim);
console.log('DISPARARIAM a guarda     :', bloqueadas, '(' + (100 * bloqueadas / Math.max(comClaim, 1)).toFixed(1) + '% dos com afirmacao)');
console.log('motivos                  :', JSON.stringify(porMotivo));
console.log('\n--- AMOSTRAS PARA JULGAMENTO DE FALSO POSITIVO ---');
for (const a of amostras) {
  console.log('\nRESP : ' + a.r);
  console.log('FORA : ' + a.fora.join(' | '));
  console.log('VERIF: ' + JSON.stringify(a.ver).slice(0, 150));
  console.log('CLI  : ' + JSON.stringify(a.cli).slice(0, 170));
}
