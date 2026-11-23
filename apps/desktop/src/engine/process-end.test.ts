import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endOfProcess } from './process-end.ts';

function aProcess() {
  let exit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  // Read as main reads them: flowing.
  stdout.resume();
  stderr.resume();
  return { exited, exit, stdout, stderr };
}

function watch(promise: Promise<boolean>) {
  const seen: { ended?: boolean } = {};
  void promise.then((ended) => {
    seen.ended = ended;
  });
  return seen;
}

describe('endOfProcess', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the exit and for the end of every output', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [child.stdout, child.stderr], 1000));

    child.exit(0);
    child.stdout.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.ended).toBeUndefined();
    child.stderr.end();
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.ended).toBe(true);
  });

  it('does not end at outputs that ended while the process still runs', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [child.stdout, child.stderr], 1000));

    child.stdout.end();
    child.stderr.end();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.ended).toBeUndefined();
    child.exit(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.ended).toBe(true);
  });

  it('takes an output destroyed without an end as ended', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [child.stdout, child.stderr], 1000));

    child.exit(1);
    child.stdout.destroy();
    child.stderr.end();
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.ended).toBe(true);
  });

  it('waits for no output that does not exist', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [null, undefined], 1000));

    child.exit(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.ended).toBe(true);
  });

  it('gives up on an output that does not end, its bound counted from the exit', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [child.stdout, child.stderr], 1000));
    child.stderr.end();

    await vi.advanceTimersByTimeAsync(10_000);
    child.exit(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(seen.ended).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(seen.ended).toBe(false);
  });

  it('leaves no timer behind once the outputs have ended', async () => {
    const child = aProcess();
    const seen = watch(endOfProcess(child.exited, [child.stdout], 1000));

    child.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    child.stdout.end();
    await vi.advanceTimersByTimeAsync(0);

    expect(seen.ended).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
