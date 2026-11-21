import type { Magnet as MagnetEntry } from '@scia/contracts';
import { MagnetStatus } from '@scia/core';
import { Magnet, RotateCw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { useOnePress } from '@/components/one-press.ts';
import { cn } from '@/lib/cn.ts';
import { SERVICE_NAME } from '@/lib/messages.ts';
import { magnetLine } from './magnet-line.ts';

export interface MagnetActions {
  readonly retry: (id: string) => void;
  // Scia stops waiting for it; the service keeps it.
  readonly remove: (id: string) => void;
}

interface MagnetRowProps {
  readonly magnet: MagnetEntry;
  readonly actions: MagnetActions;
}

const SERVICE = SERVICE_NAME.alldebrid;

// A magnet the service is fetching: one row until its files are downloads, then it leaves the
// list and they are there instead.
export function MagnetRow({ magnet, actions }: MagnetRowProps): ReactNode {
  const { id } = magnet;
  const failed = magnet.status === MagnetStatus.Failed;
  const press = useOnePress();
  const total = magnet.totalBytes ?? 0;
  return (
    <li className="animate-row-in rounded-xl bg-surface px-4 py-3 transition-colors hover:bg-surface-hover">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tonal text-muted-foreground">
          <Magnet size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] leading-snug font-medium" title={magnet.name}>
            {magnet.name}
          </p>
          <p
            className={cn(
              'text-sm tabular-nums',
              failed ? 'text-destructive' : 'truncate text-muted-foreground',
            )}
          >
            {magnetLine(magnet)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {failed && (
            <IconButton
              label="Retry"
              onKeyDown={press.onKeyDown}
              onClick={(event) => {
                if (!press.sawTheOneBefore(event)) actions.retry(id);
              }}
            >
              <RotateCw size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label="Remove"
            onClick={() => {
              actions.remove(id);
            }}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {!failed && (
        <div className="mt-3">
          <div
            className="relative h-1 overflow-hidden rounded-full bg-tonal"
            role="progressbar"
            aria-label={`Fetched by ${SERVICE}`}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(total > 0
              ? { 'aria-valuenow': Math.floor((magnet.downloadedBytes / total) * 100) }
              : {})}
          >
            {total > 0 ? (
              <div
                className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-300 ease-linear"
                style={{ width: `${String((magnet.downloadedBytes / total) * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/4 animate-indeterminate rounded-full bg-accent" />
            )}
          </div>
        </div>
      )}
    </li>
  );
}
