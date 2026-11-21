import type { Download, Magnet } from '@scia/contracts';
import type { ReactNode } from 'react';
import { Logo } from '@/app/logo.tsx';
import { DownloadRow, type RowActions } from './download-row.tsx';
import { Filter } from './filters.ts';
import { type MagnetActions, MagnetRow } from './magnet-row.tsx';

interface DownloadListProps {
  readonly downloads: readonly Download[];
  readonly magnets: readonly Magnet[];
  readonly filter: Filter;
  readonly actions: RowActions;
  readonly magnetActions: MagnetActions;
}

const EMPTY: Readonly<Record<Filter, { readonly title: string; readonly hint: string }>> = {
  all: {
    title: 'No downloads',
    hint: 'Paste a link above, or press Ctrl+V anywhere in the window.',
  },
  active: { title: 'Nothing in progress', hint: 'Downloads you add show up here.' },
  completed: { title: 'No completed files yet', hint: 'Completed files show up here.' },
};

export function DownloadList({
  downloads,
  magnets,
  filter,
  actions,
  magnetActions,
}: DownloadListProps): ReactNode {
  // A magnet is not finished: it is in "All" and "In progress", above the downloads.
  const shownMagnets = filter === Filter.Completed ? [] : magnets;
  if (downloads.length === 0 && shownMagnets.length === 0) {
    const { title, hint } = EMPTY[filter];
    return (
      <div className="flex flex-col items-center gap-2 px-6 pt-20 text-center">
        <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-surface">
          <Logo size={26} />
        </div>
        <p className="font-medium">{title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">{hint}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {shownMagnets.map((magnet) => (
        <MagnetRow key={magnet.id} magnet={magnet} actions={magnetActions} />
      ))}
      {downloads.map((download) => (
        <DownloadRow key={download.id} download={download} actions={actions} />
      ))}
    </ul>
  );
}
