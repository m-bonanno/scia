import { ApiErrorCode, type Integration } from '@scia/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api.ts';
import { IntegrationsSection } from './integrations.tsx';

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
  await userEvent.click(service.getByRole('button', { name: 'Connect' }));
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
    expect(service.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(service.queryByLabelText('AllDebrid API key')).not.toBeInTheDocument();
  });

  it('asks for the key when Connect is pressed, in a field that hides it and takes the focus', async () => {
    listing([notConnected]);
    render(<IntegrationsSection open onError={ignore} />);
    const service = await theService();

    await userEvent.click(service.getByRole('button', { name: 'Connect' }));

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
    expect(service.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
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
      'AllDebrid refuses this key from this network. Check your AllDebrid account, then try again.',
    ],
    [ApiErrorCode.AccountBanned, 422, 'AllDebrid says this account is banned.'],
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
    await userEvent.click(await service.findByRole('button', { name: 'Connect' }));

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

  it('closes the field at Cancel, forgets what was typed and what was said of it, and gives the focus back to Connect', async () => {
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
    expect(service.getByRole('button', { name: 'Connect' })).toHaveFocus();
    await userEvent.click(service.getByRole('button', { name: 'Connect' }));
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
    expect(service.getByRole('button', { name: 'Connect' })).toHaveFocus();
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
      'AllDebrid refuses the key from this network. Check your AllDebrid account.',
    ],
    [ApiErrorCode.AccountBanned, 'AllDebrid says this account is banned.'],
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
    await userEvent.click(again.getByRole('button', { name: 'Connect' }));
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
});
