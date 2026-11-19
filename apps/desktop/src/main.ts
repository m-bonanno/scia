import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { BridgeChannel } from '@scia/contracts/bridge';
import { DEFAULT_API_PORT } from '@scia/contracts';
import { app, dialog, Notification, shell } from 'electron';
import log from 'electron-log/main';
import { APP_ID } from './engine/app-identity.ts';
import { CloseOutcome, WindowCloser } from './engine/close-policy.ts';
import { downloadActivity } from './engine/download-activity.ts';
import { completedDownloadPath } from './engine/download-location.ts';
import type { EngineAccess } from './engine/engine-access.ts';
import { EngineFailure, engineFailureNotice } from './engine/engine-failure.ts';
import { parseLaunchOptions } from './engine/launch-options.ts';
import { RestartPolicy } from './engine/restart-policy.ts';
import { resolveRuntimeLayout } from './engine/runtime-layout.ts';
import { buildServerEnv } from './engine/server-env.ts';
import { ServerSupervisor } from './engine/server-supervisor.ts';
import { ShownNotices } from './engine/shown-notices.ts';
import { HIDDEN_TO_TRAY_NOTICE, trayTooltip } from './engine/tray-presentation.ts';
import { NoticeFile } from './notice-file.ts';
import { startServer } from './server-process.ts';
import { createSystemTray } from './tray.ts';
import { appOrigin, MainWindow } from './window.ts';

// How long main waits for the engine to answer a question of its own. The engine is on this
// computer: one that has not answered by then is not going to.
const ENGINE_ANSWER_LIMIT_MS = 2000;

const launch = parseLaunchOptions(process.argv, process.cwd());
if (launch.userDataDir !== undefined) {
  // Before anything reads userData, the single-instance lock included.
  app.setPath('userData', launch.userDataDir);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(boot);
}

async function boot(): Promise<void> {
  const layout = resolveRuntimeLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    userDataDir: app.getPath('userData'),
    downloadsDir: app.getPath('downloads'),
    scratchProfile: launch.userDataDir !== undefined,
  });

  const logPath = join(layout.logsDir, 'main.log');
  log.transports.file.resolvePathFn = () => logPath;
  // electron-log's default shows a modal for an uncaught error, which blocks main until someone
  // presses OK: after a close nobody sees it and the app stays alive. The log is enough.
  log.errorHandler.startCatching({ showDialog: false });
  log.info('boot', { version: app.getVersion(), packaged: app.isPackaged, pid: process.pid });

  // Windows shows a notification only for an app that says who it is.
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // A new token at every launch: nothing that read an old one can call this engine.
  const apiToken = randomBytes(32).toString('hex');
  // The port the engine is asked to listen on; `port`, below, is the one it says it took.
  const enginePort = launch.port ?? DEFAULT_API_PORT;
  const env = buildServerEnv({
    layout,
    apiToken,
    port: enginePort,
    version: app.getVersion(),
    systemRoot: process.env.SystemRoot,
  });

  let port = 0;
  let quitting = false;
  // Read anew after every wait: a quit may have begun meanwhile.
  const isQuitting = () => quitting;
  const engine = (): EngineAccess => ({ origin: appOrigin(port), apiToken, fetch });
  const activity = () => downloadActivity(engine(), ENGINE_ANSWER_LIMIT_MS);

  // Hidden until it has a page: it follows the engine once there is one.
  const window = new MainWindow({
    apiToken,
    version: app.getVersion(),
    platform: process.platform,
    devTools: !app.isPackaged,
    log,
    onCloseRequested: () => {
      void closeRequested();
    },
  });

  const tray = createSystemTray({
    iconPath: join(__dirname, 'assets', 'tray.png'),
    onOpen: () => {
      window.focus();
    },
    onQuit: () => {
      app.quit();
    },
    tooltip: async () => trayTooltip(await activity().catch(() => undefined)),
    log,
  });
  const notices = new ShownNotices(new NoticeFile(layout.noticesPath));

  // The window goes at once; then Scia stays in the tray while it has downloads to finish, and
  // quits otherwise (engine/close-policy.ts).
  const closer = new WindowCloser({
    trayAvailable: tray !== undefined,
    quitting: isQuitting,
    visible: () => window.isVisible(),
    hide: () => {
      window.hide();
    },
    quit: () => {
      app.quit();
    },
    activity: () =>
      activity().catch((error: unknown) => {
        log.warn('activity_unknown', { error: String(error) });
        throw error;
      }),
  });
  // Kept while it is on screen: a notification nobody holds is collected, and its click is lost.
  let notice: Notification | undefined;

  async function closeRequested(): Promise<void> {
    const result = await closer.close();
    if (result.outcome !== CloseOutcome.Hidden) return;
    log.info('window_hidden_to_tray', { ...result.activity });
    // Asked in this order: a notice is recorded as shown only where it can be shown.
    if (Notification.isSupported() && (await notices.firstTime(HIDDEN_TO_TRAY_NOTICE.id))) {
      notice = new Notification({
        title: HIDDEN_TO_TRAY_NOTICE.title,
        body: HIDDEN_TO_TRAY_NOTICE.body,
      });
      notice.on('click', () => {
        window.focus();
      });
      notice.show();
    }
  }

  const giveUp = (failure: EngineFailure, reason: string) => {
    log.error('engine_gave_up', { failure, reason });
    tray?.destroy();
    const notice = engineFailureNotice(failure, { port: enginePort, logPath });
    dialog.showErrorBox(notice.title, notice.body);
    app.exit(1);
  };

  const supervisor = new ServerSupervisor({
    start: () => startServer({ entry: layout.serverEntry, env, log }),
    policy: new RestartPolicy(),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRestarted: (restartedOn) => {
      port = restartedOn;
      log.info('engine_restarted', { port });
      window.followServer(port);
    },
    onGaveUp: () => {
      giveUp(EngineFailure.KeepsStopping, 'too many restarts');
    },
    log,
  });

  // Everything that can ask for a quit, or bring the window back, is wired before the first
  // wait: the tray exists from this moment, and the engine can take a minute to start.

  // Quitting never hangs and never goes through the window: the window hides at once, the
  // engine is asked to stop and write its state (server-process.ts bounds the wait), then the
  // process ends. Electron's own quit — closing every window — is refused every time, or the
  // close handler, which prevents a close, would cancel the quit and be asked again.
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    window.hide();
    tray?.destroy();
    void supervisor.stop().finally(() => {
      log.info('quit');
      app.exit(0);
    });
  });

  // Starting Scia again is how a person whose desktop draws no tray gets the window back.
  app.on('second-instance', () => {
    log.info('second_instance');
    // Not while quitting: the window would show, then vanish with the process.
    if (!isQuitting()) window.focus();
  });

  window.answer(BridgeChannel.RevealDownload, async (id) => {
    shell.showItemInFolder(await completedDownloadPath(id, engine(), ENGINE_ANSWER_LIMIT_MS));
  });
  window.answer(BridgeChannel.OpenDownload, async (id) => {
    const failure = await shell.openPath(
      await completedDownloadPath(id, engine(), ENGINE_ANSWER_LIMIT_MS),
    );
    if (failure !== '') throw new Error(failure);
  });

  try {
    port = await supervisor.start();
  } catch (error) {
    if (isQuitting()) return;
    giveUp(EngineFailure.NeverStarted, String(error));
    return;
  }
  log.info('engine_ready', { port });
  window.followServer(port);
}
