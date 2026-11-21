import { type AccountMagnet, ApiErrorCode } from '@scia/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_POLL_MS, AccountMagnets } from './account-magnets.tsx';
import { api, ApiError } from '@/lib/api.ts';

const MIB = 1024 * 1024;
const holiday: AccountMagnet = {
  id: 7,
  name: 'Holiday films',
  stage: 'ready',
  totalBytes: 24 * MIB,
  downloadedBytes: 24 * MIB,
  bytesPerSecond: 0,
  addedAt: '2026-11-20T12:00:00.000Z',
  inScia: false,
};
const concert: AccountMagnet = {
  ...holiday,
  id: 8,
  name: 'Concert',
  stage: 'fetching',
  downloadedBytes: 12 * MIB,
  bytesPerSecond: MIB,
  addedAt: '2026-11-21T12:00:00.000Z',
};
const unavailable = () => new ApiError(502, ApiErrorCode.Unavailable, 'not answering');

function panel(tell = vi.fn(), onClose = vi.fn()) {
  render(<AccountMagnets id="account-magnets" onClose={onClose} tell={tell} />);
  return {
    tell,
    onClose,
    region: () => screen.getByRole('complementary', { name: 'AllDebrid magnets' }),
  };
}

function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AccountMagnets', () => {
  it('draws nothing while it first asks, then every magnet of the account, newest first', async () => {
    let answer: (magnets: AccountMagnet[]) => void = () => undefined;
    vi.spyOn(api, 'accountMagnets').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { region } = panel();

    expect(within(region()).queryByRole('list')).not.toBeInTheDocument();
    expect(region()).not.toHaveTextContent(/could not|No magnets/);
    await act(async () => {
      answer([holiday, concert]);
      await Promise.resolve();
    });

    const rows = within(region()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Concert');
    expect(rows[1]).toHaveTextContent('Holiday films');
    expect(rows[1]).toHaveTextContent(/Ready · 24\.0\sMB/);
  });

  it('takes the focus to its heading when it opens, and closes at Escape', async () => {
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([]);
    const { region, onClose } = panel();

    expect(within(region()).getByRole('heading', { name: 'AllDebrid magnets' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says the account has no magnets', async () => {
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([]);
    const { region } = panel();

    expect(await within(region()).findByText('No magnets on the AllDebrid account.')).toBeVisible();
  });

  it('says AllDebrid could not be asked, and keeps the list it had', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'accountMagnets')
      .mockResolvedValueOnce([holiday])
      .mockRejectedValue(unavailable());
    const { region } = panel();
    await within(region()).findByText('Holiday films');

    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    expect(
      within(region()).getByText(
        'AllDebrid could not be asked just now. This is the list from before.',
      ),
    ).toBeVisible();
    expect(within(region()).getByText('Holiday films')).toBeVisible();
  });

  it('says AllDebrid could not be asked when it has no list yet, and that it is no longer connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'accountMagnets')
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValue(new ApiError(409, ApiErrorCode.ServiceNeeded, 'none'));
    const { region } = panel();

    expect(
      await within(region()).findByText(
        'AllDebrid could not be asked just now. Scia asks again soon.',
      ),
    ).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
    expect(
      within(region()).getByText('AllDebrid is no longer connected. Connect it in Settings.'),
    ).toBeVisible();
  });

  it('asks again at its pace while the window is visible, never while it is hidden, and at once when it shows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
    panel();
    await vi.waitFor(() => {
      expect(asked).toHaveBeenCalledTimes(1);
    });

    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
    expect(asked).toHaveBeenCalledTimes(2);
    act(() => {
      visibility('hidden');
    });
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 4));
    expect(asked).toHaveBeenCalledTimes(2);
    act(() => {
      visibility('visible');
    });
    await vi.waitFor(() => {
      expect(asked).toHaveBeenCalledTimes(3);
    });
  });

  it('asks nothing more once it is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
    render(<AccountMagnets id="account-magnets" onClose={vi.fn()} tell={vi.fn()} />).unmount();

    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 3));

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('takes a ready magnet into the list at its Download, once however often it is pressed', async () => {
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday, concert]);
    const take = vi.spyOn(api, 'addAccountMagnet').mockReturnValue(new Promise(() => undefined));
    const { region } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });

    await userEvent.dblClick(download);
    download.focus();
    await userEvent.keyboard('{Enter>3/}');

    expect(take).toHaveBeenCalledExactlyOnceWith(7);
    expect(download).toHaveAttribute('aria-disabled', 'true');
    expect(download).toHaveFocus();
    expect(within(region()).getByText(/In Scia’s list/)).toBeVisible();
    // Only a ready one is offered.
    expect(within(region()).getAllByRole('button', { name: /^Download/ })).toHaveLength(1);
  });

  it('offers nothing for a magnet already in the list', async () => {
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([{ ...holiday, inScia: true }]);
    const take = vi.spyOn(api, 'addAccountMagnet');
    const { region } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });

    fireEvent.click(download);

    expect(download).toHaveAttribute('aria-disabled', 'true');
    expect(take).not.toHaveBeenCalled();
  });

  it('says why a magnet was not taken, and offers it again', async () => {
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
    vi.spyOn(api, 'addAccountMagnet').mockRejectedValue(
      new ApiError(404, ApiErrorCode.NotFound, 'gone'),
    );
    const { region, tell } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });

    await userEvent.click(download);

    await vi.waitFor(() => {
      expect(tell).toHaveBeenCalledWith('This magnet is no longer on the AllDebrid account.');
    });
    expect(download).not.toHaveAttribute('aria-disabled');
  });
});
