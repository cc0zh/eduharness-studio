import type { ReactNode } from 'react';
import type { BoardMark } from './lesson-playback';

type TableCell = { id: string; text: string };
type TableRow = { id: string; cells: TableCell[] };

type ContentBlock =
  | { kind: 'paragraph'; id: string; text: string }
  | { kind: 'list'; id: string; items: { id: string; marker: string; text: string }[] }
  | { kind: 'table'; id: string; headers: TableCell[]; rows: TableRow[] };

function parseCells(line: string, prefix: string): TableCell[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell, pos) => ({ id: `${prefix}-${pos}`, text: cell.trim() }));
}

function isTableSeparator(line: string) {
  return /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(line.trim());
}

function parseBoardBlocks(content: string): ContentBlock[] {
  const lines = content.split('\n');
  const blocks: ContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const start = index;
      const headers = parseCells(trimmed, `t-${start}-h`);
      const rows: TableRow[] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push({
          id: `t-${start}-r-${index}`,
          cells: parseCells(lines[index], `t-${start}-r-${index}`),
        });
        index += 1;
      }
      blocks.push({ kind: 'table', id: `table-${start}`, headers, rows });
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[-•·]|\d+[.、])\s+(.+)$/);
    if (bulletMatch) {
      const items: { id: string; marker: string; text: string }[] = [];
      const start = index;
      while (index < lines.length) {
        const match = lines[index].trim().match(/^([-•·]|\d+[.、])\s+(.+)$/);
        if (!match) break;
        items.push({
          id: `item-${index}`,
          marker: /^[-\u2022\u00b7]$/.test(match[1]) ? '—' : match[1],
          text: match[2],
        });
        index += 1;
      }
      blocks.push({ kind: 'list', id: `list-${start}`, items });
      continue;
    }

    blocks.push({ kind: 'paragraph', id: `para-${index}`, text: raw });
    index += 1;
  }

  return blocks;
}

function renderBoldAndMarks(text: string, marks: readonly BoardMark[]): ReactNode {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  let seq = 0;
  return segments.map((segment) => {
    const key = `seg-${seq++}`;
    if (segment.startsWith('**') && segment.endsWith('**') && segment.length > 4) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderMarks(segment.slice(2, -2), marks)}
        </strong>
      );
    }
    return <span key={key}>{renderMarks(segment, marks)}</span>;
  });
}

function renderMarks(line: string, marks: readonly BoardMark[]): ReactNode {
  const targets = marks.filter(({ target }) => target && line.includes(target));
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

export function BoardContent({ content, marks }: { content: string; marks: readonly BoardMark[] }) {
  const blocks = parseBoardBlocks(content);
  return (
    <div className="mt-2.5 space-y-2.5 text-[14.5px] leading-[1.82] text-ink-secondary">
      {blocks.map((block) => {
        if (block.kind === 'table') {
          return (
            <div key={block.id} className="overflow-x-auto py-1">
              <table className="w-full border-collapse border-y-[1.5px] border-ink text-left text-[13px] leading-6">
                <thead>
                  <tr className="border-b border-ink text-xs font-semibold text-ink-secondary">
                    {block.headers.map((header) => (
                      <th key={header.id} className="px-2 py-1.5">
                        {renderBoldAndMarks(header.text, marks)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-faint text-ink">
                  {block.rows.map((row) => (
                    <tr key={row.id}>
                      {row.cells.map((cell) => (
                        <td key={cell.id} className="px-2 py-1.5">
                          {renderBoldAndMarks(cell.text, marks)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={block.id} className="space-y-1.5 text-ink">
              {block.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 [overflow-wrap:anywhere]">
                  <span aria-hidden="true" className="shrink-0 font-serif text-xs text-accent">
                    {item.marker}
                  </span>
                  <span className="min-w-0 flex-1">{renderBoldAndMarks(item.text, marks)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={block.id} className="[overflow-wrap:anywhere]">
            {renderBoldAndMarks(block.text, marks)}
          </p>
        );
      })}
    </div>
  );
}

function MarkedText({ mark, children }: { mark: BoardMark; children: string }) {
  return (
    <span
      data-highlight={mark.style}
      className={
        mark.style === 'highlight'
          ? 'editorial-highlight relative mx-0.5 inline text-ink'
          : 'relative mx-0.5 inline-block px-1 font-semibold text-ink'
      }
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
            stroke="#A84428"
            strokeWidth="2.2"
            strokeLinecap="round"
            transform="rotate(-2.5 50 22)"
            className="editorial-circle-path"
          />
        </svg>
      )}
    </span>
  );
}
