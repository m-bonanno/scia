import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { segmentSchema, settingsSchema } from '@scia/contracts';
import { DEFAULT_THEME } from '@scia/contracts/theme';
import { z } from 'zod';

export const recordSchema = z.object({
  id: z.string(),
  url: z.string(),
  referrer: z.string().nullable(),
  directory: z.string(),
  fileName: z.string(),
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
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type DownloadRecord = z.infer<typeof recordSchema>;

// A setting added after a state was written is read with its default, and so is one whose
// stored value the bounds of today refuse: the file loads with its downloads, it is not set
// aside as unreadable for one setting.
const storedSettingsSchema = settingsSchema.extend({
  speedLimitBytesPerSecond: settingsSchema.shape.speedLimitBytesPerSecond.catch(null),
  theme: settingsSchema.shape.theme.catch(DEFAULT_THEME),
});

export const stateSchema = z.object({
  version: z.literal(1),
  settings: storedSettingsSchema,
  downloads: z.array(recordSchema),
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
      await rename(temporary, this.#path);
    };
    this.#saving = this.#saving.then(write, write);
    return this.#saving;
  }
}
