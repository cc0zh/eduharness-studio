import type { DepthTag } from '@eduharness-studio/engine';
import { ArrowDown, Network } from 'lucide-react';
import type { BoardCanvas, BoardCard, BoardMark } from './lesson-playback';

const depthLabel: Record<DepthTag, string> = {
  intuition: '直觉',
  definition: '定义',
  derivation: '推导',
  theory: '理论',
  application: '应用',
};

export function BoardStage({ canvas }: { canvas: BoardCanvas }) {
  return (
    <section
      aria-label="白板画布"
      className="dot-grid-canvas min-h-[48vh] rounded-[1.75rem] border border-slate-200/80 p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
            <Network aria-hidden="true" className="size-4" />
          </span>
          <span data-page-title>{canvas.pageTitle}</span>
          <span
            aria-hidden="true"
            className="ml-auto flex items-center gap-1 text-xs font-normal text-muted"
          >
            按栏铺开 <ArrowDown className="size-3" />
          </span>
        </div>
        <div
          data-board-columns={canvas.columns}
          className="grid items-start gap-4 overflow-x-auto"
          style={{
            gridTemplateColumns: `repeat(${canvas.columns}, minmax(min(100%, 260px), 1fr))`,
          }}
        >
          {columnSlots(canvas.columns).map(({ id, number }) => (
            <section key={id} aria-label={`板书第 ${number} 栏`} className="min-w-0 space-y-4">
              <div className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-slate-400">
                <span className="size-1.5 rounded-full bg-primary/50" /> 栏{' '}
                {String(number).padStart(2, '0')}
              </div>
              {canvas.cards
                .filter(({ action }) => action.column === number)
                .map((card) => (
                  <BoardCardView key={card.action.card_id} card={card} />
                ))}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function BoardCardView({ card }: { card: BoardCard }) {
  const { action, marks } = card;
  const title = action.title ?? '板书';
  const depth = action.depth ?? 'intuition';
  return (
    <article
      data-board-card={action.card_id}
      data-card-kind={action.type}
      className="rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-[0_8px_28px_-18px_rgba(15,82,80,0.3)] sm:p-5"
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
          {depthLabel[depth]}
        </span>
        {action.type === 'graph' && <span className="text-xs font-medium text-muted">示意图</span>}
      </div>
      <h2 className="mt-3 text-base font-bold leading-snug text-ink">{title}</h2>
      {action.type === 'board' ? (
        <p className="mt-3 space-y-1 text-sm leading-7 text-slate-700">
          {textLines(action.content).map(({ id, text }) => (
            <span key={id} className="block [overflow-wrap:anywhere]">
              {renderLine(text, marks)}
            </span>
          ))}
        </p>
      ) : (
        <>
          <figure
            data-graph="true"
            className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-2"
          >
            <figcaption className="sr-only">{title}：示意图</figcaption>
            <img
              src={svgImageSource(action.svg_markup)}
              alt={title}
              className="block h-auto w-full"
            />
          </figure>
          {action.formula && (
            <p className="mt-3 rounded-xl border border-primary/10 bg-primary-soft/25 px-3 py-3 text-center font-mono text-sm font-semibold text-primary [overflow-wrap:anywhere]">
              {action.formula}
            </p>
          )}
        </>
      )}
    </article>
  );
}

function renderLine(line: string, marks: BoardMark[]) {
  const targets = marks.filter(({ target }) => line.includes(target));
  if (targets.length === 0) return line || '\u00a0';
  const pattern = new RegExp(
    `(${targets.map(({ target }) => target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  let occurrence = 0;
  return line.split(pattern).map((part) => {
    const mark = targets.find(({ target }) => target === part);
    if (!mark) return part;
    return (
      <MarkedText key={`${mark.style}-${mark.target}-${occurrence++}`} mark={mark}>
        {part}
      </MarkedText>
    );
  });
}

function columnSlots(count: number) {
  return Array.from({ length: count }, (_, position) => ({
    id: `column-${position + 1}`,
    number: position + 1,
  }));
}

function textLines(content: string) {
  return content.split('\n').map((text, position) => ({ id: `line-${position}`, text }));
}

function svgImageSource(markup: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function MarkedText({ mark, children }: { mark: BoardMark; children: string }) {
  return (
    <span
      data-highlight={mark.style}
      className={`relative mx-0.5 inline-block px-1 ${mark.style === 'highlight' ? 'rounded-sm bg-[#FDE0A6]' : ''}`}
    >
      {children}
      {mark.style === 'circle' && (
        <svg
          aria-hidden="true"
          viewBox="0 0 100 44"
          preserveAspectRatio="none"
          className="pointer-events-none absolute -inset-x-1 -inset-y-1 size-[calc(100%+0.5rem)] overflow-visible"
        >
          <ellipse
            cx="50"
            cy="22"
            rx="47"
            ry="18"
            fill="none"
            stroke="#D97736"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="2 0.25"
            transform="rotate(-3 50 22)"
          />
        </svg>
      )}
    </span>
  );
}
