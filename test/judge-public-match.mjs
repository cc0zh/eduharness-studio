import assert from 'node:assert/strict';

export function assertPublicMatch(transcript, { dialogue, last_played_step_id }) {
  // M3-2 adds only the deterministic kickoff and an explicit interruption marker.
  assert.deepEqual(
    transcript.slice(1).map(({ role, text }) => ({ role, text })),
    dialogue.turns.map(({ role, text, interrupted }) => ({
      role,
      text: interrupted ? `[含插话]\n${text}` : text,
    })),
  );
  assert.ok(
    dialogue.turns.every(({ evidenceStepIds }) =>
      evidenceStepIds.every((id) => id <= last_played_step_id),
    ),
  );
  for (const [index, message] of transcript.entries()) {
    assert.deepEqual(Object.keys(message).sort(), ['id', 'role', 'text', 'turn']);
    assert.equal(message.turn, Math.ceil(index / 2));
    assert.equal(message.role, index % 2 ? 'teacher' : 'learner');
  }
  assert.equal(new Set(transcript.map(({ id }) => id)).size, transcript.length);
  assert.equal(transcript.at(-1)?.role, 'teacher');
}
