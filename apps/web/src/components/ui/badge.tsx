import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white',
        secondary: 'bg-primary-soft text-primary',
        muted: 'bg-[#f1f5f9] text-[#475569]',
        outline: 'border border-border bg-white text-[#334155]',
        warning: 'bg-warning-pill text-white',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
