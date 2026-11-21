import { MAX_URLS_PER_REQUEST } from '@scia/contracts';
import { describe, expect, it } from 'vitest';
import { CLIPBOARD_READ_MS, ClipboardWatch } from './clipboard-watch.ts';

function aWatch(
  options: {
    offer?: (links: readonly string[]) => Promise<number>;
    offerMagnets?: (magnets: readonly string[]) => Promise<number>;
  } = {},
) {
  // Something is on the clipboard before the reading starts, as it nearly always is.
  let text = 'copied before Scia read it';
  let reads = 0;
  let failing = false;
  const offered: string[][] = [];
  const said: number[] = [];
  const magnets: string[][] = [];
  const sent: number[] = [];
  const warnings: string[] = [];
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const watch = new ClipboardWatch({
    read: async () => {
      reads += 1;
      if (failing) throw new Error('The system said no.');
      return text;
    },
    // By default the engine takes every link it is given.
    offer:
      options.offer ??
      (async (links) => {
        offered.push([...links]);
        return links.length;
      }),
    added: (count) => {
      said.push(count);
    },
    // By default a service is connected, and takes every magnet.
    offerMagnets:
      options.offerMagnets ??
      (async (copied) => {
        magnets.push([...copied]);
        return copied.length;
      }),
    sent: (count) => {
      sent.push(count);
    },
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
    said,
    magnets,
    sent,
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

const settle = () => new Promise((resolve) => setImmediate(resolve));

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

  it('offers the magnets of a copied text apart from its links, and says how many were sent (#139)', async () => {
    const clipboard = aWatch();
    const magnet =
      'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=films&tr=http://tracker.example/announce';
    await clipboard.on();

    clipboard.copy(`${magnet} and https://example.com/a.zip`);
    await clipboard.beat();
    clipboard.copy(magnet);
    await clipboard.beat();
    // A text with no magnet asks the engine nothing about magnets.
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();

    // The tracker inside the magnet is no link of its own.
    expect(clipboard.offered).toEqual([
      ['https://example.com/a.zip'],
      ['https://example.com/b.zip'],
    ]);
    expect(clipboard.magnets).toEqual([[magnet], [magnet]]);
    expect(clipboard.said).toEqual([1, 1]);
    expect(clipboard.sent).toEqual([1, 1]);
  });

  it('says no magnet sent when the engine took none, and warns when it could not be told', async () => {
    let refuse = false;
    const clipboard = aWatch({
      offerMagnets: async () => {
        if (refuse) throw new Error('The engine said no.');
        return 0;
      },
    });
    await clipboard.on();

    clipboard.copy(
      'magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=films&tr=http://tracker.example/announce',
    );
    await clipboard.beat();
    refuse = true;
    clipboard.copy('magnet:?xt=urn:btih:' + 'b'.repeat(40));
    await clipboard.beat();

    expect(clipboard.sent).toEqual([]);
    expect(clipboard.warnings).toEqual([
      'clipboard_magnets_not_offered {"magnets":1,"error":"The engine said no."}',
    ]);
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
    let answer: (added: number) => void = () => undefined;
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

    answer(1);
    await settle();
    await clipboard.beat();
    expect(asked).toEqual([['https://example.com/a.zip'], ['https://example.com/b.zip']]);
  });

  it('says how many were added once for each copy, however many requests it took, and nothing when none was', async () => {
    let taken = 0;
    const clipboard = aWatch({
      offer: async (links) => Promise.resolve(Math.min(taken, links.length)),
    });
    await clipboard.on();

    taken = MAX_URLS_PER_REQUEST;
    clipboard.copy(
      Array.from(
        { length: MAX_URLS_PER_REQUEST + 50 },
        (_, n) => `https://example.com/${String(n)}.zip`,
      ).join(' '),
    );
    await clipboard.beat();
    taken = 0;
    clipboard.copy('https://example.com/page');
    await clipboard.beat();

    expect(clipboard.said).toEqual([MAX_URLS_PER_REQUEST + 50]);
  });

  it('says in the log that links were not offered, never which, and goes on', async () => {
    let refuse = true;
    const asked: string[][] = [];
    const clipboard = aWatch({
      offer: async (links) => {
        asked.push([...links]);
        if (refuse) throw new Error('The engine did not take the links.');
        return links.length;
      },
    });
    await clipboard.on();

    clipboard.copy('https://example.com/secret-a.zip');
    await clipboard.beat();
    refuse = false;
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();

    expect(asked).toHaveLength(2);
    expect(clipboard.said).toEqual([1]);
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

  it('takes nothing that was there when it started, also when the system refused its first read', async () => {
    const clipboard = aWatch();
    clipboard.copy('https://example.com/before.zip');
    clipboard.fail(true);
    await clipboard.on();

    clipboard.fail(false);
    await clipboard.beat();
    await clipboard.beat();
    expect(clipboard.offered).toEqual([]);

    clipboard.copy('https://example.com/after.zip');
    await clipboard.beat();
    expect(clipboard.offered).toEqual([['https://example.com/after.zip']]);
  });

  it('takes nothing that was there when it started behind an empty first read, which Electron answers for a clipboard it could not open', async () => {
    const clipboard = aWatch();
    clipboard.copy('');
    await clipboard.on();

    clipboard.copy('https://example.com/before.zip');
    await clipboard.beat();
    expect(clipboard.offered).toEqual([]);

    clipboard.copy('https://example.com/after.zip');
    await clipboard.beat();
    expect(clipboard.offered).toEqual([['https://example.com/after.zip']]);
  });

  it('offers nothing again for a text read before and after an empty read', async () => {
    const clipboard = aWatch();
    await clipboard.on();
    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();

    // Another program holds the clipboard for a few seconds.
    clipboard.copy('');
    for (let beat = 0; beat < 5; beat += 1) await clipboard.beat();
    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();

    expect(clipboard.offered).toEqual([['https://example.com/a.zip']]);
  });

  it('counts the empty reads of each start afresh', async () => {
    const clipboard = aWatch();
    clipboard.copy('');
    await clipboard.on();
    await clipboard.beat();
    clipboard.watch.watch(false);

    await clipboard.on();
    clipboard.copy('https://example.com/before.zip');
    await clipboard.beat();

    expect(clipboard.offered).toEqual([]);
  });

  it('takes a clipboard empty for a few reads at the start as empty: the first copy after them is offered', async () => {
    const clipboard = aWatch();
    clipboard.copy('');
    await clipboard.on();
    await clipboard.beat();
    await clipboard.beat();

    clipboard.copy('https://example.com/first.zip');
    await clipboard.beat();

    expect(clipboard.offered).toEqual([['https://example.com/first.zip']]);
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

  it('goes on reading when it is turned off and on again while the engine is asked', async () => {
    const asked: string[][] = [];
    const clipboard = aWatch({
      offer: (links) => {
        asked.push([...links]);
        // The first offer never answers; the next ones do.
        return asked.length === 1 ? new Promise<number>(() => undefined) : Promise.resolve(1);
      },
    });
    await clipboard.on();
    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();

    clipboard.watch.watch(false);
    await clipboard.on();
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();

    expect(asked).toEqual([['https://example.com/a.zip'], ['https://example.com/b.zip']]);
  });

  it('never asks the engine twice at once within a turn, also when an offer of before a turn off and on answers late', async () => {
    const answers: ((added: number) => void)[] = [];
    const asked: string[][] = [];
    const clipboard = aWatch({
      offer: (links) => {
        asked.push([...links]);
        return new Promise((resolve) => {
          answers.push(resolve);
        });
      },
    });
    await clipboard.on();
    clipboard.copy('https://example.com/a.zip');
    await clipboard.beat();
    clipboard.watch.watch(false);
    await clipboard.on();
    clipboard.copy('https://example.com/b.zip');
    await clipboard.beat();

    // The offer of the turn before answers while this turn's is still on its way.
    answers[0]?.(1);
    await settle();
    clipboard.copy('https://example.com/c.zip');
    await clipboard.beat();

    expect(asked).toEqual([['https://example.com/a.zip'], ['https://example.com/b.zip']]);
  });

  it('stops a long copy between two requests when it is turned off, and says nothing of it', async () => {
    let answer: (added: number) => void = () => undefined;
    const asked: number[] = [];
    const clipboard = aWatch({
      offer: (links) => {
        asked.push(links.length);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    await clipboard.on();
    clipboard.copy(
      Array.from(
        { length: MAX_URLS_PER_REQUEST + 5 },
        (_, n) => `https://example.com/${String(n)}.zip`,
      ).join(' '),
    );
    await clipboard.beat();

    clipboard.watch.watch(false);
    answer(MAX_URLS_PER_REQUEST);
    await settle();

    expect(asked).toEqual([MAX_URLS_PER_REQUEST]);
    expect(clipboard.said).toEqual([]);
  });

  describe('with reads that answer when the spec says', () => {
    function aSlowWatch() {
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
          return links.length;
        },
        added: () => undefined,
        offerMagnets: async (magnets) => Promise.resolve(magnets.length),
        sent: () => undefined,
        every: (_ms, run) => {
          beats.push(run);
          return () => {
            beats.splice(beats.indexOf(run), 1);
          };
        },
        log: { info: () => undefined, warn: () => undefined },
      });
      const beat = async () => {
        for (const run of [...beats]) run();
        await settle();
      };
      return { watch, reads, offered, beat };
    }
    const link = 'https://example.com/copied-before.zip';

    it('takes nothing a beat of before a turn off and on reads, nor reads before the new start is known', async () => {
      const { watch, reads, offered, beat } = aSlowWatch();

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

    it('lets no first read of before a turn off and on set what was there', async () => {
      const { watch, reads, offered, beat } = aSlowWatch();

      // The first read of the first turn is slow; the switch goes off and on meanwhile.
      watch.watch(true);
      watch.watch(false);
      watch.watch(true);
      // The new turn's first read finds the link that was copied before.
      reads.pop()?.(link);
      await settle();
      // The old one answers last, with what was on the clipboard long before.
      reads.shift()?.('https://example.com/copied-long-before.zip');
      await settle();
      await beat();
      reads.shift()?.(link);
      await settle();

      expect(offered).toEqual([]);
    });
  });
});
