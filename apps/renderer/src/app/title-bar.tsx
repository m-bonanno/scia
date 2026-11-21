import { ArrowDown, Magnet, Settings } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { swallowHeldEnter } from '@/components/held-enter.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { formatSpeed, SEPARATOR } from '@/lib/format.ts';
import { SERVICE_NAME } from '@/lib/messages.ts';
import { Logo } from './logo.tsx';

interface TitleBarProps {
  // The sum of every running download; zero hides the reading.
  readonly bytesPerSecond: number;
  // Shown beside the speed while it is on: why the downloads go no faster.
  readonly speedLimitBytesPerSecond: number | null;
  readonly onOpenSettings: () => void;
  // The panel of the account's magnets: offered only while AllDebrid is connected (#138).
  readonly magnets?: {
    readonly open: boolean;
    readonly panelId: string;
    readonly onToggle: () => void;
  };
  readonly magnetsToggleRef?: Ref<HTMLButtonElement> | undefined;
  // Beside the name: the version, and an update to restart for (`UpdateOffer`).
  readonly beside?: ReactNode;
}

// The window's title bar, drawn by the page beside the window's own buttons. It moves the
// window; only what can be pressed in it takes the pointer.
export function TitleBar({
  bytesPerSecond,
  speedLimitBytesPerSecond,
  onOpenSettings,
  magnets,
  magnetsToggleRef,
  beside,
}: TitleBarProps): ReactNode {
  return (
    <header className="title-bar flex h-10 shrink-0 items-center gap-2 pr-1 pl-4">
      <Logo />
      <span className="text-sm font-semibold tracking-tight">Scia</span>
      {beside}
      <div className="ml-auto flex items-center gap-2">
        {bytesPerSecond > 0 && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
            <ArrowDown size={14} aria-hidden="true" className="text-accent" />
            <span className="sr-only">Total speed: </span>
            {/* One run of text: what is read aloud or copied has the spaces that are seen. */}
            <span>
              {formatSpeed(bytesPerSecond)}
              {speedLimitBytesPerSecond !== null &&
                `${SEPARATOR}limit ${formatSpeed(speedLimitBytesPerSecond)}`}
            </span>
          </span>
        )}
        {magnets !== undefined && (
          <IconButton
            {...(magnetsToggleRef === undefined ? {} : { ref: magnetsToggleRef })}
            label={`${SERVICE_NAME.alldebrid} magnets`}
            className="no-drag aria-expanded:bg-tonal"
            aria-expanded={magnets.open}
            aria-controls={magnets.open ? magnets.panelId : undefined}
            onKeyDown={(event) => {
              // Pressed, it moves the focus into the panel or back: a held Enter would press on.
              if (event.key === 'Enter' && !event.repeat) swallowHeldEnter();
            }}
            onClick={magnets.onToggle}
          >
            <Magnet size={16} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton label="Settings" className="no-drag" onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
