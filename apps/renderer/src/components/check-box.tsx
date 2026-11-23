import { Check, Minus } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn.ts';

interface CheckBoxProps {
  readonly checked: boolean;
  // Some of what it stands for is ticked, and some is not: neither ticked nor unticked.
  readonly mixed?: boolean;
  // What it stands for cannot change now: it says so, and its presses do nothing.
  readonly held?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children: ReactNode;
  readonly className?: string;
}

// A box to tick, the system's own control under a box drawn in the page's tokens: its edge in
// `muted-foreground` and, ticked, the accent with its mark — each held by the contrast spec on the
// grounds a row has. The label is everything beside it, so the whole line is pressed. It holds the
// hidden control, so that a box reached by Tab is scrolled into sight with its line.
export function CheckBox({
  checked,
  mixed = false,
  held = false,
  onChange,
  children,
  className,
}: CheckBoxProps): ReactNode {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = mixed;
  }, [mixed]);
  const on = checked || mixed;
  return (
    <label className={cn('relative flex min-w-0 cursor-pointer items-center gap-3', className)}>
      <input
        ref={box}
        type="checkbox"
        checked={checked}
        aria-disabled={held ? true : undefined}
        onChange={(event) => {
          if (!held) onChange(event.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors motion-reduce:transition-none',
          on ? 'border-accent bg-accent text-accent-foreground' : 'border-muted-foreground',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
        )}
      >
        {mixed ? (
          <Minus size={12} strokeWidth={3} />
        ) : checked ? (
          <Check size={12} strokeWidth={3} />
        ) : null}
      </span>
      {children}
    </label>
  );
}
