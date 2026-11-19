import { ArrowDown, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { formatSpeed } from '@/lib/format.ts';
import { Logo } from './logo.tsx';

interface TitleBarProps {
  // The sum of every running download; zero hides the reading.
  readonly bytesPerSecond: number;
  readonly onOpenSettings: () => void;
}

// The window's title bar, drawn by the page beside the window's own buttons. It moves the
// window; only what can be pressed in it takes the pointer.
export function TitleBar({ bytesPerSecond, onOpenSettings }: TitleBarProps): ReactNode {
  return (
    <header className="title-bar flex h-10 shrink-0 items-center gap-2 pr-1 pl-4">
      <Logo />
      <span className="text-sm font-semibold tracking-tight">Scia</span>
      <div className="ml-auto flex items-center gap-2">
        {bytesPerSecond > 0 && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
            <ArrowDown size={14} aria-hidden="true" className="text-accent" />
            <span className="sr-only">Total speed: </span>
            {formatSpeed(bytesPerSecond)}
          </span>
        )}
        <IconButton label="Settings" className="no-drag" onClick={onOpenSettings}>
          <Settings size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
