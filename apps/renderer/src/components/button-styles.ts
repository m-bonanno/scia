import { cn } from '@/lib/cn.ts';

export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

// What a button that is only an icon looks like: `IconButton`, and the button that asks once
// more, which looks like one until it is pressed.
export const ICON_BUTTON = cn(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors',
  'hover:bg-tonal hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent',
  FOCUS_RING,
);
