import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { offlineServerEnv } from './studio-test-env.mjs';

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
  return { child, closed, port, logs: () => logs };
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

export function descendants(processes, roots) {
  const owned = new Map(processes.filter(({ pid }) => roots.includes(pid)).map((p) => [p.pid, p]));
  for (let size = -1; size !== owned.size; ) {
    size = owned.size;
    for (const entry of processes) {
      const parent = owned.get(entry.parent);
      // Windows retains the numeric parent PID after its original process exits.
      if (parent && (!entry.born || BigInt(entry.born) >= BigInt(parent.born))) {
        owned.set(entry.pid, entry);
      }
    }
  }
  return [...owned.values()];
}

function terminateWindows(processes) {
  if (!processes.length) return;
  const identities = processes.map(({ pid, born }) => `${pid}='${born}'`).join(';');
  // Check the creation time again at shutdown. A tree kill would follow stale parent PIDs.
  const script = `
    $owned = @{${identities}}
    Get-CimInstance Win32_Process | ForEach-Object {
      $id = [int]$_.ProcessId
      if ($owned.ContainsKey($id) -and $_.CreationDate.ToUniversalTime().Ticks.ToString() -eq $owned[$id]) {
        Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
      }
    }
  `;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      timeout: 12_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

function stopProcess(child, signal) {
  if (windows) return child.kill(signal);
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stopNode({ child, closed }) {
  if (child.pid) stopProcess(child, 'SIGTERM');
  try {
    await bounded(closed, 'server shutdown', 3_000);
  } catch {
    if (child.pid) stopProcess(child, 'SIGKILL');
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
  const directory = mkdtempSync(join(tmpdir(), 'eduharness-browser-'));
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
      const processes = processTree();
      const directRoots = processes.filter(
        ({ pid, parent }) => roots.includes(pid) && parent === process.pid,
      );
      owned = descendants(
        processes,
        directRoots.map(({ pid }) => pid),
      );
    } finally {
      try {
        if (windows)
          terminateWindows(
            descendants(
              owned,
              nodes.map(({ child }) => child.pid),
            ),
          );
        results = await Promise.allSettled([
          ...nodes.map(stopNode),
          chrome &&
            bounded(chrome.close(), 'Chromium close').catch(() =>
              bounded(chrome.kill(), 'Chromium kill'),
            ),
        ]);
        if (windows) terminateWindows(stillOwned());
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
    console.log(`Browser cleanup ${JSON.stringify(cleanup)}`);
    assert.deepEqual(
      results.filter(({ status }) => status === 'rejected'),
      [],
    );
    assert.deepEqual(listening, []);
    assert.deepEqual(remaining, []);
    assert.ok(cleanup.databaseDeleted);
  });

  const env = { ...offlineServerEnv(join(directory, '.env')), STUDIO_DB_PATH: database };
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
    `Browser startup (${useNpmDev ? 'npm run dev' : 'isolated servers'}): ${url}; ports=${[...ports]}; SQLite=${database}`,
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
  const logs = () => nodes.map((node) => node.logs()).join('\n');
  const databaseFiles = () =>
    Object.fromEntries(
      readdirSync(directory)
        .filter((name) => name.startsWith('studio.sqlite'))
        .map((name) => [name, readFileSync(join(directory, name))]),
    );
  return { page, url, errors, logs, databaseFiles };
}
