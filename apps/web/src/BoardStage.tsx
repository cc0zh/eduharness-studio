import { type DepthTag, sanitizeSvg } from '@eduharness-studio/engine';
import { ChevronLeft, ChevronRight, Network } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { BoardFormula } from './BoardFormula';
import { EvidenceLink } from './EvidenceLink';
import type { EvidenceView } from './lesson-evidence';
import type { BoardCard, BoardMark, BoardPage } from './lesson-playback';

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
    'grid size-9 place-items-center rounded-lg border border-border bg-white text-primary hover:bg-primary-soft/50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <section
      aria-label="白板画布"
      ref={stage}
      className="dot-grid-canvas min-h-[48vh] rounded-[1.75rem] border border-slate-200/80 p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-600">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
              <Network aria-hidden="true" className="size-4" />
            </span>
            <span data-page-title className="[overflow-wrap:anywhere]">
              {page.title}
            </span>
          </div>
          <nav aria-label="白板分页" className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={pageButton}
              aria-label="上一页"
              disabled={pageIndex === 0}
              onClick={() => onPageChange(pageIndex - 1)}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <span aria-live="polite" className="text-xs font-semibold tabular-nums text-slate-600">
              第 {pageIndex + 1}/{pages.length} 页
            </span>
            <button
              type="button"
              className={pageButton}
              aria-label="下一页"
              disabled={pageIndex === latest}
              onClick={() => onPageChange(pageIndex + 1)}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
            {pageIndex !== latest && (
              <button
                type="button"
                onClick={() => onPageChange(latest)}
                className="min-h-9 rounded-lg px-2 text-xs font-semibold text-primary underline underline-offset-2 hover:bg-primary-soft/50 focus-visible:outline-2 focus-visible:outline-primary"
              >
                回到最新页
              </button>
            )}
          </nav>
        </div>
        <section
          key={pageIndex}
          aria-label="板书分栏"
          data-board-page={page.id}
          data-board-columns={page.columns}
          className="grid min-w-0 items-start gap-4 overflow-x-auto overscroll-x-contain pb-3"
          style={{
            gridTemplateColumns: `repeat(${page.columns}, minmax(min(100%, 19rem), 1fr))`,
          }}
        >
          {columnSlots(page.columns).map(({ id, number }) => (
            <section key={id} aria-label={`板书第 ${number} 栏`} className="min-w-0 space-y-4">
              <div className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-slate-400">
                <span className="size-1.5 rounded-full bg-primary/50" /> 栏{' '}
                {String(number).padStart(2, '0')}
              </div>
              {page.cards
                .filter(({ action }) => action.column === number)
                .map((card) => (
                  <BoardCardView key={card.action.card_id} card={card} evidence={evidence} />
                ))}
            </section>
          ))}
        </section>
      </div>
    </section>
  );
}

function BoardCardView({ card, evidence }: { card: BoardCard; evidence?: EvidenceView }) {
  const { action, marks } = card;
  const title = action.title ?? '板书';
  const depth = action.depth ?? 'intuition';
  const svg = action.type === 'graph' ? sanitizeSvg(action.svg_markup) : undefined;
  const anchors = new Map<number, number>();
  if (evidence)
    for (const { step_id } of [action, ...marks]) {
      const number = evidence.numbersByStep.get(step_id);
      if (number !== undefined && !anchors.has(number)) anchors.set(number, step_id);
    }
  return (
    <article
      data-board-card={action.card_id}
      data-card-kind={action.type}
      data-evidence-selected={evidence?.target?.cardIds.includes(action.card_id) || undefined}
      data-evidence-primary={evidence?.target?.firstCard === action.card_id || undefined}
      className="scroll-m-1 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-[0_8px_28px_-18px_rgba(15,82,80,0.3)] data-[evidence-selected=true]:border-amber-500 data-[evidence-selected=true]:bg-amber-50 data-[evidence-selected=true]:ring-2 data-[evidence-selected=true]:ring-inset data-[evidence-selected=true]:ring-highlight sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
          {depthLabel[depth]}
        </span>
        {action.type === 'graph' && <span className="text-xs font-medium text-muted">示意图</span>}
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
      <h2 className="mt-3 text-base font-bold leading-snug text-ink">{title}</h2>
      {action.type === 'board' ? (
        <p className="mt-3 space-y-1 text-sm leading-7 text-slate-700">
          {textLines(action.content).map(({ id, text }) => (
            <span key={id} className="block [overflow-wrap:anywhere]">
              {renderLine(text, marks)}
            </span>
          ))}
        </p>
      ) : svg ? (
        <figure
          data-graph="true"
          className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-2"
        >
          <figcaption className="sr-only">{title}：示意图</figcaption>
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            alt={title}
            className="block h-auto w-full"
          />
        </figure>
      ) : (
        <p className="mt-3 text-sm text-muted">这张示意图暂不可显示。</p>
      )}
      {action.formula && <BoardFormula formula={action.formula} />}
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
