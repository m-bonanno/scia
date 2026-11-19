import type { Download } from '@scia/contracts';
import type { ReactNode } from 'react';
import { Logo } from '@/app/logo.tsx';
import { DownloadRow, type RowActions } from './download-row.tsx';
import type { Filter } from './filters.ts';

interface DownloadListProps {
  readonly downloads: readonly Download[];
  readonly filter: Filter;
  readonly actions: RowActions;
}

const EMPTY: Readonly<Record<Filter, { readonly title: string; readonly hint: string }>> = {
  all: {
    title: 'Nessun download',
    hint: 'Incolla un link qui sopra, oppure premi Ctrl+V in qualsiasi punto della finestra.',
  },
  active: { title: 'Niente in corso', hint: 'I download che aggiungi compaiono qui.' },
  completed: { title: 'Ancora nessun file completato', hint: 'I file finiti compaiono qui.' },
};

export function DownloadList({ downloads, filter, actions }: DownloadListProps): ReactNode {
  if (downloads.length === 0) {
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
      {downloads.map((download) => (
        <DownloadRow key={download.id} download={download} actions={actions} />
      ))}
    </ul>
  );
}
