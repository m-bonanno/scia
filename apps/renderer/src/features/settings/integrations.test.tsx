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
  // Midday, so that the day is the same wherever the spec runs.
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
    [ApiErrorCode.Unavailable, 502, 'AllDebrid is not answering. Try again in a moment.'],
    [
      ApiErrorCode.KeyNotKept,
      500,
      'Scia could not store the key safely on this computer. Nothing was connected.',
    ],
    [
      ApiErrorCode.InvalidRequest,
      400,
      'That is not a key. Copy it again from your AllDebrid account.',
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
      // A failed attempt never clears what was typed.
      expect(service.getByLabelText('AllDebrid API key')).toHaveValue(KEY);
      expect(service.getByText('Not connected')).toBeInTheDocument();
      expect(onError).not.toHaveBeenCalled();
    },
  );

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

    expect(service.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(connect).toHaveBeenCalledTimes(1);
    answer(connected);
    expect(await service.findByRole('status')).toHaveTextContent(/^Connected as ada/);
  });

  it('closes the field at Cancel, forgets what was typed, and gives the focus back to Connect', async () => {
    listing([notConnected]);
    render(<IntegrationsSection open onError={ignore} />);
    const service = await typeAKey();

    await userEvent.click(service.getByRole('button', { name: 'Cancel' }));

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
    [ApiErrorCode.Unavailable, 'AllDebrid is not answering right now.'],
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
