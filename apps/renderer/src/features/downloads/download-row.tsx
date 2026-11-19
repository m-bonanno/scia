import type { Download } from '@scia/contracts';
import { DownloadStatus, FileKind } from '@scia/core';
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
import type { ReactNode } from 'react';
import { ConfirmButton } from '@/components/confirm-button.tsx';
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
  const program = download.kind === FileKind.Program;
  const { open, reveal } = actions;

  return (
    <li
      className="animate-row-in rounded-xl bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
      onDoubleClick={(event) => {
        // A double press on one of the row's buttons is that button's, not the row's.
        if (event.target instanceof Element && event.target.closest('button') !== null) return;
        // The shortcut of one press of "Open" — and one press does not run a program.
        if (completed && !program) open?.(id);
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
            <OpenButton
              program={program}
              onOpen={() => {
                open(id);
              }}
            />
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

interface OpenButtonProps {
  readonly program: boolean;
  readonly onOpen: () => void;
}

// One press opens a file. A program is what its system runs at that press: the button asks once
// more, in place.
function OpenButton({ program, onOpen }: OpenButtonProps): ReactNode {
  const icon = <ExternalLink size={16} aria-hidden="true" />;
  if (program) {
    return (
      <ConfirmButton label="Open" confirmLabel="Run" onConfirm={onOpen}>
        {icon}
      </ConfirmButton>
    );
  }
  return (
    <IconButton
      label="Open"
      onClick={(event) => {
        // The second press of a double click would open the file twice.
        if (event.detail <= 1) onOpen();
      }}
    >
      {icon}
    </IconButton>
  );
}

interface RemoveButtonProps {
  readonly completed: boolean;
  readonly onRemove: () => void;
}

// A finished download only leaves the list, so one press is enough. An unfinished one loses its
// bytes: the button asks once more, in place.
function RemoveButton({ completed, onRemove }: RemoveButtonProps): ReactNode {
  const icon = <X size={16} aria-hidden="true" />;
  if (completed) {
    return (
      <IconButton label="Remove from list" onClick={onRemove}>
        {icon}
      </IconButton>
    );
  }
  return (
    <ConfirmButton label="Cancel and delete" confirmLabel="Delete" destructive onConfirm={onRemove}>
      {icon}
    </ConfirmButton>
  );
}
