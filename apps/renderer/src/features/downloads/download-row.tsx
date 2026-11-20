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
import { type ReactNode, useRef } from 'react';
import { ConfirmButton, type ConfirmButtonHandle } from '@/components/confirm-button.tsx';
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
  const openButton = useRef<ConfirmButtonHandle>(null);

  return (
    <li
      className="animate-row-in rounded-xl bg-surface px-4 py-3 transition-colors hover:bg-surface-hover"
      onDoubleClick={(event) => {
        // A double press on one of the row's buttons is that button's, not the row's.
        if (event.target instanceof Element && event.target.closest('button') !== null) return;
        // The shortcut is one press of "Open", whatever that press does: it opens a file, and
        // asks before a program. It never answers: a second double click runs nothing.
        openButton.current?.press();
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
              'text-sm tabular-nums',
              // A failure's sentence ends with its remedy: it wraps rather than lose it.
              failed ? 'text-destructive' : 'truncate text-muted-foreground',
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
            <ConfirmButton
              ref={openButton}
              label="Open"
              // A program is what its system runs at a press: the button asks once more.
              confirmLabel={program ? 'Run' : undefined}
              onConfirm={() => {
                open(id);
              }}
            >
              <ExternalLink size={16} aria-hidden="true" />
            </ConfirmButton>
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
          <ConfirmButton
            label={completed ? 'Remove from list' : 'Cancel and delete'}
            // A finished download only leaves the list; an unfinished one loses its bytes.
            confirmLabel={completed ? undefined : 'Delete'}
            destructive
            onConfirm={() => {
              actions.remove(id);
            }}
          >
            <X size={16} aria-hidden="true" />
          </ConfirmButton>
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
