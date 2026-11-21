import { MAX_URLS_PER_REQUEST } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { CLIPBOARD_READ_MS, ClipboardWatch } from './clipboard-watch.ts';

function aWatch(options: { offer?: (links: readonly string[]) => Promise<void> } = {}) {
  let text = '';
  let reads = 0;
  let failing = false;
  const offered: string[][] = [];
  const warnings: string[] = [];
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const watch = new ClipboardWatch({
    read: async () => {
      reads += 1;
      if (failing) throw new Error('The system said no.');
      return text;
    },
    offer:
      options.offer ??
      (async (links) => {
        offered.push([...links]);
      }),
    every: (ms, run) => {
      const timer = { ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    log: {
      info: () => undefined,
      warn: (message, details) => warnings.push(`${message} ${JSON.stringify(details)}`),
    },
  });
  const live = () => timers.filter((timer) => !timer.cancelled);
  return {
    watch,
    offered,
    warnings,
    timers: live,
    copy: (copied: string) => {
      text = copied;
    },
    fail: (yes: boolean) => {
      failing = yes;
    },
    reads: () => reads,
    // Turned on, and what it read then settled.
    on: async () => {
      watch.watch(true);
      await new Promise((resolve) => setImmediate(resolve));
    },
    // One beat of the timer, and whatever it started settled.
    beat: async () => {
      for (const timer of live()) timer.run();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('ClipboardWatch', () => {
  it('reads nothing while it is off, and reads on a bounded timer once it is on', async () => {
    const clipboard = aWatch();

    await clipboard.beat();
    expect(clipboard.reads()).toBe(0);
    expect(clipboard.timers()).toEqual([]);

    await clipboard.on();
    expect(clipboard.timers().map((timer) => timer.ms)).toEqual([CLIPBOARD_READ_MS]);
    expect(CLIPBOARD_READ_MS).toBeGreaterThanOrEqual(500);
    expect(CLIPBOARD_READ_MS).toBeLessThanOrEqual(2000);

    await clipboard.on();
    expect(clipboard.timers()).toHaveLength(1);
  });

  it('takes nothing that was already copied when it was turned on, only what is copied afterwards', async () => {
    const clipboard = aWatch();
    clipboard.copy('https://example.com/before.zip');
    await clipboard.on();

    await clipboard.beat();
    expect(clipboard.offered).toEqual([]);

    clipboard.copy('https://example.com/after.zip');
    await clipboard.beat();
    expect(clipboard.offered).toEqual([['https://example.com/after.zip']]);
  });

  it('offers the http links of a copied text, once each and in order, and nothing for a text without one', async () => {
    const clipboard = aWatch();
    await clipboard.on();

    clipboard.copy('my password is hunter2');
    await clipboard.beat();
    clipboard.copy(
      'Files: https://example.com/a.zip, ftp://example.com/b.zip and (https://example.org/c.mkv) https://example.com/a.zip',
    );
    await clipboard.beat();
    await clipboard.beat();

    expect(clipboard.offered).toEqual([['https://example.com/a.zip', 'https://example.org/c.mkv']]);
  });

  it('offers a link again when it is copied again after something else', async () => {
    const clipboard = aWatch();
    await clipboard.on();

    for (const copied of ['https://example.com/a.zip', 'hello', 'https://example.com/a.zip']) {
      clipboard.copy(copied);
      await clipboard.beat();
    }

    expect(clipboard.offered).toEqual([
      ['https://example.com/a.zip'],
      ['https://example.com/a.zip'],
    ]);
  });

  it('offers every link of a long list, as many at a time as the engine takes', async () => {
    const clipboard = aWatch();
    await clipboard.on();
    const links = Array.from(
      { length: MAX_URLS_PER_REQUEST + 5 },
      (_, n) => `https://example.com/${String(n)}.zip`,
    );

    clipboard.copy(links.join('\n'));
    await clipboard.beat();

    expect(clipboard.offered.map((offer) => offer.length)).toEqual([MAX_URLS_PER_REQUEST, 5]);
    expect(clipboard.offered.flat()).toEqual(links);
  });

  it('offers one copy at a time: what is copied while the engine is asked is taken afterwards', async () => {
    let answer: () => void = () => undefined;
    const asked: string[][] = [];
    const clipboard = aWatch({
      offer: (links) => {
        asked.push([...links]);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    await clipboard.on();

    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();
    expect(asked).toEqual([['https://example.com/a.zip']]);

    answer();
    await new Promise((resolve) => setImmediate(resolve));
    await clipboard.beat();
    expect(asked).toEqual([['https://example.com/a.zip'], ['https://example.com/b.zip']]);
  });

  it('says in the log that links were not offered, never which, and goes on', async () => {
    let refuse = true;
    const asked: string[][] = [];
    const clipboard = aWatch({
      offer: async (links) => {
        asked.push([...links]);
        if (refuse) throw new Error('The engine did not take the links.');
      },
    });
    await clipboard.on();

    clipboard.copy('https://example.com/secret-a.zip');
    await clipboard.beat();
    refuse = false;
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();

    expect(asked).toHaveLength(2);
    expect(clipboard.warnings).toHaveLength(1);
    expect(clipboard.warnings[0]).toContain('clipboard_links_not_offered');
    expect(clipboard.warnings.join('\n')).not.toContain('secret-a');
  });

  it('passes over a clipboard the system will not read, and reads it again at the next beat', async () => {
    const clipboard = aWatch();
    await clipboard.on();

    clipboard.fail(true);
    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();
    expect(clipboard.offered).toEqual([]);

    clipboard.fail(false);
    await clipboard.beat();
    expect(clipboard.offered).toEqual([['https://example.com/a.zip']]);
  });

  it('stops reading when it is turned off, and starts from what is there when turned on again', async () => {
    const clipboard = aWatch();
    await clipboard.on();
    clipboard.watch.watch(false);

    expect(clipboard.timers()).toEqual([]);
    const reads = clipboard.reads();
    clipboard.copy('https://example.com/while-off.zip');
    await clipboard.beat();
    expect(clipboard.reads()).toBe(reads);

    await clipboard.on();
    await clipboard.beat();
    expect(clipboard.offered).toEqual([]);
  });

  it('takes nothing a read of before a turn off and on finds, nor reads before the new start is known', async () => {
    // Each read answers when the spec says.
    const reads: ((text: string) => void)[] = [];
    const offered: string[][] = [];
    const beats: (() => void)[] = [];
    const watch = new ClipboardWatch({
      read: () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
      offer: async (links) => {
        offered.push([...links]);
      },
      every: (_ms, run) => {
        beats.push(run);
        return () => {
          beats.splice(beats.indexOf(run), 1);
        };
      },
      log: { info: () => undefined, warn: () => undefined },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const beat = async () => {
      for (const run of [...beats]) run();
      await settle();
    };
    const link = 'https://example.com/copied-before.zip';

    watch.watch(true);
    reads.shift()?.('');
    await settle();
    // A beat's read is on its way when the switch goes off and on again.
    await beat();
    watch.watch(false);
    watch.watch(true);
    reads.shift()?.(link);
    await settle();
    // The new start has not read the clipboard yet: no beat reads before it has — one that did,
    // answered first, would find a clipboard nothing was known of.
    await beat();
    reads.pop()?.(link);
    await settle();
    reads.shift()?.(link);
    await settle();
    await beat();
    reads.shift()?.(link);
    await settle();

    expect(offered).toEqual([]);
  });
});
