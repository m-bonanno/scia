import { CancellationToken } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import {
  firstLine,
  INSTALL_AT_QUIT,
  isNothingPublished,
  type UpdatesOptions,
} from './engine/updates.ts';

export interface UpdaterLog {
  info(message: string, details?: object): void;
  warn(message: string, details?: object): void;
}

// electron-updater makes a random id for each profile, keeps it in `.updaterId` and sends it with
// every request, for staged rollouts Scia does not use: GitHub could tell one Scia from another
// across its checks. Scia sends the same id for everyone, and the file is never made (the owner,
// #82). The id is read through `stagingUserIdPromise`, a lazy value that makes the file the
// first time it is read; given a value before that, it reads nothing and writes nothing.
const NO_STAGING_ID = '00000000-0000-0000-0000-000000000000';

class SciaUpdater extends NsisUpdater {
  constructor() {
    super();
    this.stagingUserIdPromise.value = Promise.resolve(NO_STAGING_ID);
  }
}

// electron-updater on Windows, reading the releases named in app-update.yml
// (docs/adr/0007-automatic-updates.md). It decides nothing: engine/updates.ts says when to
// check, when to download and whether to install; this does what it is told.
export function createUpdater(
  log: UpdaterLog,
): Pick<UpdatesOptions, 'check' | 'fetch' | 'install'> {
  const updater = new SciaUpdater();
  // What it does goes to main's log. Its errors go there through its `error` event, below, on
  // their first line: electron-updater writes an answer's headers and body into them.
  updater.logger = {
    info: (message: string) => {
      log.info(message);
    },
    warn: (message: string) => {
      log.warn(message);
    },
    error: () => undefined,
  };
  // Scia downloads only while it downloads nothing else, and installs on its own quit path.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  // The release carries the whole installer, not a web installer that fetches a package.
  updater.disableWebInstaller = true;
  // An updater with nobody listening for its errors throws them. Most are also the rejection of
  // the call that met them, which engine/updates.ts logs; one is not — an installer that could
  // not be started at the quit — and is said only here. No published version is not an error.
  updater.on('error', (error) => {
    if (!isNothingPublished(error)) log.warn('updater_error', { error: firstLine(error) });
  });

  return {
    check: async (betas) => {
      // Set before every check: electron-updater turns it on by itself for a beta. `channel` is
      // never set: its setter allows a downgrade.
      updater.allowPrerelease = betas;
      try {
        const result = await updater.checkForUpdates();
        return result?.isUpdateAvailable === true ? result.updateInfo.version : undefined;
      } catch (error) {
        if (!isNothingPublished(error)) throw error;
        log.info('update_nothing_published', {});
        return undefined;
      }
    },
    fetch: async (signal) => {
      const token = new CancellationToken();
      signal.addEventListener('abort', () => {
        token.cancel();
      });
      await updater.downloadUpdate(token);
    },
    install: () => updater.install(INSTALL_AT_QUIT.silent, INSTALL_AT_QUIT.runAfter),
  };
}
