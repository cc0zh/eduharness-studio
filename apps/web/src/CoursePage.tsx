import type { CourseBlueprint, LessonRef } from '@eduharness-studio/engine';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { coursePath, lessonPath, useRead } from '@/lib/courses';
import { EditorialSkeleton } from './EditorialSkeleton';

const LessonWhiteboard = lazy(() =>
  import('./LessonWhiteboard').then(({ LessonWhiteboard }) => ({ default: LessonWhiteboard })),
);

type XrayControls = { xrayOpen: boolean; closeXray: () => void };

export function CoursePage({
  courseId,
  lessonId,
  ...xray
}: { courseId: string; lessonId?: string } & XrayControls) {
  const { data: course, error, retry } = useRead<CourseBlueprint>(coursePath(courseId));

  return (
    <main className="min-h-[calc(100dvh-3.5rem)]">
      {course ? (
        lessonId ? (
          <Whiteboard course={course} lessonId={lessonId} {...xray} />
        ) : (
          <Blueprint course={course} />
        )
      ) : (
        <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
          {error ? (
            <div className="space-y-4 border-l-2 border-accent pl-4">
              <p role="alert" className="text-sm text-accent">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={retry}>
                重新加载
              </Button>
            </div>
          ) : (
            <EditorialSkeleton label="正在打开课程蓝图…" rows={3} />
          )}
        </div>
      )}
    </main>
  );
}

function Blueprint({ course }: { course: CourseBlueprint }) {
  const lessonCount = course.units.reduce((total, unit) => total + unit.lessons.length, 0);
  return (
    <div className="mx-auto max-w-[52rem] px-5 pt-7 pb-20 sm:px-8 sm:pt-10">
      <div className="mb-8 flex items-center justify-between border-b border-border pb-3">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          返回首页
        </a>
        <span className="font-mono text-[11px] text-muted">
          {course.units.length} UNITS · {lessonCount} LESSONS
        </span>
      </div>

      <header className="mb-10 border-b border-ink pb-7">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-accent">
          Course Blueprint · 动态课程蓝图
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
          {course.title}
        </h1>
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          从第一节就绪课节进入白板；后续课节保留为按需懒生成态，随你的真实作答动态展开。
        </p>
      </header>

      <div className="space-y-10">
        {course.units.map((unit, index) => (
          <section key={unit.id} aria-labelledby={unit.id}>
            <div className="mb-3.5 flex flex-wrap items-baseline gap-3 border-b border-border pb-2.5">
              <span className="font-serif text-sm italic text-accent">
                Unit {String(index + 1).padStart(2, '0')}
              </span>
              <h2 id={unit.id} className="font-serif text-lg font-semibold text-ink">
                {unit.title}
              </h2>
            </div>
            <ol aria-label={`${unit.title}的课节`} className="space-y-2.5">
              {unit.lessons.map((lesson, lessonIndex) => (
                <LessonRow
                  key={lesson.id}
                  courseId={course.id}
                  lesson={lesson}
                  number={lessonIndex + 1}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function LessonRow({
  lesson,
  courseId,
  number,
}: {
  lesson: LessonRef;
  courseId: string;
  number: number;
}) {
  const locked = lesson.status === 'locked';
  return (
    <li
      className={
        locked
          ? 'grid items-center gap-3 rounded-sm border border-dashed border-border-strong px-5 py-4 sm:grid-cols-[auto_1fr_auto]'
          : 'grid items-center gap-3 rounded-sm border border-border-strong bg-surface px-5 py-4 transition-colors hover:border-ink sm:grid-cols-[auto_1fr_auto]'
      }
    >
      <span
        aria-hidden="true"
        className="hidden font-mono text-xs tabular-nums text-muted sm:block"
      >
        {String(number).padStart(2, '0')}
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <div className="mb-1 flex items-center gap-2 text-[11px]">
          {locked ? (
            <span className="inline-flex items-center gap-1 text-muted">
              <LockKeyhole className="size-3" aria-hidden="true" />
              学到这里时生成
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-olive">
              <Check className="size-3" aria-hidden="true" />
              {lesson.status === 'completed' ? '已完成' : '已就绪'}
            </span>
          )}
        </div>
        <h3
          className={
            locked
              ? 'font-serif text-base font-medium text-ink-secondary'
              : 'font-serif text-base font-semibold text-ink'
          }
        >
          {lesson.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{lesson.summary}</p>
      </div>
      {!locked && (
        <Button size="sm" render={<a href={lessonPath({ courseId, lessonId: lesson.id })} />}>
          进入白板 <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

function Whiteboard({
  course,
  lessonId,
  ...xray
}: { course: CourseBlueprint; lessonId: string } & XrayControls) {
  const unit = course.units.find((unit) => unit.lessons.some(({ id }) => id === lessonId));
  const lesson = unit?.lessons.find(({ id }) => id === lessonId);
  const title = !lesson
    ? '找不到这个课节'
    : lesson.status === 'locked'
      ? '学到这里时生成'
      : lesson.title;

  return lesson && lesson.status !== 'locked' ? (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl px-5 py-12">
          <EditorialSkeleton label="正在加载白板课堂…" rows={4} />
        </div>
      }
    >
      <LessonWhiteboard
        {...xray}
        key={`${course.id}:${lessonId}`}
        title={lesson.title}
        summary={lesson.summary}
        path={lessonPath({ courseId: course.id, lessonId })}
      />
    </Suspense>
  ) : (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <section aria-labelledby="lesson-title" className="border-l-2 border-accent pl-5">
        <p className="font-mono text-xs text-muted">Eduharness课堂{unit && ` · ${unit.title}`}</p>
        <h1 id="lesson-title" className="mt-2 font-serif text-2xl font-semibold text-ink">
          {title}
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-secondary">
          请返回课程蓝图，选择已经就绪的课节。
        </p>
      </section>
    </div>
  );
}
