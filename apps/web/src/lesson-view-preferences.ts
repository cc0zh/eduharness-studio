// Tab-local controls only. The played board, pending ask, and record are always read from SQLite.
export function readViewPreference(id: string, kind: 'paused' | 'page' | 'progress') {
  try {
    return sessionStorage.getItem(`lesson-view:${id}:${kind}`);
  } catch {
    return null;
  }
}

export function writeViewPreference(
  id: string,
  kind: 'paused' | 'page' | 'progress',
  value: string | null,
) {
  try {
    const key = `lesson-view:${id}:${kind}`;
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // The page still works when browser storage is disabled.
  }
}

export function readPagePreference(id: string) {
  const value = readViewPreference(id, 'page');
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof parsed.id === 'string' &&
      'step' in parsed &&
      typeof parsed.step === 'number' &&
      Number.isSafeInteger(parsed.step)
    )
      return { id: parsed.id, step: parsed.step };
  } catch {
    // An obsolete page preference falls back to the latest committed page.
  }
  return null;
}

export function writePagePreference(id: string, value: { id: string; step: number } | null) {
  writeViewPreference(id, 'page', value ? JSON.stringify(value) : null);
}

export interface PendingProgress {
  generation: number;
  last_played_step_id: number;
}

export function readPendingProgress(id: string): PendingProgress | null {
  const raw = readViewPreference(id, 'progress');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'generation' in parsed &&
      Number.isSafeInteger(parsed.generation) &&
      'last_played_step_id' in parsed &&
      Number.isSafeInteger(parsed.last_played_step_id) &&
      Number(parsed.generation) > 0 &&
      Number(parsed.last_played_step_id) > 0
    ) {
      return {
        generation: Number(parsed.generation),
        last_played_step_id: Number(parsed.last_played_step_id),
      };
    }
  } catch {
    // An invalid receipt cannot advance the server cursor.
  }
  return null;
}

export function writePendingProgress(id: string, receipt: PendingProgress) {
  writeViewPreference(id, 'progress', JSON.stringify(receipt));
}

export function clearPendingProgress(id: string) {
  writeViewPreference(id, 'progress', null);
}
