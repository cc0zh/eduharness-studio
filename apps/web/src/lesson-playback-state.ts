import type { PlaybackWriteReceipt, SessionSnapshot } from '@eduharness-studio/engine';
import { recordKey } from './lesson-playback';

export function playbackOwner(id: string, generation: number) {
  return `${id}:${generation}`;
}

export function applyPlaybackReceipt(
  snapshot: SessionSnapshot | undefined,
  { record, keypoints }: PlaybackWriteReceipt,
) {
  if (!snapshot) return snapshot;
  const updated = keypoints ? { ...snapshot, keypoints } : snapshot;
  if (!record || updated.records.some((entry) => recordKey(entry) === recordKey(record)))
    return updated;
  return { ...updated, records: [...updated.records, record] };
}
