import { join } from 'node:path';
import { ResolvedTheme, WINDOW_COLOURS } from '@scia/contracts/theme';
import { BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, nativeTheme } from 'electron';
import { guardPermissions } from './engine/page-permissions.ts';
import { hasIntegratedTitleBar, titleBarOverlay, windowFrameOptions } from './engine/title-bar.ts';

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
  // The person closed the window: main decides whether Scia hides or quits.
  readonly onCloseRequested: () => void;
}

export function appOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

function currentTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? ResolvedTheme.Dark : ResolvedTheme.Light;
}

// The app's one window. It is made hidden and without a page: it shows once it has loaded the
// page of the engine it is told to follow.
export class MainWindow {
  readonly #window: BrowserWindow;
  readonly #platform: string;
  #port = 0;

  constructor(options: MainWindowOptions) {
    this.#platform = options.platform;
    this.#window = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'Scia',
      // The page's own background, so the window never flashes another colour while it loads.
      backgroundColor: WINDOW_COLOURS[currentTheme()].background,
      ...windowFrameOptions(options.platform, titleBarOverlay(currentTheme(), true)),
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
    this.#keepTheme();
    this.#window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, url, isMainFrame) => {
        if (isMainFrame)
          options.log.warn('window_load_failed', { errorCode, errorDescription, url });
      },
    );
    this.#window.once('ready-to-show', () => {
      this.#window.show();
    });
    // Closing is a question, not an order. A quit ends the process without closing the window
    // (main.ts), so nothing here has to tell the two apart.
    this.#window.on('close', (event) => {
      event.preventDefault();
      options.onCloseRequested();
    });
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

  // The engine is ready, or came back after a restart, perhaps on another port.
  followServer(port: number): void {
    this.#port = port;
    if (!this.#window.isDestroyed()) this.#load();
  }

  hide(): void {
    if (!this.#window.isDestroyed()) this.#window.hide();
  }

  isVisible(): boolean {
    return !this.#window.isDestroyed() && this.#window.isVisible();
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

  focus(): void {
    // Before the engine is ready there is no page to show: the window shows itself once it
    // has loaded one.
    if (this.#window.isDestroyed() || this.#port === 0) return;
    if (this.#window.isMinimized()) this.#window.restore();
    this.#window.show();
    this.#window.focus();
  }

  #load(): void {
    // did-fail-load reports a failed load; the rejection would only report it a second time.
    this.#window.loadURL(`${appOrigin(this.#port)}/`).catch(() => undefined);
  }

  // The window's background and its own buttons follow the system's theme and the focus.
  #keepTheme(): void {
    const paint = () => {
      if (this.#window.isDestroyed()) return;
      this.#window.setBackgroundColor(WINDOW_COLOURS[currentTheme()].background);
      if (hasIntegratedTitleBar(this.#platform)) {
        this.#window.setTitleBarOverlay(titleBarOverlay(currentTheme(), this.#window.isFocused()));
      }
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
