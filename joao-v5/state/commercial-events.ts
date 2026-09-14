export type CommercialEventType =
  | 'product_confirmed'
  | 'quantity_informed'
  | 'cep_informed'
  | 'price_committed'
  | 'freight_quoted'
  | 'freight_failed'
  | 'scope_changed';

export type CommercialEvent = {
  id: string;
  type: CommercialEventType;
  occurredAt: string;
  source: 'customer' | 'agent' | 'tool' | 'operator' | 'system';
  payload: Record<string, unknown>;
};

export type FreightQuote = {
  provider: string;
  service?: string;
  priceCents: number;
  deadlineDays?: number;
  quotedAt: string;
};

export type CommercialState = {
  product: string | null;
  quantity: string | null;
  cep: string | null;
  agreedPriceCents: number | null;
  agreedPriceSource: string | null;
  freightQuotes: FreightQuote[];
  lastFreightFailure: { reason: string; at: string } | null;
  revision: number;
};

export const EMPTY_COMMERCIAL_STATE: CommercialState = {
  product: null,
  quantity: null,
  cep: null,
  agreedPriceCents: null,
  agreedPriceSource: null,
  freightQuotes: [],
  lastFreightFailure: null,
  revision: 0,
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function projectCommercialState(
  events: readonly CommercialEvent[],
  initial: CommercialState = EMPTY_COMMERCIAL_STATE,
): CommercialState {
  const state: CommercialState = {
    ...initial,
    freightQuotes: [...initial.freightQuotes],
  };

  for (const event of events) {
    switch (event.type) {
      case 'product_confirmed': {
        const product = text(event.payload.product);
        if (product) state.product = product;
        break;
      }
      case 'quantity_informed': {
        const quantity = text(event.payload.quantity);
        if (quantity) state.quantity = quantity;
        break;
      }
      case 'cep_informed': {
        const raw = text(event.payload.cep);
        const digits = raw?.replace(/\D/g, '') ?? '';
        if (digits.length === 8) state.cep = digits;
        break;
      }
      case 'price_committed': {
        const priceCents = positiveInt(event.payload.priceCents);
        const source = text(event.payload.source);
        if (priceCents !== null && source) {
          state.agreedPriceCents = priceCents;
          state.agreedPriceSource = source;
        }
        break;
      }
      case 'freight_quoted': {
        const provider = text(event.payload.provider);
        const service = text(event.payload.service) ?? undefined;
        const priceCents = positiveInt(event.payload.priceCents);
        const deadlineDays = positiveInt(event.payload.deadlineDays) ?? undefined;
        if (provider && priceCents !== null) {
          state.freightQuotes.push({
            provider,
            service,
            priceCents,
            deadlineDays,
            quotedAt: event.occurredAt,
          });
          state.lastFreightFailure = null;
        }
        break;
      }
      case 'freight_failed': {
        state.lastFreightFailure = {
          reason: text(event.payload.reason) ?? 'unknown',
          at: event.occurredAt,
        };
        break;
      }
      case 'scope_changed': {
        const resets = Array.isArray(event.payload.reset)
          ? event.payload.reset.filter((v): v is string => typeof v === 'string')
          : [];
        if (resets.includes('product')) state.product = null;
        if (resets.includes('quantity')) state.quantity = null;
        if (resets.includes('cep')) state.cep = null;
        if (resets.includes('price')) {
          state.agreedPriceCents = null;
          state.agreedPriceSource = null;
        }
        if (resets.includes('freight')) {
          state.freightQuotes = [];
          state.lastFreightFailure = null;
        }
        break;
      }
    }
    state.revision += 1;
  }

  return state;
}
