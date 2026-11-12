import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { MemoryError, MemoryStore, type Actor } from './store.ts';

type TokenConfig = Actor & { token: string };
function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 32768) { reject(new MemoryError('payload_too_large', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
        resolve(value as Record<string, unknown>);
      } catch { reject(new MemoryError('invalid_json')); }
    });
    req.on('error', reject);
  });
}
function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }
function authenticate(req: IncomingMessage, keys: TokenConfig[]): Actor {
  const raw = req.headers.authorization;
  if (!raw || !raw.startsWith('Bearer ')) throw new MemoryError('unauthorized', 401);
  const candidate = digest(raw.slice(7));
  for (const entry of keys) {
    if (timingSafeEqual(candidate, digest(entry.token))) {
      return { principalId: entry.principalId, tenantId: entry.tenantId,
        kind: entry.kind, scopes: entry.scopes };
    }
  }
  throw new MemoryError('unauthorized', 401);
}
function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function createMemoryServer(store: MemoryStore, keys: TokenConfig[]) {
  if (!Array.isArray(keys) || keys.length === 0 ||
    keys.some(k => typeof k.token !== 'string' || k.token.length < 24)) {
    throw new Error('LUMIMEMORY_TOKENS_JSON requires non-empty tokens of >=24 characters');
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        send(res, 200, { ok: true, product: 'LumiMemory', version: '0.1.0' }); return;
      }
      const actor = authenticate(req, keys);
      if (req.method === 'POST' && url.pathname === '/v1/spaces') {
        const b = await body(req);
        send(res, 201, store.createSpace(actor, b as Parameters<MemoryStore['createSpace']>[1]));
        return;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 3 && parts[0] === 'v1' && parts[1] === 'spaces') {
        const space = parts[2]!;
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'evidence') {
          send(res, 201, store.addEvidence(space, actor,
            await body(req) as Parameters<MemoryStore['addEvidence']>[2])); return;
        }
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'memories') {
          send(res, 201, store.propose(space, actor,
            await body(req) as Parameters<MemoryStore['propose']>[2])); return;
        }
        if (req.method === 'GET' && parts.length === 4 && parts[3] === 'memories') {
          send(res, 200, { items: store.recall(space, actor, url.searchParams.get('query') ?? '') }); return;
        }
        if (req.method === 'POST' && parts.length === 6 &&
          parts[3] === 'memories' && parts[5] === 'confirm') {
          store.confirm(space, actor, parts[4]!);
          send(res, 200, { ok: true }); return;
        }
        if (req.method === 'POST' && parts.length === 6 &&
          parts[3] === 'memories' && parts[5] === 'correct') {
          send(res, 201, store.correct(space, actor, parts[4]!,
            await body(req) as Parameters<MemoryStore['correct']>[3])); return;
        }
        if (req.method === 'DELETE' && parts.length === 5 && parts[3] === 'memories') {
          send(res, 200, store.forget(space, actor, parts[4]!)); return;
        }
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'erase') {
          store.eraseSpace(space, actor); send(res, 200, { ok: true }); return;
        }
      }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof MemoryError) {
        if (!res.headersSent) send(res, error.status, { error: error.code });
      } else {
        if (!res.headersSent) send(res, 500, { error: 'internal_error' });
      }
    }
  });
}
