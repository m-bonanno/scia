// The mark: a download arrow and the wake ("scia") it leaves behind. One drawing, in a square of
// its own, which the page's logo and every icon of the app draw (#88): the icon on a tile in the
// square, the logo with no tile, in the theme's accent.
export interface MarkStroke {
  readonly d: string;
  readonly opacity?: number;
}

// Strokes, never a fill: a round cap adds half the width to each end, so the cap and the join are
// the mark's proportions as much as its paths are.
export interface Mark {
  readonly size: number;
  readonly fill: 'none';
  readonly strokeWidth: number;
  readonly lineCap: 'round' | 'butt' | 'square';
  readonly lineJoin: 'round' | 'miter' | 'bevel';
  readonly strokes: readonly MarkStroke[];
}

export const MARK: Mark = {
  size: 32,
  fill: 'none',
  strokeWidth: 3,
  lineCap: 'round',
  lineJoin: 'round',
  strokes: [
    { d: 'M16 6v18' },
    { d: 'M9 17.5 16 24.5l7-7' },
    { d: 'M9 6.5v4.5', opacity: 0.5 },
    { d: 'M23 6.5v4.5', opacity: 0.5 },
  ],
};
