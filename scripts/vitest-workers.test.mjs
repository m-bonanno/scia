import { describe, expect, it } from 'vitest';
import { workerCapOf } from '../vitest.workers.ts';

describe('workerCapOf', () => {
  it('caps the workers at a positive whole number', () => {
    expect(workerCapOf('2')).toEqual({ maxWorkers: 2 });
  });

  it('leaves Vitest its own count for anything else', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc']) {
      expect(workerCapOf(value), String(value)).toEqual({});
    }
  });
});
