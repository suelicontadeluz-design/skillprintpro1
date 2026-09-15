// agente-noturno v295 + PricingAgent Phase 1 canary — 15/09/2026
// Exact live v295 semantics are preserved by importing the same FreightAgent+v294 LKG commit.
// PricingAgent scope: current-turn explicit DTF UV sheet orders only; ERP read-only canonical quote.
// Rollback/live remain untouched until canary proof passes.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/fa8d06dd67d2dd274b6022a889f90540fb46333b/patches/pricing-agent-phase1-20260915/pricing-explicit-sheet-response-gate-v1.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/bfdbf6fc1cf0df83548578dde46cb34016ee1ef9/patches/agente-noturno-index-20260915/v294-freight-agent-integration-canary-v2.ts";
