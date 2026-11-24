import {
  BAYES_DEMO_ID,
  type CourseSummary,
  type LessonEntry,
  TRANSFORMER_DEMO_ID,
} from '@eduharness-studio/engine';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { coursePath, errorMessage, lessonPath, request, useRead } from '@/lib/courses';
import { EditorialSkeleton } from './EditorialSkeleton';
import { TopicIntake } from './TopicIntake';

const demoMeta: Record<string, { layout: string; keypoints: string }> = {
  [BAYES_DEMO_ID]: {
    layout: '2 栏白板 · 3 要点 · 2 页',
    keypoints: '先验基准率 · 修正倒置条件 · 换基率迁移',
  },
  [TRANSFORMER_DEMO_ID]: {
    layout: '3 栏白板 · 5 要点 · 紧凑进度',
    keypoints: '语境指代 · Q/K/V · 缩放点积 · 加权汇聚等 5 项',
  },
};

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
    <main className="min-h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto max-w-[55rem] px-5 pt-7 pb-20 sm:px-7 sm:pt-10">
        <div className="mx-auto mb-11 max-w-[40.5rem] text-center">
          <div className="mb-4 inline-flex items-center gap-3 text-[11.5px] tracking-[0.12em] text-muted">
            <span aria-hidden="true" className="h-px w-4 bg-border-strong" />
            <span>一对一分栏白板 · 节拍式深度学习</span>
            <span aria-hidden="true" className="h-px w-4 bg-border-strong" />
          </div>
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-[38px]">
            把复杂概念，一拍一拍讲透
          </h1>
          <p className="mx-auto mt-3 max-w-[32rem] text-[14.5px] leading-[1.82] text-ink-secondary">
            不一次性倾倒长文，也不用聊天气泡来回翻找。在纯净纸面上随节拍看清直觉、图解与推导。
          </p>
          <div className="mt-7">
            <TopicIntake />
          </div>
        </div>

        <section aria-labelledby="demo-title" className="mb-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2.5">
            <h2 id="demo-title" className="text-xs font-medium tracking-[0.08em] text-muted">
              精选示范课 · 即刻入座
            </h2>
            <span className="text-[11.5px] text-ink-faint">
              进入课堂体验铜版图解、分栏演播与 X-Ray 校样
            </span>
          </div>

          {!demos && !error && (
            <div className="mt-4">
              <EditorialSkeleton label="正在准备精选示范课…" rows={2} />
            </div>
          )}

          {error && (
            <div className="mt-4 space-y-3 border-l-2 border-accent pl-4">
              <p role="alert" className="text-sm text-accent">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={retry}>
                重新加载课程
              </Button>
            </div>
          )}

          {openError && (
            <p role="alert" className="mt-3 text-sm text-accent">
              {openError}
            </p>
          )}

          {demos && demos.length > 0 && (
            <div className="mt-2 grid grid-cols-1 md:-mx-4 md:grid-cols-2">
              {demos.map((demo, index) => {
                const meta = demoMeta[demo.id];
                const isOpening = opening === demo.id;
                return (
                  <button
                    key={demo.id}
                    type="button"
                    disabled={opening !== null}
                    aria-label={`开始示范课：${demo.title}`}
                    onClick={() => void openDemo(demo.id)}
                    className={`group relative flex cursor-pointer flex-col justify-between rounded-xl px-3 py-6 text-left transition-colors hover:bg-surface/80 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-60 md:px-7 ${
                      index > 0
                        ? 'border-t border-border md:border-t-0 md:before:absolute md:before:inset-y-6 md:before:left-0 md:before:w-px md:before:bg-border'
                        : ''
                    }`}
                  >
                    <div>
                      <div className="mb-3 flex items-baseline justify-between gap-3">
                        <span className="font-serif text-2xl italic leading-none text-accent">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="font-mono text-[11px] text-muted">
                          {meta?.layout ?? demo.topic}
                        </span>
                      </div>
                      <h3 className="font-serif text-[20px] font-semibold leading-snug text-ink">
                        {demo.title}
                      </h3>
                      <p className="mt-2.5 text-[13.8px] leading-[1.82] text-ink-secondary">
                        {isOpening ? '正在铺开白板讲义…' : demo.summary}
                      </p>
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-muted">
                        {meta?.keypoints ?? demo.unitTitles.join(' · ')}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-ink transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                        {isOpening ? '进入中' : '入座上课'}
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {saved && saved.length > 0 && (
          <section aria-labelledby="saved-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2.5">
              <h2 id="saved-title" className="text-xs font-medium tracking-[0.08em] text-muted">
                我的课程
              </h2>
              <span className="text-[11.5px] text-ink-faint">
                后续课节按需懒生成，紧贴你的真实作答
              </span>
            </div>
            <ul className="mt-1 divide-y divide-border-faint">
              {saved.map((course) => (
                <li
                  key={course.id}
                  className="-mx-2 flex flex-wrap items-center justify-between gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-surface/70"
                >
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <div className="font-serif text-base font-semibold text-ink">
                      {course.title}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {course.unitTitles.join(' → ')} · {course.lessonCount} 节课
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <a
                      href={coursePath(course.id)}
                      className="inline-flex items-center gap-1 text-[13px] font-medium text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      查看蓝图
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
