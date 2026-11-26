import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { offlineNetworkEnv } from '../studio-test-env.mjs';

export async function fenceM3Tests() {
  const dir = mkdtempSync(join(tmpdir(), 'studio-m3-network-'));
  const log = join(dir, 'fence.log');
  Object.assign(process.env, offlineNetworkEnv(log));
  await import('../network-fence.mjs');
  after(() => {
    try {
      assert.equal(readFileSync(log, 'utf8'), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export function scratch(t) {
  const path = mkdtempSync(join(tmpdir(), 'studio-m3-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 }));
  return path;
}

export async function countedUpstream(t, { status = 204, path = '/model' } = {}) {
  const received = [];
  const server = createServer((request, response) => {
    received.push(`${request.method} ${request.url}`);
    request.once('end', () => response.writeHead(status).end());
    request.resume();
  });
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return { endpoint: `http://127.0.0.1:${server.address().port}${path}`, received };
}

export function ledger(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
