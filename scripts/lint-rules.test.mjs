import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// eslint.config.js as `npm run lint` reads it, with type-aware linting off: the examples are text
// at paths no tsconfig holds, and the rules held here read no types.
const eslint = new ESLint({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const RULES = new Set(['no-restricted-syntax', 'scia/no-fixed-sleep']);

async function flagsOf(filePath, code) {
  const [{ messages }] = await eslint.lintText(code, { filePath });
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${filePath} does not parse: ${fatal.message}`);
  return messages.filter((message) => RULES.has(message.ruleId)).map(({ message }) => message);
}

const COMPONENT = 'apps/renderer/src/features/downloads/example.tsx';
const PAGE_MODULE = 'apps/renderer/src/components/example.ts';
const RENDERER_SPEC = 'apps/renderer/src/features/downloads/example.test.tsx';
const CORE = 'packages/core/src/example.ts';
const CORE_SPEC = 'packages/core/src/example.test.ts';
const ENGINE = 'apps/server/src/example.ts';
const ENGINE_SPEC = 'apps/server/src/example.int.test.ts';
const E2E_SPEC = 'apps/desktop/e2e/example.e2e.test.ts';
const E2E_HELPER = 'apps/desktop/e2e/example.ts';
const SCRIPT = 'scripts/example.mjs';
const SCRIPT_SPEC = 'scripts/example.test.mjs';

// The page's code: a component, and a module such as components/button-styles.ts.
const PAGE = [COMPONENT, PAGE_MODULE];

const RAW_COLOUR = expect.stringMatching(/^A raw colour/);
const DARK = expect.stringMatching(/^No `dark:` variant/);
const TO_FIXED = expect.stringMatching(/^Never `toFixed`/);
const SEPARATOR = expect.stringMatching(/^A hard-coded `\\` separator/);
const SLEEP = expect.stringMatching(/^A fixed sleep/);
const TEMP_FOLDER = expect.stringMatching(/^A folder of a fixed name/);
const WALL_CLOCK = expect.stringMatching(/^Take the time as an argument/);

const asText = (text) => `export const a = '${text}';`;

describe('raw colours in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ['#fff'],
    ['#fff8'],
    ['#1e1e1e'],
    ['#00000080'],
    ['#FFF'],
    ['bg-[#1e1e1e]'],
    ['shadow-[0_0_0_1px_#fff]'],
    ['color: #fff;'],
  ])('flags a hex: %s', async (text) => {
    for (const path of PAGE) expect(await flagsOf(path, asText(text))).toEqual([RAW_COLOUR]);
  });

  it.each([
    ['rgb(0 0 0)'],
    ['rgba(0, 0, 0, 0.5)'],
    ['hsl(0 0% 0%)'],
    ['hsla(0, 0%, 0%, 0.5)'],
    ['hwb(0 0% 0%)'],
    ['lab(50% 0 0)'],
    ['lch(50% 0 0)'],
    ['oklab(0.5 0 0)'],
    ['oklch(0.7 0.1 200)'],
    ['color(srgb 0 0 0)'],
    ['color-mix(in srgb, var(--accent), transparent)'],
  ])('flags a colour function: %s', async (text) => {
    for (const path of PAGE) expect(await flagsOf(path, asText(text))).toEqual([RAW_COLOUR]);
  });

  it.each([
    ['bg'],
    ['text'],
    ['border'],
    ['border-x'],
    ['border-y'],
    ['border-t'],
    ['border-r'],
    ['border-b'],
    ['border-l'],
    ['border-s'],
    ['border-e'],
    ['outline'],
    ['ring'],
    ['ring-offset'],
    ['inset-ring'],
    ['shadow'],
    ['inset-shadow'],
    ['text-shadow'],
    ['drop-shadow'],
    ['fill'],
    ['stroke'],
    ['from'],
    ['via'],
    ['to'],
    ['decoration'],
    ['accent'],
    ['caret'],
    ['divide'],
    ['placeholder'],
  ])('flags each utility of Tailwind that takes its palette: %s-red-500', async (utility) => {
    for (const path of PAGE) {
      expect(await flagsOf(path, asText(`${utility}-red-500`))).toEqual([RAW_COLOUR]);
    }
  });

  it.each([
    ['slate'],
    ['gray'],
    ['zinc'],
    ['neutral'],
    ['stone'],
    ['mauve'],
    ['olive'],
    ['mist'],
    ['taupe'],
    ['red'],
    ['orange'],
    ['amber'],
    ['yellow'],
    ['lime'],
    ['green'],
    ['emerald'],
    ['teal'],
    ['cyan'],
    ['sky'],
    ['blue'],
    ['indigo'],
    ['violet'],
    ['purple'],
    ['fuchsia'],
    ['pink'],
    ['rose'],
  ])('flags each palette of Tailwind: bg-%s-500', async (palette) => {
    for (const path of PAGE) {
      expect(await flagsOf(path, asText(`bg-${palette}-500`))).toEqual([RAW_COLOUR]);
    }
  });

  it.each([
    ['text-white'],
    ['bg-black'],
    ['bg-red-50'],
    ['bg-red-950'],
    ['hover:bg-red-500'],
    ['!bg-red-500'],
    ['bg-red-500!'],
    ['bg-red-500/50'],
    ['border-zinc-200 bg-surface'],
  ])('flags a class of the palette wherever it stands: %s', async (text) => {
    for (const path of PAGE) expect(await flagsOf(path, asText(text))).toEqual([RAW_COLOUR]);
  });

  it('flags a raw colour in a template and in JSX', async () => {
    expect(
      await flagsOf(COMPONENT, 'export const a = (hue: number) => `hsl(${String(hue)} 50% 50%)`;'),
    ).toEqual([RAW_COLOUR]);
    expect(
      await flagsOf(COMPONENT, 'export const A = () => <div className="text-black" />;'),
    ).toEqual([RAW_COLOUR]);
  });

  it('flags an id or an issue number spelled in hex digits: the trade of a rule that reads text', async () => {
    expect(await flagsOf(COMPONENT, asText('#add'))).toEqual([RAW_COLOUR]);
    expect(await flagsOf(COMPONENT, asText('(#138)'))).toEqual([RAW_COLOUR]);
  });

  it.each([
    ['bg-surface text-muted-foreground'],
    ['text-accent-foreground outline-ring'],
    ['bg-surface-hover'],
    ['bg-transparent'],
    ['text-whitesmoke'],
    ['collab(2)'],
    ['#main'],
    ['#fade-in'],
    ['#abcde'],
    ['#1234567'],
    ['note#fff'],
    ['1#fff'],
    ['x-#fff'],
  ])('leaves a token, and a hex that does not stand alone, alone: %s', async (text) => {
    for (const path of PAGE) expect(await flagsOf(path, asText(text))).toEqual([]);
  });

  it('leaves the renderer’s specs to their own words, an issue number among them', async () => {
    expect(await flagsOf(RENDERER_SPEC, asText('keeps the bar (#138)'))).toEqual([]);
  });
});

describe('the `dark:` variant in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ["export const a = 'dark:bg-surface';"],
    ["export const a = 'bg-surface dark:bg-background';"],
    ["export const a = 'hover:dark:text-foreground';"],
    ['export const a = (on: boolean) => `${on ? "x" : ""} dark:text-foreground`;'],
  ])('flags %s', async (code) => {
    for (const path of PAGE) expect(await flagsOf(path, code)).toEqual([DARK]);
  });

  it.each([["export const a = 'the dark variant';"], ["export const a = 'theme-dark:x';"]])(
    'leaves the word alone: %s',
    async (code) => {
      for (const path of PAGE) expect(await flagsOf(path, code)).toEqual([]);
    },
  );
});

describe('`toFixed` in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ['export const a = (n: number) => n.toFixed(1);'],
    ['export const a = (n?: number) => n?.toFixed(1);'],
    ["export const a = (n: number) => n['toFixed'](1);"],
    ['export const a = (ns: number[]) => ns.map((n) => n.toFixed(0)).join(", ");'],
  ])('flags %s', async (code) => {
    for (const path of PAGE) expect(await flagsOf(path, code)).toEqual([TO_FIXED]);
  });

  it('leaves the engine and the renderer’s specs alone', async () => {
    const code = 'export const a = (n: number) => n.toFixed(1);';

    expect(await flagsOf(ENGINE, code)).toEqual([]);
    expect(await flagsOf(RENDERER_SPEC, code)).toEqual([]);
  });
});

describe('a hard-coded `\\` separator in a spec (docs/development/testing.md)', () => {
  it.each([
    ['export const p = (name: string) => `C:\\\\Users\\\\${name}`;'],
    ['export const p = (dir: string) => `${dir}\\\\file.txt`;'],
    ["export const p = (dir: string) => dir + '\\\\file.txt';"],
    ["export const p = (name: string) => 'C:\\\\' + name;"],
    ["export const p = (parts: string[]) => parts.join('\\\\');"],
    ["export const p = (key: string) => key.split('\\\\');"],
  ])('flags %s', async (code) => {
    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([SEPARATOR]);
  });

  it('flags it in a spec of a script too', async () => {
    expect(await flagsOf(SCRIPT_SPEC, "export const p = (dir) => dir + '\\\\file.txt';")).toEqual([
      SEPARATOR,
    ]);
  });

  it.each([
    ["export const p = 'C:\\\\Windows';"],
    ['export const p = `C:\\\\Windows\\\\`;'],
    ['export const p = `\\\\\\\\server\\\\share`;'],
    ['export const p = (line: string) => `${line}\\n`;'],
    ["import { join } from 'node:path';\nexport const p = (dir: string) => join(dir, 'file.txt');"],
  ])('leaves a path that is a value, or built with `join`, alone: %s', async (code) => {
    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([]);
  });

  it('leaves the engine alone, which builds the paths of the system it runs on', async () => {
    expect(
      await flagsOf(ENGINE, "export const p = (dir: string) => dir + '\\\\file.txt';"),
    ).toEqual([]);
  });
});

describe('a fixed sleep in a spec (docs/development/testing.md)', () => {
  it.each([
    ['await new Promise((resolve) => setTimeout(resolve, 50));'],
    ['await new Promise((resolve) => {\n  setTimeout(resolve, 50);\n});'],
    ['await new Promise(function (resolve) {\n  setTimeout(resolve, 50);\n});'],
    [
      'let done;\nawait new Promise((resolve) => {\n  done = resolve;\n  setTimeout(resolve, 50);\n});',
    ],
    ['await new Promise((resolve) => {\n  const timer = setTimeout(resolve, 50);\n});'],
    ['await new Promise((resolve) => {\n  return setTimeout(resolve, 50);\n});'],
    ['await new Promise<void>((resolve) => void setTimeout(resolve, 50));'],
    ['export const slow = () => new Promise((resolve) => setTimeout(() => resolve(1), 50));'],
    [
      'await new Promise<void>((resolve) => {\n  setTimeout(() => {\n    resolve();\n  }, 50);\n});',
    ],
    ['export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));'],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(50);"],
    ["import { setTimeout } from 'timers/promises';\nawait setTimeout(50);"],
    ["import * as timers from 'node:timers/promises';\nawait timers.setTimeout(50);"],
    ["import timers from 'node:timers/promises';\nawait timers.setTimeout(50);"],
    ["import { scheduler } from 'node:timers/promises';\nawait scheduler.wait(50);"],
    ["import * as timers from 'node:timers/promises';\nawait timers.scheduler.wait(50);"],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nexport const pause = sleep;"],
    ["import * as timers from 'node:timers/promises';\nexport const pause = timers.setTimeout;"],
  ])('flags %s', async (code) => {
    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([SLEEP]);
  });

  it('flags a page left to wait', async () => {
    const code =
      'declare const page: { waitForTimeout(ms: number): Promise<void> };\nawait page.waitForTimeout(50);';

    expect(await flagsOf(E2E_SPEC, code)).toEqual([SLEEP]);
  });

  it('flags each wait of a sleep imported once', async () => {
    const code =
      "import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(50);\nawait sleep(60);";

    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([SLEEP, SLEEP]);
  });

  it('flags a sleep handed to a call, whatever that call is given first', async () => {
    const code =
      "import { setTimeout as sleep } from 'node:timers/promises';\ndeclare const later: (ms: number, wait: unknown) => void;\nlater(0, sleep);";

    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([SLEEP]);
  });

  it('flags it in a spec of the domain, of the renderer and of a script', async () => {
    const code = 'await new Promise((resolve) => setTimeout(resolve, 50));';

    expect(await flagsOf(CORE_SPEC, code)).toEqual([SLEEP]);
    expect(await flagsOf(RENDERER_SPEC, code)).toEqual([SLEEP]);
    expect(await flagsOf(SCRIPT_SPEC, code)).toEqual([SLEEP]);
  });

  it.each([
    [
      "declare const child: { on(event: 'exit', listener: () => void): void; kill(): void };\nawait new Promise<void>((resolve) => {\n  child.on('exit', resolve);\n  setTimeout(() => child.kill(), 5000);\n});",
    ],
    [
      "declare const socket: { once(event: 'connect', listener: () => void): void };\nawait new Promise<void>((resolve, reject) => {\n  socket.once('connect', resolve);\n  setTimeout(() => reject(new Error('no connect')), 2000);\n});",
    ],
    [
      "export const late = new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 50));",
    ],
    ['declare const done: () => void;\nawait new Promise(() => setTimeout(done, 50));'],
    [
      "declare const child: { on(event: 'exit', listener: () => void): void; kill(): void };\nawait new Promise<void>((resolve) => {\n  child.on('exit', () => resolve());\n  setTimeout(() => child.kill(), 5000);\n});",
    ],
    [
      'declare const waiting: Array<() => void>;\nawait new Promise<void>((resolve) => setTimeout(() => waiting.push(resolve), 50));',
    ],
    [
      'declare const poll: (done: () => void, ms: number) => void;\nawait new Promise<void>((resolve) => poll(resolve, 50));',
    ],
  ])('leaves a deadline on a wait for a state alone: %s', async (code) => {
    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([]);
  });

  it.each([
    ['await new Promise((resolve) => setTimeout(resolve, 0));'],
    ['await new Promise((resolve) => setTimeout(resolve));'],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(0);"],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep();"],
    ["import { scheduler } from 'node:timers/promises';\nawait scheduler.wait(0);"],
    ["import { scheduler } from 'node:timers/promises';\nawait scheduler.yield();"],
    ["import * as timers from 'node:timers/promises';\nawait timers.scheduler.yield();"],
    ["import { scheduler } from 'node:timers/promises';\nexport const next = scheduler.yield;"],
    ["import { setImmediate } from 'node:timers/promises';\nawait setImmediate();"],
    ["import * as timers from 'node:timers/promises';\nawait timers.setImmediate();"],
    ['await new Promise((resolve) => setImmediate(resolve));'],
    [
      'declare const page: { waitForTimeout(ms: number): Promise<void> };\nawait page.waitForTimeout(0);',
    ],
    ['declare const held: { close(): void };\nsetTimeout(() => {\n  held.close();\n}, 300);'],
    ['declare const until: (done: () => boolean) => Promise<void>;\nawait until(() => true);'],
    ['declare const run: (resolve: () => void) => void;\nawait new Promise<void>(run);'],
    [
      'declare const ready: boolean;\nawait new Promise<void>((resolve) => {\n  if (ready) resolve();\n});',
    ],
    ["import { setTimeout } from 'node:timers';\nsetTimeout(() => undefined, 50);"],
  ])('leaves a turn, a timer that acts and a wait for a state alone: %s', async (code) => {
    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([]);
  });

  it('takes a wait that is the case itself, said where it stands', async () => {
    const code =
      '// eslint-disable-next-line scia/no-fixed-sleep -- the case itself: a stretch with no request\nawait new Promise((resolve) => setTimeout(resolve, 800));';

    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([]);
  });

  it('leaves the code that is not a spec alone', async () => {
    const code = 'await new Promise((resolve) => setTimeout(resolve, 50));';

    expect(await flagsOf(ENGINE, code)).toEqual([]);
    expect(await flagsOf(E2E_HELPER, code)).toEqual([]);
  });
});

describe('a folder of a fixed name in the system’s temporary folder (#371)', () => {
  it.each([
    [
      "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = join(tmpdir(), 'scia-captures');",
    ],
    [
      "import os from 'node:os';\nimport path from 'node:path';\nexport const f = path.join(os.tmpdir(), 'scia');",
    ],
    [
      "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = join(tmpdir(), `scia-captures`);",
    ],
    [
      "import { tmpdir } from 'node:os';\nimport { resolve } from 'node:path';\nexport const f = resolve(tmpdir(), 'scia', 'runs');",
    ],
  ])('flags %s', async (code) => {
    expect(await flagsOf(ENGINE, code)).toEqual([TEMP_FOLDER]);
  });

  it('flags it in every kind of file', async () => {
    const code =
      "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = join(tmpdir(), 'scia');";

    expect(await flagsOf(ENGINE_SPEC, code)).toEqual([TEMP_FOLDER]);
    expect(await flagsOf(E2E_HELPER, code)).toEqual([TEMP_FOLDER]);
    expect(await flagsOf(SCRIPT, code)).toEqual([TEMP_FOLDER]);
    expect(await flagsOf(SCRIPT_SPEC, code)).toEqual([TEMP_FOLDER]);
    expect(await flagsOf(CORE, code)).toEqual([TEMP_FOLDER]);
    expect(await flagsOf(COMPONENT, code)).toEqual([TEMP_FOLDER]);
  });

  it.each([
    [
      "import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = mkdtempSync(join(tmpdir(), 'scia-test-'));",
    ],
    [
      "import { mkdtemp } from 'node:fs/promises';\nimport os from 'node:os';\nimport path from 'node:path';\nexport const f = await mkdtemp(path.join(os.tmpdir(), 'scia-'));",
    ],
    [
      "import fs from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = fs.mkdtempSync(join(tmpdir(), 'scia-'));",
    ],
    [
      "import fsp from 'node:fs/promises';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = await fsp.mkdtemp(join(tmpdir(), 'scia-'));",
    ],
    ["import { tmpdir } from 'node:os';\nexport const f = tmpdir();"],
  ])('leaves a folder made whole by `mkdtemp` alone: %s', async (code) => {
    expect(await flagsOf(ENGINE, code)).toEqual([]);
  });

  it('leaves a name built with a value to the review: the rule is the literal name', async () => {
    const code =
      "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const f = (id: string) => join(tmpdir(), `scia-${id}`);";

    expect(await flagsOf(ENGINE, code)).toEqual([]);
  });
});

describe('each group of files keeps every rule that is its own', () => {
  it('keeps the domain off the wall clock beside the temporary folder', async () => {
    expect(await flagsOf(CORE, 'export const now = () => Date.now();')).toEqual([WALL_CLOCK]);
  });

  it('flags a raw colour and `toFixed` on one line of a component', async () => {
    const code = 'export const a = (n: number) => `${n.toFixed(1)} text-white`;';

    expect(await flagsOf(COMPONENT, code)).toEqual([TO_FIXED, RAW_COLOUR]);
  });
});
