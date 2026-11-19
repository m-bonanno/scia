import { describe, expect, it } from 'vitest';
import { type NoticeStore, ShownNotices } from './shown-notices.ts';

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
    const notices = new ShownNotices(store);

    expect(await notices.firstTime('hidden-to-tray')).toBe(true);
    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(store.saved).toEqual(['hidden-to-tray']);
  });

  it('remembers across launches, each notice on its own', async () => {
    const store = memoryStore(['hidden-to-tray']);
    const notices = new ShownNotices(store);

    expect(await notices.firstTime('hidden-to-tray')).toBe(false);
    expect(await notices.firstTime('another')).toBe(true);
    expect(store.saved).toEqual(['hidden-to-tray', 'another']);
  });

  it('starts over from a file it cannot make sense of', async () => {
    for (const unreadable of [null, 'text', { shown: true }, [1, 2]]) {
      const notices = new ShownNotices(memoryStore(unreadable));
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

    expect(await new ShownNotices(broken).firstTime('hidden-to-tray')).toBe(true);
  });
});
