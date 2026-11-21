import type { AccountMagnet } from '@scia/contracts';
import { MagnetStage } from '@scia/core';
import { Magnet, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { FOCUS_RING, TEXT_BUTTON } from '@/components/button-styles.ts';
import { swallowHeldEnter } from '@/components/held-enter.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import {
  type AccountTrouble,
  accountMagnetMessage,
  accountTrouble,
  SERVICE_NAME,
} from '@/lib/messages.ts';
import { accountMagnetLine } from './account-magnet-line.ts';

// How often the panel asks the service while it is shown: far below AllDebrid's limits.
export const ACCOUNT_POLL_MS = 5000;

const SERVICE = SERVICE_NAME.alldebrid;

interface AccountMagnetsProps {
  readonly id: string;
  // Changes when the panel should ask again at once, also after a refusal: Settings closed.
  readonly again: number;
  readonly onClose: () => void;
  readonly tell: (text: string) => void;
}

interface Read {
  // Null before the first answer.
  readonly magnets: readonly AccountMagnet[] | null;
  // Why the last ask gave no list; null when it gave one.
  readonly trouble: AccountTrouble | null;
}

// A press of Download, by the number of the last ask begun when its request settled: null while
// it is on its way. A read begun after it settled says what became of it.
type Taken = ReadonlyMap<number, number | null>;

// Newest first, as the downloads are; one the service gives no date for, last.
function newestFirst(magnets: readonly AccountMagnet[]): AccountMagnet[] {
  return [...magnets].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
}

// The magnets of the connected AllDebrid account, in a panel beside the list (#138; the owner's
// decision). It asks the service only while it is shown and the window is visible.
export function AccountMagnets({ id, again, onClose, tell }: AccountMagnetsProps): ReactNode {
  const [read, setRead] = useState<Read>({ magnets: null, trouble: null });
  const [taken, setTaken] = useState<Taken>(new Map());
  const asks = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  // What held the focus in the panel, as long as the focus has gone nowhere else since.
  const held = useRef<Element | null>(null);
  const headingId = useId();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // An ask on its way, across the asks of a Settings closed meanwhile: one at a time, and the
  // newer one waits for it.
  const asking = useRef(false);
  const waiting = useRef<(() => void) | null>(null);

  useEffect(() => {
    let stopped = false;
    // Waiting for Settings: what asking again cannot mend, asked about again only when it closes.
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let answeredAt = -Infinity;
    // Changed by the cleanup: an answer to this turn's ask that comes after it is not this
    // panel's any more, and is neither drawn nor followed by another ask.
    const isStopped = () => stopped;
    const after = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void turn();
      }, delay);
    };
    // `first`: the ask of a panel just opened or of Settings just closed, which waits for one on its
    // way; any other leaves it to the one on its way, which sets the next.
    const turn = async (first = false) => {
      // Hidden, it asks nothing until it is shown again.
      if (isStopped() || document.visibilityState !== 'visible') return;
      if (asking.current) {
        if (first) {
          waiting.current = () => {
            void turn();
          };
        }
        return;
      }
      asking.current = true;
      asks.current += 1;
      const ask = asks.current;
      try {
        const magnets = await api.accountMagnets();
        if (isStopped()) return;
        setRead({ magnets, trouble: null });
        setTaken(
          (before) =>
            new Map([...before].filter(([, settledAt]) => settledAt === null || settledAt >= ask)),
        );
      } catch (error) {
        if (isStopped()) return;
        const trouble = accountTrouble(error);
        paused = !trouble.heals;
        setRead((before) => ({ magnets: before.magnets, trouble }));
      } finally {
        asking.current = false;
        answeredAt = performance.now();
        const next = waiting.current;
        waiting.current = null;
        next?.();
      }
      if (!paused) after(ACCOUNT_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        clearTimeout(timer);
        return;
      }
      // Shown again: at once when the last answer is a pace old, else when it will be.
      if (!paused) after(Math.max(0, answeredAt + ACCOUNT_POLL_MS - performance.now()));
    };
    void turn(true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [again]);

  // A row that left the panel under the focus — the magnet gone from the account — hands the
  // focus to the heading; a focus that went elsewhere meanwhile has let go of the row already.
  useLayoutEffect(() => {
    if (held.current !== null && !held.current.isConnected) heading.current?.focus();
  });

  const take = (magnet: AccountMagnet) => {
    setTaken((before) => new Map(before).set(magnet.id, null));
    api
      .addAccountMagnet(magnet.id)
      .then(() => {
        setTaken((before) => new Map(before).set(magnet.id, asks.current));
      })
      .catch((error: unknown) => {
        setTaken((before) => {
          const left = new Map(before);
          left.delete(magnet.id);
          return left;
        });
        tell(accountMagnetMessage(error));
      });
  };

  return (
    <aside
      id={id}
      aria-labelledby={headingId}
      onFocus={(event) => {
        held.current = event.target;
      }}
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (to === null || !event.currentTarget.contains(to)) held.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="flex w-80 shrink-0 flex-col bg-surface"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2
          ref={heading}
          id={headingId}
          tabIndex={-1}
          className={cn('min-w-0 truncate text-sm font-semibold', FOCUS_RING)}
        >
          {SERVICE} magnets
        </h2>
        <IconButton
          label="Close"
          className="ml-auto"
          onKeyDown={(event) => {
            // Close hands the focus to the button that opens the panel: a held Enter would open it.
            if (event.key === 'Enter' && !event.repeat) swallowHeldEnter();
          }}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <p role="status" className="px-1 py-2 text-sm text-muted-foreground empty:py-0">
          {stateOf(read)}
        </p>
        {read.magnets !== null && read.magnets.length > 0 && (
          <ul className="flex flex-col gap-1">
            {newestFirst(read.magnets).map((magnet) => (
              <Row
                key={magnet.id}
                magnet={{ ...magnet, inScia: magnet.inScia || taken.has(magnet.id) }}
                onTake={take}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// The sentence of the panel's state, said in its status region: empty while it connects, and
// beside a list from before when the last ask gave none.
function stateOf({ magnets, trouble }: Read): string {
  if (trouble !== null && trouble.text !== null) {
    if (magnets !== null) return `${trouble.text} This is the list from before.`;
    return trouble.heals ? `${trouble.text} Scia asks again soon.` : trouble.text;
  }
  if (magnets?.length === 0) {
    return `No magnets on the ${SERVICE} account. A magnet pasted above is added to it.`;
  }
  return '';
}

interface RowProps {
  readonly magnet: AccountMagnet;
  readonly onTake: (magnet: AccountMagnet) => void;
}

function Row({ magnet, onTake }: RowProps): ReactNode {
  const ready = magnet.stage === MagnetStage.Ready;
  const failed = magnet.stage === MagnetStage.Failed;
  const line = accountMagnetLine(magnet);
  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-2">
      <Magnet size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={magnet.name}>
          {magnet.name}
        </p>
        <p
          title={line}
          className={cn(
            'truncate text-xs tabular-nums',
            failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {line}
        </p>
      </div>
      {/* One element whatever the press made of it: the focus stays where it was. */}
      {ready && (
        <button
          type="button"
          aria-label={`Download ${magnet.name}`}
          aria-disabled={magnet.inScia ? true : undefined}
          className={TEXT_BUTTON}
          onClick={() => {
            if (!magnet.inScia) onTake(magnet);
          }}
        >
          Download
        </button>
      )}
    </li>
  );
}
