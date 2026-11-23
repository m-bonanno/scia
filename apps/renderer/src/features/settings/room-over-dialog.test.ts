import { describe, expect, it } from 'vitest';
import { roomOverDialog } from './room-over-dialog.ts';

// A window 720 high, whose dialog may be 682 high: 19 px from each edge, as Chromium's own.
const WINDOW = 720;
const TALLEST = 682;

describe('roomOverDialog', () => {
  it('is none while no notice is shown', () => {
    expect(roomOverDialog({ stack: 0, content: 900, window: WINDOW, tallest: TALLEST })).toBe(0);
  });

  it('is none for a dialog the notices do not reach: it does not move', () => {
    // Centred, 520 high: it ends at 620, and the notices, 80 high, begin at 640.
    expect(roomOverDialog({ stack: 80, content: 520, window: WINDOW, tallest: TALLEST })).toBe(0);
    // Ending exactly where they begin.
    expect(roomOverDialog({ stack: 80, content: 560, window: WINDOW, tallest: TALLEST })).toBe(0);
  });

  it('is twice what they cover of a dialog that fits: grown by it, centred again, it ends above them', () => {
    // 600 high, it ends at 660, 20 under where the notices begin. 640 high, it ends at 680 and its
    // content at 640.
    expect(roomOverDialog({ stack: 80, content: 600, window: WINDOW, tallest: TALLEST })).toBe(40);
  });

  it('is what they cover of a dialog at its tallest, which scrolls: its content ends above them', () => {
    // It ends at 701; the notices begin at 640.
    expect(roomOverDialog({ stack: 80, content: 900, window: WINDOW, tallest: TALLEST })).toBe(61);
    // One that would reach its tallest once grown scrolls too: 640 high, grown by 80 it would be
    // 720, more than it may be.
    expect(roomOverDialog({ stack: 80, content: 640, window: WINDOW, tallest: TALLEST })).toBe(61);
  });

  it('is a whole number of pixels, never less than it needs', () => {
    // 61.4 is owed: rounded, it would be 61, and the last 0.4 px would lie under the notices.
    expect(roomOverDialog({ stack: 80.4, content: 900, window: WINDOW, tallest: TALLEST })).toBe(
      62,
    );
  });
});
