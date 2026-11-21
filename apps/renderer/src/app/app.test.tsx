import { ApiErrorCode, type Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';
import { api, ApiError } from '@/lib/api.ts';
import type * as Live from '@/lib/live.ts';
import { ENGINE_UNREACHABLE } from '@/lib/messages.ts';
import { aDownload } from '@/test/a-download.ts';

const MIB = 1024 * 1024;
const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: '/home/me/Downloads',
  speedLimitBytesPerSecond: null,
  theme: 'black-tie',
  betaUpdates: false,
  watchClipboard: false,
} as const;

// What the page hears of the engine: changed by a spec, then the page is rendered again.
const live = vi.hoisted((): { connection: Live.Connection; downloads: Download[] } => ({
  connection: 'live',
  downloads: [],
}));
vi.mock('@/lib/live.ts', async (original) => ({
  ...(await original<typeof Live>()),
  useLive: () => ({ connection: live.connection, downloads: live.downloads }),
}));

beforeAll(() => {
  // jsdom does not open dialogs: enough of them for what is inside to be reachable.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  live.connection = 'live';
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'pairing').mockResolvedValue({ token: 'pairing-code', port: 47821 });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.scia;
  delete document.documentElement.dataset.theme;
});

describe('App', () => {
  it('says the file did not open, not that the engine is silent, when main cannot open it', async () => {
    live.downloads = [aDownload({ status: DownloadStatus.Completed })];
    const openDownload = vi.fn(async () => {
      throw new Error('Error invoking remote method: the file is not there');
    });
    window.scia = {
      apiToken: 'token',
      version: '1.0.0',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload,
      chooseDownloadFolder: vi.fn(async () => 'kept'),
      themeChanged: vi.fn(async () => undefined),
      openCodePage: vi.fn(async () => undefined),
    };
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    const notices = await screen.findByRole('list', { name: 'Notices' });
    expect(within(notices).getByRole('alert')).toHaveTextContent(
      'Scia could not open the file. It may have been moved or deleted.',
    );
    expect(notices).not.toHaveTextContent(ENGINE_UNREACHABLE);
    expect(openDownload).toHaveBeenCalledWith('d1');

    await userEvent.click(within(notices).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();
  });

  it('keeps what the engine refused of the typed text under the field, not in a notice', async () => {
    vi.spyOn(api, 'addDownloads').mockRejectedValue(
      new ApiError(400, ApiErrorCode.InvalidRequest, 'not links'),
    );
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });

    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    await vi.waitFor(() => {
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });
    expect(field).toHaveAccessibleDescription('No http or https links in what you pasted.');
    expect(field).toHaveValue('https://example.com/a.zip');
    expect(screen.queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();

    await userEvent.type(field, 'x');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(field).not.toHaveAccessibleDescription();
  });

  it('does not say under the field a refusal of text the field no longer holds', async () => {
    let refuse: (error: unknown) => void = () => undefined;
    vi.spyOn(api, 'addDownloads').mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject;
      }),
    );
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    await userEvent.type(field, '2');
    refuse(new ApiError(400, ApiErrorCode.InvalidRequest, 'not links'));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    });
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.queryByText('No http or https links in what you pasted.'),
    ).not.toBeInTheDocument();
  });

  it('takes back what the field said once the same text is taken', async () => {
    vi.spyOn(api, 'addDownloads')
      .mockRejectedValueOnce(new ApiError(400, ApiErrorCode.InvalidRequest, 'not links'))
      .mockResolvedValueOnce([]);
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await vi.waitFor(() => {
      expect(field).toHaveAttribute('aria-invalid', 'true');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    await vi.waitFor(() => {
      expect(field).toHaveValue('');
    });
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps text typed while the add was on its way when the links sent are taken', async () => {
    let take: (downloads: Download[]) => void = () => undefined;
    vi.spyOn(api, 'addDownloads').mockReturnValue(
      new Promise((resolve) => {
        take = resolve;
      }),
    );
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    await userEvent.type(field, ' https://example.com/b.zip');
    take([]);

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^Download/ })).toBeEnabled();
    });
    expect(field).toHaveValue('https://example.com/a.zip https://example.com/b.zip');
  });

  it('sends nothing from the field when Enter, held to dismiss the last notice, lands on it', async () => {
    live.downloads = [aDownload({ status: DownloadStatus.Completed })];
    window.scia = {
      apiToken: 'token',
      version: '1.0.0',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload: vi.fn(async () => {
        throw new Error('not there');
      }),
      chooseDownloadFolder: vi.fn(async () => 'kept'),
      themeChanged: vi.fn(async () => undefined),
      openCodePage: vi.fn(async () => undefined),
    };
    const add = vi.spyOn(api, 'addDownloads').mockResolvedValue([]);
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const notices = await screen.findByRole('list', { name: 'Notices' });
    within(notices).getByRole('button', { name: 'Dismiss' }).focus();

    await userEvent.keyboard('{Enter>4/}');

    expect(screen.queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(add).not.toHaveBeenCalled();
    expect(field).toHaveValue('https://example.com/a.zip');

    await userEvent.keyboard('{Enter}');
    expect(add).toHaveBeenCalledOnce();
  });

  it('keeps Settings open when Enter, held to dismiss the last notice over it, lands on Close', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiError(500, ApiErrorCode.InternalError, 'it broke'),
    );
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Theme' }),
      'Space',
    );
    const notices = await within(dialog).findByRole('list', { name: 'Notices' });
    const dismisses = within(notices).getAllByRole('button', { name: 'Dismiss' });
    for (const dismiss of dismisses.slice(1).reverse()) await userEvent.click(dismiss);
    dismisses[0]?.focus();

    await userEvent.keyboard('{Enter>4/}');

    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(dialog).toHaveAttribute('open');
  });

  it('leaves the focus on a notice when the ready rows and "Start all" leave', async () => {
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    vi.spyOn(api, 'addDownloads').mockRejectedValue(
      new ApiError(500, ApiErrorCode.InternalError, 'it broke'),
    );
    const { rerender } = render(<App />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Links to download' }),
      'https://example.com/a.zip',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    const notices = await screen.findByRole('list', { name: 'Notices' });
    const dismiss = within(notices).getByRole('button', { name: 'Dismiss' });
    dismiss.focus();

    live.downloads = [aDownload({ status: DownloadStatus.Downloading })];
    rerender(<App />);

    expect(screen.queryByRole('button', { name: 'Start all' })).not.toBeInTheDocument();
    expect(dismiss).toHaveFocus();
  });

  it('hands the focus to Close when the last notice over Settings is dismissed', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiError(500, ApiErrorCode.InternalError, 'it broke'),
    );
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Theme' }),
      'Space',
    );
    const notices = await within(dialog).findByRole('list', { name: 'Notices' });

    for (const dismiss of within(notices).getAllByRole('button', { name: 'Dismiss' }).reverse()) {
      await userEvent.click(dismiss);
    }

    expect(within(dialog).queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('says in a notice that an add failed for a reason that is not the text, keeping the text', async () => {
    vi.spyOn(api, 'addDownloads').mockRejectedValue(
      new ApiError(401, ApiErrorCode.Unauthorized, 'who are you'),
    );
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });

    await userEvent.type(field, 'https://example.com/a.zip');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    const notices = await screen.findByRole('list', { name: 'Notices' });
    expect(notices).toHaveTextContent('Scia does not recognize this window.');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('https://example.com/a.zip');
  });

  it('says in a notice what the engine refused of links pasted on the page, not in the field', async () => {
    vi.spyOn(api, 'addDownloads').mockRejectedValue(
      new ApiError(400, ApiErrorCode.InvalidRequest, 'not links'),
    );
    render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    await userEvent.click(screen.getByRole('button', { name: /^All/ }));

    await userEvent.paste('https://example.com/a.zip');

    const notices = await screen.findByRole('list', { name: 'Notices' });
    expect(notices).toHaveTextContent('No http or https links in what you pasted.');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('says that the engine is not answering for as long as it is not, with nothing to dismiss', () => {
    live.connection = 'offline';
    const { rerender } = render(<App />);

    const notices = screen.getByRole('list', { name: 'Notices' });
    expect(notices).toHaveTextContent(ENGINE_UNREACHABLE);
    expect(within(notices).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();

    live.connection = 'live';
    rerender(<App />);
    expect(screen.queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();
  });

  it('shows what failed while Settings is open over it, where it can be reached', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiError(500, ApiErrorCode.InternalError, 'it broke'),
    );
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.selectOptions(
      await within(dialog).findByRole('combobox', { name: 'Theme' }),
      'Space',
    );

    const notices = await within(dialog).findByRole('list', { name: 'Notices' });
    expect(notices).toHaveTextContent('Scia could not complete the operation.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).not.toContainElement(screen.getByRole('list', { name: 'Notices' }));
  });

  it('offers "Start all" while there are ready links, and starts them all at one press', async () => {
    const startReady = vi.spyOn(api, 'startReady').mockResolvedValue([]);
    live.downloads = [aDownload({ status: DownloadStatus.Completed })];
    const { rerender } = render(<App />);
    expect(screen.queryByRole('button', { name: 'Start all' })).not.toBeInTheDocument();

    live.downloads = [
      aDownload({ id: 'a', status: DownloadStatus.Ready }),
      aDownload({ id: 'b', status: DownloadStatus.Ready }),
    ];
    rerender(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Start all' }));

    expect(startReady).toHaveBeenCalledOnce();
  });

  it('hands the focus to the filter in use when "Start all" leaves under it', async () => {
    vi.spyOn(api, 'startReady').mockResolvedValue([]);
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    const { rerender } = render(<App />);
    screen.getByRole('button', { name: 'Start all' }).focus();

    await userEvent.keyboard('{Enter}');
    live.downloads = [aDownload({ status: DownloadStatus.Queued })];
    rerender(<App />);

    expect(screen.queryByRole('button', { name: 'Start all' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All/ })).toHaveFocus();
  });

  it('takes no focus when the page opens, and hands it on when ready rows that came later leave', async () => {
    vi.spyOn(api, 'startReady').mockResolvedValue([]);
    live.downloads = [];
    const { rerender } = render(<App />);
    // The field the page opens on keeps it, even when it is let go.
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    expect(field).toHaveFocus();
    field.blur();
    rerender(<App />);
    expect(document.body).toHaveFocus();

    // Ready rows arriving take nothing either.
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    rerender(<App />);
    expect(document.body).toHaveFocus();
    screen.getByRole('button', { name: 'Start all' }).focus();
    await userEvent.keyboard('{Enter}');
    live.downloads = [aDownload({ status: DownloadStatus.Queued })];
    rerender(<App />);

    expect(screen.getByRole('button', { name: /^All/ })).toHaveFocus();
  });

  it('moves no focus that "Start all" did not hold', () => {
    vi.spyOn(api, 'startReady').mockResolvedValue([]);
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    const { rerender } = render(<App />);
    const field = screen.getByRole('textbox', { name: 'Links to download' });
    field.focus();

    // A press that does not take the focus, as some pointers' do.
    fireEvent.click(screen.getByRole('button', { name: 'Start all' }));
    live.downloads = [aDownload({ status: DownloadStatus.Queued })];
    rerender(<App />);

    expect(field).toHaveFocus();
  });

  it('leaves the focus on a row whose Start emptied the ready rows after a refused "Start all"', async () => {
    vi.spyOn(api, 'startReady').mockRejectedValue(new Error('The engine is restarting.'));
    vi.spyOn(api, 'start').mockResolvedValue(aDownload({ status: DownloadStatus.Queued }));
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    const { rerender } = render(<App />);
    screen.getByRole('button', { name: 'Start all' }).focus();
    await userEvent.keyboard('{Enter}');

    screen.getByRole('button', { name: 'Start' }).focus();
    await userEvent.keyboard('{Enter}');
    live.downloads = [aDownload({ status: DownloadStatus.Queued })];
    rerender(<App />);

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
  });

  it('leaves the focus on a row whose Start emptied the ready rows, when a link arrived with "Start all"', async () => {
    vi.spyOn(api, 'startReady').mockResolvedValue([]);
    vi.spyOn(api, 'start').mockResolvedValue(aDownload({ id: 'b', status: DownloadStatus.Queued }));
    live.downloads = [aDownload({ id: 'a', status: DownloadStatus.Ready })];
    const { rerender } = render(<App />);
    screen.getByRole('button', { name: 'Start all' }).focus();
    await userEvent.keyboard('{Enter}');
    // The first row started; a link copied at that moment is ready.
    live.downloads = [
      aDownload({ id: 'a', status: DownloadStatus.Queued, fileName: 'a.mkv' }),
      aDownload({ id: 'b', status: DownloadStatus.Ready, fileName: 'b.mkv' }),
    ];
    rerender(<App />);

    screen.getByRole('button', { name: 'Start' }).focus();
    await userEvent.keyboard('{Enter}');
    live.downloads = [
      aDownload({ id: 'a', status: DownloadStatus.Queued, fileName: 'a.mkv' }),
      aDownload({ id: 'b', status: DownloadStatus.Queued, fileName: 'b.mkv' }),
    ];
    rerender(<App />);

    expect(document.activeElement).toHaveAccessibleName('Pause');
    expect(screen.getByRole('button', { name: /^All/ })).not.toHaveFocus();
  });

  it('starts one ready link from its row', async () => {
    const start = vi
      .spyOn(api, 'start')
      .mockResolvedValue(aDownload({ status: DownloadStatus.Queued }));
    live.downloads = [aDownload({ status: DownloadStatus.Ready })];
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(start).toHaveBeenCalledExactlyOnceWith('d1');
  });

  it('wears the theme the engine keeps, and the one chosen in Settings as soon as it is kept', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, theme: 'brick' });
    vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...settings, theme: 'space' });
    render(<App />);
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('brick');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Theme' }), 'Space');

    await vi.waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('space');
    });
  });

  it('says beside the total speed that a limit is on, as the engine has it', async () => {
    live.downloads = [aDownload({ bytesPerSecond: MIB })];
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, speedLimitBytesPerSecond: MIB });

    render(<App />);

    expect(await screen.findByText(/limit\s1\.0\sMB\/s/)).toBeInTheDocument();
  });

  it('asks for no settings before the engine is reached, and shows the limit once it is', async () => {
    live.connection = 'connecting';
    live.downloads = [aDownload({ bytesPerSecond: MIB })];
    const read = vi
      .spyOn(api, 'settings')
      .mockResolvedValue({ ...settings, speedLimitBytesPerSecond: MIB });
    const { rerender } = render(<App />);
    expect(read).not.toHaveBeenCalled();

    live.connection = 'live';
    rerender(<App />);

    expect(await screen.findByText(/limit\s1\.0\sMB\/s/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledOnce();
  });

  it('reads the settings again when the engine comes back, and follows a limit that changed meanwhile', async () => {
    live.downloads = [aDownload({ bytesPerSecond: MIB })];
    const read = vi
      .spyOn(api, 'settings')
      .mockResolvedValueOnce({ ...settings, speedLimitBytesPerSecond: MIB })
      .mockResolvedValueOnce({ ...settings, speedLimitBytesPerSecond: 5 * MIB });
    const { rerender } = render(<App />);
    expect(await screen.findByText(/limit\s1\.0\sMB\/s/)).toBeInTheDocument();

    live.connection = 'offline';
    rerender(<App />);
    live.connection = 'live';
    rerender(<App />);

    expect(await screen.findByText(/limit\s5\.0\sMB\/s/)).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('learns the limit from Settings when its own read of it failed', async () => {
    live.downloads = [aDownload({ bytesPerSecond: MIB })];
    const read = vi
      .spyOn(api, 'settings')
      .mockRejectedValueOnce(new Error('not this time'))
      .mockResolvedValue({ ...settings, speedLimitBytesPerSecond: MIB });
    render(<App />);
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText(/limit\s/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText(/limit\s1\.0\sMB\/s/)).toBeInTheDocument();
  });

  it('follows a limit set in Settings, and one taken away', async () => {
    live.downloads = [aDownload({ bytesPerSecond: MIB })];
    vi.spyOn(api, 'updateSettings')
      .mockResolvedValueOnce({ ...settings, speedLimitBytesPerSecond: 5 * MIB })
      .mockResolvedValueOnce(settings);
    render(<App />);
    expect(screen.queryByText(/limit/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const limit = await screen.findByRole('combobox', { name: 'Speed limit' });
    await userEvent.selectOptions(limit, String(5 * MIB));
    expect(await screen.findByText(/limit\s5\.0\sMB\/s/)).toBeInTheDocument();

    await userEvent.selectOptions(limit, 'none');
    await vi.waitFor(() => {
      expect(screen.queryByText(/limit\s/)).not.toBeInTheDocument();
    });
  });
});
