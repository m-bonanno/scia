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

const live = vi.hoisted(() => ({ downloads: [] as Download[] }));
vi.mock('@/lib/live.ts', async (original) => ({
  ...(await original<typeof Live>()),
  useLive: () => ({ connection: 'live', downloads: live.downloads }),
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
