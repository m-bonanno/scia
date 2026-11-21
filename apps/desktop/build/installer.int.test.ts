import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scratchFolder } from '@scia/server/testing/scratch.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const INCLUDE = join(import.meta.dirname, 'installer.nsh');
const BUILDER_CONFIG = join(import.meta.dirname, '..', 'electron-builder.yml');

interface MakeNsis {
  readonly path: string;
  readonly env?: Record<string, string>;
}

// The makensis electron-builder packs the installer with, at the version and checksum it pins:
// fetched once into its cache, as `npm run dist` does.
const makensis = async (): Promise<MakeNsis> => {
  const builder = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  const toolsets = builder('app-builder-lib/out/toolsets/windows.js') as {
    getMakeNsisPath: (nsis?: string, custom?: unknown) => Promise<MakeNsis>;
  };
  return toolsets.getMakeNsisPath(undefined, undefined);
};

// A program made of the installer's own include, which answers for one pair of versions what the
// installer decides: their order, and the words of a refusal.
const harness = (include: string) => `
Unicode true
Name "harness"
OutFile "harness.exe"
RequestExecutionLevel user
SilentInstall silent
!define PRODUCT_NAME "Scia"
!include FileFunc.nsh
!include "${include}"

Function .onInit
  \${GetParameters} $0
  \${GetOptions} $0 "/installed=" $1
  \${GetOptions} $0 "/this=" $2
  Push $1
  Push $2
  Call SciaVersionOrder
  Pop $3
  Push $1
  Push $2
  Call SciaRefusal
  Pop $4
  FileOpen $5 "$EXEDIR\\answer.txt" w
  FileWrite $5 "$3|$4"
  FileClose $5
  SetErrorLevel 0
  Quit
FunctionEnd

Section
SectionEnd
`;

// The program NSIS makes is a Windows program.
describe.runIf(process.platform === 'win32')('the installer, before it installs', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;

  beforeAll(async () => {
    folder = await scratchFolder();
    const nsis = await makensis();
    await writeFile(join(folder.path, 'harness.nsi'), harness(INCLUDE));
    await run(nsis.path, ['-V2', 'harness.nsi'], {
      cwd: folder.path,
      env: { ...process.env, ...nsis.env },
      timeout: 60_000,
    });
  }, 120_000);

  afterAll(async () => {
    await folder.remove();
  });

  const decide = async (installed: string, version: string) => {
    await run(join(folder.path, 'harness.exe'), [`/installed=${installed}`, `/this=${version}`], {
      timeout: 10_000,
    });
    const [order, refusal] = (await readFile(join(folder.path, 'answer.txt'), 'utf8')).split('|');
    return { order, refusal };
  };

  const orderOf = async (a: string, b: string) => (await decide(a, b)).order;

  describe('orders two versions as semantic versions', () => {
    // The precedence that semver.org gives as its example, oldest first.
    const ascending = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];

    it.each(ascending.slice(1).map((newer, index) => [ascending[index]!, newer]))(
      '%s is older than %s, and the reverse',
      async (older, newer) => {
        expect(await orderOf(older, newer)).toBe('-1');
        expect(await orderOf(newer, older)).toBe('1');
      },
    );

    it.each([
      ['1.0.0-beta.17', '1.0.0-beta.20', '-1'],
      ['1.0.0-beta.20', '1.0.0-beta.17', '1'],
      ['1.0.0-beta.9', '1.0.0-beta.10', '-1'],
      ['1.0.0', '1.0.0-beta.20', '1'],
      ['1.0.0-beta.20', '1.0.0', '-1'],
      ['1.0.0-beta.20.local', '1.0.0-beta.20', '1'],
      ['1.0.0-beta.2', '1.0.0-beta.local', '-1'],
      ['1.0.0-Beta', '1.0.0-beta', '-1'],
      ['1.0.0-beta-2', '1.0.0-beta-10', '1'],
      ['0.0.0', '1.0.0-beta.20', '-1'],
      ['1.10.0', '1.9.0', '1'],
      ['2.0.0', '10.0.0', '-1'],
      ['1.0.1', '1.0.0', '1'],
      ['1.0.0-beta.20', '1.0.0-beta.20', '0'],
      ['1.0.0', '1.0.0', '0'],
      ['1.0.0+5', '1.0.0+6', '0'],
      ['1.0.0-beta.1+a', '1.0.0-beta.1', '0'],
    ])('%s against %s: %s', async (a, b, order) => {
      expect(await orderOf(a, b)).toBe(order);
    });

    it.each([
      '',
      'garbage',
      'v1.0.0',
      '1.0',
      '1.0.0.0',
      '1..0',
      '01.0.0',
      '1.-1.0',
      '1.0.0-',
      '1.0.0-beta..1',
      '1.0.0-beta.',
      '99999999999.0.0',
    ])('reads no order from "%s", a version it cannot read', async (unreadable) => {
      expect(await orderOf(unreadable, '1.0.0')).toBe('');
      expect(await orderOf('1.0.0', unreadable)).toBe('');
    });
  });

  describe('refuses only a version older than the one installed', () => {
    it('refuses beta.17 over beta.20, in the words the owner chose (#172)', async () => {
      expect((await decide('1.0.0-beta.20', '1.0.0-beta.17')).refusal).toBe(
        "Scia 1.0.0-beta.20 is already installed, and it is newer than this installer's 1.0.0-beta.17. To install 1.0.0-beta.17, uninstall Scia first: your downloads and settings are kept.",
      );
    });

    it('refuses a beta over its stable', async () => {
      expect((await decide('1.0.0', '1.0.0-beta.20')).refusal).not.toBe('');
    });

    it('refuses a build made here, at 0.0.0, like any older version', async () => {
      expect((await decide('1.0.0-beta.20', '0.0.0')).refusal).not.toBe('');
    });

    it.each([
      ['a newer version', '1.0.0-beta.17', '1.0.0-beta.20'],
      ['the stable over its betas', '1.0.0-beta.20', '1.0.0'],
      ['the same version again, as a repair', '1.0.0-beta.20', '1.0.0-beta.20'],
      ['over no Scia', '', '1.0.0-beta.20'],
      ['over a version it cannot read', 'garbage', '1.0.0-beta.20'],
    ])('installs %s', async (_case, installed, version) => {
      expect((await decide(installed, version)).refusal).toBe('');
    });
  });

  // The refusal says the downloads and settings are kept: true while the uninstaller keeps the
  // app's data.
  it('promises what the uninstaller keeps', async () => {
    expect(await readFile(BUILDER_CONFIG, 'utf8')).toMatch(/^\s*deleteAppDataOnUninstall: false$/m);
  });
});
