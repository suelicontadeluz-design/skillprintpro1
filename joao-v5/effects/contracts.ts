export type EffectIntent =
  | {
      type: 'send_message';
      customerId: string;
      text: string;
      decisionId: string;
    }
  | {
      type: 'create_pix';
      customerId: string;
      amountCents: number;
      decisionId: string;
      authorizationRef: string;
    }
  | {
      type: 'create_freight_order';
      customerId: string;
      freightQuoteId: string;
      decisionId: string;
    };

export type EffectExecution = {
  executionId: string;
  decisionId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'blocked';
  providerRef?: string;
  errorCode?: string;
};

export interface EffectExecutor {
  execute(intent: EffectIntent): Promise<EffectExecution>;
}
