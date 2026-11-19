import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { BridgeChannel } from '@scia/contracts/bridge';
import { DEFAULT_API_PORT } from '@scia/contracts';
import { app, dialog, shell } from 'electron';
import log from 'electron-log/main';
import { completedDownloadPath, type EngineAccess } from './engine/download-location.ts';
import { parseLaunchOptions } from './engine/launch-options.ts';
import { RestartPolicy } from './engine/restart-policy.ts';
import { resolveRuntimeLayout } from './engine/runtime-layout.ts';
import { buildServerEnv } from './engine/server-env.ts';
import { ServerSupervisor } from './engine/server-supervisor.ts';
import { startServer } from './server-process.ts';
import { appOrigin, MainWindow } from './window.ts';

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

  // A new token at every launch: nothing that read an old one can call this engine.
  const apiToken = randomBytes(32).toString('hex');
  const env = buildServerEnv({
    layout,
    apiToken,
    port: launch.port ?? DEFAULT_API_PORT,
    version: app.getVersion(),
    systemRoot: process.env.SystemRoot,
  });

  // Hidden until it has a page: it follows the engine once there is one.
  const window = new MainWindow({
    apiToken,
    version: app.getVersion(),
    platform: process.platform,
    devTools: !app.isPackaged,
    log,
  });
  let port = 0;
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

  const engine = (): EngineAccess => ({ origin: appOrigin(port), apiToken, fetch });
  window.answer(BridgeChannel.RevealDownload, async (id) => {
    shell.showItemInFolder(await completedDownloadPath(id, engine()));
  });
  window.answer(BridgeChannel.OpenDownload, async (id) => {
    const failure = await shell.openPath(await completedDownloadPath(id, engine()));
    if (failure !== '') throw new Error(failure);
  });

  app.on('second-instance', () => {
    window.focus();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });

  // Closing never hangs: the window goes at once, the engine is asked to stop and write its
  // state (server-process.ts bounds the wait), then the process ends.
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    window.hide();
    void supervisor.stop().finally(() => {
      log.info('quit');
      app.exit(0);
    });
  });
}
