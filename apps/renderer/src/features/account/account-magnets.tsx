import { type AccountMagnet, ApiErrorCode } from '@scia/contracts';
import { MagnetStage } from '@scia/core';
import { Magnet, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { FOCUS_RING, TEXT_BUTTON } from '@/components/button-styles.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { api, ApiError } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { accountMagnetMessage, SERVICE_NAME } from '@/lib/messages.ts';
import { accountMagnetLine } from './account-magnet-line.ts';

// How often the panel asks the service while it is shown: far below AllDebrid's limits.
export const ACCOUNT_POLL_MS = 5000;

const SERVICE = SERVICE_NAME.alldebrid;

interface AccountMagnetsProps {
  readonly id: string;
  readonly onClose: () => void;
  readonly tell: (text: string) => void;
}

interface Read {
  // Null before the first answer.
  readonly magnets: readonly AccountMagnet[] | null;
  // The last ask failed: what is shown is from before.
  readonly failed: boolean;
  readonly needsService: boolean;
}

// Newest first, as the downloads are; one the service gives no date for, last.
function newestFirst(magnets: readonly AccountMagnet[]): AccountMagnet[] {
  return [...magnets].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
}

// The magnets of the connected AllDebrid account, in a panel beside the list (#138; the owner's
// decision). It asks the service only while it is shown and the window is visible.
export function AccountMagnets({ id, onClose, tell }: AccountMagnetsProps): ReactNode {
  const [read, setRead] = useState<Read>({ magnets: null, failed: false, needsService: false });
  // Magnets taken at a press, by the number of the ask that was the last when it was pressed:
  // a read started before the press does not know of it yet.
  const [taken, setTaken] = useState<ReadonlyMap<number, number>>(new Map());
  const asks = useRef(0);
  const aside = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedHere = useRef(false);
  const headingId = useId();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let stopped = false;
    // Changed by the cleanup, between two awaits.
    const isStopped = () => stopped;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const turn = async () => {
      clearTimeout(timer);
      // Hidden, it asks nothing until it is shown again.
      if (busy || stopped || document.visibilityState !== 'visible') return;
      busy = true;
      asks.current += 1;
      const ask = asks.current;
      try {
        const magnets = await api.accountMagnets();
        if (isStopped()) return;
        setRead({ magnets, failed: false, needsService: false });
        setTaken((before) => new Map([...before].filter(([, pressedAt]) => pressedAt >= ask)));
      } catch (error) {
        if (isStopped()) return;
        const needsService = error instanceof ApiError && error.code === ApiErrorCode.ServiceNeeded;
        setRead((before) => ({ magnets: before.magnets, failed: true, needsService }));
      } finally {
        busy = false;
      }
      timer = setTimeout(() => {
        void turn();
      }, ACCOUNT_POLL_MS);
    };
    const onVisibility = () => {
      void turn();
    };
    void turn();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // A row that left the panel under the focus — the magnet gone from the account — hands it to
  // the heading, never to nothing.
  useLayoutEffect(() => {
    if (focusedHere.current && document.activeElement === document.body) heading.current?.focus();
  });

  const take = (magnet: AccountMagnet) => {
    setTaken((before) => new Map(before).set(magnet.id, asks.current));
    api.addAccountMagnet(magnet.id).catch((error: unknown) => {
      setTaken((before) => {
        const after = new Map(before);
        after.delete(magnet.id);
        return after;
      });
      tell(accountMagnetMessage(error));
    });
  };

  return (
    <aside
      id={id}
      ref={aside}
      aria-labelledby={headingId}
      onFocus={() => {
        focusedHere.current = true;
      }}
      onBlur={(event) => {
        if (event.relatedTarget !== null && !aside.current?.contains(event.relatedTarget)) {
          focusedHere.current = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="absolute inset-y-0 right-0 z-10 flex w-80 max-w-full flex-col bg-surface lg:static"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2
          ref={heading}
          id={headingId}
          tabIndex={-1}
          className={cn('min-w-0 flex-1 truncate text-sm font-semibold', FOCUS_RING)}
        >
          {SERVICE} magnets
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <Contents read={read} taken={taken} onTake={take} />
      </div>
    </aside>
  );
}

interface ContentsProps {
  readonly read: Read;
  readonly taken: ReadonlyMap<number, number>;
  readonly onTake: (magnet: AccountMagnet) => void;
}

function Contents({ read, taken, onTake }: ContentsProps): ReactNode {
  if (read.needsService) {
    return <Said>{`${SERVICE} is no longer connected. Connect it in Settings.`}</Said>;
  }
  // Connecting: nothing is drawn, so nothing flashes.
  if (read.magnets === null) {
    return read.failed ? (
      <Said>{`${SERVICE} could not be asked just now. Scia asks again soon.`}</Said>
    ) : null;
  }
  return (
    <>
      {read.failed && (
        <Said>{`${SERVICE} could not be asked just now. This is the list from before.`}</Said>
      )}
      {read.magnets.length === 0 ? (
        <Said>{`No magnets on the ${SERVICE} account.`}</Said>
      ) : (
        <ul className="flex flex-col gap-1">
          {newestFirst(read.magnets).map((magnet) => (
            <Row
              key={magnet.id}
              magnet={{ ...magnet, inScia: magnet.inScia || taken.has(magnet.id) }}
              onTake={onTake}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Said({ children }: { readonly children: string }): ReactNode {
  return <p className="px-1 py-2 text-sm text-muted-foreground">{children}</p>;
}

interface RowProps {
  readonly magnet: AccountMagnet;
  readonly onTake: (magnet: AccountMagnet) => void;
}

function Row({ magnet, onTake }: RowProps): ReactNode {
  const ready = magnet.stage === MagnetStage.Ready;
  const failed = magnet.stage === MagnetStage.Failed;
  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-2">
      <Magnet size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={magnet.name}>
          {magnet.name}
        </p>
        <p
          className={cn(
            'truncate text-xs tabular-nums',
            failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {accountMagnetLine(magnet)}
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
