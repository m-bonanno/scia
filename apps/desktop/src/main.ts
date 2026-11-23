import { foreground } from './foreground-window.ts';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BridgeChannel, UpdateRestart } from '@scia/contracts/bridge';
import { DEFAULT_API_PORT, type Download, EVENTS_KEEP_ALIVE_MS } from '@scia/contracts';
import { app, clipboard, dialog, Notification, shell } from 'electron';
import log from 'electron-log/main';
import { APP_ID } from './engine/app-identity.ts';
import { ClipboardWatch } from './engine/clipboard-watch.ts';
import { CloseOutcome, WindowCloser } from './engine/close-policy.ts';
import { activityOf, downloadActivity, unfinished } from './engine/download-activity.ts';
import { chooseDownloadFolder, oneAtATime } from './engine/download-folder.ts';
import { completedDownloadPath } from './engine/download-location.ts';
import { codePageAddress } from './engine/integration-code.ts';
import { EndedBatch } from './engine/ended-batch.ts';
import { type Ended, EndedDownloads, Ending } from './engine/ended-downloads.ts';
import { endedNotice, STILL_IN_TRAY } from './engine/ended-notice.ts';
import type { EngineAccess } from './engine/engine-access.ts';
import { Kept } from './engine/kept.ts';
import { followDownloads } from './engine/engine-events.ts';
import { EngineFailure, engineFailureNotice } from './engine/engine-failure.ts';
import { betasOfEngine } from './engine/engine-settings.ts';
import { KeyVault } from './engine/key-vault.ts';
import { parseLaunchOptions } from './engine/launch-options.ts';
import {
  offeredNotice,
  offerMagnetsToEngine,
  offerToEngine,
  sentNotice,
} from './engine/offered-links.ts';
import { RestartPolicy } from './engine/restart-policy.ts';
import { resolveRuntimeLayout } from './engine/runtime-layout.ts';
import { buildServerEnv } from './engine/server-env.ts';
import { ServerSupervisor } from './engine/server-supervisor.ts';
import { ShownNotices } from './engine/shown-notices.ts';
import { HIDDEN_TO_TRAY_NOTICE, trayTooltip } from './engine/tray-presentation.ts';
import { Updates, updatesApply } from './engine/updates.ts';
import { themeOfEngine } from './engine/window-theme.ts';
import { KeyFolder, systemCipher } from './key-store.ts';
import { NoticeFile } from './notice-file.ts';
import { startServer } from './server-process.ts';
import { createSystemTray } from './tray.ts';
import { createUpdater } from './updater.ts';
import { appOrigin, MainWindow } from './window.ts';

// How long main waits for the engine to answer a question of its own. The engine is on this
// computer: one that has not answered by then is not going to.
const ENGINE_ANSWER_LIMIT_MS = 2000;
// How long main waits for the engine to take the links read on the clipboard: the engine may ask
// AllDebrid which hosts it knows first, within limits of its own.
const OFFER_ANSWER_LIMIT_MS = 10_000;
// How long main waits before it opens the engine's events again, when they end or are refused.
const EVENTS_RETRY_MS = 1000;
// The engine says it is still there every EVENTS_KEEP_ALIVE_MS: three of them missed are an
// engine that stopped talking.
const EVENTS_SILENCE_LIMIT_MS = 3 * EVENTS_KEEP_ALIVE_MS;
// How many notifications — of ended downloads, of links taken from the clipboard — are held so that
// a click on them still opens the window: the ones on screen and the last ones in the system's list
// of notifications.
const HELD_NOTICES = 20;

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
  // Its first start takes seconds on a cold machine: started now, asked only when a notification
  // is decided (ADR 0020).
  foreground.warm();
  const layout = resolveRuntimeLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    userDataDir: app.getPath('userData'),
    downloadsDir: app.getPath('downloads'),
    scratchProfile: launch.userDataDir !== undefined,
    platform: process.platform,
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
    tempDir: app.getPath('temp'),
    alldebridApi: launch.alldebridApi,
    ytDlpReleases: launch.ytDlpReleases,
  });
  // The keys of the services the engine is connected to: the engine asks, main keeps them
  // sealed by the system (engine/key-vault.ts).
  const keys = new KeyVault({ cipher: systemCipher, files: new KeyFolder(layout.keysDir), log });

  let port = 0;
  let quitting = false;
  // A quit the person asked for — the tray's Quit, or a close with nothing left to download —
  // is the only one that installs an update (docs/adr/0007-automatic-updates.md).
  let quitAskedByPerson = false;
  const quitAsAsked = () => {
    quitAskedByPerson = true;
    app.quit();
  };
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
    onQuit: quitAsAsked,
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
    quit: quitAsAsked,
    activity: () =>
      activity().catch((error: unknown) => {
        log.warn('activity_unknown', { error: String(error) });
        throw error;
      }),
  });
  // What a click on any of Scia's notifications does. Not while quitting: the window would
  // show, then vanish with the process.
  const openFromNotice = () => {
    if (!isQuitting()) window.focus();
  };

  // Kept while it is on screen: a notification nobody holds is collected, and its click is lost.
  let notice: Notification | undefined;
  // Every one of them, not the last: an earlier notification is still on screen, or in the
  // system's list, and a click on it has to open the window too. Not let go when the system
  // says it closed — it says so as soon as it has shown it, while the person can still click.
  const heldNotices = new Kept<Notification>(HELD_NOTICES);

  // What ended while Scia ran is said by the system when the person is not looking at the list
  // (engine/ended-downloads.ts, ended-batch.ts, ended-notice.ts). Main hears it from the
  // engine's own events, not from the page, which may be hidden.
  const ended = new EndedDownloads();
  let latest: readonly Download[] = [];
  const listening = new AbortController();
  const endedBatch = new EndedBatch({
    wait: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    deliver: (downloads) => {
      void notifyEnded(downloads);
    },
  });

  async function notifyEnded(downloads: readonly Ended[]): Promise<void> {
    const { inFront, asked } = await window.isInFront();
    // Idle in the tray: the window was put away and nothing is running or waiting any more.
    const lastOfHiddenScia = window.isPutAway() && unfinished(activityOf(latest)) === 0;
    const completed = downloads.filter((download) => download.ending === Ending.Completed).length;
    log.info('downloads_ended', {
      completed,
      failed: downloads.length - completed,
      inFront,
      asked,
      lastOfHiddenScia,
    });
    // A person looking at the list sees its rows change.
    if (isQuitting() || inFront || !Notification.isSupported()) return;
    const text = endedNotice(downloads, { lastOfHiddenScia });
    const shown = new Notification(text);
    heldNotices.keep(shown);
    shown.on('click', () => {
      log.info('ended_notice_clicked', {});
      heldNotices.release(shown);
      openFromNotice();
    });
    shown.on('show', () => {
      log.info('ended_notice_shown', {});
    });
    shown.on('failed', (_event, error) => {
      heldNotices.release(shown);
      log.warn('ended_notice_failed', { error });
    });
    // The title names no file: it is what was handed to the system, for whoever reads the log.
    log.info('ended_notice_asked', {
      title: text.title,
      bodyLines: text.body.split('\n').length,
      saysStillInTray: text.body.includes(STILL_IN_TRAY),
    });
    shown.show();
  }

  // The links copied while the switch is on (engine/clipboard-watch.ts, docs/adr/0012): main
  // reads the clipboard, the engine keeps what it knows, ready. Said by the system when the
  // person is not looking at the list.
  const clipboardWatch = new ClipboardWatch({
    read: () => clipboard.readText(),
    offer: (links) => offerToEngine(links, engine(), OFFER_ANSWER_LIMIT_MS),
    added: (added) => {
      void notifyOffered('clipboard_links_added', added, offeredNotice);
    },
    offerMagnets: (magnets) => offerMagnetsToEngine(magnets, engine(), OFFER_ANSWER_LIMIT_MS),
    sent: (sent) => {
      void notifyOffered('clipboard_magnets_sent', sent, sentNotice);
    },
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => {
        clearInterval(timer);
      };
    },
    log,
  });

  async function notifyOffered(
    event: string,
    added: number,
    noticeOf: (count: number) => { title: string; body: string },
  ): Promise<void> {
    const { inFront, asked } = await window.isInFront();
    log.info(event, { added, inFront, asked });
    if (added === 0 || isQuitting() || inFront || !Notification.isSupported()) return;
    const text = noticeOf(added);
    const shown = new Notification(text);
    heldNotices.keep(shown);
    shown.on('click', () => {
      heldNotices.release(shown);
      openFromNotice();
    });
    shown.on('failed', (_event, error) => {
      heldNotices.release(shown);
      log.warn('offered_notice_failed', { error });
    });
    // What was handed to the system, for whoever reads the log: a count, no link, no magnet.
    log.info('offered_notice_asked', { title: text.title });
    shown.show();
  }

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
      notice.on('click', openFromNotice);
      notice.show();
    }
  }

  // The window's own colours are the theme's, which the engine keeps: asked before the page
  // loads, and whenever the page says the theme changed. An engine that does not say leaves
  // the window as it is.
  const wearTheme = async () => {
    try {
      window.wear(await themeOfEngine(engine(), ENGINE_ANSWER_LIMIT_MS));
    } catch (error) {
      log.warn('theme_unknown', { error: String(error) });
    }
  };
  const followEngine = async () => {
    await wearTheme();
    window.followServer(port);
  };

  const giveUp = (failure: EngineFailure, reason: string) => {
    log.error('engine_gave_up', { failure, reason });
    tray?.destroy();
    const box = engineFailureNotice(failure, { port: enginePort, logPath });
    dialog.showErrorBox(box.title, box.body);
    app.exit(1);
  };

  // Where a release carries an installer for this system, the packaged app looks for new versions
  // and installs one at a quit the person asks for (engine/updates.ts).
  const updating = {
    packaged: app.isPackaged,
    platform: process.platform,
    version: app.getVersion(),
  };
  // An updater that cannot be made leaves Scia as it is, and a line in the log: nothing in the
  // start depends on it.
  const makeUpdates = (): Updates | undefined => {
    if (!updatesApply(updating)) {
      log.info('updates_off', updating);
      return undefined;
    }
    try {
      return new Updates({
        betas: () => betasOfEngine(engine(), ENGINE_ANSWER_LIMIT_MS),
        ...createUpdater(log.scope('updater')),
        // The page asks what it may offer; main only says that it changed.
        onOffer: () => {
          window.tell(BridgeChannel.UpdateChanged);
        },
        wait: (ms, run) => {
          const timer = setTimeout(run, ms);
          return () => {
            clearTimeout(timer);
          };
        },
        log,
      });
    } catch (error) {
      log.warn('updates_off', { ...updating, error: String(error) });
      return undefined;
    }
  };
  const updates = makeUpdates();

  const supervisor = new ServerSupervisor({
    start: () =>
      startServer({
        entry: layout.serverEntry,
        env,
        log,
        answer: (message) => keys.answer(message),
      }),
    policy: new RestartPolicy(),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRestarted: (restartedOn) => {
      port = restartedOn;
      log.info('engine_restarted', { port });
      void followEngine();
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
    listening.abort();
    endedBatch.stop();
    clipboardWatch.watch(false);
    window.hide();
    tray?.destroy();
    // Whether to install is decided while the engine still runs (it keeps the betas switch), and
    // the installer starts once the engine has stopped and written its state: the installer ends
    // whatever still runs of Scia. Each step has its bound.
    const installing =
      updates?.atQuit({ askedByPerson: quitAskedByPerson }) ?? Promise.resolve(false);
    void installing
      .catch(() => false)
      .then(async (install) => {
        await supervisor.stop();
        // A restart the person was granted starts Scia again, by the installer or by itself.
        if (updates?.finish(install) === true) app.relaunch();
      })
      .finally(() => {
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

  window.answer(
    BridgeChannel.ChooseDownloadFolder,
    oneAtATime(() =>
      chooseDownloadFolder(
        (current) => window.pickFolder(current),
        engine(),
        ENGINE_ANSWER_LIMIT_MS,
      ),
    ),
  );

  window.answer(BridgeChannel.ThemeChanged, wearTheme);

  // The version a quit would install, for the page to offer beside the name (#133).
  window.answer(BridgeChannel.UpdateOffered, async () => (await updates?.offered()) ?? null);
  // A restart the person asked for goes the way of any quit they ask for: the engine stops and
  // writes its state, then the installer starts — and starts Scia again after it.
  window.answer(BridgeChannel.RestartToUpdate, async () => {
    if (updates === undefined || isQuitting()) return UpdateRestart.Nothing;
    const answer = await updates.restart(async () => unfinished(await activity()));
    if (answer === UpdateRestart.Restarting) quitAsAsked();
    return answer;
  });

  window.answer(BridgeChannel.OpenCodePage, async (id) => {
    await shell.openExternal(await codePageAddress(id, engine(), ENGINE_ANSWER_LIMIT_MS));
  });

  try {
    port = await supervisor.start();
  } catch (error) {
    if (isQuitting()) return;
    giveUp(EngineFailure.NeverStarted, String(error));
    return;
  }
  log.info('engine_ready', { port });
  // The ear first: it reads the engine, not the theme or the page, and what ends before it
  // listens is taken for what had already ended — never said.
  void followDownloads({
    engine,
    onSnapshot: ({ downloads, watchClipboard }) => {
      latest = downloads;
      updates?.engineSays({ idle: unfinished(activityOf(downloads)) === 0 });
      endedBatch.add(ended.seen(downloads));
      // Heard here the moment it changes, whoever changed it; never after a quit has begun.
      clipboardWatch.watch(watchClipboard && !isQuitting());
    },
    signal: listening.signal,
    answerLimitMs: ENGINE_ANSWER_LIMIT_MS,
    silenceLimitMs: EVENTS_SILENCE_LIMIT_MS,
    retryMs: EVENTS_RETRY_MS,
    sleep: (ms, signal) => sleep(ms, undefined, { signal }),
    log,
  });
  updates?.start();
  await followEngine();
}
