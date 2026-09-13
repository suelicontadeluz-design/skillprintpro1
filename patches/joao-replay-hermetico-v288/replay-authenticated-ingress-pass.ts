// Replay-only ingress adapter.
// Production's auth-preload is intentionally not executed inside the inner replay Request:
// the outer replay endpoint has already authenticated REPLAY_RUNNER_JWT.
// This file performs no network call, no state mutation and no business decision.
export {};
