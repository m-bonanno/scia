import { isUpdateRestart, UpdateRestart } from '@scia/contracts/bridge';
import { CircleArrowUp } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { FOCUS_RING, PRIMARY_BUTTON, QUIET_BUTTON_ON_TONAL } from '@/components/button-styles.ts';
import { cn } from '@/lib/cn.ts';
import { updateNotRestarted, updateQuestion, updateWhileDownloading } from '@/lib/messages.ts';

interface UpdateOfferProps {
  // The version Scia is.
  readonly version: string;
  // The version a quit would install, as main says it; null when there is none.
  readonly offered: string | null;
  // Something runs or waits in the list: Scia does not restart then (the owner, #133).
  readonly downloading: boolean;
  // Asks main to restart and install; resolves to what main did (`UpdateRestart`).
  readonly onRestart: () => Promise<unknown>;
  // Main had nothing to restart for: the offer is gone, and the page asks again.
  readonly onGone: () => void;
}

const Asked = {
  Closed: 'closed',
  Question: 'question',
  Restarting: 'restarting',
  // Main did not restart, or did not answer.
  NotRestarted: 'not-restarted',
} as const;
type Asked = (typeof Asked)[keyof typeof Asked];

// Beside the name: the version Scia is, and, once an update is downloaded, a button to it. A press
// asks before restarting; while something downloads it says the update waits for the quit.
export function UpdateOffer({
  version,
  offered,
  downloading,
  onRestart,
  onGone,
}: UpdateOfferProps): ReactNode {
  const [asked, setAsked] = useState<Asked>(Asked.Closed);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const textId = useId();
  const open = asked !== Asked.Closed;

  const close = (refocus: boolean) => {
    setAsked(Asked.Closed);
    if (refocus) opener.current?.focus();
  };

  // A press anywhere else, or the focus leaving for elsewhere, puts the question away.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: Event) => {
      const target = event.target as Node | null;
      if (opener.current?.contains(target) === true || panel.current?.contains(target) === true) {
        return;
      }
      setAsked(Asked.Closed);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  // What the question says decides what has the focus: its first button, as it opens or changes.
  useEffect(() => {
    if (asked === Asked.Question || asked === Asked.NotRestarted) first.current?.focus();
  }, [asked, downloading]);

  if (offered === null) {
    return (
      <span className="text-xs text-muted-foreground tabular-nums" title={`Scia ${version}`}>
        {version}
      </span>
    );
  }

  const restart = () => {
    if (asked !== Asked.Question) return;
    setAsked(Asked.Restarting);
    onRestart()
      .then((answer) => {
        if (answer === UpdateRestart.Restarting) return;
        if (isUpdateRestart(answer) && answer === UpdateRestart.Nothing) {
          setAsked(Asked.Closed);
          onGone();
          return;
        }
        setAsked(Asked.NotRestarted);
      })
      .catch(() => {
        setAsked(Asked.NotRestarted);
      });
  };

  const waits = asked === Asked.NotRestarted || (asked === Asked.Question && downloading);
  const text =
    asked === Asked.NotRestarted
      ? updateNotRestarted(offered)
      : waits
        ? updateWhileDownloading(offered)
        : updateQuestion(offered);

  return (
    <div className="no-drag relative">
      <button
        ref={opener}
        type="button"
        title={`Scia ${version}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) close(false);
          else setAsked(Asked.Question);
        }}
        className={cn(
          'inline-flex h-6 items-center gap-1.5 rounded-md bg-tonal px-2 text-xs font-medium text-foreground transition-colors hover:bg-border',
          FOCUS_RING,
        )}
      >
        <CircleArrowUp size={14} aria-hidden="true" className="text-accent" />
        {`Update to ${offered}`}
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-labelledby={textId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close(true);
          }}
          className="absolute top-full left-0 z-20 mt-2 flex w-72 animate-row-in flex-col gap-3 rounded-xl bg-tonal p-4 text-sm text-foreground"
        >
          <p id={textId}>{text}</p>
          <div className="flex justify-end gap-2">
            {waits ? (
              <button
                ref={first}
                type="button"
                className={QUIET_BUTTON_ON_TONAL}
                onClick={() => {
                  close(true);
                }}
              >
                Close
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={QUIET_BUTTON_ON_TONAL}
                  aria-disabled={asked === Asked.Restarting}
                  onClick={() => {
                    if (asked !== Asked.Restarting) close(true);
                  }}
                >
                  Later
                </button>
                <button
                  ref={first}
                  type="button"
                  className={PRIMARY_BUTTON}
                  aria-disabled={asked === Asked.Restarting}
                  onClick={restart}
                >
                  {asked === Asked.Restarting ? 'Restarting…' : 'Restart now'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
