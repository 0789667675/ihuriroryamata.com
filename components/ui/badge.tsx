import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Badge({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
