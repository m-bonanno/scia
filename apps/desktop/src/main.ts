import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { BridgeChannel } from '@scia/contracts/bridge';
import { DEFAULT_API_PORT } from '@scia/contracts';
import { app, dialog, Notification, shell } from 'electron';
import log from 'electron-log/main';
import { CloseAction, closeAction } from './engine/close-policy.ts';
import { downloadActivity, unfinished } from './engine/download-activity.ts';
import { completedDownloadPath } from './engine/download-location.ts';
import type { EngineAccess } from './engine/engine-access.ts';
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

const APP_ID = 'app.scia.desktop';

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

  log.transports.file.resolvePathFn = () => join(layout.logsDir, 'main.log');
  // electron-log's default shows a modal for an uncaught error, which blocks main until someone
  // presses OK: after a close nobody sees it and the app stays alive. The log is enough.
  log.errorHandler.startCatching({ showDialog: false });
  log.info('boot', { version: app.getVersion(), packaged: app.isPackaged, pid: process.pid });

  // Windows shows a notification only for an app that says who it is.
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // A new token at every launch: nothing that read an old one can call this engine.
  const apiToken = randomBytes(32).toString('hex');
  const env = buildServerEnv({
    layout,
    apiToken,
    port: launch.port ?? DEFAULT_API_PORT,
    version: app.getVersion(),
    systemRoot: process.env.SystemRoot,
  });

  let port = 0;
  const engine = (): EngineAccess => ({ origin: appOrigin(port), apiToken, fetch });

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
    tooltip: async () => trayTooltip(await downloadActivity(engine()).catch(() => undefined)),
    log,
  });
  const notices = new ShownNotices(new NoticeFile(layout.noticesPath));

  // Closing the window while Scia has downloads to finish hides it; with nothing left, or with
  // no tray to come back from, it quits (engine/close-policy.ts).
  async function closeRequested(): Promise<void> {
    const activity = await downloadActivity(engine()).catch((error: unknown) => {
      log.warn('activity_unknown', { error: String(error) });
      return undefined;
    });
    const action = closeAction({
      trayAvailable: tray !== undefined,
      unfinished: activity === undefined ? undefined : unfinished(activity),
    });
    if (action === CloseAction.Quit) {
      app.quit();
      return;
    }
    window.hide();
    log.info('window_hidden_to_tray', { ...activity });
    if ((await notices.firstTime(HIDDEN_TO_TRAY_NOTICE.id)) && Notification.isSupported()) {
      new Notification({
        title: HIDDEN_TO_TRAY_NOTICE.title,
        body: HIDDEN_TO_TRAY_NOTICE.body,
      }).show();
    }
  }

  const giveUp = (reason: string) => {
    log.error('engine_gave_up', { reason });
    dialog.showErrorBox(
      'Scia cannot start',
      `The download engine does not start. Close other programs that use the local network and open Scia again.\n\nTechnical details: ${join(layout.logsDir, 'main.log')}`,
    );
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
      giveUp('too many restarts');
    },
    log,
  });

  try {
    port = await supervisor.start();
  } catch (error) {
    giveUp(String(error));
    return;
  }
  log.info('engine_ready', { port });
  window.followServer(port);

  window.answer(BridgeChannel.RevealDownload, async (id) => {
    shell.showItemInFolder(await completedDownloadPath(id, engine()));
  });
  window.answer(BridgeChannel.OpenDownload, async (id) => {
    const failure = await shell.openPath(await completedDownloadPath(id, engine()));
    if (failure !== '') throw new Error(failure);
  });

  // Starting Scia again is how a person without a tray gets the window back.
  app.on('second-instance', () => {
    window.focus();
  });

  // Quitting never hangs: the window goes at once, the engine is asked to stop and write its
  // state (server-process.ts bounds the wait), then the process ends. The process is ended
  // rather than its window closed, so the close handler above has no say in a quit.
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    window.hide();
    tray?.destroy();
    void supervisor.stop().finally(() => {
      log.info('quit');
      app.exit(0);
    });
  });
}
