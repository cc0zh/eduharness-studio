import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  demoCourses,
  generateBlueprint,
  KeypointSchema,
  offlineLesson,
  projectKeypointProgress,
  readCurrentLessonBeat,
  readLessonBeat,
  validateActions,
} from '../src/index.js';

const demos = demoCourses.map((course) => offlineLesson(course, course.units[0].lessons[0]));

test('demo scripts vary in size and cover all validated actions in order', () => {
  assert.deepEqual(
    demos.map(({ keypoints }) => keypoints.length),
    [3, 5],
  );
  const actions = demos.flatMap((script) => script.actions);
  assert.deepEqual(
    new Set(actions.map(({ type }) => type)),
    new Set([
      'board',
      'new_column',
      'new_page',
      'highlight',
      'graph',
      'speak',
      'ask',
      'keypoint_complete',
    ]),
  );
  assert.ok(actions.some((action) => action.type === 'highlight' && action.style === 'circle'));
  assert.ok(
    actions.some(
      (action) => action.type === 'graph' && action.formula && action.svg_markup.startsWith('<svg'),
    ),
  );
  for (const { actions, keypoints } of demos) {
    assert.ok(validateActions(actions).ok);
    assert.ok(keypoints.every((keypoint) => Value.Check(KeypointSchema, keypoint)));
    assert.deepEqual(
      actions.map(({ step_id }) => step_id),
      actions.map((_, i) => i + 1),
    );
    assert.deepEqual(
      actions.flatMap((action) =>
        action.type === 'keypoint_complete' ? [action.keypoint_id] : [],
      ),
      keypoints.map(({ id }) => id),
    );
  }
});

test('stored intake blueprints give deterministic first lessons spanning two to six keypoints', () => {
  const counts = new Set<number>();
  for (const foundation of ['beginner', 'familiar', 'experienced'] as const) {
    for (const goal of ['understand', 'apply', 'explain'] as const) {
      const course = generateBlueprint('course-template', { topic: '线性代数', foundation, goal });
      const first = course.units[0].lessons[0];
      const script = offlineLesson(course, first);
      assert.deepEqual(offlineLesson(course, first), script);
      assert.ok(
        script.actions.some(
          (action) => action.type === 'board' && action.content.includes(course.topic),
        ),
      );
      assert.ok(validateActions(script.actions).ok);
      counts.add(script.keypoints.length);
    }
  }
  assert.deepEqual(counts, new Set([2, 3, 4, 5, 6]));
});

test('only a played completion action advances the next keypoint', () => {
  const { keypoints, actions } = demos[0];
  const i = actions.findIndex(({ type }) => type === 'keypoint_complete');
  const progress = (end: number) => projectKeypointProgress(keypoints, actions.slice(0, end));
  assert.deepEqual(
    progress(i).keypoints.map(({ status }) => status),
    ['active', 'pending', 'pending'],
  );
  assert.deepEqual(
    progress(i + 1).keypoints.map(({ status }) => status),
    ['completed', 'active', 'pending'],
  );
  assert.equal(progress(i + 1).currentIndex, 1);
  assert.ok(progress(actions.length).keypoints.every(({ status }) => status === 'completed'));
});

test('client beat filter drops out-of-generation, repeated and invalid frames', () => {
  const action = demos[0].actions[0];
  assert.equal(readLessonBeat({ generation: 0, seq: 1, action }), undefined);
  assert.equal(readCurrentLessonBeat({ generation: 2, seq: 5, action }, 3, 4), undefined);
  assert.equal(readCurrentLessonBeat({ generation: 4, seq: 5, action }, 3, 4), undefined);
  assert.equal(readCurrentLessonBeat({ generation: 3, seq: 4, action }, 3, 4), undefined);
  assert.deepEqual(readCurrentLessonBeat({ generation: 3, seq: 5, action }, 3, 4), {
    generation: 3,
    seq: 5,
    action,
  });
});
