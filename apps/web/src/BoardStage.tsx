import { type DepthTag, sanitizeSvg } from '@eduharness-studio/engine';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { BoardContent } from './BoardContent';
import { BoardFormula } from './BoardFormula';
import { EvidenceLink } from './EvidenceLink';
import type { EvidenceView } from './lesson-evidence';
import type { BoardCard, BoardPage } from './lesson-playback';

const depthLabel: Record<DepthTag, string> = {
  intuition: '直觉',
  definition: '定义',
  derivation: '推导',
  theory: '理论',
  application: '应用',
};

export function BoardStage({
  pages,
  pageIndex,
  onPageChange,
  evidence,
}: {
  pages: readonly BoardPage[];
  pageIndex: number;
  onPageChange: (index: number) => void;
  evidence?: EvidenceView;
}) {
  const page = pages[pageIndex];
  const stage = useRef<HTMLElement>(null);
  const target = evidence?.target;
  useEffect(() => {
    if (!target) return;
    const card = stage.current?.querySelector('[data-evidence-primary="true"]');
    (card ?? stage.current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [target]);
  const latest = pages.length - 1;
  const pageButton =
    'grid size-7 place-items-center rounded-xs border border-border bg-surface text-ink-secondary transition-colors hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <section aria-label="白板画布" ref={stage}>
      {pageIndex !== latest && (
        <div
          role="status"
          className="mb-3.5 flex flex-wrap items-center justify-center gap-3 border-y border-border bg-surface-recessed/90 px-4 py-1.5 text-xs text-ink-secondary"
        >
          <span>
            正在回看历史第 {pageIndex + 1} 页，最新板书在第 {pages.length} 页
          </span>
          <button
            type="button"
            onClick={() => onPageChange(latest)}
            className="cursor-pointer border-b border-accent/50 font-medium text-accent hover:border-accent focus-visible:outline-2 focus-visible:outline-ink"
          >
            回到最新页 →
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border-faint pb-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-mono text-[11px] text-accent">
            P.{String(pageIndex + 1).padStart(2, '0')}
          </span>
          <span
            data-page-title
            className="font-serif text-sm font-medium text-ink-secondary [overflow-wrap:anywhere]"
          >
            {page.title}
          </span>
        </div>
        <nav aria-label="白板分页" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={pageButton}
            aria-label="上一页"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </button>
          <span
            aria-live="polite"
            className="px-1.5 font-mono text-[11.5px] tabular-nums text-muted"
          >
            第 {pageIndex + 1}/{pages.length} 页
          </span>
          <button
            type="button"
            className={pageButton}
            aria-label="下一页"
            disabled={pageIndex === latest}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        </nav>
      </div>

      <BoardColumns key={pageIndex} page={page} evidence={evidence} />
    </section>
  );
}

function BoardColumns({ page, evidence }: { page: BoardPage; evidence?: EvidenceView }) {
  const grid = useRef<HTMLElement>(null);
  const gridId = useId();
  const [overflow, setOverflow] = useState(false);
  const columnCount = page.columns;
  const visualCols = Math.max(2, columnCount);
  const slots = columnSlots(columnCount);
  const gridStyle = {
    '--board-cols': String(columnCount),
    '--board-visual-cols': String(visualCols),
  } as CSSProperties;

  useEffect(() => {
    const scroller = grid.current;
    if (!scroller || columnCount < 2) return;
    const measure = () => setOverflow(scroller.scrollWidth > scroller.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    measure();
    return () => observer.disconnect();
  }, [columnCount]);

  function showColumn(number: number) {
    const scroller = grid.current;
    const column = scroller?.children.item(number - 1);
    if (!scroller || !column) return;
    scroller.scrollLeft +=
      column.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  }

  return (
    <>
      {columnCount > 1 && overflow && (
        <nav
          aria-label="板书分栏定位"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-faint bg-surface/80 px-2.5 py-1.5"
        >
          <span className="text-xs text-ink-secondary">横滑白板，或点选栏号</span>
          <div className="flex flex-wrap gap-1.5">
            {slots.map(({ id, number }) => (
              <button
                key={id}
                type="button"
                aria-controls={gridId}
                aria-label={`查看第 ${number} 栏`}
                onClick={() => showColumn(number)}
                className="min-h-8 cursor-pointer rounded-md border border-border bg-canvas px-2 text-xs font-medium text-ink-secondary hover:border-ink/35 hover:text-accent focus-visible:outline-2 focus-visible:outline-ink"
              >
                第 {number} 栏
              </button>
            ))}
          </div>
        </nav>
      )}
      <section
        ref={grid}
        id={gridId}
        aria-label="板书分栏"
        data-board-page={page.id}
        data-board-columns={columnCount}
        className="board-columns-grid grid min-w-0 items-start gap-x-0 gap-y-5 overflow-x-auto overscroll-x-contain pb-2"
        style={gridStyle}
      >
        {slots.map(({ id, number }) => (
          <section
            key={id}
            aria-label={`板书第 ${number} 栏`}
            className={`min-w-0 space-y-5 ${
              number > 1 ? 'border-border md:border-l md:pl-7' : ''
            } ${number < visualCols ? 'md:pr-7' : ''}`}
          >
            <div className="flex items-baseline gap-2 border-b border-border-faint pb-1.5 text-[11.5px] tracking-wide text-muted">
              <span className="font-serif italic text-accent">
                {String(number).padStart(2, '0')}.
              </span>
              <span>栏 {String(number).padStart(2, '0')}</span>
            </div>
            {page.cards
              .filter(({ action }) => action.column === number)
              .map((card) => (
                <BoardCardView key={card.action.card_id} card={card} evidence={evidence} />
              ))}
          </section>
        ))}
      </section>
    </>
  );
}

function BoardCardView({ card, evidence }: { card: BoardCard; evidence?: EvidenceView }) {
  const { action, marks } = card;
  const title = action.title ?? '板书';
  const depth = action.depth ?? 'intuition';
  const svg = action.type === 'graph' ? sanitizeSvg(action.svg_markup) : undefined;
  const anchors = new Map<number, number>();
  if (evidence) {
    for (const { step_id } of [action, ...marks]) {
      const number = evidence.numbersByStep.get(step_id);
      if (number !== undefined && !anchors.has(number)) anchors.set(number, step_id);
    }
  }
  return (
    <article
      data-board-card={action.card_id}
      data-card-kind={action.type}
      data-evidence-selected={evidence?.target?.cardIds.includes(action.card_id) || undefined}
      data-evidence-primary={evidence?.target?.firstCard === action.card_id || undefined}
      className="animate-paper-reveal scroll-m-2 py-0.5 transition-colors data-[evidence-selected=true]:rounded-xs data-[evidence-selected=true]:border-l-2 data-[evidence-selected=true]:border-l-accent data-[evidence-selected=true]:bg-accent-soft/75 data-[evidence-selected=true]:px-3 data-[evidence-selected=true]:py-2"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[11px] tracking-wide text-muted">
          {depthLabel[depth]}
          {action.type === 'graph' ? ' · 图版' : ''}
        </span>
        {evidence && anchors.size > 0 && (
          <div className="ml-auto flex flex-wrap gap-1">
            {[...anchors].map(([number, step]) => (
              <EvidenceLink
                key={number}
                number={number}
                onClick={() => evidence.select(number, step)}
              />
            ))}
          </div>
        )}
      </div>
      <h2 className="mt-1 font-serif text-[17px] font-semibold leading-snug text-ink">{title}</h2>
      {action.type === 'board' ? (
        <BoardContent content={action.content} marks={marks} />
      ) : svg ? (
        <figure data-graph="true" className="mt-2.5 border-t border-border-faint pt-2">
          <figcaption className="sr-only">{title}：示意图</figcaption>
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt={title}
            className="mx-auto block max-h-[240px] w-auto max-w-full"
          />
        </figure>
      ) : (
        <p className="mt-2.5 text-sm text-muted">这张示意图暂不可显示。</p>
      )}
      {action.formula && <BoardFormula formula={action.formula} />}
    </article>
  );
}

function columnSlots(count: number) {
  return Array.from({ length: count }, (_, position) => ({
    id: `column-${position + 1}`,
    number: position + 1,
  }));
}
