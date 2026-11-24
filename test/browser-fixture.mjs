import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const host = '127.0.0.1';
const windows = process.platform === 'win32';
const apiLine = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
const webLine = /Local:\s+http:\/\/127\.0\.0\.1:(\d+)/;

async function bounded(work, description, ms = 6_000) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      work,
      delay(ms, undefined, { signal: timer.signal }).then(() => {
        throw new Error(`${description} timed out`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}

function startNode(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    detached: !windows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.on('error', (error) => {
    logs += String(error);
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  async function port(pattern, signal) {
    const deadline = Date.now() + 18_000;
    while (Date.now() < deadline) {
      const match = pattern.exec(logs);
      if (match) return Number(match[1]);
      if (child.exitCode !== null || !child.pid) break;
      await delay(60, undefined, { signal });
    }
    throw new Error(`Server never listened (${args.join(' ')}):\n${logs}`);
  }
  return { child, closed, port };
}

function processTree() {
  if (windows) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.ParentProcessId -ne $PID -and $_.CreationDate } | ForEach-Object { "{0} {1} {2} {3}" -f $_.ProcessId,$_.ParentProcessId,$_.Name,$_.CreationDate.ToUniversalTime().Ticks }',
      ],
      { encoding: 'utf8', timeout: 12_000, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [pid, parent, name, born] = line.trim().split(/\s+/);
        return { pid: Number(pid), parent: Number(parent), name, born };
      });
  }
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,stat=,comm='], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [pid, parent, state, name] = line.trim().split(/\s+/);
      return state?.startsWith('Z') ? [] : [{ pid: Number(pid), parent: Number(parent), name }];
    });
}

function descendants(processes, roots) {
  const owned = new Set(roots);
  for (let size = -1; size !== owned.size; ) {
    size = owned.size;
    for (const { pid, parent } of processes) if (owned.has(parent)) owned.add(pid);
  }
  return processes.filter(({ pid }) => owned.has(pid));
}

function killTree(pid, signal) {
  if (windows) {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 8_000,
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function stopNode({ child, closed }) {
  if (child.pid) killTree(child.pid, 'SIGTERM');
  try {
    await bounded(closed, 'server shutdown', 3_000);
  } catch {
    if (child.pid) killTree(child.pid, 'SIGKILL');
    await bounded(closed, 'forced server shutdown');
  }
}

function openPort(port) {
  return new Promise((resolve, reject) => {
    const connection = createConnection({ host, port });
    connection.on('connect', () => {
      connection.destroy();
      resolve(port);
    });
    connection.on('error', (error) =>
      error.code === 'ECONNREFUSED' ? resolve(undefined) : reject(error),
    );
    connection.setTimeout(3_000, () =>
      connection.destroy(new Error(`Port probe timed out: ${port}`)),
    );
  });
}

async function freePorts(count) {
  // Vite 6 treats port 0 as its default port. Hold simultaneous allocations until handoff.
  const sockets = Array.from({ length: count }, () => createServer());
  try {
    return await Promise.all(
      sockets.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.on('error', reject).listen(0, host, () => resolve(server.address().port));
          }),
      ),
    );
  } finally {
    await Promise.all(sockets.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

export async function startBrowserFixture(t, { useNpmDev } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-m1-'));
  const database = join(directory, 'studio.sqlite');
  const nodes = [];
  const ports = new Set();
  let launching;

  t.after(async () => {
    const chrome = await launching?.catch(() => undefined);
    const roots = [...nodes.map(({ child }) => child.pid), chrome?.process().pid].filter(Boolean);
    let owned = [];
    let results;
    const databaseExisted = existsSync(database);
    function stillOwned() {
      const current = processTree();
      // Windows can reuse a PID immediately. Never check or terminate by the PID alone.
      const active = owned.filter(({ pid, name, born }) =>
        current.some(
          (process) => process.pid === pid && process.name === name && process.born === born,
        ),
      );
      return descendants(
        current,
        active.map(({ pid }) => pid),
      );
    }
    try {
      owned = descendants(processTree(), roots);
    } finally {
      try {
        results = await Promise.allSettled([
          ...nodes.map(stopNode),
          chrome &&
            bounded(chrome.close(), 'Chromium close').catch(() =>
              bounded(chrome.kill(), 'Chromium kill'),
            ),
        ]);
        if (windows) {
          // A failed wrapper may have exited before taskkill could traverse its tree.
          for (const { pid } of stillOwned()) killTree(pid, 'SIGKILL');
        }
      } finally {
        rmSync(directory, { force: true, recursive: true, maxRetries: 8, retryDelay: 120 });
      }
    }
    const remaining = stillOwned();
    const listening = (await Promise.all([...ports].map(openPort))).filter(Boolean);
    const cleanup = {
      ports: [...ports],
      listening,
      owned,
      remaining,
      database,
      databaseExisted,
      databaseDeleted: !existsSync(directory),
    };
    console.log(`M1 browser cleanup ${JSON.stringify(cleanup)}`);
    assert.deepEqual(
      results.filter(({ status }) => status === 'rejected'),
      [],
    );
    assert.deepEqual(listening, []);
    assert.deepEqual(remaining, []);
    assert.ok(cleanup.databaseDeleted);
  });

  const env = { ...process.env, STUDIO_DB_PATH: database, NO_COLOR: '1', FORCE_COLOR: '0' };
  let webPort;
  const { signal } = t;
  if (useNpmDev) {
    assert.ok(process.env.npm_execpath, 'Start this check via npm run test:e2e');
    const [api, web] = await freePorts(2);
    ports.add(api).add(web);
    signal.throwIfAborted();
    const dev = startNode([process.env.npm_execpath, 'run', 'dev'], {
      ...env,
      PORT: String(api),
      WEB_PORT: String(web),
    });
    nodes.push(dev);
    assert.deepEqual(await Promise.all([dev.port(apiLine, signal), dev.port(webLine, signal)]), [
      api,
      web,
    ]);
    webPort = web;
  } else {
    const api = startNode(['--import', 'tsx', 'apps/server/src/index.ts'], { ...env, PORT: '0' });
    nodes.push(api);
    const apiPort = await api.port(apiLine, signal);
    ports.add(apiPort);
    signal.throwIfAborted();
    const [allocated] = await freePorts(1);
    ports.add(allocated);
    signal.throwIfAborted();
    const web = startNode(['node_modules/vite/bin/vite.js', 'apps/web'], {
      ...env,
      PORT: String(apiPort),
      WEB_PORT: String(allocated),
    });
    nodes.push(web);
    webPort = await web.port(webLine, signal);
    assert.equal(webPort, allocated);
  }
  const url = `http://${host}:${webPort}`;
  const health = await fetch(`${url}/api/health`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).sqlite, 'ok');
  assert.ok(existsSync(database));
  console.log(
    `M1 browser startup (${useNpmDev ? 'npm run dev' : 'isolated servers'}): ${url}; ports=${[...ports]}; SQLite=${database}`,
  );

  signal.throwIfAborted();
  launching = chromium.launchServer({ timeout: 15_000 });
  const chrome = await launching;
  signal.throwIfAborted();
  const browser = await chromium.connect(chrome.wsEndpoint(), { timeout: 8_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  page.setDefaultTimeout(6_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, url, errors };
}
