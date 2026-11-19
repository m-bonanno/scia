import { describe, expect, it } from 'vitest';
import { CloseOutcome, WindowCloser } from './close-policy.ts';
import type { DownloadActivity } from './download-activity.ts';

describe('WindowCloser', () => {
  function closing(
    overrides: {
      trayAvailable?: boolean;
      activity?: () => Promise<DownloadActivity>;
      quitting?: () => boolean;
      visible?: () => boolean;
    } = {},
  ) {
    const calls: string[] = [];
    const closer = new WindowCloser({
      trayAvailable: overrides.trayAvailable ?? true,
      quitting: overrides.quitting ?? (() => false),
      visible: overrides.visible ?? (() => false),
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

  it('stays hidden for a download that only waits its turn', async () => {
    const { closer } = closing({ activity: async () => ({ downloading: 0, queued: 1 }) });

    expect((await closer.close()).outcome).toBe(CloseOutcome.Hidden);
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
    const { calls, closer } = closing({
      trayAvailable: false,
      activity: async () => ({ downloading: 5, queued: 0 }),
    });

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

  it('leaves alone a window the person brought back while the engine was asked', async () => {
    let visible = false;
    const broughtBack = async (activity: DownloadActivity) => {
      visible = true;
      return activity;
    };
    const idle = closing({
      visible: () => visible,
      activity: () => broughtBack({ downloading: 0, queued: 0 }),
    });

    // Nothing left to download: it would have quit, in front of an open window.
    expect(await idle.closer.close()).toEqual({ outcome: CloseOutcome.Ignored });
    expect(idle.calls).toEqual(['hide', 'ask']);

    visible = false;
    const busy = closing({
      visible: () => visible,
      activity: () => broughtBack({ downloading: 2, queued: 0 }),
    });

    // Still downloading: it would have said "still downloading" to someone looking at it.
    expect(await busy.closer.close()).toEqual({ outcome: CloseOutcome.Ignored });
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
    // The second close hides too — an X always does something — and asks nothing again.
    expect(calls).toEqual(['hide', 'ask', 'hide']);
  });

  it('hides again a window brought back and closed again while the engine was asked', async () => {
    let visible = false;
    let answer: (activity: DownloadActivity) => void = () => undefined;
    const closer = new WindowCloser({
      trayAvailable: true,
      quitting: () => false,
      visible: () => visible,
      hide: () => {
        visible = false;
      },
      quit: () => undefined,
      activity: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });

    const first = closer.close();
    visible = true;
    await closer.close();
    answer({ downloading: 1, queued: 0 });

    // The window is hidden again, so the first decision stands: Scia stays in the tray.
    expect(visible).toBe(false);
    expect((await first).outcome).toBe(CloseOutcome.Hidden);
  });

  it('decides again at the next close', async () => {
    const { calls, closer } = closing({ activity: async () => ({ downloading: 1, queued: 0 }) });

    await closer.close();
    await closer.close();

    expect(calls).toEqual(['hide', 'ask', 'hide', 'ask']);
  });
});
