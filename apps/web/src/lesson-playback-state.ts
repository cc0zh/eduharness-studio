import type { LessonRecord, SessionSnapshot } from '@eduharness-studio/engine';
import { recordKey } from './lesson-playback';

export function playbackOwner(id: string, generation: number) {
  return `${id}:${generation}`;
}

export function addRecord(snapshot: SessionSnapshot | undefined, record: LessonRecord | undefined) {
  if (
    !snapshot ||
    !record ||
    snapshot.records.some((entry) => recordKey(entry) === recordKey(record))
  )
    return snapshot;
  return { ...snapshot, records: [...snapshot.records, record] };
}
