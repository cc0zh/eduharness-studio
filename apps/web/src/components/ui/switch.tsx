import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-[#cbd5e1] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 data-[checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-white shadow-xs transition-transform data-[checked]:translate-x-4 data-[unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
