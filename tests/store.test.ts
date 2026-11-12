import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, MemoryError, type Actor } from '../src/store.ts';

const parent: Actor = { tenantId: 'family-a', principalId: 'parent-a', kind: 'human', scopes: ['spaces:create'] };
const other: Actor = { tenantId: 'family-b', principalId: 'stranger', kind: 'human', scopes: ['spaces:create'] };
const agent: Actor = { tenantId: 'family-a', principalId: 'parent-a', kind: 'agent', scopes: [] };
function fixture(policyPack: 'personal-default' | 'child-guarded' = 'personal-default') {
  const store = new MemoryStore(':memory:');
  const space = store.createSpace(parent, { ownerSubjectId: 'person-a', policyPack, evidenceRetentionDays: 7 });
  const evidence = store.addEvidence(space.id, parent, { subjectId: 'person-a',
    content: '我喜欢恐龙', sourceSystem: 'synthetic-test', sourceRef: 'event-1' });
  return { store, space, evidence };
}

test('candidate never appears in recall before human confirmation', () => {
  const { store, space, evidence } = fixture();
  const m = store.propose(space.id, parent, { subjectId: 'person-a',
    kind: 'preference', claim: '喜欢恐龙', evidenceId: evidence.id });
  assert.deepEqual(store.recall(space.id, parent, '恐龙'), []);
  assert.throws(() => store.confirm(space.id, agent, m.id), /human_confirmation_required/);
  store.confirm(space.id, parent, m.id);
  assert.equal(store.recall(space.id, parent, '恐龙').length, 1);
  assert.equal(store.pendingOutbox().length, 1);
  store.close();
});
test('tenant isolation is enforced before returning evidence or recall', () => {
  const { store, space } = fixture();
  assert.throws(() => store.recall(space.id, other), /not_found/);
  assert.throws(() => store.addEvidence(space.id, other, { subjectId:'person-a',
    content:'x', sourceSystem:'test', sourceRef:'1' }), /not_found/);
  store.close();
});
test('correction supersedes old claim; forget removes complete lineage', () => {
  const { store, space, evidence } = fixture();
  const m = store.propose(space.id, parent, { subjectId: 'person-a',
    kind: 'preference', claim: '喜欢恐龙', evidenceId: evidence.id });
  store.confirm(space.id, parent, m.id);
  const nextEvidence = store.addEvidence(space.id, parent, { subjectId:'person-a',
    content:'我现在更喜欢海洋动物', sourceSystem:'synthetic-test', sourceRef:'event-2' });
  const next = store.correct(space.id, parent, m.id, {
    claim:'喜欢海洋动物', evidenceId:nextEvidence.id });
  assert.equal(store.recall(space.id, parent, '恐龙').length, 0);
  assert.equal(store.recall(space.id, parent, '海洋').length, 1);
  assert.equal(store.forget(space.id, parent, m.id).count, 2);
  assert.equal(store.recall(space.id, parent).length, 0);
  assert.ok(store.pendingOutbox().some(x => x.event_type === 'memory.revoke' && x.object_id === next.id));
  store.close();
});
test('child-guarded policy refuses labelled inferences and retains max 7 days', () => {
  const { store, space, evidence } = fixture('child-guarded');
  assert.throws(() => store.propose(space.id, parent, { subjectId:'person-a',
    kind:'fact', claim:'孩子诊断为抑郁症', evidenceId:evidence.id }), /protected_inference/);
  assert.throws(() => store.createSpace(parent, { ownerSubjectId:'person-b',
    policyPack:'child-guarded', evidenceRetentionDays:30 }), /invalid_retention/);
  store.close();
});
test('erase makes the whole space inaccessible and emits tombstone', () => {
  const { store, space } = fixture();
  store.eraseSpace(space.id, parent);
  assert.throws(() => store.recall(space.id, parent), /not_found/);
  assert.ok(store.pendingOutbox().some(x => x.event_type === 'space.erased'));
  store.close();
});
test('evidence saving is disabled by default', () => {
  const store = new MemoryStore(':memory:');
  const space = store.createSpace(parent, { ownerSubjectId: 'person-a' });
  assert.throws(() => store.addEvidence(space.id, parent, {
    subjectId:'person-a', content:'secret', sourceSystem:'test', sourceRef:'1'
  }), /evidence_disabled/);
  store.close();
});
test('evidence expiration redacts raw text, preventing future proposals', () => {
  let clock = '2026-11-12T00:00:00.000Z';
  const store = new MemoryStore(':memory:', () => clock);
  const space = store.createSpace(parent, { ownerSubjectId:'person-a', evidenceRetentionDays:1 });
  const ev = store.addEvidence(space.id, parent, { subjectId:'person-a',
    content:'synthetic', sourceSystem:'test', sourceRef:'1' });
  clock = '2026-11-14T00:00:00.000Z';
  assert.equal(store.pruneExpiredEvidence(), 1);
  assert.throws(() => store.propose(space.id, parent, { subjectId:'person-a',
    kind:'fact', claim:'foo', evidenceId:ev.id }), /invalid_evidence/);
  store.close();
});
