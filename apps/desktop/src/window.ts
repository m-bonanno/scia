import { join } from 'node:path';
import { ColourScheme, type Theme, WINDOW_COLOURS } from '@scia/contracts/theme';
import { BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, nativeTheme } from 'electron';
import { guardPermissions } from './engine/page-permissions.ts';
import type { SessionEndReason } from './engine/quit.ts';
import { startingPage } from './engine/starting-page.ts';
import { hasIntegratedTitleBar, titleBarOverlay, windowFrameOptions } from './engine/title-bar.ts';
import { windowIconFile } from './engine/window-icon.ts';
import { isInFront, isPutAway, type WindowState } from './engine/window-state.ts';
import { windowInUse } from './engine/foreground.ts';
import { foregroundWindow, handleOf } from './foreground-window.ts';

export interface WindowLog {
  warn(message: string, details: object): void;
}

export interface MainWindowOptions {
  readonly apiToken: string;
  readonly version: string;
  readonly platform: string;
  // Developer tools only where there is a developer.
  readonly devTools: boolean;
  readonly log: WindowLog;
  // The theme it starts in, before the engine can say which the person chose.
  readonly theme: Theme;
  // The person closed the window: main decides whether Scia hides or quits.
  readonly onCloseRequested: () => void;
  // Windows ends the session — a shutdown, a sign-out, an installer that needs Scia's files. It
  // says so to every top-level window, a hidden one too.
  readonly onSessionEnd: (reasons: readonly SessionEndReason[]) => void;
}

export function appOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

function currentScheme(): ColourScheme {
  return nativeTheme.shouldUseDarkColors ? ColourScheme.Dark : ColourScheme.Light;
}

// The app's one window. It shows at once, on a page that says Scia is starting, and loads the page
// of the engine it is told to follow once the engine is ready (#13).
export class MainWindow {
  readonly #window: BrowserWindow;
  readonly #platform: string;
  #port = 0;
  #shownOnce = false;
  #theme: Theme;

  constructor(options: MainWindowOptions) {
    this.#platform = options.platform;
    this.#theme = options.theme;
    this.#window = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'Scia',
      icon: join(__dirname, 'assets', windowIconFile(options.platform)),
      // The page's own background, so the window never flashes another colour while it loads.
      backgroundColor: WINDOW_COLOURS[this.#theme][currentScheme()].background,
      ...windowFrameOptions(options.platform, titleBarOverlay(this.#theme, currentScheme(), true)),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        devTools: options.devTools,
        additionalArguments: [
          `--scia-api-token=${options.apiToken}`,
          `--scia-version=${options.version}`,
        ],
      },
    });

    // Hidden, not removed: removing the menu also drops its zoom and clipboard shortcuts.
    this.#window.setMenuBarVisibility(false);
    this.#confineToApp();
    this.#followSystem();
    this.#window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, url, isMainFrame) => {
        if (isMainFrame)
          options.log.warn('window_load_failed', { errorCode, errorDescription, url });
      },
    );
    this.#window.once('show', () => {
      this.#shownOnce = true;
    });
    // Closing is a question, not an order. A quit ends the process without closing the window
    // (main.ts), so nothing here has to tell the two apart.
    this.#window.on('close', (event) => {
      event.preventDefault();
      options.onCloseRequested();
    });
    // Never prevented: Scia does not ask Windows to wait (#13).
    this.#window.on('session-end', (event) => {
      options.onSessionEnd(event.reasons);
    });
    // Shown now, in the theme's background, rather than once a page has loaded: the engine's
    // page comes when the engine is ready, which a cold start takes a minute to be.
    this.#window.loadURL(startingPage(this.#theme)).catch(() => undefined);
    this.#window.show();
  }

  // A named request of the bridge (apps/desktop/CLAUDE.md: never a generic invoke), answered
  // only for this window's page. The handler checks its arguments: they come from the renderer.
  answer(channel: string, handler: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      this.#refuseOutsiders(event);
      return handler(...args);
    });
    this.#window.once('closed', () => {
      ipcMain.removeHandler(channel);
    });
  }

  // A named notice to the page, with nothing in it: the page asks what it needs to know. Sent only
  // to the app's own page, and to none while the window has no page of the app.
  tell(channel: string): void {
    if (this.#window.isDestroyed()) return;
    const contents = this.#window.webContents;
    if (!URL.canParse(contents.getURL())) return;
    if (new URL(contents.getURL()).origin !== appOrigin(this.#port)) return;
    contents.send(channel);
  }

  // The engine is ready, or came back after a restart, perhaps on another port.
  followServer(port: number): void {
    this.#port = port;
    if (!this.#window.isDestroyed()) this.#load();
  }

  // The theme the person chose: the window's background and its own buttons are that theme's.
  wear(theme: Theme): void {
    this.#theme = theme;
    this.#paint();
  }

  hide(): void {
    if (!this.#window.isDestroyed()) this.#window.hide();
  }

  isVisible(): boolean {
    return !this.#window.isDestroyed() && this.#window.isVisible();
  }

  // Whether the person is looking at it (engine/window-state.ts). On Windows the system says which
  // window is in use (#62, ADR 0020); a system that does not answer counts as another window in
  // use: a notification too many is better than one that never comes.
  // `asked` says what the system answered, for the log: "answered", "unanswered" (counted as
  // another window in use), or "not asked" off Windows.
  isInFront(): { inFront: boolean; asked: 'answered' | 'unanswered' | 'not asked' } {
    if (this.#window.isDestroyed()) return { inFront: false, asked: 'not asked' };
    if (process.platform !== 'win32')
      return { inFront: isInFront(this.#state()), asked: 'not asked' };
    const foreground = foregroundWindow();
    const inUse = windowInUse(foreground, handleOf(this.#window.getNativeWindowHandle()));
    return {
      inFront: isInFront(this.#state(), inUse),
      asked: foreground === undefined ? 'unanswered' : 'answered',
    };
  }

  // Whether it was put away for the tray to bring back — not merely minimised.
  isPutAway(): boolean {
    return !this.#window.isDestroyed() && isPutAway(this.#state());
  }

  #state(): WindowState {
    return {
      shownOnce: this.#shownOnce,
      visible: this.#window.isVisible(),
      minimised: this.#window.isMinimized(),
      focused: this.#window.isFocused(),
    };
  }

  // The system's own folder dialog, over this window, opened on `current`. Undefined when the
  // person closes it without choosing.
  async pickFolder(current: string): Promise<string | undefined> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.#window, {
      title: 'Download folder',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled ? undefined : filePaths[0];
  }

  // Also before the engine is ready: the window then says Scia is starting.
  focus(): void {
    if (this.#window.isDestroyed()) return;
    if (this.#window.isMinimized()) this.#window.restore();
    this.#window.show();
    this.#window.focus();
  }

  #load(): void {
    // did-fail-load reports a failed load; the rejection would only report it a second time.
    this.#window.loadURL(`${appOrigin(this.#port)}/`).catch(() => undefined);
  }

  #paint(): void {
    if (this.#window.isDestroyed()) return;
    this.#window.setBackgroundColor(WINDOW_COLOURS[this.#theme][currentScheme()].background);
    if (hasIntegratedTitleBar(this.#platform)) {
      this.#window.setTitleBarOverlay(
        titleBarOverlay(this.#theme, currentScheme(), this.#window.isFocused()),
      );
    }
  }

  // The window's background and its own buttons follow the system's light or dark, and the focus.
  #followSystem(): void {
    const paint = () => {
      this.#paint();
    };
    this.#window.on('focus', paint);
    this.#window.on('blur', paint);
    nativeTheme.on('updated', paint);
    this.#window.once('closed', () => {
      nativeTheme.off('updated', paint);
    });
  }

  // Only the app's own page, never a frame or a page it navigated to by mistake.
  #refuseOutsiders(event: IpcMainInvokeEvent): void {
    const url = event.senderFrame?.url;
    if (
      event.sender !== this.#window.webContents ||
      url === undefined ||
      new URL(url).origin !== appOrigin(this.#port)
    ) {
      throw new Error('Only the page of Scia asks main.');
    }
  }

  #confineToApp(): void {
    const contents = this.#window.webContents;
    guardPermissions(contents.session, () => appOrigin(this.#port));
    // shell.openExternal never receives a URL that comes from the renderer.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== appOrigin(this.#port)) event.preventDefault();
    });
  }
}
