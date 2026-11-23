import type { DatabaseSync } from 'node:sqlite';
import type { LessonRecord, LessonScript, TeachingState } from '@eduharness-studio/engine';

const sessionVersion = 1;
const currentFormat = `json_extract(snapshot_json, '$.version') = ${sessionVersion}`;

interface QueueData {
  version: typeof sessionVersion;
  generation: number;
  retired: boolean;
  askStep: number | null;
  topic: string;
  script: LessonScript;
}

export interface StoredSession {
  id: string;
  state: TeachingState;
  lastPlayed: number;
  queue: QueueData;
}

export function sessionDatabase(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO sessions (id, course_id, lesson_id, state, last_played_step_id, snapshot_json, updated_at)
    VALUES (?, ?, ?, 'intake', NULL, ?, ?)
  `);
  const latest = db.prepare(`
    SELECT id FROM sessions WHERE course_id = ? AND lesson_id = ? AND ${currentFormat}
      AND json_extract(snapshot_json, '$.retired') = 0
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `);
  const unversioned = db.prepare(`
    SELECT 1 FROM sessions WHERE course_id = ? AND lesson_id = ?
      AND json_type(snapshot_json, '$.version') IS NULL
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `);
  const unversionedById = db.prepare(`
    SELECT 1 FROM sessions WHERE id = ?
      AND json_type(snapshot_json, '$.version') IS NULL LIMIT 1
  `);
  const get = db.prepare(`
    SELECT id, state, COALESCE(last_played_step_id, 0) AS lastPlayed, snapshot_json
    FROM sessions WHERE id = ? AND ${currentFormat}
  `);
  const header = db.prepare(`
    SELECT state, COALESCE(last_played_step_id, 0) AS lastPlayed,
      json_extract(snapshot_json, '$.generation') AS generation,
      json_extract(snapshot_json, '$.askStep') AS askStep,
      json_extract(snapshot_json, '$.retired') AS retired
    FROM sessions WHERE id = ? AND ${currentFormat}
  `);
  const update = db.prepare(`
    UPDATE sessions SET state = ?, last_played_step_id = ?, snapshot_json = ?, updated_at = ?
    WHERE id = ?
  `);
  const append = db.prepare(`
    INSERT INTO session_events (session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)
  `);
  const lastEvent = db.prepare(`
    SELECT payload_json FROM session_events WHERE session_id = ? AND kind = ? ORDER BY id DESC LIMIT 1
  `);
  const records = db.prepare(`
    SELECT payload_json FROM session_events WHERE session_id = ?
      AND kind IN ('subtitle', 'answer', 'interrupt') ORDER BY id
  `);
  const rotated = db.prepare(`
    SELECT 1 FROM session_events WHERE session_id = ? AND kind = 'interrupt'
      AND json_extract(payload_json, '$.previous_generation') = ? LIMIT 1
  `);

  function load(id: string): StoredSession | undefined {
    const row = get.get(id) as
      | { id: string; state: TeachingState; lastPlayed: number; snapshot_json: string }
      | undefined;
    if (!row) return undefined;
    const { snapshot_json, ...fields } = row;
    return { ...fields, queue: JSON.parse(snapshot_json) as QueueData };
  }

  return {
    load,
    latest(courseId: string, lessonId: string) {
      const row = latest.get(courseId, lessonId);
      return typeof row?.id === 'string' ? load(row.id) : undefined;
    },
    hasUnversioned(courseId: string, lessonId: string) {
      return Boolean(unversioned.get(courseId, lessonId));
    },
    hasUnversionedId(id: string) {
      return Boolean(unversionedById.get(id));
    },
    insert(id: string, courseId: string, lessonId: string, topic: string, script: LessonScript) {
      const queue: QueueData = {
        version: sessionVersion,
        generation: 0,
        retired: false,
        askStep: null,
        topic,
        script,
      };
      insert.run(id, courseId, lessonId, JSON.stringify(queue), new Date().toISOString());
      return { id, state: 'intake', lastPlayed: 0, queue } satisfies StoredSession;
    },
    header(id: string) {
      return header.get(id) as
        | (Pick<StoredSession, 'state' | 'lastPlayed'> & {
            generation: number;
            askStep: number | null;
            retired: number;
          })
        | undefined;
    },
    save({ id, state, lastPlayed, queue }: StoredSession) {
      update.run(state, lastPlayed || null, JSON.stringify(queue), new Date().toISOString(), id);
    },
    append(id: string, kind: string, payload: object) {
      append.run(id, kind, JSON.stringify(payload), new Date().toISOString());
    },
    lastEvent(id: string, kind: string): unknown {
      const row = lastEvent.get(id, kind);
      return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) : undefined;
    },
    records(id: string) {
      return records
        .all(id)
        .map(({ payload_json }) => JSON.parse(String(payload_json)) as LessonRecord);
    },
    wasInterrupted(id: string, generation: number) {
      return Boolean(rotated.get(id, generation));
    },
    transaction<T>(write: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = write();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    readTransaction<T>(read: () => T): T {
      db.exec('BEGIN');
      try {
        const result = read();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
