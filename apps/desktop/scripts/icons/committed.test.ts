import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOW_COLOURS } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { readIcoDirectory } from './ico.ts';
import { DESKTOP_DIR, ICON_LOCK, ICON_OUTPUTS, ICON_SOURCE, type IconLock } from './outputs.ts';

// The icons are committed, drawn by `npm run icons -w @scia/desktop`: these specs fail when the
// source or an icon changed without the other.

const read = (path: string): Buffer => readFileSync(join(DESKTOP_DIR, path));
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const lock = JSON.parse(read(ICON_LOCK).toString('utf8')) as IconLock;

// A key two spaces under a section at the top of a YAML file, wherever it is in the section:
// the repository has no YAML parser, and the config has no deeper nesting to tell apart.
function childOf(yaml: string, section: string, key: string): string | undefined {
  const block = new RegExp(`^${section}:[ \\t]*\\n((?:[ \\t]+.*\\n|[ \\t]*\\n)*)`, 'm').exec(
    yaml,
  )?.[1];
  return new RegExp(`^  ${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(block ?? '')?.[1];
}

describe('the committed icons', () => {
  it('were drawn from the source as it is now', () => {
    expect(lock.source).toBe(sha256(read(ICON_SOURCE)));
  });

  it('are each the file the script wrote', () => {
    for (const output of ICON_OUTPUTS)
      expect({ [output.path]: sha256(read(output.path)) }).toEqual({
        [output.path]: lock.outputs[output.path],
      });
  });

  it('are the outputs of the list, and no other', () => {
    expect(Object.keys(lock.outputs).sort()).toEqual(ICON_OUTPUTS.map((o) => o.path).sort());
  });

  it('give the exe an icon holding every size of the list', () => {
    expect(readIcoDirectory(read('assets/icon.ico')).map((entry) => entry.size)).toEqual(
      ICON_OUTPUTS.find((output) => output.path === 'assets/icon.ico')?.sizes,
    );
  });

  // electron-builder reads its own file: these are the paths it is given — the .ico for Windows,
  // and for Linux the folder that holds the PNGs of the list and nothing else of it.
  it('are the ones the packager is given', () => {
    const config = read('electron-builder.yml').toString('utf8');
    const linuxFolder = 'build/icons';

    expect(childOf(config, 'win', 'icon')).toBe('assets/icon.ico');
    expect(childOf(config, 'linux', 'icon')).toBe(linuxFolder);
    expect(
      ICON_OUTPUTS.filter((output) => output.path.startsWith(`${linuxFolder}/`)).map(
        (output) => output.sizes,
      ),
    ).toEqual([16, 24, 32, 48, 64, 128, 256, 512].map((size) => [size]));
  });

  // The owner's choice (#81): the mark in the default theme's dark variant, the colours the
  // window wears. A change of Black Tie fails here until the icon is drawn again.
  it('wear the default theme’s dark variant: its foreground on its background', () => {
    const svg = read(ICON_SOURCE).toString('utf8');
    const { background, foreground } = WINDOW_COLOURS['black-tie'].dark;

    expect(/<rect[^>]*\bfill="([^"]+)"/.exec(svg)?.[1]).toBe(background);
    expect(/<g[^>]*\bstroke="([^"]+)"/.exec(svg)?.[1]).toBe(foreground);
  });
});
