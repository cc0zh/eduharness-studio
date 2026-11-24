import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { coursePath } from '@/lib/courses';
import { CoursePage } from './CoursePage';
import { HomePage } from './HomePage';

export function App() {
  const { pathname } = window.location;
  const [, courseId, lessonId] =
    /^\/courses\/([a-z0-9-]+)(?:\/lessons\/([a-z0-9-]+))?\/?$/.exec(pathname) ?? [];
  const [homeVisit, setHomeVisit] = useState(0);
  const [xrayOpen, setXrayOpen] = useState(false);

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
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="h-16 border-b border-border bg-surface">
        <nav
          aria-label="课堂导航"
          className="mx-auto flex h-full max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-8"
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {courseId && lessonId && (
              <Button variant="outline" size="sm" render={<a href={coursePath(courseId)} />}>
                ← 课程蓝图
              </Button>
            )}
            <a
              href="/"
              className="flex items-center gap-2 whitespace-nowrap rounded-md text-sm font-bold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              {!(courseId && lessonId) && (
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
                  <BookOpen className="size-4" aria-hidden="true" />
                </span>
              )}
              Eduharness课堂
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant="secondary" className={lessonId ? 'hidden sm:inline-flex' : undefined}>
              离线确定性模式
            </Badge>
            {lessonId && (
              <label
                htmlFor="agent-xray"
                className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-primary sm:text-sm"
              >
                <span>
                  <span className="hidden min-[380px]:inline">Agent </span>X-Ray
                </span>
                <Switch
                  id="agent-xray"
                  checked={xrayOpen}
                  onCheckedChange={setXrayOpen}
                  aria-label="Agent X-Ray"
                />
              </label>
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
        <main className="mx-auto max-w-6xl space-y-4 p-8">
          <h1 className="text-xl font-bold">找不到这个页面</h1>
          <Button render={<a href="/" />}>返回首页</Button>
        </main>
      )}
    </div>
  );
}
