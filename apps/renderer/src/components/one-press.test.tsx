import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useOnePress } from './one-press.ts';

function Pressable({ onPress }: { readonly onPress: () => void }): ReactNode {
  const press = useOnePress();
  return (
    <button
      type="button"
      onKeyDown={press.onKeyDown}
      onClick={(event) => {
        if (!press.sawTheOneBefore(event)) onPress();
      }}
    >
      Press
    </button>
  );
}

describe('useOnePress', () => {
  it('takes the later clicks of a burst it saw begin as the same press', () => {
    const onPress = vi.fn();
    render(<Pressable onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Press' });

    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.click(button, { detail: 3 });

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('takes a click that says it is a later one, of a burst it did not see whole, as a press of its own', () => {
    const onPress = vi.fn();
    render(<Pressable onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Press' });

    // The click before this one landed on another button, which slid away under the pointer.
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 3 });

    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
