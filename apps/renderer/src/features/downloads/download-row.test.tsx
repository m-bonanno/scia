import { DownloadStatus, FileKind } from '@scia/core';
import { fireEvent, render, screen } from '@testing-library/react';
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

  // In a browser the second press of a double click lands on the button that took the place
  // of the first: it arrives there as a click that says it is the second.
  const secondPressOfADoubleClick = { detail: 2 };

  it('does not run a program on a double click, on its name or on its button', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);

    await userEvent.dblClick(screen.getByText('setup.exe'));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }), secondPressOfADoubleClick);

    expect(row.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('does not throw unfinished bytes away on a double click', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel and delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }), secondPressOfADoubleClick);

    expect(row.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('has nothing to open before the file is whole', async () => {
    const row = actions();
    render(<DownloadRow download={aDownload()} actions={row} />);

    await userEvent.dblClick(screen.getByText('film.mkv'));

    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(row.open).not.toHaveBeenCalled();
  });
});
