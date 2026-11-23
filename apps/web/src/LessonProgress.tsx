import type { Keypoint } from '@eduharness-studio/engine';

export function LessonProgress({
  keypoints,
  currentIndex,
}: {
  keypoints: Keypoint[];
  currentIndex: number;
}) {
  const current = keypoints[currentIndex];
  const dense = keypoints.length > 3;
  if (!dense) {
    return (
      <nav aria-label="本课要点进度" data-progress-mode="flat" className="flex flex-wrap gap-2">
        {keypoints.map((point) => (
          <span
            key={point.id}
            data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
            aria-current={point.status === 'active' ? 'step' : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
              point.status === 'completed'
                ? 'border-primary/25 bg-primary-soft text-primary'
                : point.status === 'active'
                  ? 'border-primary bg-white text-primary shadow-sm'
                  : 'border-border bg-white/70 text-muted'
            }`}
          >
            <span aria-hidden="true">{point.status === 'completed' ? '✓' : '○'}</span>
            {point.title}
          </span>
        ))}
      </nav>
    );
  }

  return (
    <details data-progress-mode="collapsed" className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-border bg-white px-3 py-2 shadow-sm focus-visible:outline-2 focus-visible:outline-primary">
        <span className="flex items-center gap-1" aria-hidden="true">
          {keypoints.map((point) => (
            <span
              key={point.id}
              data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
              className={`size-2.5 rounded-full ${point.status === 'completed' ? 'bg-primary' : point.status === 'active' ? 'bg-[#D99B38] ring-2 ring-[#FDE0A6]' : 'bg-slate-300'}`}
            />
          ))}
        </span>
        <span className="sr-only">
          {keypoints.filter(({ status }) => status === 'completed').length} 个要点已完成。
        </span>
        <span className="max-w-44 truncate text-sm font-semibold text-ink">
          {current?.title ?? '本课已完成'}
        </span>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted">
          {Math.min(currentIndex + 1, keypoints.length)}/{keypoints.length}
        </span>
        <span className="text-xs text-primary group-open:hidden">查看要点</span>
        <span className="hidden text-xs text-primary group-open:inline">收起</span>
      </summary>
      <ol className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-1 rounded-2xl border border-border bg-white p-3 shadow-xl">
        {keypoints.map((point, index) => (
          <li
            key={point.id}
            data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
            className={`flex gap-3 rounded-xl px-3 py-2 text-sm ${point.status === 'active' ? 'bg-primary-soft/60' : ''}`}
          >
            <span className="font-semibold tabular-nums text-primary">
              {point.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{point.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {point.objective}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
