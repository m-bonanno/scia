import { UpdateRestart } from '@scia/contracts/bridge';
import { describe, expect, it } from 'vitest';
import {
  INSTALL_AND_RESTART,
  INSTALL_AT_QUIT,
  isBeta,
  isNothingPublished,
  UPDATE_CHECK_EVERY_MS,
  UPDATE_RETRY_MS,
  Updates,
  updatesApply,
  type UpdatesOptions,
} from './updates.ts';

// Lets every promise that can settle, settle.
const settle = () => new Promise((resolve) => setImmediate(resolve));

interface Timer {
  readonly ms: number;
  readonly run: () => void;
  calledOff: boolean;
}

// A fetch the spec ends by hand, and that ends by itself when its signal is aborted.
interface Fetch {
  readonly signal: AbortSignal;
  readonly finish: () => void;
  readonly fail: (error: Error) => void;
}

function updating(overrides: Partial<UpdatesOptions> = {}) {
  const timers: Timer[] = [];
  const checks: boolean[] = [];
  const fetches: Fetch[] = [];
  const lines: { level: string; event: string; data: object }[] = [];
  let answer: string | undefined = '1.1.0';
  let installs = 0;
  const updates = new Updates({
    betas: async () => false,
    check: async (betas) => {
      checks.push(betas);
      return answer;
    },
    fetch: (signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('cancelled'));
        });
        fetches.push({ signal, finish: resolve, fail: reject });
      }),
    install: () => {
      installs += 1;
      return true;
    },
    wait: (ms, run) => {
      const timer: Timer = { ms, run, calledOff: false };
      timers.push(timer);
      return () => {
        timer.calledOff = true;
      };
    },
    log: {
      info: (event, data) => lines.push({ level: 'info', event, data }),
      warn: (event, data) => lines.push({ level: 'warn', event, data }),
    },
    ...overrides,
  });
  return {
    updates,
    timers,
    checks,
    fetches,
    lines,
    pending: () => timers.filter((timer) => !timer.calledOff),
    answering: (version: string | undefined) => {
      answer = version;
    },
    installs: () => installs,
  };
}

// Runs the one timer that is waiting, as its time would come.
async function elapse(timers: Timer[]): Promise<number> {
  const waiting = timers.filter((timer) => !timer.calledOff);
  expect(waiting).toHaveLength(1);
  const [timer] = waiting;
  timer!.calledOff = true;
  timer!.run();
  await settle();
  return timer!.ms;
}

describe('updatesApply', () => {
  it('is true for the packaged app on a system whose releases carry an installer', () => {
    expect(updatesApply({ packaged: true, platform: 'win32', version: '1.0.0-beta.13' })).toBe(
      true,
    );
  });

  it('is false for a build that is not packaged, and on a system with no installer', () => {
    expect(updatesApply({ packaged: false, platform: 'win32', version: '1.0.0' })).toBe(false);
    expect(updatesApply({ packaged: true, platform: 'linux', version: '1.0.0' })).toBe(false);
    expect(updatesApply({ packaged: true, platform: 'darwin', version: '1.0.0' })).toBe(false);
  });

  it('is false for a package no release made: its version is 0.0.0, older than any release', () => {
    expect(updatesApply({ packaged: true, platform: 'win32', version: '0.0.0' })).toBe(false);
  });
});

describe('isBeta', () => {
  it('tells a pre-release version from a stable one', () => {
    expect(isBeta('1.0.0-beta.13')).toBe(true);
    expect(isBeta('1.0.0')).toBe(false);
    expect(isBeta('12.4.1')).toBe(false);
  });
});

describe('INSTALL_AT_QUIT', () => {
  it('starts the installer silent, and does not start Scia again after it', () => {
    expect(INSTALL_AT_QUIT).toEqual({ silent: true, runAfter: false });
  });
});

describe('isNothingPublished', () => {
  // electron-updater's errors carry a code. Read in the packaged app against this repository on
  // 20 November 2026, with the betas off and no stable release: "No published versions on GitHub".
  const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

  it('tells releases that hold no version to take from a check that failed', () => {
    expect(
      isNothingPublished(
        withCode('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'),
      ),
    ).toBe(true);
    for (const [message, code] of [
      [
        'Cannot find latest.yml in the latest release artifacts',
        'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
      ],
      ['Unable to find latest version on GitHub', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'],
      ['Cannot parse releases feed', 'ERR_UPDATER_INVALID_RELEASE_FEED'],
      ['net::ERR_INTERNET_DISCONNECTED', 'ERR_INTERNET_DISCONNECTED'],
    ]) {
      expect(isNothingPublished(withCode(message!, code!)), code).toBe(false);
    }
    expect(isNothingPublished(new Error('No published versions on GitHub'))).toBe(false);
    expect(isNothingPublished('ERR_UPDATER_NO_PUBLISHED_VERSIONS')).toBe(false);
  });
});

describe('Updates', () => {
  describe('when it checks', () => {
    it('checks at once, then every six hours', async () => {
      const { updates, timers, checks, answering } = updating();
      answering(undefined);

      updates.start();
      await settle();
      expect(checks).toHaveLength(1);

      expect(await elapse(timers)).toBe(UPDATE_CHECK_EVERY_MS);
      expect(checks).toHaveLength(2);
      expect(UPDATE_CHECK_EVERY_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('checks again an hour after a check that failed, and says why in one line of the log', async () => {
      const { updates, timers, lines } = updating({
        check: async () => {
          throw new Error(
            'Cannot find latest.yml in the latest release artifacts\nHeaders: {\n  "server": "github.com"\n}',
          );
        },
      });

      updates.start();
      await settle();

      expect(lines).toContainEqual({
        level: 'warn',
        event: 'update_check_failed',
        data: { error: 'Error: Cannot find latest.yml in the latest release artifacts' },
      });
      expect(timers.map((timer) => timer.ms)).toEqual([UPDATE_RETRY_MS]);
      expect(UPDATE_RETRY_MS).toBe(60 * 60 * 1000);
    });

    it('guesses no channel: an engine that does not say the setting puts the check off an hour', async () => {
      const { updates, timers, checks, lines } = updating({
        betas: async () => {
          throw new Error('no answer in time');
        },
      });

      updates.start();
      await settle();

      expect(checks).toEqual([]);
      expect(timers.map((timer) => timer.ms)).toEqual([UPDATE_RETRY_MS]);
      expect(lines.map((line) => line.event)).toContain('update_check_put_off');
    });

    it('reads the setting at every check: the betas only when the switch is on', async () => {
      let betas = false;
      const { updates, timers, checks } = updating({
        betas: async () => betas,
        check: async (withBetas) => {
          checks.push(withBetas);
          return undefined;
        },
      });

      updates.start();
      await settle();
      betas = true;
      await elapse(timers);

      expect(checks).toEqual([false, true]);
    });

    it('has one check at a time and one timer waiting', async () => {
      const { updates, timers } = updating({ check: async () => undefined });

      updates.start();
      await settle();
      await elapse(timers);
      await elapse(timers);

      expect(timers.filter((timer) => !timer.calledOff)).toHaveLength(1);
    });
  });

  describe('when it downloads', () => {
    it('downloads what it found once the engine says nothing is running or waiting', async () => {
      const { updates, fetches } = updating();

      updates.start();
      await settle();
      expect(fetches).toHaveLength(0);

      updates.engineSays({ idle: true });
      expect(fetches).toHaveLength(1);
    });

    it('does not download while the engine has not said yet', async () => {
      const { updates, fetches } = updating();

      updates.start();
      await settle();

      expect(fetches).toHaveLength(0);
    });

    it('does not download while a download of the person runs or waits', async () => {
      const { updates, fetches } = updating();
      updates.engineSays({ idle: false });

      updates.start();
      await settle();
      updates.engineSays({ idle: false });

      expect(fetches).toHaveLength(0);
    });

    it('downloads at once when the engine is already idle at the check', async () => {
      const { updates, fetches } = updating();
      updates.engineSays({ idle: true });

      updates.start();
      await settle();

      expect(fetches).toHaveLength(1);
    });

    it('gives the download up when the person starts one, and takes it up again when idle', async () => {
      const { updates, fetches, lines } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      updates.engineSays({ idle: false });
      await settle();
      expect(fetches[0]!.signal.aborted).toBe(true);
      expect(lines.map((line) => line.event)).toContain('update_fetch_put_off');

      updates.engineSays({ idle: true });
      await settle();
      expect(fetches).toHaveLength(2);
      expect(fetches[1]!.signal.aborted).toBe(false);
    });

    it('does not download again what it already has', async () => {
      const { updates, fetches, timers } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();
      fetches[0]!.finish();
      await settle();

      await elapse(timers);
      updates.engineSays({ idle: true });

      expect(fetches).toHaveLength(1);
    });

    it('goes on with a download when a check finds the same version again', async () => {
      const { updates, fetches, timers } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      await elapse(timers);

      expect(fetches).toHaveLength(1);
      expect(fetches[0]!.signal.aborted).toBe(false);
    });

    it('keeps nothing of a download that finished after it was given up', async () => {
      let finish: () => void = () => undefined;
      const { updates, fetches, lines } = updating({
        // A download that does not stop when it is told to, and finishes all the same.
        fetch: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
            fetches.push({
              signal: new AbortController().signal,
              finish: resolve,
              fail: () => undefined,
            });
          }),
      });
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      updates.engineSays({ idle: false });
      finish();
      await settle();

      expect(lines.map((line) => line.event)).not.toContain('update_ready');
      expect(lines.map((line) => line.event)).toContain('update_fetch_put_off');
      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('downloads nothing that the last check no longer offered, found while Scia was busy', async () => {
      const { updates, fetches, timers, answering } = updating();
      updates.engineSays({ idle: false });
      answering('1.1.0-beta.1');
      updates.start();
      await settle();

      // The switch turned off: the stables alone hold nothing newer.
      answering(undefined);
      await elapse(timers);
      updates.engineSays({ idle: true });
      await settle();

      expect(fetches).toHaveLength(0);
    });

    it('gives up a download that the last check no longer offered, and does not take it up', async () => {
      const { updates, fetches, timers, answering } = updating();
      updates.engineSays({ idle: true });
      answering('1.1.0-beta.1');
      updates.start();
      await settle();
      expect(fetches).toHaveLength(1);

      answering(undefined);
      await elapse(timers);
      expect(fetches[0]!.signal.aborted).toBe(true);
      updates.engineSays({ idle: false });
      updates.engineSays({ idle: true });
      await settle();

      expect(fetches).toHaveLength(1);
      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('takes the newer version when one comes out while it downloads another', async () => {
      const { updates, fetches, timers, answering, lines } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      answering('1.2.0');
      await elapse(timers);

      expect(fetches[0]!.signal.aborted).toBe(true);
      expect(fetches).toHaveLength(2);
      expect(
        lines.filter((line) => line.event === 'update_fetching').map((line) => line.data),
      ).toEqual([{ version: '1.1.0' }, { version: '1.2.0' }]);
      fetches[1]!.finish();
      await settle();
      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);
    });

    it('starts the newer download only once the one it replaces has ended', async () => {
      const ends: (() => void)[] = [];
      const { updates, timers, answering, lines } = updating({
        // A download that takes its time to stop once it is told to.
        fetch: (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              ends.push(() => {
                reject(new Error('cancelled'));
              });
            });
          }),
      });
      const fetching = () => lines.filter((line) => line.event === 'update_fetching').length;
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      answering('1.2.0');
      await elapse(timers);
      updates.engineSays({ idle: true });
      expect(fetching()).toBe(1);

      ends[0]!();
      await settle();
      expect(fetching()).toBe(2);
    });

    it('keeps nothing of a download that failed, and finds it again at the next check', async () => {
      const { updates, fetches, timers, lines } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      fetches[0]!.fail(new Error('sha512 checksum mismatch'));
      await settle();
      expect(lines).toContainEqual({
        level: 'warn',
        event: 'update_fetch_failed',
        data: { version: '1.1.0', error: 'Error: sha512 checksum mismatch' },
      });
      expect(fetches).toHaveLength(1);

      await elapse(timers);
      expect(fetches).toHaveLength(2);
    });
  });

  describe('at the quit', () => {
    async function ready(overrides: Partial<UpdatesOptions> = {}, version = '1.1.0') {
      const run = updating(overrides);
      run.answering(version);
      run.updates.engineSays({ idle: true });
      run.updates.start();
      await settle();
      run.fetches[0]!.finish();
      await settle();
      return run;
    }

    it('installs a downloaded stable when the person quits', async () => {
      const { updates } = await ready();

      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);
    });

    it('installs nothing at a quit the person did not ask for', async () => {
      const { updates } = await ready();

      expect(await updates.atQuit({ askedByPerson: false })).toBe(false);
    });

    it('installs nothing when nothing was downloaded', async () => {
      const { updates } = updating({ check: async () => undefined });
      updates.start();
      await settle();

      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('installs nothing that is still being downloaded, and gives that download up', async () => {
      const { updates, fetches } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
      expect(fetches[0]!.signal.aborted).toBe(true);
    });

    it('installs nothing while a newer version replaces the one downloaded', async () => {
      const { updates, timers, fetches, answering } = await ready();
      answering('1.2.0');
      await elapse(timers);
      expect(fetches).toHaveLength(2);

      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('installs a beta only when the switch is still on at the quit', async () => {
      let betas = true;
      const { updates } = await ready({ betas: async () => betas }, '1.1.0-beta.2');
      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);

      const second = await ready({ betas: async () => betas }, '1.1.0-beta.2');
      betas = false;
      expect(await second.updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('installs no beta when the engine does not say the setting at the quit, and says why', async () => {
      let asked = 0;
      const { updates, lines } = await ready(
        {
          betas: async () => {
            asked += 1;
            if (asked > 1) throw new Error('no answer in time');
            return true;
          },
        },
        '1.1.0-beta.2',
      );

      expect(await updates.atQuit({ askedByPerson: true })).toBe(false);
      expect(lines).toContainEqual({
        level: 'warn',
        event: 'update_not_installed',
        data: {
          version: '1.1.0-beta.2',
          reason: 'betas_unknown',
          error: 'Error: no answer in time',
        },
      });
    });

    it('asks the engine nothing at the quit for a stable', async () => {
      let asked = 0;
      const { updates } = await ready({
        betas: async () => {
          asked += 1;
          return false;
        },
      });

      await updates.atQuit({ askedByPerson: true });

      expect(asked).toBe(1);
    });

    it('stops checking and downloading once the quit has begun', async () => {
      const { updates, timers, checks, fetches } = updating();
      updates.engineSays({ idle: false });
      updates.start();
      await settle();

      await updates.atQuit({ askedByPerson: true });
      updates.engineSays({ idle: true });
      await settle();

      expect(timers.every((timer) => timer.calledOff)).toBe(true);
      expect(checks).toHaveLength(1);
      expect(fetches).toHaveLength(0);
    });

    it('asks for no version once the quit has begun while the setting was being read', async () => {
      let say: (betas: boolean) => void = () => undefined;
      const { updates, checks } = updating({
        betas: () =>
          new Promise<boolean>((resolve) => {
            say = resolve;
          }),
      });
      updates.start();
      await settle();

      const quitting = updates.atQuit({ askedByPerson: true });
      say(true);
      await quitting;
      await settle();

      expect(checks).toEqual([]);
    });

    it('lets a check that was on its way at the quit start nothing', async () => {
      let answer: (version: string) => void = () => undefined;
      const { updates, timers, fetches } = updating({
        check: () =>
          new Promise<string>((resolve) => {
            answer = resolve;
          }),
      });
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      await updates.atQuit({ askedByPerson: true });
      answer('1.1.0');
      await settle();

      expect(fetches).toHaveLength(0);
      expect(timers.filter((timer) => !timer.calledOff)).toHaveLength(0);
    });

    it('starts the installer it was told to, and says so in the log', async () => {
      const { updates, lines, installs } = await ready();
      await updates.atQuit({ askedByPerson: true });

      updates.install();

      expect(installs()).toBe(1);
      expect(lines).toContainEqual({
        level: 'info',
        event: 'update_installing',
        data: { version: '1.1.0', asked: true },
      });
    });
  });
});

describe('INSTALL_AND_RESTART', () => {
  it('starts the installer silent, and Scia again after it: the person asked for a restart', () => {
    expect(INSTALL_AND_RESTART).toEqual({ silent: true, runAfter: true });
  });
});

describe('Updates, offered to the person', () => {
  async function downloaded(overrides: Partial<UpdatesOptions> = {}, version = '1.1.0') {
    const run = updating(overrides);
    run.answering(version);
    run.updates.engineSays({ idle: true });
    run.updates.start();
    await settle();
    run.fetches[0]!.finish();
    await settle();
    return run;
  }

  describe('what it offers', () => {
    it('offers nothing before an update is downloaded', async () => {
      const { updates } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      expect(await updates.offered()).toBeUndefined();
    });

    it('offers the version downloaded and checked', async () => {
      const { updates } = await downloaded();

      expect(await updates.offered()).toBe('1.1.0');
    });

    it('offers a beta only while the switch is on, as the quit would install it', async () => {
      let betas = true;
      const { updates } = await downloaded({ betas: async () => betas }, '1.1.0-beta.2');
      expect(await updates.offered()).toBe('1.1.0-beta.2');

      betas = false;
      expect(await updates.offered()).toBeUndefined();
    });

    it('offers no beta when the engine does not say the setting', async () => {
      let asked = 0;
      const { updates } = await downloaded(
        {
          betas: async () => {
            asked += 1;
            if (asked > 1) throw new Error('no answer in time');
            return true;
          },
        },
        '1.1.0-beta.2',
      );

      expect(await updates.offered()).toBeUndefined();
    });

    it('offers nothing while a newer version replaces the one downloaded', async () => {
      const { updates, timers, answering } = await downloaded();
      answering('1.2.0');
      await elapse(timers);

      expect(await updates.offered()).toBeUndefined();
    });

    it('says when what it may offer changes: downloaded, then replaced', async () => {
      let told = 0;
      const { updates, timers, answering } = await downloaded({
        onOffer: () => {
          told += 1;
        },
      });
      expect(told).toBe(1);

      answering('1.2.0');
      await elapse(timers);
      expect(told).toBe(2);
      expect(await updates.offered()).toBeUndefined();
    });

    it('offers nothing once the quit has begun', async () => {
      const { updates } = await downloaded();

      await updates.atQuit({ askedByPerson: true });

      expect(await updates.offered()).toBeUndefined();
    });
  });

  describe('when the person asks to restart', () => {
    it('restarts when nothing is running or waiting, and installs with Scia started after', async () => {
      const restarts: boolean[] = [];
      const { updates } = await downloaded({
        install: (restart) => {
          restarts.push(restart);
          return true;
        },
      });

      expect(await updates.restart(async () => 0)).toBe(UpdateRestart.Restarting);
      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);
      updates.install();

      expect(restarts).toEqual([true]);
    });

    it('refuses while a download runs or waits, as the engine says it when asked', async () => {
      const { updates } = await downloaded();

      expect(await updates.restart(async () => 2)).toBe(UpdateRestart.Busy);
    });

    it('refuses when the engine does not say what it is doing', async () => {
      const { updates } = await downloaded();

      expect(
        await updates.restart(async () => {
          throw new Error('no answer in time');
        }),
      ).toBe(UpdateRestart.Busy);
    });

    it('has nothing to restart for when nothing is offered', async () => {
      let betas = true;
      const { updates } = await downloaded({ betas: async () => betas }, '1.1.0-beta.2');
      betas = false;

      expect(await updates.restart(async () => 0)).toBe(UpdateRestart.Nothing);
    });

    it('installs at a later quit with no start after it, once a restart was refused', async () => {
      const restarts: boolean[] = [];
      const { updates } = await downloaded({
        install: (restart) => {
          restarts.push(restart);
          return true;
        },
      });
      await updates.restart(async () => 1);

      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);
      updates.install();

      expect(restarts).toEqual([false]);
    });

    it('does not restart once a quit began while the engine was asked', async () => {
      const restarts: boolean[] = [];
      const { updates } = await downloaded({
        install: (restart) => {
          restarts.push(restart);
          return true;
        },
      });

      const answer = await updates.restart(async () => {
        await updates.atQuit({ askedByPerson: true });
        return 0;
      });
      updates.install();

      expect(answer).toBe(UpdateRestart.Nothing);
      expect(restarts).toEqual([false]);
    });

    it('says in the log that the person asked, and why it was refused', async () => {
      const { updates, lines } = await downloaded();

      await updates.restart(async () => 1);
      await updates.restart(async () => 0);

      expect(lines).toContainEqual({
        level: 'info',
        event: 'update_restart_refused',
        data: { version: '1.1.0', reason: 'busy' },
      });
      expect(lines).toContainEqual({
        level: 'info',
        event: 'update_restart',
        data: { version: '1.1.0' },
      });
    });
  });
});
