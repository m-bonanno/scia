export interface DialogBounds {
  // How tall the notices are, at the window's bottom: 0 while none is shown.
  readonly stack: number;
  // How tall what the dialog shows is, with no room under it.
  readonly content: number;
  readonly window: number;
  // The most the dialog may be: past it, it scrolls.
  readonly tallest: number;
}

// The room a centred dialog keeps under its end so that the notices lie over none of what it
// shows (#143). None where they do not reach it, so that a dialog they leave alone does not move
// under the pointer that just pressed in it (the product designer, round 1 of #244).
export function roomOverDialog({ stack, content, window, tallest }: DialogBounds): number {
  const height = Math.min(content, tallest);
  const covered = (window + height) / 2 - (window - stack);
  if (stack <= 0 || covered <= 0) return 0;
  // Grown by its room, the dialog is centred again and ends half of it lower: twice what was
  // covered clears it — unless it reaches its tallest first, where it scrolls, and room down to
  // where the notices begin is enough.
  const margin = (window - tallest) / 2;
  return Math.ceil(Math.min(2 * covered, stack - margin));
}
