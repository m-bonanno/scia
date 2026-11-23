import type { Mark } from '@scia/contracts/mark';

export interface TileColours {
  readonly background: string;
  readonly foreground: string;
}

// The tile's corner, in the units of the mark's square.
const TILE_RADIUS = 7;

// The app's icon: the mark on a tile as large as the mark's square, in fixed colours (#81).
export function iconSvg(mark: Mark, { background, foreground }: TileColours): string {
  const size = String(mark.size);
  const strokes = mark.strokes.map(
    ({ d, opacity }) =>
      `    <path d="${d}"${opacity === undefined ? '' : ` opacity="${String(opacity)}"`} />\n`,
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">\n`,
    `  <rect width="${size}" height="${size}" rx="${String(TILE_RADIUS)}" fill="${background}" />\n`,
    `  <g fill="${mark.fill}" stroke="${foreground}" stroke-width="${String(mark.strokeWidth)}" stroke-linecap="${mark.lineCap}" stroke-linejoin="${mark.lineJoin}">\n`,
    ...strokes,
    '  </g>\n',
    '</svg>\n',
  ].join('');
}
