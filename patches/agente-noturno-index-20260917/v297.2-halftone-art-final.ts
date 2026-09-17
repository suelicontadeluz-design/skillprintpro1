// agente-noturno v297.2 — Halftone -> Arte Final guarded router — 17/09/2026
// Order is intentional:
// 1) capture outer request identity in AsyncLocalStorage;
// 2) load exact live v296;
// 3) install narrow halftone router outermost over the model-call chain.
// Kill switch: sistema_config.joao_halftone_art_final_router_ativo.
// Rollback: restore exact v296 shim pinned at 1253876a4aede071810b1b5c0b33a434d930b271.
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/562b9c919955d123671b84969bf3e7de7aca29c9/patches/joao-halftone-arte-final-20260917/request-context-preload-v1.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/1253876a4aede071810b1b5c0b33a434d930b271/patches/agente-noturno-index-20260915/v296-pricing-agent-mixed-live.ts";
import "https://raw.githubusercontent.com/suelicontadeluz-design/skillprintpro1/562b9c919955d123671b84969bf3e7de7aca29c9/patches/joao-halftone-arte-final-20260917/halftone-art-final-router-v1.ts";
