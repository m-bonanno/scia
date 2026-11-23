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
import { useOnePress } from '@/components/one-press.ts';
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
  // A link taken from the clipboard waits for this press.
  readonly start: (id: string) => void;
  readonly pause: (id: string) => void;
  readonly resume: (id: string) => void;
  // Unfinished bytes go with the row; a finished file stays where it is.
  readonly remove: (id: string) => void;
  // Only inside the desktop app: a browser tab cannot open a folder.
  readonly reveal: ((id: string) => void) | undefined;
  readonly open: ((id: string) => void) | undefined;
}

// A ready link's name is a guess from its address until it starts: a site's page is "watch", a
// file host's an "….html". A video's page is named by the title its site gives, read while it is
// ready, until the file is named (#285); one that names no kind of file otherwise by its address.
// The title is text: React writes it as such, never as markup.
function shownName(download: Download): string {
  if (download.title !== null) return download.title;
  if (download.status !== DownloadStatus.Ready || download.kind !== FileKind.Other) {
    return download.fileName;
  }
  return download.url.replace(/^https?:\/\/(www\.)?/i, '');
}

interface Main {
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly press: 'start' | 'pause' | 'resume';
}

// The one thing a row does next, in one place: a press that changes the row's state changes this
// button, and leaves the focus on it.
const MAIN: Readonly<Record<DownloadStatus, Main | undefined>> = {
  ready: { label: 'Start', Icon: Play, press: 'start' },
  queued: { label: 'Pause', Icon: Pause, press: 'pause' },
  downloading: { label: 'Pause', Icon: Pause, press: 'pause' },
  paused: { label: 'Resume', Icon: Play, press: 'resume' },
  failed: { label: 'Retry', Icon: RotateCw, press: 'resume' },
  completed: undefined,
};

// One element whatever it says, so that the focus stays on it and the second click of a double
// click — which may land after the state, and the button, changed — is not a press of its own.
function MainAction({
  action,
  onPress,
}: {
  readonly action: Main;
  readonly onPress: () => void;
}): ReactNode {
  const press = useOnePress();
  return (
    <IconButton
      label={action.label}
      onKeyDown={press.onKeyDown}
      onClick={(event) => {
        if (!press.sawTheOneBefore(event)) onPress();
      }}
    >
      <action.Icon size={16} aria-hidden="true" />
    </IconButton>
  );
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
  const ready = status === DownloadStatus.Ready;
  const main = MAIN[status];
  const program = download.kind === FileKind.Program;
  const { open, reveal } = actions;
  const openButton = useRef<ConfirmButtonHandle>(null);
  const name = shownName(download);

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
            title={name}
            // A title comes in any script: its own direction says where it begins and is cut.
            dir="auto"
          >
            {name}
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
          {main !== undefined && (
            <MainAction
              action={main}
              onPress={() => {
                actions[main.press](id);
              }}
            />
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
            label={completed ? 'Remove from list' : ready ? 'Remove' : 'Cancel and delete'}
            // A finished download only leaves the list, and a ready one has nothing on the disk;
            // an unfinished one loses its bytes.
            confirmLabel={completed || ready ? undefined : 'Delete'}
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
