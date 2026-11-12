import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryStore, type Actor } from './store.ts';
import { createMemoryServer } from './server.ts';

const path = process.env.LUMIMEMORY_DB ?? './data/lumimemory.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const raw = process.env.LUMIMEMORY_TOKENS_JSON;
if (!raw) throw new Error('Set LUMIMEMORY_TOKENS_JSON with trusted caller tokens');
const keys = JSON.parse(raw) as Array<Actor & {token: string}>;
const store = new MemoryStore(path);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '8787');
createMemoryServer(store, keys).listen(port, host, () => {
  console.log('LumiMemory listening on ' + host + ':' + port);
});
