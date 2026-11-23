import { afterEach, describe, expect, it, vi } from 'vitest';
import { until } from '../../server/src/testing/scratch.ts';
import { ForegroundWindow, handleOf } from './foreground-window.ts';

describe.runIf(process.platform === 'win32')('ForegroundWindow, asking Windows (#62)', () => {
  let foreground: ForegroundWindow | undefined;
  afterEach(() => {
    foreground?.stop();
    foreground = undefined;
    vi.unstubAllEnvs();
  });

  it('answers nothing before it is ready, then the window in use, in well under a second', async () => {
    foreground = new ForegroundWindow();
    foreground.warm();
    expect(await foreground.ask()).toBeUndefined();

    // Its first start compiles the declaration: seconds on a cold runner, once.
    let first: bigint | undefined;
    await until(async () => {
      first = await foreground!.ask();
      return first !== undefined;
    }, 60_000);
    const startedAt = performance.now();
    const second = await foreground.ask();
    const took = performance.now() - startedAt;

    expect(first! >= 0n).toBe(true);
    expect(typeof second).toBe('bigint');
    expect(took).toBeLessThan(500);
  }, 90_000);

  it('answers nothing when the system cannot be asked, never a guess', async () => {
    vi.stubEnv('SystemRoot', 'C:\\no-windows-here');
    foreground = new ForegroundWindow();
    foreground.warm();

    expect(await foreground.ask()).toBeUndefined();
  });
});

describe('handleOf', () => {
  it('reads the handle Electron gives as the bytes of a pointer', () => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(0x1234n);

    expect(handleOf(bytes)).toBe(0x1234n);
    expect(handleOf(Buffer.from([0x34, 0x12, 0, 0]))).toBe(0x1234n);
  });
});
