import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from './confirm-button.tsx';

function aButton(onConfirm: () => void, confirmLabel: string | undefined = 'Run') {
  return (
    <>
      <ConfirmButton label="Open" confirmLabel={confirmLabel} onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>
      <button type="button">Elsewhere</button>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConfirmButton', () => {
  it('does it at the second press, and is one button all along: the focus never leaves it', async () => {
    const onConfirm = vi.fn();
    render(aButton(onConfirm));

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('takes a key held down as one press: it asks, and does not answer itself', async () => {
    const onConfirm = vi.fn();
    render(aButton(onConfirm));

    await userEvent.tab();
    await userEvent.keyboard('{Enter>5/}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
  });

  it('takes a double click as one press', async () => {
    const onConfirm = vi.fn();
    render(aButton(onConfirm));

    await userEvent.dblClick(screen.getByRole('button', { name: 'Open' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('goes back by itself after a moment, keeping the focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onConfirm = vi.fn();
    render(aButton(onConfirm));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.tab();
    await user.keyboard('{Enter}');
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('goes back when the focus leaves it', async () => {
    const onConfirm = vi.fn();
    render(aButton(onConfirm));

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('with nothing to ask, does it at the first press — once, however the press is repeated', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton label="Open" confirmLabel={undefined} onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter>5/}');
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.dblClick(screen.getByRole('button', { name: 'Open' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
