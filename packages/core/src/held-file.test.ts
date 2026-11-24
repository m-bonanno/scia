import { describe, expect, it } from 'vitest';
import { renameWhenFree } from './held-file.ts';

function refusal(code: string): Error {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

// A rename refused the first `times` tries, then done, on a clock that moves only when the rule
// waits: the spec reads when each try was made.
function heldFor(times: number, code = 'EPERM') {
  let now = 0;
  const triedAt: number[] = [];
  const refusals: Error[] = [];
  const rename = async () => {
    triedAt.push(now);
    if (triedAt.length <= times) {
      const refused = refusal(code);
      refusals.push(refused);
      throw refused;
    }
  };
  const wait = async (ms: number) => {
    now += ms;
  };
  return { rename, wait, triedAt, refusals };
}

describe('renameWhenFree', () => {
  it('renames at once a file nobody holds, with no wait', async () => {
    const file = heldFor(0);

    await renameWhenFree(file.rename, file.wait);

    expect(file.triedAt).toEqual([0]);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'tries a rename refused with %s again every 50 ms, as long as another program holds the file',
    async (code) => {
      const file = heldFor(3, code);

      await renameWhenFree(file.rename, file.wait);

      expect(file.triedAt).toEqual([0, 50, 100, 150]);
    },
  );

  it('lands a rename that the fortieth try finds free', async () => {
    const file = heldFor(39);

    await renameWhenFree(file.rename, file.wait);

    expect(file.triedAt).toHaveLength(40);
    expect(file.triedAt.at(-1)).toBe(1950);
  });

  it('gives the rename up after forty tries, about two seconds, with the last refusal', async () => {
    const file = heldFor(Number.POSITIVE_INFINITY);

    const given = await renameWhenFree(file.rename, file.wait).catch((error: unknown) => error);

    expect(given).toBe(file.refusals.at(-1));
    expect(file.triedAt).toHaveLength(40);
    expect(file.triedAt.at(-1)).toBe(1950);
  });

  it.each([
    ['a file or folder that is not there', refusal('ENOENT')],
    ['a full disk', refusal('ENOSPC')],
    ['another disk', refusal('EXDEV')],
    ['an error with no code', new Error('broken')],
  ])('fails at once for what waiting does not heal: %s', async (_, failure) => {
    let tries = 0;
    let waited = 0;

    await expect(
      renameWhenFree(
        async () => {
          tries += 1;
          throw failure;
        },
        async () => {
          waited += 1;
        },
      ),
    ).rejects.toBe(failure);

    expect(tries).toBe(1);
    expect(waited).toBe(0);
  });

  it('tries again only once its wait is over', async () => {
    let tries = 0;
    let waitAsked: () => void = () => undefined;
    const asked = new Promise<void>((resolve) => {
      waitAsked = resolve;
    });
    let endWait: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      endWait = resolve;
    });
    const renamed = renameWhenFree(
      async () => {
        tries += 1;
        if (tries === 1) throw refusal('EPERM');
      },
      () => {
        waitAsked();
        return waiting;
      },
    );

    await asked;
    expect(tries).toBe(1);
    endWait();
    await renamed;

    expect(tries).toBe(2);
  });
});
