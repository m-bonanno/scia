import { createDecipheriv } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DownloadFailure,
  HlsError,
  HlsRefusal,
  type HlsSegment,
  ivOfSegment,
  PageFailure,
  parsePlaylist,
  type Segment,
} from '@scia/core';
import { PageError } from './media-choice.ts';
import { DiskError, RemoteError, type RemoteSource, type RequestHeaders } from './remote-source.ts';
import type { Allowance } from './throttle.ts';
import { createTransmuxer } from './transmuxer.ts';

const MOST_ATTEMPTS = 5;
const MOST_PLAYLIST_BYTES = 8 * 1024 * 1024;
// A piece is held whole while it is opened and written: a few seconds of video, never this.
const MOST_PIECE_BYTES = 256 * 1024 * 1024;

export interface HlsTaskOptions {
  readonly source: RemoteSource;
  readonly playlistUrl: string;
  readonly headers: RequestHeaders;
  // Where the mp4 is made; its pieces wait beside it, in a folder of their own, until then.
  readonly partPath: string;
  // What the pieces are of — the quality chosen — written beside them: pieces kept of another are
  // thrown away, not put into this mp4.
  readonly variant?: string;
  readonly connections: number;
  readonly onBytes: (count: number) => void;
  // As a connection of a file books against the one speed limit, every read of a piece does.
  readonly allowance?: (expectedBytes: number | null) => Allowance;
  readonly retryDelayMs?: (attempt: number) => number;
}

// The pieces of the stream on a line of time: each lasts what the playlist says.
export interface Timeline {
  readonly totalMs: number;
  readonly segments: Segment[];
}

interface Piece {
  readonly index: number;
  readonly url: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly segment: HlsSegment;
}

export const piecesOf = (partPath: string) => `${partPath}.pieces`;
const pieceName = (index: number) => `${String(index)}.piece`;

function refusalOf(error: HlsError): PageError {
  return error.refusal === HlsRefusal.Protected
    ? new PageError(PageFailure.Drm, 'The stream is protected.')
    : new PageError(PageFailure.Unreadable, 'The stream is not a playlist.');
}

// One video offered as an HLS stream (docs/adr/0010): its playlist read, its pieces fetched over
// several connections into a folder beside the part file — what is there is not asked for again
// after a pause or a restart — opened when AES-128 with a key the playlist names, then made into
// one mp4 in the part file: fragmented mp4 pieces put behind their init segment as they are,
// MPEG-TS pieces transmuxed, nothing re-encoded.
export class HlsTask {
  readonly #options: HlsTaskOptions;
  #pieces: Piece[] = [];
  readonly #done = new Map<number, number>();
  #inFlight = 0;
  readonly #keys = new Map<string, Promise<Buffer>>();

  constructor(options: HlsTaskOptions) {
    this.#options = options;
  }

  // `wholeBytes` are those of the pieces kept whole: what the time left is reckoned from.
  progress(): {
    readonly downloadedBytes: number;
    readonly wholeBytes: number;
    readonly timeline: Timeline | null;
  } {
    let wholeBytes = 0;
    for (const bytes of this.#done.values()) wholeBytes += bytes;
    const downloadedBytes = wholeBytes + this.#inFlight;
    const last = this.#pieces.at(-1);
    if (last === undefined) return { downloadedBytes, wholeBytes, timeline: null };
    return {
      downloadedBytes,
      wholeBytes,
      timeline: {
        totalMs: last.endMs,
        segments: this.#pieces.map((piece) => ({
          start: piece.startMs,
          end: piece.endMs,
          downloaded: this.#done.has(piece.index) ? piece.endMs - piece.startMs : 0,
        })),
      },
    };
  }

  async run(signal: AbortSignal): Promise<void> {
    const folder = piecesOf(this.#options.partPath);
    const pieces = await this.#readPlaylist(signal);
    await this.#keepOnlyPiecesOf(folder);
    for (const name of await disk(() => readdir(folder))) {
      const index = /^(\d+)\.piece$/.exec(name)?.[1];
      if (index !== undefined) {
        const size = (await disk(() => stat(join(folder, name)))).size;
        this.#done.set(Number(index), size);
      }
    }
    const waiting = pieces.filter((piece) => !this.#done.has(piece.index));
    // A piece that fails for good ends every connection, and the task waits for them all: nothing
    // is fetched or written for a download that has failed, and the limit is not booked for it.
    const failure = new AbortController();
    const both = AbortSignal.any([signal, failure.signal]);
    const workers = Array.from(
      { length: Math.max(1, Math.min(this.#options.connections, waiting.length)) },
      async () => {
        for (let piece = waiting.shift(); piece !== undefined; piece = waiting.shift()) {
          await this.#fetchPiece(piece, folder, both);
        }
      },
    );
    const ended = await Promise.allSettled(
      workers.map((worker) =>
        worker.catch((error: unknown) => {
          failure.abort(error);
          throw error;
        }),
      ),
    );
    this.#inFlight = 0;
    signal.throwIfAborted();
    const first = ended.find((outcome) => outcome.status === 'rejected');
    if (first !== undefined) throw first.reason;
    await this.#assemble(folder, signal);
    await disk(() => rm(folder, { recursive: true, force: true }));
  }

  // The pieces are written as files: what is there is on disk.
  sync(): Promise<void> {
    return Promise.resolve();
  }

  async #keepOnlyPiecesOf(folder: string): Promise<void> {
    const label = join(folder, 'variant');
    const durations = this.#pieces.map((piece) => String(piece.endMs - piece.startMs)).join(',');
    const wanted = `${this.#options.variant ?? ''}|${durations}`;
    const kept = await readFile(label, 'utf8').catch(() => undefined);
    if (kept !== undefined && kept !== wanted) {
      await disk(() => rm(folder, { recursive: true, force: true }));
    }
    await disk(() => mkdir(folder, { recursive: true }));
    await disk(() => writeFile(label, wanted));
  }

  async #readPlaylist(signal: AbortSignal): Promise<Piece[]> {
    const text = (
      await this.#fetch(this.#options.playlistUrl, null, signal, MOST_PLAYLIST_BYTES)
    ).toString('utf8');
    let playlist;
    try {
      playlist = parsePlaylist(text);
    } catch (error) {
      if (error instanceof HlsError) throw refusalOf(error);
      throw error;
    }
    // A video's own address is the playlist of one quality: yt-dlp chose it.
    if (playlist.kind === 'master' || playlist.segments.length === 0) {
      throw new PageError(PageFailure.Unreadable, 'The stream names no piece of one quality.');
    }
    if (!playlist.ends) throw new PageError(PageFailure.Live, 'The stream is live.');
    // A stream that jumps — stitched ads or intros — would be one broken mp4: refused for now
    // (the owner, on #98; #123).
    const [head] = playlist.segments;
    const sameMap = (map: HlsSegment['map']) =>
      JSON.stringify(map) === JSON.stringify(head?.map ?? null);
    // An init segment under a key is encrypted, and written as fetched it would be no mp4's (#123).
    const changes = (segment: HlsSegment) =>
      segment.discontinuity ||
      !sameMap(segment.map) ||
      (segment.map !== null && segment.key !== null);
    if (playlist.segments.some(changes)) {
      throw new PageError(PageFailure.FormatUnsupported, 'The stream changes partway.');
    }
    let at = 0;
    this.#pieces = playlist.segments.map((segment, index) => {
      const startMs = at;
      at += Math.round(segment.duration * 1000);
      return {
        index,
        url: new URL(segment.uri, this.#options.playlistUrl).href,
        startMs,
        endMs: at,
        segment,
      };
    });
    return [...this.#pieces];
  }

  async #fetchPiece(piece: Piece, folder: string, signal: AbortSignal): Promise<void> {
    const { byteRange, key } = piece.segment;
    const range =
      byteRange === null
        ? null
        : { start: byteRange.offset, end: byteRange.offset + byteRange.length };
    let bytes = await this.#fetch(piece.url, range, signal, MOST_PIECE_BYTES, true);
    if (key !== null) {
      const secret = await this.#key(new URL(key.uri, this.#options.playlistUrl).href, signal);
      const decipher = createDecipheriv(
        'aes-128-cbc',
        secret,
        ivOfSegment(key, piece.segment.sequence),
      );
      try {
        bytes = Buffer.concat([decipher.update(bytes), decipher.final()]);
      } catch (error) {
        throw new PageError(PageFailure.Unreadable, 'A piece did not open with its key.', {
          cause: error,
        });
      }
    }
    const path = join(folder, pieceName(piece.index));
    // On the disk before it is renamed: a piece counted as kept after a power cut holds its bytes.
    await disk(async () => {
      const piecefile = await open(`${path}.part`, 'w');
      try {
        await piecefile.writeFile(bytes);
        await piecefile.datasync();
      } finally {
        await piecefile.close();
      }
      await rename(`${path}.part`, path);
    });
    this.#done.set(piece.index, bytes.byteLength);
  }

  #key(url: string, signal: AbortSignal): Promise<Buffer> {
    let key = this.#keys.get(url);
    if (key === undefined) {
      key = this.#fetch(url, null, signal, 1024).then((bytes) => {
        if (bytes.byteLength !== 16) {
          throw new PageError(PageFailure.Unreadable, 'The key of the stream is not a key.');
        }
        return bytes;
      });
      // A key that failed is asked again by the next piece that needs it.
      key.catch(() => this.#keys.delete(url));
      this.#keys.set(url, key);
    }
    return key;
  }

  // The whole answer at `url`, against the speed limit, asked again a few times when the host
  // failed in a way that heals.
  async #fetch(
    url: string,
    range: { readonly start: number; readonly end: number } | null,
    signal: AbortSignal,
    mostBytes: number | null,
    counted = false,
  ): Promise<Buffer> {
    for (let attempt = 1; ; attempt += 1) {
      const allowance = this.#options.allowance?.(null);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        await allowance?.next().over(signal);
        for await (const chunk of await this.#options.source.open(
          url,
          this.#options.headers,
          range,
          signal,
        )) {
          size += chunk.byteLength;
          if (mostBytes !== null && size > mostBytes) {
            throw new PageError(PageFailure.Unreadable, 'The stream said far too much.');
          }
          chunks.push(Buffer.from(chunk));
          if (counted) {
            this.#inFlight += chunk.byteLength;
            this.#options.onBytes(chunk.byteLength);
          }
          allowance?.took(chunk.byteLength);
          await allowance?.next().over(signal);
        }
        if (counted) this.#inFlight -= size;
        return Buffer.concat(chunks);
      } catch (error) {
        if (counted) this.#inFlight -= size;
        const heals = error instanceof RemoteError && error.retryable;
        if (signal.aborted || !heals || attempt >= MOST_ATTEMPTS) {
          throw signal.aborted ? signal.reason : asRemote(error);
        }
        // A pause in the wait ends it.
        await sleep(this.#options.retryDelayMs?.(attempt) ?? 1000 * attempt, undefined, { signal });
      } finally {
        allowance?.settle();
      }
    }
  }

  async #assemble(folder: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const output = await disk(() => open(this.#options.partPath, 'w'));
    try {
      const map = this.#pieces[0]?.segment.map ?? null;
      if (map !== null) {
        const range =
          map.byteRange === null
            ? null
            : { start: map.byteRange.offset, end: map.byteRange.offset + map.byteRange.length };
        const init = await this.#fetch(
          new URL(map.uri, this.#options.playlistUrl).href,
          range,
          signal,
          null,
        );
        await disk(() => output.write(init));
        for (const piece of this.#pieces) {
          const bytes = await disk(() => readFile(join(folder, pieceName(piece.index))));
          await disk(() => output.write(bytes));
        }
        return;
      }
      await this.#transmux(folder, output, signal);
    } finally {
      // The manager marks and renames it, and says it is complete, next.
      await output.datasync().catch(() => undefined);
      await output.close();
    }
  }

  // MPEG-TS into fragmented mp4, one piece at a time: what mux.js gives back for a piece is
  // written before the next is read.
  async #transmux(
    folder: string,
    output: Awaited<ReturnType<typeof open>>,
    signal: AbortSignal,
  ): Promise<void> {
    const transmuxer = createTransmuxer();
    // Its init segment once, before the first fragment: mux.js gives it with every one.
    const written = { init: false };
    let made: Buffer[] = [];
    transmuxer.on('data', (segment) => {
      if (!written.init) {
        made.push(Buffer.from(segment.initSegment));
        written.init = true;
      }
      made.push(Buffer.from(segment.data));
    });
    for (const piece of this.#pieces) {
      signal.throwIfAborted();
      transmuxer.push(await disk(() => readFile(join(folder, pieceName(piece.index)))));
      transmuxer.flush();
      const bytes = Buffer.concat(made);
      made = [];
      await disk(() => output.write(bytes));
    }
    if (!written.init) {
      throw new PageError(PageFailure.Unreadable, 'The pieces of the stream hold no video.');
    }
  }
}

function asRemote(error: unknown): unknown {
  if (error instanceof RemoteError || error instanceof PageError || error instanceof DiskError) {
    return error;
  }
  return new RemoteError(DownloadFailure.Network, false, 'The stream could not be fetched.', {
    cause: error,
  });
}

async function disk<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new DiskError('The pieces of the stream could not be kept.', { cause: error });
  }
}
