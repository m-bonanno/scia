import { DEFAULT_THEME, Theme } from '@scia/contracts/theme';
import { describe, expect, it } from 'vitest';
import { RememberedTheme, type ThemeLog, type ThemeStore } from './remembered-theme.ts';

function recording() {
  const lines: [string, string, object][] = [];
  const log: ThemeLog = {
    info: (message, details) => lines.push(['info', message, details]),
    warn: (message, details) => lines.push(['warn', message, details]),
  };
  return { log, lines };
}

const silent = recording().log;

function storing(stored: unknown) {
  const writes: unknown[] = [];
  const store: ThemeStore = {
    read: async () => {
      if (stored instanceof Error) throw stored;
      return stored;
    },
    write: async (value) => {
      writes.push(value);
    },
  };
  return { theme: new RememberedTheme(store, silent), writes };
}

describe('RememberedTheme', () => {
  it('reads the theme the engine said last time', async () => {
    const { theme } = storing({ theme: Theme.Brick });

    expect(await theme.read()).toBe(Theme.Brick);
  });

  it.each([
    ['nothing kept', undefined],
    ['a file that holds null', null],
    ['a theme Scia does not know', { theme: 'neon' }],
    ['something else', ['brick']],
    ['a file that cannot be read', new Error('EACCES')],
  ])('reads the default theme for %s', async (_, stored) => {
    const { theme } = storing(stored);

    expect(await theme.read()).toBe(DEFAULT_THEME);
  });

  it('keeps a theme the engine says, once', async () => {
    const { theme, writes } = storing(undefined);
    await theme.read();

    await theme.keep(Theme.Ice);
    await theme.keep(Theme.Ice);

    expect(writes).toEqual([{ theme: Theme.Ice }]);
  });

  it('does not write again the theme it read', async () => {
    const { theme, writes } = storing({ theme: Theme.Earth });
    await theme.read();

    await theme.keep(Theme.Earth);
    expect(writes).toEqual([]);
    await theme.keep(Theme.Ice);

    expect(writes).toEqual([{ theme: Theme.Ice }]);
  });

  // A write that failed may have left anything on disk: the theme kept before it is no longer
  // known to be there.
  it('writes again the theme it had kept, once a later write failed', async () => {
    let fails = false;
    const writes: unknown[] = [];
    const theme = new RememberedTheme(
      {
        read: async () => undefined,
        write: async (value) => {
          if (fails) throw new Error('disk full');
          writes.push(value);
        },
      },
      silent,
    );
    await theme.keep(Theme.Brick);
    fails = true;
    await theme.keep(Theme.Ice);
    fails = false;

    await theme.keep(Theme.Brick);

    expect(writes).toEqual([{ theme: Theme.Brick }, { theme: Theme.Brick }]);
  });

  it('never stops anything for a write that fails, and tries it again at the next', async () => {
    let fails = true;
    const writes: unknown[] = [];
    const theme = new RememberedTheme(
      {
        read: async () => undefined,
        write: async (value) => {
          if (fails) throw new Error('read-only profile');
          writes.push(value);
        },
      },
      silent,
    );

    await expect(theme.keep(Theme.Space)).resolves.toBeUndefined();
    fails = false;
    await theme.keep(Theme.Space);

    expect(writes).toEqual([{ theme: Theme.Space }]);
  });

  // What another program does to the file is not Scia's to see: on Windows a rename onto a file
  // another process has open fails (EPERM), and a write lost so said nothing at all (#280). The
  // log is also what a run waits on, rather than reading the file under the write.
  it('says in the log the theme it kept, once its write has landed', async () => {
    const disk = slowStore();
    const { log, lines } = recording();
    const theme = new RememberedTheme(disk.store, log);

    const kept = theme.keep(Theme.Ice);
    await settle();
    expect(lines).toEqual([]);
    disk.started[0]?.land();
    await kept;

    expect(lines).toEqual([['info', 'theme_kept', { theme: Theme.Ice }]]);
  });

  // The error's message names the profile's whole path, the person's account with it (#307): its
  // code says why.
  it('says in the log a write that failed, with its theme and the system’s code of why', async () => {
    const disk = slowStore();
    const { log, lines } = recording();
    const theme = new RememberedTheme(disk.store, log);

    const kept = theme.keep(Theme.Ice);
    await settle();
    disk.started[0]?.fail();
    await kept;

    expect(lines).toEqual([['warn', 'theme_not_kept', { theme: Theme.Ice, code: 'EPERM' }]]);
  });

  it('keeps a theme whose write landed when its line in the log fails, and does not write it again', async () => {
    const writes: unknown[] = [];
    let lineFails = true;
    const theme = new RememberedTheme(
      {
        read: async () => undefined,
        write: async (value) => {
          writes.push(value);
        },
      },
      {
        info: () => {
          if (!lineFails) return;
          lineFails = false;
          throw new Error('the log could not be written');
        },
        warn: () => undefined,
      },
    );

    await theme.keep(Theme.Ice).catch(() => undefined);
    await theme.keep(Theme.Ice);

    expect(writes).toEqual([{ theme: Theme.Ice }]);
  });

  // What Node throws when Windows refuses the rename onto a file another program holds.
  const refusedRename = () =>
    Object.assign(
      new Error(
        "EPERM: operation not permitted, rename 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\theme.json.tmp' -> 'C:\\Users\\ada\\AppData\\Roaming\\Scia\\theme.json'",
      ),
      { code: 'EPERM', syscall: 'rename' },
    );

  // A store whose writes end when the spec says, in any order: the engine said brick, then ice,
  // then road-trip, while the first write was still on its way (#262; .claude/gotchas.md, #53).
  function slowStore() {
    const started: { value: unknown; land: () => void; fail: () => void }[] = [];
    let landed: unknown;
    let inFlight = 0;
    let mostInFlight = 0;
    const store: ThemeStore = {
      read: async () => undefined,
      write: (value) => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        return new Promise<void>((resolve, reject) => {
          started.push({
            value,
            land: () => {
              inFlight -= 1;
              landed = value;
              resolve();
            },
            fail: () => {
              inFlight -= 1;
              reject(refusedRename());
            },
          });
        });
      },
    };
    return {
      store,
      started,
      landed: () => landed,
      mostInFlight: () => mostInFlight,
    };
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('writes one at a time, and leaves the theme said last on disk, whatever lands first', async () => {
    const disk = slowStore();
    const { log, lines } = recording();
    const theme = new RememberedTheme(disk.store, log);

    const kept = [theme.keep(Theme.Brick), theme.keep(Theme.Ice), theme.keep(Theme.RoadTrip)];
    await settle();
    // The later writes, had they started, would land first.
    for (const write of [...disk.started].reverse()) write.land();
    await settle();
    for (const write of disk.started.slice(1).reverse()) write.land();
    await Promise.all(kept);

    expect(disk.mostInFlight()).toBe(1);
    expect(disk.started.map((write) => write.value)).toEqual([
      { theme: Theme.Brick },
      { theme: Theme.RoadTrip },
    ]);
    expect(disk.landed()).toEqual({ theme: Theme.RoadTrip });
    // Each line names the theme its write carried, not the one asked while it was on its way.
    expect(lines).toEqual([
      ['info', 'theme_kept', { theme: Theme.Brick }],
      ['info', 'theme_kept', { theme: Theme.RoadTrip }],
    ]);
  });

  it('writes again a theme whose write failed while another was asked', async () => {
    const disk = slowStore();
    const { log, lines } = recording();
    const theme = new RememberedTheme(disk.store, log);
    const first = theme.keep(Theme.Brick);
    await settle();
    const second = theme.keep(Theme.Ice);

    disk.started[0]?.fail();
    await settle();
    disk.started[1]?.land();
    await Promise.all([first, second]);
    const third = theme.keep(Theme.Brick);
    await settle();
    disk.started[2]?.land();
    await third;

    expect(disk.started.map((write) => write.value)).toEqual([
      { theme: Theme.Brick },
      { theme: Theme.Ice },
      { theme: Theme.Brick },
    ]);
    expect(disk.landed()).toEqual({ theme: Theme.Brick });
    // The failure names the theme its write carried, not the one asked while it was on its way.
    expect(lines).toEqual([
      ['warn', 'theme_not_kept', { theme: Theme.Brick, code: 'EPERM' }],
      ['info', 'theme_kept', { theme: Theme.Ice }],
      ['info', 'theme_kept', { theme: Theme.Brick }],
    ]);
  });
});
