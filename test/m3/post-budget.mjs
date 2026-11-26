import { appendFileSync, writeFileSync } from 'node:fs';

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

export function postBudget(file, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Model POST limit must be a positive safe integer');
  writeFileSync(file, '', { flag: 'wx' });
  let reserved = 0;
  let stopped;
  function record(fields) {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...fields })}\n`);
  }
  function stop(event, scene) {
    if (!stopped) {
      stopped = event;
      record({ event, scene, total: reserved });
    }
  }
  function assertHealthy() {
    if (stopped) throw new Error(`Model POST fuse: ${stopped}`);
  }
  return {
    total: () => reserved,
    assertHealthy,
    fetchFor(scene, endpoint, send = globalThis.fetch) {
      return async (input, init) => {
        assertHealthy();
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (url !== endpoint || method.toUpperCase() !== 'POST') {
          stop('unexpected_model_destination', scene);
          assertHealthy();
        }
        if (reserved >= limit) {
          stop('budget_exhausted', scene);
          assertHealthy();
        }
        const seq = ++reserved;
        const log = (event, fields = {}) => record({ scene, seq, event, ...fields });
        // Reserve synchronously before dispatch, never refund on a failed or released response.
        log('reserved');
        const outcome = (event) => {
          log(event);
          if (event === 'transport_failure') stop('transport_stopped', scene);
        };
        let response;
        try {
          response = await send(input, { ...init, redirect: 'error' });
        } catch {
          outcome(signal?.aborted ? 'request_aborted' : 'transport_failure');
          throw new Error('Model POST failed before response headers');
        }
        log('headers', { status: response.status });
        return response.ok &&
          response.body &&
          response.headers.get('content-type')?.includes('text/event-stream')
          ? observeSse(response, signal, outcome)
          : response;
      };
    },
  };
}
