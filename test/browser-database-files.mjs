import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function readBrowserDatabaseFiles(directory) {
  const deadline = performance.now() + 2_000;
  for (;;) {
    try {
      const names = (await readdir(directory)).filter((name) => name.startsWith('studio.sqlite'));
      return Object.fromEntries(
        await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))])),
      );
    } catch (error) {
      // A browser ACK can briefly hold a Windows SQLite lock while this byte scan runs.
      if (error.code !== 'EBUSY' || performance.now() >= deadline) throw error;
      await delay(20);
    }
  }
}
