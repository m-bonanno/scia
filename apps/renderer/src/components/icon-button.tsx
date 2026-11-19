import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { ICON_BUTTON } from './button-styles.ts';

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
      className={cn(ICON_BUTTON, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
