import { execFile } from 'node:child_process';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeFailure } from './logger.ts';
import { runProgram } from './sparse-file.ts';
import { scratchFolder } from './testing/scratch.ts';

// A folder named as a person's account is, so that a line that names it is caught (#341).
const ACCOUNT = 'Ada Lovelace';
const RUN = { timeout: 5000, windowsHide: true, env: {} };

describe('describeFailure', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;

  beforeEach(async () => {
    folder = await scratchFolder();
  });
  afterEach(async () => {
    await folder.remove();
  });

  // The engine's own entry, run by Node as main runs it, with an environment built from nothing.
  function entryRun(env: Record<string, string>): Promise<{ code: unknown; stderr: string }> {
    const entry = fileURLToPath(new URL('./entry.ts', import.meta.url));
    const system =
      process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot };
    return new Promise((done) => {
      execFile(process.execPath, [entry], { env: { ...system, ...env } }, (error, _out, stderr) => {
        done({ code: error === null ? 0 : error.code, stderr });
      });
    });
  }

  async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
    try {
      await work();
    } catch (error) {
      return error;
    }
    throw new Error('The work did not fail.');
  }

  it("says a file's failure by the system's code, never by the path its message names (#341)", async () => {
    const missing = join(folder.path, ACCOUNT, 'state.json.tmp');
    const error = await failureOf(() => rename(missing, join(folder.path, 'state.json')));

    const described = describeFailure(error);

    expect(JSON.stringify(described)).not.toContain(ACCOUNT);
    expect(described).toEqual({ name: 'Error', code: 'ENOENT', syscall: 'rename' });
  });

  it("says a program's failure by its exit and its signal, never by the command its message names (#267)", async () => {
    const error = await failureOf(() =>
      runProgram(process.execPath, ['-e', 'process.exit(3)', join(folder.path, ACCOUNT)], RUN),
    );

    const described = describeFailure(error);

    expect(JSON.stringify(described)).not.toContain(ACCOUNT);
    expect(described).toEqual({ name: 'Error', code: 3, killed: false, signal: null });
  });

  it('says a program that could not be started by the call alone, never by the path it names', async () => {
    const error = await failureOf(() => runProgram(join(folder.path, ACCOUNT, 'yt-dlp'), [], RUN));

    const described = describeFailure(error);

    expect(JSON.stringify(described)).not.toContain(ACCOUNT);
    expect(described).toEqual({ name: 'Error', code: 'ENOENT', syscall: 'spawn' });
  });

  it("writes the engine's failure to start without the profile's path, and exits with 1", async () => {
    const taken = join(folder.path, ACCOUNT);
    await writeFile(taken, '');

    const { code, stderr } = await entryRun({
      SCIA_API_TOKEN: 'a-token-made-up-for-this-spec',
      SCIA_PORT: '0',
      SCIA_DATA_DIR: join(taken, 'Scia', 'profile'),
      SCIA_DOWNLOAD_DIR: join(folder.path, 'downloads'),
    });

    expect(code).toBe(1);
    expect(stderr).not.toContain(ACCOUNT);
    expect(JSON.parse(stderr.trim())).toEqual({
      level: 'error',
      event: 'engine_start_failed',
      error: { name: 'Error', code: 'ENOTDIR', syscall: 'mkdir' },
    });
  });

  it('says such a failure the same way when it is the cause of another', async () => {
    const missing = join(folder.path, ACCOUNT, 'alldebrid-hosts.json.tmp');
    const cause = await failureOf(() => rename(missing, join(folder.path, 'hosts.json')));

    const described = describeFailure(new Error('The list was not kept.', { cause }));

    expect(JSON.stringify(described)).not.toContain(ACCOUNT);
    expect(described).toEqual({
      name: 'Error',
      message: 'The list was not kept.',
      cause: { name: 'Error', code: 'ENOENT', syscall: 'rename' },
    });
  });

  it('keeps the message of a failure that names no file and runs no program', () => {
    expect(describeFailure(new TypeError('fetch failed'))).toEqual({
      name: 'TypeError',
      message: 'fetch failed',
    });
  });
});
