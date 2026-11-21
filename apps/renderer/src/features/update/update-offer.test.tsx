import { UpdateRestart } from '@scia/contracts/bridge';
import { render, screen } from '@testing-library/react';
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
    ...overrides,
  };
  return { props, ...render(<UpdateOffer {...props} />) };
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
    expect(screen.getByRole('button', { name: 'Restart now' })).toHaveFocus();
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

  it('asks once for a burst of presses on "Restart now"', async () => {
    const { props } = offer({ onRestart: vi.fn(() => new Promise<unknown>(() => undefined)) });
    await userEvent.click(screen.getByRole('button', { name: 'Update to 1.0.0-beta.18' }));

    await userEvent.dblClick(screen.getByRole('button', { name: 'Restart now' }));

    expect(props.onRestart).toHaveBeenCalledOnce();
  });
});
