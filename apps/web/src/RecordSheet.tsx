import type { LessonRecord } from '@eduharness-studio/engine';
import { NotebookText } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { EvidenceLink } from './EvidenceLink';
import type { EvidenceView } from './lesson-evidence';
import { recordKey } from './lesson-playback';

type RecordProps = {
  records: readonly LessonRecord[];
  numbers?: readonly (number | null)[];
  evidence?: EvidenceView;
};

export function RecordSheet(props: RecordProps) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="sm" />}>
        <NotebookText className="size-3.5" aria-hidden="true" />
        课堂记录
      </SheetTrigger>
      <SheetPopup side="left" className="w-[24rem] bg-surface">
        <SheetHeader className="bg-surface px-6 py-4">
          <SheetTitle>课堂记录</SheetTitle>
          <SheetDescription>按讲述脉络沉淀的随堂手记，可随时回溯作答与插话。</SheetDescription>
        </SheetHeader>
        <RecordList {...props} />
      </SheetPopup>
    </Sheet>
  );
}

function RecordList({ records, numbers, evidence }: RecordProps) {
  const list = useRef<HTMLDivElement>(null);
  const target = evidence?.target;
  useEffect(() => {
    if (!target || !list.current) return;
    const row =
      list.current.querySelector('[data-evidence-caption="true"]') ??
      list.current.querySelector('[data-evidence-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [target]);
  return (
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {records.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          还没有课堂手记。随着导师讲述和你的作答，这里会自然记录下整堂课的脉络。
        </p>
      ) : (
        <ol className="space-y-4">
          {records.map((record, index) => {
            const previous = records[index - 1];
            const number = numbers?.[index];
            const selectedCaption =
              record.kind === 'subtitle' && target?.caption?.step_id === record.step_id;
            const selected = target?.recordIndices.includes(index) || selectedCaption;
            const isLearner = record.kind !== 'subtitle';
            const showHeader =
              isLearner ||
              previous?.kind !== 'subtitle' ||
              Boolean(evidence && typeof number === 'number');
            return (
              <li
                key={recordKey(record)}
                data-record-kind={record.kind}
                data-evidence-selected={selected || undefined}
                data-evidence-caption={selectedCaption || undefined}
                className={
                  isLearner
                    ? 'space-y-1.5 rounded-[10px] border-l-2 border-l-accent/65 bg-canvas/85 px-4 py-3 transition-colors data-[evidence-selected=true]:bg-accent-soft/80 data-[evidence-selected=true]:ring-1 data-[evidence-selected=true]:ring-accent/35'
                    : 'space-y-1 rounded-[10px] px-1 py-0.5 transition-colors data-[evidence-selected=true]:border-l-2 data-[evidence-selected=true]:border-l-accent data-[evidence-selected=true]:bg-accent-soft/75 data-[evidence-selected=true]:px-3.5 data-[evidence-selected=true]:py-2.5'
                }
              >
                {showHeader && (
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        isLearner
                          ? 'font-medium text-accent'
                          : 'font-serif text-[11.5px] tracking-wide text-muted'
                      }
                    >
                      {record.kind === 'subtitle'
                        ? '导师讲述'
                        : record.kind === 'answer'
                          ? '你的回答'
                          : '你的插话'}
                    </span>
                    {evidence && typeof number === 'number' && (
                      <EvidenceLink
                        number={number}
                        onClick={() =>
                          evidence.select(
                            number,
                            record.kind === 'subtitle' ? record.step_id : undefined,
                          )
                        }
                      />
                    )}
                  </div>
                )}
                <p
                  className={
                    isLearner
                      ? 'whitespace-pre-wrap text-[13.5px] leading-[1.82] text-ink [overflow-wrap:anywhere]'
                      : 'whitespace-pre-wrap text-[14px] leading-[1.85] text-ink-secondary [overflow-wrap:anywhere]'
                  }
                >
                  {record.text}
                </p>
                {record.kind === 'interrupt' && (
                  <p className="pt-0.5 text-[11.5px] leading-5 text-muted">
                    截断于
                    {record.last_played_step_id
                      ? `第 ${record.last_played_step_id} 拍之后`
                      : '首拍之前'}
                    ，跳过 {record.truncated_step_ids.length} 个未播拍
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
