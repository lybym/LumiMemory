# ADR-0001: Personal Memory, independent of Agent and Harness

Status: Accepted for bootstrap (2026-11-12). Scope: architectural baseline, not production approval.

## Decision

- LumiMemory is a separate repository, service boundary and release lifecycle.
- Tenant is an isolation boundary; Principal is an authenticated caller; Subject is the entity described by a memory; Space is the authorization and sharing scope.
- Evidence and confirmed claims are authoritative in the LumiMemory store; downstream search indexes, observations, mental models, knowledge pages and dreams are disposable, rebuildable derivatives.
- Memory engines (Hindsight first) are accessed through an adapter; they never authorize access or promote candidates autonomously.
- No Agent-specific identifiers are primary keys. External source mappings remain explicit and scoped.
- Human verification and supersession are first-class lifecycle events.
- Real-time recall is independent of async consolidation; memory degradation cannot block speech response.
- The LumiThink Child Memory domain becomes a child-guarded Policy Pack rather than the core schema.

## Separation of responsibilities

LumiThink: trusted channel identity, Task/Turn lifecycle, Persona, Safety, guarded tool usage and context budget.

LumiMemory: space authorization, evidence/candidate/confirmed claim lineage, retention, deletion, memory retrieval, downstream engine orchestration.

Hindsight: prospective retrieval, consolidation and knowledge views. Its knowledge output is not a self-authorizing fact source.

## Implementation status

v0.1 implements a narrow SQLite baseline and guarded HTTP API. It does not yet ship MemoryEngine Adapter synchronization, Dreaming, multi-principal grants management or a certified data deletion procedure. No personal data should be ingested before those gates are completed.
