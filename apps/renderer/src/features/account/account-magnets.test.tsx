import { type AccountMagnet, ApiErrorCode } from '@scia/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
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
const taken = {
  id: 'm1',
  name: 'Holiday films',
  status: 'fetching' as const,
  totalBytes: null,
  downloadedBytes: 0,
  bytesPerSecond: 0,
  failure: null,
  createdAt: '2026-11-21T12:00:00.000Z',
};
const unavailable = () => new ApiError(502, ApiErrorCode.Unavailable, 'not answering');

function panel(tell = vi.fn(), onClose = vi.fn()) {
  render(<AccountMagnets id="account-magnets" again={0} onClose={onClose} tell={tell} />);
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

    expect(
      await within(region()).findByText(
        'No magnets on the AllDebrid account. A magnet pasted above is added to it.',
      ),
    ).toBeVisible();
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
    render(
      <AccountMagnets id="account-magnets" again={0} onClose={vi.fn()} tell={vi.fn()} />,
    ).unmount();

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

  it('offers Download again once a read made after the press says the magnet left the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
    vi.spyOn(api, 'addAccountMagnet').mockResolvedValue({
      id: 'm1',
      name: 'Holiday films',
      status: 'fetching',
      totalBytes: null,
      downloadedBytes: 0,
      bytesPerSecond: 0,
      failure: null,
      createdAt: '2026-11-21T12:00:00.000Z',
    });
    const { region } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });
    await userEvent.click(download);
    expect(download).toHaveAttribute('aria-disabled', 'true');

    // Its files arrived: the magnet left Scia's list, and the service still has it.
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    await vi.waitFor(() => {
      expect(asked).toHaveBeenCalledTimes(2);
    });
    expect(download).not.toHaveAttribute('aria-disabled');
  });

  it('hands the focus to its heading when the row that held it leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'accountMagnets').mockResolvedValueOnce([holiday]).mockResolvedValue([]);
    const { region } = panel();
    (await within(region()).findByRole('button', { name: 'Download Holiday films' })).focus();

    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    await within(region()).findByText(
      'No magnets on the AllDebrid account. A magnet pasted above is added to it.',
    );
    expect(within(region()).getByRole('heading', { name: 'AllDebrid magnets' })).toHaveFocus();
  });

  describe('what went wrong, each cause in its own words', () => {
    // Mended in Settings: asked about again when Settings closes.
    const mendedInSettings: [ApiErrorCode, string][] = [
      [
        ApiErrorCode.KeyRefused,
        'AllDebrid no longer accepts the key. Disconnect, then connect with a new one.',
      ],
      [ApiErrorCode.ServiceNeeded, 'AllDebrid is no longer connected. Connect it in Settings.'],
    ];
    // Mended outside Scia: only a new read can see it.
    const mendedElsewhere: [ApiErrorCode, string][] = [
      [
        ApiErrorCode.KeyBlocked,
        'AllDebrid is blocking the key from here. If AllDebrid emailed you about a new sign-in, confirm it; otherwise check your network.',
      ],
      [ApiErrorCode.AccountBanned, 'AllDebrid says this account is banned.'],
      [
        ApiErrorCode.NetworkRefused,
        'AllDebrid does not serve this network: it refuses servers and some VPNs. Use it from another network.',
      ],
      [ApiErrorCode.NotPremium, 'AllDebrid fetches magnets for premium accounts only.'],
    ];
    const refusals = [...mendedInSettings, ...mendedElsewhere];

    it.each(mendedInSettings)(
      'says %s, and asks no more until Settings closes, also when the window is shown again',
      async (code, sentence) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const asked = vi
          .spyOn(api, 'accountMagnets')
          .mockRejectedValue(new ApiError(422, code, 'refused'));
        const { rerender } = render(
          <AccountMagnets id="account-magnets" again={0} onClose={vi.fn()} tell={vi.fn()} />,
        );

        await vi.waitFor(() => {
          expect(screen.getByRole('status')).toHaveTextContent(sentence);
        });
        await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 3));
        act(() => {
          visibility('hidden');
          visibility('visible');
        });
        await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 2));
        expect(asked).toHaveBeenCalledTimes(1);
        rerender(
          <AccountMagnets id="account-magnets" again={1} onClose={vi.fn()} tell={vi.fn()} />,
        );
        await vi.waitFor(() => {
          expect(asked).toHaveBeenCalledTimes(2);
        });
      },
    );

    it.each(mendedElsewhere)(
      'says %s, keeps asking at its pace, and shows the list once the account answers again',
      async (code, sentence) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.spyOn(api, 'accountMagnets')
          .mockResolvedValueOnce([holiday])
          .mockRejectedValueOnce(new ApiError(422, code, 'refused'))
          .mockResolvedValue([holiday, concert]);
        const { region } = panel();
        await within(region()).findByText('Holiday films');

        await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
        await vi.waitFor(() => {
          expect(screen.getByRole('status')).toHaveTextContent(
            `${sentence} This is the list from before.`,
          );
        });
        await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

        expect(await within(region()).findByText('Concert')).toBeVisible();
        expect(screen.getByRole('status')).toHaveTextContent('');
      },
    );

    it.each(refusals)('says %s when Download meets it', async (code, sentence) => {
      vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
      vi.spyOn(api, 'addAccountMagnet').mockRejectedValue(new ApiError(422, code, 'refused'));
      const { region, tell } = panel();

      await userEvent.click(
        await within(region()).findByRole('button', { name: 'Download Holiday films' }),
      );

      await vi.waitFor(() => {
        expect(tell).toHaveBeenCalledWith(sentence);
      });
    });

    it('says nothing of AllDebrid when the engine did not answer, keeps the list, and asks again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const asked = vi
        .spyOn(api, 'accountMagnets')
        .mockResolvedValueOnce([holiday])
        .mockRejectedValue(new TypeError('Failed to fetch'));
      const { region } = panel();
      await within(region()).findByText('Holiday films');

      await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 2));

      expect(asked).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('status')).toHaveTextContent('');
      expect(within(region()).getByText('Holiday films')).toBeVisible();
    });

    it('says Scia could not read the list when the engine failed on it, and asks again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const asked = vi
        .spyOn(api, 'accountMagnets')
        .mockRejectedValue(new ApiError(500, ApiErrorCode.InternalError, 'failed'));
      panel();

      await vi.waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Scia could not read the magnets of the account just now. Scia asks again soon.',
        );
      });
      await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
      expect(asked).toHaveBeenCalledTimes(2);
    });
  });

  describe('when Settings closes while an ask is on its way', () => {
    function held() {
      let answer: (outcome: AccountMagnet[] | Error) => void = () => undefined;
      return {
        promise: new Promise<AccountMagnet[]>((resolve, reject) => {
          answer = (outcome) => {
            if (outcome instanceof Error) reject(outcome);
            else resolve(outcome);
          };
        }),
        answer: (outcome: AccountMagnet[] | Error) => {
          answer(outcome);
        },
      };
    }
    const refused = () => new ApiError(422, ApiErrorCode.KeyRefused, 'refused');

    it.each([
      ['a list, and the newer a refusal', [holiday], refused(), /no longer accepts the key/],
      ['a refusal, and the newer a list', refused(), [holiday], /^$/],
    ] as const)(
      'asks once more after it, and keeps only the newer answer: the older %s',
      async (_, older, newer, status) => {
        const first = held();
        const second = held();
        const asked = vi
          .spyOn(api, 'accountMagnets')
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise);
        const { rerender } = render(
          <AccountMagnets id="account-magnets" again={0} onClose={vi.fn()} tell={vi.fn()} />,
        );
        rerender(
          <AccountMagnets id="account-magnets" again={1} onClose={vi.fn()} tell={vi.fn()} />,
        );
        expect(asked).toHaveBeenCalledTimes(1);

        await act(async () => {
          first.answer(older instanceof Error ? older : [...older]);
          await Promise.resolve();
        });
        await vi.waitFor(() => {
          expect(asked).toHaveBeenCalledTimes(2);
        });
        // The older answer is not drawn: neither its list nor its refusal.
        expect(screen.getByRole('status')).toHaveTextContent(/^$/);
        expect(screen.queryAllByRole('listitem')).toEqual([]);
        await act(async () => {
          second.answer(newer instanceof Error ? newer : [...newer]);
          await Promise.resolve();
        });

        await vi.waitFor(() => {
          expect(screen.getByRole('status')).toHaveTextContent(status);
        });
        expect(screen.queryAllByRole('listitem')).toHaveLength(newer instanceof Error ? 0 : 1);
      },
    );
  });

  it('asks nothing more when the window is hidden while an ask is on its way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (magnets: AccountMagnet[]) => void = () => undefined;
    const asked = vi
      .spyOn(api, 'accountMagnets')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      )
      .mockResolvedValue([holiday]);
    panel();

    act(() => {
      visibility('hidden');
    });
    await act(async () => {
      answer([holiday]);
      await Promise.resolve();
    });
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS * 3));

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('says AllDebrid could not be asked when Download meets it, and that Scia could not read an answer', async () => {
    vi.spyOn(api, 'accountMagnets')
      .mockResolvedValueOnce([holiday])
      .mockRejectedValue(new ZodError([]));
    vi.spyOn(api, 'addAccountMagnet').mockRejectedValue(unavailable());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { region, tell } = panel();

    await userEvent.click(
      await within(region()).findByRole('button', { name: 'Download Holiday films' }),
    );
    await vi.waitFor(() => {
      expect(tell).toHaveBeenCalledWith(
        'AllDebrid could not be asked just now. Try again in a moment.',
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    await vi.waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Scia could not read the magnets of the account just now. This is the list from before.',
      );
    });
  });

  it('says its state in a status region that is always there', async () => {
    let answer: (magnets: AccountMagnet[]) => void = () => undefined;
    vi.spyOn(api, 'accountMagnets').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { region } = panel();
    const status = within(region()).getByRole('status');

    expect(status).toHaveTextContent('');
    await act(async () => {
      answer([]);
      await Promise.resolve();
    });
    expect(within(region()).getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('No magnets on the AllDebrid account.');
  });

  it('leaves the focus where a click sent it, out of the panel, when a read comes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'accountMagnets').mockResolvedValue([holiday]);
    vi.spyOn(api, 'addAccountMagnet').mockReturnValue(new Promise(() => undefined));
    const { region } = panel();
    await userEvent.click(
      await within(region()).findByRole('button', { name: 'Download Holiday films' }),
    );

    await userEvent.click(within(region()).getByText('Holiday films'));
    expect(document.body).toHaveFocus();
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    expect(document.body).toHaveFocus();
  });

  it('keeps Download pressed while its request is on its way, also across a read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let readLate: (magnets: AccountMagnet[]) => void = () => undefined;
    vi.spyOn(api, 'accountMagnets')
      .mockResolvedValueOnce([holiday])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          readLate = resolve;
        }),
      )
      .mockResolvedValue([holiday]);
    const take = vi.spyOn(api, 'addAccountMagnet').mockReturnValue(new Promise(() => undefined));
    const { region } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });
    // A read is on its way when Download is pressed; it answers that the magnet is not taken.
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    fireEvent.click(download);
    await act(async () => {
      readLate([holiday]);
      await Promise.resolve();
    });
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
    fireEvent.click(download);

    expect(download).toHaveAttribute('aria-disabled', 'true');
    expect(take).toHaveBeenCalledOnce();
  });

  it('asks once when the window is hidden and shown again quickly, and never twice at once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (magnets: AccountMagnet[]) => void = () => undefined;
    const asked = vi.spyOn(api, 'accountMagnets').mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    asked.mockResolvedValue([holiday]);
    panel();
    // Shown again while its first ask is on its way: no second ask beside it.
    act(() => {
      visibility('hidden');
      visibility('visible');
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(asked).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer([holiday]);
      await Promise.resolve();
    });

    for (let times = 0; times < 3; times += 1) {
      act(() => {
        visibility('hidden');
        visibility('visible');
      });
      await act(() => vi.advanceTimersByTimeAsync(100));
    }

    expect(asked).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('keeps Download pressed when its request settles while a read begun before is on its way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let readLate: (magnets: AccountMagnet[]) => void = () => undefined;
    vi.spyOn(api, 'accountMagnets')
      .mockResolvedValueOnce([holiday])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          readLate = resolve;
        }),
      )
      .mockResolvedValue([{ ...holiday, inScia: true }]);
    let settle: () => void = () => undefined;
    vi.spyOn(api, 'addAccountMagnet').mockReturnValue(
      new Promise((resolve) => {
        settle = () => {
          resolve(taken);
        };
      }),
    );
    const { region } = panel();
    const download = await within(region()).findByRole('button', {
      name: 'Download Holiday films',
    });
    fireEvent.click(download);
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    // Taken while that read was on its way: it does not know of it yet.
    await act(async () => {
      settle();
      await Promise.resolve();
    });
    await act(async () => {
      readLate([holiday]);
      await Promise.resolve();
    });

    expect(download).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves the focus on the page when the row that held it leaves after a click sent it there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, 'accountMagnets').mockResolvedValueOnce([holiday]).mockResolvedValue([]);
    const { region } = panel();
    (await within(region()).findByRole('button', { name: 'Download Holiday films' })).focus();

    await userEvent.click(within(region()).getByText('Holiday films'));
    await act(() => vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS));

    await within(region()).findByText(/No magnets on the AllDebrid account/);
    expect(document.body).toHaveFocus();
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
