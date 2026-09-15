// agente-noturno v296 candidate — v295 LKG + PricingAgent mixed canonicalization — 15/09/2026
// Base LKG remains exact live v295 FreightAgent + v294 checkout.
// Pricing context/preflight loads below legacy ERP validation; response gate wraps handler;
// financial current-turn canonicalizer loads after v295 so it sits above legacy fetch wrappers.
// No LIVE cutover in this wrapper. Rollback base: bfdbf6fc1cf0df83548578dde46cb34016ee1ef9.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/1fa32774a66aaa65f5f3c2314b851c58aa374bfd/patches/pricing-agent-phase1-20260915/pricing-current-turn-preflight-v1.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/b0ab80ed2d64ede09a5275a13c791e795aaea147/patches/pricing-agent-phase1-20260915/pricing-explicit-sheet-response-gate-v5.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/bfdbf6fc1cf0df83548578dde46cb34016ee1ef9/patches/agente-noturno-index-20260915/v294-freight-agent-integration-canary-v2.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/b99cd6d1625bb54cc432962bcfeee689538418ac/patches/pricing-agent-phase1-20260915/pricing-financial-current-turn-postload-v1.ts";
