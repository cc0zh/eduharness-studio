import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetPopupProps extends DialogPrimitive.Popup.Props {
  side?: 'left' | 'right';
  showBackdrop?: boolean;
}

export function SheetPopup({
  className,
  side = 'right',
  showBackdrop = true,
  children,
  ...props
}: SheetPopupProps) {
  return (
    <DialogPrimitive.Portal>
      {showBackdrop && (
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-[#0f172a]/20 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      )}
      <DialogPrimitive.Popup
        className={cn(
          'fixed inset-y-0 z-50 flex w-80 max-w-[90vw] flex-col bg-white shadow-xl transition-transform outline-none',
          side === 'left'
            ? 'left-0 border-r border-border data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full'
            : 'right-0 border-l border-border data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="收起抽屉"
          className="absolute top-3.5 right-3.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-[#f1f5f9] hover:text-ink"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border px-4 py-3.5 pr-11', className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title className={cn('text-sm font-semibold text-ink', className)} {...props} />
  );
}

export function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn('text-xs text-muted', className)} {...props} />;
}
