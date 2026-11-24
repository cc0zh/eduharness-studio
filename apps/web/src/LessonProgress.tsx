import type { Keypoint } from '@eduharness-studio/engine';
import { Check } from 'lucide-react';

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
      <nav
        aria-label="本课要点进度"
        data-progress-mode="flat"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
      >
        {keypoints.map((point, index) => (
          <div key={point.id} className="inline-flex items-center gap-3">
            {index > 0 && <span aria-hidden="true" className="h-px w-3 bg-border-strong" />}
            <span
              data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
              aria-current={point.status === 'active' ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 border-b-[1.5px] pb-0.5 text-xs transition-colors ${
                point.status === 'completed'
                  ? 'border-transparent font-medium text-olive'
                  : point.status === 'active'
                    ? 'border-accent font-medium text-ink'
                    : 'border-transparent text-ink-faint'
              }`}
            >
              <span aria-hidden="true" className="font-mono text-[10.5px]">
                {point.status === 'completed' ? (
                  <Check className="inline size-3" />
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </span>
              {point.title}
            </span>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <details data-progress-mode="collapsed" className="group relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-3 rounded-xs border border-border bg-surface px-3 py-1.5 transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-ink">
        <span className="font-mono text-[11px] font-semibold tabular-nums text-accent">
          {String(Math.min(currentIndex + 1, keypoints.length)).padStart(2, '0')}/
          {String(keypoints.length).padStart(2, '0')}
        </span>
        <span className="max-w-44 truncate text-xs font-medium text-ink">
          {current?.title ?? '本课已完成'}
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          {keypoints.map((point) => (
            <span
              key={point.id}
              data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
              className={`h-0.5 transition-all ${
                point.status === 'completed'
                  ? 'w-3 bg-olive'
                  : point.status === 'active'
                    ? 'w-4 bg-accent'
                    : 'w-2.5 bg-border-strong'
              }`}
            />
          ))}
        </span>
        <span className="sr-only">
          {keypoints.filter(({ status }) => status === 'completed').length} 个要点已完成。
        </span>
        <span className="text-[11px] text-muted group-open:hidden">查看要点</span>
        <span className="hidden text-[11px] text-muted group-open:inline">收起</span>
      </summary>
      <ol className="absolute left-0 top-full z-30 mt-1.5 w-[min(21rem,calc(100vw-2rem))] divide-y divide-border-faint rounded-sm border border-border-strong bg-surface px-3.5 py-2 shadow-[0_8px_24px_rgba(26,25,23,0.08)]">
        {keypoints.map((point, index) => (
          <li
            key={point.id}
            data-completed-keypoint={point.status === 'completed' ? point.id : undefined}
            className={`flex gap-3 py-2 text-xs ${
              point.status === 'completed'
                ? 'text-olive'
                : point.status === 'active'
                  ? 'text-ink'
                  : 'text-muted'
            }`}
          >
            <span className="mt-0.5 font-mono text-[10.5px] font-semibold tabular-nums">
              {point.status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{point.title}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                {point.objective}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
