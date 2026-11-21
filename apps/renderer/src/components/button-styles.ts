import { cn } from '@/lib/cn.ts';

export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

// A button that says what it does in a word, where the action is not the page's main one.
export const TEXT_BUTTON = cn(
  'inline-flex h-8 shrink-0 items-center rounded-lg bg-tonal px-3 text-sm font-medium text-foreground transition-colors',
  'hover:bg-border disabled:opacity-40 disabled:hover:bg-tonal',
  'aria-disabled:opacity-40 aria-disabled:hover:bg-tonal',
  FOCUS_RING,
);

// The way back from what a text button beside it would do: the same size, without its fill.
export const QUIET_BUTTON = cn(
  'inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors',
  'hover:bg-tonal hover:text-foreground',
  // It can be reached while it does nothing — `aria-disabled` — so the focus is never left on
  // a control that is gone from the order.
  'aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
  FOCUS_RING,
);

const ICON_BUTTON_SHAPE = cn(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors',
  'hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent',
  FOCUS_RING,
);

// What a button that is only an icon looks like: `IconButton`, and the button that asks once
// more, which looks like one until it is pressed.
export const ICON_BUTTON = cn(ICON_BUTTON_SHAPE, 'hover:bg-tonal');

// The same on a ground that is already `tonal` (a notice): under the pointer it takes the next
// step of tone, or it would not change at all.
export const ICON_BUTTON_ON_TONAL = cn(ICON_BUTTON_SHAPE, 'hover:bg-border');
