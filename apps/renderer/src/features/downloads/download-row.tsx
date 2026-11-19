import type { Download } from '@scia/contracts';
import { DownloadStatus, type FileKind } from '@scia/core';
import {
  AppWindow,
  ExternalLink,
  File,
  FileArchive,
  FileText,
  Film,
  FolderOpen,
  Image,
  type LucideIcon,
  Music,
  Pause,
  Play,
  RotateCw,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { cn } from '@/lib/cn.ts';
import { SegmentBar } from './segment-bar.tsx';
import { statusLine } from './status-line.ts';

const KIND_ICON: Readonly<Record<FileKind, LucideIcon>> = {
  video: Film,
  audio: Music,
  image: Image,
  archive: FileArchive,
  document: FileText,
  program: AppWindow,
  other: File,
};

const CONFIRM_FOR_MS = 3000;

export interface RowActions {
  readonly pause: (id: string) => void;
  readonly resume: (id: string) => void;
  // Unfinished bytes go with the row; a finished file stays where it is.
  readonly remove: (id: string) => void;
  // Only inside the desktop app: a browser tab cannot open a folder.
  readonly reveal: ((id: string) => void) | undefined;
  readonly open: ((id: string) => void) | undefined;
}

interface DownloadRowProps {
  readonly download: Download;
  readonly actions: RowActions;
}

export function DownloadRow({ download, actions }: DownloadRowProps): ReactNode {
  const { id, status } = download;
  const Icon = KIND_ICON[download.kind];
  const completed = status === DownloadStatus.Completed;
  const failed = status === DownloadStatus.Failed;
  const { open, reveal } = actions;

  return (
    <li
      className="animate-row-in rounded-xl bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
      onDoubleClick={(event) => {
        // A double press on one of the row's buttons is that button's, not the row's.
        if (event.target instanceof Element && event.target.closest('button') !== null) return;
        if (completed) open?.(id);
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tonal text-muted-foreground">
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[0.9375rem] leading-snug font-medium"
            title={download.fileName}
          >
            {download.fileName}
          </p>
          <p
            className={cn(
              'truncate text-sm tabular-nums',
              failed ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {statusLine(download)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {(status === DownloadStatus.Downloading || status === DownloadStatus.Queued) && (
            <IconButton
              label="Pause"
              onClick={() => {
                actions.pause(id);
              }}
            >
              <Pause size={16} aria-hidden="true" />
            </IconButton>
          )}
          {status === DownloadStatus.Paused && (
            <IconButton
              label="Resume"
              onClick={() => {
                actions.resume(id);
              }}
            >
              <Play size={16} aria-hidden="true" />
            </IconButton>
          )}
          {failed && (
            <IconButton
              label="Retry"
              onClick={() => {
                actions.resume(id);
              }}
            >
              <RotateCw size={16} aria-hidden="true" />
            </IconButton>
          )}
          {completed && open !== undefined && (
            <IconButton
              label="Open"
              onClick={(event) => {
                // The second press of a double click would open the file twice.
                if (event.detail <= 1) open(id);
              }}
            >
              <ExternalLink size={16} aria-hidden="true" />
            </IconButton>
          )}
          {completed && reveal !== undefined && (
            <IconButton
              label="Show in folder"
              onClick={() => {
                reveal(id);
              }}
            >
              <FolderOpen size={16} aria-hidden="true" />
            </IconButton>
          )}
          <RemoveButton
            completed={completed}
            onRemove={() => {
              actions.remove(id);
            }}
          />
        </div>
      </div>
      {!completed && (
        <div className="mt-3">
          <SegmentBar download={download} />
        </div>
      )}
    </li>
  );
}

interface RemoveButtonProps {
  readonly completed: boolean;
  readonly onRemove: () => void;
}

// A finished download only leaves the list, so one press is enough. An unfinished one loses its
// bytes: the button asks once more, in place, and goes back by itself.
function RemoveButton({ completed, onRemove }: RemoveButtonProps): ReactNode {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => {
      setArmed(false);
    }, CONFIRM_FOR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        autoFocus
        onClick={onRemove}
        onBlur={() => {
          setArmed(false);
        }}
        className="h-8 rounded-lg bg-destructive px-2.5 text-sm font-semibold text-destructive-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Delete
      </button>
    );
  }
  return (
    <IconButton
      label={completed ? 'Remove from list' : 'Cancel and delete'}
      onClick={() => {
        if (completed) {
          onRemove();
        } else {
          setArmed(true);
        }
      }}
    >
      <X size={16} aria-hidden="true" />
    </IconButton>
  );
}
