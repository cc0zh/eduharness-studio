import type { DatabaseSync } from 'node:sqlite';
import type {
  LessonBasis,
  LessonRecord,
  LessonScript,
  LessonTraceSpan,
  TeacherTurnTrace,
  TeachingState,
  TeachingTransition,
} from '@eduharness-studio/engine';
import type { TeacherProgress } from '@eduharness-studio/engine/teacher';

const sessionVersion = 1;
const currentFormat = `json_extract(snapshot_json, '$.version') = ${sessionVersion}`;

interface QueueData {
  version: typeof sessionVersion;
  generation: number;
  retired: boolean;
  askStep: number | null;
  topic: string;
  script: LessonScript;
  teacher?: TeacherProgress;
  basis?: LessonBasis;
}

export interface StoredSession {
  id: string;
  state: TeachingState;
  lastPlayed: number;
  queue: QueueData;
}

/** Shared persisted reads; safe to construct with a read-only SQLite connection. */
export function sessionReader(db: DatabaseSync) {
  const get = db.prepare(`
    SELECT id, state, COALESCE(last_played_step_id, 0) AS lastPlayed, snapshot_json
    FROM sessions WHERE id = ? AND ${currentFormat}
  `);
  const records = db.prepare(`
    SELECT payload_json FROM session_events WHERE session_id = ?
      AND kind IN ('subtitle', 'answer', 'interrupt') ORDER BY id
  `);
  const playedSteps = db.prepare(`
    SELECT payload_json FROM session_events
    WHERE session_id = ? AND kind = 'played-step' ORDER BY id
  `);
  return {
    load(id: string): StoredSession | undefined {
      const row = get.get(id) as
        | { id: string; state: TeachingState; lastPlayed: number; snapshot_json: string }
        | undefined;
      if (!row) return undefined;
      const { snapshot_json, ...fields } = row;
      return { ...fields, queue: JSON.parse(snapshot_json) as QueueData };
    },
    records(id: string) {
      return records
        .all(id)
        .map(({ payload_json }) => JSON.parse(String(payload_json)) as LessonRecord);
    },
    playedStepIds(id: string) {
      return playedSteps.all(id).map(({ payload_json }) => {
        const payload = JSON.parse(String(payload_json)) as { step_id?: unknown } | null;
        return payload?.step_id;
      });
    },
    latestId() {
      const row = db
        .prepare(`
        SELECT id FROM sessions WHERE ${currentFormat} AND json_extract(snapshot_json, '$.retired') = 0
        ORDER BY updated_at DESC, rowid DESC LIMIT 1
      `)
        .get();
      return typeof row?.id === 'string' ? row.id : undefined;
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

export function sessionDatabase(db: DatabaseSync) {
  const reader = sessionReader(db);
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
  const diagnosticEvents = db.prepare(`
    SELECT kind, payload_json FROM session_events WHERE session_id = ?
      AND kind IN ('state', 'trace', 'teacher-turn') ORDER BY id
  `);
  const rotated = db.prepare(`
    SELECT 1 FROM session_events WHERE session_id = ? AND kind = 'interrupt'
      AND json_extract(payload_json, '$.previous_generation') = ? LIMIT 1
  `);
  const acquireTeacherLock = db.prepare(`
    INSERT INTO teacher_turn_locks (scope, token, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE teacher_turn_locks.expires_at <= ?
  `);
  const ownsTeacherLock = db.prepare(
    'SELECT 1 FROM teacher_turn_locks WHERE scope = ? AND token = ? AND expires_at > ?',
  );
  const releaseTeacherLock = db.prepare(
    'DELETE FROM teacher_turn_locks WHERE scope = ? AND token = ?',
  );
  const activeTeacherLock = db.prepare(
    'SELECT 1 FROM teacher_turn_locks WHERE scope LIKE ? AND expires_at > ? LIMIT 1',
  );

  return {
    ...reader,
    latest(courseId: string, lessonId: string) {
      const row = latest.get(courseId, lessonId);
      return typeof row?.id === 'string' ? reader.load(row.id) : undefined;
    },
    hasUnversioned(courseId: string, lessonId: string) {
      return Boolean(unversioned.get(courseId, lessonId));
    },
    hasUnversionedId(id: string) {
      return Boolean(unversionedById.get(id));
    },
    insert(
      id: string,
      courseId: string,
      lessonId: string,
      topic: string,
      script: LessonScript,
      metadata: Pick<QueueData, 'teacher' | 'basis'> = {},
    ) {
      const queue: QueueData = {
        version: sessionVersion,
        generation: 0,
        retired: false,
        askStep: null,
        topic,
        script,
        ...metadata,
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
    acquireTeacherLock(scope: string, token: string, leaseMs: number) {
      const now = Date.now();
      return acquireTeacherLock.run(scope, token, now + leaseMs, now).changes === 1;
    },
    ownsTeacherLock(scope: string, token: string) {
      return Boolean(ownsTeacherLock.get(scope, token, Date.now()));
    },
    releaseTeacherLock(scope: string, token: string) {
      releaseTeacherLock.run(scope, token);
    },
    hasTeacherLock(prefix: string) {
      return Boolean(activeTeacherLock.get(`${prefix}%`, Date.now()));
    },
    lastEvent(id: string, kind: string): unknown {
      const row = lastEvent.get(id, kind);
      return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) : undefined;
    },
    diagnostics(id: string) {
      const transitions: TeachingTransition[] = [];
      const spans: LessonTraceSpan[] = [];
      const teacherTurns: TeacherTurnTrace[] = [];
      for (const { kind, payload_json } of diagnosticEvents.all(id)) {
        const payload: unknown = JSON.parse(String(payload_json));
        if (kind === 'state') transitions.push(payload as TeachingTransition);
        else if (kind === 'teacher-turn') teacherTurns.push(payload as TeacherTurnTrace);
        else spans.push(payload as LessonTraceSpan);
      }
      return {
        transitions,
        spans,
        playedStepIds: reader.playedStepIds(id).filter((step) => typeof step === 'number'),
        ...(teacherTurns.length ? { teacherTurns } : {}),
      };
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
  };
}
