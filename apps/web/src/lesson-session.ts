import type { SessionSnapshot } from '@eduharness-studio/engine';
import { ApiRequestError, request } from '@/lib/courses';
import { readPendingProgress } from './lesson-view-preferences';

export function sessionPath(id: string) {
  return `/sessions/${encodeURIComponent(id)}`;
}

function activeLesson(path: string) {
  return request<SessionSnapshot | null>(`${path}/sessions/active`, undefined, {
    cache: 'no-store',
  });
}

function claimLesson(id: string) {
  return request<SessionSnapshot>(`${sessionPath(id)}/resume`, readPendingProgress(id) ?? {});
}

export async function resumeLesson(path: string) {
  const existing = await activeLesson(path);
  if (!existing) return request<SessionSnapshot>(`${path}/sessions`, {});
  try {
    return await claimLesson(existing.session_id);
  } catch (reason) {
    if (
      !(reason instanceof ApiRequestError) ||
      reason.status !== 404 ||
      reason.code !== 'session_not_found'
    )
      throw reason;
    const current = await activeLesson(path);
    if (!current || current.session_id === existing.session_id) throw reason;
    return claimLesson(current.session_id);
  }
}

export async function restartLesson(path: string, previousId: string | undefined) {
  try {
    return await request<SessionSnapshot>(`${path}/sessions`, { restart: true });
  } catch (reason) {
    // An unknown outcome must not send a second restart and discard a newly created session.
    if (reason instanceof ApiRequestError && reason.status < 500) throw reason;
    const current = await activeLesson(path).catch(() => null);
    if (!current || current.session_id === previousId) throw reason;
    return claimLesson(current.session_id);
  }
}
