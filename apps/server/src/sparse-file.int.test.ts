import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RunProgram, SPARSE_LIMIT_MS, sparseMarkerFor } from './sparse-file.ts';
import { neverAnswers } from './testing/never-answers.ts';

describe('sparseMarkerFor (#182)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("on Windows, runs the system's own fsutil by its full path, hidden, bounded, and with nothing of the engine's environment", async () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    vi.stubEnv('SCIA_API_TOKEN', 'the-engine-token');
    vi.stubEnv('PATH', 'C:\\somewhere');
    const asked: Parameters<RunProgram>[] = [];
    const mark = sparseMarkerFor('win32', {
      run: async (...given) => {
        asked.push(given);
      },
    });

    await mark('sample.bin.scia');

    expect(asked).toEqual([
      [
        join('C:\\Windows', 'System32', 'fsutil.exe'),
        ['sparse', 'setflag', 'sample.bin.scia'],
        { timeout: SPARSE_LIMIT_MS, windowsHide: true, env: { SystemRoot: 'C:\\Windows' } },
      ],
    ]);
  });

  it('asks nothing of a system whose `truncate` leaves a hole already', async () => {
    const run = vi.fn<RunProgram>(() => Promise.resolve());

    await sparseMarkerFor('linux', { run })('sample.bin.scia');

    expect(run).not.toHaveBeenCalled();
  });

  it('ends a program that never answers at its limit, and says so', async () => {
    const mark = sparseMarkerFor('win32', { run: neverAnswers, limitMs: 300 });
    const began = performance.now();

    await expect(mark('sample.bin.scia')).rejects.toMatchObject({ killed: true });

    expect(performance.now() - began).toBeLessThan(10_000);
  });
});
