/// <reference lib="deno.ns" />

import { renderPreflightContext, summarizePreflightRows } from './preflight-context-core.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('single mounted file uses measured file meters instead of artwork questions', () => {
  const s = summarizePreflightRows([{ arquivos: [{ nome_original: 'gang.png', quantidade: 2, analise: {
    status: 'ANALYZED', verified: true, width_cm: 57, height_cm: 185,
    meters_raw_per_copy: 1.85, copies: 2, background_status: 'TRANSPARENT',
    resolution_status: 'OK', ready_for_quote: true, ready_for_print: true,
  } }] }]);
  assert(s.allQuoteReady === true, 'quote should be ready');
  assert(s.totalPhysicalMeters === 3.7, '2 copies x 1.85m must total 3.7m');
  const text = renderPreflightContext(s);
  assert(text.includes('quote_ready=true'), 'context must expose quote evidence');
  assert(text.includes('nao pergunte tamanho de cada arte'), 'context must suppress redundant artwork interrogation');
});

Deno.test('multiple mounted files sum only proven physical meters', () => {
  const s = summarizePreflightRows([{ arquivos: [
    { nome_original: 'a.png', quantidade: 1, analise: { status:'ANALYZED', verified:true, meters_raw_per_copy:1, copies:1, ready_for_quote:true, ready_for_print:true } },
    { nome_original: 'b.pdf', quantidade: 3, analise: { status:'ANALYZED', verified:true, meters_raw_per_copy:0.5, copies:3, ready_for_quote:true, ready_for_print:true } },
  ] }]);
  assert(s.totalPhysicalMeters === 2.5, '1m + 3x0.5m must total 2.5m');
});

Deno.test('pending or failed analysis never invents total meters', () => {
  const s = summarizePreflightRows([{ arquivos: [
    { nome_original: 'a.cdr', quantidade: 1, analise: { status:'ADAPTER_REQUIRED', verified:false, meters_raw_per_copy:null, ready_for_quote:false, ready_for_print:false, reason:'DTF_CDR_WORKER_URL_MISSING' } },
  ] }]);
  assert(s.allQuoteReady === false, 'must stay fail-closed');
  assert(s.totalPhysicalMeters === null, 'must not invent meters');
  assert(renderPreflightContext(s).includes('metragem_fisica_total=NAO_PROVADO'), 'must surface unknown total');
});
