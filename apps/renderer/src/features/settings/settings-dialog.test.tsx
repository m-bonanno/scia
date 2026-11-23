import { settingsPatchSchema } from '@scia/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.ts';
import { SettingsDialog } from './settings-dialog.tsx';

const settings = {
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 8,
  downloadDirectory: '/home/me/Downloads',
  speedLimitBytesPerSecond: null,
  theme: 'black-tie',
  betaUpdates: false,
  watchClipboard: false,
} as const;
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
    vi.spyOn(api, 'integrations').mockResolvedValue([
      { id: 'alldebrid', connected: false, account: null, failure: null, keyNotRead: false },
    ]);
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
      themeChanged: vi.fn(async () => undefined),
      updateOffered: vi.fn(async () => null),
      onUpdateChanged: vi.fn(() => () => undefined),
      restartToUpdate: vi.fn(async () => 'nothing'),
      openCodePage: vi.fn(async () => undefined),
    };
  }

  // The room it keeps under its end, only where the notices would lie over it (#143). jsdom lays
  // nothing out: what the dialog shows is as tall as the spec says, and so is the window.
  describe('the room under the notices', () => {
    let shown = 900;
    let measureAgain: () => void = ignore;
    class Watching implements ResizeObserver {
      readonly #told: ResizeObserverCallback;
      constructor(told: ResizeObserverCallback) {
        this.#told = told;
      }
      observe() {
        measureAgain = () => {
          this.#told([], this);
        };
      }
      unobserve() {
        measureAgain = ignore;
      }
      disconnect() {
        measureAgain = ignore;
      }
    }
    beforeEach(() => {
      shown = 900;
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => shown);
      vi.stubGlobal('innerHeight', 720);
      vi.stubGlobal('ResizeObserver', Watching);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const room = () => screen.getByRole('dialog').style.getPropertyValue('--notices-height');

    it('is what the notices cover of a dialog at its tallest, 38 px short of the window', () => {
      render(
        <SettingsDialog
          open
          onClose={ignore}
          onError={ignore}
          onSettings={ignore}
          noticesHeight={80}
        />,
      );

      // It ends 19 px above the window's bottom, at 701; the notices begin at 640.
      expect(room()).toBe('61px');
    });

    it('is measured again when what it shows grows', () => {
      shown = 300;
      render(
        <SettingsDialog
          open
          onClose={ignore}
          onError={ignore}
          onSettings={ignore}
          noticesHeight={80}
        />,
      );
      expect(room()).toBe('0px');

      shown = 900;
      act(() => {
        measureAgain();
      });

      expect(room()).toBe('61px');
    });

    it('is measured again when the window changes size', () => {
      vi.stubGlobal('innerHeight', 1000);
      shown = 640;
      render(
        <SettingsDialog
          open
          onClose={ignore}
          onError={ignore}
          onSettings={ignore}
          noticesHeight={80}
        />,
      );
      expect(room()).toBe('0px');

      vi.stubGlobal('innerHeight', 720);
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      expect(room()).toBe('61px');
    });
  });

  it('shows the limits and the folder', async () => {
    const onSettings = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('Simultaneous downloads')).toBeInTheDocument();
    expect(screen.getByText('Connections per download')).toBeInTheDocument();
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
    // Whoever opened it learns what was read, not only what is changed here.
    expect(onSettings).toHaveBeenCalledExactlyOnceWith(settings);
  });

  describe('the links of the clipboard', () => {
    it('are not taken until the person turns the switch on, and the engine keeps it', async () => {
      aShell(async () => 'kept');
      const updateSettings = vi
        .spyOn(api, 'updateSettings')
        .mockResolvedValue({ ...settings, watchClipboard: true });
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

      const watch = await screen.findByRole('switch', { name: 'Take links from the clipboard' });
      expect(watch).not.toBeChecked();
      expect(watch).toHaveAccessibleDescription(
        'Links to files and videos you copy appear in the list, ready to start.',
      );

      watch.focus();
      await userEvent.keyboard(' ');

      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ watchClipboard: true });
      expect(
        await screen.findByRole('switch', { name: 'Take links from the clipboard' }),
      ).toBeChecked();
    });

    it('are offered only in the desktop app, which reads the clipboard', async () => {
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
      await screen.findByText('Simultaneous downloads');
      expect(
        screen.queryByRole('switch', { name: 'Take links from the clipboard' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the beta versions', () => {
    it('are off until the person turns them on, and the engine keeps the switch', async () => {
      aShell(async () => 'kept');
      const updateSettings = vi
        .spyOn(api, 'updateSettings')
        .mockResolvedValue({ ...settings, betaUpdates: true });
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

      const betas = await screen.findByRole('switch', { name: 'Beta versions' });
      expect(betas).not.toBeChecked();
      expect(betas).toHaveAccessibleDescription(
        'Also update to versions still being tried. Scia updates itself when you quit it.',
      );

      await userEvent.click(betas);

      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ betaUpdates: true });
      expect(await screen.findByRole('switch', { name: 'Beta versions' })).toBeChecked();
    });

    it('are switched off again with the keyboard', async () => {
      aShell(async () => 'kept');
      vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, betaUpdates: true });
      const updateSettings = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings);
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

      const betas = await screen.findByRole('switch', { name: 'Beta versions' });
      expect(betas).toBeChecked();
      betas.focus();
      await userEvent.keyboard(' ');

      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ betaUpdates: false });
      expect(await screen.findByRole('switch', { name: 'Beta versions' })).not.toBeChecked();
    });

    it('stay as the engine keeps them when it refuses the change, and the refusal is told', async () => {
      aShell(async () => 'kept');
      const refusal = new Error('The engine is restarting.');
      vi.spyOn(api, 'updateSettings').mockRejectedValue(refusal);
      const onError = vi.fn();
      render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

      await userEvent.click(await screen.findByRole('switch', { name: 'Beta versions' }));

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(refusal);
      });
      expect(screen.getByRole('switch', { name: 'Beta versions' })).not.toBeChecked();
    });

    it('are offered only where Scia updates itself', async () => {
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
      await screen.findByText('Simultaneous downloads');
      expect(screen.queryByRole('switch', { name: 'Beta versions' })).not.toBeInTheDocument();
    });

    it('are not offered on a system whose releases carry no installer', async () => {
      aShell(async () => 'kept');
      window.scia = { ...window.scia!, platform: 'linux' };
      render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
      await screen.findByText('Simultaneous downloads');
      expect(screen.queryByRole('switch', { name: 'Beta versions' })).not.toBeInTheDocument();
    });
  });

  it('lists the services Scia connects to, after the settings', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    const integrations = await screen.findByRole('region', { name: 'Integrations' });
    expect(within(integrations).getByText('AllDebrid')).toBeInTheDocument();
    const folder = screen.getByText('Download folder');
    expect(folder.compareDocumentPosition(integrations)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('changes the folder through the desktop shell, naming no path itself, and shows what the engine kept', async () => {
    const chooseDownloadFolder = vi.fn(async () => 'changed');
    aShell(chooseDownloadFolder);
    vi.spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, downloadDirectory: '/media/films' });
    const onSettings = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));

    expect(chooseDownloadFolder).toHaveBeenCalledExactlyOnceWith();
    expect(await screen.findByText('/media/films')).toBeInTheDocument();
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, downloadDirectory: '/media/films' });
  });

  // The owner, #40: a button in words, like the others of Settings, not an icon whose words are
  // only a tooltip. Its one word is told what it changes by the setting it sits beside.
  it('offers to change the folder in words, described by the folder it changes', async () => {
    aShell(async () => 'kept');
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    const change = await screen.findByRole('button', { name: 'Change…' });

    expect(change).toHaveTextContent(/^Change…$/);
    expect(change).not.toHaveAttribute('title');
    expect(change).toHaveAccessibleDescription('Download folder /home/me/Downloads');
  });

  // #40: a path cut at its end hid the name just chosen. Written right to left, the box cuts its
  // start; the path inside it keeps its own order. That the name shows is read in the built app
  // (`apps/desktop/e2e/settings.e2e.test.ts`): jsdom lays nothing out.
  it('cuts a long path at its start, so that the folder’s own name shows', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    const path = await screen.findByText('/home/me/Downloads');

    expect(path).toHaveAttribute('dir', 'ltr');
    expect(path.closest('output')).toHaveAttribute('dir', 'rtl');
    // The tooltip takes the direction of what carries the title: the path's own, left to right,
    // or its neutral ends — `D:\`, a leading `/` — would move to the other end (round 1 of #278).
    expect(path).toHaveAttribute('title', '/home/me/Downloads');
    expect(path.closest('output')).not.toHaveAttribute('title');
  });

  it('says so, by the folder, when the engine refused the one that was chosen', async () => {
    aShell(async () => 'refused');
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scia could not use the folder you chose. Choose one it can write to.',
    );
    expect(screen.getByText('/home/me/Downloads')).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  // A message that belongs to a control describes it (`apps/renderer/CLAUDE.md`, "Behaviour"): an
  // alert is said once, and whoever comes back to "Change…" hears the refusal with the folder.
  it('describes Change… by the refusal while the folder is refused, and no longer once it is chosen again', async () => {
    const chooseDownloadFolder = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce('refused')
      .mockResolvedValueOnce('kept');
    aShell(chooseDownloadFolder);
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const change = await screen.findByRole('button', { name: 'Change…' });

    await userEvent.click(change);
    await screen.findByRole('alert');

    expect(change).toHaveAccessibleDescription(
      'Download folder /home/me/Downloads Scia could not use the folder you chose. Choose one it can write to.',
    );

    await userEvent.click(change);
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    expect(change).toHaveAccessibleDescription('Download folder /home/me/Downloads');
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

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));

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

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));

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

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));

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

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    rerender(<SettingsDialog open={false} onClose={ignore} onError={ignore} onSettings={ignore} />);
    rerender(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Change…' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await screen.findByText('/home/me/Downloads');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not offer to change the folder where there is no desktop shell to show the dialog', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);

    expect(await screen.findByText('/home/me/Downloads')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change…' })).not.toBeInTheDocument();
  });

  it('offers the nine themes by name, the default one first, and keeps the one chosen', async () => {
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...settings, theme: 'ice' });
    const onSettings = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />);
    const theme = await screen.findByRole('combobox', { name: 'Theme' });

    expect(
      within(theme)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Black Tie',
      'Brick',
      'Road Trip',
      'Earth',
      'Bookstore',
      'New Car',
      'Wood Floor',
      'Ice',
      'Space',
    ]);
    expect(theme).toHaveValue('black-tie');
    // Who chooses the variant is said nowhere else: the menu carries it as its description.
    expect(theme).toHaveAccessibleDescription('Light or dark, as your system is.');
    expect(screen.getByRole('combobox', { name: 'Speed limit' })).toHaveAccessibleDescription(
      'For all downloads together.',
    );

    await userEvent.selectOptions(theme, 'Ice');

    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: 'ice' });
    expect(settingsPatchSchema.safeParse(update.mock.calls[0]![0]).success).toBe(true);
    await vi.waitFor(() => {
      expect(theme).toHaveValue('ice');
    });
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, theme: 'ice' });
  });

  it('keeps a change over a read that was asked before it and answers after it', async () => {
    let answerLate: (read: typeof settings) => void = ignore;
    vi.spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerLate = resolve;
        }),
      );
    vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...settings, theme: 'ice' });
    const onSettings = vi.fn();
    const { rerender } = render(
      <SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />,
    );
    const theme = await screen.findByRole('combobox', { name: 'Theme' });
    // Settings stays mounted: opened again, it shows what it knew while it reads anew.
    rerender(
      <SettingsDialog open={false} onClose={ignore} onError={ignore} onSettings={onSettings} />,
    );
    rerender(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />);

    await userEvent.selectOptions(theme, 'Ice');
    await vi.waitFor(() => {
      expect(theme).toHaveValue('ice');
    });
    answerLate(settings);
    await Promise.resolve();
    await Promise.resolve();

    expect(theme).toHaveValue('ice');
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, theme: 'ice' });
  });

  it('keeps a change over the read made after a folder was chosen, when that read answers after it', async () => {
    aShell(async () => 'changed');
    let answerLate: (read: typeof settings) => void = ignore;
    const read = vi
      .spyOn(api, 'settings')
      .mockResolvedValueOnce(settings)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerLate = resolve;
        }),
      );
    vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...settings, theme: 'ice' });
    const onSettings = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={onSettings} />);
    const theme = await screen.findByRole('combobox', { name: 'Theme' });

    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    });
    await userEvent.selectOptions(theme, 'Ice');
    await vi.waitFor(() => {
      expect(theme).toHaveValue('ice');
    });
    answerLate(settings);
    await Promise.resolve();
    await Promise.resolve();

    expect(theme).toHaveValue('ice');
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, theme: 'ice' });
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

  it('keeps showing what the engine has when a change of the limit fails, and reports it', async () => {
    const failure = new Error('refused');
    vi.spyOn(api, 'updateSettings').mockRejectedValue(failure);
    const onError = vi.fn();
    render(<SettingsDialog open onClose={ignore} onError={onError} onSettings={ignore} />);
    const limit = await screen.findByRole('combobox', { name: 'Speed limit' });

    await userEvent.selectOptions(limit, String(5 * MIB));

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    });
    expect(limit).toHaveValue('none');
  });

  it('offers no limit the engine would refuse', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    const limit = await screen.findByRole('combobox', { name: 'Speed limit' });

    const offered = within(limit)
      .getAllByRole<HTMLOptionElement>('option')
      .map((option) => (option.value === 'none' ? null : Number(option.value)));

    expect(offered).toHaveLength(9);
    for (const speedLimitBytesPerSecond of offered) {
      expect(
        settingsPatchSchema.safeParse({ speedLimitBytesPerSecond }).success,
        String(speedLimitBytesPerSecond),
      ).toBe(true);
    }
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

  // The extension is not published: a code to paste into it asks for a step nobody can take (the
  // owner, #152). The engine keeps the code; the section comes back with the extension.
  it('offers no code for a browser extension that cannot be installed yet', async () => {
    render(<SettingsDialog open onClose={ignore} onError={ignore} onSettings={ignore} />);
    await screen.findByText('Simultaneous downloads');

    expect(screen.queryByText(/extension/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the code' })).not.toBeInTheDocument();
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
