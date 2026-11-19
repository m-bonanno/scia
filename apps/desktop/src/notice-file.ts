import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NoticeStore } from './engine/shown-notices.ts';

// The notices already shown on this computer, in a small file of the profile.
export class NoticeFile implements NoticeStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async write(shown: readonly string[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, JSON.stringify(shown));
    await rename(temporary, this.#path);
  }
}
