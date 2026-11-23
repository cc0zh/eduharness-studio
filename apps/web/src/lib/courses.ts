import type { LessonEntry } from '@eduharness-studio/engine';
import { useEffect, useState } from 'react';

export function coursePath(id: string) {
  return `/courses/${encodeURIComponent(id)}`;
}

export function lessonPath({ courseId, lessonId }: LessonEntry) {
  return `${coursePath(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
}

export async function request<T>(path: string, body?: object, cache?: RequestCache): Promise<T> {
  const res = await fetch(
    `/api${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache },
  ).catch(() => {
    throw new Error('连接不上课堂服务，请检查服务是否开启后重试。');
  });
  if (res.status === 400) throw new Error('输入有误，请检查内容后重试。');
  if (res.status === 404) throw new Error('没有找到这门课程。');
  if (!res.ok) throw new Error('课堂服务暂时不可用，请重试。');
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
    request<T>(path, undefined, attempt > 0 ? 'reload' : undefined).then(
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
