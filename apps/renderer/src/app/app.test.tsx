import type { Download } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.tsx';
import { api } from '@/lib/api.ts';
import type * as Live from '@/lib/live.ts';
import { ENGINE_UNREACHABLE } from '@/lib/messages.ts';
import { aDownload } from '@/test/a-download.ts';

const MIB = 1024 * 1024;
const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: '/home/me/Downloads',
  speedLimitBytesPerSecond: null,
};

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
    };
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'Scia could not open the file. It may have been moved or deleted.',
    );
    expect(notice).not.toHaveTextContent(ENGINE_UNREACHABLE);
    expect(openDownload).toHaveBeenCalledWith('d1');
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
