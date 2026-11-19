import { describe, expect, it } from 'vitest';
import { RestartPolicy } from './restart-policy.ts';

const limits = { maxFailures: 3, healthyAfterMs: 60_000, firstDelayMs: 500, longestDelayMs: 1500 };

describe('RestartPolicy', () => {
  it('waits longer after each failure in a row, up to a cap', () => {
    const policy = new RestartPolicy(limits);
    expect(policy.next(100)).toBe(500);
    expect(policy.next(100)).toBe(1000);
    expect(policy.next(100)).toBe(1500);
  });

  it('gives up after too many failures in a row', () => {
    const policy = new RestartPolicy(limits);
    policy.next(100);
    policy.next(100);
    policy.next(100);
    expect(policy.next(100)).toBeNull();
  });

  it('starts counting again after an engine that ran well', () => {
    const policy = new RestartPolicy(limits);
    policy.next(100);
    policy.next(100);
    expect(policy.next(120_000)).toBe(500);
    expect(policy.next(100)).toBe(1000);
  });
});
