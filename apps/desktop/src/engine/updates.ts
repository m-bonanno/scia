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

// What electron-updater says when the releases it may read hold no version for it — until the
// first stable release, for a Scia whose betas are off. Nothing to take, not a failure: a quiet
// line, and the next check six hours later.
const NOTHING_PUBLISHED = 'ERR_UPDATER_NO_PUBLISHED_VERSIONS';

export function isNothingPublished(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === NOTHING_PUBLISHED;
}

// electron-updater puts an answer's headers and body in its messages: the log keeps the first line.
export function firstLine(error: unknown): string {
  return String(error).split('\n', 1)[0] ?? '';
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
  // Asks for the installer of what was downloaded to start, silent and detached; true if it was
  // asked — whether it then ran, electron-updater says only as an error.
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
  // What the last check that answered offered: nothing is downloaded that it no longer offers —
  // a beta, once the switch is off.
  #offered: string | undefined;

  constructor(options: UpdatesOptions) {
    this.#options = options;
  }

  start(): void {
    void this.#check();
  }

  // Every list the engine sends: the update is downloaded only while nothing runs or waits.
  engineSays(state: { readonly idle: boolean }): void {
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
        error: firstLine(error),
      });
      return false;
    }
  }

  install(): void {
    const asked = this.#options.install();
    this.#options.log.info('update_installing', { version: this.#ready, asked });
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  #schedule(ms: number): void {
    if (this.#isStopped()) return;
    this.#callOff = this.#options.wait(ms, () => {
      this.#callOff = undefined;
      void this.#check();
    });
  }

  async #check(): Promise<void> {
    const { log } = this.#options;
    let betas: boolean;
    try {
      betas = await this.#options.betas();
    } catch (error) {
      log.warn('update_check_put_off', { error: firstLine(error) });
      this.#schedule(UPDATE_RETRY_MS);
      return;
    }
    if (this.#isStopped()) return;
    let found: string | undefined;
    try {
      found = await this.#options.check(betas);
    } catch (error) {
      log.warn('update_check_failed', { error: firstLine(error) });
      this.#schedule(UPDATE_RETRY_MS);
      return;
    }
    this.#schedule(UPDATE_CHECK_EVERY_MS);
    log.info('update_checked', { betas, found: found ?? null });
    this.#offered = found;
    if (found !== undefined && found === this.#fetching?.version) return;
    // What is being downloaded is no longer offered, or a newer version replaces it.
    this.#fetching?.controller.abort();
    this.#found = found === this.#ready ? undefined : found;
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
        this.#options.log.warn('update_fetch_failed', { version, error: firstLine(error) });
      },
    );
  }

  // Given up for a download of the person's, a check that no longer offers it or offers a newer
  // one, or the quit: taken up again when the engine is idle only if it is still what is offered.
  #putOff(version: string): void {
    if (version === this.#offered) this.#found = version;
    this.#options.log.info('update_fetch_put_off', { version });
    this.#fetchIfIdle();
  }
}
