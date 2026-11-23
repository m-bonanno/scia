import { MARK } from '@scia/contracts/mark';
import type { ReactNode } from 'react';

// The tile's margin, which the logo has no tile for: the mark stands in the page about as large as
// the page's own drawing of it did before the icon's became the one (#88).
const MARGIN = 3;
const VIEW_BOX = [MARGIN, MARGIN, MARK.size - 2 * MARGIN, MARK.size - 2 * MARGIN].join(' ');

// The mark, as the app's icon draws it on its tile, in the theme's accent.
export function Logo({ size = 18 }: { readonly size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={MARK.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-accent"
    >
      {MARK.strokes.map(({ d, opacity }) => (
        <path key={d} d={d} opacity={opacity} />
      ))}
    </svg>
  );
}
