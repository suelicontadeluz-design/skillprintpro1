import { projectCommercialState, type CommercialEvent } from '../state/commercial-events.ts';

const events: CommercialEvent[] = [
  { id: 'e1', type: 'product_confirmed', occurredAt: '2026-09-12T22:50:00-03:00', source: 'customer', payload: { product: 'DTF_TEXTIL' } },
  { id: 'e2', type: 'quantity_informed', occurredAt: '2026-09-12T22:51:00-03:00', source: 'customer', payload: { quantity: '1 metro' } },
  { id: 'e3', type: 'cep_informed', occurredAt: '2026-09-12T22:52:00-03:00', source: 'customer', payload: { cep: '50875-020' } },
  { id: 'e4', type: 'price_committed', occurredAt: '2026-09-12T22:53:00-03:00', source: 'agent', payload: { priceCents: 2990, source: 'ctwa_offer' } },
  { id: 'e5', type: 'freight_failed', occurredAt: '2026-09-12T22:55:00-03:00', source: 'tool', payload: { reason: 'provider_unavailable' } },
];

const state = projectCommercialState(events);

if (state.product !== 'DTF_TEXTIL') throw new Error('produto foi perdido');
if (state.quantity !== '1 metro') throw new Error('quantidade foi perdida');
if (state.cep !== '50875020') throw new Error('CEP foi perdido');
if (state.agreedPriceCents !== 2990) throw new Error('preço comprometido foi perdido');
if (state.agreedPriceSource !== 'ctwa_offer') throw new Error('proveniência do preço foi perdida');
if (state.lastFreightFailure?.reason !== 'provider_unavailable') throw new Error('falha de frete não foi preservada');

console.log('PASS recife-state');
