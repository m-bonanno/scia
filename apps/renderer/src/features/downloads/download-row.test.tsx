import { DownloadFailure, DownloadStatus, FileKind } from '@scia/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DownloadRow, type RowActions } from './download-row.tsx';
import { aDownload } from '@/test/a-download.ts';

function actions(overrides: Partial<RowActions> = {}): RowActions {
  return {
    start: vi.fn(),
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

  it('offers a ready link its Start and its removal, at one press each, and nothing else', async () => {
    const row = actions();
    const ready = aDownload({ status: DownloadStatus.Ready, totalBytes: null, downloadedBytes: 0 });
    render(<DownloadRow download={ready} actions={row} />);

    expect(screen.getByText('Ready')).toHaveClass('text-muted-foreground');
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Start', 'Remove']);
    // Its bar is empty and still: nothing has started.
    expect(screen.getByRole('progressbar')).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(row.start).toHaveBeenCalledExactlyOnceWith('d1');

    // Nothing is on the disk yet: the row goes at the first press, asking nothing.
    screen.getByRole('button', { name: 'Remove' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(row.remove).toHaveBeenCalledExactlyOnceWith('d1');
  });

  it('shows the whole sentence of a failure, remedy included, where a running line is cut', () => {
    const failed = aDownload({
      status: DownloadStatus.Failed,
      failure: DownloadFailure.HttpStatus,
      failureStatus: 404,
      via: 'alldebrid',
    });
    const { rerender } = render(<DownloadRow download={failed} actions={actions()} />);

    expect(screen.getByText(/^The link AllDebrid gave no longer works/)).not.toHaveClass(
      'truncate',
    );

    rerender(<DownloadRow download={aDownload()} actions={actions()} />);
    expect(screen.getByText(/MB\/s/)).toHaveClass('truncate');
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
    // The shortcut is a press of the button: the focus goes where the press went.
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();

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

  // "Run" is wider than "Open": it grows over the strip beside it, where the double click
  // that made it ask may have been. A third press of that burst lands on it, saying it is the
  // third — of a burst the button saw none of.
  it('does not answer the question with a later press of the burst that asked it', async () => {
    const row = actions();
    render(<DownloadRow download={aProgram()} actions={row} />);

    await userEvent.dblClick(screen.getByText('setup.exe'));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }), { detail: 3 });

    expect(row.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
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
