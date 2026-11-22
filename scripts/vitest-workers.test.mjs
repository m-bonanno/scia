import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerCapOf } from '../vitest.workers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function testConfigOf(file) {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, file, root);
  return loaded?.config.test;
}

describe('workerCapOf', () => {
  it('caps the workers at a positive whole number', () => {
    expect(workerCapOf('2')).toEqual({ maxWorkers: 2 });
  });

  it('leaves Vitest its own count for anything else', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc']) {
      expect(workerCapOf(value), String(value)).toEqual({});
    }
  });
});

describe('the Vitest configurations', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('take the same worker cap in the root and in every project with a file of its own', async () => {
    vi.stubEnv('SCIA_TEST_WORKERS', '2');

    const rootTest = await testConfigOf('vitest.config.ts');
    // An inline project takes the root's cap; a project with a file of its own takes only what
    // its file gives it (#201), so every such file is read from the root's list, none written here.
    const files = (rootTest?.projects ?? []).filter((project) => typeof project === 'string');

    expect(files.length).toBeGreaterThan(0);
    expect(rootTest?.maxWorkers).toBe(2);
    for (const file of files) {
      expect((await testConfigOf(file))?.maxWorkers, file).toBe(2);
    }
  });
});
