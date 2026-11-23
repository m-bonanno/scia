import type { Bundle } from '@scia/contracts';
import { BundleStatus } from '@scia/core';
import { FolderOpen, RotateCw, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { PRIMARY_BUTTON } from '@/components/button-styles.ts';
import { CheckBox } from '@/components/check-box.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { useOnePress } from '@/components/one-press.ts';
import { cn } from '@/lib/cn.ts';
import { formatBytes } from '@/lib/format.ts';
import { SERVICE_NAME } from '@/lib/messages.ts';
import { bundleLine, filesCount } from './bundle-line.ts';

export interface BundleActions {
  // The files chosen, by their place in the list, become downloads: whether the engine took them.
  readonly start: (id: string, files: readonly number[]) => Promise<boolean>;
  readonly retry: (id: string) => void;
  // Scia forgets the link, and the files it listed.
  readonly remove: (id: string) => void;
}

interface BundleRowProps {
  readonly bundle: Bundle;
  readonly actions: BundleActions;
}

const SERVICE = SERVICE_NAME.alldebrid;

// A link that opens into several files (#181): one row while the service is asked, then its files
// to tick — all ticked — until the person downloads the ones they kept; then it leaves the list and
// they are there instead.
export function BundleRow({ bundle, actions }: BundleRowProps): ReactNode {
  const { id } = bundle;
  const failed = bundle.status === BundleStatus.Failed;
  const retryPress = useOnePress();
  const removePress = useOnePress();
  // Retry leaves the row under its own press: the focus goes to Remove, which stays.
  const remove = useRef<HTMLButtonElement>(null);
  return (
    <li className="animate-row-in rounded-xl bg-surface px-4 py-3 transition-colors hover:bg-surface-hover">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tonal text-muted-foreground">
          <FolderOpen size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] leading-snug font-medium" title={bundle.name}>
            {bundle.name}
          </p>
          {/* It wraps: what the list leaves out, it alone says (the designer, #263). */}
          <p
            className={cn(
              'text-sm tabular-nums',
              failed ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {bundleLine(bundle)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {failed && (
            <IconButton
              label="Retry"
              onKeyDown={retryPress.onKeyDown}
              onClick={(event) => {
                if (retryPress.sawTheOneBefore(event)) return;
                if (event.currentTarget === document.activeElement) remove.current?.focus();
                actions.retry(id);
              }}
            >
              <RotateCw size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            ref={remove}
            label="Remove"
            onKeyDown={removePress.onKeyDown}
            onClick={(event) => {
              if (!removePress.sawTheOneBefore(event)) actions.remove(id);
            }}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {bundle.status === BundleStatus.Opening && (
        <div className="mt-3">
          <div
            className="relative h-1 overflow-hidden rounded-full bg-tonal"
            role="progressbar"
            aria-label={`Opened by ${SERVICE}`}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full w-1/4 animate-indeterminate rounded-full bg-accent" />
          </div>
        </div>
      )}
      {bundle.status === BundleStatus.Choosing && (
        <FileChoice bundle={bundle} start={actions.start} />
      )}
    </li>
  );
}

function FileChoice({
  bundle,
  start,
}: {
  readonly bundle: Bundle;
  readonly start: BundleActions['start'];
}): ReactNode {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(bundle.files.map((_, index) => index)),
  );
  // The choice on its way to the engine: held as it was sent until a refusal gives it back. Taken,
  // the row leaves with the next list.
  const [sent, setSent] = useState(false);
  const downloadPress = useOnePress();
  const all = ticked.size === bundle.files.length;
  const none = ticked.size === 0;
  return (
    <fieldset className="mt-3 min-w-0">
      <legend className="sr-only">{`Files of ${bundle.name}`}</legend>
      <CheckBox
        checked={all}
        mixed={!all && !none}
        held={sent}
        onChange={(on) => {
          setTicked(on ? new Set(bundle.files.map((_, index) => index)) : new Set());
        }}
        className="py-1 text-sm font-medium"
      >
        All files
      </CheckBox>
      {/* Room on every side for the boxes' focus outline, which the scroller would cut. */}
      <div className="-mx-1 max-h-60 overflow-y-auto px-1 py-0.5">
        {bundle.files.map((file, index) => (
          <CheckBox
            // The service's order is the files' identity: two may share a name.
            key={index}
            checked={ticked.has(index)}
            held={sent}
            onChange={(on) => {
              setTicked((before) => {
                const next = new Set(before);
                if (on) next.add(index);
                else next.delete(index);
                return next;
              });
            }}
            className="py-1 text-sm"
          >
            <span className="min-w-0 flex-1 truncate" title={file.name}>
              {file.name}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatBytes(file.size)}
            </span>
          </CheckBox>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          aria-disabled={none || sent ? true : undefined}
          onKeyDown={downloadPress.onKeyDown}
          onClick={(event) => {
            if (downloadPress.sawTheOneBefore(event) || none || sent) return;
            setSent(true);
            void start(
              bundle.id,
              [...ticked].sort((a, b) => a - b),
            ).then((started) => {
              if (!started) setSent(false);
            });
          }}
        >
          {none ? 'Download' : `Download ${filesCount(ticked.size)}`}
        </button>
      </div>
    </fieldset>
  );
}
