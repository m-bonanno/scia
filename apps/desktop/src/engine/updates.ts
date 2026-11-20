import { SELF_UPDATING_PLATFORMS } from '@scia/contracts/bridge';

// How often a running Scia looks for a new version, and how soon again after a look that failed
// (docs/adr/0007-automatic-updates.md).
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATE_RETRY_MS = 60 * 60 * 1000;

// The version of a package no release made (apps/desktop/package.json): any release is newer, and
// a build made here to try something would be replaced by one at its quit.
const UNRELEASED_VERSION = '0.0.0';

// Only a packaged release updates itself, and only where a release carries an installer for its
// system.
export function updatesApply(app: {
  readonly packaged: boolean;
  readonly platform: string;
  readonly version: string;
}): boolean {
  return (
    app.packaged &&
    app.version !== UNRELEASED_VERSION &&
    (SELF_UPDATING_PLATFORMS as readonly string[]).includes(app.platform)
  );
}

// How the installer of an update is started at the quit: in silence, and Scia is not started again
// after it — the person asked to quit (the owner, #82). electron-updater passes `--updated /S`.
export const INSTALL_AT_QUIT = { silent: true, runAfter: false } as const;

// Until the first stable release, GitHub sends /releases/latest to the list of releases, a page
// electron-updater cannot read as the JSON it asked for: nothing to take, not a failure. It wraps
// every failure to reach that address in the same words, so the cause is read too — a host that
// failed or a network that is down are failures, retried an hour later.
const NO_LATEST_RELEASE = 'please ensure a production release exists';
const NOT_JSON = 'SyntaxError';

export function isNoStableRelease(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(NO_LATEST_RELEASE) &&
    error.message.includes(NOT_JSON)
  );
}

// A pre-release is a beta: semantic-release makes no other kind.
export function isBeta(version: string): boolean {
  return version.includes('-');
}

export interface UpdatesLog {
  readonly info: (event: string, data: object) => void;
  readonly warn: (event: string, data: object) => void;
}

export interface UpdatesOptions {
  // Whether the person follows the betas, as the engine keeps it. Rejects when the engine does
  // not say within its bound.
  readonly betas: () => Promise<boolean>;
  // A version newer than this one, from the stables alone or from the betas too; none when
  // there is nothing to take.
  readonly check: (betas: boolean) => Promise<string | undefined>;
  // Downloads the version the last check found, and keeps it once its SHA-512 matches. Rejects
  // when it fails or is given up through the signal.
  readonly fetch: (signal: AbortSignal) => Promise<void>;
  // Starts the installer of what was downloaded, silent and detached; true if it started.
  readonly install: () => boolean;
  // Runs `run` after `ms`, and answers how to call it off.
  readonly wait: (ms: number, run: () => void) => () => void;
  readonly log: UpdatesLog;
}

// When Scia looks for a new version, when it downloads one, and whether it installs it at the
// quit: the owner's decisions of #82. Nothing here waits on the person, and nothing stops Scia.
export class Updates {
  readonly #options: UpdatesOptions;
  #stopped = false;
  #callOff: (() => void) | undefined;
  // Unknown until the engine first says: a Scia just started may be resuming downloads.
  #idle = false;
  // Found by a check, not downloaded yet.
  #found: string | undefined;
  #fetching: { readonly version: string; readonly controller: AbortController } | undefined;
  // Downloaded and checked, waiting for the quit.
  #ready: string | undefined;

  constructor(options: UpdatesOptions) {
    this.#options = options;
  }

  start(): void {
    void this.#check();
  }

  // Every list the engine sends: the update is downloaded only while nothing runs or waits.
  engineSays(state: { readonly idle: boolean }): void {
    if (this.#isStopped()) return;
    this.#idle = state.idle;
    if (state.idle) this.#fetchIfIdle();
    else this.#fetching?.controller.abort();
  }

  // The quit has begun: nothing is checked or downloaded any more. Answers whether to install
  // what was downloaded, once the engine has stopped. A beta is installed only if the switch is
  // still on; an engine that does not say leaves it as it is.
  async atQuit(quit: { readonly askedByPerson: boolean }): Promise<boolean> {
    this.#stopped = true;
    this.#callOff?.();
    this.#callOff = undefined;
    this.#fetching?.controller.abort();
    const ready = this.#ready;
    if (ready === undefined) return false;
    if (!quit.askedByPerson) {
      this.#options.log.info('update_not_installed', { version: ready, reason: 'system_quit' });
      return false;
    }
    if (!isBeta(ready)) return true;
    try {
      const betas = await this.#options.betas();
      if (!betas) {
        this.#options.log.info('update_not_installed', { version: ready, reason: 'betas_off' });
      }
      return betas;
    } catch (error) {
      this.#options.log.warn('update_not_installed', {
        version: ready,
        reason: 'betas_unknown',
        error: String(error),
      });
      return false;
    }
  }

  install(): void {
    const started = this.#options.install();
    this.#options.log.info('update_installing', { version: this.#ready, started });
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  #schedule(ms: number): void {
    if (this.#isStopped()) return;
    this.#callOff?.();
    this.#callOff = this.#options.wait(ms, () => {
      this.#callOff = undefined;
      void this.#check();
    });
  }

  async #check(): Promise<void> {
    if (this.#isStopped()) return;
    const { log } = this.#options;
    let betas: boolean;
    try {
      betas = await this.#options.betas();
    } catch (error) {
      log.warn('update_check_put_off', { error: String(error) });
      this.#schedule(UPDATE_RETRY_MS);
      return;
    }
    if (this.#isStopped()) return;
    let found: string | undefined;
    try {
      found = await this.#options.check(betas);
    } catch (error) {
      log.warn('update_check_failed', { error: String(error) });
      this.#schedule(UPDATE_RETRY_MS);
      return;
    }
    if (this.#isStopped()) return;
    this.#schedule(UPDATE_CHECK_EVERY_MS);
    log.info('update_checked', { betas, found: found ?? null });
    if (found === undefined || found === this.#ready || found === this.#fetching?.version) return;
    // A newer version than the one being downloaded replaces it.
    this.#fetching?.controller.abort();
    this.#found = found;
    this.#fetchIfIdle();
  }

  #fetchIfIdle(): void {
    if (this.#isStopped() || !this.#idle || this.#fetching !== undefined) return;
    const version = this.#found;
    if (version === undefined) return;
    this.#found = undefined;
    // Whatever was downloaded before is replaced by this one, and is no longer to install.
    this.#ready = undefined;
    const controller = new AbortController();
    this.#fetching = { version, controller };
    this.#options.log.info('update_fetching', { version });
    this.#options.fetch(controller.signal).then(
      () => {
        this.#fetching = undefined;
        if (controller.signal.aborted) {
          this.#putOff(version);
          return;
        }
        this.#ready = version;
        this.#options.log.info('update_ready', { version });
      },
      (error: unknown) => {
        this.#fetching = undefined;
        if (controller.signal.aborted) {
          this.#putOff(version);
          return;
        }
        this.#options.log.warn('update_fetch_failed', { version, error: String(error) });
      },
    );
  }

  // Given up for a download of the person's, a newer version, or the quit: taken up again when
  // the engine is idle, unless something newer took its place.
  #putOff(version: string): void {
    if (this.#isStopped()) return;
    this.#found ??= version;
    this.#options.log.info('update_fetch_put_off', { version });
    this.#fetchIfIdle();
  }
}
