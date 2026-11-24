import { type ReactNode, useCallback, useLayoutEffect, useRef } from 'react';
import { ConfirmButton } from '@/components/confirm-button.tsx';
import { formatCount } from '@/lib/format.ts';

interface ClearCompletedProps {
  // How many downloads are completed: one at least, or the button is not drawn.
  readonly count: number;
  readonly onClear: () => void;
  // It is leaving the page with the focus on it: the focus goes to what is beside it.
  readonly onLeaveFocused: () => void;
}

// Every completed download off the list, the files kept (#215). It asks once more, whatever the
// count: rows a press takes away together are not brought back, and a single row's × is there for
// one.
export function ClearCompleted({ count, onClear, onLeaveFocused }: ClearCompletedProps): ReactNode {
  // The last one given, read as it leaves: a ref callback made again for a new one would be a
  // leave and a return, and would move the focus from a button still in the page.
  const leave = useRef(onLeaveFocused);
  useLayoutEffect(() => {
    leave.current = onLeaveFocused;
  });
  // Read as the button leaves, before it is taken out of the page: a focus that went elsewhere
  // meanwhile is not moved.
  const holder = useCallback((node: HTMLSpanElement | null) => {
    if (node === null) return undefined;
    return () => {
      if (node.contains(document.activeElement)) leave.current();
    };
  }, []);
  return (
    <span ref={holder} className="contents">
      <ConfirmButton
        shape="word"
        confirmLabel={`Clear ${formatCount(count)} completed`}
        onConfirm={onClear}
      >
        Clear completed
      </ConfirmButton>
    </span>
  );
}
