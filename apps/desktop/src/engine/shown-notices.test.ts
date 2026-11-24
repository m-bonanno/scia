import { describe, expect, it, vi } from 'vitest';
import { type NoticeLog, type NoticeStore, ShownNotices } from './shown-notices.ts';

const silent: NoticeLog = { info: () => undefined, warn: () => undefined };

function memoryStore(initial: unknown = []): NoticeStore & { saved: unknown } {
  const store = {
    saved: initial,
    read: async () => store.saved,
    write: async (shown: readonly string[]) => {
      store.saved = shown;
    },
  };
  return store;
}

function recording() {
  const lines: [string, string, object][] = [];
  const log: NoticeLog = {
    info: (message, details) => lines.push(['info', message, details]),
    warn: (message, details) => lines.push(['warn', message, details]),
  };
  return { log, lines };
}

// What Node throws when Windows refuses the rename onto a file another program holds: its message
// names the profile's whole path, the person's account with it.
const refusedRename = () =>
  Object.assign(
    new Error(
      "EPERM: operation not permitted, rename 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\notices.json.tmp' -> 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\notices.json'",
    ),
    { code: 'EPERM', syscall: 'rename' },
  );

// A store whose writes end when the spec says: on Windows a write waits a while for a file another
// program holds (#307).
function slowStore() {
  const started: { shown: readonly string[]; land: () => void }[] = [];
  let saved: readonly string[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const store: NoticeStore = {
    read: async () => saved,
    write: (shown) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      return new Promise<void>((resolve) => {
        started.push({
          shown,
          land: () => {
            inFlight -= 1;
            saved = shown;
            resolve();
          },
        });
      });
    },
  };
  return { store, started, saved: () => saved, mostInFlight: () => mostInFlight };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ShownNotices', () => {
  it('says a notice is new once, and remembers it', async () => {
    const store = memoryStore();
    const notices = new ShownNotices(store, silent);

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    await vi.waitFor(() => {
      expect(store.saved).toEqual(['hidden-to-tray']);
    });
  });

  it('remembers across launches, each notice on its own', async () => {
    const store = memoryStore(['hidden-to-tray']);
    const notices = new ShownNotices(store, silent);

    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(await notices.firstTime('another')).toBe(true);
    await vi.waitFor(() => {
      expect(store.saved).toEqual(['hidden-to-tray', 'another']);
    });
  });

  it('starts over from a file it cannot make sense of', async () => {
    for (const unreadable of [null, 'text', { shown: true }, [1, 2]]) {
      const notices = new ShownNotices(memoryStore(unreadable), silent);
      expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    }
  });

  it('shows the notice rather than fail, when it cannot read or write', async () => {
    const broken: NoticeStore = {
      read: async () => {
        throw new Error('disk');
      },
      write: async () => {
        throw new Error('disk');
      },
    };

    expect(await new ShownNotices(broken, silent).firstTime('hidden-to-tray')).toBe(true);
  });

  // The notice is decided when the window hides: a quit, or the window brought back, during a
  // wait for a held file would have got a notice that no longer held, and been recorded as shown.
  it('answers before its write ends, so that nothing decided with the answer waits for the file', async () => {
    const disk = slowStore();
    const notices = new ShownNotices(disk.store, silent);

    const answered = notices.firstTime('hidden-to-tray');
    await settle();

    expect(await Promise.race([answered, Promise.resolve('waiting for the write')])).toBe(true);
    expect(disk.started.map((write) => write.shown)).toEqual([['hidden-to-tray']]);
  });

  it('answers once in a run, also to an ask that comes while its write is on its way', async () => {
    const disk = slowStore();
    const notices = new ShownNotices(disk.store, silent);

    const answers = await Promise.all([
      notices.firstTime('hidden-to-tray'),
      notices.firstTime('hidden-to-tray'),
    ]);
    await settle();
    disk.started[0]?.land();
    await settle();

    expect(answers).toEqual([true, false]);
    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(disk.started).toHaveLength(1);
  });

  // Two writes of one file at once share its `.tmp`: the later rename would find it gone (#307).
  it('writes one at a time, each from the file as the last write left it', async () => {
    const disk = slowStore();
    const notices = new ShownNotices(disk.store, silent);

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    expect(await notices.firstTime('another')).toBe(true);
    await settle();
    expect(disk.started).toHaveLength(1);
    disk.started[0]?.land();
    await vi.waitFor(() => {
      expect(disk.started).toHaveLength(2);
    });
    disk.started[1]?.land();

    expect(disk.mostInFlight()).toBe(1);
    expect(disk.saved()).toEqual(['hidden-to-tray', 'another']);
  });

  // The error's message names the profile's whole path, the person's account with it: its code
  // says why.
  it('says in the log a notice it could not keep, with the system’s code of why', async () => {
    const { log, lines } = recording();
    const store: NoticeStore = {
      read: async () => [],
      write: async () => {
        throw refusedRename();
      },
    };
    const notices = new ShownNotices(store, log);

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);

    await vi.waitFor(() => {
      expect(lines).toEqual([
        ['warn', 'notices_not_kept', { notice: 'hidden-to-tray', code: 'EPERM' }],
      ]);
    });
  });

  // The log is what a run waits on, rather than reading the file under the write (#280).
  it('says in the log a notice it kept, once its write has landed', async () => {
    const disk = slowStore();
    const { log, lines } = recording();
    const notices = new ShownNotices(disk.store, log);

    await notices.firstTime('hidden-to-tray');
    await settle();
    expect(lines).toEqual([]);
    disk.started[0]?.land();

    await vi.waitFor(() => {
      expect(lines).toEqual([['info', 'notices_kept', { notice: 'hidden-to-tray' }]]);
    });
  });

  it('shows a notice again at the next launch when its write was given up', async () => {
    let refuses = true;
    const disk = memoryStore();
    const store: NoticeStore = {
      read: () => disk.read(),
      write: async (shown) => {
        if (refuses) throw refusedRename();
        await disk.write(shown);
      },
    };
    const { log, lines } = recording();
    expect(await new ShownNotices(store, log).firstTime('hidden-to-tray')).toBe(true);
    await vi.waitFor(() => {
      expect(lines).toHaveLength(1);
    });
    refuses = false;

    expect(await new ShownNotices(store, silent).firstTime('hidden-to-tray')).toBe(true);
  });
});
