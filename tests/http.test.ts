import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MemoryStore } from '../src/store.ts';
import { createMemoryServer } from '../src/server.ts';

test('HTTP auth, human confirmation, tenant isolation and recall', async () => {
  const store = new MemoryStore(':memory:');
  const human = 'test-human-token-01234567890123456789';
  const agent = 'test-agent-token-01234567890123456789';
  const outsider = 'test-other-token-01234567890123456789';
  const server = createMemoryServer(store, [
    { token:human, tenantId:'tenant-a', principalId:'human-a', kind:'human', scopes:['spaces:create'] },
    { token:agent, tenantId:'tenant-a', principalId:'human-a', kind:'agent', scopes:[] },
    { token:outsider, tenantId:'tenant-b', principalId:'other', kind:'human', scopes:['spaces:create'] }
  ]);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const post = (path: string, token: string, obj: unknown) =>
    fetch(base + path, { method:'POST', headers:{authorization:'Bearer ' + token,
      'content-type':'application/json'}, body:JSON.stringify(obj) });
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/v1/spaces')).status, 401);
    const created = await post('/v1/spaces', human,
      { ownerSubjectId:'person-a', evidenceRetentionDays:7, principalId:'arbitrary' });
    assert.equal(created.status, 201);
    const { id: spaceId } = await created.json() as { id: string };
    assert.equal((await fetch(base + '/v1/spaces/' + spaceId + '/memories',
      { headers:{ authorization:'Bearer ' + outsider } })).status, 404);
    const evResponse = await post('/v1/spaces/' + spaceId + '/evidence', human,
      { subjectId:'person-a', content:'synthetic love of dinosaurs',
        sourceSystem:'synthetic-test', sourceRef:'event-1' });
    assert.equal(evResponse.status, 201);
    const { id:evidenceId } = await evResponse.json() as {id:string};
    const p = await post('/v1/spaces/' + spaceId + '/memories', human,
      { subjectId:'person-a', kind:'preference', claim:'likes dinosaurs', evidenceId });
    assert.equal(p.status, 201);
    const {id:memoryId} = await p.json() as {id:string};
    const listPath = '/v1/spaces/' + spaceId + '/memories?query=dinosaurs';
    const get = (token: string) => fetch(base + listPath, {headers:{authorization:'Bearer ' + token}});
    assert.equal(((await (await get(human)).json()) as {items:unknown[]}).items.length, 0);
    assert.equal((await post('/v1/spaces/' + spaceId + '/memories/' + memoryId + '/confirm',
      agent, {})).status, 403);
    assert.equal((await post('/v1/spaces/' + spaceId + '/memories/' + memoryId + '/confirm',
      human, {})).status, 200);
    assert.equal(((await (await get(human)).json()) as {items:unknown[]}).items.length, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  }
});
