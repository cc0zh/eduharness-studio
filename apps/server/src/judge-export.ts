import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import {
  assertJudgeTextSafe,
  type EvidenceMessage,
  JudgeProjectionError,
  LessonRecordSchema,
  projectEvidenceMessages,
  projectKeypointProgress,
  validateBlueprint,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { Value } from '@sinclair/typebox/value';
import { playedSessionActions } from './session-cursor.js';
import { sessionReader } from './session-db.js';

const usage = `Usage: npm run export:judge -- --out-dir NEW_DIRECTORY [--db FILE] [--session ID ...]
Writes plan.json (eduharness-ts --judge-only) and manifest.json to a new directory.
Database: --db, STUDIO_DB_PATH, then data/studio.sqlite; opened read-only.
Repeat --session ID to select in order, or omit it to select the latest non-retired session.`;

class ExportError extends Error {
  constructor(code: string, sessionIndex?: number) {
    super(sessionIndex === undefined ? code : `${code} (session #${sessionIndex})`);
  }
}

// Envelope from M3-1 JudgeOnlyPlanSchema v1; studio metadata stays out of the plan.
function makeJudgePlan(cells: readonly { sessionId: string; transcript: EvidenceMessage[] }[]) {
  return { cells: cells.map(({ sessionId, transcript }) => ({ cellId: sessionId, transcript })) };
}

function validateSelection(ids: readonly string[]) {
  const portableId = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
  const reservedId = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$|label/i;
  if (
    ids.length > 1000 ||
    ids.some((id) => !portableId.test(id) || reservedId.test(id)) ||
    new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
  )
    throw new ExportError('invalid_session_selection');
}

function readExport(db: DatabaseSync, requested: readonly string[]) {
  // Inherited values only. The export entry does not load application or .env configuration.
  const credentialName =
    /(?:^|_)(?:API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_KEY|ACCESS_TOKEN|OAUTH_TOKEN|BEARER_TOKEN|SESSION_TOKEN)(?:_|$)/i;
  const knownCredentials = Object.keys(process.env).flatMap((name) => {
    if (!credentialName.test(name)) return [];
    const value = process.env[name]?.trim();
    return value ? [value] : [];
  });
  const reader = sessionReader(db);
  const courseFor = db.prepare(`
    SELECT s.lesson_id, c.blueprint_json FROM sessions s
    JOIN courses c ON c.id = s.course_id WHERE s.id = ?
  `);
  return reader.readTransaction(() => {
    const latest = requested.length ? undefined : reader.latestId();
    const ids = latest ? [latest] : requested;
    if (!ids.length) throw new ExportError('session_not_found');
    validateSelection(ids);
    const cells = ids.map((sessionId, index) => {
      try {
        const session = reader.load(sessionId);
        if (!session) throw new ExportError('session_not_found');
        if (!validateLessonScript(session.queue.script))
          throw new ExportError('invalid_session_data');
        const played = playedSessionActions(session);
        const confirmed = reader.playedStepIds(sessionId);
        if (
          confirmed.length !== played.length ||
          played.some(({ step_id }, i) => confirmed[i] !== step_id)
        )
          throw new JudgeProjectionError('cursor_mismatch');

        const records = reader.records(sessionId);
        if (records.some((record) => !Value.Check(LessonRecordSchema, record)))
          throw new ExportError('invalid_session_data');
        const row = courseFor.get(sessionId);
        if (typeof row?.blueprint_json !== 'string') throw new ExportError('lesson_not_found');
        const decoded = validateBlueprint(JSON.parse(row.blueprint_json));
        if (!decoded.ok) throw new ExportError('invalid_session_data');
        const course = decoded.blueprint;
        const lesson = course.units
          .flatMap(({ lessons }) => lessons)
          .find(({ id }) => id === row.lesson_id);
        if (!lesson) throw new ExportError('lesson_not_found');
        const transcript = projectEvidenceMessages({
          topic: course.topic,
          lesson,
          basisObjective: session.queue.basis?.objective,
          played,
          records,
          lastPlayedStepId: session.lastPlayed,
          knownCredentials,
        });
        const { keypoints } = projectKeypointProgress(session.queue.script.keypoints, played);
        for (const field of [
          sessionId,
          course.id,
          course.title,
          lesson.id,
          lesson.title,
          ...keypoints.map(({ id }) => id),
        ]) {
          assertJudgeTextSafe(field, knownCredentials);
        }
        return {
          sessionId,
          transcript,
          meta: {
            sessionId,
            course: { id: course.id, title: course.title },
            lesson: { id: lesson.id, title: lesson.title },
            last_played_step_id: session.lastPlayed,
            keypoints: keypoints.map(({ id, status }) => ({ id, status })),
          },
        };
      } catch (error) {
        if (error instanceof ExportError || error instanceof JudgeProjectionError)
          throw new ExportError(error.message, index + 1);
        throw new ExportError('invalid_session_data', index + 1);
      }
    });
    return { plan: makeJudgePlan(cells), manifest: { sessions: cells.map(({ meta }) => meta) } };
  });
}

function argumentsForExport() {
  try {
    return parseArgs({
      options: {
        db: { type: 'string' },
        session: { type: 'string', multiple: true },
        'out-dir': { type: 'string' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch {
    throw new ExportError('invalid_arguments');
  }
}

function openReadOnly(path: string) {
  try {
    return new DatabaseSync(resolve(path), { readOnly: true });
  } catch {
    throw new ExportError('database_open_failed');
  }
}

function main() {
  const args = argumentsForExport();
  if (args.help) {
    console.log(usage);
    return;
  }
  const dbPath = args.db ?? process.env.STUDIO_DB_PATH ?? 'data/studio.sqlite';
  const out = args['out-dir'];
  if (!dbPath.trim() || dbPath === ':memory:' || !out?.trim())
    throw new ExportError('invalid_arguments');

  const db = openReadOnly(dbPath);
  let artifacts: ReturnType<typeof readExport>;
  try {
    artifacts = readExport(db, args.session ?? []);
  } finally {
    db.close();
  }

  try {
    mkdirSync(out);
    for (const [file, value] of Object.entries(artifacts)) {
      writeFileSync(join(out, `${file}.json`), `${JSON.stringify(value, null, 2)}\n`, {
        flag: 'wx',
      });
    }
  } catch {
    throw new ExportError('output_write_failed');
  }
}

try {
  main();
} catch (error) {
  console.error(
    `judge-export: ${error instanceof ExportError ? error.message : 'database_read_failed'}`,
  );
  if (error instanceof ExportError && error.message === 'invalid_arguments') console.error(usage);
  process.exitCode = 1;
}
