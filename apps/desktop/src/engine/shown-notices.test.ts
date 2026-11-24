import { describe, expect, it } from 'vitest';
import { type NoticeLog, type NoticeStore, ShownNotices } from './shown-notices.ts';

const silent: NoticeLog = { warn: () => undefined };

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

describe('ShownNotices', () => {
  it('says a notice is new once, and remembers it', async () => {
    const store = memoryStore();
    const notices = new ShownNotices(store, silent);

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(store.saved).toEqual(['hidden-to-tray']);
  });

  it('remembers across launches, each notice on its own', async () => {
    const store = memoryStore(['hidden-to-tray']);
    const notices = new ShownNotices(store, silent);

    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(await notices.firstTime('another')).toBe(true);
    expect(store.saved).toEqual(['hidden-to-tray', 'another']);
  });

  it('starts over from a file it cannot make sense of', async () => {
    for (const unreadable of [null, 'text', { shown: true }, [1, 2]]) {
      const notices = new ShownNotices(memoryStore(unreadable), silent);
      expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    }
  });

  it('shows the notice again next time rather than fail, when it cannot read or write', async () => {
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

  // On Windows another program reading the file is enough to fail the rename (#307). The error's
  // message names the profile's whole path, the person's account with it: its code says why.
  it('says in the log a notice it could not keep, with the system’s code of why', async () => {
    const lines: [string, object][] = [];
    const store: NoticeStore = {
      read: async () => [],
      write: async () => {
        throw Object.assign(
          new Error(
            "EPERM: operation not permitted, rename 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\notices.json.tmp' -> 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\notices.json'",
          ),
          { code: 'EPERM', syscall: 'rename' },
        );
      },
    };
    const notices = new ShownNotices(store, {
      warn: (message, details) => lines.push([message, details]),
    });

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);

    expect(lines).toEqual([['notices_not_kept', { notice: 'hidden-to-tray', code: 'EPERM' }]]);
  });

  it('says nothing in the log of a notice it kept', async () => {
    const lines: unknown[] = [];
    const notices = new ShownNotices(memoryStore(), { warn: (...line) => lines.push(line) });

    await notices.firstTime('hidden-to-tray');

    expect(lines).toEqual([]);
  });
});
