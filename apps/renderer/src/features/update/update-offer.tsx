import { UpdateRestart } from '@scia/contracts/bridge';
import { CircleArrowUp } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { FOCUS_RING, PRIMARY_BUTTON, QUIET_BUTTON_ON_TONAL } from '@/components/button-styles.ts';
import { swallowHeldEnter } from '@/components/held-enter.ts';
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
  // Where the focus goes when the button and its question leave under it: the page's field.
  readonly home: () => HTMLElement | null;
}

const Asked = {
  Closed: 'closed',
  Question: 'question',
  // Something downloads: the update waits for the quit. It stays this until it is closed — a
  // download that ends must not put "Restart now" where "Close" was.
  Waiting: 'waiting',
  Restarting: 'restarting',
  // Main did not restart, or did not answer.
  NotRestarted: 'not-restarted',
} as const;
type Asked = (typeof Asked)[keyof typeof Asked];

// Beside the name: the version Scia is, and, once an update is downloaded, a button to it. A press
// asks before restarting; while something downloads it says the update waits for the quit. While
// main restarts, nothing takes the question back: there is no way back from it.
export function UpdateOffer({
  version,
  offered,
  downloading,
  onRestart,
  onGone,
  home,
}: UpdateOfferProps): ReactNode {
  const [asked, setAsked] = useState<Asked>(Asked.Closed);
  const [shownFor, setShownFor] = useState(offered);
  const wrapper = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  // The focus was on the button or in its question: when they leave, it goes home.
  const holdsFocus = useRef(false);
  const panelId = useId();
  const textId = useId();

  // An offer that leaves takes its question with it, also while main restarts: the next one
  // starts closed. A question that sees a download begin — or opens while one runs — becomes the
  // note.
  if (shownFor !== offered) {
    setShownFor(offered);
    if (offered === null) setAsked(Asked.Closed);
  } else if (asked === Asked.Question && downloading) {
    setAsked(Asked.Waiting);
  }
  const open = asked !== Asked.Closed;
  const restarting = asked === Asked.Restarting;

  const close = (refocus: boolean) => {
    if (restarting) return;
    setAsked(Asked.Closed);
    if (refocus) opener.current?.focus();
  };

  // A press anywhere else, or the focus leaving for elsewhere, puts the question away — but not
  // while main restarts.
  useEffect(() => {
    if (!open || restarting) return undefined;
    const away = (event: Event) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target) === true) return;
      setAsked(Asked.Closed);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open, restarting]);

  // The least consequential answer takes the focus as the question opens or changes — a focus
  // still on the button or in its question, not one the person took elsewhere meanwhile.
  useEffect(() => {
    if (asked === Asked.Closed || asked === Asked.Restarting) return;
    if (holdsFocus.current) first.current?.focus();
  }, [asked]);

  // The button leaves with the offer: a focus it held goes home, not to the page's body.
  useLayoutEffect(() => {
    if (offered !== null || !holdsFocus.current) return;
    holdsFocus.current = false;
    home()?.focus();
  }, [offered, home]);

  if (offered === null) {
    return (
      <span
        className="no-drag text-xs text-muted-foreground tabular-nums"
        title={`Scia ${version}`}
      >
        {version}
      </span>
    );
  }

  const restart = () => {
    if (asked !== Asked.Question) return;
    setAsked(Asked.Restarting);
    // An answer is for the question still waiting on it: one the offer took away meanwhile is not
    // opened again by it.
    const notRestarted = () => {
      setAsked((now) => (now === Asked.Restarting ? Asked.NotRestarted : now));
    };
    onRestart()
      .then((answer) => {
        if (answer === UpdateRestart.Restarting) return;
        if (answer === UpdateRestart.Nothing) {
          setAsked(Asked.Closed);
          opener.current?.focus();
          onGone();
          return;
        }
        notRestarted();
      })
      .catch(notRestarted);
  };

  const waits = asked === Asked.Waiting || asked === Asked.NotRestarted;
  const text =
    asked === Asked.NotRestarted
      ? updateNotRestarted(offered)
      : asked === Asked.Waiting
        ? updateWhileDownloading(offered)
        : updateQuestion(offered);

  return (
    <div
      ref={wrapper}
      className="no-drag relative"
      onFocus={() => {
        holdsFocus.current = true;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) holdsFocus.current = false;
      }}
      onKeyDown={(event) => {
        // A press of Enter moves the focus, or opens the question: its repeats answer nothing.
        swallowHeldEnter(event);
        if (event.key === 'Escape' && open) close(true);
      }}
    >
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
          'group inline-flex h-6 items-center gap-1.5 rounded-md bg-tonal px-2 text-xs font-medium text-foreground transition-colors hover:bg-border',
          FOCUS_RING,
        )}
      >
        {/* Under the pointer the ground is border, on which the accent is not seen enough. */}
        <CircleArrowUp
          size={14}
          aria-hidden="true"
          className="text-accent group-hover:text-foreground"
        />
        {`Update to ${offered}`}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={textId}
          // A press on its text keeps the focus in it, where Escape is heard.
          tabIndex={-1}
          className="absolute top-full left-0 z-20 mt-2 flex w-72 animate-row-in flex-col gap-3 rounded-xl bg-tonal p-4 text-sm text-foreground"
        >
          <p id={textId}>{text}</p>
          <div className="flex justify-end gap-2">
            {waits ? (
              <button
                ref={first}
                type="button"
                aria-describedby={textId}
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
                  ref={first}
                  type="button"
                  aria-describedby={textId}
                  className={QUIET_BUTTON_ON_TONAL}
                  aria-disabled={restarting}
                  onClick={() => {
                    close(true);
                  }}
                >
                  Later
                </button>
                <button
                  type="button"
                  aria-describedby={textId}
                  className={PRIMARY_BUTTON}
                  aria-disabled={restarting}
                  onClick={restart}
                >
                  {restarting ? 'Restarting…' : 'Restart now'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
