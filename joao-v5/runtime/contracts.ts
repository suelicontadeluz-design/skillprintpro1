import type { CommercialState } from '../state/commercial-events.ts';
import type { EffectIntent } from '../effects/contracts.ts';

export type ConversationMessage = {
  role: 'customer' | 'agent' | 'operator';
  text: string;
  at: string;
};

export type ToolRequest = {
  name: string;
  arguments: Record<string, unknown>;
};

export type DecisionInput = {
  decisionId: string;
  customerId: string;
  inboundText: string;
  commercialState: CommercialState;
  recentMessages: readonly ConversationMessage[];
  availableSkills: readonly { name: string; description: string }[];
};

export type DecisionOutput = {
  replyDraft: string | null;
  toolRequests: readonly ToolRequest[];
  proposedEffects: readonly EffectIntent[];
  skillsUsed: readonly string[];
  stateFactsUsed: readonly string[];
};
