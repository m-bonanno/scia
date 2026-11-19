import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markerFor } from './origin-mark.ts';
import { scratchFolder } from './testing/scratch.ts';

describe('markerFor', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let file: string;

  beforeEach(async () => {
    folder = await scratchFolder();
    file = join(folder.path, 'setup.exe');
    await writeFile(file, 'bytes');
  });
  afterEach(async () => {
    await folder.remove();
  });

  it('writes nothing where Scia knows no mark of the system', async () => {
    await markerFor('linux')(file);

    expect(await readdir(folder.path)).toEqual(['setup.exe']);
    expect(await readFile(file, 'utf8')).toBe('bytes');
  });

  it.runIf(process.platform === 'win32')(
    'on Windows, says the file came from the Internet and not from where',
    async () => {
      await markerFor('win32')(file);

      expect(await readFile(`${file}:Zone.Identifier`, 'utf8')).toBe(
        '[ZoneTransfer]\r\nZoneId=3\r\n',
      );
      expect(await readFile(file, 'utf8')).toBe('bytes');
    },
  );
});
