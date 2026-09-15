// agente-noturno v294 + FreightAgent Phase 1 integration canary v2 — 15/09/2026
// Safety strategy:
// 1) exact v294 checkout remains the Last Known Good base;
// 2) FreightAgent uses the active request turn, never DB latest-inbound reconstruction;
// 3) pure shipping output may be canonicalized, including silent base continuations;
// 4) mixed product/pricing/checkout/payment turns are observed only, preserving v294 behavior;
// 5) dry-run state is namespaced under replay: and cannot become current LIVE state;
// 6) no Pricing/Closing/Payment responsibility is removed in this cut.
// Rollback: deploy the exact v294 wrapper pinned at f706fc1cc7c8f78dce030cfcbfe50f4e0bef6e78.

import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/9a1e351aa95e2dbd9192f3613eae781fe7ad0742/patches/freight-agent-phase1-20260915/freight-current-turn-context-preload-v1.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/9a1e351aa95e2dbd9192f3613eae781fe7ad0742/patches/freight-agent-phase1-20260915/freight-agent-runtime-preload-v1.2-current-turn.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/9a1e351aa95e2dbd9192f3613eae781fe7ad0742/patches/freight-agent-phase1-20260915/freight-agent-response-gate-preload-v1.4-current-turn.ts";

// Exact production checkout v294 LKG — unchanged.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/f706fc1cc7c8f78dce030cfcbfe50f4e0bef6e78/patches/agente-noturno-index-20260914/v294-checkout-e2e.ts";
