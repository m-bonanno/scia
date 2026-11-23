import { MARK } from '@scia/contracts/mark';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './logo.tsx';

function drawn(size?: number): SVGSVGElement {
  const { container } = render(size === undefined ? <Logo /> : <Logo size={size} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('The logo drew no SVG');
  return svg;
}

// The app's icon draws the same mark on its tile (apps/desktop/scripts/icons; #88).
describe('Logo', () => {
  it('draws the mark of the app’s icon: its strokes, their width and the wake’s opacity', () => {
    const svg = drawn();

    expect(svg.getAttribute('stroke-width')).toBe(String(MARK.strokeWidth));
    expect(svg.getAttribute('stroke-linecap')).toBe(MARK.lineCap);
    expect(svg.getAttribute('stroke-linejoin')).toBe(MARK.lineJoin);
    expect(svg.getAttribute('fill')).toBe(MARK.fill);
    expect(
      [...svg.querySelectorAll('path')].map((path) => ({
        d: path.getAttribute('d'),
        opacity: path.getAttribute('opacity'),
      })),
    ).toEqual(
      MARK.strokes.map(({ d, opacity }) => ({
        d,
        opacity: opacity === undefined ? null : String(opacity),
      })),
    );
  });

  // The mark stands where it stands on the tile, with 3 units of the tile's margin left out: about
  // as large on the page as the logo before #88.
  it('frames it in a square centred on the mark’s own', () => {
    const viewBox = drawn().getAttribute('viewBox') ?? '';
    const [x = NaN, y = NaN, width = NaN, height = NaN] = viewBox.split(' ').map(Number);

    expect(viewBox).toBe('3 3 26 26');
    expect(width).toBe(height);
    expect(x + width / 2).toBe(MARK.size / 2);
    expect(y + height / 2).toBe(MARK.size / 2);
  });

  it('is as large as it is asked to be, in the accent, and hidden from assistive technology', () => {
    const svg = drawn(26);

    expect(svg.getAttribute('width')).toBe('26');
    expect(svg.getAttribute('height')).toBe('26');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg).toHaveClass('text-accent');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});
