import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@/lib/utils';

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2.5', className)} {...props} />;
}

export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-8 w-full items-center gap-1 rounded-lg bg-[#d6dde1] p-0.5 text-xs',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex flex-1 cursor-pointer items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-[#475569] transition-colors outline-none hover:text-ink data-[active]:bg-white data-[active]:text-primary data-[active]:shadow-2xs',
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn('outline-none', className)} {...props} />;
}
