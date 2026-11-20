import { CancellationToken } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import { INSTALL_AT_QUIT, isNoStableRelease, type UpdatesOptions } from './engine/updates.ts';

export interface UpdaterLog {
  info(message: string, details?: object): void;
  warn(message: string, details?: object): void;
  error(message: string, details?: object): void;
}

// electron-updater on Windows, reading the releases named in app-update.yml
// (docs/adr/0007-automatic-updates.md). It decides nothing: engine/updates.ts says when to
// check, when to download and whether to install; this does what it is told.
export function createUpdater(
  log: UpdaterLog,
): Pick<UpdatesOptions, 'check' | 'fetch' | 'install'> {
  const updater = new NsisUpdater();
  updater.logger = log;
  // Scia downloads only while it downloads nothing else, and installs on its own quit path.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  // An updater with nobody listening for its errors throws them: each is also the rejection of
  // the call that caused it, which engine/updates.ts logs.
  updater.on('error', () => undefined);

  return {
    check: async (betas) => {
      // Set before every check: electron-updater turns it on by itself for a beta. `channel` is
      // never set: its setter allows a downgrade.
      updater.allowPrerelease = betas;
      try {
        const result = await updater.checkForUpdates();
        return result?.isUpdateAvailable === true ? result.updateInfo.version : undefined;
      } catch (error) {
        if (!isNoStableRelease(error)) throw error;
        log.info('update_no_stable_release', {});
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
