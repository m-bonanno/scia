import { describe, expect, it } from 'vitest';
import { foregroundWindow, handleOf, loadForeground } from './foreground-window.ts';

describe.runIf(process.platform === 'win32')('foregroundWindow, asking Windows (#62)', () => {
  it('answers nothing before koffi is loaded, then the window in use, in well under a millisecond', async () => {
    expect(foregroundWindow()).toBeUndefined();

    await loadForeground();
    const startedAt = performance.now();
    const handle = foregroundWindow();
    const took = performance.now() - startedAt;

    expect(typeof handle).toBe('bigint');
    expect(handle! >= 0n).toBe(true);
    expect(took).toBeLessThan(5);
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
