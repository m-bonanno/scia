import { describe, expect, it } from 'vitest';
import { GATES, runGates } from './gates.mjs';

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
