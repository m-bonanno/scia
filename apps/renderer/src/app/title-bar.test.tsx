import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TitleBar } from './title-bar.tsx';

const MIB = 1024 * 1024;

describe('TitleBar', () => {
  it('says what its number is in words anyone can read, not in a label on a plain element', () => {
    render(<TitleBar bytesPerSecond={10 * MIB} onOpenSettings={vi.fn()} />);

    expect(screen.getByText(/^Total speed:/)).toBeInTheDocument();
    expect(screen.getByText(/^10\.0\sMB\/s$/)).toBeInTheDocument();
  });

  it('shows no speed while nothing downloads', () => {
    render(<TitleBar bytesPerSecond={0} onOpenSettings={vi.fn()} />);

    expect(screen.queryByText(/Total speed/)).not.toBeInTheDocument();
  });
});
