import { describe, expect, it } from 'vitest';
import { CloseAction, closeAction, CloseOutcome, WindowCloser } from './close-policy.ts';
import type { DownloadActivity } from './download-activity.ts';

describe('closeAction', () => {
  it('hides the window while something is downloading or waiting, and a tray can bring it back', () => {
    expect(closeAction({ trayAvailable: true, unfinished: 2 })).toBe(CloseAction.Hide);
  });

  it('quits when nothing is left to download', () => {
    expect(closeAction({ trayAvailable: true, unfinished: 0 })).toBe(CloseAction.Quit);
  });

  it('quits where there is no tray to come back from', () => {
    expect(closeAction({ trayAvailable: false, unfinished: 5 })).toBe(CloseAction.Quit);
  });

  it('quits when the engine did not say what it is doing', () => {
    expect(closeAction({ trayAvailable: true, unfinished: undefined })).toBe(CloseAction.Quit);
  });
});

describe('WindowCloser', () => {
  function closing(
    overrides: {
      trayAvailable?: boolean;
      activity?: () => Promise<DownloadActivity>;
      quitting?: () => boolean;
    } = {},
  ) {
    const calls: string[] = [];
    const closer = new WindowCloser({
      trayAvailable: overrides.trayAvailable ?? true,
      quitting: overrides.quitting ?? (() => false),
      hide: () => {
        calls.push('hide');
      },
      quit: () => {
        calls.push('quit');
      },
      activity: () => {
        calls.push('ask');
        return (overrides.activity ?? (async () => ({ downloading: 0, queued: 0 })))();
      },
    });
    return { calls, closer };
  }

  it('hides the window before it asks the engine anything', async () => {
    const { calls, closer } = closing({ activity: async () => ({ downloading: 1, queued: 2 }) });

    const result = await closer.close();

    expect(calls).toEqual(['hide', 'ask']);
    expect(result).toEqual({
      outcome: CloseOutcome.Hidden,
      activity: { downloading: 1, queued: 2 },
    });
  });

  it('quits, once hidden, when nothing is left to download', async () => {
    const { calls, closer } = closing();

    expect(await closer.close()).toEqual({ outcome: CloseOutcome.Quit });
    expect(calls).toEqual(['hide', 'ask', 'quit']);
  });

  it('quits when the engine does not answer', async () => {
    const { calls, closer } = closing({
      activity: async () => {
        throw new Error('no answer in time');
      },
    });

    expect(await closer.close()).toEqual({ outcome: CloseOutcome.Quit });
    expect(calls).toEqual(['hide', 'ask', 'quit']);
  });

  it('quits without asking where there is no tray to come back from', async () => {
    const { calls, closer } = closing({ trayAvailable: false });

    expect(await closer.close()).toEqual({ outcome: CloseOutcome.Quit });
    expect(calls).toEqual(['hide', 'quit']);
  });

  it('does nothing when the app is already quitting', async () => {
    const { calls, closer } = closing({ quitting: () => true });

    expect(await closer.close()).toEqual({ outcome: CloseOutcome.Ignored });
    expect(calls).toEqual([]);
  });

  it('lets a quit that began while the engine was asked have the last word', async () => {
    let quitting = false;
    const { calls, closer } = closing({
      quitting: () => quitting,
      activity: async () => {
        quitting = true;
        return { downloading: 3, queued: 0 };
      },
    });

    expect(await closer.close()).toEqual({ outcome: CloseOutcome.Ignored });
    expect(calls).toEqual(['hide', 'ask']);
  });

  it('takes one decision at a time: a second close while the first waits changes nothing', async () => {
    let answer: (activity: DownloadActivity) => void = () => undefined;
    const { calls, closer } = closing({
      activity: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });

    const first = closer.close();
    const second = await closer.close();
    answer({ downloading: 1, queued: 0 });

    expect(second).toEqual({ outcome: CloseOutcome.Ignored });
    expect(await first).toEqual({
      outcome: CloseOutcome.Hidden,
      activity: { downloading: 1, queued: 0 },
    });
    expect(calls).toEqual(['hide', 'ask']);
  });

  it('decides again at the next close', async () => {
    const { calls, closer } = closing({ activity: async () => ({ downloading: 1, queued: 0 }) });

    await closer.close();
    await closer.close();

    expect(calls).toEqual(['hide', 'ask', 'hide', 'ask']);
  });
});
