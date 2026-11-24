import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.ComponentProps<'input'> {}

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-sm border border-border-strong bg-canvas px-3 text-sm text-ink placeholder:text-ink-faint transition-colors outline-none focus-visible:border-ink focus-visible:bg-surface disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
