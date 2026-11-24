import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { FOCUS_RING, ICON_BUTTON, TEXT_BUTTON } from './button-styles.ts';
import { useOnePress } from './one-press.ts';

const CONFIRM_FOR_MS = 3000;

export interface ConfirmButtonHandle {
  // One press from elsewhere — a double click on the row the button is in. It takes the focus,
  // and asks, or does what needs no asking. It never answers a question already asked.
  press(): void;
  // The focus alone, for a button that arrives where another control just left.
  focus(): void;
}

interface Shared {
  // The word the button turns into while it waits for the second press. Undefined: there is
  // nothing to ask, and the first press does it.
  readonly confirmLabel: string | undefined;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
  readonly ref?: Ref<ConfirmButtonHandle>;
}

// An icon, named by its label; or a word beside other text buttons, named by that word, its
// children, and as wide as its question, so that it asks in place.
type ConfirmButtonProps = Shared &
  (
    | {
        readonly shape?: 'icon';
        readonly label: string;
        // The second press throws something away: it says so in the colour of what cannot be
        // undone.
        readonly destructive?: boolean;
      }
    | { readonly shape: 'word' }
  );

// A button for what must not happen by a slip. The first press turns it, in place, into the
// word of what it is about to do; the second does it. It goes back by itself after a moment,
// or when the focus leaves it. It is one element all along, so the focus stays on it.
//
// A press is one press however it is repeated, or one gesture would ask and answer itself:
// - the later clicks of a burst do nothing while the button asks, whoever saw the burst begin:
//   the button grows when it asks, and may grow under a pointer that was double-clicking
//   beside it. When it does not ask, they do nothing if this button saw the click before
//   them, a moment ago: a click that says it is the second, on a button that saw no first,
//   is the next press of someone clearing a list whose rows slide under the pointer;
// - the repeats of Enter held down do nothing. Of Enter alone: a held Tab must walk on.
export function ConfirmButton(props: ConfirmButtonProps): ReactNode {
  const { confirmLabel, onConfirm, children, ref } = props;
  const label = props.shape === 'word' ? undefined : props.label;
  const destructive = props.shape !== 'word' && props.destructive === true;
  const [armed, setArmed] = useState(false);
  // Nothing left to ask — the download finished under an armed "Delete": the question goes.
  if (armed && confirmLabel === undefined) setArmed(false);
  const asking = armed && confirmLabel !== undefined;
  const element = useRef<HTMLButtonElement>(null);
  const press = useOnePress();

  useImperativeHandle(
    ref,
    () => ({
      press: () => {
        element.current?.focus();
        if (!asking) element.current?.click();
      },
      focus: () => {
        element.current?.focus();
      },
    }),
    [asking],
  );

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
      ref={element}
      aria-label={asking ? undefined : label}
      title={asking ? undefined : label}
      className={
        label === undefined
          ? TEXT_BUTTON
          : asking
            ? cn(
                'h-8 shrink-0 rounded-lg px-2.5 text-sm font-semibold',
                destructive
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-tonal text-foreground',
                FOCUS_RING,
              )
            : ICON_BUTTON
      }
      onKeyDown={press.onKeyDown}
      onClick={(event) => {
        const repeated = press.sawTheOneBefore(event);
        if (event.detail > 1 && (asking || repeated)) return;
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
      {label === undefined ? (
        // Both words in one cell, the one not said hidden: the box is the wider of the two from
        // the start, and the question takes no room the word did not have. Its figures are of one
        // width, so that a count that changes does not move the box.
        <span className="grid justify-items-center tabular-nums">
          <span
            aria-hidden={asking || undefined}
            className={cn('col-start-1 row-start-1', asking && 'invisible')}
          >
            {children}
          </span>
          {confirmLabel !== undefined && (
            <span
              aria-hidden={!asking || undefined}
              className={cn('col-start-1 row-start-1 font-semibold', !asking && 'invisible')}
            >
              {confirmLabel}
            </span>
          )}
        </span>
      ) : asking ? (
        confirmLabel
      ) : (
        children
      )}
    </button>
  );
}
