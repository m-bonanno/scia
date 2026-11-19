import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmButton, type ConfirmButtonHandle } from './confirm-button.tsx';

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

  it('refuses the repeats of Enter alone: a held Tab walks on through it', async () => {
    render(
      <>
        <button type="button">Before</button>
        {aButton(vi.fn())}
      </>,
    );
    screen.getByRole('button', { name: 'Before' }).focus();

    await userEvent.keyboard('{Tab>2/}');

    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
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

  // Quick presses on a list whose rows leave: each lands on the button that slid under the
  // pointer, which has seen none of the presses before it.
  it('counts a press as repeated only if it saw the one before: the second click of a double click begun elsewhere is a first press', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton label="Remove from list" confirmLabel={undefined} onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove from list' }), { detail: 2 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('while it asks, takes no later press of a burst as the answer, whoever saw the burst begin', () => {
    const onConfirm = vi.fn();
    const handle: { current: ConfirmButtonHandle | null } = { current: null };
    render(
      <ConfirmButton ref={handle} label="Open" confirmLabel="Run" onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>,
    );

    act(() => {
      handle.current?.press();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }), { detail: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }), { detail: 3 });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('forgets a press after a moment: it is not the beginning of a burst that comes later', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(
      <ConfirmButton label="Remove from list" confirmLabel={undefined} onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>,
    );
    const button = screen.getByRole('button', { name: 'Remove from list' });

    fireEvent.click(button, { detail: 1 });
    vi.advanceTimersByTime(5000);
    // The second press of a burst begun on the row above, long after this button's own press.
    fireEvent.click(button, { detail: 2 });

    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('never answers its own question when pressed from elsewhere', async () => {
    const onConfirm = vi.fn();
    const handle: { current: ConfirmButtonHandle | null } = { current: null };
    render(
      <ConfirmButton ref={handle} label="Open" confirmLabel="Run" onConfirm={onConfirm}>
        <svg aria-hidden="true" />
      </ConfirmButton>,
    );

    act(() => {
      handle.current?.press();
    });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
    act(() => {
      handle.current?.press();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
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
