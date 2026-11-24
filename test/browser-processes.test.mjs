import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descendants } from './browser-fixture.mjs';

test('browser cleanup excludes unrelated Windows processes with a reused parent PID', () => {
  const processes = [
    { pid: 22, parent: 10, born: '639310860832513060' },
    { pid: 23, parent: 22, born: '639311238357603530' },
    { pid: 10, parent: 1, born: '639311238347783040' },
    { pid: 24, parent: 10, born: '639311238348822050' },
    { pid: 25, parent: 24, born: '639311238354125770' },
  ];
  assert.deepEqual(
    descendants(processes, [10]).map(({ pid }) => pid),
    [10, 24, 25],
  );
});
