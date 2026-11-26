import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import {
  type Action,
  readLessonBeat,
  type SessionQuality,
  type SessionSnapshot,
  type SessionTrace,
} from '@eduharness-studio/engine';
import { createFauxModelGateway } from '@eduharness-studio/engine/models';
import { serve } from '@hono/node-server';
import { createServerApp } from '../apps/server/src/app.js';
import { openStudioDatabase } from '../apps/server/src/db.js';

export const byokSentinel = 'SYNTHETIC_ONLY_BYOK_M3_2';

export async function exportClassroom(t: TestContext, retain = false) {
  const evidence = retain && process.env.STUDIO_M3_2_EVIDENCE_DIR;
  const dir = mkdtempSync(join(evidence || tmpdir(), 'studio-judge-'));
  const path = join(dir, 'studio.sqlite');
  const database = openStudioDatabase(path);
  const faux = createFauxModelGateway();
  assert.ok(faux.gateway.setByok({ provider: 'faux', modelId: 'faux-1', apiKey: byokSentinel }));
  const app = createServerApp({ database, modelGateway: faux.gateway });
  const shutdown = new AbortController();
  const ssePipes = new Set<Promise<void>>();
  const server = serve({
    async fetch(request) {
      const response = await app.fetch(request);
      if (!response.body || response.headers.get('content-type') !== 'text/event-stream')
        return response;
      // A closed socket alone doesn't prove Hono's SSE callback has seen cancellation.
      const pipe = new TransformStream<Uint8Array, Uint8Array>();
      const drained = response.body
        .pipeTo(pipe.writable, { signal: shutdown.signal, preventAbort: true })
        .catch(() => {});
      ssePipes.add(drained);
      void drained.then(() => ssePipes.delete(drained));
      return new Response(pipe.readable, response);
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  const streams = new Set<AbortController>();
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    shutdown.abort();
    for (const stream of streams) stream.abort();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
    await Promise.all(ssePipes);
    database.close();
  }
  t.after(async () => {
    await close();
    if (!evidence) rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  });
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  async function json<T>(route: string, status: number, body?: object): Promise<T> {
    const response = await fetch(`${base}${route}`, {
      ...(body && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${route}: ${JSON.stringify(data)}`);
    return data as T;
  }

  function session({ session_id, generation }: SessionSnapshot) {
    const route = `/api/sessions/${session_id}`;
    return {
      id: session_id,
      quality: () => json<SessionQuality>(`${route}/quality`, 200, {}),
      trace: () => json<SessionTrace>(`${route}/xray`, 200),
      answer: (ask: Action, response: { text: string } | { option_id: string }) =>
        json<{ ok: true }>(`${route}/answer`, 200, {
          generation,
          ask_step_id: ask.step_id,
          ...response,
        }),
      interrupt: (step: number, text: string) =>
        json<SessionSnapshot>(`${route}/interrupt`, 200, {
          generation,
          last_played_step_id: step,
          text,
        }),
      async open() {
        const disconnect = new AbortController();
        streams.add(disconnect);
        const response = await fetch(`${base}${route}/stream?generation=${generation}`, {
          signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(15_000)]),
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
        assert.ok(response.body);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        async function next() {
          for (;;) {
            const end = buffer.indexOf('\n\n');
            if (end === -1) {
              const chunk = await reader.read();
              assert.ok(!chunk.done, 'SSE ended before the next beat');
              buffer += decoder.decode(chunk.value, { stream: true });
              continue;
            }
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith(':') || /^event: stream$/m.test(frame)) continue;
            assert.match(frame, /^event: beat$/m);
            const beat = readLessonBeat(JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? 'null'));
            assert.ok(beat && beat.generation === generation);
            return beat.action;
          }
        }
        async function ack({ step_id }: Action) {
          const receipt = await json<{ ok: true }>(`${route}/progress`, 200, {
            generation,
            last_played_step_id: step_id,
          });
          assert.equal(receipt.ok, true);
        }
        return {
          next,
          ack,
          async toAsk() {
            for (let i = 0; i < 30; i++) {
              const action = await next();
              await ack(action);
              if (action.type === 'ask') return action;
            }
            throw new Error('Fixture did not reach an ask');
          },
          stop() {
            disconnect.abort();
            streams.delete(disconnect);
          },
        };
      },
    };
  }

  return {
    dir,
    path,
    faux,
    close,
    session,
    async start(courseId: string, restart = false) {
      const snapshot = await json<SessionSnapshot>(
        `/api/courses/${courseId}/lessons/u1-l1/sessions`,
        201,
        { restart },
      );
      return session(snapshot);
    },
    async generate(topic: string) {
      return json<{ id: string; title: string }>('/api/intake/generate', 201, {
        topic,
        foundation: 'beginner',
        goal: 'understand',
      });
    },
  };
}
