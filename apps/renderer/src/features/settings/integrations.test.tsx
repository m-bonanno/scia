import { ApiErrorCode, type Integration, type IntegrationCode } from '@scia/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api.ts';
import type { SciaBridge } from '@/lib/bridge.ts';
import { CODE_READ_MS, IntegrationsSection } from './integrations.tsx';

// Made up: no account anywhere has this key.
const KEY = 'spec-key-0000000000000000';
const notConnected: Integration = {
  id: 'alldebrid',
  connected: false,
  account: null,
  failure: null,
};
const connected: Integration = {
  id: 'alldebrid',
  connected: true,
  // The specs run in UTC (vitest.config.ts): the day is the one written here.
  account: { name: 'ada', premium: true, premiumUntil: '2027-06-30T12:00:00.000Z' },
  failure: null,
};

const ignore = () => undefined;

function listing(...lists: Integration[][]) {
  const read = vi.spyOn(api, 'integrations');
  for (const list of lists.slice(0, -1)) read.mockResolvedValueOnce(list);
  return read.mockResolvedValue(lists.at(-1) ?? []);
}

async function theService() {
  return within(await screen.findByRole('listitem'));
}

async function typeAKey(key = KEY) {
  const service = await theService();
  await userEvent.click(service.getByRole('button', { name: 'Use an API key' }));
  await userEvent.type(service.getByLabelText('AllDebrid API key'), key);
  return service;
}

describe('IntegrationsSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the services Scia knows, and says which are not connected', async () => {
    listing([notConnected]);
    render(<IntegrationsSection open onError={ignore} />);

    expect(await screen.findByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    const service = await theService();
    expect(service.getByText('AllDebrid')).toBeInTheDocument();
    expect(service.getByText('Not connected')).toBeInTheDocument();
    expect(service.getByRole('button', { name: 'Use an API key' })).toBeInTheDocument();
    expect(service.queryByLabelText('AllDebrid API key')).not.toBeInTheDocument();
  });

  it('asks for the key when "Use an API key" is pressed, in a field that hides it and takes the focus', async () => {
    listing([notConnected]);
    render(<IntegrationsSection open onError={ignore} />);
    const service = await theService();

    await userEvent.click(service.getByRole('button', { name: 'Use an API key' }));

    const field = service.getByLabelText('AllDebrid API key');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
  });

  it('connects with the key that was typed, and says whose account it is and until when it is premium', async () => {
    listing([notConnected]);
    const connect = vi.spyOn(api, 'connectIntegration').mockResolvedValue(connected);
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();

    await userEvent.keyboard('{Enter}');

    expect(connect).toHaveBeenCalledExactlyOnceWith('alldebrid', KEY);
    expect(await service.findByRole('status')).toHaveTextContent(
      /^Connected as ada · premium until Jun 30, 2027$/,
    );
    expect(service.queryByLabelText('AllDebrid API key')).not.toBeInTheDocument();
    expect(service.queryByRole('button', { name: 'Use an API key' })).not.toBeInTheDocument();
    // What the focus was on has left the page: it goes to what can be done next.
    expect(service.getByRole('button', { name: 'Disconnect' })).toHaveFocus();
  });

  it('says so of an account that is not premium, and of one whose date the service does not give', async () => {
    listing([{ ...connected, account: { name: 'bob', premium: false, premiumUntil: null } }]);
    const { unmount } = render(<IntegrationsSection open onError={ignore} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/^Connected as bob · not premium$/);
    unmount();

    listing([{ ...connected, account: { name: 'eve', premium: true, premiumUntil: null } }]);
    render(<IntegrationsSection open onError={ignore} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/^Connected as eve · premium$/);
  });

  it('says only that it is connected while the service has not said whose account it is', async () => {
    listing([{ ...connected, account: null }]);
    render(<IntegrationsSection open onError={ignore} />);

    expect(await screen.findByRole('status')).toHaveTextContent(/^Connected$/);
  });

  it.each([
    [
      ApiErrorCode.KeyRefused,
      422,
      'AllDebrid does not know this key. Copy it again from your AllDebrid account.',
    ],
    [
      ApiErrorCode.KeyBlocked,
      422,
      'AllDebrid is blocking this key from here. If AllDebrid emailed you about a new sign-in, confirm it; otherwise check your network, then try again.',
    ],
    [ApiErrorCode.AccountBanned, 422, 'AllDebrid says this account is banned.'],
    [
      ApiErrorCode.NetworkRefused,
      422,
      'AllDebrid does not serve this network: it refuses servers and some VPNs. Connect from another network, then try again.',
    ],
    [
      ApiErrorCode.Unavailable,
      502,
      'Scia could not check this key with AllDebrid. Try again in a moment.',
    ],
    [
      ApiErrorCode.KeyNotKept,
      500,
      'Scia could not keep the key safely on this computer. Nothing was connected.',
    ],
    [
      ApiErrorCode.InvalidRequest,
      400,
      'This is not a key. Copy it again from your AllDebrid account.',
    ],
  ])(
    'says what happened to the key, by its field, when the answer is %s',
    async (code, status, text) => {
      listing([notConnected]);
      vi.spyOn(api, 'connectIntegration').mockRejectedValue(new ApiError(status, code, 'no'));
      const onError = vi.fn();
      render(<IntegrationsSection open onError={onError} />);
      const service = await typeAKey();

      await userEvent.click(service.getByRole('button', { name: 'Connect' }));

      expect(await service.findByRole('alert')).toHaveTextContent(text);
      // A failed attempt never clears what was typed, and the field says what is wrong with it.
      const field = service.getByLabelText('AllDebrid API key');
      expect(field).toHaveValue(KEY);
      expect(field).toBeInvalid();
      expect(field).toHaveAccessibleDescription(expect.stringContaining(text));
      expect(service.getByText('Not connected')).toBeInTheDocument();
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('describes the field by its hint alone until something is wrong with the key', async () => {
    listing([notConnected]);
    render(<IntegrationsSection open onError={ignore} />);

    const field = (await typeAKey()).getByLabelText('AllDebrid API key');

    expect(field).toBeValid();
    expect(field).toHaveAccessibleDescription(
      'Create one in your AllDebrid account, under API keys. Scia keeps it where this computer protects it.',
    );
  });

  it('blames no key when the engine could not be reached', async () => {
    listing([notConnected]);
    vi.spyOn(api, 'connectIntegration').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();

    await userEvent.click(service.getByRole('button', { name: 'Connect' }));

    expect(await service.findByRole('alert')).toHaveTextContent(
      'Scia’s engine is not responding. Trying again…',
    );
  });

  it('forgets a refusal when the key is tried again', async () => {
    listing([notConnected]);
    vi.spyOn(api, 'connectIntegration')
      .mockRejectedValueOnce(new ApiError(422, ApiErrorCode.KeyRefused, 'no'))
      .mockResolvedValueOnce(connected);
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();

    await userEvent.click(service.getByRole('button', { name: 'Connect' }));
    expect(await service.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(service.getByRole('button', { name: 'Connect' }));

    expect(await service.findByRole('status')).toHaveTextContent(/^Connected as ada/);
    expect(service.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('forgets the key once it is taken: it is not there when the field is opened again', async () => {
    listing([notConnected]);
    vi.spyOn(api, 'connectIntegration').mockResolvedValue(connected);
    vi.spyOn(api, 'disconnectIntegration').mockResolvedValue();
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();
    await userEvent.keyboard('{Enter}');

    await userEvent.click(await service.findByRole('button', { name: 'Disconnect' }));
    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(await service.findByRole('button', { name: 'Use an API key' }));

    expect(service.getByLabelText('AllDebrid API key')).toHaveValue('');
  });

  it('sends the key as it was typed: what surrounds it is the engine’s to take away', async () => {
    listing([notConnected]);
    const connect = vi.spyOn(api, 'connectIntegration').mockResolvedValue(connected);
    render(<IntegrationsSection open onError={ignore} />);
    await typeAKey(` ${KEY} `);

    await userEvent.keyboard('{Enter}');

    expect(connect).toHaveBeenCalledExactlyOnceWith('alldebrid', ` ${KEY} `);
  });

  it('sends nothing while there is no key to send', async () => {
    listing([notConnected]);
    const connect = vi.spyOn(api, 'connectIntegration');
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey('   ');

    expect(service.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await userEvent.keyboard('{Enter}');

    expect(connect).not.toHaveBeenCalled();
  });

  it('says it is checking, and asks the service once however often it is pressed', async () => {
    listing([notConnected]);
    let answer: (integration: Integration) => void = ignore;
    const connect = vi.spyOn(api, 'connectIntegration').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();

    await userEvent.keyboard('{Enter}{Enter}');

    // It does nothing, and is not taken out of the order: the focus a press gave it stays.
    // The key being checked is not changed meanwhile: a refusal will be about what is there.
    expect(service.getByLabelText('AllDebrid API key')).toHaveAttribute('readonly');
    const checking = service.getByRole('button', { name: 'Checking…' });
    expect(checking).toHaveAttribute('aria-disabled', 'true');
    expect(checking).toBeEnabled();
    await userEvent.click(checking);
    expect(connect).toHaveBeenCalledTimes(1);
    // The check cannot be taken back: while it lasts Cancel does nothing, and says so to
    // who cannot see it dimmed — and whoever does not see the button is told of the check.
    const cancel = service.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(cancel);
    expect(service.getByLabelText('AllDebrid API key')).toHaveValue(KEY);
    expect(
      service
        .getAllByRole('status')
        .some((status) => status.textContent === 'Checking the key with AllDebrid…'),
    ).toBe(true);
    answer(connected);
    expect(await service.findByRole('status')).toHaveTextContent(/^Connected as ada/);
  });

  it('tells a refusal by the field, with the key still in it, when Cancel was pressed during the check', async () => {
    listing([notConnected]);
    let refuse: (error: unknown) => void = ignore;
    vi.spyOn(api, 'connectIntegration').mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();
    await userEvent.keyboard('{Enter}');

    await userEvent.click(service.getByRole('button', { name: 'Cancel' }));
    refuse(new ApiError(422, ApiErrorCode.KeyRefused, 'no'));

    expect(await service.findByRole('alert')).toHaveTextContent(
      'AllDebrid does not know this key.',
    );
    const field = service.getByLabelText('AllDebrid API key');
    expect(field).toHaveValue(KEY);
    expect(field).toBeInvalid();
    expect(service.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('leaves the focus where it went while the service was being disconnected', async () => {
    listing([connected]);
    let done: () => void = ignore;
    vi.spyOn(api, 'disconnectIntegration').mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    render(
      <>
        <IntegrationsSection open onError={ignore} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const service = await theService();
    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();

    done();

    expect(await service.findByText('Not connected')).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  it('leaves the focus where it went while the key was checked', async () => {
    listing([notConnected]);
    let answer: (integration: Integration) => void = ignore;
    vi.spyOn(api, 'connectIntegration').mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(
      <>
        <IntegrationsSection open onError={ignore} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const service = await typeAKey();
    await userEvent.keyboard('{Enter}');
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();

    answer(connected);

    expect(await service.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  it('closes the field at Cancel, forgets what was typed and what was said of it, and gives the focus back to "Use an API key"', async () => {
    listing([notConnected]);
    vi.spyOn(api, 'connectIntegration').mockRejectedValue(
      new ApiError(422, ApiErrorCode.KeyRefused, 'no'),
    );
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();
    await userEvent.keyboard('{Enter}');
    expect(await service.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(service.getByRole('button', { name: 'Cancel' }));

    expect(service.queryByRole('alert')).not.toBeInTheDocument();
    expect(service.queryByLabelText('AllDebrid API key')).not.toBeInTheDocument();
    expect(service.getByRole('button', { name: 'Use an API key' })).toHaveFocus();
    await userEvent.click(service.getByRole('button', { name: 'Use an API key' }));
    expect(service.getByLabelText('AllDebrid API key')).toHaveValue('');
  });

  it('disconnects at the second press only, and then says it is not connected', async () => {
    listing([connected]);
    const disconnect = vi.spyOn(api, 'disconnectIntegration').mockResolvedValue();
    render(<IntegrationsSection open onError={ignore} />);
    const service = await theService();

    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).not.toHaveBeenCalled();
    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));

    expect(disconnect).toHaveBeenCalledExactlyOnceWith('alldebrid');
    expect(await service.findByText('Not connected')).toBeInTheDocument();
    expect(service.getByRole('button', { name: 'Connect with a code' })).toHaveFocus();
  });

  it('stays connected, and says so by the service, when it could not be disconnected', async () => {
    listing([connected]);
    vi.spyOn(api, 'disconnectIntegration').mockRejectedValue(
      new ApiError(500, ApiErrorCode.InternalError, 'no'),
    );
    render(<IntegrationsSection open onError={ignore} />);
    const service = await theService();

    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(service.getByRole('button', { name: 'Disconnect' }));

    expect(await service.findByRole('alert')).toHaveTextContent(
      'Scia could not complete the operation. Try again.',
    );
    expect(service.getByRole('status')).toHaveTextContent(/^Connected as ada/);
  });

  it.each([
    [
      ApiErrorCode.KeyRefused,
      'AllDebrid no longer accepts the key. Disconnect, then connect with a new one.',
    ],
    [
      ApiErrorCode.KeyBlocked,
      'AllDebrid is blocking the key from here. If AllDebrid emailed you about a new sign-in, confirm it; otherwise check your network.',
    ],
    [ApiErrorCode.AccountBanned, 'AllDebrid says this account is banned.'],
    [
      ApiErrorCode.NetworkRefused,
      'AllDebrid does not serve this network: it refuses servers and some VPNs. Use it from another network.',
    ],
    [ApiErrorCode.Unavailable, 'Scia could not ask AllDebrid about this account just now.'],
  ] as const)(
    'says what is wrong with a connected service that answered %s',
    async (failure, text) => {
      listing([{ ...connected, account: null, failure }]);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();

      expect(service.getByText(text)).toBeInTheDocument();
      expect(service.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    },
  );

  it('reads the services again each time Settings opens, and shows what the engine says now', async () => {
    const read = listing([notConnected], [connected]);
    const { rerender } = render(<IntegrationsSection open onError={ignore} />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();

    rerender(<IntegrationsSection open={false} onError={ignore} />);
    rerender(<IntegrationsSection open onError={ignore} />);

    expect(await screen.findByRole('status')).toHaveTextContent(/^Connected as ada/);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps neither a refusal nor a typed key from one visit of Settings to the next', async () => {
    listing([notConnected]);
    vi.spyOn(api, 'connectIntegration').mockRejectedValue(
      new ApiError(422, ApiErrorCode.KeyRefused, 'no'),
    );
    const { rerender } = render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();
    await userEvent.click(service.getByRole('button', { name: 'Connect' }));
    expect(await service.findByRole('alert')).toBeInTheDocument();

    rerender(<IntegrationsSection open={false} onError={ignore} />);
    rerender(<IntegrationsSection open onError={ignore} />);

    const again = await theService();
    expect(again.queryByRole('alert')).not.toBeInTheDocument();
    expect(again.queryByLabelText('AllDebrid API key')).not.toBeInTheDocument();
    await userEvent.click(again.getByRole('button', { name: 'Use an API key' }));
    expect(again.getByLabelText('AllDebrid API key')).toHaveValue('');
  });

  it('reports a list it could not read, and shows no services rather than wrong ones', async () => {
    const failure = new Error('offline');
    vi.spyOn(api, 'integrations').mockRejectedValue(failure);
    const onError = vi.fn();
    render(<IntegrationsSection open onError={onError} />);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    });
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
  describe("a code confirmed on the service's site", () => {
    const given: IntegrationCode = {
      code: 'ABCD',
      url: 'https://alldebrid.com/pin/?pin=ABCD',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      status: 'waiting',
      failure: null,
    };
    let openCodePage: ReturnType<typeof vi.fn<SciaBridge['openCodePage']>>;

    function withMain() {
      openCodePage = vi.fn<SciaBridge['openCodePage']>(async () => undefined);
      window.scia = {
        apiToken: 'token',
        version: '0.0.0',
        platform: 'win32',
        revealDownload: vi.fn(async () => undefined),
        openDownload: vi.fn(async () => undefined),
        chooseDownloadFolder: vi.fn(async () => undefined),
        themeChanged: vi.fn(async () => undefined),
        openCodePage,
      };
    }
    // The engine is asked what became of the code at its pace: the spec moves the clock.
    async function nextReading() {
      await vi.advanceTimersByTimeAsync(CODE_READ_MS);
    }
    function setUp() {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      return userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    }

    afterEach(() => {
      vi.useRealTimers();
      delete window.scia;
    });

    it('offers a code first, and a key as the other way', async () => {
      listing([notConnected]);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();

      const code = service.getByRole('button', { name: 'Connect with a code' });
      const key = service.getByRole('button', { name: 'Use an API key' });
      expect(code).toBeInTheDocument();
      expect(key).toBeInTheDocument();
    });

    it('shows the code, where to enter it and how long it works, and opens the page through main', async () => {
      const user = setUp();
      withMain();
      listing([notConnected]);
      const start = vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();

      await user.click(service.getByRole('button', { name: 'Connect with a code' }));

      expect(start).toHaveBeenCalledExactlyOnceWith('alldebrid');
      expect(await service.findByText('ABCD')).toBeInTheDocument();
      expect(service.getByText('alldebrid.com/pin')).toBeInTheDocument();
      expect(service.getByText(/The code works for 10\smin\.$/)).toBeInTheDocument();
      expect(
        service.getByText('Waiting for you to confirm the code on AllDebrid…'),
      ).toHaveAttribute('role', 'status');
      const open = service.getByRole('button', { name: 'Open AllDebrid' });
      expect(open).toHaveFocus();
      await user.click(open);
      expect(openCodePage).toHaveBeenCalledExactlyOnceWith('alldebrid');
    });

    it('offers no button to open the page where nobody can open it, and still says where', async () => {
      const user = setUp();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();

      await user.click(service.getByRole('button', { name: 'Connect with a code' }));

      expect(await service.findByText('alldebrid.com/pin')).toBeInTheDocument();
      expect(service.queryByRole('button', { name: 'Open AllDebrid' })).not.toBeInTheDocument();
    });

    it('says where to go when main could not open the page', async () => {
      const user = setUp();
      withMain();
      openCodePage.mockRejectedValue(new Error('no browser'));
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));

      await user.click(await service.findByRole('button', { name: 'Open AllDebrid' }));

      expect(await service.findByRole('alert')).toHaveTextContent(
        'Scia could not open your browser. Go to alldebrid.com/pin and enter the code.',
      );
    });

    it('connects once the code is confirmed, says whose account it is, and gives the focus to Disconnect', async () => {
      const user = setUp();
      withMain();
      listing([notConnected], [connected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      const read = vi
        .spyOn(api, 'integrationCode')
        .mockResolvedValueOnce(given)
        .mockResolvedValue({ ...given, status: 'connected' });
      const { rerender } = render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await nextReading();
      expect(service.getByText('ABCD')).toBeInTheDocument();
      await nextReading();

      expect(await service.findByText(/^Connected as ada/)).toBeInTheDocument();
      expect(service.queryByText('ABCD')).not.toBeInTheDocument();
      expect(service.getByRole('button', { name: 'Disconnect' })).toHaveFocus();
      const readings = read.mock.calls.length;
      await nextReading();
      expect(read).toHaveBeenCalledTimes(readings);
      const cancel = vi.spyOn(api, 'cancelIntegrationCode').mockResolvedValue();
      rerender(<IntegrationsSection open={false} onError={ignore} />);
      expect(cancel).not.toHaveBeenCalled();
    });

    for (const [what, late] of [
      [
        'a failure',
        (answer: (code: IntegrationCode) => void) => {
          answer({ ...given, status: 'failed', failure: 'CODE_EXPIRED' });
        },
      ],
      [
        'an engine that no longer knows it',
        (_answer: unknown, refuse: (error: unknown) => void) => {
          refuse(new ApiError(404, ApiErrorCode.NotFound, 'No code was given.'));
        },
      ],
    ] as const) {
      it(`takes no word of the code before, when a reading of it says ${what} after Cancel`, async () => {
        const user = setUp();
        listing([notConnected]);
        vi.spyOn(api, 'startIntegrationCode')
          .mockResolvedValueOnce(given)
          .mockResolvedValueOnce({ ...given, code: 'EFGH' });
        vi.spyOn(api, 'cancelIntegrationCode').mockResolvedValue();
        let answer: (code: IntegrationCode) => void = () => undefined;
        let refuse: (error: unknown) => void = () => undefined;
        const read = vi.spyOn(api, 'integrationCode').mockImplementation(
          () =>
            new Promise((resolve, reject) => {
              answer = resolve;
              refuse = reject;
            }),
        );
        render(<IntegrationsSection open onError={ignore} />);
        const service = await theService();
        await user.click(service.getByRole('button', { name: 'Connect with a code' }));
        await service.findByText('ABCD');
        await nextReading();
        await vi.waitFor(() => {
          expect(read).toHaveBeenCalled();
        });
        const [answerBefore, refuseBefore] = [answer, refuse];

        await user.click(service.getByRole('button', { name: 'Cancel' }));
        await user.click(service.getByRole('button', { name: 'Connect with a code' }));
        await service.findByText('EFGH');
        await act(async () => {
          late(answerBefore, refuseBefore);
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(service.getByText('EFGH')).toBeInTheDocument();
        expect(service.queryByRole('alert')).not.toBeInTheDocument();
      });
    }

    it('says the code expired, stops asking, and offers a new one, which takes the focus', async () => {
      const user = setUp();
      withMain();
      listing([notConnected]);
      const start = vi
        .spyOn(api, 'startIntegrationCode')
        .mockResolvedValueOnce(given)
        .mockResolvedValueOnce({ ...given, code: 'EFGH' });
      const read = vi
        .spyOn(api, 'integrationCode')
        .mockResolvedValueOnce({ ...given, status: 'failed', failure: 'CODE_EXPIRED' });
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await nextReading();

      expect(await service.findByRole('alert')).toHaveTextContent(
        'This code is no longer valid. Get a new one.',
      );
      expect(service.getByRole('button', { name: 'Get a new code' })).toHaveFocus();
      await nextReading();
      expect(read).toHaveBeenCalledTimes(1);
      await user.click(service.getByRole('button', { name: 'Get a new code' }));
      expect(await service.findByText('EFGH')).toBeInTheDocument();
      expect(start).toHaveBeenCalledTimes(2);
    });

    it('says the code expired when the engine no longer knows it', async () => {
      const user = setUp();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      vi.spyOn(api, 'integrationCode').mockRejectedValue(
        new ApiError(404, ApiErrorCode.NotFound, 'No code was given.'),
      );
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await nextReading();

      expect(await service.findByRole('alert')).toHaveTextContent(
        'This code is no longer valid. Get a new one.',
      );
    });

    it('waits on while the engine cannot be reached for a moment', async () => {
      const user = setUp();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      const read = vi
        .spyOn(api, 'integrationCode')
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        // The reading after it is still on its way: nothing it says can hide what the first did.
        .mockImplementation(() => new Promise(() => undefined));
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await nextReading();
      await vi.waitFor(() => {
        expect(read).toHaveBeenCalledTimes(1);
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(service.queryByRole('alert')).not.toBeInTheDocument();
      await nextReading();
      await vi.waitFor(() => {
        expect(read).toHaveBeenCalledTimes(2);
      });

      expect(service.queryByRole('alert')).not.toBeInTheDocument();
      expect(service.getByText(/^Scia connects as soon as you confirm it/)).toBeInTheDocument();
    });

    it('says why the service connected nothing for a confirmed code', async () => {
      const user = setUp();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      vi.spyOn(api, 'integrationCode').mockResolvedValue({
        ...given,
        status: 'failed',
        failure: 'KEY_NOT_KEPT',
      });
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await nextReading();

      expect(await service.findByRole('alert')).toHaveTextContent(
        'Scia could not keep the key safely on this computer. Nothing was connected.',
      );
    });

    it('says why no code was given, and offers the press again', async () => {
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockRejectedValue(
        new ApiError(502, ApiErrorCode.Unavailable, 'no'),
      );
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();

      await userEvent.click(service.getByRole('button', { name: 'Connect with a code' }));

      expect(await service.findByRole('alert')).toHaveTextContent(
        'Scia could not get a code from AllDebrid. Try again in a moment.',
      );
      expect(service.getByRole('button', { name: 'Connect with a code' })).toBeInTheDocument();
    });

    it('asks for one code however often it is pressed while it comes', async () => {
      listing([notConnected]);
      let give: (code: IntegrationCode) => void = () => undefined;
      const start = vi.spyOn(api, 'startIntegrationCode').mockImplementation(
        () =>
          new Promise((resolve) => {
            give = resolve;
          }),
      );
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      const button = service.getByRole('button', { name: 'Connect with a code' });

      await userEvent.click(button);
      await userEvent.click(service.getByRole('button', { name: 'Getting a code…' }));

      expect(start).toHaveBeenCalledTimes(1);
      give(given);
      expect(await service.findByText('ABCD')).toBeInTheDocument();
    });

    it('forgets the code at Cancel, tells the engine, and gives the focus back to "Connect with a code"', async () => {
      const user = setUp();
      withMain();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      const cancel = vi.spyOn(api, 'cancelIntegrationCode').mockResolvedValue();
      const read = vi.spyOn(api, 'integrationCode').mockResolvedValue(given);
      render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      await user.click(service.getByRole('button', { name: 'Cancel' }));

      expect(cancel).toHaveBeenCalledExactlyOnceWith('alldebrid');
      expect(service.queryByText('ABCD')).not.toBeInTheDocument();
      expect(service.getByRole('button', { name: 'Connect with a code' })).toHaveFocus();
      await nextReading();
      expect(read).not.toHaveBeenCalled();
    });

    it('tells the engine to forget the code when Settings closes, and shows none at the next visit', async () => {
      const user = setUp();
      listing([notConnected]);
      vi.spyOn(api, 'startIntegrationCode').mockResolvedValue(given);
      const cancel = vi.spyOn(api, 'cancelIntegrationCode').mockResolvedValue();
      const { rerender } = render(<IntegrationsSection open onError={ignore} />);
      const service = await theService();
      await user.click(service.getByRole('button', { name: 'Connect with a code' }));
      await service.findByText('ABCD');

      rerender(<IntegrationsSection open={false} onError={ignore} />);

      expect(cancel).toHaveBeenCalledExactlyOnceWith('alldebrid');
      rerender(<IntegrationsSection open onError={ignore} />);
      const again = await theService();
      expect(again.queryByText('ABCD')).not.toBeInTheDocument();
      expect(again.getByRole('button', { name: 'Connect with a code' })).toBeInTheDocument();
    });
  });
});
