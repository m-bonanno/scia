import { type ReactNode, type Ref, useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { FOCUS_RING, ICON_BUTTON } from './button-styles.ts';

const CONFIRM_FOR_MS = 3000;

interface ConfirmButtonProps {
  // What the button does, as for any icon button.
  readonly label: string;
  // The word the button turns into while it waits for the second press. Undefined: there is
  // nothing to ask, and the first press does it.
  readonly confirmLabel: string | undefined;
  // The second press throws something away: it says so in the colour of what cannot be undone.
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLButtonElement>;
}

// A button for what must not happen by a slip. The first press turns it, in place, into the
// word of what it is about to do; the second does it. It goes back by itself after a moment,
// or when the focus leaves it. It is one element all along, so the focus stays on it.
//
// A press is one press however it is repeated: the second click of a double click and the
// repeats of a key held down do nothing, or one gesture would ask and answer itself.
export function ConfirmButton({
  label,
  confirmLabel,
  destructive = false,
  onConfirm,
  children,
  ref,
}: ConfirmButtonProps): ReactNode {
  const [armed, setArmed] = useState(false);
  const asking = armed && confirmLabel !== undefined;

  useEffect(() => {
    if (!asking) return undefined;
    const timer = setTimeout(() => {
      setArmed(false);
    }, CONFIRM_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [asking]);

  return (
    <button
      type="button"
      ref={ref}
      aria-label={asking ? undefined : label}
      title={asking ? undefined : label}
      className={
        asking
          ? cn(
              'h-8 shrink-0 rounded-lg px-2.5 text-sm font-semibold',
              destructive
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-tonal text-foreground',
              FOCUS_RING,
            )
          : ICON_BUTTON
      }
      onKeyDown={(event) => {
        if (event.repeat) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.detail > 1) return;
        if (confirmLabel !== undefined && !armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => {
        setArmed(false);
      }}
    >
      {asking ? confirmLabel : children}
    </button>
  );
}
