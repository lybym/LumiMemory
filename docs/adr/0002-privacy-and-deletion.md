# ADR-0002: Evidence, consent, and deletion boundaries

Status: Accepted for bootstrap (2026-11-12).

## Invariants

1. Source evidence requires explicit positive retention; the default retention is zero.
2. The child-guarded policy allows at most seven days of evidence plaintext in v0.1; this cap is a product default, not a regulatory compliance statement.
3. Candidates are not returned as confirmed memories. Only a trusted human Principal can confirm or correct a claim.
4. Memory Engine / Dreaming operations may propose derived knowledge but cannot grant themselves data processing permission.
5. Every read is scoped by tenant and space authorization. Cross-tenant space discovery must not leak existence.
6. Audit and Outbox contain IDs and event names, never children's text or the memory claim.
7. Expired evidence content is redacted but non-content provenance metadata may remain. Full erasure must cover source references as well.
8. Erasure must block online reads synchronously. Downstream indexes, caches, backups and restored snapshots also require deletion propagation or replay before production use.
9. No raw audio persistence in v0.1. No external model invocation in the default engine.
10. Automatic child mental health / ability / personality profiling is not permitted. The simple lexical safety guard in v0.1 is only defense-in-depth, **not** sufficient as a production safety validator.

## Release gates

**NO-GO for real personal data** until durable external deletion ledger and backup replay, retention scheduler, explicit consent records, multi-subject authorized access, secure key rotation, deployment TLS, provider outbound data assessment and child-policy tests are independently reviewed.

The `forget` operation removes memory claims and a supersession lineage from the authoritative store, but does not currently remove source evidence shared with other claims. `eraseSpace` deletes all evidence and claims for that space and blocks reads. Backups and future engine indexes are outside this v0.1 guarantee.
