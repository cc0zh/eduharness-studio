import type { LessonEntry } from '@eduharness-studio/engine';
import { useEffect, useState } from 'react';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function coursePath(id: string) {
  return `/courses/${encodeURIComponent(id)}`;
}

export function lessonPath({ courseId, lessonId }: LessonEntry) {
  return `${coursePath(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
}

export async function request<T>(
  path: string,
  body?: object,
  options?: Pick<RequestInit, 'cache' | 'keepalive'>,
): Promise<T> {
  const res = await fetch(
    `/api${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          ...options,
        }
      : options,
  ).catch(() => {
    throw new Error('连接不上课堂服务，请检查服务是否开启后重试。');
  });
  const payload = !res.ok
    ? ((await res
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null)
    : null;
  if (res.status === 400)
    throw new ApiRequestError('输入有误，请检查内容后重试。', 400, payload?.error);
  if (res.status === 404) throw new ApiRequestError('没有找到这门课程。', 404, payload?.error);
  if (res.status === 410) {
    if (payload?.error === 'session_retired') {
      throw new ApiRequestError(
        '这节课的旧开发快照已停用。请使用「重新开始本课」从当前剧本开始。',
        410,
        payload.error,
      );
    }
    throw new ApiRequestError(
      '这门旧示范课已下线，请返回首页选择新版示范课。',
      410,
      payload?.error,
    );
  }
  if (!res.ok) {
    throw new ApiRequestError('课堂服务暂时不可用，请重试。', res.status, payload?.error);
  }
  return res.json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error && !(error instanceof SyntaxError)
    ? error.message
    : '课堂服务暂时不可用，请重试。';
}

type Result<T> = { data: T; error?: never } | { data?: never; error: string };

export function useRead<T>(path: string) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<T>(path, undefined, attempt > 0 ? { cache: 'reload' } : undefined).then(
      (data) => {
        if (active) setResult({ data });
      },
      (error: unknown) => {
        if (active) setResult({ error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  return {
    data: result?.data,
    error: result?.error,
    retry() {
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}
