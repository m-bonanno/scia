import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { IconButton } from './icon-button.tsx';

const CONFIRM_FOR_MS = 3000;

interface ConfirmButtonProps {
  // What the button does, as for any icon button.
  readonly label: string;
  // The word the button turns into while it waits for the second press.
  readonly confirmLabel: string;
  // The second press throws something away: it says so in the colour of what cannot be undone.
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}

// A button for what must not happen by a slip: the first press turns it, in place, into the
// word of what it is about to do; the second does it. It goes back by itself after a moment,
// or when the focus leaves it.
export function ConfirmButton({
  label,
  confirmLabel,
  destructive = false,
  onConfirm,
  children,
}: ConfirmButtonProps): ReactNode {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => {
      setArmed(false);
    }, CONFIRM_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        autoFocus
        onClick={(event) => {
          // The second press of a double click lands here, where the first one's button was:
          // it is the same slip, not a confirmation.
          if (event.detail > 1) return;
          setArmed(false);
          onConfirm();
        }}
        onBlur={() => {
          setArmed(false);
        }}
        className={cn(
          'h-8 rounded-lg px-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          destructive ? 'bg-destructive text-destructive-foreground' : 'bg-tonal text-foreground',
        )}
      >
        {confirmLabel}
      </button>
    );
  }
  return (
    <IconButton
      label={label}
      onClick={() => {
        setArmed(true);
      }}
    >
      {children}
    </IconButton>
  );
}
