import { DownloadStatus, FileKind } from '@scia/core';
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
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(row.pause).toHaveBeenCalledWith('d1');
  });

  it('offers to resume a paused download and to retry a failed one', async () => {
    const row = actions();
    const { rerender } = render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Paused })} actions={row} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

    rerender(<DownloadRow download={aDownload({ status: DownloadStatus.Failed })} actions={row} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(row.resume).toHaveBeenCalledTimes(2);
  });

  it('asks once more before throwing away unfinished bytes', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel and delete' }));
    expect(row.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(row.remove).toHaveBeenCalledWith('d1');
  });

  it('takes a finished download off the list at once and shows where the file is', async () => {
    const row = actions();
    render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Completed })} actions={row} />,
    );

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));

    expect(row.reveal).toHaveBeenCalledWith('d1');
    expect(row.remove).toHaveBeenCalledWith('d1');
  });

  it('does not offer the folder or the file where there is no desktop shell to open them', () => {
    render(
      <DownloadRow
        download={aDownload({ status: DownloadStatus.Completed })}
        actions={actions({ reveal: undefined, open: undefined })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('opens a finished file from a button, by pointer or by keyboard', async () => {
    const row = actions();
    render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Completed })} actions={row} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    screen.getByRole('button', { name: 'Open' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(row.open).toHaveBeenCalledTimes(2);
    expect(row.open).toHaveBeenLastCalledWith('d1');
  });

  it('opens the file once, wherever on the row it is double-clicked', async () => {
    const row = actions();
    render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Completed })} actions={row} />,
    );

    await userEvent.dblClick(screen.getByText('film.mkv'));
    expect(row.open).toHaveBeenCalledTimes(1);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Open' }));
    expect(row.open).toHaveBeenCalledTimes(2);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Show in folder' }));
    expect(row.open).toHaveBeenCalledTimes(2);
  });

  const aProgram = () =>
    aDownload({ status: DownloadStatus.Completed, kind: FileKind.Program, fileName: 'setup.exe' });

  it('asks once more before running a program, in place', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(row.open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(row.open).toHaveBeenCalledExactlyOnceWith('d1');
  });

  it('takes a double click on a program\'s row as one press of its "Open": it asks, and waits', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);

    await userEvent.dblClick(screen.getByText('setup.exe'));

    expect(row.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
  });

  it('does not run a program on a double click on its button', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Open' }));

    expect(row.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('runs a program from the keyboard at the second press of Enter, never at one held down', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);
    screen.getByRole('button', { name: 'Open' }).focus();

    await userEvent.keyboard('{Enter>5/}');
    expect(row.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(row.open).toHaveBeenCalledExactlyOnceWith('d1');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('does not throw unfinished bytes away on a double click, or at a key held down', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Cancel and delete' }));
    expect(row.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('film.mkv'));
    screen.getByRole('button', { name: 'Cancel and delete' }).focus();
    await userEvent.keyboard('{Enter>5/}');
    expect(row.remove).not.toHaveBeenCalled();
  });

  it('opens a file once at a key held down', async () => {
    const row = actions();
    render(
      <DownloadRow download={aDownload({ status: DownloadStatus.Completed })} actions={row} />,
    );
    screen.getByRole('button', { name: 'Open' }).focus();

    await userEvent.keyboard('{Enter>5/}');

    expect(row.open).toHaveBeenCalledTimes(1);
  });

  it('has nothing to open before the file is whole', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.dblClick(screen.getByText('film.mkv'));

    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(row.open).not.toHaveBeenCalled();
  });
});
