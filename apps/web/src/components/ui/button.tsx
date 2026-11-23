import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white shadow-2xs hover:bg-primary-hover',
        secondary: 'bg-primary-soft text-primary hover:bg-[#c8e3e1]',
        outline: 'border border-border bg-white text-ink shadow-2xs hover:bg-[#f8fafc]',
        ghost: 'text-[#475569] hover:bg-[#f1f5f9] hover:text-ink',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-3.5 text-sm',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends useRender.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] = render
    ? undefined
    : 'button';
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(buttonVariants({ variant, size }), className),
        type: typeValue,
      },
      props,
    ),
    render,
  });
}
