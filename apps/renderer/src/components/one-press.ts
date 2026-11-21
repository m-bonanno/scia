import { type KeyboardEvent, type MouseEvent, useRef } from 'react';

// Longer than the longest time a system counts two clicks as one double click.
const BURST_MS = 1000;

export interface OnePress {
  // Whether this click is a later one of a burst this button saw begin. It records the click:
  // ask once per click.
  readonly sawTheOneBefore: (event: MouseEvent) => boolean;
  // Turns away the repeats of Enter held down. Of Enter alone: a held Tab must walk on.
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

// A press is one press however it is repeated (apps/renderer/CLAUDE.md, "Forgiving"). A click
// that says it is the second, on a button that saw no first, is a new press — someone clearing a
// list whose rows slide under the pointer — so only the button's own burst is recognised.
export function useOnePress(): OnePress {
  const lastClick = useRef({ detail: 0, at: 0 });
  return {
    sawTheOneBefore: (event) => {
      const now = Date.now();
      const before =
        lastClick.current.detail === event.detail - 1 && now - lastClick.current.at < BURST_MS;
      lastClick.current = { detail: event.detail, at: now };
      return event.detail > 1 && before;
    },
    onKeyDown: (event) => {
      if (event.repeat && event.key === 'Enter') event.preventDefault();
    },
  };
}
