import { UpdateRestart } from '@scia/contracts/bridge';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateOffer } from './update-offer.tsx';

function offer(overrides: Partial<Parameters<typeof UpdateOffer>[0]> = {}) {
  const props = {
    version: '1.0.0-beta.17',
    offered: '1.0.0-beta.18',
    downloading: false,
    onRestart: vi.fn(async (): Promise<unknown> => UpdateRestart.Restarting),
    onGone: vi.fn(),
    home: () => screen.queryByRole('textbox', { name: 'Links to download' }),
    ...overrides,
  };
  return {
    props,
    ...render(
      <>
        <input aria-label="Links to download" />
        <UpdateOffer {...props} />
        <p>Something that takes no focus</p>
      </>,
    ),
  };
}

describe('UpdateOffer', () => {
  it('says the version Scia is, and nothing to press, when no update is offered', () => {
    offer({ offered: null });

    expect(screen.getByText('1.0.0-beta.17')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a button that names the version it leads to, once one is downloaded', () => {
    offer();

    const button = screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('title', 'Scia 1.0.0-beta.17');
    expect(screen.queryByText('1.0.0-beta.17')).not.toBeInTheDocument();
  });

  it('asks before restarting, and restarts on "Restart now"', async () => {
    const { props } = offer();

    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
    const question = screen.getByRole('dialog', { name: 'Restart now to install 1.0.0-beta.18?' });
    expect(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus();
    expect(props.onRestart).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(props.onRestart).toHaveBeenCalledOnce();
    expect(question).toHaveTextContent('Restarting…');
  });

  it('goes back with "Later", and the focus with it', async () => {
    const { props } = offer();
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' })).toHaveFocus();
    expect(props.onRestart).not.toHaveBeenCalled();
  });

  it('goes back with Escape', async () => {
    offer();
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' })).toHaveFocus();
  });

  it('goes back when the person presses elsewhere', async () => {
    render(
      <>
        <UpdateOffer
          version="1.0.0-beta.17"
          offered="1.0.0-beta.18"
          downloading={false}
          onRestart={vi.fn(async () => UpdateRestart.Restarting)}
          onGone={vi.fn()}
          home={() => null}
        />
        <button type="button">Elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no restart while something downloads, and says the update installs at the quit', async () => {
    const { props } = offer({ downloading: true });

    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    const note = screen.getByRole('dialog');
    expect(note).toHaveTextContent(
      'Scia is downloading. 1.0.0-beta.18 installs when you quit Scia.',
    );
    expect(screen.queryByRole('button', { name: 'Restart now' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(props.onRestart).not.toHaveBeenCalled();
  });

  it('becomes the note, with the focus on Close, when a download starts while it asks', async () => {
    const { props, rerender } = offer();
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
    expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus();

    rerender(
      <>
        <input aria-label="Links to download" />
        <UpdateOffer {...props} downloading />
        <p>Something that takes no focus</p>
      </>,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('Scia is downloading.');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('says so when main does not restart, in words true whatever kept it', async () => {
    offer({ onRestart: vi.fn(async () => UpdateRestart.Busy) });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Scia could not restart now. 1.0.0-beta.18 installs when you quit Scia.',
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('says the same when main fails to answer', async () => {
    offer({
      onRestart: vi.fn(async () => {
        throw new Error('main said nothing');
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Scia could not restart now.');
  });

  it('closes, and says the offer is gone, when main has nothing to restart for', async () => {
    const { props } = offer({ onRestart: vi.fn(async () => UpdateRestart.Nothing) });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onGone).toHaveBeenCalledOnce();
  });

  it('offers no way back while it restarts: "Later" does nothing then, and says so', async () => {
    offer({ onRestart: vi.fn(() => new Promise<unknown>(() => undefined)) });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    const later = screen.getByRole('button', { name: 'Later' });
    expect(later).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(later);

    expect(screen.getByRole('dialog')).toHaveTextContent('Restarting…');
  });

  it('asks once for a burst of presses on "Restart now"', async () => {
    const { props } = offer({ onRestart: vi.fn(() => new Promise<unknown>(() => undefined)) });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.dblClick(screen.getByRole('button', { name: 'Restart now' }));

    expect(props.onRestart).toHaveBeenCalledOnce();
  });

  describe('a key held, and a restart on its way', () => {
    it.each(['Update to 1.0.0-beta.18', 'Later'])(
      'does not restart for Enter held on %s',
      async (name) => {
        const { props } = offer();
        if (name === 'Later') {
          await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
        }
        screen.getByRole('button', { name }).focus();

        await userEvent.keyboard('{Enter>6/}');

        expect(props.onRestart).not.toHaveBeenCalled();
      },
    );

    it('does not open the question again for Enter held on Close', async () => {
      offer({ downloading: true });
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      screen.getByRole('button', { name: 'Close' }).focus();

      await userEvent.keyboard('{Enter>6/}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    async function restarting() {
      const run = offer({ onRestart: vi.fn(() => new Promise<unknown>(() => undefined)) });
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
      return run;
    }

    it('stays while it restarts: Escape', async () => {
      await restarting();
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toHaveTextContent('Restarting…');
    });

    it('stays while it restarts: a press elsewhere', async () => {
      await restarting();
      await userEvent.click(screen.getByText('Something that takes no focus'));
      expect(screen.getByRole('dialog')).toHaveTextContent('Restarting…');
    });

    it('stays while it restarts: the focus going elsewhere', async () => {
      await restarting();
      act(() => {
        screen.getByRole('textbox', { name: 'Links to download' }).focus();
      });
      expect(screen.getByRole('dialog')).toHaveTextContent('Restarting…');
    });

    it('stays while it restarts: a press of the button it hangs from', async () => {
      await restarting();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Restarting…');
    });
  });

  describe('going away', () => {
    const page = (props: Parameters<typeof UpdateOffer>[0]) => (
      <>
        <input aria-label="Links to download" />
        <UpdateOffer {...props} />
        <p>Something that takes no focus</p>
      </>
    );

    it('goes for a press on something that takes no focus', async () => {
      offer();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      await userEvent.click(screen.getByText('Something that takes no focus'));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('goes when the focus leaves for elsewhere', async () => {
      offer();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      act(() => {
        screen.getByRole('textbox', { name: 'Links to download' }).focus();
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('hears Escape after a press on its text', async () => {
      offer();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByText('Restart now to install 1.0.0-beta.18?'));

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes with Escape from the button it hangs from', async () => {
      offer();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }).focus();

      await userEvent.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('gives the focus back to the button with Close', async () => {
      offer({ downloading: true });
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      expect(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' })).toHaveFocus();
    });

    it('stays the note when the download ends: Close does not become Restart now', async () => {
      const { props, rerender } = offer({ downloading: true });
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      rerender(page({ ...props, downloading: false }));

      expect(screen.getByRole('dialog')).toHaveTextContent('Scia is downloading.');
      expect(screen.queryByRole('button', { name: 'Restart now' })).not.toBeInTheDocument();
    });

    it('hands the focus to the field when main has nothing to restart for and the offer goes', async () => {
      const { props, rerender } = offer({ onRestart: vi.fn(async () => UpdateRestart.Nothing) });
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
      expect(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' })).toHaveFocus();

      rerender(page({ ...props, offered: null }));

      expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();
    });

    it('leaves a focus that went elsewhere where it is when the offer goes', async () => {
      const props = {
        version: '1.0.0-beta.17',
        offered: '1.0.0-beta.18',
        downloading: false,
        onRestart: vi.fn(async () => UpdateRestart.Restarting),
        onGone: vi.fn(),
        home: () => screen.queryByRole('textbox', { name: 'Links to download' }),
      };
      const page = (offered: string | null) => (
        <>
          <input aria-label="Links to download" />
          <UpdateOffer {...props} offered={offered} />
          <button type="button">Elsewhere</button>
        </>
      );
      const { rerender } = render(page('1.0.0-beta.18'));
      act(() => {
        screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }).focus();
      });
      act(() => {
        screen.getByRole('button', { name: 'Elsewhere' }).focus();
      });

      rerender(page(null));

      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    });

    it('closes with the offer, hands the focus on, and does not come back open with the next', async () => {
      const { props, rerender } = offer();
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      rerender(page({ ...props, offered: null }));
      expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();

      rerender(page({ ...props, offered: '1.0.0-beta.19' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('a focus that moved on', () => {
    const base = {
      version: '1.0.0-beta.17',
      offered: '1.0.0-beta.18' as string | null,
      downloading: false,
      onGone: vi.fn(),
      home: () => screen.queryByRole('textbox', { name: 'Links to download' }),
    };
    const page = (props: Parameters<typeof UpdateOffer>[0]) => (
      <>
        <input aria-label="Links to download" />
        <UpdateOffer {...props} />
        <button type="button">Elsewhere</button>
      </>
    );

    it('is not pulled back to Close when main refuses after the person went elsewhere', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const onRestart = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            answer = resolve;
          }),
      );
      render(page({ ...base, onRestart }));
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
      act(() => {
        screen.getByRole('textbox', { name: 'Links to download' }).focus();
      });

      await act(async () => {
        answer(UpdateRestart.Busy);
        await Promise.resolve();
      });

      expect(screen.getByRole('dialog')).toHaveTextContent('Scia could not restart now.');
      expect(screen.getByRole('textbox', { name: 'Links to download' })).toHaveFocus();
    });

    it('does not come back open after an offer that left while main was restarting', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const onRestart = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            answer = resolve;
          }),
      );
      const { rerender } = render(page({ ...base, onRestart }));
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

      rerender(page({ ...base, onRestart, offered: null }));
      await act(async () => {
        answer(UpdateRestart.Busy);
        await Promise.resolve();
      });
      rerender(page({ ...base, onRestart, offered: '1.0.0-beta.19' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not come back open after an offer that left while main was restarting, and main failed', async () => {
      let fail: (error: unknown) => void = () => undefined;
      const onRestart = vi.fn(
        () =>
          new Promise<unknown>((_, reject) => {
            fail = reject;
          }),
      );
      const { rerender } = render(page({ ...base, onRestart }));
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

      rerender(page({ ...base, onRestart, offered: null }));
      await act(async () => {
        fail(new Error('main said nothing'));
        await Promise.resolve();
      });
      rerender(page({ ...base, onRestart, offered: '1.0.0-beta.19' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the focus on "Restarting…" while main restarts, not on a "Later" that does nothing', async () => {
      const onRestart = vi.fn(() => new Promise<unknown>(() => undefined));
      render(page({ ...base, onRestart }));
      await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

      await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));

      expect(screen.getByRole('button', { name: 'Restarting…' })).toHaveFocus();
    });

    it('leaves a focus elsewhere alone when a second offer comes and goes untouched', () => {
      const onRestart = vi.fn(async () => UpdateRestart.Restarting);
      const { rerender } = render(page({ ...base, onRestart }));
      act(() => {
        screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }).focus();
      });
      rerender(page({ ...base, onRestart, offered: null }));
      act(() => {
        screen.getByRole('button', { name: 'Elsewhere' }).focus();
      });

      rerender(page({ ...base, onRestart, offered: '1.0.0-beta.19' }));
      rerender(page({ ...base, onRestart, offered: null }));

      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    });
  });
});
