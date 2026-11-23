import { describe, expect, it } from 'vitest';
import { lastAsked } from './last-asked.ts';

describe('lastAsked', () => {
  it('answers what was asked', async () => {
    const ask = lastAsked(async () => 'ice');

    expect(await ask()).toBe('ice');
  });

  // Main asks the engine its theme at a restart and when the page says it changed: an answer
  // that comes back after a later ask was made is about a theme the person already left.
  it('drops the answer to an ask that a later one followed, however they come back', async () => {
    const answers: ((theme: string) => void)[] = [];
    const ask = lastAsked(
      () =>
        new Promise<string>((resolve) => {
          answers.push(resolve);
        }),
    );
    const older = ask();
    const newer = ask();

    answers[1]?.('ice');
    answers[0]?.('brick');

    expect(await newer).toBe('ice');
    expect(await older).toBeUndefined();
  });

  it('passes on the refusal of the last ask, and drops an older one', async () => {
    let calls = 0;
    const ask = lastAsked(async () => {
      calls += 1;
      throw new Error(`refused ${String(calls)}`);
    });
    const older = ask();
    const newer = ask();

    await expect(newer).rejects.toThrow('refused 2');
    await expect(older).resolves.toBeUndefined();
  });
});
