import assert from 'node:assert/strict';
import { createServer } from 'node:net';

// Chromium background sockets also go through this closed proxy, outside page.route coverage.
export async function browserNetworkTrap() {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  return {
    proxy: { server: `http://127.0.0.1:${server.address().port}`, bypass: '127.0.0.1' },
    args: ['--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    connections: () => connections,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function monitorPage(page, allows) {
  const counts = { consoleErrors: 0, pageErrors: 0, nonLoopbackRequests: 0 };
  const details = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    counts.consoleErrors++;
    consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  page.on('pageerror', (error) => {
    counts.pageErrors++;
    details.push(error.message);
  });
  await page.context().route('**/*', (route) => {
    if (allows(new URL(route.request().url()))) return route.continue();
    counts.nonLoopbackRequests++;
    return route.abort();
  });
  await page.context().routeWebSocket(/.*/, (socket) => {
    if (allows(new URL(socket.url()))) socket.connectToServer();
    else {
      counts.nonLoopbackRequests++;
      return socket.close();
    }
  });
  return {
    counts,
    verify(isFaux, failedModelUrl) {
      assert.equal(counts.nonLoopbackRequests, 0, 'Unexpected browser network request');
      assert.equal(counts.pageErrors, 0, isFaux ? details.join('\n') : 'Unexpected page error');
      // Chromium can report the known generation 502 as a console resource error.
      const unexpected = consoleErrors.filter(
        ({ text, url }) =>
          !failedModelUrl ||
          url !== failedModelUrl ||
          !/^Failed to load resource: .*\b502\b/.test(text),
      );
      assert.equal(
        unexpected.length,
        0,
        isFaux ? unexpected.map(({ text }) => text).join('\n') : 'Unexpected browser console error',
      );
    },
  };
}
