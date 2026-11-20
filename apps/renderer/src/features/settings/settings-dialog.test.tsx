import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.ts';
import { SettingsDialog } from './settings-dialog.tsx';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: '/home/me/Downloads',
  speedLimitBytesPerSecond: null,
};
const MIB = 1024 * 1024;

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
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('Simultaneous downloads')).toBeInTheDocument();
    expect(screen.getByText('Connections per download')).toBeInTheDocument();
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.getByText('pairing-code')).toBeInTheDocument();
    expect(screen.getByText(/Paste this code into the extension’s options/)).toBeInTheDocument();
  });

  it('changes the folder through the desktop shell, naming no path itself, and shows what the engine kept', async () => {
    const chooseDownloadFolder = vi.fn(async () => 'changed');
    aShell(chooseDownloadFolder);
    vi.spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, downloadDirectory: '/media/films' });
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(chooseDownloadFolder).toHaveBeenCalledExactlyOnceWith();
    expect(await screen.findByText('/media/films')).toBeInTheDocument();
  });

  it('says so, by the folder, when the engine refused the one that was chosen', async () => {
    aShell(async () => 'refused');
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scia could not use the folder you chose. Choose one it can write to.',
    );
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not blame a folder when main failed before or after the dialog: it says what failed, and reads the folder again', async () => {
    const failure = new Error('Error invoking remote method: the engine said nothing');
    aShell(async () => {
      throw failure;
    });
    const read = vi
      .spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      // The engine may have taken the folder after main stopped waiting for its answer.
      .mockResolvedValueOnce({ ...settings, downloadDirectory: '/media/films' });
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(await screen.findByText('/media/films')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('takes an answer it does not know, and a folder it cannot read again, as failures to report', async () => {
    aShell(async () => 'something else');
    const unread = new Error('the engine is restarting');
    vi.spyOn(api, 'settings').mockResolvedValueOnce(settings).mockRejectedValueOnce(unread);
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(2);
    });
    expect(onError).toHaveBeenLastCalledWith(unread);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
  });

  it('says nothing when the person closed the dialog without choosing', async () => {
    aShell(async () => 'kept');
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));

    expect(await screen.findByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it('forgets a refusal when Settings is closed, and when the folder is asked for again', async () => {
    const chooseDownloadFolder = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce('refused')
      .mockResolvedValueOnce('refused')
      .mockResolvedValueOnce('kept');
    aShell(chooseDownloadFolder);
    const { rerender } = render(
      <SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    rerender(<SettingsDialog open={false} onClose={ignore} onError={ignore} onSettings={ignore} />);
    rerender(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Change folder' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change folder' }));
    await screen.findByText('/home/me/Downloads');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not offer to change the folder where there is no desktop shell to show the dialog', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    expect(await screen.findByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change folder' })).not.toBeInTheDocument();
  });

  it('sets a speed limit from ready values, and takes it away', async () => {
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValueOnce({ ...settings, speedLimitBytesPerSecond: 5 * MIB })
      .mockResolvedValueOnce(settings);
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const limit = await screen.findByRole('combobox', { name: 'Speed limit' });

    expect(
      within(limit)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'No limit',
      '256\u00a0KB/s',
      '512\u00a0KB/s',
      '1.0\u00a0MB/s',
      '2.0\u00a0MB/s',
      '5.0\u00a0MB/s',
      '10.0\u00a0MB/s',
      '25.0\u00a0MB/s',
      '50.0\u00a0MB/s',
    ]);
    expect(limit).toHaveValue('none');

    await userEvent.selectOptions(limit, String(5 * MIB));
    expect(update).toHaveBeenLastCalledWith({ speedLimitBytesPerSecond: 5 * MIB });
    await vi.waitFor(() => {
      expect(limit).toHaveValue(String(5 * MIB));
    });

    await userEvent.selectOptions(limit, 'none');
    expect(update).toHaveBeenLastCalledWith({ speedLimitBytesPerSecond: null });
  });

  it('shows a limit the engine has that is not one of the ready values', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, speedLimitBytesPerSecond: 3 * MIB });
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const limit = await screen.findByRole('combobox', { name: 'Speed limit' });

    expect(limit).toHaveValue(String(3 * MIB));
    expect(within(limit).getByRole('option', { selected: true })).toHaveTextContent(
      /^3\.0\sMB\/s$/,
    );
  });

  it('raises a limit one step at a time and shows what the engine kept', async () => {
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...settings, connectionsPerDownload: 9 });
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const connections = await screen.findByRole('group', { name: 'Connections per download' });

    await userEvent.click(within(connections).getByRole('button', { name: 'Increase' }));

    expect(update).toHaveBeenCalledWith({ connectionsPerDownload: 9 });
    expect(await within(connections).findByText('9')).toBeInTheDocument();
  });

  it('does not offer a step past a limit', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, maxConcurrentDownloads: 1 });
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const simultaneous = await screen.findByRole('group', { name: 'Simultaneous downloads' });

    expect(within(simultaneous).getByRole('button', { name: 'Decrease' })).toBeDisabled();
    expect(within(simultaneous).getByRole('button', { name: 'Increase' })).toBeEnabled();
  });

  it('says so when the pairing code was copied', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    await user.click(await screen.findByRole('button', { name: 'Copy the code' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('reports a failure to load instead of showing empty settings', async () => {
    const failure = new Error('offline');
    vi.spyOn(api, 'settings').mockRejectedValue(failure);
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
    });
    expect(screen.queryByText('Simultaneous downloads')).not.toBeInTheDocument();
  });
});
