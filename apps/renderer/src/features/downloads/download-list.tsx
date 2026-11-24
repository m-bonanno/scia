import type { Bundle, Download, Magnet } from '@scia/contracts';
import type { ReactNode } from 'react';
import { Logo } from '@/app/logo.tsx';
import { type BundleActions, BundleRow } from './bundle-row.tsx';
import { DownloadRow, type RowActions } from './download-row.tsx';
import { Filter } from './filters.ts';
import { type MagnetActions, MagnetRow } from './magnet-row.tsx';

interface DownloadListProps {
  readonly downloads: readonly Download[];
  readonly magnets: readonly Magnet[];
  readonly bundles: readonly Bundle[];
  readonly filter: Filter;
  readonly actions: RowActions;
  readonly magnetActions: MagnetActions;
  readonly bundleActions: BundleActions;
}

const EMPTY: Readonly<Record<Filter, { readonly title: string; readonly hint: string }>> = {
  all: {
    title: 'No downloads',
    hint: 'Paste a link above, or press Ctrl+V anywhere in the window.',
  },
  active: { title: 'Nothing in progress', hint: 'Downloads you add show up here.' },
  // True before anything completed and after "Clear completed", whose files stay on the disk.
  completed: {
    title: 'No completed downloads',
    hint: 'Downloads show up here once they complete.',
  },
};

export function DownloadList({
  downloads,
  magnets,
  bundles,
  filter,
  actions,
  magnetActions,
  bundleActions,
}: DownloadListProps): ReactNode {
  // A magnet, and a link whose files wait for a choice, are not finished: they are in "All" and
  // "In progress", above the downloads — newest first, as they are. A link waits for the person,
  // so it comes first.
  const waiting = filter !== Filter.Completed;
  const shownBundles = waiting ? [...bundles].reverse() : [];
  const shownMagnets = waiting ? [...magnets].reverse() : [];
  if (downloads.length === 0 && shownMagnets.length === 0 && shownBundles.length === 0) {
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
      {shownBundles.map((bundle) => (
        <BundleRow key={bundle.id} bundle={bundle} actions={bundleActions} />
      ))}
      {shownMagnets.map((magnet) => (
        <MagnetRow key={magnet.id} magnet={magnet} actions={magnetActions} />
      ))}
      {downloads.map((download) => (
        <DownloadRow key={download.id} download={download} actions={actions} />
      ))}
    </ul>
  );
}
