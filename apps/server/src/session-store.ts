import { randomUUID } from 'node:crypto';
import {
  type LessonBeat,
  type LessonScript,
  LessonScriptSchema,
  readLessonBeat,
} from '@eduharness-studio/engine';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { StudioDatabase } from './db.js';

const positiveId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const ProgressSchema = Type.Object(
  { generation: positiveId, last_played_step_id: positiveId },
  { additionalProperties: false },
);
export const AnswerSchema = Type.Object(
  {
    generation: positiveId,
    ask_step_id: positiveId,
    text: Type.String({ pattern: '\\S', maxLength: 1000 }),
  },
  { additionalProperties: false },
);

type ActiveStream = { id: string; generation: number; script: LessonScript };
type UpdateResult = 'ok' | 'session_not_found' | 'stale_generation' | 'unexpected_step';
type BeatPoll = { kind: 'beat'; beat: LessonBeat } | { kind: 'waiting' | 'done' | 'superseded' };

export function createSessionStore({ db }: StudioDatabase) {
  const insert = db.prepare(`
    INSERT INTO sessions (id, course_id, lesson_id, state, last_played_step_id, snapshot_json, updated_at)
    VALUES (?, ?, ?, 'scaffold', NULL, ?, ?)
  `);
  const bumpGeneration = db.prepare(`
    UPDATE sessions
    SET snapshot_json = json_set(snapshot_json, '$.generation', json_extract(snapshot_json, '$.generation') + 1),
      updated_at = ?
    WHERE id = ?
    RETURNING json_extract(snapshot_json, '$.generation') AS generation,
      json_extract(snapshot_json, '$.script') AS script_json
  `);
  const getCursor = db.prepare(`
    SELECT json_extract(snapshot_json, '$.generation') AS generation, last_played_step_id
    FROM sessions WHERE id = ?
  `);
  const setPlayed = db.prepare(`
    UPDATE sessions SET last_played_step_id = ?, updated_at = ?,
      state = CASE WHEN json_extract(snapshot_json, '$.script.actions[#-1].step_id') = ?
        THEN 'completed' ELSE state END
    WHERE id = ?
  `);
  const insertEvent = db.prepare(`
    INSERT INTO session_events (session_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)
  `);
  const getLatest = db.prepare(`
    SELECT payload_json FROM session_events WHERE session_id = ? AND kind = ? ORDER BY id DESC LIMIT 1
  `);

  function append(
    id: string,
    kind: 'stream' | 'beat' | 'answer' | 'done' | 'superseded',
    payload: object,
  ) {
    insertEvent.run(id, kind, JSON.stringify(payload), new Date().toISOString());
  }

  function latest(id: string, kind: 'beat' | 'answer'): unknown {
    const row = getLatest.get(id, kind);
    return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) : undefined;
  }

  function lastAnswer(id: string) {
    const answer = latest(id, 'answer');
    return Value.Check(AnswerSchema, answer) ? answer : undefined;
  }

  return {
    create(courseId: string, lessonId: string, script: LessonScript) {
      const id = randomUUID();
      insert.run(
        id,
        courseId,
        lessonId,
        JSON.stringify({ generation: 0, script }),
        new Date().toISOString(),
      );
      return id;
    },
    openStream(id: string): ActiveStream | undefined {
      const row = bumpGeneration.get(new Date().toISOString(), id);
      if (!row) return undefined;
      const { generation, script_json } = row;
      const script: unknown = typeof script_json === 'string' ? JSON.parse(script_json) : null;
      if (typeof generation !== 'number' || !Value.Check(LessonScriptSchema, script)) {
        throw new Error('Invalid stored lesson session');
      }
      append(id, 'stream', { generation });
      return { id, generation, script };
    },
    poll({ id, generation, script }: ActiveStream): BeatPoll {
      const cursor = getCursor.get(id);
      if (cursor?.generation !== generation) {
        append(id, 'superseded', { generation });
        return { kind: 'superseded' };
      }
      const played =
        typeof cursor.last_played_step_id === 'number' ? cursor.last_played_step_id : 0;
      const previous = script.actions.find(({ step_id }) => step_id === played);
      if (previous?.type === 'ask' && lastAnswer(id)?.ask_step_id !== played) {
        return { kind: 'waiting' };
      }
      const action = script.actions.find(({ step_id }) => step_id > played);
      if (!action) {
        append(id, 'done', { generation });
        return { kind: 'done' };
      }
      const sent = readLessonBeat(latest(id, 'beat'));
      // A suspended client can have one sent-but-unplayed beat, never the rest of the lesson.
      if (sent?.generation === generation && sent.action.step_id === action.step_id) {
        return { kind: 'waiting' };
      }
      const beat = { generation, seq: (sent?.seq ?? 0) + 1, action };
      append(id, 'beat', beat);
      return { kind: 'beat', beat };
    },
    progress(
      id: string,
      { generation, last_played_step_id }: Static<typeof ProgressSchema>,
    ): UpdateResult {
      const cursor = getCursor.get(id);
      if (!cursor) return 'session_not_found';
      if (cursor.generation !== generation) return 'stale_generation';
      if (cursor.last_played_step_id === last_played_step_id) return 'ok';
      const sent = readLessonBeat(latest(id, 'beat'));
      if (sent?.generation !== generation || sent.action.step_id !== last_played_step_id) {
        return 'unexpected_step';
      }
      setPlayed.run(last_played_step_id, new Date().toISOString(), last_played_step_id, id);
      return 'ok';
    },
    answer(id: string, input: Static<typeof AnswerSchema>): UpdateResult {
      const { generation, ask_step_id, text } = input;
      const cursor = getCursor.get(id);
      if (!cursor) return 'session_not_found';
      if (cursor.generation !== generation) return 'stale_generation';
      const previous = lastAnswer(id);
      if (previous?.ask_step_id === ask_step_id) {
        return previous.text === text ? 'ok' : 'unexpected_step';
      }
      const sent = readLessonBeat(latest(id, 'beat'));
      if (
        cursor.last_played_step_id !== ask_step_id ||
        sent?.action.type !== 'ask' ||
        sent.action.step_id !== ask_step_id
      ) {
        return 'unexpected_step';
      }
      append(id, 'answer', input);
      return 'ok';
    },
  };
}
