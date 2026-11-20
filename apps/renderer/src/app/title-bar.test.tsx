import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TitleBar } from './title-bar.tsx';

const MIB = 1024 * 1024;

describe('TitleBar', () => {
  it('says what its number is in words anyone can read, not in a label on a plain element', () => {
    render(
      <TitleBar
        bytesPerSecond={10 * MIB}
        speedLimitBytesPerSecond={null}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText(/^Total speed:/)).toBeInTheDocument();
    expect(screen.getByText(/^10\.0\sMB\/s$/)).toBeInTheDocument();
  });

  it('says beside the speed that a limit is on, and which', () => {
    render(
      <TitleBar bytesPerSecond={MIB} speedLimitBytesPerSecond={MIB} onOpenSettings={vi.fn()} />,
    );

    expect(screen.getByText(/limit\s1\.0\sMB\/s/)).toBeInTheDocument();
    // Read aloud, or copied, as it is seen: the dot stands between two spaces in the text too.
    expect(screen.getByRole('banner')).toHaveTextContent(
      /Total speed: 1\.0\sMB\/s · limit\s1\.0\sMB\/s/,
    );
  });

  it('says nothing of a limit when there is none, or nothing for it to hold back', () => {
    const { rerender } = render(
      <TitleBar bytesPerSecond={MIB} speedLimitBytesPerSecond={null} onOpenSettings={vi.fn()} />,
    );
    expect(screen.queryByText(/limit/)).not.toBeInTheDocument();

    rerender(
      <TitleBar bytesPerSecond={0} speedLimitBytesPerSecond={MIB} onOpenSettings={vi.fn()} />,
    );
    expect(screen.queryByText(/limit/)).not.toBeInTheDocument();
  });

  it('shows no speed while nothing downloads', () => {
    render(
      <TitleBar bytesPerSecond={0} speedLimitBytesPerSecond={null} onOpenSettings={vi.fn()} />,
    );

    expect(screen.queryByText(/Total speed/)).not.toBeInTheDocument();
  });
});
