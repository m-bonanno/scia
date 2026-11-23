import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATES, npmRun, runGates } from './gates.mjs';

describe('runGates', () => {
  it('runs the gates of review-flow.md in their order', async () => {
    const ran = [];
    const outcome = await runGates(async (gate) => {
      ran.push(gate.script);
      return 0;
    });

    expect(ran).toEqual(['check:adr', 'format:check', 'lint', 'typecheck', 'test', 'build']);
    expect(outcome).toEqual({ ok: true, failed: undefined });
  });

  it('stops at the first gate that fails, and names it', async () => {
    const ran = [];
    const outcome = await runGates(async (gate) => {
      ran.push(gate.script);
      return gate.script === 'typecheck' ? 2 : 0;
    });

    expect(ran).toEqual(['check:adr', 'format:check', 'lint', 'typecheck']);
    expect(outcome).toEqual({ ok: false, failed: 'typecheck' });
  });

  it('asks the tests for a quiet reporter, and nothing else of any gate', () => {
    expect(GATES.find((gate) => gate.script === 'test')?.args).toEqual(['--reporter=dot']);
    expect(GATES.filter((gate) => gate.args.length > 0).map((gate) => gate.script)).toEqual([
      'test',
    ]);
  });
});

describe('npmRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('starts the gate without colour, whatever the shell asked for', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // The opposite of what the gates set: a shell that exports them would hide a gate that does not.
    vi.stubEnv('NO_COLOR', '');
    vi.stubEnv('FORCE_COLOR', '1');
    let environment;
    const spawn = (_command, options) => {
      environment = options.env;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    };

    await npmRun({ script: 'lint', args: [] }, spawn);

    expect(environment).toMatchObject({ NO_COLOR: '1', FORCE_COLOR: '0' });
  });
});
