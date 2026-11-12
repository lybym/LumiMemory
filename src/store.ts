import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type Actor = {
  tenantId: string;
  principalId: string;
  kind: 'human' | 'agent';
  scopes: string[];
};
export type PolicyPack = 'personal-default' | 'child-guarded';
export type MemoryKind = 'preference' | 'fact' | 'episode' | 'goal';
export type MemoryStatus = 'candidate' | 'confirmed' | 'superseded';

type SpaceRow = {
  id: string; tenant_id: string; owner_subject_id: string;
  policy_pack: PolicyPack; evidence_retention_days: number;
  deleted_at: string | null;
};
type EvidenceRow = {
  id: string; space_id: string; subject_id: string; content: string | null;
  expires_at: string | null; redacted_at: string | null;
};
type MemoryRow = {
  id: string; space_id: string; subject_id: string; kind: MemoryKind;
  claim: string; status: MemoryStatus; evidence_id: string;
  supersedes: string | null; created_at: string; confirmed_at: string | null;
};

export class MemoryError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
    this.name = 'MemoryError';
  }
}
function required(value: unknown, max = 1200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new MemoryError('invalid_text');
  }
  return value.trim();
}
function ensureActor(actor: Actor): void {
  required(actor.tenantId, 128);
  required(actor.principalId, 128);
  if (!['human', 'agent'].includes(actor.kind) || !Array.isArray(actor.scopes)) {
    throw new MemoryError('invalid_actor', 401);
  }
}
function record<T>(value: T | undefined, code = 'not_found'): T {
  if (!value) throw new MemoryError(code, 404);
  return value;
}

export class MemoryStore {
  private db: DatabaseSync;
  constructor(path = ':memory:', private now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS spaces (' +
      'id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_subject_id TEXT NOT NULL, ' +
      'policy_pack TEXT NOT NULL, evidence_retention_days INTEGER NOT NULL, ' +
      'created_at TEXT NOT NULL, deleted_at TEXT);' +
      'CREATE TABLE IF NOT EXISTS grants (' +
      'space_id TEXT NOT NULL REFERENCES spaces(id), principal_id TEXT NOT NULL, ' +
      'permission TEXT NOT NULL CHECK(permission IN (\'read\',\'write\',\'manage\')), ' +
      'PRIMARY KEY(space_id, principal_id));' +
      'CREATE TABLE IF NOT EXISTS evidence (' +
      'id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), ' +
      'subject_id TEXT NOT NULL, content TEXT, source_system TEXT NOT NULL, ' +
      'source_ref TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, redacted_at TEXT);' +
      'CREATE TABLE IF NOT EXISTS memories (' +
      'id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), ' +
      'subject_id TEXT NOT NULL, kind TEXT NOT NULL, claim TEXT NOT NULL, ' +
      'status TEXT NOT NULL, evidence_id TEXT NOT NULL REFERENCES evidence(id), ' +
      'supersedes TEXT, created_at TEXT NOT NULL, confirmed_at TEXT);' +
      'CREATE INDEX IF NOT EXISTS memories_by_space ON memories(space_id, status);' +
      'CREATE TABLE IF NOT EXISTS outbox (' +
      'seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, ' +
      'space_id TEXT NOT NULL, object_id TEXT, created_at TEXT NOT NULL, delivered_at TEXT);' +
      'CREATE TABLE IF NOT EXISTS deletion_ledger (' +
      'id TEXT PRIMARY KEY, space_id TEXT NOT NULL, object_id TEXT, ' +
      'actor_id TEXT NOT NULL, created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS audit (' +
      'id TEXT PRIMARY KEY, space_id TEXT NOT NULL, actor_id TEXT NOT NULL, ' +
      'action TEXT NOT NULL, object_id TEXT, created_at TEXT NOT NULL);'
    );
  }
  close(): void { this.db.close(); }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
  private audit(spaceId: string, actor: Actor, action: string, objectId: string | null): void {
    this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), spaceId, actor.principalId, action, objectId, this.now());
  }
  private emit(type: string, spaceId: string, id: string | null): void {
    this.db.prepare('INSERT INTO outbox(event_type,space_id,object_id,created_at) VALUES(?,?,?,?)')
      .run(type, spaceId, id, this.now());
  }
  private authorized(spaceId: string, actor: Actor, need: 'read' | 'write' | 'manage'): SpaceRow {
    ensureActor(actor);
    const space = this.db.prepare('SELECT * FROM spaces WHERE id=? AND deleted_at IS NULL')
      .get(spaceId) as SpaceRow | undefined;
    if (!space || space.tenant_id !== actor.tenantId) throw new MemoryError('not_found', 404);
    const grant = this.db.prepare('SELECT permission FROM grants WHERE space_id=? AND principal_id=?')
      .get(spaceId, actor.principalId) as { permission: string } | undefined;
    const rank: Record<string, number> = { read: 1, write: 2, manage: 3 };
    if (!grant || rank[grant.permission] < rank[need]) throw new MemoryError('forbidden', 403);
    return space;
  }
  createSpace(actor: Actor, input: {
    ownerSubjectId: string; policyPack?: PolicyPack; evidenceRetentionDays?: number;
  }): { id: string; policyPack: PolicyPack; evidenceRetentionDays: number } {
    ensureActor(actor);
    if (actor.kind !== 'human' || !actor.scopes.includes('spaces:create')) {
      throw new MemoryError('forbidden', 403);
    }
    const subject = required(input.ownerSubjectId, 128);
    const policy = input.policyPack ?? 'personal-default';
    if (policy !== 'personal-default' && policy !== 'child-guarded') {
      throw new MemoryError('invalid_policy');
    }
    const days = input.evidenceRetentionDays ?? 0;
    const max = policy === 'child-guarded' ? 7 : 30;
    if (!Number.isInteger(days) || days < 0 || days > max) {
      throw new MemoryError('invalid_retention');
    }
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare('INSERT INTO spaces VALUES(?,?,?,?,?,?,NULL)')
        .run(id, actor.tenantId, subject, policy, days, this.now());
      this.db.prepare('INSERT INTO grants VALUES(?,?,?)').run(id, actor.principalId, 'manage');
      this.audit(id, actor, 'space.create', id);
    });
    return { id, policyPack: policy, evidenceRetentionDays: days };
  }
  addEvidence(spaceId: string, actor: Actor, input: {
    subjectId: string; content: string; sourceSystem: string; sourceRef: string;
  }): { id: string; expiresAt: string } {
    const space = this.authorized(spaceId, actor, 'write');
    if (space.evidence_retention_days === 0) throw new MemoryError('evidence_disabled', 403);
    const subject = required(input.subjectId, 128);
    if (subject !== space.owner_subject_id) throw new MemoryError('subject_mismatch', 403);
    const content = required(input.content, 4000);
    const sourceSystem = required(input.sourceSystem, 128);
    const sourceRef = required(input.sourceRef, 256);
    const id = randomUUID();
    const expiresAt = new Date(Date.parse(this.now()) + space.evidence_retention_days * 86400000).toISOString();
    this.tx(() => {
      this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,NULL)')
        .run(id, spaceId, subject, content, sourceSystem, sourceRef, this.now(), expiresAt);
      this.audit(spaceId, actor, 'evidence.add', id);
    });
    return { id, expiresAt };
  }
  propose(spaceId: string, actor: Actor, input: {
    subjectId: string; kind: MemoryKind; claim: string; evidenceId: string;
  }): { id: string; status: MemoryStatus } {
    const space = this.authorized(spaceId, actor, 'write');
    const subject = required(input.subjectId, 128);
    if (subject !== space.owner_subject_id) throw new MemoryError('subject_mismatch', 403);
    if (!['preference', 'fact', 'episode', 'goal'].includes(input.kind)) {
      throw new MemoryError('invalid_kind');
    }
    const claim = required(input.claim, 1200);
    if (space.policy_pack === 'child-guarded' &&
        /(?:诊断为|患有抑郁|患有焦虑症|智商为|人格障碍|diagnosed with|iq score)/i.test(claim)) {
      throw new MemoryError('protected_inference', 403);
    }
    const source = this.db.prepare('SELECT * FROM evidence WHERE id=? AND space_id=?')
      .get(input.evidenceId, spaceId) as EvidenceRow | undefined;
    if (!source || source.subject_id !== subject || source.content === null ||
        (source.expires_at !== null && source.expires_at <= this.now())) {
      throw new MemoryError('invalid_evidence', 400);
    }
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,NULL)')
        .run(id, spaceId, subject, input.kind, claim, 'candidate', input.evidenceId, null, this.now());
      this.audit(spaceId, actor, 'memory.propose', id);
    });
    return { id, status: 'candidate' };
  }
  confirm(spaceId: string, actor: Actor, memoryId: string): void {
    this.authorized(spaceId, actor, 'write');
    if (actor.kind !== 'human') throw new MemoryError('human_confirmation_required', 403);
    const item = record(this.db.prepare('SELECT * FROM memories WHERE id=? AND space_id=?')
      .get(memoryId, spaceId) as MemoryRow | undefined);
    if (item.status !== 'candidate') throw new MemoryError('wrong_state', 409);
    this.tx(() => {
      this.db.prepare('UPDATE memories SET status=\'confirmed\', confirmed_at=? WHERE id=?')
        .run(this.now(), memoryId);
      this.emit('memory.upsert', spaceId, memoryId);
      this.audit(spaceId, actor, 'memory.confirm', memoryId);
    });
  }
  correct(spaceId: string, actor: Actor, oldId: string, input: {
    claim: string; evidenceId: string;
  }): { id: string; status: 'confirmed' } {
    this.authorized(spaceId, actor, 'write');
    if (actor.kind !== 'human') throw new MemoryError('human_confirmation_required', 403);
    const old = record(this.db.prepare('SELECT * FROM memories WHERE id=? AND space_id=?')
      .get(oldId, spaceId) as MemoryRow | undefined);
    if (old.status !== 'confirmed') throw new MemoryError('wrong_state', 409);
    const claim = required(input.claim, 1200);
    if (claim === old.claim) throw new MemoryError('claim_unchanged', 409);
    const evidence = this.db.prepare('SELECT * FROM evidence WHERE id=? AND space_id=?')
      .get(input.evidenceId, spaceId) as EvidenceRow | undefined;
    if (!evidence || evidence.subject_id !== old.subject_id || evidence.content === null ||
        (evidence.expires_at !== null && evidence.expires_at <= this.now())) {
      throw new MemoryError('invalid_evidence');
    }
    const id = randomUUID();
    this.tx(() => {
      this.db.prepare('UPDATE memories SET status=\'superseded\' WHERE id=?').run(oldId);
      this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, spaceId, old.subject_id, old.kind, claim, 'confirmed', input.evidenceId, oldId, this.now(), this.now());
      this.emit('memory.revoke', spaceId, oldId);
      this.emit('memory.upsert', spaceId, id);
      this.audit(spaceId, actor, 'memory.correct', id);
    });
    return { id, status: 'confirmed' };
  }
  recall(spaceId: string, actor: Actor, query = ''): Array<{
    id: string; kind: MemoryKind; claim: string; evidenceId: string; confirmedAt: string;
  }> {
    this.authorized(spaceId, actor, 'read');
    if (typeof query !== 'string' || query.length > 256) throw new MemoryError('invalid_query');
    const records = this.db.prepare(
      'SELECT * FROM memories WHERE space_id=? AND status=\'confirmed\' ' +
      'ORDER BY confirmed_at DESC LIMIT 200'
    ).all(spaceId) as MemoryRow[];
    const q = query.toLocaleLowerCase();
    return records.filter(row => row.claim.toLocaleLowerCase().includes(q)).slice(0, 20)
      .map(row => ({ id: row.id, kind: row.kind, claim: row.claim,
        evidenceId: row.evidence_id, confirmedAt: row.confirmed_at ?? row.created_at }));
  }
  forget(spaceId: string, actor: Actor, memoryId: string): { count: number } {
    this.authorized(spaceId, actor, 'manage');
    if (actor.kind !== 'human') throw new MemoryError('human_confirmation_required', 403);
    const rows = this.db.prepare('SELECT id, supersedes FROM memories WHERE space_id=?')
      .all(spaceId) as Array<{id: string; supersedes: string | null}>;
    if (!rows.some(r => r.id === memoryId)) throw new MemoryError('not_found', 404);
    const ids = new Set([memoryId]);
    let size = 0;
    while (size !== ids.size) {
      size = ids.size;
      for (const row of rows) {
        if ((row.supersedes && ids.has(row.supersedes)) || (row.supersedes && ids.has(row.id))) {
          ids.add(row.id);
          ids.add(row.supersedes);
        }
      }
    }
    this.tx(() => {
      for (const id of ids) {
        this.db.prepare('DELETE FROM memories WHERE id=? AND space_id=?').run(id, spaceId);
        this.db.prepare('INSERT INTO deletion_ledger VALUES(?,?,?,?,?)')
          .run(randomUUID(), spaceId, id, actor.principalId, this.now());
        this.emit('memory.revoke', spaceId, id);
      }
      this.audit(spaceId, actor, 'memory.forget', memoryId);
    });
    return { count: ids.size };
  }
  eraseSpace(spaceId: string, actor: Actor): void {
    this.authorized(spaceId, actor, 'manage');
    if (actor.kind !== 'human') throw new MemoryError('human_confirmation_required', 403);
    this.tx(() => {
      this.db.prepare('DELETE FROM memories WHERE space_id=?').run(spaceId);
      this.db.prepare('DELETE FROM evidence WHERE space_id=?').run(spaceId);
      this.db.prepare('UPDATE spaces SET deleted_at=? WHERE id=?').run(this.now(), spaceId);
      this.db.prepare('INSERT INTO deletion_ledger VALUES(?,?,?,?,?)')
        .run(randomUUID(), spaceId, null, actor.principalId, this.now());
      this.emit('space.erased', spaceId, null);
      this.audit(spaceId, actor, 'space.erase', spaceId);
    });
  }
  pruneExpiredEvidence(): number {
    return Number(this.db.prepare(
      'UPDATE evidence SET content=NULL, redacted_at=? WHERE content IS NOT NULL AND expires_at <= ?'
    ).run(this.now(), this.now()).changes);
  }
  pendingOutbox(): Array<{ seq: number; event_type: string; space_id: string; object_id: string | null }> {
    return this.db.prepare('SELECT seq,event_type,space_id,object_id FROM outbox WHERE delivered_at IS NULL ORDER BY seq')
      .all() as Array<{ seq: number; event_type: string; space_id: string; object_id: string | null }>;
  }
  // Delivery and downstream deletion validation are intentionally NOT implemented in v0.1.
}
