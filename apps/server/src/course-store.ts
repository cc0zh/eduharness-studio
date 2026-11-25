import {
  type CourseBlueprint,
  type CourseSummary,
  demoCourses,
  type Keypoint,
  projectKeypointProgress,
  validateBlueprint,
  validateLessonScript,
} from '@eduharness-studio/engine';
import { type LessonMaterial, validateLessonMaterial } from '@eduharness-studio/engine/course';
import type { StudioDatabase } from './db.js';

export type CourseStore = ReturnType<typeof createCourseStore>;

const demoIds = new Set(demoCourses.map(({ id }) => id));
const retiredDemoIds = new Set(['demo-point-line-distance', 'demo-http-cache']);

export function isDemoCourse(id: string) {
  return demoIds.has(id);
}

export function isRetiredDemo(id: string) {
  return retiredDemoIds.has(id);
}

function decodeBlueprint(raw: unknown): CourseBlueprint {
  if (typeof raw !== 'string') throw new Error('Missing stored blueprint');
  const result = validateBlueprint(JSON.parse(raw));
  if (!result.ok) throw new Error(`Invalid stored blueprint: ${result.errors.join('; ')}`);
  return result.blueprint;
}

export function createCourseStore({ db }: StudioDatabase) {
  const insertSql = `
    INSERT INTO courses (id, topic, title, blueprint_json, created_at) VALUES (?, ?, ?, ?, ?)
  `;
  const seed = db.prepare(`${insertSql} ON CONFLICT(id) DO NOTHING`);
  const seededAt = new Date().toISOString();
  for (const demo of demoCourses) {
    seed.run(demo.id, demo.topic, demo.title, JSON.stringify(demo), seededAt);
  }

  const insert = db.prepare(insertSql);
  const get = db.prepare('SELECT blueprint_json FROM courses WHERE id = ?');
  const list = db.prepare('SELECT id, blueprint_json FROM courses ORDER BY created_at DESC, id');
  const saveBlueprint = db.prepare('UPDATE courses SET blueprint_json = ? WHERE id = ?');
  const addMaterial = db.prepare(
    'INSERT INTO course_lessons (course_id, lesson_id, material_json) VALUES (?, ?, ?)',
  );
  const getMaterial = db.prepare(
    'SELECT material_json FROM course_lessons WHERE course_id = ? AND lesson_id = ?',
  );
  const playedSessions = db.prepare(`
    SELECT snapshot_json, last_played_step_id AS lastPlayed FROM sessions
    WHERE course_id = ? AND lesson_id = ? AND last_played_step_id > 0
    ORDER BY updated_at, rowid
  `);

  function transaction<T>(write: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function lessonAt(blueprint: CourseBlueprint, lessonId: string) {
    return blueprint.units.flatMap(({ lessons }) => lessons).find(({ id }) => id === lessonId);
  }

  return {
    add(blueprint: CourseBlueprint, material?: LessonMaterial) {
      transaction(() => {
        insert.run(
          blueprint.id,
          blueprint.topic,
          blueprint.title,
          JSON.stringify(blueprint),
          new Date().toISOString(),
        );
        if (material)
          addMaterial.run(blueprint.id, blueprint.units[0].lessons[0].id, JSON.stringify(material));
      });
    },
    get(id: string): CourseBlueprint | undefined {
      if (isRetiredDemo(id)) return undefined;
      const row = get.get(id);
      return row && decodeBlueprint(row.blueprint_json);
    },
    material(courseId: string, lessonId: string): LessonMaterial | undefined {
      const row = getMaterial.get(courseId, lessonId) as { material_json?: unknown } | undefined;
      if (typeof row?.material_json !== 'string') return undefined;
      const material: unknown = JSON.parse(row.material_json);
      if (!validateLessonMaterial(material)) throw new Error('Invalid stored lesson material');
      return material;
    },
    unlock(courseId: string, lessonId: string, material: LessonMaterial) {
      if (!validateLessonMaterial(material)) throw new Error('invalid_lesson_material');
      return transaction(() => {
        const blueprint = this.get(courseId);
        const lesson = blueprint && lessonAt(blueprint, lessonId);
        if (!blueprint || !lesson) return undefined;
        if (lesson.status !== 'locked') return { status: lesson.status };
        addMaterial.run(courseId, lessonId, JSON.stringify(material));
        const updated = {
          ...blueprint,
          units: blueprint.units.map((unit) => ({
            ...unit,
            lessons: unit.lessons.map((entry) =>
              entry.id === lessonId ? { ...entry, status: 'ready' as const } : entry,
            ),
          })),
        };
        saveBlueprint.run(JSON.stringify(updated), courseId);
        return { status: 'ready' as const };
      });
    },
    previousKeypoints(courseId: string, lessonId: string): Keypoint[] {
      const blueprint = this.get(courseId);
      if (!blueprint) return [];
      const lessons = blueprint.units.flatMap(({ lessons }) => lessons);
      const target = lessons.findIndex(({ id }) => id === lessonId);
      if (target <= 0) return [];
      return lessons.slice(0, target).flatMap(({ id }) => {
        const confirmed = new Map<string, Keypoint>();
        const rows = playedSessions.all(courseId, id) as {
          snapshot_json: string;
          lastPlayed: number;
        }[];
        for (const { snapshot_json, lastPlayed } of rows) {
          const snapshot: unknown = JSON.parse(snapshot_json);
          if (!snapshot || typeof snapshot !== 'object' || !('script' in snapshot)) continue;
          const { script } = snapshot;
          if (!validateLessonScript(script)) continue;
          const played = script.actions.filter(({ step_id }) => step_id <= lastPlayed);
          const { keypoints } = projectKeypointProgress(script.keypoints, played);
          for (const point of keypoints) {
            if (point.status === 'completed') confirmed.set(point.id, point);
          }
        }
        return [...confirmed.values()];
      });
    },
    list(): CourseSummary[] {
      return list
        .all()
        .filter(({ id }) => !isRetiredDemo(String(id)))
        .map((row) => decodeBlueprint(row.blueprint_json))
        .map(({ id, title, topic, units }) => ({
          id,
          title,
          topic,
          summary: units[0].lessons[0].summary,
          unitTitles: units.map((unit) => unit.title),
          lessonCount: units.reduce((total, unit) => total + unit.lessons.length, 0),
          kind: isDemoCourse(id) ? 'demo' : 'generated',
        }));
    },
  };
}
