import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { createFauxModelGateway } from '../src/models.js';
import { createTeacherPlanner, teacherTurnPolicy } from '../src/teacher.js';
import { normalizeTeacherTurn } from '../src/teacher-normalize.js';
import {
  fauxResult,
  localFaux,
  masteredScene,
  openingContext,
  scene,
} from './teacher-scene-fixture.js';

function noisyScene() {
  const valid = scene();
  return {
    ...valid,
    ordinary_note: 'not part of the scene',
    insert_keypoint: null,
    resolution: '   ',
    panels: [{ ...valid.panels[0], formula: '', voiceover: ' ', diagram: {}, weight: 0.7 }],
    next_ask: {
      prompt: '你会怎样判断？',
      hint: null,
      options: ['第一种', '第二种', '第三种', '第四种', '不保留第五种'],
      transfer: false,
      unused: ['text'],
    },
  };
}

test('syntax cleanup drops empty optional values and harmless extras, preserving the first four labels', async () => {
  const noisy = noisyScene();
  const { schema } = teacherTurnPolicy(openingContext);
  assert.equal(Value.Check(schema, noisy), false);
  const normalized = normalizeTeacherTurn(noisy);
  assert.ok(Value.Check(schema, normalized));
  assert.deepEqual(normalized, {
    diagnosis: noisy.diagnosis,
    panels: [{ title: '积木', content: '让积木两两站在一起。', highlight: '两两' }],
    next_ask: { prompt: noisy.next_ask.prompt, options: noisy.next_ask.options.slice(0, 4) },
  });
  const faux = localFaux();
  faux.setResponses([fauxResult(noisyScene())]);
  const plan = await createTeacherPlanner(faux.gateway, [])(openingContext, []);
  assert.ok(plan.ok);
  assert.deepEqual(plan.trace.guardrails, []);
  const ask = plan.actions.at(-1);
  assert.ok(ask?.type === 'ask' && ask.mode === 'choice');
  assert.deepEqual(
    ask.options?.map(({ label }) => label).sort(),
    noisy.next_ask.options.slice(0, 4).sort(),
  );
  assert.equal(faux.state.callCount, 1);
});

test('cleanup does not drop nonblank forbidden intent, embedded SVG, missing material or excess panels', () => {
  const { schema } = teacherTurnPolicy(openingContext);
  const valid = scene();
  for (const invalid of [
    { ...valid, resolution: masteredScene.resolution },
    { ...valid, next_ask: { prompt: '请作答。', transfer: true } },
    { ...valid, actions: [] },
    { ...valid, panels: [] },
    { ...valid, panels: Array.from({ length: 4 }, () => valid.panels[0]) },
    { ...valid, panels: [{ ...valid.panels[0], content: '  ' }] },
    {
      ...valid,
      panels: [
        {
          ...valid.panels[0],
          diagram: { diagram_kind: 'geometry', description: '画坐标线', svg_markup: '<svg/>' },
        },
      ],
    },
  ])
    assert.equal(Value.Check(schema, normalizeTeacherTurn(invalid)), false);
});

test('before discarding keys or clipping choices, raw credentials are rejected without echo', async () => {
  const credential = 'unit-only-faux-reflected-key';
  const fieldSecret = 'hidden-faux-secret';
  const faux = localFaux(credential);
  const value = scene();
  const noisy = noisyScene();
  faux.setResponses([
    fauxResult({ ...noisy, ignored: { fake_api_key: fieldSecret } }),
    fauxResult({
      ...noisy,
      next_ask: {
        ...noisy.next_ask,
        options: [...noisy.next_ask.options, { fake_api_key: fieldSecret }],
      },
    }),
    fauxResult({ ...value, panels: [{ ...value.panels[0], content: `反射的值 ${credential}` }] }),
  ]);
  const plan = await createTeacherPlanner(faux.gateway, [])(openingContext, []);
  assert.equal(plan.ok, false);
  assert.equal(faux.state.callCount, 3);
  assert.deepEqual(
    plan.trace.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  const serialized = JSON.stringify(plan);
  assert.match(serialized, /sensitive-field/);
  assert.doesNotMatch(serialized, /unit-only-faux-reflected-key|hidden-faux-secret|fake_api_key/);
});

test('configured environment and transient BYOK credentials are both blocked even inside valid board text', async () => {
  const envKey = 'offline-faux-env-reflection-sentinel';
  const byokKey = 'offline-faux-byok-reflection-sentinel';
  const faux = createFauxModelGateway({
    provider: 'faux',
    modelId: 'faux-1',
    readEnv: (name) => (name === 'STUDIO_FAUX_API_KEY' ? envKey : undefined),
  });
  assert.equal((await faux.gateway.getStatus()).source, 'env');
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: byokKey }));
  assert.equal((await faux.gateway.getStatus()).source, 'byok');
  const valid = scene();
  const reflected = (key: string) =>
    fauxResult({ ...valid, panels: [{ ...valid.panels[0], content: `反射 ${key}` }] });
  faux.setResponses([reflected(envKey), reflected(byokKey), fauxResult(valid)]);
  const accepted = await createTeacherPlanner(faux.gateway, [])(openingContext, []);
  assert.ok(accepted.ok);
  assert.equal(faux.state.callCount, 3);
  assert.ok(
    accepted.trace.guardrails.every(({ reasons }) =>
      reasons.join(' ').includes('[sensitive-field]'),
    ),
  );
  const serialized = JSON.stringify(accepted);
  assert.equal(serialized.includes(envKey), false);
  assert.equal(serialized.includes(byokKey), false);
});
