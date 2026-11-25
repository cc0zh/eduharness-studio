import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPlayedDialogue } from '@eduharness-studio/engine';
import { afterSkip, lessonDraft, makeFixture, startAtAsk } from './teacher-test-support.js';

const recapLine = '这段原计划回顾还没有上屏。';
const closingLine = '只根据已确认的结论收尾。';

for (const mode of ['natural', 'interrupt', 'offline'] as const) {
  test(`final resolution and its recap finish correctly via ${mode}`, async (t) => {
    const { faux, store, structured, start } = makeFixture(t);
    faux.setResponses([structured(lessonDraft())]);
    const live = await startAtAsk(store, start);
    const { id, stream } = live;
    let generation = live.generation;
    const issue = () => {
      const poll = store.poll(stream);
      assert.ok(poll.kind === 'beat');
      return poll.beat.action;
    };
    const ack = (step_id: number) => {
      assert.ok('ok' in store.progress(id, { generation, last_played_step_id: step_id }));
    };
    function untilAsk() {
      for (let index = 0; index < 12; index++) {
        const beat = issue();
        ack(beat.step_id);
        if (beat.type === 'ask') return beat;
      }
      throw new Error('Expected an acknowledged ask');
    }

    faux.setResponses([structured(afterSkip)]);
    assert.ok(
      'ok' in (await store.answer(id, { generation, ask_step_id: live.ask.step_id, text: '跳过' })),
    );
    const nextAsk = untilAsk();
    faux.setResponses([
      structured({
        diagnosis: { status: 'clarifying', summary: '已有初步理解。', strategy: '换数字检查。' },
        panels: [{ title: '配对', content: '先检查另一组积木。' }],
        next_ask: { prompt: '八块可以分成几对？', transfer: true },
      }),
    ]);
    assert.ok(
      'ok' in
        (await store.answer(id, {
          generation,
          ask_step_id: nextAsk.step_id,
          text: '六块能摆三组。',
        })),
    );
    const verify = untilAsk();
    assert.equal(verify.checkpoint, 'verify');

    faux.setResponses([
      structured({
        diagnosis: { status: 'mastered', summary: '迁移正确。', strategy: '课堂收尾。' },
        resolution: { text: '四组正好配完。', conclusion: '每组两块，八块能分四组。' },
        panels: [{ title: '回顾', content: recapLine }],
      }),
    ]);
    assert.ok(
      'ok' in
        (await store.answer(id, {
          generation,
          ask_step_id: verify.step_id,
          text: '四对，没剩下。',
        })),
    );
    const feedback = issue();
    assert.ok(feedback.type === 'speak' && feedback.checkpoint === 'verify');
    ack(feedback.step_id);
    const pass = issue();
    assert.equal(pass.type, 'keypoint_complete');
    assert.equal(store.inspect(id)?.snapshot.keypoints?.[1]?.status, 'active');
    ack(pass.step_id);
    assert.equal(store.inspect(id)?.snapshot.keypoints?.[1]?.status, 'completed');
    assert.notEqual(store.inspect(id)?.snapshot.state, 'completed');

    if (mode !== 'natural') {
      const pending = issue();
      assert.ok(pending.step_id > pass.step_id);
      if (mode === 'offline') faux.gateway.clearByok();
      else
        faux.setResponses([
          structured({
            diagnosis: {
              status: 'clarifying',
              summary: '回答回顾问题。',
              strategy: '保留已证实结论。',
            },
            panels: [{ title: '收尾', content: closingLine }],
          }),
        ]);
      const resumed = await store.interrupt(id, {
        generation,
        last_played_step_id: pass.step_id,
        text: '先停一下，回顾完了什么？',
      });
      assert.ok(!('error' in resumed));
      assert.equal(store.poll(stream).kind, 'interrupted');
      generation = resumed.generation;
      assert.equal(resumed.last_played_step_id, pass.step_id);
      assert.ok(store.inspect(id)?.trace.queued.every(({ step_id }) => step_id > pending.step_id));
    }

    const closing = store.openStream(id, generation);
    assert.ok(closing && !('error' in closing));
    const finish = () => {
      for (let index = 0; index < 12; index++) {
        const poll = store.poll(closing);
        if (poll.kind === 'done') return poll.snapshot;
        assert.ok(poll.kind === 'beat');
        assert.notEqual(poll.beat.action.type, 'ask');
        ack(poll.beat.action.step_id);
      }
      throw new Error('Expected the acknowledged recap to finish the stream');
    };
    const complete = finish();
    assert.equal(complete.state, 'completed');
    assert.equal(complete.askStep, null);
    const projected = projectPlayedDialogue(complete.playedActions, complete.records)
      .turns.map(({ text }) => text)
      .join('\n');
    assert.match(projected, /每组两块，八块能分四组/);
    assert.equal(projected.includes(recapLine), mode === 'natural');
    assert.equal(projected.includes(closingLine), mode === 'interrupt');
  });
}
