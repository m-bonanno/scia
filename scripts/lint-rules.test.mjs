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
const RENDERER_SPEC = 'apps/renderer/src/features/downloads/example.test.tsx';
const CORE = 'packages/core/src/example.ts';
const CORE_SPEC = 'packages/core/src/example.test.ts';
const ENGINE = 'apps/server/src/example.ts';
const ENGINE_SPEC = 'apps/server/src/example.int.test.ts';
const E2E_SPEC = 'apps/desktop/e2e/example.e2e.test.ts';
const E2E_HELPER = 'apps/desktop/e2e/example.ts';
const SCRIPT = 'scripts/example.mjs';
const SCRIPT_SPEC = 'scripts/example.test.mjs';

const RAW_COLOUR = expect.stringMatching(/^A raw colour/);
const DARK = expect.stringMatching(/^No `dark:` variant/);
const TO_FIXED = expect.stringMatching(/^Never `toFixed`/);
const SEPARATOR = expect.stringMatching(/^A hard-coded `\\` separator/);
const SLEEP = expect.stringMatching(/^A fixed sleep/);
const TEMP_FOLDER = expect.stringMatching(/^A folder of a fixed name/);
const WALL_CLOCK = expect.stringMatching(/^Take the time as an argument/);

describe('raw colours in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ["export const a = 'bg-[#1e1e1e]';"],
    ["export const a = { color: '#fff' };"],
    ["export const a = '#00000080';"],
    ["export const a = 'rgb(0 0 0)';"],
    ["export const a = 'rgba(0, 0, 0, 0.5)';"],
    ['export const a = (hue: number) => `hsl(${String(hue)} 50% 50%)`;'],
    ["export const a = 'oklch(0.7 0.1 200)';"],
    ["export const a = 'text-white';"],
    ["export const a = 'hover:bg-red-500';"],
    ["export const a = 'border-zinc-200 bg-surface';"],
    ['export const A = () => <div className="text-black" />;'],
  ])('flags %s', async (code) => {
    expect(await flagsOf(COMPONENT, code)).toEqual([RAW_COLOUR]);
  });

  it.each([
    ["export const a = 'bg-surface text-muted-foreground';"],
    ["export const a = 'text-accent-foreground outline-ring';"],
    ["export const a = 'bg-transparent';"],
    ["export const a = '#main';"],
    ['export const A = () => <div className="bg-background text-foreground" />;'],
  ])('leaves a token alone: %s', async (code) => {
    expect(await flagsOf(COMPONENT, code)).toEqual([]);
  });

  it('leaves the renderer’s specs to their own words, an issue number among them', async () => {
    expect(await flagsOf(RENDERER_SPEC, "export const name = 'keeps the bar (#138)';")).toEqual([]);
  });
});

describe('the `dark:` variant in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ["export const a = 'dark:bg-surface';"],
    ["export const a = 'bg-surface dark:bg-background';"],
    ["export const a = 'hover:dark:text-foreground';"],
    ['export const a = (on: boolean) => `${on ? "x" : ""} dark:text-foreground`;'],
  ])('flags %s', async (code) => {
    expect(await flagsOf(COMPONENT, code)).toEqual([DARK]);
  });

  it('leaves the word alone', async () => {
    expect(await flagsOf(COMPONENT, "export const a = 'the dark variant';")).toEqual([]);
  });
});

describe('`toFixed` in the renderer (apps/renderer/CLAUDE.md)', () => {
  it.each([
    ['export const a = (n: number) => n.toFixed(1);'],
    ['export const a = (n?: number) => n?.toFixed(1);'],
    ['export const a = (ns: number[]) => ns.map((n) => n.toFixed(0)).join(", ");'],
  ])('flags %s', async (code) => {
    expect(await flagsOf(COMPONENT, code)).toEqual([TO_FIXED]);
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
    ['export const slow = () => new Promise((resolve) => setTimeout(() => resolve(1), 50));'],
    ['export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));'],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(50);"],
    ["import { setTimeout } from 'timers/promises';\nawait setTimeout(50);"],
    ["import * as timers from 'node:timers/promises';\nawait timers.setTimeout(50);"],
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

  it('flags it in a spec of the domain and of a script', async () => {
    const code = 'await new Promise((resolve) => setTimeout(resolve, 50));';

    expect(await flagsOf(CORE_SPEC, code)).toEqual([SLEEP]);
    expect(await flagsOf(SCRIPT_SPEC, code)).toEqual([SLEEP]);
  });

  it.each([
    ['await new Promise((resolve) => setTimeout(resolve, 0));'],
    ["import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(0);"],
    ['declare const held: { close(): void };\nsetTimeout(() => {\n  held.close();\n}, 300);'],
    ['declare const until: (done: () => boolean) => Promise<void>;\nawait until(() => true);'],
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
    ["import { tmpdir } from 'node:os';\nexport const f = tmpdir();"],
  ])('leaves a folder made whole by `mkdtemp` alone: %s', async (code) => {
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
