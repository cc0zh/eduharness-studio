import { appendFileSync } from 'node:fs';
import { Socket } from 'node:net';

const connect = Socket.prototype.connect;
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

if (process.env.STUDIO_TEST_NETWORK_LOG) {
  Socket.prototype.connect = function fencedConnect(...args) {
    // net.createConnection and Undici can pass a normalized [options, callback] tuple.
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof first === 'object' && first !== null ? first : undefined;
    const host = options?.host ?? (typeof second === 'string' ? second : undefined);
    const ipc = options
      ? options.path && !options.port
      : typeof first === 'string' && !/^\d+$/.test(first);
    if (!ipc && !loopback.has(host)) {
      appendFileSync(process.env.STUDIO_TEST_NETWORK_LOG, 'blocked non-loopback TCP connect\n');
      throw new Error('Offline network fence: non-loopback TCP connect');
    }
    return Reflect.apply(connect, this, args);
  };
}
