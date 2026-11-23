import type { CourseSummary, LessonEntry } from '@eduharness-studio/engine';
import { ArrowRight, Presentation } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { coursePath, errorMessage, lessonPath, request, useRead } from '@/lib/courses';
import { TopicIntake } from './TopicIntake';

export function HomePage() {
  const { data: courses, error, retry } = useRead<CourseSummary[]>('/courses');
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  const demos = courses?.filter(({ kind }) => kind === 'demo');
  const saved = courses?.filter(({ kind }) => kind === 'generated');

  async function openDemo(id: string) {
    setOpening(id);
    setOpenError('');
    try {
      const entry = await request<LessonEntry>(`/demos/${encodeURIComponent(id)}/entry`);
      window.location.assign(lessonPath(entry));
    } catch (err: unknown) {
      setOpenError(errorMessage(err));
      setOpening(null);
    }
  }

  return (
    <main className="dot-grid-canvas min-h-[calc(100dvh-4rem)]">
      <div className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-14">
        <div className="mb-8 max-w-2xl sm:mb-10">
          <Badge className="bg-highlight px-3 py-1 text-ink">一对一白板课堂</Badge>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-primary sm:text-5xl">
            今天，你想学什么？
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            从一节示范课开始，或按自己的基础和目标规划一门课。
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="demo-title"
            className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7"
          >
            <h2 id="demo-title" className="text-xl font-bold">
              精选示范课
            </h2>
            <p className="mb-5 mt-1 text-sm text-muted">选一张卡，直接进入第 1 节白板课堂。</p>
            <div className="grid gap-3">
              {demos?.map((demo) => (
                <Button
                  key={demo.id}
                  variant="outline"
                  className="group h-auto min-w-0 justify-start gap-3 rounded-xl px-3 py-4 text-left whitespace-normal hover:border-primary/40 hover:bg-primary-soft/25 sm:px-4"
                  disabled={opening !== null}
                  aria-label={`开始示范课：${demo.title}`}
                  onClick={() => void openDemo(demo.id)}
                >
                  <span className="grid size-10 shrink-0 place-items-center self-start rounded-lg bg-primary-soft text-primary">
                    <Presentation aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-primary">{demo.topic}</span>
                    <span className="mt-0.5 block text-base font-bold">{demo.title}</span>
                    <span className="mt-1 block text-sm font-normal leading-relaxed text-muted">
                      {opening === demo.id ? '正在打开白板…' : demo.summary}
                    </span>
                  </span>
                  <ArrowRight className="text-primary" aria-hidden="true" />
                </Button>
              ))}
              {!demos && !error && (
                <p role="status" className="text-sm text-muted">
                  正在加载示范课…
                </p>
              )}
              {error && (
                <div className="space-y-3">
                  <p role="alert" className="text-sm text-amber-800">
                    {error}
                  </p>
                  <Button variant="outline" onClick={retry}>
                    重新加载课程
                  </Button>
                </div>
              )}
              {openError && (
                <p role="alert" className="text-sm text-amber-800">
                  {openError}
                </p>
              )}
            </div>
          </section>
          <TopicIntake />
        </div>

        {saved && saved.length > 0 && (
          <section
            aria-labelledby="saved-title"
            className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7"
          >
            <h2 id="saved-title" className="text-xl font-bold">
              我的课程
            </h2>
            <ul className="mt-3 divide-y divide-border">
              {saved.map((course) => (
                <li key={course.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between whitespace-normal py-3 text-left"
                    render={<a href={coursePath(course.id)} />}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block">{course.title}</span>
                      <span className="mt-1 block text-xs font-normal text-muted">
                        {course.unitTitles.join(' → ')} · {course.lessonCount} 节课
                      </span>
                    </span>
                    <ArrowRight className="text-primary" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
