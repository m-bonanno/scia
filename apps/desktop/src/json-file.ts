import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThemeStore } from './engine/remembered-theme.ts';
import type { NoticeStore } from './engine/shown-notices.ts';

// A small file of main's in the profile: the notices already shown, the theme of the next start.
// Undefined while there is none; what it holds is checked by whoever reads it.
export class JsonFile implements NoticeStore, ThemeStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.#path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: unknown): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, this.#path);
  }
}
