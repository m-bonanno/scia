import { afterEach, describe, expect, it, vi } from 'vitest';
import { foregroundWindow, handleOf } from './foreground-window.ts';

describe.runIf(process.platform === 'win32')('foregroundWindow, asking Windows (#62)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('answers the handle of the window in use, a whole number', async () => {
    const handle = await foregroundWindow();

    expect(typeof handle).toBe('bigint');
    expect(handle! >= 0n).toBe(true);
  }, 15_000);

  it('answers nothing when the system cannot be asked, never a guess', async () => {
    vi.stubEnv('SystemRoot', 'C:\no-windows-here');

    expect(await foregroundWindow()).toBeUndefined();
  }, 15_000);
});

describe('handleOf', () => {
  it('reads the handle Electron gives as the bytes of a pointer', () => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(0x1234n);

    expect(handleOf(bytes)).toBe(0x1234n);
    expect(handleOf(Buffer.from([0x34, 0x12, 0, 0]))).toBe(0x1234n);
  });
});
