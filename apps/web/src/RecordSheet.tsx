import type { LessonRecord } from '@eduharness-studio/engine';
import { NotebookText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { recordKey } from './lesson-playback';

export function RecordSheet({ records }: { records: readonly LessonRecord[] }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        <NotebookText aria-hidden="true" />
        课堂记录
      </SheetTrigger>
      <SheetPopup side="left" className="w-96">
        <SheetHeader>
          <SheetTitle>课堂记录</SheetTitle>
          <SheetDescription>回看已播字幕、你的回答和插话留下的切换点。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {records.length === 0 ? (
            <p className="text-sm leading-6 text-muted">
              还没有课堂记录。播过的字幕和你的输入会出现在这里。
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {records.map((record) => (
                <li
                  key={recordKey(record)}
                  data-record-kind={record.kind}
                  className="space-y-1 py-3 first:pt-0"
                >
                  <p className="text-xs font-semibold text-primary">
                    {record.kind === 'subtitle'
                      ? '老师 · 字幕'
                      : record.kind === 'answer'
                        ? '你 · 回答'
                        : '你 · 插话'}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                    {record.text}
                  </p>
                  {record.kind === 'interrupt' && (
                    <p className="text-xs leading-5 text-amber-800">
                      截断点：
                      {record.last_played_step_id
                        ? `第 ${record.last_played_step_id} 拍之后`
                        : '尚无已播拍'}
                      {' · '}跳过 {record.truncated_step_ids.length} 个未播拍
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
