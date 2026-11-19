import { describe, expect, it, vi } from 'vitest';
import { RestartPolicy } from './restart-policy.ts';
import { ServerSupervisor, type StartedServer } from './server-supervisor.ts';

interface FakeServer extends StartedServer {
  exit(code: number): void;
  stops(): number;
}

function fakeServer(port: number): FakeServer {
  let exit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  let stops = 0;
  return {
    port,
    exited,
    exit,
    stops: () => stops,
    stop: async () => {
      stops += 1;
    },
  };
}

function supervisorOver(starts: (() => Promise<StartedServer>)[], maxFailures = 2) {
  const onRestarted = vi.fn();
  const onGaveUp = vi.fn();
  const supervisor = new ServerSupervisor({
    start: () => {
      const next = starts.shift();
      return next === undefined ? Promise.reject(new Error('no more engines')) : next();
    },
    policy: new RestartPolicy({
      maxFailures,
      healthyAfterMs: 60_000,
      firstDelayMs: 1,
      longestDelayMs: 1,
    }),
    now: () => 0,
    sleep: () => Promise.resolve(),
    onRestarted,
    onGaveUp,
    log: { warn: () => undefined },
  });
  return { supervisor, onRestarted, onGaveUp };
}

describe('ServerSupervisor', () => {
  it('starts the engine again when it exits by itself and says where it is now', async () => {
    const first = fakeServer(1000);
    const second = fakeServer(2000);
    const { supervisor, onRestarted } = supervisorOver([async () => first, async () => second]);

    expect(await supervisor.start()).toBe(1000);
    first.exit(1);

    await vi.waitFor(() => {
      expect(onRestarted).toHaveBeenCalledWith(2000);
    });
  });

  it('gives up once the engine keeps failing to come back', async () => {
    const first = fakeServer(1000);
    const { supervisor, onRestarted, onGaveUp } = supervisorOver([async () => first]);

    await supervisor.start();
    first.exit(1);

    await vi.waitFor(() => {
      expect(onGaveUp).toHaveBeenCalledOnce();
    });
    expect(onRestarted).not.toHaveBeenCalled();
  });

  it('does not restart an engine it was asked to stop', async () => {
    const first = fakeServer(1000);
    const { supervisor, onRestarted, onGaveUp } = supervisorOver([
      async () => first,
      async () => fakeServer(2000),
    ]);

    await supervisor.start();
    await supervisor.stop();
    first.exit(0);
    await Promise.resolve();

    expect(first.stops()).toBe(1);
    expect(onRestarted).not.toHaveBeenCalled();
    expect(onGaveUp).not.toHaveBeenCalled();
  });

  it('stops an engine that was still starting when it was asked to stop', async () => {
    let ready: (server: StartedServer) => void = () => undefined;
    const late = fakeServer(1000);
    const { supervisor } = supervisorOver([
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    ]);

    const starting = supervisor.start();
    await supervisor.stop();
    ready(late);
    await starting;

    // stop() had nothing to stop when it ran: the engine that arrives afterwards is stopped.
    expect(late.stops()).toBe(1);
  });

  it('does not give up on a restart that fails after it was asked to stop', async () => {
    const first = fakeServer(1000);
    let fail: (error: Error) => void = () => undefined;
    const { supervisor, onGaveUp } = supervisorOver(
      [
        async () => first,
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      ],
      1,
    );
    await supervisor.start();
    first.exit(1);
    // The restart is in flight when the app quits.
    await vi.waitFor(() => {
      expect(fail).not.toBe(undefined);
    });
    await new Promise((resolve) => setImmediate(resolve));
    await supervisor.stop();

    fail(new Error('killed with the app'));
    await new Promise((resolve) => setImmediate(resolve));

    // One failure was all the policy allowed: without the check, this is "cannot start" shown
    // to someone who is quitting.
    expect(onGaveUp).not.toHaveBeenCalled();
  });
});
