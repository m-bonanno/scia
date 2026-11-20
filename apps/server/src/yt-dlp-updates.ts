import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { describeFailure, type Logger } from './logger.ts';
import { type SigningKey, signedAt } from './openpgp.ts';
import { checksumIn, dayOf, isNewer, isRelease, type YtDlpReleases } from './yt-dlp-releases.ts';

// The person's downloads, as far as an update cares: whether one runs or waits its turn.
export interface Activity {
  isBusy(): boolean;
  onBusyChange(listener: (busy: boolean) => void): () => void;
}

export interface Build {
  readonly path: string;
  readonly version: string;
}

export interface YtDlpUpdatesOptions {
  // The build Scia ships, in `resources/tools/`: never changed, used while no newer one is kept.
  readonly shipped: Build;
  // The build's name in a release of yt-dlp, for this system.
  readonly asset: string;
  // Where the builds taken from releases are kept, under the profile.
  readonly folder: string;
  readonly releases: YtDlpReleases;
  // yt-dlp's own key, which signs the sums of its releases.
  readonly signingKey: SigningKey;
  readonly logger: Logger;
  readonly dayMs?: number;
  readonly retryMs?: number;
  // The system's clock, for when the last check was: it is kept between runs.
  readonly now?: () => number;
  readonly schedule?: (run: () => void, ms: number) => () => void;
  readonly platform?: NodeJS.Platform;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MOST_SUMS_BYTES = 1024 * 1024;
const MOST_SIGNATURE_BYTES = 64 * 1024;
const MOST_BUILD_BYTES = 512 * 1024 * 1024;
const STATE = 'state.json';
const PART = '.part';

const stateSchema = z.object({
  checkedAt: z.iso.datetime().nullable(),
  build: z
    .object({
      version: z.string().refine(isRelease),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .nullable(),
});
type State = z.infer<typeof stateSchema>;

// Why a release's build was not taken. Each is final for that release: it is not asked again
// before the next day's check.
const Refusal = {
  Signature: 'signature',
  SignedBeforeRelease: 'signed_before_release',
  NotListed: 'not_listed',
  Checksum: 'checksum',
} as const;
type Refusal = (typeof Refusal)[keyof typeof Refusal];

// A fetch given up because a download of the person's started: fetched again once none runs.
class Yielded extends Error {
  override readonly name = 'Yielded';
}

function defaultSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

async function sha256Of(path: string): Promise<string | undefined> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  } catch {
    return undefined;
  }
}

async function stateIn(folder: string): Promise<State> {
  try {
    return stateSchema.parse(JSON.parse(await readFile(join(folder, STATE), 'utf8')));
  } catch {
    return { checkedAt: null, build: null };
  }
}

// The updater, or none when it cannot be opened: a failure of its own — a folder it cannot make,
// a state it cannot write — leaves the shipped build reading pages, and never stops the engine.
export async function openYtDlpUpdates(
  options: YtDlpUpdatesOptions,
): Promise<YtDlpUpdates | undefined> {
  try {
    return await YtDlpUpdates.open(options);
  } catch (error) {
    options.logger.warn('yt_dlp_updates_off', { error: describeFailure(error) });
    return undefined;
  }
}

// yt-dlp brought up to date from its own releases, at most once a day (docs/adr/0011). A build is
// taken only when its bytes match the release's SHA2-256SUMS, and those sums carry a good
// signature by yt-dlp's key, made no earlier than the day the release is named after. Anything
// else leaves the build in use. The build in use is what the next read of a page runs: a read
// under way finishes with the one it started.
export class YtDlpUpdates {
  readonly #options: YtDlpUpdatesOptions;
  #inUse: Build;
  #state: State;
  readonly #stop = new AbortController();
  #cancel: (() => void) | undefined;
  #checking: Promise<void> | undefined;
  #activity: Activity | undefined;

  private constructor(options: YtDlpUpdatesOptions, inUse: Build, state: State) {
    this.#options = options;
    this.#inUse = inUse;
    this.#state = state;
  }

  // Reads what was kept, checks that its bytes are still the ones taken, and removes whatever
  // else is in the folder: builds no longer used, and the parts of fetches that never ended.
  static async open(options: YtDlpUpdatesOptions): Promise<YtDlpUpdates> {
    const { folder, shipped, logger } = options;
    await mkdir(folder, { recursive: true });
    const state = await stateIn(folder);
    let inUse: Build = shipped;
    const kept = state.build;
    if (kept !== null) {
      const path = join(folder, kept.version, basename(shipped.path));
      if (!isNewer(kept.version, shipped.version)) {
        logger.info('yt_dlp_shipped_newer', { kept: kept.version, shipped: shipped.version });
      } else if ((await sha256Of(path)) === kept.sha256) {
        inUse = { path, version: kept.version };
      } else {
        logger.warn('yt_dlp_kept_build_changed', { version: kept.version });
      }
    }
    for (const entry of await readdir(folder)) {
      if (entry === STATE || entry === (inUse === shipped ? undefined : inUse.version)) continue;
      try {
        await rm(join(folder, entry), { recursive: true, force: true });
      } catch (error) {
        // A build a yt-dlp still runs — one an engine that ended left running — or that the
        // system holds: left for the next start, never a reason not to start.
        logger.warn('yt_dlp_not_removed', { entry, error: describeFailure(error) });
      }
    }
    const updates = new YtDlpUpdates(options, inUse, state);
    if (inUse === shipped && kept !== null) await updates.#keep({ ...state, build: null });
    logger.info('yt_dlp_in_use', { version: inUse.version, kept: inUse !== shipped });
    return updates;
  }

  // The program the next read of a page runs.
  command(): string {
    return this.#inUse.path;
  }

  version(): string {
    return this.#inUse.version;
  }

  // The first check comes when the last one is a day old — at once, the first time — and the
  // next a day after it.
  start(activity: Activity): void {
    this.#activity = activity;
    const day = this.#options.dayMs ?? DAY_MS;
    const now = this.#now();
    const last = this.#state.checkedAt === null ? undefined : Date.parse(this.#state.checkedAt);
    // A last check the clock puts in the future is no reason to wait: the clock was set back.
    const due = last === undefined || last > now ? 0 : Math.max(0, last + day - now);
    this.#after(due);
  }

  async close(): Promise<void> {
    this.#stop.abort();
    this.#cancel?.();
    await this.#checking;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  #after(ms: number): void {
    if (this.#stop.signal.aborted) return;
    this.#cancel = (this.#options.schedule ?? defaultSchedule)(() => {
      this.#checking = this.#check();
    }, ms);
  }

  async #check(): Promise<void> {
    const { releases, logger } = this.#options;
    const signal = this.#stop.signal;
    try {
      const latest = await releases.latest(signal);
      if (isNewer(latest, this.#inUse.version)) {
        const refusal = await this.#take(latest, signal);
        if (refusal !== undefined)
          logger.warn('yt_dlp_refused', { version: latest, reason: refusal });
      }
      await this.#keep({ ...this.#state, checkedAt: new Date(this.#now()).toISOString() });
      logger.info('yt_dlp_checked', { latest, inUse: this.#inUse.version });
      this.#after(this.#options.dayMs ?? DAY_MS);
    } catch (error) {
      if (signal.aborted) return;
      logger.warn('yt_dlp_check_failed', { error: describeFailure(error) });
      this.#after(this.#options.retryMs ?? RETRY_MS);
    }
  }

  async #take(tag: string, signal: AbortSignal): Promise<Refusal | undefined> {
    const { releases, asset, folder, signingKey, logger } = this.#options;
    const sums = await releases.file(tag, 'SHA2-256SUMS', MOST_SUMS_BYTES, signal);
    const signature = await releases.file(tag, 'SHA2-256SUMS.sig', MOST_SIGNATURE_BYTES, signal);
    const signed = signedAt(sums, signature, signingKey);
    if (signed === undefined) return Refusal.Signature;
    // The sums of an older release, signed when it was made, put under a newer name.
    if (signed < dayOf(tag)) return Refusal.SignedBeforeRelease;
    const expected = checksumIn(sums.toString('utf8'), asset);
    if (expected === undefined) return Refusal.NotListed;

    const target = join(folder, tag, basename(this.#options.shipped.path));
    await mkdir(join(folder, tag), { recursive: true });
    try {
      const got = await this.#fetch(tag, `${target}${PART}`, signal);
      if (got !== expected) return Refusal.Checksum;
      if ((this.#options.platform ?? process.platform) !== 'win32') {
        await chmod(`${target}${PART}`, 0o755);
      }
      await rename(`${target}${PART}`, target);
      // Written before it is used: a start after this one finds what it runs.
      await this.#keep({ ...this.#state, build: { version: tag, sha256: expected } });
      const from = this.#inUse.version;
      this.#inUse = { path: target, version: tag };
      logger.info('yt_dlp_updated', { from, to: tag });
      return undefined;
    } finally {
      // Whatever ended the fetch short of taking the build: nothing of it stays.
      if (this.#inUse.version !== tag) {
        await rm(join(folder, tag), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    }
  }

  // The build, fetched only while no download of the person's runs or waits, and given up when
  // one starts — fetched again, whole, once none does.
  async #fetch(tag: string, part: string, signal: AbortSignal): Promise<string> {
    const { releases, asset, logger } = this.#options;
    const activity = this.#activityOf();
    for (;;) {
      await this.#idle(signal);
      const yielded = new AbortController();
      const stopHearing = activity.onBusyChange((busy) => {
        if (busy) yielded.abort(new Yielded('A download started.'));
      });
      // One that started between the wait's end and this listener is not heard by it.
      if (activity.isBusy()) yielded.abort(new Yielded('A download started.'));
      try {
        return await releases.save(
          tag,
          asset,
          part,
          MOST_BUILD_BYTES,
          AbortSignal.any([signal, yielded.signal]),
        );
      } catch (error) {
        if (signal.aborted || !yielded.signal.aborted) throw error;
        logger.info('yt_dlp_fetch_yielded', { version: tag });
      } finally {
        stopHearing();
      }
    }
  }

  #idle(signal: AbortSignal): Promise<void> {
    const { logger } = this.#options;
    const activity = this.#activityOf();
    if (!activity.isBusy()) return Promise.resolve();
    // A stop that came before this wait is never heard by a listener added now.
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    logger.info('yt_dlp_waiting_for_downloads', {});
    return new Promise((resolve, reject) => {
      const stopHearing = activity.onBusyChange((busy) => {
        if (busy) return;
        signal.removeEventListener('abort', stopped);
        stopHearing();
        resolve();
      });
      const stopped = () => {
        stopHearing();
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', stopped, { once: true });
    });
  }

  #activityOf(): Activity {
    if (this.#activity === undefined) throw new Error('Checked before it was started.');
    return this.#activity;
  }

  // The state, written whole and renamed into place.
  async #keep(state: State): Promise<void> {
    const path = join(this.#options.folder, STATE);
    await writeFile(`${path}.tmp`, JSON.stringify(state));
    await rename(`${path}.tmp`, path);
    this.#state = state;
  }
}
