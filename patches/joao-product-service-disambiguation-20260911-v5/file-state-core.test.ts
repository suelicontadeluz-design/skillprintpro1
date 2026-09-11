/// <reference lib="deno.ns" />

import { pd5BuildDecision, pd5DetectFileState, pd5ExplicitApparelApply, pd5Kinds } from './file-state-core.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('caso organico: aplicar em camisetas pergunta estado do arquivo antes de tamanho/copia', () => {
  const d = pd5BuildDecision({ inbound: 'Para aplicar em camisetas.' });
  assert(d !== null, 'decision missing');
  assert(d.slots.produto === 'dtf_textil', 'wrong product');
  assert(d.mensagem.includes('arquivo montado'), 'must ask mounted file state');
  assert(d.mensagem.includes('artes separadas'), 'must ask separate artwork state');
  assert(!/tamanho da estampa|quantas copias/i.test(d.mensagem), 'must not ask artwork size/copies yet');
});

Deno.test('arquivo montado ganha upload + analise, sem tamanho/copia', () => {
  const d = pd5BuildDecision({
    inbound: 'Já tenho o arquivo montado e pronto.',
    previousAssistant: 'Você já tem o arquivo montado e pronto para impressão ou tem as artes separadas?',
    recentUserTexts: ['Para aplicar em camisetas.'],
  });
  assert(d !== null, 'decision missing');
  assert(d.slots.arquivo_estado === 'MOUNTED_FILE', 'wrong state');
  assert(/upload/i.test(d.mensagem), 'must request upload');
  assert(!/qual.*tamanho|quantas copias/i.test(d.mensagem), 'must not interrogate mounted artwork');
});

Deno.test('artes separadas pergunta se Skillprint deve montar', () => {
  const d = pd5BuildDecision({
    inbound: 'Tenho as artes separadas.',
    previousAssistant: 'Você já tem o arquivo montado e pronto para impressão ou tem as artes separadas?',
    recentUserTexts: ['Quero DTF têxtil para aplicar em camiseta.'],
  });
  assert(d !== null, 'decision missing');
  assert(d.slots.arquivo_estado === 'SEPARATE_ARTWORKS', 'wrong state');
  assert(/skillprint monte/i.test(d.mensagem), 'must ask if Skillprint should layout');
});

Deno.test('sem arte oferece pack, Studio e criacao', () => {
  const d = pd5BuildDecision({
    inbound: 'Não tenho arte ainda.',
    previousAssistant: 'Você já tem o arquivo montado e pronto para impressão ou tem as artes separadas?',
    recentUserTexts: ['Para aplicar em camisetas.'],
  });
  assert(d !== null, 'decision missing');
  assert(d.slots.arquivo_estado === 'NO_ART', 'wrong state');
  assert(/pack/i.test(d.mensagem) && /studio/i.test(d.mensagem) && /criacao/i.test(d.mensagem), 'must offer three paths');
});

Deno.test('moletom singular e reconhecido como vestuario DTF textil', () => {
  assert(pd5Kinds('Quero aplicar em moletom').apparel, 'singular moletom not recognized');
  assert(pd5ExplicitApparelApply('Quero aplicar em moletom'), 'apply intent not recognized');
  const d = pd5BuildDecision({ inbound: 'Quero aplicar em moletom.' });
  assert(d?.slots.produto === 'dtf_textil', 'moletom should resolve textile');
});

Deno.test('mistura vestuario + copo continua ambigua e nao e interceptada', () => {
  const d = pd5BuildDecision({ inbound: 'Quero aplicar em camisetas e copos.' });
  assert(d === null, 'mixed product must remain ambiguous');
});

Deno.test('resposta de estado sem pergunta previa/confianca textil nao sequestra conversa', () => {
  const d = pd5BuildDecision({ inbound: 'Tenho as artes separadas.', previousAssistant: 'Qual produto você quer?' });
  assert(d === null, 'must not hijack unrelated conversation');
});

Deno.test('detector nao confunde nao tenho arquivo montado com sem arte', () => {
  assert(pd5DetectFileState('Não tenho arquivo montado, tenho as artes separadas.') === 'SEPARATE_ARTWORKS', 'must detect separate artworks');
});
