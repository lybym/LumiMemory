# LumiMemory roadmap

| Stage | Goal | Acceptance gate |
|---|---|---|
| v0.1 bootstrap | Separate project, SQLite authority, scoped API, evidence and candidate lifecycle | CI tests green; no real data |
| v0.2 engine | Hindsight adapter via stable port; controlled outbox, rebuild and redaction | No direct downstream writes; engine indexes deletable |
| v0.3 governance | Consent ledger, multi-actor grants, export/erase, backup restore replay, token rotation | Cross-tenant and deletion audit |
| v0.4 dreaming | Reflect/Verify/Consolidate/Publish worker, provenance checks, conflict review | No unsupported claims promoted |
| v0.5 integration | LumiThink A2A SDK, context budget, interrupt/epoch and channel scope | Real-device E2E and synthetic child acceptance |
| v0.6 product | Memory management UI, subject views, portable import/export | Usability and privacy acceptance |

## First proposed issues

1. MEMORY-01: threat model and Policy Pack v1.
2. MEMORY-02: trusted identity, scopes, and relationship grants.
3. MEMORY-03: engine adapter contract and Hindsight PoC benchmark.
4. MEMORY-04: idempotent outbox dispatcher, backfill and deletion.
5. MEMORY-05: evidence retention scheduler, consent and backup replay.
6. MEMORY-06: Dreaming workflow with immutable-source validation.
7. MEMORY-07: LumiThink adapter and A2A/DSH integration tests.

No production or child data may be used until the relevant release gate is passed.
