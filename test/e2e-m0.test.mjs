import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const devScript = join(root, 'scripts', 'dev.mjs');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to allocate free port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

function terminate(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      resolve();
      return;
    }
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000).unref();
  });
}

test('M0 E2E smoke: scripts/dev.mjs launches Hono server + Vite web and proxies /api/health', async () => {
  const apiPort = await getFreePort();
  const webPort = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(apiPort),
    WEB_PORT: String(webPort),
    STUDIO_DB_PATH: ':memory:',
  };

  let logs = '';
  const devProc = spawn(process.execPath, [devScript], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devProc.stdout.on('data', (d) => {
    logs += d.toString();
  });
  devProc.stderr.on('data', (d) => {
    logs += d.toString();
  });

  try {
    await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
    const htmlRes = await waitForHttp(`http://127.0.0.1:${webPort}/`);
    const html = await htmlRes.text();
    assert.match(html, /Eduharness课堂/);
    assert.match(html, /\/src\/main\.tsx/);

    const proxiedHealthRes = await fetch(`http://127.0.0.1:${webPort}/api/health`);
    assert.equal(proxiedHealthRes.status, 200);
    const health = await proxiedHealthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, 'eduharness-studio-server');
    assert.equal(health.sqlite, 'ok');
    assert.equal(health.protocolVersion, '0.1.0');
    assert.ok(health.tables >= 3);

    const metaRes = await fetch(`http://127.0.0.1:${webPort}/api/meta`);
    assert.equal(metaRes.status, 200);
    const meta = await metaRes.json();
    assert.equal(meta.architecture, 'two-layer-dynamic-curriculum');
  } catch (err) {
    throw new Error(`${err.message}\n--- dev logs ---\n${logs}`);
  } finally {
    await terminate(devProc);
  }
});
