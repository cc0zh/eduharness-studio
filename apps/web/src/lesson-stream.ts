import {
  type LessonBeat,
  readCurrentLessonBeat,
  readLessonEnd,
  readLessonGeneration,
  type SessionSnapshot,
} from '@eduharness-studio/engine';
import { sessionPath } from './lesson-session';

type StreamEnd =
  | { kind: 'done' | 'interrupted' | 'superseded'; snapshot: SessionSnapshot }
  | { kind: 'unavailable' };

export function subscribeLesson(
  id: string,
  generation: number,
  callbacks: {
    ready: (ready: boolean) => void;
    beat: (beat: LessonBeat) => void;
    end: (event: StreamEnd) => void;
  },
) {
  const source = new EventSource(`/api${sessionPath(id)}/stream?generation=${generation}`);
  let lastSequence = 0;

  function payload(raw: Event): unknown {
    try {
      return JSON.parse((raw as MessageEvent<string>).data);
    } catch {
      return undefined;
    }
  }

  source.addEventListener('stream', (raw) => {
    if (readLessonGeneration(payload(raw)) === generation) callbacks.ready(true);
  });
  source.addEventListener('beat', (raw) => {
    const beat = readCurrentLessonBeat(payload(raw), generation, lastSequence);
    if (!beat) return;
    lastSequence = beat.seq;
    callbacks.beat(beat);
  });
  for (const kind of ['done', 'interrupted', 'superseded'] as const) {
    source.addEventListener(kind, (raw) => {
      const message = readLessonEnd(payload(raw));
      source.close();
      if (message?.generation !== generation || message.snapshot.session_id !== id) {
        callbacks.end({ kind: 'unavailable' });
        return;
      }
      const snapshot = message.snapshot;
      callbacks.end({
        kind:
          kind === 'interrupted' && snapshot.generation !== generation + 1 ? 'superseded' : kind,
        snapshot,
      });
    });
  }
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) callbacks.end({ kind: 'unavailable' });
    else callbacks.ready(false); // Native reconnect reattaches to this generation, it never claims another.
  };
  return () => source.close();
}
