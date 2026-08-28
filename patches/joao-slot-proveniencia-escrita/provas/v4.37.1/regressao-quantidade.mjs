// Regressao da porta de quantidade: TODAS as recusas reais ja registradas em
// error_log (motivo=quantidade_sem_evidencia_de_unidade), reconstruidas com o
// texto real do cliente e a ultima mensagem real do Joao, mais casos adversarios
// derivados da propria razao de ser da guarda (numero nascido de dinheiro / remessa).
// Criterio: nenhuma recusa legitima pode virar aceite.
const A = await import('./.gen/antes.ts');
const D = await import('./.gen/depois.ts');
const RX_PERGUNTA_QUANTIDADE = /\bquant[oa]s\b[^?]{0,160}\?/i;

// ── recusas REAIS (error_log + fact_conversations) ───────────────────────────
const reais = [
 { caso:'1336 / 7 metros ditos pelo proprio Joao', valor:7, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nTudo cabe em 7 metros de DTF Têxtil, cada arte cobra um mínimo de 1 metro. Resumo:\n\nEtiquetas 5x5: R$ 59,90',
   cliente:['Se o metro é 59,00 reais. \nVcs têm que cobrar os valores abaixo, se é meio metro seria 29,50','Não dá mais de 3 metros','Não dá tudo isso .','Tem alguma coisa errada','(foto enviada pelo cliente)','[imagem]'] },
 { caso:'4682 / 2 dentro de "02 folha A3"', valor:2, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nFolha A4 sai R$29,90; folha A3 R$39,90; acima disso a gente cobra por metro. Seus 5x5cm de adesivo cabem na A4, quer saber quantos adesivos saem por folha?',
   cliente:['Quanto custa o frete para o CEP 50050-480 ou 53620-600? 02 folha A3','Eu gostaria de saber o valor da impressão','Quanto custa o metro ou folha A3?','Vc envia para Pernambuco?','Boa noite seria para copo americano.  5x5cm','Olá! Posso ter mais informações sobre isso?'] },
 { caso:'4682 / 2 apos Joao ja ter fechado o valor', valor:2, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nDois A3 saem R$79,80 (2x R$39,90). Frete para Recife: PAC R$27,60 ou Sedex R$62,32. Total com Sedex fica R$142,12, qual você prefere?',
   cliente:['Vou verificar aqui com meu cliente e falo com vc','Quanto custa o frete para o CEP 50050-480 ou 53620-600? 02 folha A3','Eu gostaria de saber o valor da impressão','Quanto custa o metro ou folha A3?'] },
 { caso:'1612 / 5 vindo de "umas cinco" por extenso', valor:5, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nBoa noite! Felipe, tudo bem! Fazemos camiseta personalizada sim, 100% algodão, qualidade top e entrega rápida. Me passa alguns detalhes: quantas camisas você quer fazer, qual o modelo e qual a cor?',
   cliente:['(foto enviada pelo cliente)','Coisa simples, o símbolo no peito e uma imagem maior nas costas','Para fazer um teste ia pegar umas cinco, se gostarmos do material fazemos mais.','[imagem]','Camisas pretas!\n\nJá tenho a arte e uma ideia, vou enviar aqui.'] },
 { caso:'9342 / 20 sem nenhuma fala do cliente', valor:20, deveAceitar:false,
   ultimaJoao:null,
   cliente:['Ola boa tarde\nEstou preocupado com o prazo, considerando semana que vem ja ser 1° semana de setembro...'] },
 { caso:'5499 / 100 respondendo "Quantos adesivos ... precisa?"  <= ALVO', valor:100, deveAceitar:true,
   ultimaJoao:'*João Barros:*\nPerfeito! Quantos adesivos de 50x75cm você precisa?',
   cliente:['100','50x75','Quero colocar em copos  de shopp','Só os adesivos','Esse','Valor para esses modelos','[imagem]','[imagem]'] },
 { caso:'5499 / 100 no turno seguinte, sem pergunta de quantidade', valor:100, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nQual informação você precisa agora: valor, prazo, pagamento ou entrega?',
   cliente:['Todas','100','50x75','Quero colocar em copos  de shopp','Só os adesivos'] },
];

// ── adversarios: exatamente o que a guarda existe para barrar ────────────────
const adversarios = [
 { caso:'ADV numero nascido de dinheiro (caso Vitor)', valor:300, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nQuantas camisetas você quer?',
   cliente:['Consigo dar uma entrada de 300 hoje'] },
 { caso:'ADV numero nascido de remessa do cliente', valor:300, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nQuantos adesivos você precisa?',
   cliente:['posso enviar 300 agora'] },
 { caso:'ADV numero puro sem pergunta de quantidade antes', valor:300, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nQual o tamanho da estampa em centimetros?',
   cliente:['300'] },
 { caso:'ADV numero puro que NAO bate com o proposto pelo modelo', valor:300, deveAceitar:false,
   ultimaJoao:'*João Barros:*\nQuantas camisetas você quer?',
   cliente:['30'] },
 { caso:'ADV pergunta de quantidade + numero puro batendo (aceite legitimo)', valor:30, deveAceitar:true,
   ultimaJoao:'*João Barros:*\nQuantas camisetas você quer?',
   cliente:['30'] },
];

function roda(M, c, comFix) {
  const arg = { anteriores:{}, recebidos:{ quantidade:c.valor }, textosCliente:c.cliente,
                macroCanonico:null, toolsUsadas:[], midiaNoTurno:false, numerosDeFerramenta:[] };
  if (comFix) arg.perguntaQuantidadePendente = RX_PERGUNTA_QUANTIDADE.test(String(c.ultimaJoao || ''));
  return M.filtrarSlotsPorProveniencia(arg).slots.quantidade !== undefined;
}

let falhas = 0, flips = 0;
for (const [titulo, lista] of [['RECUSAS REAIS DE PRODUCAO', reais], ['ADVERSARIOS', adversarios]]) {
  console.log(`\n── ${titulo} ─────────────────────────────────────────`);
  for (const c of lista) {
    const a = roda(A, c, false), d = roda(D, c, true);
    const ok = d === c.deveAceitar;
    if (!ok) falhas++;
    if (a !== d) flips++;
    console.log(`${ok ? '\x1b[32mOK \x1b[0m' : '\x1b[31mX  \x1b[0m'}antes=${a ? 'aceita' : 'recusa'}  depois=${d ? 'aceita' : 'recusa'}  esperado=${c.deveAceitar ? 'aceita' : 'recusa'}  ${c.caso}`);
  }
}
console.log(`\nmudancas de veredito: ${flips}   falhas: ${falhas}`);
console.log(falhas === 0 ? 'OK: nenhuma recusa legitima virou aceite.' : 'FALHOU');
process.exit(falhas === 0 ? 0 : 1);
