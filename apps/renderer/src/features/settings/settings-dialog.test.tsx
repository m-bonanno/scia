import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.ts';
import { SettingsDialog } from './settings-dialog.tsx';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: '/home/me/Downloads',
};

const ignore = () => undefined;

describe('SettingsDialog', () => {
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

  function aShell(chooseDownloadFolder: () => Promise<unknown>) {
    window.scia = {
      apiToken: 'token',
      version: '1.0.0',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload: vi.fn(async () => undefined),
      chooseDownloadFolder,
    };
  }

  it('shows the limits, the folder and how to pair the extension', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('Simultaneous downloads')).toBeInTheDocument();
    expect(screen.getByText('Connections per download')).toBeInTheDocument();
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.getByText('pairing-code')).toBeInTheDocument();
    expect(screen.getByText(/Paste this code into the extension’s options/)).toBeInTheDocument();
  });

  it('changes the folder through the desktop shell, naming no path itself, and shows what the engine kept', async () => {
    const chooseDownloadFolder = vi.fn(async () => true);
    aShell(chooseDownloadFolder);
    vi.spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, downloadDirectory: '/media/films' });
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(chooseDownloadFolder).toHaveBeenCalledExactlyOnceWith();
    expect(await screen.findByText('/media/films')).toBeInTheDocument();
  });

  it('says so, by the folder, when it could not be changed', async () => {
    aShell(async () => {
      throw new Error('Error invoking remote method: the engine refused the folder');
    });
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scia could not use that folder. Choose one it can write to.',
    );
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
  });

  it('does not offer to change the folder where there is no desktop shell to show the dialog', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);

    expect(await screen.findByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change folder' })).not.toBeInTheDocument();
  });

  it('raises a limit one step at a time and shows what the engine kept', async () => {
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...settings, connectionsPerDownload: 9 });
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);
    const connections = await screen.findByRole('group', { name: 'Connections per download' });

    await userEvent.click(within(connections).getByRole('button', { name: 'Increase' }));

    expect(update).toHaveBeenCalledWith({ connectionsPerDownload: 9 });
    expect(await within(connections).findByText('9')).toBeInTheDocument();
  });

  it('does not offer a step past a limit', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, maxConcurrentDownloads: 1 });
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);
    const simultaneous = await screen.findByRole('group', { name: 'Simultaneous downloads' });

    expect(within(simultaneous).getByRole('button', { name: 'Decrease' })).toBeDisabled();
    expect(within(simultaneous).getByRole('button', { name: 'Increase' })).toBeEnabled();
  });

  it('says so when the pairing code was copied', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={ignore} onError={ignore} />);

    await user.click(await screen.findByRole('button', { name: 'Copy the code' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('reports a failure to load instead of showing empty settings', async () => {
    const failure = new Error('offline');
    vi.spyOn(api, 'settings').mockRejectedValue(failure);
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} />);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
    });
    expect(screen.queryByText('Simultaneous downloads')).not.toBeInTheDocument();
  });
});
