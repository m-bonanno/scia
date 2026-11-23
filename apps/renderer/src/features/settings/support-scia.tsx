import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QUIET_BUTTON } from '@/components/button-styles.ts';
import { useOnePress } from '@/components/one-press.ts';
import { bridge } from '@/lib/bridge.ts';
import { cn } from '@/lib/cn.ts';
import { SUPPORT_PAGE_NOT_OPENED } from '@/lib/messages.ts';

interface SupportSciaProps {
  // Whether Settings is open: what one visit said is not said at the next.
  readonly open: boolean;
}

// A quiet way to support Scia (#271): main opens the page in the person's browser, and Scia itself
// sends nothing. Drawn in a row that wraps, its failure on a line of its own.
export function SupportScia({ open }: SupportSciaProps): ReactNode {
  const press = useOnePress();
  const [failed, setFailed] = useState(false);
  // Every ask carries its turn, moved on at each press and each opening or closing: main answers
  // in the system's own time, and an answer is said only while its ask is still the last one.
  const turn = useRef(0);
  const [openWas, setOpenWas] = useState(open);
  if (openWas !== open) {
    setOpenWas(open);
    setFailed(false);
  }
  useEffect(() => {
    turn.current += 1;
  }, [open]);

  const shell = bridge();
  // A page in a plain browser has no main to open the page.
  if (shell === undefined) return null;

  return (
    <>
      <button
        type="button"
        className={cn(QUIET_BUTTON, '-mr-3')}
        onKeyDown={press.onKeyDown}
        onClick={(event) => {
          if (press.sawTheOneBefore(event)) return;
          setFailed(false);
          turn.current += 1;
          const mine = turn.current;
          shell.openSupportPage().catch(() => {
            if (mine === turn.current) setFailed(true);
          });
        }}
      >
        Support Scia
      </button>
      {failed && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {SUPPORT_PAGE_NOT_OPENED}
        </p>
      )}
    </>
  );
}
