import { describe, expect, it } from 'vitest';
import config from '../stryker.config.mjs';
import { changesOf, mutate, mutateArgsOf, optionsOf } from './mutate.mjs';

const diff = (...lines) => `${lines.join('\n')}\n`;

describe('changesOf', () => {
  it('reads the lines each hunk adds or changes, numbered as in the new file', () => {
    const changes = changesOf(
      diff(
        'diff --git a/apps/server/src/a.ts b/apps/server/src/a.ts',
        'index 1111111..2222222 100644',
        '--- a/apps/server/src/a.ts',
        '+++ b/apps/server/src/a.ts',
        '@@ -3 +3 @@ export function a() {',
        '-  return 1;',
        '+  return 2;',
        '@@ -10,0 +11,4 @@ export function b() {',
        '+one',
        '+two',
        '+three',
        '+four',
        '@@ -100,12 +103,15 @@ export function c() {',
      ),
    );

    expect(changes).toEqual([
      {
        file: 'apps/server/src/a.ts',
        lines: [
          [3, 3],
          [11, 14],
          [103, 117],
        ],
      },
    ]);
  });

  it('gives nothing to mutate for a hunk that only takes lines away, or a file left with none', () => {
    const changes = changesOf(
      diff(
        'diff --git a/apps/server/src/a.ts b/apps/server/src/a.ts',
        '--- a/apps/server/src/a.ts',
        '+++ b/apps/server/src/a.ts',
        '@@ -20,2 +19,0 @@',
        '-gone',
        '-gone too',
        '@@ -30 +28 @@',
        '-old',
        '+new',
        'diff --git a/packages/core/src/b.ts b/packages/core/src/b.ts',
        '--- a/packages/core/src/b.ts',
        '+++ b/packages/core/src/b.ts',
        '@@ -5,3 +4,0 @@',
        '-x',
        '-y',
        '-z',
      ),
    );

    expect(changes).toEqual([{ file: 'apps/server/src/a.ts', lines: [[28, 28]] }]);
  });

  it('reads a renamed file under its new name, and passes over a deleted file and a binary one', () => {
    const changes = changesOf(
      diff(
        'diff --git a/apps/server/src/old.ts b/apps/server/src/new.ts',
        'similarity index 90%',
        'rename from apps/server/src/old.ts',
        'rename to apps/server/src/new.ts',
        'index 1111111..2222222 100644',
        '--- a/apps/server/src/old.ts',
        '+++ b/apps/server/src/new.ts',
        '@@ -7,2 +7,2 @@',
        '-a',
        '-b',
        '+c',
        '+d',
        'diff --git a/apps/server/src/gone.ts b/apps/server/src/gone.ts',
        'deleted file mode 100644',
        'index 1111111..0000000',
        '--- a/apps/server/src/gone.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-a',
        '-b',
        'diff --git a/docs/design/a.png b/docs/design/a.png',
        'index 1111111..2222222 100644',
        'Binary files a/docs/design/a.png and b/docs/design/a.png differ',
      ),
    );

    expect(changes).toEqual([{ file: 'apps/server/src/new.ts', lines: [[7, 8]] }]);
  });

  it('takes no added line for a header, however it reads', () => {
    const changes = changesOf(
      diff(
        'diff --git a/scripts/a.mjs b/scripts/a.mjs',
        '--- a/scripts/a.mjs',
        '+++ b/scripts/a.mjs',
        '@@ -1,0 +1,3 @@',
        '+++ b/scripts/not-a-file.mjs',
        '+@@ -1 +40,9 @@',
        '+--- a/scripts/a.mjs',
        '@@ -5 +8 @@',
        '-x',
        '+y',
      ),
    );

    expect(changes).toEqual([
      {
        file: 'scripts/a.mjs',
        lines: [
          [1, 3],
          [8, 8],
        ],
      },
    ]);
  });

  it('reads nothing from an empty diff', () => {
    expect(changesOf('')).toEqual([]);
  });
});

describe('mutateArgsOf', () => {
  const patterns = [
    'apps/*/src/**/*.{ts,tsx}',
    'scripts/**/*.mjs',
    '!**/*.test.*',
    '!**/testing/**',
  ];

  it("keeps the files the config's patterns take, and leaves out what a negation takes back", () => {
    const args = mutateArgsOf(
      [
        { file: 'apps/server/src/a.ts', lines: [[1, 2]] },
        { file: 'apps/server/src/a.test.ts', lines: [[1, 2]] },
        { file: 'apps/server/src/testing/fake.ts', lines: [[1, 2]] },
        { file: 'scripts/mutate.mjs', lines: [[4, 4]] },
        { file: 'docs/development/testing.md', lines: [[1, 2]] },
        { file: 'stryker.config.mjs', lines: [[1, 2]] },
      ],
      patterns,
    );

    expect(args).toEqual(['apps/server/src/a.ts:1-2', 'scripts/mutate.mjs:4-4']);
  });

  it('writes every range of a file as Stryker reads it, and a file whose lines are not known whole', () => {
    const args = mutateArgsOf(
      [
        {
          file: 'apps/renderer/src/b.tsx',
          lines: [
            [3, 3],
            [11, 14],
          ],
        },
        { file: 'apps/server/src/new.ts', lines: undefined },
      ],
      patterns,
    );

    expect(args).toEqual([
      'apps/renderer/src/b.tsx:3-3',
      'apps/renderer/src/b.tsx:11-14',
      'apps/server/src/new.ts',
    ]);
  });

  it('reads the patterns in order, as Stryker does: a later one wins', () => {
    const args = mutateArgsOf(
      [
        { file: 'apps/server/src/gen/kept.ts', lines: [[1, 1]] },
        { file: 'apps/server/src/gen/other.ts', lines: [[1, 1]] },
      ],
      ['apps/*/src/**/*.ts', '!apps/server/src/gen/**', 'apps/server/src/gen/kept.ts'],
    );

    expect(args).toEqual(['apps/server/src/gen/kept.ts:1-1']);
  });
});

describe("stryker.config.mjs's files", () => {
  it('lets Stryker mutate the source of every workspace and script, and no spec or helper of one', () => {
    const sources = [
      'packages/core/src/title.ts',
      'packages/contracts/src/theme.ts',
      'apps/server/src/yt-dlp.ts',
      'apps/renderer/src/components/held-enter.ts',
      'apps/renderer/src/app/title-bar.tsx',
      'apps/desktop/src/engine/server-env.ts',
      'apps/desktop/scripts/fetch-tools.ts',
      'apps/extension/src/background.ts',
      'scripts/mutate.mjs',
    ];
    const others = [
      'apps/server/src/yt-dlp.test.ts',
      'apps/server/src/yt-dlp.int.test.ts',
      'apps/server/src/app.feature.test.ts',
      'apps/renderer/src/app/app.test.tsx',
      'apps/server/src/testing/range-server.ts',
      'apps/renderer/src/test/setup.ts',
      'apps/renderer/src/assets.d.ts',
      'scripts/mutate.test.mjs',
      'scripts/testing/net-guard.mjs',
      'apps/desktop/e2e/start.e2e.test.ts',
      'vitest.stryker.config.ts',
      'docs/development/testing.md',
    ];

    const args = mutateArgsOf(
      [...sources, ...others].map((file) => ({ file, lines: undefined })),
      config.mutate,
    );

    expect(args).toEqual(sources);
  });

  it('leaves out of the sandbox what .gitignore leaves out, at the depth git reads each line', () => {
    expect(config.ignorePatterns).toEqual(
      expect.arrayContaining([
        '.claude/worktrees/',
        'apps/desktop/tools/',
        '.vscode/*',
        '!.vscode/extensions.json',
        '**/dist/',
        '**/node_modules/',
        '*.log',
        '!.env.example',
      ]),
    );
    expect(config.ignorePatterns.filter((pattern) => pattern.startsWith('!**'))).toEqual([]);
    expect(config.ignorePatterns.filter((pattern) => /^!?(\*\*\/)?(#|$)/.test(pattern))).toEqual(
      [],
    );
  });
});

describe('optionsOf', () => {
  it("compares with origin/develop, and hands Stryker every argument that is not the script's own", () => {
    expect(optionsOf(['--concurrency', '4', '--disableBail'])).toEqual({
      base: 'origin/develop',
      stryker: ['--concurrency', '4', '--disableBail'],
    });
  });

  it('compares with the ref --base names, written either way', () => {
    expect(optionsOf(['--base', 'HEAD~2', '--concurrency', '1'])).toEqual({
      base: 'HEAD~2',
      stryker: ['--concurrency', '1'],
    });
    expect(optionsOf(['--base=abc1234'])).toEqual({ base: 'abc1234', stryker: [] });
  });

  it('refuses a --base that names no ref', () => {
    expect(() => optionsOf(['--base'])).toThrow(/--base/);
    expect(() => optionsOf(['--base='])).toThrow(/--base/);
  });
});

describe('mutate', () => {
  const recorder = (codes = {}) => {
    const runs = [];
    return {
      runs,
      run: (step) => {
        runs.push(step);
        return Promise.resolve(codes[step.name] ?? 0);
      },
    };
  };

  it("sees the network guard refusing before Stryker starts, then mutates the branch's lines", async () => {
    const { runs, run } = recorder();
    const lines = [];

    const code = await mutate({
      args: ['apps/server/src/a.ts:1-2', 'scripts/mutate.mjs'],
      stryker: ['--concurrency', '1'],
      run,
      log: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines).toContain('Mutating 2 range(s): apps/server/src/a.ts:1-2, scripts/mutate.mjs');
    expect(runs.map(({ name }) => name)).toEqual(['probe', 'stryker']);
    expect(runs[1].args).toEqual([
      'run',
      '--mutate',
      'apps/server/src/a.ts:1-2,scripts/mutate.mjs',
      '--concurrency',
      '1',
    ]);
  });

  it('starts no mutant when the guard was not seen refusing', async () => {
    const { runs, run } = recorder({ probe: 1 });
    const lines = [];

    const code = await mutate({
      args: ['apps/server/src/a.ts:1-2'],
      stryker: [],
      run,
      log: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(runs.map(({ name }) => name)).toEqual(['probe']);
    expect(lines.join('\n')).toMatch(/network guard/);
  });

  it('runs nothing, and says so, when the branch changed no line Stryker may mutate', async () => {
    const { runs, run } = recorder();
    const lines = [];

    const code = await mutate({ args: [], stryker: [], run, log: (line) => lines.push(line) });

    expect(code).toBe(0);
    expect(runs).toEqual([]);
    expect(lines.join('\n')).toMatch(/nothing to mutate/i);
  });

  it("ends with Stryker's own exit code", async () => {
    const { run } = recorder({ stryker: 3 });

    const code = await mutate({ args: ['scripts/a.mjs'], stryker: [], run, log: () => undefined });

    expect(code).toBe(3);
  });
});
