import type { Magnet } from '@scia/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MagnetRow } from './magnet-row.tsx';

const fetching: Magnet = {
  id: 'm1',
  name: 'Holiday films',
  status: 'fetching',
  totalBytes: 400,
  downloadedBytes: 100,
  bytesPerSecond: 0,
  failure: null,
  createdAt: '2026-11-21T12:00:00.000Z',
};

function row(magnet: Magnet) {
  const actions = { retry: vi.fn(), remove: vi.fn() };
  render(
    <ul>
      <MagnetRow magnet={magnet} actions={actions} />
    </ul>,
  );
  return { actions, item: within(screen.getByRole('listitem')) };
}

describe('MagnetRow', () => {
  it('names the magnet, and shows how far the service is with it on a bar', () => {
    const { item } = row(fetching);

    expect(item.getByText('Holiday films')).toBeInTheDocument();
    expect(item.getByRole('progressbar', { name: 'Fetched by AllDebrid' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(item.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('stops waiting for it at Remove, once however often it is pressed', async () => {
    const { actions, item } = row(fetching);

    await userEvent.dblClick(item.getByRole('button', { name: 'Remove' }));
    item.getByRole('button', { name: 'Remove' }).focus();
    await userEvent.keyboard('{Enter>4/}');

    expect(actions.remove).toHaveBeenCalledTimes(2);
    expect(actions.remove).toHaveBeenCalledWith('m1');
  });

  it('says it is sending the magnet, on a bar that does not know how far', () => {
    const { item } = row({ ...fetching, status: 'sending', totalBytes: null, downloadedBytes: 0 });

    expect(item.getByText('Sending to AllDebrid…')).toBeInTheDocument();
    expect(item.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('hands the focus to Remove when Retry leaves under its press', async () => {
    const { item } = row({ ...fetching, status: 'failed', failure: 'MAGNET_FAILED' });

    await userEvent.click(item.getByRole('button', { name: 'Retry' }));

    expect(item.getByRole('button', { name: 'Remove' })).toHaveFocus();
  });

  it('offers Retry for a magnet that failed, once however often it is pressed, and shows no bar', async () => {
    const { actions, item } = row({ ...fetching, status: 'failed', failure: 'MAGNET_FAILED' });

    await userEvent.dblClick(item.getByRole('button', { name: 'Retry' }));

    expect(actions.retry).toHaveBeenCalledExactlyOnceWith('m1');
    expect(item.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
