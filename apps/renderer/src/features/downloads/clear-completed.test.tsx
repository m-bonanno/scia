import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClearCompleted } from './clear-completed.tsx';

describe('ClearCompleted (#215)', () => {
  it('moves no focus when it is drawn again with another way to hand it on', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ClearCompleted count={2} onClear={vi.fn()} onLeaveFocused={first} />,
    );
    const button = screen.getByRole('button', { name: 'Clear completed' });
    button.focus();

    rerender(<ClearCompleted count={2} onClear={vi.fn()} onLeaveFocused={second} />);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('hands the focus on, the last way it was given, when it leaves under it', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ClearCompleted count={2} onClear={vi.fn()} onLeaveFocused={first} />,
    );
    screen.getByRole('button', { name: 'Clear completed' }).focus();
    rerender(<ClearCompleted count={2} onClear={vi.fn()} onLeaveFocused={second} />);

    rerender(<></>);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
