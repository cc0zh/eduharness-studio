import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPlayedDialogue } from '@eduharness-studio/engine';
import { fauxAssistantMessage, fauxToolCall } from '@eduharness-studio/engine/models';
import { sessionDatabase } from '../apps/server/src/session-db.js';
import { createSessionStore } from '../apps/server/src/session-store.js';
import captures from '../packages/engine/test/fixtures/teacher-numeric-live.json' with {
  type: 'json',
};
import { lessonDraft, makeFixture, startAtAsk } from './teacher-test-support.js';

test('numeric rejection never enters SQLite playback; a bounded rewrite publishes only after ack', async (t) => {
  const { faux, store, structured, start, database } = makeFixture(t);
  faux.setResponses([structured(lessonDraft())]);
  const { id, generation, stream, ask } = await startAtAsk(store, start);
  const evidence = captures.failures[0];
  const original = evidence.panels[0];
  const repaired = {
    title: original.title,
    bindings: [{ key: 'healthy', expression: captures.historicalCalculation.expression }],
    content: '10000 − 100 = **{{healthy}} 人**。',
    formula: String.raw`\text{健康人数}=10000-100={{healthy}}`,
    voiceover: '健康人数为 {{healthy}}。',
  };
  const draft = {
    diagnosis: { status: 'clarifying', summary: '复核人数。', strategy: '核对底表。' },
    panels: [original],
    next_ask: { prompt: '底表应该按什么分组？' },
  };
  const answer = () =>
    store.answer(id, { generation, ask_step_id: ask.step_id, text: '我先核对人数。' });
  const before = store.inspect(id);
  assert.ok(before);

  const invalid = structured(draft);
  faux.setResponses([invalid, invalid, invalid]);
  const failed = await answer();
  assert.ok('failure' in failed);
  assert.equal(failed.failure, 'teacher_invalid_output');
  const reloaded = createSessionStore(sessionDatabase(database.db));
  const rejected = reloaded.inspect(id);
  assert.deepEqual(rejected?.snapshot, before.snapshot);
  assert.deepEqual(rejected?.trace.queued, before.trace.queued);
  assert.deepEqual(
    rejected?.trace.teacherTurns?.at(-1)?.guardrails.map(({ attempt }) => attempt),
    [1, 2, 3],
  );
  assert.equal(store.poll(stream).kind, 'waiting');

  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('calc_verify', { expression: captures.historicalCalculation.expression }),
      { stopReason: 'toolUse' },
    ),
    invalid,
    (request) => {
      const prompt = JSON.stringify(request.messages);
      assert.match(prompt, /numeric arithmetic at \$\.panels\[0\]\.content: calc_verify gives/);
      assert.match(prompt, /9900, not 9000/);
      assert.ok(!prompt.includes('一团雾'));
      return structured({ ...draft, panels: [repaired] });
    },
  ]);
  assert.ok('ok' in (await answer()));
  assert.deepEqual(reloaded.inspect(id)?.snapshot.playedActions, before.snapshot.playedActions);
  for (let index = 0; index < 8; index++) {
    const next = store.poll(stream);
    assert.equal(next.kind, 'beat');
    if (next.kind !== 'beat') break;
    const action = next.beat.action;
    assert.ok('ok' in store.progress(id, { generation, last_played_step_id: action.step_id }));
    if (action.type === 'ask') break;
  }
  const played = reloaded.inspect(id);
  assert.ok(played);
  assert.equal(played.trace.teacherTurns?.at(-1)?.outcome, 'accepted');
  assert.deepEqual(played.trace.queued, []);
  const dialogue = projectPlayedDialogue(played.snapshot.playedActions, played.snapshot.records)
    .turns.map(({ text }) => text)
    .join('\n');
  assert.match(dialogue, /10000 − 100 = \*\*9900 人\*\*/);
  assert.doesNotMatch(dialogue, /9000|一团雾/);
});
