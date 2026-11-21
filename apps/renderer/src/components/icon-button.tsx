import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { ICON_BUTTON, ICON_BUTTON_ON_TONAL } from './button-styles.ts';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // What the button does, for whoever cannot see its icon and as its tooltip.
  readonly label: string;
  // It sits on a `tonal` ground, not on the background or a surface.
  readonly onTonal?: boolean;
  readonly children: ReactNode;
}

export function IconButton({
  label,
  onTonal = false,
  children,
  className,
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(onTonal ? ICON_BUTTON_ON_TONAL : ICON_BUTTON, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
