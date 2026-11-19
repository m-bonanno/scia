import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatPercent, formatSpeed } from './format.ts';

const MIB = 1024 * 1024;

describe('formatBytes', () => {
  it('counts in 1024s with the Italian comma', () => {
    expect(formatBytes(0)).toBe('0\u00a0B');
    expect(formatBytes(1536)).toBe('2\u00a0KB');
    expect(formatBytes(1.25 * 1024 * MIB)).toBe('1,3\u00a0GB');
    expect(formatBytes(12.34 * MIB)).toBe('12,3\u00a0MB');
  });

  it('drops the decimal where it would be noise', () => {
    expect(formatBytes(340 * MIB)).toBe('340\u00a0MB');
  });
});

describe('formatSpeed', () => {
  it('is a size per second', () => {
    expect(formatSpeed(8.3 * MIB)).toBe('8,3\u00a0MB/s');
  });
});

describe('formatDuration', () => {
  it('uses the largest two units that matter', () => {
    expect(formatDuration(45)).toBe('45\u00a0s');
    expect(formatDuration(125)).toBe('2\u00a0min');
    expect(formatDuration(3900)).toBe('1\u00a0h 05\u00a0min');
    expect(formatDuration(2 * 86_400 + 3 * 3600)).toBe('2\u00a0g 3\u00a0h');
  });
});

describe('formatPercent', () => {
  it('never says 100% before the last byte', () => {
    expect(formatPercent(999, 1000)).toBe('99%');
    expect(formatPercent(1000, 1000)).toBe('100%');
    expect(formatPercent(0, 0)).toBe('0%');
    expect(formatPercent(420, 1000)).toBe('42%');
  });
});
