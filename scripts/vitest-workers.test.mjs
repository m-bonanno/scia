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

  it('take the same worker cap in the root and in the renderer', async () => {
    vi.stubEnv('SCIA_TEST_WORKERS', '2');

    const rootTest = await testConfigOf('vitest.config.ts');
    const rendererTest = await testConfigOf('apps/renderer/vitest.config.ts');

    expect(rootTest?.maxWorkers).toBe(2);
    expect(rendererTest?.maxWorkers).toBe(2);
  });
});
