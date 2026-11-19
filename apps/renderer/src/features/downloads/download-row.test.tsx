import { DownloadStatus } from '@scia/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DownloadRow, type RowActions } from './download-row.tsx';
import { aDownload } from '@/test/a-download.ts';

function actions(overrides: Partial<RowActions> = {}): RowActions {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    remove: vi.fn(),
    reveal: vi.fn(),
    open: vi.fn(),
    ...overrides,
  };
}

describe('DownloadRow', () => {
  it('shows the file, its progress and the pause of a running download', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    expect(screen.getByText('film.mkv')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    await userEvent.click(screen.getByRole('button', { name: 'Metti in pausa' }));

    expect(row.pause).toHaveBeenCalledWith('d1');
  });

  it('offers to resume a paused download and to retry a failed one', async () => {
    const row = actions();
    const { rerender } = render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Paused })} actions={row} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Riprendi' }));

    rerender(<DownloadRow download={aDownload({ status: DownloadStatus.Failed })} actions={row} />);
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));

    expect(row.resume).toHaveBeenCalledTimes(2);
  });

  it('asks once more before throwing away unfinished bytes', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.click(screen.getByRole('button', { name: 'Annulla ed elimina' }));
    expect(row.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Elimina' }));

    expect(row.remove).toHaveBeenCalledWith('d1');
  });

  it('takes a finished download off the list at once and shows where the file is', async () => {
    const row = actions();
    render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Completed })} actions={row} />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mostra nella cartella' }));
    await userEvent.click(screen.getByRole('button', { name: 'Togli dall’elenco' }));

    expect(row.reveal).toHaveBeenCalledWith('d1');
    expect(row.remove).toHaveBeenCalledWith('d1');
  });

  it('does not offer the folder where there is no desktop shell to open it', () => {
    render(
      <DownloadRow
        download={aDownload({ status: DownloadStatus.Completed })}
        actions={actions({ reveal: undefined })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Mostra nella cartella' })).not.toBeInTheDocument();
  });
});
