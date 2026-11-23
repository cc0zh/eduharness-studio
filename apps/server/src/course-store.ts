import {
  type CourseBlueprint,
  type CourseSummary,
  demoCourses,
  validateBlueprint,
} from '@eduharness-studio/engine';
import type { StudioDatabase } from './db.js';

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
  const list = db.prepare('SELECT blueprint_json FROM courses ORDER BY created_at DESC, id');

  return {
    add(blueprint: CourseBlueprint) {
      insert.run(
        blueprint.id,
        blueprint.topic,
        blueprint.title,
        JSON.stringify(blueprint),
        new Date().toISOString(),
      );
    },
    get(id: string): CourseBlueprint | undefined {
      const row = get.get(id);
      return row && decodeBlueprint(row.blueprint_json);
    },
    list(): CourseSummary[] {
      return list.all().map((row) => {
        const { id, title, topic, units } = decodeBlueprint(row.blueprint_json);
        return {
          id,
          title,
          topic,
          summary: units[0].lessons[0].summary,
          unitTitles: units.map((unit) => unit.title),
          lessonCount: units.reduce((total, unit) => total + unit.lessons.length, 0),
          kind: id.startsWith('demo-') ? 'demo' : 'generated',
        };
      });
    },
  };
}
