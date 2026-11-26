import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { BAYES_DEMO_ID, type EvidenceMessage } from '@eduharness-studio/engine';
import { fauxAssistantMessage, fauxToolCall } from '@eduharness-studio/engine/models';
import { byokSentinel, exportClassroom } from './judge-export-fixture.js';
import { assertPublicMatch } from './judge-public-match.mjs';
import { offlineServerEnv } from './studio-test-env.mjs';
import { lessonDraft, opening } from './teacher-test-support.js';

const syntheticCredentials = {
  OPENAI_API_KEY: 'SYNTHETIC_ONLY_ENV_KEY_M3_2',
  AWS_BEARER_TOKEN_BEDROCK: 'SYNTHETIC_ONLY_BEDROCK_VALUE_M3_2',
};
const inheritedSentinels = Object.values(syntheticCredentials);
const sourceCanary = 'NOT_A_PUBLIC_LIGHT_RESEARCH_SNIPPET';
const futureTitle = 'UNPLAYED_FUTURE_PANEL_M3_2';

function cli(db: string, dir: string, out: string, ...args: string[]) {
  const npm = process.env.npm_execpath;
  const result = spawnSync(
    process.execPath,
    [
      ...(npm
        ? [npm, '--silent', 'run', 'export:judge', '--']
        : ['--import', 'tsx', 'apps/server/src/judge-export.ts']),
      '--out-dir',
      out,
      ...args,
    ],
    {
      encoding: 'utf8',
      env: {
        // A directory is deliberately not a usable .env file.
        ...offlineServerEnv(dir),
        STUDIO_DB_PATH: db,
        NPM_CONFIG_OFFLINE: 'true',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        ...syntheticCredentials,
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );
  assert.ifError(result.error);
  return result;
}

type Plan = { cells: { cellId: string; transcript: EvidenceMessage[] }[] };
type Manifest = {
  sessions: {
    sessionId: string;
    course: { id: string; title: string };
    lesson: { id: string; title: string };
    last_played_step_id: number;
    keypoints: { id: string; status: string }[];
  }[];
};

function readArtifacts(out: string, result: ReturnType<typeof cli>) {
  assert.equal(result.status, 0, result.stderr);
  const planBytes = readFileSync(join(out, 'plan.json'), 'utf8');
  const manifestBytes = readFileSync(join(out, 'manifest.json'), 'utf8');
  for (const secret of [...inheritedSentinels, byokSentinel, sourceCanary, futureTitle]) {
    assert.ok(
      ![result.stdout, result.stderr, planBytes, manifestBytes].some((part) =>
        part.includes(secret),
      ),
      'non-public data in export output',
    );
  }
  return { plan: JSON.parse(planBytes) as Plan, manifest: JSON.parse(manifestBytes) as Manifest };
}

function databaseHashes(path: string) {
  return [path, `${path}-wal`].map((file) =>
    createHash('sha256').update(readFileSync(file)).digest('hex'),
  );
}

const response = (value: unknown) =>
  fauxAssistantMessage(fauxToolCall('emit_result', { value }), { stopReason: 'toolUse' });

test('real HTTP demo + faux lesson batch: X-Ray parity, confirmed playback only, read-only SQLite and no keys', {
  timeout: 45_000,
}, async (t) => {
  const studio = await exportClassroom(t, true);
  const demo = await studio.start(BAYES_DEMO_ID);
  const demoStream = await demo.open();
  const ask = await demoStream.toAsk();
  const answer = '我先数所有报警包裹。';
  const interrupt = '为什么不能只数贴标包裹？';
  assert.equal((await demo.answer(ask, { text: answer })).ok, true);
  const cutBeat = await demoStream.next();
  assert.equal(cutBeat.type, 'speak');
  const cut = await demo.interrupt(ask.step_id, interrupt);
  const cutRecord = cut.records.at(-1);
  assert.ok(
    cutRecord?.kind === 'interrupt' && cutRecord.truncated_step_ids.includes(cutBeat.step_id),
  );
  assert.equal(cut.last_played_step_id, ask.step_id);
  demoStream.stop();
  const continuation = await studio.session(cut).open();
  const resumedBeat = await continuation.next();
  assert.ok(resumedBeat.step_id > cutBeat.step_id);
  await continuation.ack(resumedBeat);
  continuation.stop();
  const demoView = await demo.quality();

  studio.faux.setResponses([
    response({
      title: '积木学习路线',
      units: [
        {
          title: '学配对',
          lessons: [{ title: '五块积木', summary: '能用配对说明落单。', depth: 'intuition' }],
        },
      ],
    }),
    response({
      ...lessonDraft({
        ...opening,
        next_ask: { prompt: '五块怎样配对？', options: ['两对加一块', '恰好两对'] },
      }),
      basis: {
        objective: '用桌上的物件进行配对。',
        sources: [{ id: 'background', title: '调研细节', snippet: sourceCanary }],
      },
    }),
    response({
      diagnosis: { status: 'clarifying', summary: '先保留方法。', strategy: '换数量迁移。' },
      panels: [
        { title: '换成七块', content: '把物件数改成七块。', formula: String.raw`7=2\times3+1` },
      ],
      next_ask: { prompt: '七块分组后剩几块？为什么？', transfer: true },
    }),
    response({
      diagnosis: { status: 'mastered', summary: '能解释落单。', strategy: '比较下一种数量。' },
      resolution: {
        text: '你用配对解释了没有伙伴的那块。',
        conclusion: '七块组成三对，再余一块。',
      },
      panels: [{ title: futureTitle, content: '这是尚未上屏的检查。' }],
      next_ask: { prompt: '补上一块会怎样？' },
    }),
  ]);
  const course = await studio.generate('奇偶性');
  const faux = await studio.start(course.id);
  const stream = await faux.open();
  const choice = await stream.toAsk();
  assert.ok(choice.mode === 'choice' && choice.options?.[0]);
  assert.equal((await faux.answer(choice, { option_id: choice.options[0].id })).ok, true);
  const transfer = await stream.toAsk();
  assert.equal(
    (await faux.answer(transfer, { text: '三个两两配对用掉六块，剩下一块没有同伴。' })).ok,
    true,
  );
  const feedback = await stream.next();
  assert.equal(feedback.type, 'speak');
  await stream.ack(feedback);
  const passed = await stream.next();
  assert.equal(passed.type, 'keypoint_complete');
  await stream.ack(passed);
  const page = await stream.next();
  assert.equal(page.type, 'new_page');
  await stream.ack(page);
  const issuedOnly = await stream.next();
  assert.ok(issuedOnly.type === 'board' && issuedOnly.title === futureTitle);
  stream.stop();
  const fauxView = await faux.quality();
  const trace = await faux.trace();
  assert.equal(trace.last_played_step_id, page.step_id);
  assert.ok(trace.queued.some(({ step_id }) => step_id === issuedOnly.step_id));
  assert.ok(!trace.playedStepIds?.includes(issuedOnly.step_id));

  // The live writer stays open: both database pages and outstanding WAL bytes must be unchanged.
  const before = databaseHashes(studio.path);
  const out = join(studio.dir, 'batch');
  const batch = readArtifacts(
    out,
    cli(
      join(studio.dir, 'not-used.sqlite'),
      studio.dir,
      out,
      '--db',
      studio.path,
      '--session',
      demo.id,
      '--session',
      faux.id,
    ),
  );
  assert.deepEqual(Object.keys(batch.plan), ['cells']);
  assert.deepEqual(
    batch.plan.cells.map(({ cellId }) => cellId),
    [demo.id, faux.id],
  );
  const [demoCell, fauxCell] = batch.plan.cells;
  for (const cell of batch.plan.cells)
    assert.deepEqual(Object.keys(cell).sort(), ['cellId', 'transcript']);
  assertPublicMatch(demoCell.transcript, demoView);
  assertPublicMatch(fauxCell.transcript, fauxView);
  assert.equal(demoCell.transcript[2].text, `[含插话]\n${answer}\n${interrupt}`);
  assert.ok(demoCell.transcript.every(({ text }) => !text.includes(cutBeat.text)));
  assert.ok(fauxCell.transcript.some(({ text }) => text.includes(String.raw`7=2\times3+1`)));
  assert.match(
    fauxCell.transcript[0].text,
    /奇偶性[\s\S]+五块积木[\s\S]+能用配对说明落单。[\s\S]+用桌上的物件进行配对。/,
  );
  assert.match(fauxCell.transcript.at(-1)?.text ?? '', /\[过关\] 七块组成三对，再余一块。/);
  assert.deepEqual(
    batch.manifest.sessions.map(({ sessionId, last_played_step_id }) => [
      sessionId,
      last_played_step_id,
    ]),
    [
      [demo.id, demoView.last_played_step_id],
      [faux.id, page.step_id],
    ],
  );
  assert.deepEqual(batch.manifest.sessions[1], {
    sessionId: faux.id,
    course: { id: course.id, title: course.title },
    lesson: { id: 'u1-l1', title: '五块积木' },
    last_played_step_id: page.step_id,
    keypoints: [
      { id: 'leftover', status: 'completed' },
      { id: 'parity', status: 'active' },
    ],
  });

  const latestOut = join(studio.dir, 'latest');
  const latest = readArtifacts(latestOut, cli(studio.path, studio.dir, latestOut));
  assert.deepEqual(latest.plan.cells, [fauxCell]);
  assert.deepEqual(latest.manifest.sessions, [batch.manifest.sessions[1]]);
  const after = databaseHashes(studio.path);
  assert.deepEqual(after, before);
  if (process.env.STUDIO_M3_2_EVIDENCE_DIR) {
    t.diagnostic(
      JSON.stringify({
        directory: studio.dir,
        ingress: 'loopback HTTP/SSE/ACK',
        sessions: [demo.id, faux.id],
        cut: cutBeat.step_id,
        notAcknowledged: issuedOnly.step_id,
        transcriptLengths: [demoCell.transcript.length, fauxCell.transcript.length],
        before,
        after,
      }),
    );
  }
});

test('CLI rejects empty, never-interacted, too-short, credential-bearing and cursor-mismatched sessions without artifacts', {
  timeout: 45_000,
}, async (t) => {
  const studio = await exportClassroom(t);
  const empty = await studio.start(BAYES_DEMO_ID);
  const reject = (name: string, code: string, ...args: string[]) => {
    const out = join(studio.dir, name);
    const result = cli(studio.path, studio.dir, out, ...args);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`judge-export: ${code}`), result.stderr);
    assert.ok(inheritedSentinels.every((key) => !`${result.stdout}${result.stderr}`.includes(key)));
    assert.ok(!existsSync(out));
  };
  reject('empty', 'empty_lesson (session #1)');
  const stream = await empty.open();
  await stream.ack(await stream.next());
  stream.stop();
  reject('unanswered', 'no_student_interaction (session #1)', '--session', empty.id);

  const short = await studio.start(BAYES_DEMO_ID, true);
  const initial = await short.interrupt(0, '可以先说目标吗？');
  const initialStream = await studio.session(initial).open();
  await initialStream.ack(await initialStream.next());
  initialStream.stop();
  reject('short', 'insufficient_dialogue (session #1)', '--session', short.id);

  for (const [index, key] of inheritedSentinels.entries()) {
    const unsafe = await studio.start(BAYES_DEMO_ID, true);
    const unsafeStream = await unsafe.open();
    const ask = await unsafeStream.toAsk();
    assert.equal((await unsafe.answer(ask, { text: `学生误贴了 ${key}` })).ok, true);
    unsafeStream.stop();
    reject(`unsafe-${index}`, 'credential_detected (session #1)', '--session', unsafe.id);
  }

  const good = await studio.start(BAYES_DEMO_ID, true);
  const goodStream = await good.open();
  const goodAsk = await goodStream.toAsk();
  assert.equal((await good.answer(goodAsk, { text: '只在报警的包裹里数。' })).ok, true);
  const pending = await goodStream.next();
  goodStream.stop();
  reject(
    'bad-batch',
    'insufficient_dialogue (session #2)',
    '--session',
    good.id,
    '--session',
    short.id,
  );
  reject(
    'duplicate',
    'invalid_session_selection',
    '--session',
    good.id,
    '--session',
    good.id.toUpperCase(),
  );

  await studio.close();
  // Controlled negative only: a real SSE-delivered beat exists, but advance the stored cursor
  // without its ACK receipt. No INSERT/SQL fixture is used to create any classroom evidence.
  const corruption = new DatabaseSync(studio.path);
  try {
    assert.equal(
      corruption
        .prepare('UPDATE sessions SET last_played_step_id = ? WHERE id = ?')
        .run(pending.step_id, good.id).changes,
      1,
    );
  } finally {
    corruption.close();
  }
  reject('mismatched', 'cursor_mismatch (session #1)', '--session', good.id);
});
