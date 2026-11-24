import { randomUUID } from 'node:crypto';
import type { sessionDatabase } from './session-db.js';
import type { TeacherOperationLock } from './session-teacher.js';

type Store = ReturnType<typeof sessionDatabase>;
type TeacherTurnBusy = { error: 'teacher_turn_busy' };

const leaseMs = 300_000;
export const teacherTurnBusy: TeacherTurnBusy = { error: 'teacher_turn_busy' };

export function createSessionLocks(store: Store) {
  const held = new Set<string>();

  async function run<T>(key: string, work: (lock: TeacherOperationLock) => T | Promise<T>) {
    if (held.has(key)) return teacherTurnBusy;
    held.add(key);
    const lock = { scope: key, token: randomUUID() };
    let acquired = false;
    try {
      acquired = store.transaction(() => store.acquireTeacherLock(lock.scope, lock.token, leaseMs));
      if (!acquired) return teacherTurnBusy;
      return await work(lock);
    } finally {
      try {
        if (acquired) store.transaction(() => store.releaseTeacherLock(lock.scope, lock.token));
      } finally {
        held.delete(key);
      }
    }
  }

  return { run };
}
