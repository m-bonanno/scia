import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scratchFolder, until } from '@scia/server/testing/scratch.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const INCLUDE = join(import.meta.dirname, 'installer.nsh');
const BUILDER_CONFIG = join(import.meta.dirname, '..', 'electron-builder.yml');
// Windows' ERROR_PRODUCT_VERSION, which a refused install ends with.
const REFUSED = 1638;

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
// installer decides: their order, the words of a refusal, and what is left on NSIS's stack, which
// the installer shares with electron-builder's own script.
const deciding = (include: string) => `
Unicode true
Name "deciding"
OutFile "deciding.exe"
RequestExecutionLevel user
SilentInstall silent
!define PRODUCT_NAME "Scia"
!include FileFunc.nsh
!include "${include}"

Function .onInit
  \${GetParameters} $0
  \${GetOptions} $0 "/installed=" $1
  \${GetOptions} $0 "/this=" $2
  Push "stack"
  Push $1
  Push $2
  Call SciaVersionOrder
  Pop $3
  Push $1
  Push $2
  Call SciaRefusal
  Pop $4
  Pop $5
  FileOpen $6 "$EXEDIR\\answer.txt" w
  FileWrite $6 "$3|$4|$5"
  FileClose $6
  SetErrorLevel 0
  Quit
FunctionEnd

Section
SectionEnd
`;

// An installer of a given version made of the include's own customInit, run where electron-builder
// runs it, which reads the version installed from a key of the spec's: when it installs, it writes
// what it finds on top of NSIS's stack, which electron-builder's .onInit shares — or that the
// error flag, which electron-builder's script reads too, was left set.
const installing = (include: string, version: string, key: string) => `
Unicode true
Name "Scia"
OutFile "installing.exe"
RequestExecutionLevel user
!define PRODUCT_NAME "Scia"
!define VERSION "${version}"
!define UNINSTALL_REGISTRY_KEY "${key}"
!include "${include}"

Function .onInit
  Push "stack"
  !insertmacro customInit
FunctionEnd

Section
  Pop $1
  IfErrors 0 +2
    StrCpy $1 "error flag set"
  FileOpen $0 "$EXEDIR\\installed.txt" w
  FileWrite $0 $1
  FileClose $0
SectionEnd
`;

// A program made of the include's own SciaEndSessionOf, which tells the program named by /target=
// that its session ends, as the installer tells a Scia that runs: it writes how many windows it
// told, how many were left when it stopped waiting, and what is on top of NSIS's stack.
const ending = (include: string) => `
Unicode true
Name "ending"
OutFile "ending.exe"
RequestExecutionLevel user
SilentInstall silent
!define PRODUCT_NAME "Scia"
!include FileFunc.nsh
!include "${include}"

Function .onInit
  \${GetParameters} $0
  \${GetOptions} $0 "/target=" $1
  Push "stack"
  StrCpy $SciaTarget $1
  Call SciaEndSessionOf
  Pop $2
  FileOpen $3 "$EXEDIR\\ended.txt" w
  FileWrite $3 "$SciaTold|$SciaLeft|$2"
  FileClose $3
  SetErrorLevel 0
  Quit
FunctionEnd

Section
SectionEnd
`;

// A program with one hidden top-level window of Chromium's class, as a Scia's window is, which
// writes what WM_ENDSESSION said to it and ends — run by Windows PowerShell, whose path the spec
// names as the program to tell. Never shown.
const FAKE_WINDOW = `
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class SciaFakeWindow {
  private delegate IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WindowClass {
    public uint style;
    public WindowProc proc;
    public int classExtra;
    public int windowExtra;
    public IntPtr instance;
    public IntPtr icon;
    public IntPtr cursor;
    public IntPtr background;
    public string menu;
    public string name;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Message {
    public IntPtr window;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int x;
    public int y;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr GetModuleHandleW(string name);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern ushort RegisterClassW(ref WindowClass windowClass);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateWindowExW(uint exStyle, string className, string title,
    uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance,
    IntPtr param);
  [DllImport("user32.dll")]
  private static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam,
    IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern int GetMessageW(out Message message, IntPtr window, uint first, uint last);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessageW(ref Message message);

  private static WindowProc kept;
  private static string answer;

  public static void Run(string answerPath) {
    answer = answerPath;
    kept = Receive;
    IntPtr instance = GetModuleHandleW(null);
    WindowClass windowClass = new WindowClass();
    windowClass.proc = kept;
    windowClass.instance = instance;
    windowClass.name = "Chrome_WidgetWin_1";
    if (RegisterClassW(ref windowClass) == 0) throw new Exception("No window class.");
    IntPtr window = CreateWindowExW(0, "Chrome_WidgetWin_1", "Scia spec", 0, 0, 0, 0, 0,
      IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
    if (window == IntPtr.Zero) throw new Exception("No window.");
    File.WriteAllText(answerPath + ".ready", "");
    Message message;
    while (GetMessageW(out message, IntPtr.Zero, 0, 0) > 0) DispatchMessageW(ref message);
  }

  private static IntPtr Receive(IntPtr window, uint message, IntPtr wParam, IntPtr lParam) {
    if (message == 0x0016) {
      File.WriteAllText(answer, wParam.ToString() + " " + lParam.ToString());
      Environment.Exit(0);
    }
    return DefWindowProcW(window, message, wParam, lParam);
  }
}
`;

const POWERSHELL = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

const exitCodeOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 0,
    (error: unknown) => (error as { code?: unknown }).code,
  );

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// The program NSIS makes is a Windows program.
describe.runIf(process.platform === 'win32')('the installer, before it installs', () => {
  // A key of this run's own, under the person's Software, removed at the end.
  const key = `Software\\Scia-installer-spec-${randomBytes(6).toString('hex')}`;
  let folder: Awaited<ReturnType<typeof scratchFolder>>;

  beforeAll(async () => {
    folder = await scratchFolder();
    const nsis = await makensis();
    const compile = async (name: string, script: string) => {
      await writeFile(join(folder.path, name), script);
      await run(nsis.path, ['-V2', name], {
        cwd: folder.path,
        env: { ...process.env, ...nsis.env },
        timeout: 60_000,
      });
    };
    await compile('deciding.nsi', deciding(INCLUDE));
    await compile('installing.nsi', installing(INCLUDE, '1.0.0', key));
    await compile('ending.nsi', ending(INCLUDE));
  }, 120_000);

  afterAll(async () => {
    await run('reg', ['delete', `HKCU\\${key}`, '/f']).catch(() => undefined);
    await folder.remove();
  });

  const decide = async (installed: string, version: string) => {
    await run(join(folder.path, 'deciding.exe'), [`/installed=${installed}`, `/this=${version}`], {
      timeout: 10_000,
    });
    const [order, refusal, stack] = (await readFile(join(folder.path, 'answer.txt'), 'utf8')).split(
      '|',
    );
    return { order, refusal, stack };
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
      // A number is below every word, also one that begins with a digit.
      ['1.0.0-2', '1.0.0-1a', '-1'],
      ['1.0.0-2a', '1.0.0-3', '1'],
      // "-1" holds a hyphen: a word, above every number.
      ['1.0.0-beta.-1', '1.0.0-beta.1', '1'],
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
      // A build's identifiers may begin with a zero; a prerelease's 0 is a number.
      ['1.0.0+build.01', '1.0.0', '0'],
      ['1.0.0-0', '1.0.0-1', '-1'],
      ['1.0.0-x-y.0', '1.0.0-x-y', '1'],
      // The ASCII order of words reaches the characters the System plug-in is handed.
      ['1.0.0-ZZ', '1.0.0-aa', '-1'],
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
      // A number IntOp cannot read back, in the prerelease too: past 32 bits, or a leading zero.
      '1.0.0-beta.99999999999',
      '1.0.0-beta.01',
      // Characters semver does not allow, in the prerelease and in the build.
      '1.0.0-be_ta',
      '1.0.0-beta"1',
      '1.0.0+',
      '1.0.0+a..b',
      '1.0.0+a+b',
      '1.0.0+a_b',
    ])('reads no order from "%s", a version it cannot read', async (unreadable) => {
      expect(await orderOf(unreadable, '1.0.0')).toBe('');
      expect(await orderOf('1.0.0', unreadable)).toBe('');
    });

    it.each([
      ['two versions', '1.0.0-beta.20', '1.0.0-beta.17'],
      ['an installed version it cannot read', 'garbage', '1.0.0'],
      ['a version of its own it cannot read', '1.0.0', 'garbage'],
    ])('leaves the stack as it found it, for %s', async (_case, installed, version) => {
      expect((await decide(installed, version)).stack).toBe('stack');
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

  // The installer is the one of 1.0.0: a stable, whose first install reads no prerelease, and so
  // nothing else in the include touches the error flag the read of a missing value set.
  describe('stops before it installs, as electron-builder runs it', () => {
    beforeEach(async () => {
      await rm(join(folder.path, 'installed.txt'), { force: true });
    });

    const install = () =>
      exitCodeOf(run(join(folder.path, 'installing.exe'), ['/S'], { timeout: 30_000 }));
    const setInstalled = (version: string) =>
      run('reg', ['add', `HKCU\\${key}`, '/v', 'DisplayVersion', '/d', version, '/f']);

    it('ends a silent install over a newer version with 1638, having installed nothing', async () => {
      await setInstalled('1.0.1');

      expect(await install()).toBe(REFUSED);
      expect(await exists(join(folder.path, 'installed.txt'))).toBe(false);
    });

    it('installs over the same version', async () => {
      await setInstalled('1.0.0');

      expect(await install()).toBe(0);
      expect(await readFile(join(folder.path, 'installed.txt'), 'utf8')).toBe('stack');
    });

    it('installs where no Scia is installed', async () => {
      await run('reg', ['delete', `HKCU\\${key}`, '/f']).catch(() => undefined);

      expect(await install()).toBe(0);
      expect(await readFile(join(folder.path, 'installed.txt'), 'utf8')).toBe('stack');
    });
  });

  // A Scia that runs is told its session ends before electron-builder's check ends it by force:
  // told so, it writes its state and ends by itself (#13).
  describe('tells a program that runs that its session ends', () => {
    const end = async (target: string) => {
      await rm(join(folder.path, 'ended.txt'), { force: true });
      await run(join(folder.path, 'ending.exe'), [`/target=${target}`], { timeout: 60_000 });
      const [told, left, stack] = (await readFile(join(folder.path, 'ended.txt'), 'utf8')).split(
        '|',
      );
      return { told, left, stack };
    };

    it('tells each window of the program, as an installer that needs its files, and waits for it to end', async () => {
      const source = join(folder.path, 'fake-window.cs');
      const answer = join(folder.path, 'fake-window.txt');
      await writeFile(source, FAKE_WINDOW);
      const fake = spawn(
        POWERSHELL,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -Path '${source}'; [SciaFakeWindow]::Run($env:SCIA_FAKE_ANSWER)`,
        ],
        { env: { ...process.env, SCIA_FAKE_ANSWER: answer }, stdio: 'ignore', windowsHide: true },
      );
      const ended = new Promise<void>((done) => {
        fake.once('exit', () => {
          done();
        });
      });
      let gone = false;
      void ended.then(() => {
        gone = true;
      });
      try {
        await until(() => exists(`${answer}.ready`), 45_000);

        const result = await end(POWERSHELL);

        // WM_ENDSESSION: the session ends (1), for this program alone (ENDSESSION_CLOSEAPP, 1).
        expect(await readFile(answer, 'utf8')).toBe('1 1');
        expect(result).toEqual({ told: '1', left: '0', stack: 'stack' });
        await until(() => gone, 5_000);
      } finally {
        fake.kill();
      }
    }, 90_000);

    it('tells nothing, and waits for nothing, where the program does not run', async () => {
      expect(await end(join(folder.path, 'Scia.exe'))).toEqual({
        told: '0',
        left: '0',
        stack: 'stack',
      });
    });
  });

  // The refusal says the downloads and settings are kept: true while the uninstaller keeps the
  // app's data.
  it('promises what the uninstaller keeps', async () => {
    expect(await readFile(BUILDER_CONFIG, 'utf8')).toMatch(/^\s*deleteAppDataOnUninstall: false$/m);
  });
});
