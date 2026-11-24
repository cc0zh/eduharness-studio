import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { coursePath } from '@/lib/courses';
import { cn } from '@/lib/utils';
import { CoursePage } from './CoursePage';
import { HomePage } from './HomePage';
import { ModelStatusDialog } from './ModelStatusDialog';

export function App() {
  const { pathname } = window.location;
  const [, courseId, lessonId] =
    /^\/courses\/([a-z0-9-]+)(?:\/lessons\/([a-z0-9-]+))?\/?$/.exec(pathname) ?? [];
  const [homeVisit, setHomeVisit] = useState(0);
  const [xrayOpen, setXrayOpen] = useState(false);
  const isHome = !courseId && pathname === '/';
  const isBlueprint = Boolean(courseId && !lessonId);
  const isClassroom = Boolean(courseId && lessonId);

  useEffect(() => {
    if (pathname !== '/') return;
    function restoreHome(event: PageTransitionEvent) {
      // A cached home may still be submitting and its course list predates creation.
      if (event.persisted) setHomeVisit((visit) => visit + 1);
    }
    window.addEventListener('pageshow', restoreHome);
    return () => window.removeEventListener('pageshow', restoreHome);
  }, [pathname]);

  return (
    <div
      className={cn(
        'editorial-paper text-ink',
        isClassroom ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
    >
      <header
        className={cn('h-14', isHome ? 'bg-transparent' : 'border-b border-border bg-canvas')}
      >
        <nav
          aria-label="课堂导航"
          className={cn(
            'mx-auto flex h-full items-center justify-between gap-2 px-4 sm:gap-3 sm:px-7',
            isHome ? 'max-w-[55rem]' : isBlueprint ? 'max-w-[52rem] sm:px-8' : 'max-w-[84rem]',
          )}
        >
          <div className="flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3">
            {courseId && lessonId && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 px-2 text-xs text-ink-secondary"
                  render={<a href={coursePath(courseId)} />}
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  课程蓝图
                </Button>
                <span aria-hidden="true" className="hidden h-3.5 w-px bg-border-strong sm:block" />
              </>
            )}
            <a
              href="/"
              className={cn(
                'items-center gap-2 whitespace-nowrap rounded-sm font-serif text-[15px] font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink',
                courseId && lessonId ? 'hidden sm:flex' : 'flex',
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
              Eduharness课堂
            </a>
            {!lessonId && (
              <span className="hidden font-mono text-[10px] tracking-[0.08em] uppercase text-muted sm:inline">
                Studio
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ModelStatusDialog compact={Boolean(lessonId)} />
            {lessonId && (
              <>
                <span aria-hidden="true" className="h-3.5 w-px bg-border-strong" />
                <label
                  htmlFor="agent-xray"
                  className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-secondary hover:text-ink"
                >
                  <span>
                    <span className="hidden sm:inline">Agent </span>X-Ray
                  </span>
                  <Switch
                    id="agent-xray"
                    checked={xrayOpen}
                    onCheckedChange={setXrayOpen}
                    aria-label="Agent X-Ray"
                  />
                </label>
              </>
            )}
          </div>
        </nav>
      </header>
      {courseId ? (
        <CoursePage
          courseId={courseId}
          lessonId={lessonId}
          xrayOpen={xrayOpen}
          closeXray={() => setXrayOpen(false)}
        />
      ) : pathname === '/' ? (
        <HomePage key={homeVisit} />
      ) : (
        <main className="mx-auto max-w-4xl space-y-4 px-6 py-14">
          <h1 className="font-serif text-2xl font-semibold">找不到这个页面</h1>
          <Button render={<a href="/" />}>返回首页</Button>
        </main>
      )}
    </div>
  );
}
