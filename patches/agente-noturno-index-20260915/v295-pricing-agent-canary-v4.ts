// agente-noturno v295 + PricingAgent Phase 1 canary v4 — 15/09/2026
// Exact live v295 semantics are preserved; PricingAgent only enforces pure explicit DTF UV sheet pricing.
// Requires explicit UV/adhesive signal in the current customer turn.
// Mixed freight/payment/PDF/closing stays observe-only on v295 LKG.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/072f489ebbb33667d4cec85f2a65164ce2379901/patches/pricing-agent-phase1-20260915/pricing-explicit-sheet-response-gate-v4.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/bfdbf6fc1cf0df83548578dde46cb34016ee1ef9/patches/agente-noturno-index-20260915/v294-freight-agent-integration-canary-v2.ts";
