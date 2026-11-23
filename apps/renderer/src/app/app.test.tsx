import { ApiErrorCode, type Bundle, type Download, type Magnet } from '@scia/contracts';
import { DownloadStatus } from '@scia/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
const live = vi.hoisted(
  (): {
    connection: Live.Connection;
    downloads: Download[];
    magnets: Magnet[];
    bundles: Bundle[];
  } => ({
    connection: 'live',
    downloads: [],
    magnets: [],
    bundles: [],
  }),
);
vi.mock('@/lib/live.ts', async (original) => ({
  ...(await original<typeof Live>()),
  useLive: () => ({
    connection: live.connection,
    downloads: live.downloads,
    magnets: live.magnets,
    bundles: live.bundles,
  }),
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
  live.downloads = [];
  live.magnets = [];
  live.bundles = [];
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(false)]);
});

function alldebrid(connected: boolean) {
  return { id: 'alldebrid' as const, connected, account: null, failure: null, keyNotRead: false };
}
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
      updateOffered: vi.fn(async () => null),
      onUpdateChanged: vi.fn(() => () => undefined),
      restartToUpdate: vi.fn(async () => 'nothing'),
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
      updateOffered: vi.fn(async () => null),
      onUpdateChanged: vi.fn(() => () => undefined),
      restartToUpdate: vi.fn(async () => 'nothing'),
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

    // With the keyboard: a press of the pointer hands the focus to nothing (the owner, #143).
    const dismisses = within(notices).getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      dismisses.at(-1)?.focus();
    });
    for (const _ of dismisses) await userEvent.keyboard('{Enter}');

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

  // WCAG 2.2, 2.4.11 (#143): Chromium scrolls a control Tab moves to clear of the scroll padding
  // under the notices, but not one the page focuses itself while it is already in the scrollport.
  describe('scrolls what takes the focus clear of the notices', () => {
    // The stack measured as a browser would, 80 high; jsdom has neither layout nor scrolling.
    class Measured implements ResizeObserver {
      readonly #told: ResizeObserverCallback;
      constructor(told: ResizeObserverCallback) {
        this.#told = told;
      }
      observe(target: Element) {
        const entry = { target, borderBoxSize: [{ blockSize: 80, inlineSize: 0 }] };
        this.#told([entry as unknown as ResizeObserverEntry], this);
      }
      unobserve() {
        // Nothing is watched after it was measured.
      }
      disconnect() {
        // Nothing is watched after it was measured.
      }
    }
    const scrolled = vi.fn<(this: Element, options?: ScrollIntoViewOptions) => void>();
    beforeEach(() => {
      vi.stubGlobal('ResizeObserver', Measured);
      scrolled.mockReset();
      Element.prototype.scrollIntoView = scrolled;
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    });

    async function aNotice() {
      vi.spyOn(api, 'addDownloads').mockRejectedValue(
        new ApiError(401, ApiErrorCode.Unauthorized, 'who are you'),
      );
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Links to download' }),
        'https://example.com/a.zip',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      await screen.findByRole('list', { name: 'Notices' });
      scrolled.mockClear();
    }

    it('when the page moves the focus itself', async () => {
      render(<App />);
      await aNotice();
      const settings = screen.getByRole('button', { name: 'Settings' });

      act(() => {
        settings.focus();
      });

      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled.mock.contexts).toContain(settings);
    });

    it('when Tab moves it', async () => {
      render(<App />);
      await aNotice();

      await userEvent.tab();

      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled.mock.contexts).toContain(document.activeElement);
    });

    // Chromium focuses a button at the pointer's press: moved before it is let go, the button is
    // no longer under the pointer, and the click is lost (the tech lead, round 2 of #244).
    it('but not the focus a press of the pointer gives', async () => {
      render(<App />);
      await aNotice();
      const settings = screen.getByRole('button', { name: 'Settings' });

      await userEvent.click(settings);

      expect(scrolled.mock.contexts).not.toContain(settings);
    });

    // A finger's tap: Chromium sends pointerdown and pointerup as it lands and lifts, and the
    // tap's mousedown, which gives the focus, in a later task (the frontend, round 3 of #244).
    it('nor the focus a tap gives, after its pointer events', async () => {
      render(<App />);
      await aNotice();
      const settings = screen.getByRole('button', { name: 'Settings' });

      fireEvent.pointerDown(settings, { pointerType: 'touch' });
      fireEvent.pointerUp(settings, { pointerType: 'touch' });
      await new Promise((later) => setTimeout(later, 0));
      fireEvent.mouseDown(settings);
      act(() => {
        settings.focus();
      });

      expect(scrolled.mock.contexts).not.toContain(settings);
    });

    it('and still when the page moves it after a press of the pointer', async () => {
      render(<App />);
      await aNotice();
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      scrolled.mockClear();
      const field = screen.getByRole('textbox', { name: 'Links to download' });

      act(() => {
        field.focus();
      });

      expect(scrolled.mock.contexts).toContain(field);
    });

    it('and leaves it alone while no notice is shown', async () => {
      render(<App />);
      await screen.findByRole('button', { name: 'Settings' });

      act(() => {
        screen.getByRole('button', { name: 'Settings' }).focus();
      });

      expect(scrolled).not.toHaveBeenCalled();
    });
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
  describe('magnets', () => {
    const MAGNET = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=films`;
    const magnet: Magnet = {
      id: 'm1',
      name: 'Holiday films',
      status: 'fetching',
      totalBytes: 400,
      downloadedBytes: 100,
      bytesPerSecond: 0,
      failure: null,
      createdAt: '2026-11-21T12:00:00.000Z',
    };

    it('sends the magnets of a text pasted on the page to the service, and its links as downloads', async () => {
      const links = vi.spyOn(api, 'addDownloads').mockResolvedValue([]);
      const magnets = vi.spyOn(api, 'addMagnets').mockResolvedValue([]);
      render(<App />);
      await userEvent.click(screen.getByRole('button', { name: /^All/ }));

      await userEvent.paste(`https://example.com/a.zip and ${MAGNET}`);

      await vi.waitFor(() => {
        expect(magnets).toHaveBeenCalledExactlyOnceWith([MAGNET]);
      });
      expect(links).toHaveBeenCalledExactlyOnceWith(['https://example.com/a.zip']);
    });

    it('counts on its button what the field sends: files, or links with a magnet among them', async () => {
      render(<App />);
      const field = screen.getByRole('textbox', { name: 'Links to download' });
      await userEvent.click(field);

      await userEvent.paste('https://example.com/a.zip https://example.com/b.zip');
      expect(screen.getByRole('button', { name: 'Download 2 files' })).toBeInTheDocument();
      await userEvent.paste(` ${MAGNET}`);
      expect(screen.getByRole('button', { name: 'Download 3 links' })).toBeInTheDocument();
    });

    it('sends a magnet typed in the field, and asks the engine for no download', async () => {
      const links = vi.spyOn(api, 'addDownloads').mockResolvedValue([]);
      const magnets = vi.spyOn(api, 'addMagnets').mockResolvedValue([]);
      render(<App />);
      const field = screen.getByRole('textbox', { name: 'Links to download' });

      await userEvent.click(field);
      await userEvent.paste(MAGNET);
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));

      expect(magnets).toHaveBeenCalledExactlyOnceWith([MAGNET]);
      expect(links).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(field).toHaveValue('');
      });
    });

    it('lists the magnets the service is fetching above the downloads, not among the completed', async () => {
      live.magnets = [magnet];
      live.downloads = [aDownload({ status: DownloadStatus.Completed })];
      render(<App />);

      const rows = screen.getAllByRole('listitem');
      expect(within(rows[0] ?? document.body).getByText('Holiday films')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /^Completed/ }));
      expect(screen.queryByText('Holiday films')).not.toBeInTheDocument();
    });

    it('lists the newest magnet first, as the downloads below it', () => {
      live.magnets = [
        magnet,
        { ...magnet, id: 'm2', name: 'Concert', createdAt: '2026-11-21T12:05:00.000Z' },
      ];
      render(<App />);

      const rows = screen.getAllByRole('listitem');
      expect(within(rows[0] ?? document.body).getByText('Concert')).toBeInTheDocument();
      expect(within(rows[1] ?? document.body).getByText('Holiday films')).toBeInTheDocument();
    });

    it('stops waiting for a magnet at its Remove, and tries one that failed again at its Retry', async () => {
      live.magnets = [{ ...magnet, status: 'failed', failure: 'MAGNET_FAILED' }];
      const remove = vi.spyOn(api, 'removeMagnet').mockResolvedValue();
      const retry = vi.spyOn(api, 'retryMagnet').mockResolvedValue(magnet);
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

      expect(retry).toHaveBeenCalledExactlyOnceWith('m1');
      expect(remove).toHaveBeenCalledExactlyOnceWith('m1');
    });

    it('takes the half of the field the engine took, and keeps only the half it refused', async () => {
      vi.spyOn(api, 'addDownloads').mockRejectedValue(new TypeError('Failed to fetch'));
      const magnets = vi.spyOn(api, 'addMagnets').mockResolvedValue([]);
      render(<App />);
      const field = screen.getByRole('textbox', { name: 'Links to download' });

      await userEvent.click(field);
      await userEvent.paste(`https://example.com/a.zip ${MAGNET}`);
      await userEvent.click(screen.getByRole('button', { name: 'Download 2 links' }));

      await vi.waitFor(() => {
        expect(field).toHaveValue('https://example.com/a.zip');
      });
      expect(magnets).toHaveBeenCalledExactlyOnceWith([MAGNET]);
      expect(screen.getByRole('list', { name: 'Notices' })).toHaveTextContent(ENGINE_UNREACHABLE);
    });

    it('keeps the whole field when nothing of it was taken', async () => {
      vi.spyOn(api, 'addDownloads').mockRejectedValue(new TypeError('Failed to fetch'));
      vi.spyOn(api, 'addMagnets').mockRejectedValue(new TypeError('Failed to fetch'));
      render(<App />);
      const field = screen.getByRole('textbox', { name: 'Links to download' });
      const typed = `https://example.com/a.zip ${MAGNET}`;

      await userEvent.click(field);
      await userEvent.paste(typed);
      await userEvent.click(screen.getByRole('button', { name: 'Download 2 links' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('list', { name: 'Notices' })).toHaveTextContent(ENGINE_UNREACHABLE);
      });
      expect(field).toHaveValue(typed);
    });

    it('counts a magnet the service is fetching among the downloads in progress', () => {
      live.magnets = [magnet];
      render(<App />);

      expect(screen.getByRole('button', { name: /^In progress/ })).toHaveTextContent(/1$/);
      expect(screen.getByRole('button', { name: /^Completed/ })).toHaveTextContent(/0$/);
    });

    it("says in a magnet's words that one changed before its Retry or Remove reached the engine", async () => {
      live.magnets = [{ ...magnet, status: 'failed', failure: 'MAGNET_FAILED' }];
      vi.spyOn(api, 'retryMagnet').mockRejectedValue(
        new ApiError(409, ApiErrorCode.Conflict, 'not failed'),
      );
      vi.spyOn(api, 'removeMagnet').mockRejectedValue(
        new ApiError(404, ApiErrorCode.NotFound, 'no magnet'),
      );
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

      const notices = await screen.findByRole('list', { name: 'Notices' });
      await vi.waitFor(() => {
        expect(notices).toHaveTextContent('This magnet is no longer in the list.');
      });
      expect(notices).toHaveTextContent('This magnet is already being sent again.');
    });
  });

  describe('links that open into several files (#181)', () => {
    const bundle: Bundle = {
      id: 'b1',
      name: 'Holiday films',
      status: 'choosing',
      failure: null,
      files: [
        { name: 'Day 1.mkv', size: 1024 },
        { name: 'Day 2.mkv', size: 2048 },
      ],
      unavailable: 0,
      createdAt: '2026-11-23T12:00:00.000Z',
    };

    it('lists such a link above the magnets and the downloads, newest first, not among the completed, and counts it in progress', async () => {
      live.bundles = [
        bundle,
        { ...bundle, id: 'b2', name: 'Concert', createdAt: '2026-11-23T12:05:00.000Z' },
      ];
      live.magnets = [
        {
          id: 'm1',
          name: 'A magnet',
          status: 'fetching',
          totalBytes: null,
          downloadedBytes: 0,
          bytesPerSecond: 0,
          failure: null,
          createdAt: '2026-11-23T12:10:00.000Z',
        },
      ];
      render(<App />);

      const rows = screen.getAllByRole('listitem');
      expect(within(rows[0] ?? document.body).getByText('Concert')).toBeInTheDocument();
      expect(within(rows[1] ?? document.body).getByText('Holiday films')).toBeInTheDocument();
      expect(within(rows[2] ?? document.body).getByText('A magnet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^In progress/ })).toHaveTextContent(/3$/);
      await userEvent.click(screen.getByRole('button', { name: /^Completed/ }));
      expect(screen.queryByText('Holiday films')).not.toBeInTheDocument();
    });

    it('starts the files left ticked at Download, and the engine is told which', async () => {
      live.bundles = [bundle];
      const start = vi.spyOn(api, 'startBundle').mockResolvedValue([]);
      render(<App />);

      await userEvent.click(screen.getByRole('checkbox', { name: /Day 1\.mkv/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Download 1 file' }));

      expect(start).toHaveBeenCalledExactlyOnceWith('b1', [1]);
    });

    it('hands the focus to the filter in use when the row leaves under Download', async () => {
      live.bundles = [bundle];
      vi.spyOn(api, 'startBundle').mockResolvedValue([]);
      const { rerender } = render(<App />);
      screen.getByRole('button', { name: 'Download 2 files' }).focus();

      await userEvent.keyboard('{Enter}');
      live.bundles = [];
      rerender(<App />);

      expect(screen.getByRole('button', { name: /^All/ })).toHaveFocus();
    });

    it('asks again at Retry and forgets it at Remove, and says in its words that it moved on meanwhile', async () => {
      live.bundles = [{ ...bundle, status: 'failed', failure: 'BUNDLE_EMPTY', files: [] }];
      const retry = vi
        .spyOn(api, 'retryBundle')
        .mockRejectedValue(new ApiError(409, ApiErrorCode.Conflict, 'not failed'));
      const remove = vi
        .spyOn(api, 'removeBundle')
        .mockRejectedValue(new ApiError(404, ApiErrorCode.NotFound, 'none'));
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

      expect(retry).toHaveBeenCalledExactlyOnceWith('b1');
      expect(remove).toHaveBeenCalledExactlyOnceWith('b1');
      const notices = await screen.findByRole('list', { name: 'Notices' });
      await vi.waitFor(() => {
        expect(notices).toHaveTextContent('This link is no longer in the list.');
      });
      expect(notices).toHaveTextContent('This link is already being opened again.');
    });
  });

  describe('the magnets of the account (#138)', () => {
    beforeEach(() => {
      vi.spyOn(api, 'accountMagnets').mockResolvedValue([]);
    });
    const toggle = () => screen.queryByRole('button', { name: 'AllDebrid magnets' });

    it('offers them only while AllDebrid is connected, in a panel closed at first', async () => {
      vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(true)]);
      render(<App />);

      await vi.waitFor(() => {
        expect(toggle()).toBeInTheDocument();
      });
      expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(api.accountMagnets).not.toHaveBeenCalled();
    });

    it('offers nothing while AllDebrid is not connected', async () => {
      render(<App />);

      await vi.waitFor(() => {
        expect(api.integrations).toHaveBeenCalled();
      });
      expect(toggle()).not.toBeInTheDocument();
    });

    it('opens the panel at its button, and closes it there or at Escape, the focus back on the button', async () => {
      vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(true)]);
      render(<App />);
      const button = await vi.waitFor(() => toggle() ?? Promise.reject(new Error('no button')));

      await userEvent.click(button);
      const panel = screen.getByRole('complementary', { name: 'AllDebrid magnets' });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', panel.id);
      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      await userEvent.click(button);
      await userEvent.click(button);
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('learns again whether AllDebrid is connected when Settings closes, and folds the panel away when it is not', async () => {
      const integrations = vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(false)]);
      render(<App />);
      await vi.waitFor(() => {
        expect(integrations).toHaveBeenCalled();
      });

      integrations.mockResolvedValue([alldebrid(true)]);
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('button', {
          name: 'Close',
        }),
      );
      const button = await vi.waitFor(() => toggle() ?? Promise.reject(new Error('no button')));
      await userEvent.click(button);
      expect(screen.getByRole('complementary')).toBeInTheDocument();

      integrations.mockResolvedValue([alldebrid(false)]);
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('button', {
          name: 'Close',
        }),
      );
      await vi.waitFor(() => {
        expect(toggle()).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

      // Connected again: the panel is closed, as at first.
      integrations.mockResolvedValue([alldebrid(true)]);
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('button', {
          name: 'Close',
        }),
      );
      await vi.waitFor(() => {
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
      });
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('opens the panel once, and closes it once, however long Enter is held', async () => {
      vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(true)]);
      render(<App />);
      const button = await vi.waitFor(() => toggle() ?? Promise.reject(new Error('no button')));

      button.focus();
      await userEvent.keyboard('{Enter>4/}');
      const panel = screen.getByRole('complementary', { name: 'AllDebrid magnets' });
      expect(button).toHaveAttribute('aria-expanded', 'true');

      within(panel).getByRole('button', { name: 'Close' }).focus();
      await userEvent.keyboard('{Enter>4/}');

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();

      // Closed at its own button, which keeps the focus: the repeats do not open it again.
      await userEvent.click(button);
      button.focus();
      await userEvent.keyboard('{Enter>4/}');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('asks the account again when Settings closes, also after a refused key', async () => {
      vi.spyOn(api, 'integrations').mockResolvedValue([alldebrid(true)]);
      const asked = vi
        .spyOn(api, 'accountMagnets')
        .mockRejectedValue(new ApiError(422, ApiErrorCode.KeyRefused, 'refused'));
      render(<App />);
      await userEvent.click(await vi.waitFor(() => toggle() ?? Promise.reject(new Error('none'))));
      await vi.waitFor(() => {
        expect(asked).toHaveBeenCalledTimes(1);
      });

      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('button', {
          name: 'Close',
        }),
      );

      await vi.waitFor(() => {
        expect(asked).toHaveBeenCalledTimes(2);
      });
    });

    it('keeps what the last ask learned, not an older answer that came after it', async () => {
      let late: (integrations: ReturnType<typeof alldebrid>[]) => void = () => undefined;
      const integrations = vi.spyOn(api, 'integrations').mockReturnValueOnce(
        new Promise((resolve) => {
          late = resolve;
        }),
      );
      render(<App />);
      await vi.waitFor(() => {
        expect(integrations).toHaveBeenCalledOnce();
      });

      // Disconnected in Settings while the first ask was on its way.
      integrations.mockResolvedValue([alldebrid(false)]);
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('button', {
          name: 'Close',
        }),
      );
      // Asked by Settings as it opened, and by the page once it closed.
      await vi.waitFor(() => {
        expect(integrations.mock.calls.length).toBeGreaterThanOrEqual(3);
      });
      await act(async () => {
        late([alldebrid(true)]);
        await Promise.resolve();
      });

      expect(toggle()).not.toBeInTheDocument();
    });
  });
});

describe('App, its version and an update', () => {
  beforeEach(() => {
    live.downloads = [];
  });

  function aShell(overrides: Partial<NonNullable<typeof window.scia>> = {}) {
    let changed: () => void = () => undefined;
    const shell = {
      apiToken: 'token',
      version: '1.0.0-beta.17',
      platform: 'win32',
      revealDownload: vi.fn(async () => undefined),
      openDownload: vi.fn(async () => undefined),
      chooseDownloadFolder: vi.fn(async () => 'kept'),
      themeChanged: vi.fn(async () => undefined),
      updateOffered: vi.fn(async (): Promise<unknown> => null),
      onUpdateChanged: vi.fn((listener: () => void) => {
        changed = listener;
        return () => undefined;
      }),
      restartToUpdate: vi.fn(async (): Promise<unknown> => 'restarting'),
      openCodePage: vi.fn(async () => undefined),
      ...overrides,
    };
    window.scia = shell;
    return {
      shell,
      change: () => {
        changed();
      },
    };
  }

  it('says beside the name the version Scia is', () => {
    aShell();
    render(<App />);

    expect(within(screen.getByRole('banner')).getByText('1.0.0-beta.17')).toBeInTheDocument();
  });

  it('offers the update main says a quit would install, and asks again when main says it changed', async () => {
    const offered = vi.fn(async (): Promise<unknown> => null);
    const { change } = aShell({ updateOffered: offered });
    render(<App />);
    await vi.waitFor(() => {
      expect(offered).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: /^Update to/ })).not.toBeInTheDocument();

    offered.mockResolvedValue('1.0.0-beta.18');
    change();

    expect(await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' })).toBeVisible();
  });

  it('asks again what is offered once it learns the settings: a beta goes with its switch', async () => {
    const offered = vi.fn(async (): Promise<unknown> => '1.0.0-beta.18');
    aShell({ updateOffered: offered });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' })).toBeVisible();

    offered.mockResolvedValue(null);
    vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...settings, betaUpdates: false });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await vi.waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Update to 1.0.0-beta.18' }),
      ).not.toBeInTheDocument();
    });
  });

  it('keeps what main answered last, whichever answer comes back first', async () => {
    const answers: ((answer: unknown) => void)[] = [];
    const offered = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          answers.push(resolve);
        }),
    );
    const { change } = aShell({ updateOffered: offered });
    render(<App />);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    const before = answers.length;
    change();
    await vi.waitFor(() => {
      expect(answers.length).toBeGreaterThan(before);
    });

    // The last ask is answered first; every earlier one after it, with a version.
    answers.at(-1)?.(null);
    for (const answer of answers.slice(0, -1)) answer('1.0.0-beta.18');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: /^Update to/ })).not.toBeInTheDocument();
  });

  it('hands the focus to the field when the offer leaves under it', async () => {
    const offered = vi.fn(async (): Promise<unknown> => '1.0.0-beta.18');
    const { change } = aShell({ updateOffered: offered });
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' });
    button.focus();

    offered.mockResolvedValue(null);
    change();

    await vi.waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();
    });
  });

  it('stops listening to main when the page goes', () => {
    const stop = vi.fn();
    aShell({ onUpdateChanged: vi.fn(() => stop) });
    const { unmount } = render(<App />);

    unmount();

    expect(stop).toHaveBeenCalledOnce();
  });

  it('asks main to restart when the person says so', async () => {
    const { shell } = aShell({ updateOffered: vi.fn(async () => '1.0.0-beta.18') });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(shell.restartToUpdate).toHaveBeenCalledOnce();
  });

  it('says the update waits for the quit while a download runs', async () => {
    live.downloads = [aDownload({ status: DownloadStatus.Downloading })];
    const { shell } = aShell({ updateOffered: vi.fn(async () => '1.0.0-beta.18') });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Scia is downloading.');
    expect(shell.restartToUpdate).not.toHaveBeenCalled();
  });

  it.each([{ version: '9' }, '', 18])(
    'offers nothing for an answer of main that is not a version: %j',
    async (notAVersion) => {
      const offered = vi.fn(async (): Promise<unknown> => '1.0.0-beta.18');
      const { change } = aShell({ updateOffered: offered });
      render(<App />);
      expect(await screen.findByRole('button', { name: 'Update to 1.0.0-beta.18' })).toBeVisible();

      offered.mockResolvedValue(notAVersion);
      change();

      await vi.waitFor(() => {
        expect(screen.queryByRole('button', { name: /^Update to/ })).not.toBeInTheDocument();
      });
      expect(within(screen.getByRole('banner')).getByText('1.0.0-beta.17')).toBeVisible();
    },
  );
});
