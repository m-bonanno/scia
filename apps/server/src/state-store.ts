import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BundleFailure,
  BundleStatus,
  DownloadFailure,
  DownloadStatus,
  MagnetFailure,
  MagnetStatus,
  TITLE_MOST_CHARS,
} from '@scia/core';
import {
  IntegrationId,
  mediaSchema,
  segmentSchema,
  settingsSchema,
  timelineSchema,
} from '@scia/contracts';
import { DEFAULT_THEME } from '@scia/contracts/theme';
import { z } from 'zod';

export const recordSchema = z.object({
  id: z.string(),
  url: z.string(),
  referrer: z.string().nullable(),
  directory: z.string(),
  fileName: z.string(),
  // What the site calls the video of a page copied, read while it was ready (#285). A state
  // written before titles were read has none, and so has one that holds no title a row shows.
  title: z.string().min(1).max(TITLE_MOST_CHARS).nullable().catch(null),
  // The name is final and its part file reserved: the host was asked, the folder checked.
  named: z.boolean(),
  status: z.enum(DownloadStatus),
  totalBytes: z.number().nullable(),
  resumable: z.boolean(),
  validator: z.string().nullable(),
  segments: z.array(segmentSchema),
  downloadedBytes: z.number(),
  failure: z.enum(DownloadFailure).nullable(),
  failureStatus: z.number().nullable(),
  // The service the link goes through, and the direct link it gave: asked for once, used again
  // after a pause or a restart. A state written before services existed has neither.
  via: z.enum(IntegrationId).nullable().catch(null),
  unlockedUrl: z.string().nullable().catch(null),
  // The video a page plays, when the link was a page: what the row says of it (`media`), and the
  // address and headers its site gave (`source`) — used again after a pause or a restart, cleared
  // after a failure so that the page is read again. One value, read whole or not at all: a video
  // whose `media` were dropped and whose address stayed would be fetched as a page (#101). A
  // state written before pages were read has none.
  video: z
    .object({
      media: mediaSchema,
      source: z
        .object({
          url: z.string(),
          headers: z.record(z.string(), z.string()),
          // One file, the playlist of an HLS stream, or a picture whose sound is offered apart
          // (docs/adr/0021). A state written before streams has files.
          kind: z.enum(['file', 'hls', 'pair']).catch('file'),
          // The sound of a pair; none for the others. A state written before pairs has none.
          sound: z
            .object({ url: z.string(), headers: z.record(z.string(), z.string()) })
            .nullable()
            .catch(null)
            .default(null),
        })
        // A pair without its sound would be fetched as a picture alone: the page is read again.
        .refine((source) => (source.kind === 'pair') === (source.sound !== null))
        .nullable(),
    })
    .nullable()
    .catch(null),
  // The download is the video of a page: a mark of its own, kept when its `video` is refused at
  // load — a container a later version no longer takes — so that the page is read again for it,
  // never fetched into its file as a page.
  fromPage: z.boolean().catch(false),
  // Scia refused to join the picture and sound its page offered apart (#241): every reading of
  // the page after it chooses among one files and streams only. A state written before has none.
  joinRefused: z.boolean().catch(false),
  // How far a stream's pieces are, kept for the row while it does not run. The pieces on disk are
  // the truth: what is there is not asked for again.
  timeline: timelineSchema.nullable().catch(null),
  // A file of a magnet (#137): its name is the magnet's, not the one its link's host gives.
  nameKept: z.boolean().catch(false),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type DownloadRecord = z.infer<typeof recordSchema>;

// A magnet the service is fetching, or could not (#137). Its files are downloads once it is
// ready; until then this is all Scia knows of it.
export const magnetRecordSchema = z.object({
  id: z.string(),
  // None for a magnet taken from the service's account (#138): the service has it, Scia never
  // sends it.
  magnet: z.string().nullable(),
  name: z.string(),
  // The service's id of it, once the service took it.
  serviceId: z.number().int().positive().nullable(),
  status: z.enum(MagnetStatus),
  totalBytes: z.number().nullable(),
  downloadedBytes: z.number(),
  failure: z.enum(MagnetFailure).nullable(),
  // The folder downloads went to when it was pasted: its files go there.
  directory: z.string(),
  createdAt: z.string(),
});
export type MagnetRecord = z.infer<typeof magnetRecordSchema>;

// A link that opens into several files (#181; docs/adr/0025), until the person starts the files
// they chose: then those are downloads, and it leaves the list.
// A file the service listed: its link to it — unlocked as a hoster's is, and in no answer of the API
// and no log until the file is a download — the name it will have, made safe (none: the service
// gave none, and its host names it), and its size.
const bundleFileSchema = z.object({
  link: z.string(),
  name: z.string().nullable(),
  size: z.number(),
});
export type BundleFile = z.infer<typeof bundleFileSchema>;

export const bundleRecordSchema = z.object({
  id: z.string(),
  // The link that was added: asked of the service again while it is being opened, and fetched as
  // it stands, from the page it was added from, when a protector's or a shortener's gives nothing.
  url: z.string(),
  referrer: z.string().nullable(),
  // The folder its files go into, named after the link.
  name: z.string(),
  status: z.enum(BundleStatus),
  failure: z.enum(BundleFailure).nullable(),
  // What the service listed, in its order.
  files: z.array(bundleFileSchema),
  // The files the service could say nothing of, and those past the most listed.
  unavailable: z.number(),
  leftOut: z.number(),
  // The folder downloads went to when it was added: its files go there.
  directory: z.string(),
  createdAt: z.string(),
});
export type BundleRecord = z.infer<typeof bundleRecordSchema>;

// A setting added after a state was written is read with its default, and so is one whose
// stored value the bounds of today refuse: the file loads with its downloads, it is not set
// aside as unreadable for one setting.
const storedSettingsSchema = settingsSchema.extend({
  speedLimitBytesPerSecond: settingsSchema.shape.speedLimitBytesPerSecond.catch(null),
  theme: settingsSchema.shape.theme.catch(DEFAULT_THEME),
  betaUpdates: settingsSchema.shape.betaUpdates.catch(false),
  watchClipboard: settingsSchema.shape.watchClipboard.catch(false),
});

// On Windows a rename onto a file another process holds open fails, for as long as it holds it:
// an antivirus scanning it, the indexer, a backup (#151). A save waits for it, a while.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_TRIES = 40;
const RENAME_WAIT_MS = 50;

async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let tries = 1; ; tries += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!BUSY.has(code) || tries >= RENAME_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_WAIT_MS));
    }
  }
}

export const stateSchema = z.object({
  version: z.literal(1),
  settings: storedSettingsSchema,
  downloads: z.array(recordSchema),
  // A state written before magnets has none; one a later version cannot read loses its magnets,
  // never its downloads.
  magnets: z.array(magnetRecordSchema).catch([]),
  // Likewise of the links that open into several files (#181).
  bundles: z.array(bundleRecordSchema).catch([]),
});
export type PersistedState = z.infer<typeof stateSchema>;

export interface StateStore {
  // Undefined on a first start.
  load(): Promise<PersistedState | undefined>;
  save(state: PersistedState): Promise<void>;
}

export class JsonStateStore implements StateStore {
  readonly #path: string;
  #saving: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<PersistedState | undefined> {
    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      return stateSchema.parse(JSON.parse(text));
    } catch {
      // Kept beside the new one: a state nobody can read is still evidence.
      await rename(this.#path, `${this.#path}.unreadable`);
      return undefined;
    }
  }

  // One write at a time, each a whole file renamed into place: a crash leaves the old state or
  // the new one, never half of either.
  save(state: PersistedState): Promise<void> {
    const text = JSON.stringify(state);
    const write = async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, text);
      await renameWhenFree(temporary, this.#path);
    };
    this.#saving = this.#saving.then(write, write);
    return this.#saving;
  }
}
