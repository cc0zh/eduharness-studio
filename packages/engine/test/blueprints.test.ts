import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  type CourseBlueprint,
  CourseBlueprintSchema,
  demoCourses,
  generateBlueprint,
  INTAKE_LIMITS,
  type IntakeAnswers,
  IntakeGenerateSchema,
  IntakeNextSchema,
  IntakeStartSchema,
  nextIntake,
  startIntake,
} from '../src/index.js';

const answers = {
  topic: ' 概率的直觉 ',
  foundation: 'beginner',
  goal: 'apply',
  foundationNote: '会用分数',
  goalNote: '判断抽样结果',
} satisfies IntakeAnswers;

function validateMap(blueprint: CourseBlueprint) {
  assert.ok(Value.Check(CourseBlueprintSchema, blueprint));
  const lessons = blueprint.units.flatMap((unit) => unit.lessons);
  assert.equal(new Set(lessons.map((lesson) => lesson.id)).size, lessons.length);
  assert.equal(lessons[0].status, 'ready');
  assert.ok(
    lessons.slice(1).length > 0 && lessons.slice(1).every((lesson) => lesson.status === 'locked'),
  );
  return lessons;
}

test('intake steps and blueprint are offline deterministic; notes inform the lesson map', () => {
  const start = { topic: answers.topic };
  const next = { ...start, foundation: answers.foundation, foundationNote: answers.foundationNote };
  assert.deepEqual(startIntake(start), startIntake({ ...start }));
  assert.equal(startIntake(start).topic, '概率的直觉');
  assert.deepEqual(nextIntake(next), nextIntake({ ...next }));
  assert.notEqual(
    nextIntake(next).prompt,
    nextIntake({ ...next, foundation: 'experienced' }).prompt,
  );

  const map = generateBlueprint('course-a', answers);
  assert.deepEqual(map, generateBlueprint('course-a', { ...answers }));
  const lessons = validateMap(map);
  assert.ok(lessons.some(({ summary }) => summary.includes(answers.foundationNote)));
  assert.ok(lessons.some(({ summary }) => summary.includes(answers.goalNote)));
});

test('changing foundation or goal changes the map, not just the labels', () => {
  const original = generateBlueprint('course-a', answers);
  for (const changed of [
    { ...answers, foundation: 'experienced' as const },
    { ...answers, goal: 'explain' as const },
  ]) {
    const variant = generateBlueprint('course-a', changed);
    assert.notEqual(original.units.length, variant.units.length);
    assert.notEqual(validateMap(original).length, validateMap(variant).length);
  }
});

test('offline demo courses use the same blueprint schema and locked lesson rules', () => {
  assert.ok(demoCourses.length >= 2 && demoCourses.length <= 3);
  assert.equal(new Set(demoCourses.map((course) => course.id)).size, demoCourses.length);
  for (const demo of demoCourses) validateMap(demo);
});

test('TypeBox rejects invalid topics, unknown choices, oversized notes and extra fields', () => {
  const start = { topic: answers.topic };
  const next = { ...start, foundation: answers.foundation };
  assert.ok(Value.Check(IntakeStartSchema, start));
  assert.ok(Value.Check(IntakeNextSchema, next));
  assert.ok(Value.Check(IntakeGenerateSchema, { ...next, goal: answers.goal }));
  for (const bad of [
    {},
    { topic: '  ' },
    { topic: '学'.repeat(INTAKE_LIMITS.topic + 1) },
    { topic: 3 },
  ]) {
    assert.equal(Value.Check(IntakeStartSchema, bad), false);
  }
  assert.equal(Value.Check(IntakeNextSchema, { ...next, foundation: 'unknown' }), false);
  assert.equal(Value.Check(IntakeNextSchema, { ...next, goal: 'apply' }), false);
  assert.equal(Value.Check(IntakeGenerateSchema, { ...answers, goal: 'unknown' }), false);
  assert.equal(
    Value.Check(IntakeGenerateSchema, { ...answers, goalNote: 'a'.repeat(INTAKE_LIMITS.note + 1) }),
    false,
  );
});
