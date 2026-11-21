import { CircleAlert, X } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/icon-button.tsx';
import { cn } from '@/lib/cn.ts';
import { type Notice, NOTICE_MS, NOTICES_AT_MOST } from './use-notices.ts';

interface NoticesProps {
  readonly notices: readonly Notice[];
  // What stays while it is true, with no time and no way to dismiss it: the engine not answering.
  readonly lasting: string | null;
  readonly onDismiss: (id: number) => void;
  // Where the focus goes when the notice it was on leaves, and no other notice is there.
  readonly home: () => HTMLElement | null;
  // Where the notices are drawn instead of the page: an open modal dialog, which leaves
  // everything outside it out of reach.
  readonly layer?: Element | null;
}

// The notices at the bottom of the window: what went wrong, said once, for a few seconds.
export function Notices({
  notices,
  lasting,
  onDismiss,
  home,
  layer = null,
}: NoticesProps): ReactNode {
  // What was announced already: a notice drawn again elsewhere — over a dialog that opened — is
  // not read out a second time.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (lasting === null) {
      for (const key of announced.current)
        if (key.startsWith(LASTING)) announced.current.delete(key);
    }
  }, [lasting]);

  // The newest, as many as fit beside what stays true; and never its own text a second time.
  const timed = notices
    .filter((notice) => notice.text !== lasting)
    .slice(-(NOTICES_AT_MOST - (lasting === null ? 0 : 1)));
  // What is not shown is let go, here and nowhere else: kept, it would come back later — saying
  // the engine is not answering once it answers again. The stack hands on a focus it held.
  const hidden = notices.filter((notice) => !timed.includes(notice));
  useEffect(() => {
    for (const notice of hidden) onDismiss(notice.id);
  });

  // Mounted while empty too: it hands on the focus of the last notice to leave.
  const stack = (
    <Stack
      timed={timed}
      lasting={lasting}
      onDismiss={onDismiss}
      home={home}
      announced={announced}
    />
  );
  return layer === null ? stack : createPortal(stack, layer);
}

const LASTING = 'lasting:';

interface StackProps {
  readonly timed: readonly Notice[];
  readonly lasting: string | null;
  readonly onDismiss: (id: number) => void;
  readonly home: () => HTMLElement | null;
  readonly announced: RefObject<Set<string>>;
}

function Stack({ timed, lasting, onDismiss, home, announced }: StackProps): ReactNode {
  const list = useRef<HTMLUListElement>(null);
  // The notice whose × has the focus: it holds the stack while it is there.
  const [focusedId, setFocusedId] = useState<number | null>(null);
  // The last × the focus was on, and where it stood. However its notice leaves — dismissed, gone
  // by itself, pushed out by a newer one, put aside for the engine's — the focus goes to the ×
  // now in its place, else to the one before it, else home. Read after every change rather than
  // from a blur: the blur the removal causes comes during React's commit, which React does not
  // hand to its handlers.
  const lastFocus = useRef<{ readonly id: number; readonly at: number } | null>(null);

  useLayoutEffect(() => {
    const last = lastFocus.current;
    if (last === null || (list.current?.contains(document.activeElement) ?? false)) return;
    lastFocus.current = null;
    // Still there: the person took the focus elsewhere.
    if (timed.some((notice) => notice.id === last.id)) return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    (buttons[Math.min(last.at, buttons.length - 1)] ?? home())?.focus();
  });

  if (timed.length === 0 && lasting === null) return null;
  return (
    <List
      list={list}
      focusHeld={timed.some((notice) => notice.id === focusedId)}
      onFocus={(target) => {
        const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
        const at = buttons.findIndex((button) => button === target);
        const id = timed[at]?.id;
        lastFocus.current = id === undefined ? null : { id, at };
        setFocusedId(id ?? null);
      }}
      onBlur={() => {
        setFocusedId(null);
      }}
    >
      {(held) => (
        <>
          {timed.map((notice) => (
            <TimedNotice
              key={notice.id}
              notice={notice}
              held={held}
              onDismiss={onDismiss}
              announced={announced}
            />
          ))}
          {lasting !== null && (
            <NoticeItem text={lasting} announceAs={`${LASTING}${lasting}`} announced={announced} />
          )}
        </>
      )}
    </List>
  );
}

// Mounted only while there are notices: a list that is gone hears no pointer leave it, and the
// next one starts unheld.
function List({
  list,
  focusHeld,
  onFocus,
  onBlur,
  children,
}: {
  readonly list: RefObject<HTMLUListElement | null>;
  readonly focusHeld: boolean;
  readonly onFocus: (target: EventTarget) => void;
  readonly onBlur: () => void;
  readonly children: (held: boolean) => ReactNode;
}): ReactNode {
  const [pointed, setPointed] = useState(false);
  return (
    <ul
      ref={list}
      aria-label="Notices"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-4"
      onPointerEnter={() => {
        setPointed(true);
      }}
      onPointerLeave={() => {
        setPointed(false);
      }}
      onFocus={(event) => {
        onFocus(event.target);
      }}
      onBlur={onBlur}
    >
      {/* Held while the pointer is on the stack or the focus is in it: a slow reader keeps it
          all, and nothing slides from under the pointer. */}
      {children(pointed || focusHeld)}
    </ul>
  );
}

function TimedNotice({
  notice,
  held,
  onDismiss,
  announced,
}: {
  readonly notice: Notice;
  readonly held: boolean;
  readonly onDismiss: (id: number) => void;
  readonly announced: RefObject<Set<string>>;
}): ReactNode {
  const { id, round } = notice;
  // Its whole time again after it was held, or told again.
  useEffect(() => {
    if (held) return undefined;
    const timer = setTimeout(() => {
      onDismiss(id);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [held, id, round, onDismiss]);

  return (
    <NoticeItem text={notice.text} announceAs={String(id)} announced={announced}>
      <IconButton
        label="Dismiss"
        onTonal
        // The focus moves to the next notice's ×: Enter held down would dismiss them all.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.repeat) event.preventDefault();
        }}
        onClick={() => {
          onDismiss(id);
        }}
      >
        <X size={16} aria-hidden="true" />
      </IconButton>
    </NoticeItem>
  );
}

function NoticeItem({
  text,
  announceAs,
  announced,
  children,
}: {
  readonly text: string;
  readonly announceAs: string;
  readonly announced: RefObject<Set<string>>;
  readonly children?: ReactNode;
}): ReactNode {
  const [announce] = useState(() => !announced.current.has(announceAs));
  useEffect(() => {
    announced.current.add(announceAs);
  }, [announced, announceAs]);

  return (
    <li
      className={cn(
        'pointer-events-auto flex w-full max-w-md animate-row-in items-start gap-3 rounded-xl bg-tonal py-2 pl-4 text-sm text-foreground',
        children === undefined ? 'pr-4' : 'pr-2',
      )}
    >
      <CircleAlert size={16} aria-hidden="true" className="mt-2 shrink-0 text-destructive" />
      <p role={announce ? 'alert' : undefined} className="min-w-0 flex-1 py-1.5">
        {text}
      </p>
      {children}
    </li>
  );
}
