import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATES, TEST_REPORT, bodyLineOf, npmRun, runGates, testCountsOf } from './gates.mjs';

const root = path.join(path.sep, 'scia');

// A file of Vitest's JSON report: its path, Vitest's verdict on it, and one status per test.
function fileOf(name, statuses, status = statuses.includes('failed') ? 'failed' : 'passed') {
  return {
    name: path.join(root, ...name.split('/')),
    status,
    assertionResults: statuses.map((testStatus) => ({ status: testStatus })),
  };
}

function countsOf({ files, tests, failedFiles = [] }) {
  const tally = ([failed, passed, skipped, todo, total]) => ({
    failed,
    passed,
    skipped,
    todo,
    total,
  });
  return { files: tally(files), tests: tally(tests), failedFiles };
}

describe('runGates', () => {
  it('runs the gates of review-flow.md in their order', async () => {
    const ran = [];
    const outcome = await runGates(async (gate) => {
      ran.push(gate.script);
      return 0;
    });

    expect(ran).toEqual(['check:adr', 'format:check', 'lint', 'typecheck', 'test', 'build']);
    expect(outcome).toEqual({ ok: true, failed: undefined });
  });

  it('stops at the first gate that fails, and names it', async () => {
    const ran = [];
    const outcome = await runGates(async (gate) => {
      ran.push(gate.script);
      return gate.script === 'typecheck' ? 2 : 0;
    });

    expect(ran).toEqual(['check:adr', 'format:check', 'lint', 'typecheck']);
    expect(outcome).toEqual({ ok: false, failed: 'typecheck' });
  });

  it('asks the tests for a quiet reporter and a report of their counts, and nothing else of any gate', () => {
    expect(GATES.find((gate) => gate.script === 'test')?.args).toEqual([
      '--reporter=dot',
      '--reporter=json',
      `--outputFile.json=${TEST_REPORT}`,
    ]);
    expect(GATES.filter((gate) => gate.args.length > 0).map((gate) => gate.script)).toEqual([
      'test',
    ]);
  });
});

describe('testCountsOf', () => {
  it('counts files and tests passed and skipped of their totals, a file none of whose tests runs as skipped', () => {
    const report = {
      testResults: [
        fileOf('packages/core/src/queue.test.ts', ['passed', 'passed', 'skipped']),
        fileOf('apps/desktop/src/tray.test.ts', ['skipped', 'skipped']),
        fileOf('apps/server/src/later.test.ts', ['todo']),
      ],
    };

    expect(testCountsOf(report, root)).toEqual(
      countsOf({ files: [0, 1, 2, 0, 3], tests: [0, 2, 3, 1, 6] }),
    );
  });

  it('counts the failed files and tests, and names the failing files from the root', () => {
    const report = {
      testResults: [
        fileOf('scripts/gates.test.mjs', ['passed', 'failed', 'failed']),
        fileOf('packages/core/src/queue.test.ts', ['passed']),
        // A file that does not load fails with no test of its own.
        fileOf('apps/server/src/broken.test.ts', [], 'failed'),
      ],
    };

    expect(testCountsOf(report, root)).toEqual(
      countsOf({
        files: [2, 1, 0, 0, 3],
        tests: [2, 2, 0, 0, 4],
        failedFiles: ['scripts/gates.test.mjs', 'apps/server/src/broken.test.ts'],
      }),
    );
  });

  it('names the failing files with forward slashes on Windows, whose root has backslashes', () => {
    // Vitest names a file on Windows with forward slashes; the root comes from the system's path.
    const report = {
      testResults: [
        {
          name: 'C:/scia/apps/server/src/broken.test.ts',
          status: 'failed',
          assertionResults: [{ status: 'failed' }],
        },
      ],
    };

    expect(testCountsOf(report, 'C:\\scia\\', path.win32).failedFiles).toEqual([
      'apps/server/src/broken.test.ts',
    ]);
  });
});

describe('bodyLineOf', () => {
  const run = { head: 'd0bfecb', dirty: false, workers: '2', seconds: 97 };
  const green = countsOf({ files: [0, 134, 2, 0, 136], tests: [0, 1982, 82, 0, 2064] });

  it("gives a green run its head, workers, time and counts, in the words of Vitest's summary", () => {
    expect(bodyLineOf({ ...run, outcome: { ok: true, failed: undefined }, counts: green })).toBe(
      '`npm run gates` green on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s — ' +
        'Test Files 134 passed | 2 skipped (136); Tests 1982 passed | 82 skipped (2064)',
    );
  });

  it('gives a red test gate its counts, failed ones first, and the failing files', () => {
    const counts = countsOf({
      files: [2, 132, 2, 0, 136],
      tests: [3, 1979, 82, 0, 2064],
      failedFiles: ['scripts/gates.test.mjs', 'apps/server/src/broken.test.ts'],
    });

    expect(bodyLineOf({ ...run, outcome: { ok: false, failed: 'test' }, counts })).toBe(
      '`npm run gates` red at `test` on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s — ' +
        'Test Files 2 failed | 132 passed | 2 skipped (136); Tests 3 failed | 1979 passed | 82 skipped (2064); ' +
        'failed: `scripts/gates.test.mjs`, `apps/server/src/broken.test.ts`',
    );
  });

  it('says no test failed when the test gate is red for an error outside the tests', () => {
    expect(bodyLineOf({ ...run, outcome: { ok: false, failed: 'test' }, counts: green })).toBe(
      '`npm run gates` red at `test` on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s — ' +
        'Test Files 134 passed | 2 skipped (136); Tests 1982 passed | 82 skipped (2064); ' +
        "no test failed: Vitest's errors are printed above",
    );
  });

  it('keeps the counts of the tests when a gate after them is red', () => {
    expect(bodyLineOf({ ...run, outcome: { ok: false, failed: 'build' }, counts: green })).toBe(
      '`npm run gates` red at `build` on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s — ' +
        'Test Files 134 passed | 2 skipped (136); Tests 1982 passed | 82 skipped (2064)',
    );
  });

  it('gives no counts when a gate before the tests is red', () => {
    expect(bodyLineOf({ ...run, outcome: { ok: false, failed: 'lint' }, counts: undefined })).toBe(
      '`npm run gates` red at `lint` on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s',
    );
  });

  it('says so when the tests ran and Vitest wrote no report', () => {
    expect(bodyLineOf({ ...run, outcome: { ok: false, failed: 'test' }, counts: undefined })).toBe(
      '`npm run gates` red at `test` on `d0bfecb`, SCIA_TEST_WORKERS=2, 97 s — Vitest wrote no report of its counts',
    );
  });

  it('names the changes not committed beside the head, as the run was not of the head alone', () => {
    expect(
      bodyLineOf({ ...run, dirty: true, outcome: { ok: true, failed: undefined }, counts: green }),
    ).toMatch(
      /^`npm run gates` green on `d0bfecb` with changes not committed, SCIA_TEST_WORKERS=2, /,
    );
  });

  it('leaves the workers to Vitest when SCIA_TEST_WORKERS is not a positive whole number', () => {
    for (const workers of [undefined, '', '0', '-1', '1.5', 'abc']) {
      expect(
        bodyLineOf({ ...run, workers, outcome: { ok: true, failed: undefined }, counts: green }),
        String(workers),
      ).toMatch(/^`npm run gates` green on `d0bfecb`, Vitest's own count of workers, 97 s — /);
    }
  });
});

describe('npmRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('starts the gate without colour, whatever the shell asked for', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // The opposite of what the gates set: a shell that exports them would hide a gate that does not.
    vi.stubEnv('NO_COLOR', '');
    vi.stubEnv('FORCE_COLOR', '1');
    let environment;
    const spawn = (_command, options) => {
      environment = options.env;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    };

    await npmRun({ script: 'lint', args: [] }, spawn);

    expect(environment).toMatchObject({ NO_COLOR: '1', FORCE_COLOR: '0' });
  });
});
