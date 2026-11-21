import { CircleAlert, X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
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

  const timed = notices
    .filter((notice) => notice.text !== lasting)
    .slice(-(NOTICES_AT_MOST - (lasting === null ? 0 : 1)));
  // What is not shown beside what stays true is let go: kept, it would come back after it,
  // saying the engine is not answering once it answers again.
  const hidden = notices.filter((notice) => !timed.includes(notice));
  useEffect(() => {
    for (const notice of hidden) onDismiss(notice.id);
  });
  if (timed.length === 0 && lasting === null) return null;

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
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  // Held while the pointer is on the stack or the focus is in it: a slow reader keeps it all,
  // and nothing slides from under the pointer.
  const held = pointed || focused;

  const dismiss = (id: number) => {
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index !== -1) (buttons[index + 1] ?? buttons[index - 1] ?? home())?.focus();
    onDismiss(id);
  };

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
      onFocus={() => {
        setFocused(true);
      }}
      // Between two of its notices the focus leaves one and enters the next, in that order.
      onBlur={() => {
        setFocused(false);
      }}
    >
      {timed.map((notice) => (
        <TimedNotice
          key={notice.id}
          notice={notice}
          held={held}
          onExpire={onDismiss}
          onDismiss={dismiss}
          announced={announced}
        />
      ))}
      {lasting !== null && (
        <NoticeItem text={lasting} announceAs={`${LASTING}${lasting}`} announced={announced} />
      )}
    </ul>
  );
}

function TimedNotice({
  notice,
  held,
  onExpire,
  onDismiss,
  announced,
}: {
  readonly notice: Notice;
  readonly held: boolean;
  // Its time is up: nothing is in it to hand on, since nothing that held it was there.
  readonly onExpire: (id: number) => void;
  readonly onDismiss: (id: number) => void;
  readonly announced: RefObject<Set<string>>;
}): ReactNode {
  const { id, round } = notice;
  // Its whole time again after it was held, or told again.
  useEffect(() => {
    if (held) return undefined;
    const timer = setTimeout(() => {
      onExpire(id);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [held, id, round, onExpire]);

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
