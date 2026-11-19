import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // What the button does, for whoever cannot see its icon and as its tooltip.
  readonly label: string;
  readonly children: ReactNode;
}

export function IconButton({ label, children, className, ...rest }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-tonal hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
