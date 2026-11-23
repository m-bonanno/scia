import { describe, expect, it } from 'vitest';
import { Quit } from './quit.ts';

// Lets every promise that can settle, settle.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function quitting(options: { installs?: () => Promise<boolean>; owedAStart?: boolean } = {}) {
  const calls: string[] = [];
  const lines: { event: string; data: object | undefined }[] = [];
  let stopped: () => void = () => undefined;
  const quit = new Quit({
    settle: () => {
      calls.push('settle');
    },
    installs: (askedByPerson) => {
      calls.push(`installs ${String(askedByPerson)}`);
      return (options.installs ?? (async () => false))();
    },
    stopEngine: () => {
      calls.push('stop');
      return new Promise<void>((resolve) => {
        stopped = resolve;
      });
    },
    finish: (install) => {
      calls.push(`finish ${String(install)}`);
      return options.owedAStart ?? false;
    },
    relaunch: () => {
      calls.push('relaunch');
    },
    exit: () => {
      calls.push('exit');
    },
    log: {
      info: (event, data) => {
        lines.push({ event, data });
      },
    },
  });
  // The engine says it has stopped and written its state.
  const engineStops = async () => {
    stopped();
    await settle();
  };
  return { quit, calls, lines, engineStops };
}

describe('Quit', () => {
  it('decides on the update while the engine runs, then stops it, then ends', async () => {
    const { quit, calls, lines, engineStops } = quitting({ installs: async () => true });

    quit.asked(true);
    await settle();
    expect(calls).toEqual(['settle', 'installs true', 'stop']);
    await engineStops();

    expect(calls).toEqual(['settle', 'installs true', 'stop', 'finish true', 'exit']);
    expect(quit.begun()).toBe(true);
    // The line a reader of the log, and the E2E suite, look for.
    expect(lines.at(-1)?.event).toBe('quit');
  });

  it('starts Scia again when its last step says it is owed a start', async () => {
    const { quit, calls, engineStops } = quitting({ owedAStart: true });

    quit.asked(true);
    await settle();
    await engineStops();

    expect(calls.slice(-3)).toEqual(['finish false', 'relaunch', 'exit']);
  });

  it('ends, installing nothing, when the update cannot be decided', async () => {
    const { quit, calls, engineStops } = quitting({
      installs: async () => {
        throw new Error('no answer');
      },
    });

    quit.asked(true);
    await settle();
    await engineStops();

    expect(calls).toEqual(['settle', 'installs true', 'stop', 'finish false', 'exit']);
  });

  it('takes a second ask during a quit for the same quit', async () => {
    const { quit, calls, engineStops } = quitting();

    quit.asked(true);
    quit.asked(false);
    await settle();
    await engineStops();

    expect(calls).toEqual(['settle', 'installs true', 'stop', 'finish false', 'exit']);
  });

  // A shutdown, a sign-out, an installer that needs Scia's files (#13): Windows may end the
  // process at any moment after it said so, and is not asked to wait.
  it('asks the engine to stop at once when the session ends, before anything else is settled', async () => {
    const { quit, calls, lines, engineStops } = quitting();

    quit.sessionEnded(['close-app']);

    expect(calls).toEqual(['settle', 'stop', 'installs false']);
    expect(quit.begun()).toBe(true);
    expect(lines).toContainEqual({
      event: 'session_ended',
      data: { reasons: ['close-app'], quitting: false },
    });
    await engineStops();
    expect(calls).toEqual(['settle', 'stop', 'installs false', 'exit']);
  });

  // Electron lets its own quit stand only from here on: begun inside the window's `session-end`,
  // it is what keeps Electron from ending the process the moment the handler returns.
  it('says that the session ended once told, and not before', () => {
    const { quit } = quitting();
    quit.asked(true);
    expect(quit.sessionHasEnded()).toBe(false);

    quit.sessionEnded(['shutdown']);

    expect(quit.sessionHasEnded()).toBe(true);
  });

  it('ends at the end of a session whose update cannot be decided', async () => {
    const { quit, calls, engineStops } = quitting({
      installs: async () => {
        throw new Error('no answer');
      },
    });

    quit.sessionEnded(['logoff']);
    await engineStops();

    expect(calls).toEqual(['settle', 'stop', 'installs false', 'exit']);
  });

  it('says nothing of an update when the session ends during a quit that installs none', async () => {
    const { quit, lines, engineStops } = quitting();
    quit.asked(true);

    quit.sessionEnded(['shutdown']);
    await settle();
    await engineStops();

    expect(lines).toContainEqual({
      event: 'session_ended',
      data: { reasons: ['shutdown'], quitting: true },
    });
    expect(lines.map((line) => line.event)).not.toContain('update_not_installed');
  });

  it('installs nothing and starts nothing when the session ends during a quit', async () => {
    let decide: (install: boolean) => void = () => undefined;
    const { quit, calls, lines, engineStops } = quitting({
      owedAStart: true,
      installs: () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    });
    quit.asked(true);

    quit.sessionEnded(['shutdown']);

    expect(calls).toEqual(['settle', 'installs true', 'stop']);
    decide(true);
    await engineStops();
    expect(calls.filter((call) => call === 'stop')).toEqual(['stop']);
    expect(calls).not.toContain('relaunch');
    expect(calls.filter((call) => call.startsWith('finish'))).toEqual([]);
    expect(calls.filter((call) => call === 'exit')).toEqual(['exit']);
    expect(lines).toContainEqual({
      event: 'update_not_installed',
      data: { reason: 'session_end' },
    });
  });

  it('takes a second end of the session for the same one', async () => {
    const { quit, calls, engineStops } = quitting();

    quit.sessionEnded(['logoff']);
    quit.sessionEnded(['logoff']);
    quit.asked(true);
    await engineStops();

    expect(calls).toEqual(['settle', 'stop', 'installs false', 'exit']);
  });
});
