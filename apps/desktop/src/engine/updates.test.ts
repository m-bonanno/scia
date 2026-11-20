import { describe, expect, it } from 'vitest';
import {
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

    it('takes the newer version when one comes out while it downloads another', async () => {
      const { updates, fetches, timers, answering } = updating();
      updates.engineSays({ idle: true });
      updates.start();
      await settle();

      answering('1.2.0');
      await elapse(timers);

      expect(fetches[0]!.signal.aborted).toBe(true);
      expect(fetches).toHaveLength(2);
      fetches[1]!.finish();
      await settle();
      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);
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

    it('installs a beta only when the switch is still on at the quit', async () => {
      let betas = true;
      const { updates } = await ready({ betas: async () => betas }, '1.1.0-beta.2');
      expect(await updates.atQuit({ askedByPerson: true })).toBe(true);

      const second = await ready({ betas: async () => betas }, '1.1.0-beta.2');
      betas = false;
      expect(await second.updates.atQuit({ askedByPerson: true })).toBe(false);
    });

    it('installs no beta when the engine does not say the setting at the quit', async () => {
      let asked = 0;
      const { updates } = await ready(
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
      const { updates, timers, checks, fetches, answering } = updating();
      answering(undefined);
      updates.start();
      await settle();

      await updates.atQuit({ askedByPerson: true });
      updates.engineSays({ idle: true });

      expect(timers.every((timer) => timer.calledOff)).toBe(true);
      expect(checks).toHaveLength(1);
      expect(fetches).toHaveLength(0);
    });

    it('starts the installer it was told to, and says so in the log', async () => {
      const { updates, lines, installs } = await ready();
      await updates.atQuit({ askedByPerson: true });

      updates.install();

      expect(installs()).toBe(1);
      expect(lines).toContainEqual({
        level: 'info',
        event: 'update_installing',
        data: { version: '1.1.0', started: true },
      });
    });
  });
});
