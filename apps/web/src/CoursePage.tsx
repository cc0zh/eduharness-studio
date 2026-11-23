import type { CourseBlueprint, LessonRef } from '@eduharness-studio/engine';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { coursePath, lessonPath, useRead } from '@/lib/courses';

const LessonWhiteboard = lazy(() =>
  import('./LessonWhiteboard').then(({ LessonWhiteboard }) => ({ default: LessonWhiteboard })),
);

export function CoursePage({ courseId, lessonId }: { courseId: string; lessonId?: string }) {
  const { data: course, error, retry } = useRead<CourseBlueprint>(coursePath(courseId));

  return (
    <main className="dot-grid-canvas min-h-[calc(100dvh-4rem)]">
      {course ? (
        lessonId ? (
          <Whiteboard course={course} lessonId={lessonId} />
        ) : (
          <Blueprint course={course} />
        )
      ) : (
        <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
          {error ? (
            <div className="max-w-xl space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <p role="alert" className="text-amber-800">
                {error}
              </p>
              <Button variant="outline" onClick={retry}>
                重新加载
              </Button>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted">
              正在打开课程…
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function Blueprint({ course }: { course: CourseBlueprint }) {
  const lessonCount = course.units.reduce((total, unit) => total + unit.lessons.length, 0);
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Button variant="ghost" className="-ml-3 mb-4" render={<a href="/" />}>
        ← 首页
      </Button>
      <header className="mb-6 rounded-2xl border border-primary/20 bg-surface p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-highlight text-ink">课程蓝图</Badge>
          <span className="text-sm text-muted">
            {course.units.length} 个单元 · {lessonCount} 节课
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-primary [overflow-wrap:anywhere]">
          {course.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          从第一节就绪课节开始。后续课节在学到时生成。
        </p>
      </header>
      <div className="space-y-4">
        {course.units.map((unit, index) => (
          <section
            key={unit.id}
            aria-labelledby={unit.id}
            className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Badge>单元 {index + 1}</Badge>
              <h2 id={unit.id} className="text-lg font-bold">
                {unit.title}
              </h2>
            </div>
            <ol aria-label={`${unit.title}的课节`} className="mt-3 divide-y divide-border">
              {unit.lessons.map((lesson, l) => (
                <LessonRow key={lesson.id} courseId={course.id} lesson={lesson} number={l + 1} />
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
  return (
    <li className="grid items-center gap-2 py-3 sm:grid-cols-[auto_1fr_auto] sm:gap-3">
      <span aria-hidden="true" className="hidden text-sm tabular-nums text-muted sm:block">
        {String(number).padStart(2, '0')}
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <h3 className="text-sm font-semibold">{lesson.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{lesson.summary}</p>
      </div>
      {lesson.status === 'locked' ? (
        <Badge variant="muted" className="w-fit px-3 py-1.5">
          <LockKeyhole className="size-3.5" aria-hidden="true" /> 学到这里时生成
        </Badge>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{lesson.status === 'completed' ? '已完成' : '已就绪'}</Badge>
          <Button size="sm" render={<a href={lessonPath({ courseId, lessonId: lesson.id })} />}>
            进入白板 <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  );
}

function Whiteboard({ course, lessonId }: { course: CourseBlueprint; lessonId: string }) {
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
        <p role="status" className="mx-auto max-w-4xl px-5 py-12 text-sm text-muted">
          正在加载课堂…
        </p>
      }
    >
      <LessonWhiteboard
        key={`${course.id}:${lessonId}`}
        title={lesson.title}
        summary={lesson.summary}
        path={lessonPath({ courseId: course.id, lessonId })}
      />
    </Suspense>
  ) : (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <section
        aria-labelledby="lesson-title"
        className="rounded-2xl border border-border bg-surface p-6 shadow-sm"
      >
        <p className="text-sm font-medium text-primary">
          Eduharness课堂{unit && ` · ${unit.title}`}
        </p>
        <h1 id="lesson-title" className="mt-3 text-2xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          请返回课程蓝图，选择已经就绪的课节。
        </p>
      </section>
    </div>
  );
}
