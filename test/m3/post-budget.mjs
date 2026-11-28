import { appendFileSync, writeFileSync } from 'node:fs';
import { assertLivePostLimit, liveSceneLimits } from './mode.mjs';
import { SceneStop } from './scene-stop.mjs';

function singlePostOptions(input, init) {
  const request = input instanceof Request ? input : undefined;
  const value = init?.body ?? request?.body ?? '';
  const data = new Response(value);
  const headers = new Headers(init?.headers ?? request?.headers);
  const type = data.headers.get('content-type');
  if (type && !headers.has('content-type')) headers.set('content-type', type);
  if (
    (typeof value === 'string' || value instanceof Uint8Array) &&
    !headers.has('content-length')
  ) {
    headers.set('content-length', String(Buffer.byteLength(value)));
  }
  // Undici can retry a replayable Fetch body on 421 despite redirect:'error'.
  // A stream has no replay source: one reservation can send at most one POST.
  return { ...init, headers, body: data.body, duplex: 'half', redirect: 'error' };
}

function observeSse(response, signal, outcome) {
  const reader = response.body.getReader();
  let released = false;
  const body = new ReadableStream(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (released) return;
          if (done) {
            outcome('body_end');
            controller.close();
          } else controller.enqueue(value);
        } catch {
          if (released) return;
          outcome(signal?.aborted ? 'request_aborted' : 'transport_failure');
          controller.error(new Error('Model SSE read failed'));
        }
      },
      async cancel() {
        released = true;
        outcome(signal?.aborted ? 'request_aborted' : 'consumer_released');
        // SDKs can finish SSE at [DONE] without draining the underlying socket. A local
        // reader release is not upstream failure; the SDK still validates the output.
        await reader.cancel().catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function postBudget(file, { mode, limit }) {
  const live = mode === 'live';
  if (live) assertLivePostLimit(limit);
  else if (mode !== 'faux') throw new Error('Unknown POST budget mode');
  else if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Model POST limit must be a positive safe integer');
  // One fresh ledger per run, never truncate or reopen last run's allowance.
  writeFileSync(file, '', { flag: 'wx' });
  let reserved = 0;
  let stopped;
  const sceneCounts = new Map();
  const blockedScenes = new Set();
  const postsFor = (scene, actor) => {
    const counts = sceneCounts.get(scene);
    if (actor) return counts?.[actor] ?? 0;
    return (counts?.teacher ?? 0) + (counts?.student ?? 0);
  };
  function record(fields) {
    try {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...fields })}\n`);
    } catch (cause) {
      // SDKs can translate transport exceptions into application errors. Keep I/O fatal.
      stopped = new Error('Model POST ledger write failed', { cause });
      throw stopped;
    }
  }
  function stop(event, scene, fields) {
    if (!stopped) {
      stopped = new Error(`Model POST fuse: ${event}`);
      record({ event, scene, total: reserved, ...fields });
    }
  }
  function assertHealthy() {
    if (stopped) throw stopped;
  }
  return {
    total: () => reserved,
    postsFor,
    sceneBlocked: (scene) => blockedScenes.has(scene),
    sceneLimitReached: (scene) => live && postsFor(scene) >= liveSceneLimits[scene],
    assertHealthy,
    fetchFor(scene, endpoint, { actor = 'teacher', send = globalThis.fetch } = {}) {
      if (live && !Object.hasOwn(liveSceneLimits, scene)) throw new Error('Unapproved live scene');
      if (actor !== 'teacher' && actor !== 'student') throw new Error('Unknown model POST actor');
      return async (input, init) => {
        assertHealthy();
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (url !== endpoint || method.toUpperCase() !== 'POST') {
          stop('unexpected_model_destination', scene, { actor });
          assertHealthy();
        }
        if (reserved >= limit) {
          stop('budget_exhausted', scene, { actor, scope: 'total', limit });
          assertHealthy();
        }
        const scenePosts = postsFor(scene);
        const sceneLimit = liveSceneLimits[scene];
        if (live && scenePosts >= sceneLimit) {
          if (!blockedScenes.has(scene))
            record({
              event: 'budget_exhausted',
              scope: 'scene',
              scene,
              actor,
              scenePosts,
              limit: sceneLimit,
            });
          blockedScenes.add(scene);
          throw new SceneStop('budget_exhausted', 'scene_post_limit');
        }
        const seq = reserved + 1;
        const sceneSeq = scenePosts + 1;
        const log = (event, fields = {}) => record({ scene, actor, seq, event, ...fields });
        // Reserve synchronously before dispatch, never refund on a failed or released response.
        log('reserved', { sceneSeq });
        reserved = seq;
        const counts = sceneCounts.get(scene) ?? { teacher: 0, student: 0 };
        counts[actor]++;
        sceneCounts.set(scene, counts);
        const outcome = (event) => {
          log(event);
          if (event === 'transport_failure') stop('transport_stopped', scene, { actor });
        };
        let response;
        try {
          response = await send(
            input,
            live ? singlePostOptions(input, init) : { ...init, redirect: 'error' },
          );
        } catch {
          outcome(signal?.aborted ? 'request_aborted' : 'transport_failure');
          throw new Error('Model POST failed before response headers');
        }
        log('headers', { status: response.status });
        if (live && [401, 403, 407].includes(response.status)) {
          stop('model_auth_failed', scene, { actor });
          assertHealthy();
        }
        return response.ok &&
          response.body &&
          response.headers.get('content-type')?.includes('text/event-stream')
          ? observeSse(response, signal, outcome)
          : response;
      };
    },
  };
}
