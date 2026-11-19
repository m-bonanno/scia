import { describe, expect, it } from 'vitest';
import { etaSeconds, SpeedMeter } from './speed.ts';

describe('SpeedMeter', () => {
  it('reads zero before anything arrived', () => {
    expect(new SpeedMeter().bytesPerSecond(5000)).toBe(0);
  });

  it('averages what arrived over the window', () => {
    const meter = new SpeedMeter(3000);
    for (let at = 0; at < 6000; at += 100) meter.record(1000, at);
    expect(meter.bytesPerSecond(6000)).toBe(10_000);
  });

  it('does not inflate the first instants of a transfer', () => {
    const meter = new SpeedMeter(3000);
    meter.record(50_000, 0);
    expect(meter.bytesPerSecond(100)).toBe(50_000);
  });

  it('falls to zero once the transfer has stalled for a whole window', () => {
    const meter = new SpeedMeter(3000);
    meter.record(90_000, 0);
    expect(meter.bytesPerSecond(2000)).toBe(45_000);
    expect(meter.bytesPerSecond(3100)).toBe(0);
  });
});

describe('etaSeconds', () => {
  it('rounds up to whole seconds', () => {
    expect(etaSeconds(1500, 1000)).toBe(2);
  });

  it('has no answer for a stalled transfer', () => {
    expect(etaSeconds(1500, 0)).toBeNull();
  });
});
