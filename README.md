# LumiMemory

**Evidence-grounded, policy-governed Personal Memory for AI Agents.**

LumiMemory is an independent, application-agnostic memory service. LumiThink will be its first client, but the core model does **not** depend on child-specific types, DSH, voice, or any particular model.

## Project status

**v0.1.0 bootstrap / experimental. Not production-ready.** The current engine is a deterministic SQLite baseline, not a deployed Hindsight integration. Dreaming, Hindsight synchronization, grant delegation, complete backup deletion replay and production identity federation are future milestones. **Do not import real personal or child data.**

## What works in v0.1

- Tenant-bound private spaces and actor authorization (trusted service tokens only).
- Explicit opt-in bounded Evidence retention (default: disabled; child-guarded max 7 days).
- Candidate -> human confirmation -> recall -> human correction -> hard deletion.
- Immutable evidence references, supersession lineage, value-free audit and transactional metadata-only outbox.
- A small HTTP API with secure-by-default loopback binding; zero runtime npm dependencies.
- Synthetic tests for authorization, unconfirmed memory, correction, erasure and expiration.

## Requirements

Node.js 24 or later (uses built-in `node:sqlite` and native TypeScript stripping).

~~~sh
npm test
npm run check
~~~

Run locally using a unique random key of at least 24 characters. Never commit tokens:

~~~sh
export LUMIMEMORY_TOKENS_JSON='[{"token":"REPLACE_WITH_A_RANDOM_SECRET_32_CHARS","tenantId":"demo","principalId":"owner","kind":"human","scopes":["spaces:create"]}]'
npm start
~~~

The API binds to 127.0.0.1:8787 by default. To store evidence, callers must explicitly create a space with positive `evidenceRetentionDays`:

~~~sh
curl -sS -X POST http://127.0.0.1:8787/v1/spaces \
  -H "Authorization: Bearer REPLACE_WITH_A_RANDOM_SECRET_32_CHARS" \
  -H 'Content-Type: application/json' \
  -d '{"ownerSubjectId":"person-demo","policyPack":"personal-default","evidenceRetentionDays":7}'
~~~

Use the returned space ID for `/v1/spaces/{spaceId}/evidence`, then `/memories`, then `/memories/{memoryId}/confirm`. Confirmed memories can be read via `GET /v1/spaces/{spaceId}/memories?query=...`.

## Architecture

- **Authoritative store**: SQLite for spaces, explicit grants, evidence, memory claims, revision lineage, audit, tombstones and outbox.
- **Memory engine port**: Hindsight and other engines will be adapters, not authoritative databases.
- **Background maintenance**: future Dreaming worker processes only committed, policy-authorized evidence.
- **Consumer**: LumiThink uses a constrained SDK/HTTP adapter; it must not directly write to a Hindsight bank.

Architecture decision: [ADR-0001](docs/adr/0001-personal-memory-architecture.md). Privacy boundary: [ADR-0002](docs/adr/0002-privacy-and-deletion.md). [Roadmap](docs/ROADMAP.md).

## Security notice

This experimental server uses statically provisioned trusted tokens; it does not support runtime principal impersonation, token rotation UI, delegated household access, TLS termination, rate limiting, full data export, or production-grade erase across backups and future indexes. Use only on a private development host, with synthetic data. No license has been selected yet; do not presume redistribution rights.
