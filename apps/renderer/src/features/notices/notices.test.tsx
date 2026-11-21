import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notices } from './notices.tsx';
import { NOTICE_MS, NOTICES_AT_MOST } from './notice-limits.ts';
import { useNotices } from './use-notices.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Synchronous events only: the clock is the spec's, to the millisecond.
// The page as it uses them: what it was told, and what stays while it is true.
function Page({
  told,
  lasting = null,
}: {
  readonly told: readonly string[];
  readonly lasting?: string | null;
}) {
  const { notices, tell, dismiss } = useNotices();
  return (
    <>
      <input aria-label="Links to download" />
      {told.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => {
            tell(text);
          }}
        >
          {`tell ${text}`}
        </button>
      ))}
      <Notices
        notices={notices}
        lasting={lasting}
        onDismiss={dismiss}
        home={() => screen.getByRole('textbox', { name: 'Links to download' })}
      />
    </>
  );
}

// A press of Enter on what has the focus: a click, for a button.
function pressFocused() {
  const focused = document.activeElement;
  if (focused !== null) fireEvent.click(focused);
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('Notices', () => {
  it('says what went wrong as an alert, which the person can dismiss', () => {
    render(<Page told={['Scia could not open the file.']} />);

    fireEvent.click(screen.getByRole('button', { name: 'tell Scia could not open the file.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Scia could not open the file.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Scia could not open the file.')).not.toBeInTheDocument();
  });

  it('goes by itself once it has been there for its time, and not before', () => {
    render(<Page told={['One']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));

    wait(NOTICE_MS - 1);
    expect(screen.getByText('One')).toBeInTheDocument();
    wait(1);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('stays while the pointer is on it, and goes its whole time after the pointer left', () => {
    render(<Page told={['One']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));

    fireEvent.pointerOver(screen.getByText('One'));
    wait(NOTICE_MS * 3);
    expect(screen.getByText('One')).toBeInTheDocument();

    fireEvent.pointerOut(screen.getByText('One'));
    wait(NOTICE_MS - 1);
    expect(screen.getByText('One')).toBeInTheDocument();
    wait(1);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('stays while the focus is in it', () => {
    render(<Page told={['One']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).focus();
    });
    wait(NOTICE_MS * 3);
    expect(screen.getByText('One')).toBeInTheDocument();

    act(() => {
      screen.getByRole('textbox').focus();
    });
    wait(NOTICE_MS);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('says the same thing once: told again, the notice stays and its time starts again', () => {
    render(<Page told={['One']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    wait(NOTICE_MS - 1000);

    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    expect(screen.getAllByText('One')).toHaveLength(1);
    wait(NOTICE_MS - 1);
    expect(screen.getByText('One')).toBeInTheDocument();
    wait(1);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
  });

  it('stacks different things, newest last, and lets the oldest go past the most it shows', () => {
    const told = Array.from(
      { length: NOTICES_AT_MOST + 1 },
      (_, index) => `Notice ${String(index)}`,
    );
    render(<Page told={told} />);

    for (const text of told) fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));

    const shown = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(shown).toEqual(told.slice(1));
  });

  it('keeps what is true for as long as it is, with no way to dismiss it and no time', () => {
    const { rerender } = render(<Page told={[]} lasting="The engine is not responding." />);

    expect(screen.getByRole('alert')).toHaveTextContent('The engine is not responding.');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    wait(NOTICE_MS * 10);
    expect(screen.getByText('The engine is not responding.')).toBeInTheDocument();

    rerender(<Page told={[]} lasting={null} />);
    expect(screen.queryByText('The engine is not responding.')).not.toBeInTheDocument();
  });

  it('counts what stays true among the most it shows', () => {
    const told = Array.from({ length: NOTICES_AT_MOST }, (_, index) => `Notice ${String(index)}`);
    render(<Page told={told} lasting="The engine is not responding." />);

    for (const text of told) fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));

    const shown = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(shown).toEqual([...told.slice(1), 'The engine is not responding.']);
  });

  it('lets go what it did not show beside what stays true: nothing of it comes back after', () => {
    const engine = 'The engine is not responding.';
    const told = [engine, ...Array.from({ length: NOTICES_AT_MOST }, (_, i) => `N${String(i)}`)];
    const { rerender } = render(<Page told={told} lasting={engine} />);
    for (const text of told) fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));

    rerender(<Page told={told} lasting={null} />);

    const shown = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(shown).toEqual(told.slice(2));
  });

  it('announces what stays true again when it becomes true again', () => {
    const { rerender } = render(<Page told={[]} lasting="The engine is not responding." />);
    rerender(<Page told={[]} lasting={null} />);

    rerender(<Page told={[]} lasting="The engine is not responding." />);

    expect(screen.getByRole('alert')).toHaveTextContent('The engine is not responding.');
  });

  it('stays held while the focus moves from one notice to another', () => {
    render(<Page told={['One', 'Two']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    fireEvent.click(screen.getByRole('button', { name: 'tell Two' }));
    const [first, second] = screen.getAllByRole('button', { name: 'Dismiss' });

    act(() => {
      first?.focus();
    });
    act(() => {
      second?.focus();
    });
    wait(NOTICE_MS * 3);

    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('does not say twice what stays true and what a failed action said', () => {
    render(
      <Page told={['The engine is not responding.']} lasting="The engine is not responding." />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'tell The engine is not responding.' }));

    expect(screen.getAllByText('The engine is not responding.')).toHaveLength(1);
  });

  it('hands the focus of a dismissed notice to the next one, then to the page', () => {
    render(<Page told={['One', 'Two']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    fireEvent.click(screen.getByRole('button', { name: 'tell Two' }));

    const [first] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      first?.focus();
    });
    pressFocused();
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();

    pressFocused();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();
  });

  it('dismisses one notice for one press of Enter, however long it is held', async () => {
    vi.useRealTimers();
    render(<Page told={['One', 'Two', 'Three']} />);
    for (const text of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    const [first] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      first?.focus();
    });

    await userEvent.keyboard('{Enter>5/}');

    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
  });

  it('lets a held Tab walk on while the Enter that dismissed a notice is still down', async () => {
    vi.useRealTimers();
    render(<Page told={['One', 'Two', 'Three']} />);
    for (const text of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    const [first, , last] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      first?.focus();
    });

    await userEvent.keyboard('{Enter>}{Tab>2/}{/Enter}');

    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(last).not.toHaveFocus();
  });

  it('keeps swallowing a held Enter when another key is let go meanwhile', async () => {
    vi.useRealTimers();
    render(
      <>
        <Page told={['One']} />
        <button type="button">Press</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).focus();
    });
    // Shift+Tab to the ×, Enter pressed before Shift is up: then Shift comes up, Enter still held.
    await userEvent.keyboard('{Shift>}{Enter>}{/Shift}');

    const repeat = fireEvent.keyDown(screen.getByRole('button', { name: 'Press' }), {
      key: 'Enter',
      repeat: true,
    });

    expect(repeat).toBe(false);
    await userEvent.keyboard('{/Enter}');
  });

  it('swallows nothing once the Enter that dismissed a notice is let go', async () => {
    vi.useRealTimers();
    const pressed = vi.fn();
    render(
      <>
        <button type="button" onClick={pressed}>
          Press
        </button>
        <Page told={['One']} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).focus();
    });
    await userEvent.keyboard('{Enter}');
    act(() => {
      screen.getByRole('button', { name: 'Press' }).focus();
    });

    await userEvent.keyboard('{Enter>3/}');

    expect(pressed).toHaveBeenCalledTimes(3);
  });

  it('hands the focus of a middle notice, dismissed, to the one after it', () => {
    render(<Page told={['One', 'Two', 'Three']} />);
    for (const text of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    const [, middle, newest] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      middle?.focus();
    });

    pressFocused();

    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(newest).toHaveFocus();
  });

  it('hands the focus of the newest notice, dismissed, to the one before it', () => {
    render(<Page told={['One', 'Two', 'Three']} />);
    for (const text of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    const [, middle, newest] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      newest?.focus();
    });

    pressFocused();

    expect(screen.queryByText('Three')).not.toBeInTheDocument();
    expect(middle).toHaveFocus();
  });

  it('walks past the notices when Tab is held: only Enter held is one press', async () => {
    vi.useRealTimers();
    render(<Page told={['One', 'Two', 'Three']} />);
    for (const text of ['One', 'Two', 'Three']) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    const [first, , last] = screen.getAllByRole('button', { name: 'Dismiss' });
    act(() => {
      first?.focus();
    });

    await userEvent.keyboard('{Tab>2/}');

    expect(last).toHaveFocus();
  });

  it('hands on the focus of a notice pushed out by a newer one, and lets the rest go after', () => {
    const told = Array.from({ length: NOTICES_AT_MOST + 1 }, (_, i) => `N${String(i)}`);
    render(<Page told={told} />);
    for (const text of told.slice(0, -1)) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    act(() => {
      screen.getAllByRole('button', { name: 'Dismiss' })[0]?.focus();
    });

    fireEvent.click(screen.getByRole('button', { name: `tell ${told.at(-1) ?? ''}` }));

    expect(screen.queryByText('N0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })[0]).toHaveFocus();
    act(() => {
      screen.getByRole('textbox').focus();
    });
    wait(NOTICE_MS);
    expect(screen.queryByRole('list', { name: 'Notices' })).not.toBeInTheDocument();
  });

  it('hands on the focus of a notice the engine’s notice takes the place of, and lets the rest go after', () => {
    const engine = 'The engine is not responding.';
    const told = Array.from({ length: NOTICES_AT_MOST }, (_, i) => `N${String(i)}`);
    const { rerender } = render(<Page told={told} />);
    for (const text of told) fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    act(() => {
      screen.getAllByRole('button', { name: 'Dismiss' })[0]?.focus();
    });

    rerender(<Page told={told} lasting={engine} />);

    expect(screen.queryByText('N0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dismiss' })[0]).toHaveFocus();
    act(() => {
      screen.getByRole('textbox').focus();
    });
    wait(NOTICE_MS);
    expect(screen.queryAllByRole('button', { name: 'Dismiss' })).toHaveLength(0);
    expect(screen.getByText(engine)).toBeInTheDocument();
  });

  it('hands the focus on from where the notice stands now, after an older one was pushed out', () => {
    const told = Array.from({ length: NOTICES_AT_MOST + 1 }, (_, i) => `N${String(i)}`);
    render(<Page told={told} />);
    for (const text of told.slice(0, -1)) {
      fireEvent.click(screen.getByRole('button', { name: `tell ${text}` }));
    }
    act(() => {
      screen.getAllByRole('button', { name: 'Dismiss' })[1]?.focus();
    });
    fireEvent.click(screen.getByRole('button', { name: `tell ${told.at(-1) ?? ''}` }));
    expect(screen.queryByText('N0')).not.toBeInTheDocument();

    pressFocused();

    expect(screen.queryByText('N1')).not.toBeInTheDocument();
    const [n2] = screen.getAllByRole('button', { name: 'Dismiss' });
    expect(n2).toHaveFocus();
    expect(n2?.closest('li')).toHaveTextContent('N2');
  });

  it('is no longer held by a focus that went home with its notice', () => {
    const engine = 'The engine is not responding.';
    render(<Page told={['One', 'Two']} lasting={engine} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).focus();
    });
    pressFocused();
    expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'tell Two' }));
    wait(NOTICE_MS);

    expect(screen.queryByText('Two')).not.toBeInTheDocument();
  });

  it('is no longer held by a pointer that was on a stack now gone', () => {
    render(<Page told={['One', 'Two']} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell One' }));
    fireEvent.pointerOver(screen.getByText('One'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    fireEvent.click(screen.getByRole('button', { name: 'tell Two' }));
    wait(NOTICE_MS);

    expect(screen.queryByText('Two')).not.toBeInTheDocument();
  });

  it('announces a notice once, not again when it is shown somewhere else', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    function Moving({ inLayer }: { readonly inLayer: boolean }) {
      const { notices, tell, dismiss } = useNotices();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              tell('One');
            }}
          >
            tell
          </button>
          <Notices
            notices={notices}
            lasting={null}
            onDismiss={dismiss}
            home={() => null}
            layer={inLayer ? layer : null}
          />
        </>
      );
    }
    const { rerender } = render(<Moving inLayer={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'tell' }));
    expect(screen.getByRole('alert')).toHaveTextContent('One');

    rerender(<Moving inLayer />);

    expect(layer).toHaveTextContent('One');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    layer.remove();
  });
});

describe('useNotices', () => {
  it('forgets a notice that is dismissed, and only that one', () => {
    const { result } = renderHook(() => useNotices());
    act(() => {
      result.current.tell('One');
      result.current.tell('Two');
    });
    const [one] = result.current.notices;

    act(() => {
      if (one !== undefined) result.current.dismiss(one.id);
    });

    expect(result.current.notices.map((notice) => notice.text)).toEqual(['Two']);
  });
});
